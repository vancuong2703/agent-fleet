import { stripVTControlCharacters } from 'node:util';
import type { CommandProbeResult } from '../../dashboard.js';
import type { ModelOffer, PlanInfo, QuotaWindow, Tier } from '../../../shared/dashboard.js';
import { applyModelCatalog, formatVerifiedAt, modelKey, readModelCatalog } from '../../model-catalog.js';
import { createParseContext, amount, lastMatch, type ParsedCliStatus, type DashboardEnrichment, type DashboardEnrichmentContext } from './common.js';

/** A priced picker row: `<name> … [context] <original>x <current>x Credit`. */
const RATE_ROW = /(\d+(?:\.\d+)?)x(?:\s+(\d+(?:\.\d+)?)x)?\s*Credit\s*$/;
/** Selection, scroll and effort glyphs the picker draws around a model name. */
const CURSOR = /^[^A-Za-z0-9]*/;
const NAME_HEAD = /^([A-Za-z0-9][A-Za-z0-9._+-]*)/;
const GROUP_COUNTS = /Default\s*\((\d+)\)(?:\s*[^\r\n]*?New\s*\((\d+)\))?/i;
const FIELD = (label: string) => new RegExp(`^[^\\w]*${label}\\s*:\\s*(.+)$`);
const CREDIT_LINE = /^[^\w]*(Plan|Add-on)\s*Credits\s*Used\s*:\s*([\d,.]+)\s*\/\s*([\d,.]+)/;

/** Labels the CLI spells in snake_case, reduced to the words a person reads. */
const PLAN_TOKENS: Record<string, string> = {
  personal: '', user: '', plan: '', pro: 'Pro', professional: 'Pro', trial: 'Trial',
  free: 'Free', plus: 'Plus', team: 'Team', ultimate: 'Ultimate', byok: 'BYOK', enterprise: 'Enterprise',
};

function tierOf(value: string): Tier {
  const text = value.toLowerCase();
  if (/byok|api[-_ ]?key/.test(text)) return 'byok';
  if (/trial/.test(text)) return 'trial';
  if (/free/.test(text)) return 'free';
  if (/plus/.test(text)) return 'plus';
  if (/team/.test(text)) return 'team';
  if (/pro/.test(text)) return 'pro';
  return 'unknown';
}

function nameOf(value: string): string {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
    .map(token => PLAN_TOKENS[token] ?? token.charAt(0).toUpperCase() + token.slice(1))
    .filter(Boolean).join(' ').trim();
}

function percent(used: number, limit: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null;
  return Math.round(Math.max(0, (limit - used) / limit * 100) * 100) / 100;
}

function contextTokensOf(line: string): number | null {
  const match = line.match(/▦\s*(\d+(?:\.\d+)?)\s*([KM])\b/i);
  if (!match) return null;
  return Math.round(Number(match[1]) * (match[2]!.toUpperCase() === 'M' ? 1_000_000 : 1_000));
}

/** The word between the effort bars and the context column, e.g. `Extra High`. */
function effortOf(line: string): string | null {
  const head = line.replace(RATE_ROW, '').split('▦')[0] ?? '';
  const bars = head.match(/[■□▩]{1,6}/g)?.at(-1);
  if (!bars) return null;
  const tail = head.slice(head.lastIndexOf(bars) + bars.length).replace(/[→←\s]+/g, ' ').trim();
  return tail.length > 0 && tail.length <= 16 ? tail : null;
}

function modelRow(line: string): ModelOffer | null {
  const rate = line.match(RATE_ROW);
  if (!rate) return null;
  const id = line.replace(CURSOR, '').match(NAME_HEAD)?.[1];
  if (!id) return null;
  // Two prices are printed struck-then-live, so the last one is what the user pays.
  const current = Number(rate[2] ?? rate[1]);
  const original = rate[2] !== undefined ? Number(rate[1]) : null;
  if (!Number.isFinite(current) || (original !== null && !Number.isFinite(original))) return null;
  return {
    id, label: id, provider: null, multiplier: current,
    originalMultiplier: original, promo: original !== null && current < original ? 'Đang giảm giá' : null,
    contextTokens: contextTokensOf(line), source: 'pty',
  };
}

