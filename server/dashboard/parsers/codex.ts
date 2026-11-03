import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import type { CurrentModel, PlanInfo, Tier } from '../../../shared/dashboard.js';
import type { CommandProbeResult } from '../../dashboard.js';
import { createParseContext, lastMatch, type ParsedCliStatus, type DashboardEnrichment, type DashboardEnrichmentContext } from './common.js';

export function parseCodexStatus(results: CommandProbeResult[], redact: (text: string) => string): ParsedCliStatus {
  const { result, source, add, text: raw } = createParseContext(results, redact);
  const text = stripVTControlCharacters(raw);
  result.quotaWindows = [];
  const { details } = result;
  let { account, quota, credits } = result;
  {
    const identity = lastMatch(text,/Account:\s*([^\r\n]+)/g)?.[1]?.trim();
    if (identity) account={state:'authenticated',label:redact(identity),source,reason:null};
    for (const match of text.matchAll(/(5h|Weekly)\s*limit:\s*[^\r\n]*?(\d+(?:\.\d+)?)%\s*left(?:\s*\(resets\s*([^\r\n)]+)\))?/gi)) {
      const value=Number(match[2]);if(value<0||value>100)continue;
      const label=match[1]!.toLowerCase()==='5h'?'Hạn mức 5 giờ':'Hạn mức tuần';
      if(details.some(detail=>detail.label===label))continue;
      result.quotaWindows.push({ group: 'Codex', window: match[1]!.toLowerCase() === '5h' ? '5h' : 'week', remainingPct: value, unit: 'percent', resetAt: match[3] ?? null });
      add(label,`${value}% còn lại${match[3]?` · reset ${match[3]}`:''}`);
      if(match[1]!.toLowerCase()==='5h'||quota.remaining===null)quota={remaining:value,unit:'percent',resetAt:match[3]??null,source,reason:null};
    }
    const model=lastMatch(text,/\bModel:\s*([^\r\n]+)/g)?.[1];if(model)add('Model CLI',model.trim());
  }
  return { ...result, account, quota, credits };
}

export interface CodexLocalOptions {
  codexHome?: string;
  /** Tests provide a reader so account files on the actual machine are never read. */
  readText?: (file: string) => Promise<string>;
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/** Display-only claim extraction. A local JWT is not proof of entitlement. */
function localPlan(auth: string): PlanInfo {
  const source = 'auth.json · chatgpt_plan_type (chưa xác minh)';
  const unknown: PlanInfo = { name: 'Chưa rõ gói', tier: 'unknown', source };
  try {
    const document = record(JSON.parse(auth));
    const token = record(document?.tokens)?.id_token ?? document?.id_token;
    if (typeof token !== 'string' || token.length > 64_000) return unknown;
    const parts = token.split('.');
    if (parts.length !== 3 || !/^[A-Za-z0-9_-]+$/.test(parts[1]!)) return unknown;
    const payload = record(JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8')));
    const claim = payload?.chatgpt_plan_type ?? record(payload?.['https://api.openai.com/auth'])?.chatgpt_plan_type;
    if (typeof claim !== 'string') return unknown;
    const plans: Record<string, { name: string; tier: Tier }> = {
      free: { name: 'ChatGPT Free', tier: 'free' }, trial: { name: 'ChatGPT Trial', tier: 'trial' },
      plus: { name: 'ChatGPT Plus', tier: 'plus' }, pro: { name: 'ChatGPT Pro', tier: 'pro' },
      team: { name: 'ChatGPT Team', tier: 'team' }, business: { name: 'ChatGPT Business', tier: 'team' },
      enterprise: { name: 'ChatGPT Enterprise', tier: 'team' }, edu: { name: 'ChatGPT Edu', tier: 'team' },
      go: { name: 'ChatGPT Go', tier: 'unknown' },
    };
    // Return only whitelisted display fields; no identity, expiry or other JWT claim survives.
    const plan = Object.hasOwn(plans, claim.toLowerCase()) ? plans[claim.toLowerCase()] : undefined;
    return plan ? { ...plan, source } : unknown;
  } catch {
    // Missing/invalid local authentication is ordinary unavailable dashboard data.
    return unknown;
  }
}

/** Read just the two root scalar settings; tables/profiles and multiline TOML are not defaults. */
function configuredModel(toml: string): CurrentModel | undefined {
  const values: Record<string, string> = {};
  for (const line of toml.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (/^[ \t]*\[/.test(line)) break;
    const setting = line.match(/^[ \t]*(?:"(model|model_reasoning_effort)"|'(model|model_reasoning_effort)'|(model|model_reasoning_effort))[ \t]*=[ \t]*(.+)$/);
    if (!setting) continue;
    const scalar = setting[4]!.match(/^("(?:[^"\\]|\\.)*"|'[^']*')[ \t]*(?:#.*)?$/);
    if (!scalar) continue;
    try {
      const value: string = scalar[1]!.startsWith('"') ? JSON.parse(scalar[1]!) : scalar[1]!.slice(1, -1);
      if (value.length <= 200 && !/[\r\n\u0000-\u001f]|eyJ|sk-/i.test(value)) values[(setting[1] ?? setting[2] ?? setting[3])!] = value;
    } catch {
      // An unsupported/invalid scalar is absent, not a guessed model.
    }
  }
  const model = values.model;
  if (!model || !/^[A-Za-z0-9][A-Za-z0-9_.:/#-]*$/.test(model)) return undefined;
  const effort = values.model_reasoning_effort?.trim();
  return { id: model, label: model, ...(effort ? { effort } : {}) };
}

/** Reads only auth.json/config.toml, never executes CLI commands or exposes their contents. */
export async function enrichCodex(_context: DashboardEnrichmentContext, options: CodexLocalOptions = {}): Promise<DashboardEnrichment> {
  const directory = options.codexHome ?? process.env.CODEX_HOME ?? path.join(process.env.USERPROFILE ?? homedir(), '.codex');
  const reader = options.readText ?? ((file: string) => readFile(file, 'utf8'));
  const readOptional = async (name: string): Promise<string> => {
    try {
      const text = await reader(path.join(directory, name));
      return text.length <= 256_000 ? text : '';
    } catch {
      // Local profiles may be absent or unreadable; never expose filesystem errors with auth content.
      return '';
    }
  };
  const [auth, config] = await Promise.all([readOptional('auth.json'), readOptional('config.toml')]);
  const currentModel = configuredModel(config);
  return { plan: localPlan(auth), ...(currentModel ? { currentModel } : {}) };
}
