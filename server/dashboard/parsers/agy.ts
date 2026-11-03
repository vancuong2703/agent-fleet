import { stripVTControlCharacters } from 'node:util';
import type { ModelOffer, PlanInfo, Tier } from '../../../shared/dashboard.js';
import type { CommandProbeResult } from '../../dashboard.js';
import { createParseContext, amount, lastMatch, unknown, type ParsedCliStatus, type DashboardEnrichment, type DashboardEnrichmentContext } from './common.js';

export function parseAgyStatus(results: CommandProbeResult[], redact: (text: string) => string): ParsedCliStatus {
  const { result, source, add, text: raw } = createParseContext(results, redact);
  const text = stripVTControlCharacters(raw);
  const { quotas } = result;
  let { account, quota, credits } = result;
  {
    const identity=lastMatch(text,/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})([^\r\n]*)/g)?.[0];
    if(identity)account={state:'authenticated',label:redact(identity).slice(0,150),source,reason:null};
    const credit=lastMatch(text,/Remaining\s*(?:AI\s*)?Credits\s*:\s*([\d,.]+)/gi);
    if(credit&&Number.isFinite(amount(credit[1]!)))credits={remaining:amount(credit[1]!),unit:'credits',resetAt:null,source,reason:null};
    else if(/AI\s*Credits\s*not\s*enabled/i.test(text))credits=unknown(source,'AI Credits chưa được bật trong tài khoản AGY.');
    const model=lastMatch(text,/((?:Gemini|Claude|GPT|Qwen|DeepSeek)[^\r\n·]{0,65})\s*·\s*(low|medium|high|max)/g);if(model)add('Model CLI',`${model[1]!.trim()} · ${model[2]}`);
    let group = '';
    const lines = text.split(/\r?\n/);
    for (let index=0;index<lines.length;index++) {
      const line=lines[index]!.trim();
      if (/^(?:GEMINI MODELS|CLAUDE AND GPT MODELS|GEMINI 4 ARGON)$/i.test(line)) group=line;
      if (!group) continue;
      const window=/Five\s*Hour\s*Limit\s*Remaining/i.test(line)?'5 giờ':/Weekly\s*Limit(?:\s*Remaining)?/i.test(line)?'Tuần':null;
      if(!window)continue;
      let end=Math.min(index+5,lines.length);
      for(let next=index+1;next<end;next++)if(/Weekly\s*Limit|Five\s*Hour\s*Limit|^(?:GEMINI MODELS|CLAUDE AND GPT MODELS|GEMINI 4 ARGON)$/i.test(lines[next]!.trim())){end=next;break;}
      const portion=lines.slice(index,end).join('\n');
      const percentage=portion.match(/(\d+(?:\.\d+)?)\s*%/);
      if(!percentage)continue;
      const remaining=Number(percentage[1]);if(remaining<0||remaining>100)continue;
      const reset=portion.match(/Refreshes\s+in\s+([^\r\n]+)/i)?.[1]?.trim()??null;
      const row={group,window,remaining,reset:reset?`Làm mới sau ${reset}`:null};
      const existing=quotas.findIndex(item=>item.group===group&&item.window===window);
      if(existing<0)quotas.push(row);else quotas[existing]=row;
    }
    // Preserve all groups separately. The main number represents the selected
    // model's weekly bucket; never sum percentages across unrelated models.
    const selectedGroup=/Argon/i.test(model?.[1]??'')?'GEMINI 4 ARGON':/Claude|GPT/i.test(model?.[1]??'')?'CLAUDE AND GPT MODELS':/Gemini/i.test(model?.[1]??'')?'GEMINI MODELS':null;
    const primary=quotas.find(item=>item.group===selectedGroup&&item.window==='Tuần');
    if(primary)quota={remaining:primary.remaining,unit:'percent',resetAt:primary.reset,source,reason:null};
  }
  result.quotaWindows = quotas.map(row => ({ group: row.group, window: row.window === '5 giờ' ? '5h' : 'week', remainingPct: row.remaining, unit: 'percent', resetAt: row.reset }));
  result.plan = explicitPlan(text, source, redact);
  return { ...result, account, quota, credits };
}

function explicitPlan(text: string, source: string, redact: (text: string) => string): PlanInfo {
  // Match account/subscription headers only. Explanatory quota prose mentions Pro/Ultra too.
  const header = lastMatch(text, /^[ \t]*(?:Plan|Subscription|Account plan)[ \t]*:[ \t]*([^\r\n]+)/gim)?.[1]
    ?? lastMatch(text, /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}[ \t]+\(([^\r\n)]+)\)/g)?.[1];
  const name = header ? redact(header.trim()).slice(0, 100) : 'Chưa rõ gói';
  let tier: Tier = 'unknown';
  if (header) {
    if (/\btrial\b/i.test(header)) tier = 'trial';
    else if (/\bfree\b/i.test(header)) tier = 'free';
    else if (/\b(?:team|business|enterprise)\b/i.test(header)) tier = 'team';
    else if (/\b(?:pro|ultra)\b/i.test(header)) tier = 'pro';
    else if (/\bplus\b/i.test(header)) tier = 'plus';
  }
  return { name, tier, source };
}

/** AGY reports model identity, not per-model prices; unknown multipliers stay null. */
export async function enrichAgy(context: DashboardEnrichmentContext): Promise<DashboardEnrichment> {
  let result: CommandProbeResult;
  try {
    result = await context.runCommand(['models']);
  } catch {
    return { models: [], highlights: ['Danh sách model AGY chưa có dữ liệu.'] };
  }
  if (!result.ok) return { models: [], highlights: ['Danh sách model AGY chưa có dữ liệu.'] };
  const models: ModelOffer[] = [];
  const seen = new Set<string>();
  for (const line of stripVTControlCharacters(result.stdout).replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z0-9][A-Za-z0-9_./:-]{0,199})\t([^\r\n]+)$/);
    if (!match || seen.has(match[1]!)) continue;
    const id = match[1]!;
    const label = match[2]!.trim();
    if (!label || label.length > 200 || /eyJ|sk-/i.test(id + label)) continue;
    seen.add(id);
    models.push({ id, label: context.redact(label), multiplier: null, source: 'cli' });
  }
  return { models, ...(!models.length ? { highlights: ['Danh sách model AGY chưa có dữ liệu.'] } : {}) };
}