/** One model per line; every row must survive the decoration a list command puts in front of it. */
function parseModelListing(stdout: string): string[] {
  const ids: string[] = [];
  for (const raw of stripVTControlCharacters(stdout).split(/\r?\n/)) {
    const line = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim();
    if (!line) continue;
    const [first, second] = line.split('\t');
    const id = (second !== undefined ? first : line).trim();
    if (!/^[\p{L}\p{N}][\p{L}\p{N}._+\/ -]{0,40}$/u.test(id)) continue;
    if (/(?:^|\s)(?:models?|list|available|name|id|usage|context|price|credit)(?:\s|$)/i.test(id)) continue;
    if (!ids.some(known => modelKey(known) === modelKey(id))) ids.push(id);
  }
  return ids;
}

export function parseQoderStatus(results: CommandProbeResult[], redact: (text: string) => string): ParsedCliStatus {
  const { result, text, source, add } = createParseContext(results, redact);
  let { account, quota, credits } = result;
  const models: ModelOffer[] = [];
  const rows = new Map<string, string>();
  const windows = new Map<string, QuotaWindow>();
  let plan: PlanInfo | undefined;
  let userType: string | null = null;
  let currentLabel: string | null = null;
  let declared: number | null = null;
  let expirySeen = false;

  for (const line of stripVTControlCharacters(text).split(/\r?\n/)) {
    const row = line.trim();
    if (!row) continue;

    const model = modelRow(row);
    if (model) {
      const key = modelKey(model.id);
      if (!models.some(known => modelKey(known.id) === key)) { models.push(model); rows.set(key, row); }
      continue;
    }

    const counts = row.match(GROUP_COUNTS);
    if (counts) declared = Number(counts[1]) + (counts[2] !== undefined ? Number(counts[2]) : 0);

    const creditsLine = row.match(CREDIT_LINE);
    if (creditsLine) {
      const used = amount(creditsLine[2]!), limit = amount(creditsLine[3]!);
      const group = creditsLine[1]!.toLowerCase() === 'plan' ? 'Credit gói' : 'Credit bổ sung';
      if (Number.isFinite(used) && Number.isFinite(limit)) {
        windows.set(group, { group, window: 'plan', remainingPct: percent(used, limit), used, limit, unit: 'credits', resetAt: null });
      }
      continue;
    }

    const planLine = row.match(FIELD('(?:Qoder|Subscription)\\s+Plan'));
    if (planLine) { plan = { name: planLine[1]!.trim(), tier: tierOf(planLine[1]!), renewsAt: null, source }; continue; }

    const current = row.match(FIELD('Current\\s+Model'));
    if (current) { currentLabel = current[1]!.trim(); continue; }

    const expiry = row.match(FIELD('Plan\\s+Expires\\s+At'));
    if (expiry) {
      // The same screen can be captured twice; the detail list must still hold one expiry row.
      if (!expirySeen) { expirySeen = true; add('Hết hạn gói', expiry[1]!.trim()); }
      continue;
    }
  }

  for (const probe of results) {
    let json: Record<string, unknown>;
    try { json = JSON.parse(probe.stdout); if (!json || typeof json !== 'object' || Array.isArray(json)) continue; } catch { continue; }
    if (typeof json.logged_in === 'boolean') {
      account = { state: json.logged_in ? 'authenticated' : 'unauthenticated', label: json.logged_in ? redact(String(json.username ?? json.email ?? 'Đã đăng nhập')) : 'Chưa đăng nhập', source: probe.command, reason: null };
      if (typeof json.user_type === 'string' && json.user_type.length > 0) {
        userType = json.user_type;
        add('Gói tài khoản', userType);
      }
    }
  }

  const highlights: string[] = [];
  if (userType) {
    // `user_type` is the machine field, so it decides the tier; the screen only names the plan.
    const derived: PlanInfo = { name: nameOf(userType) || userType, tier: tierOf(userType), renewsAt: null, source };
    plan = plan ? { ...plan, name: plan.name || derived.name, tier: derived.tier === 'unknown' ? plan.tier : derived.tier } : derived;
  }

  {
    let remaining = 0, found = false;
    for (const [pattern, label] of [[/Plan\s*Credits\s*Used\s*:\s*([\d,.]+)\s*\/\s*([\d,.]+)/g, 'Credit gói'], [/Add-on\s*Credits\s*Used\s*:\s*([\d,.]+)\s*\/\s*([\d,.]+)/g, 'Credit bổ sung']] as const) {
      const match = lastMatch(text, pattern); if (!match) continue;
      const used = amount(match[1]!), limit = amount(match[2]!); if (!Number.isFinite(used) || !Number.isFinite(limit) || used < 0 || limit < 0) continue;
      const left = Math.max(0, limit - used); remaining += left; found = true; add(label, `${left} còn lại · đã dùng ${used}/${limit}`);
      if (label === 'Credit gói') quota = { remaining: left, unit: 'credits', resetAt: null, source, reason: null };
    }
    if (found) credits = { remaining, unit: 'credits', resetAt: null, source, reason: null };
  }

  const pickerSeen = declared !== null || models.length > 0;
  if (pickerSeen && declared !== null && models.length < declared) {
    highlights.push(`Màn /model công bố ${declared} model nhưng chỉ đọc được ${models.length} dòng giá; danh sách có thể chưa đủ.`);
  }
  if (!pickerSeen) {
    highlights.push('Chưa đọc được màn /model, nên chưa có hệ số giá từ CLI; chỉ catalog hoặc --list-models bổ sung được model.');
  }

  const currentRow = currentLabel !== null ? rows.get(modelKey(currentLabel)) : undefined;
  return {
    ...result,
    account, quota, credits,
    plan,
    currentModel: currentLabel === null ? undefined : {
      id: currentLabel, label: currentLabel, effort: currentRow ? effortOf(currentRow) : null,
    },
    models: models.length ? models : undefined,
    quotaWindows: windows.size ? [...windows.values()] : undefined,
    highlights: highlights.length ? highlights : undefined,
  };
}

