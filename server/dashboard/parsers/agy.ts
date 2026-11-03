import type { CommandProbeResult } from '../../dashboard.js';
import { createParseContext, amount, lastMatch, unknown, type ParsedCliStatus, type DashboardEnrichment, type DashboardEnrichmentContext } from './common.js';

export function parseAgyStatus(results: CommandProbeResult[], redact: (text: string) => string): ParsedCliStatus {
  const { result, text, source, add } = createParseContext(results, redact);
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
  return { ...result, account, quota, credits };
}

/** Read-only enrichment hook populated by the agent data task. */
export async function enrichAgy(_context: DashboardEnrichmentContext): Promise<DashboardEnrichment> {
  return {};
}