/**
 * Adds what a pure text pass cannot know: the model names `--list-models` reports
 * (without any rate) and the user-maintained catalog that supplies or corrects rates.
 */
export async function enrichQoder(context: DashboardEnrichmentContext): Promise<DashboardEnrichment> {
  const check = context.check;
  const models = [...check.models ?? []];

  const listing = await context.runCommand(['--list-models'], 'usage');
  if (listing.ok) {
    for (const id of parseModelListing(listing.stdout)) {
      if (models.some(model => modelKey(model.id) === modelKey(id))) continue;
      models.push({ id, label: id, provider: null, multiplier: null, originalMultiplier: null, promo: null, contextTokens: null, source: 'cli' });
    }
  }

  const catalog = readModelCatalog(context.directory);
  const priced = applyModelCatalog(models, catalog);
  const fromCatalog = priced.filter(model => model.source === 'catalog').length;

  const notes = [...(check.highlights ?? [])];
  if (catalog.error) notes.push(`Không dùng được model-catalog.json: ${catalog.error}`);
  else if (fromCatalog > 0) {
    notes.push(`Hệ số ${fromCatalog} model theo catalog, cập nhật ${formatVerifiedAt(catalog.verifiedAt) ?? 'không ghi ngày'}.`);
  }
  const unpriced = priced.filter(model => model.multiplier === null).length;
  if (priced.length > 0 && unpriced === priced.length) {
    notes.push(`Chưa có hệ số giá cho ${unpriced} model; hiển thị "chưa có dữ liệu", không suy diễn.`);
  }

  return {
    plan: check.plan,
    currentModel: check.currentModel,
    models: priced.length ? priced : undefined,
    quotaWindows: check.quotaWindows,
    highlights: notes.length ? notes : undefined,
  };
}
