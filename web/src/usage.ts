import type { DashboardCheck, DashboardTool, Tier } from '../../shared/dashboard.js';
import type { ModelIdentity, ModelUsageRow, ObservabilitySnapshot, ResourceSample, ToolUsageRow } from '../../shared/observability.js';
import type { AgentId } from '../../shared/types.js';
import { formatBytes, formatNumber, formatUsd } from './observability.js';
import { formatElapsed } from './store.js';

/** Placeholder for a value the server has no measurement for. */
export const MISSING = '—';
/** Shown instead of `0` whenever a metric is `null`. */
export const MISSING_LABEL = 'Chưa có dữ liệu';

/** Where a model name came from, in Vietnamese. */
export const modelSourceLabels: Record<ModelIdentity['source'], string> = { reported: 'Agent báo', configured: 'Cấu hình CLI' };
/** How a usage row was attributed to a model, in Vietnamese. */
export const attributionLabels: Record<ModelUsageRow['attribution'], string> = { reported: 'Agent báo', configured: 'Cấu hình CLI', unattributed: 'Chưa gán model' };

export type ChartKind = 'cpu' | 'memory';
export type ChartState = 'ready' | 'collecting' | 'empty';

export interface ChartGeometry {
  state: ChartState;
  /** SVG polyline points; empty unless `state === 'ready'`. */
  points: string;
  /** Number of usable samples behind the line. */
  samples: number;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Points for the resource chart. A flat line is never invented: fewer than two
 * usable samples return `collecting`/`empty` so the UI can explain how to get
 * data. A zero memory sample means "not measured" and is skipped.
 */
export function chartGeometry(history: ResourceSample[], kind: ChartKind): ChartGeometry {
  const values: number[] = [];
  for (const sample of history.slice(-60)) {
    const value = kind === 'cpu' ? sample.cpuPercent : sample.memoryBytes;
    if (value === null || value === undefined || !Number.isFinite(value)) continue;
    if (kind === 'memory' && value <= 0) continue;
    values.push(value);
  }
  if (values.length < 2) {
    return { state: values.length === 0 ? 'empty' : 'collecting', points: '', samples: values.length };
  }
  const scale = kind === 'cpu' ? 100 : Math.max(...values) * 1.15;
  const points = values
    .map((value, index) => `${round((index / (values.length - 1)) * 260)},${round(46 - (Math.min(value, scale) / scale) * 40)}`)
    .join(' ');
  return { state: 'ready', points, samples: values.length };
}

/** Vietnamese guidance for the empty and single-sample chart states. */
export function chartGuidance(kind: ChartKind, state: ChartState): string {
  const metric = kind === 'cpu' ? 'CPU' : 'bộ nhớ';
  if (state !== 'ready') {
    if (state === 'collecting') return `Mới có 1 mẫu ${metric}. Cần thêm một mẫu (khoảng 5 giây) để vẽ xu hướng.`;
    return `Chưa có mẫu ${metric}. Số liệu lấy mỗi 5 giây khi có tiến trình chạy — mở một task để bắt đầu đo.`;
  }
  return '';
}

export interface UsageKpi {
  key: 'tokens' | 'cost' | 'memory' | 'cpuTime';
  label: string;
  /** `null` means "not measured yet" and must never render as `0`. */
  value: string | null;
  note: string;
}

function coverage(covered: number, total: number, noun: string): string {
  if (total <= 0) return 'Chưa có lần chạy nào';
  return `${covered}/${total} lần chạy ${noun}`;
}

/** The four KPI tiles at the top of the usage page. */
export function usageKpis(snapshot: ObservabilitySnapshot | null): UsageKpi[] {
  const usage = snapshot?.usage;
  const totalRuns = usage?.coverage.totalRuns ?? 0;
  const hasTokens = usage != null && (usage.inputTokens !== null || usage.outputTokens !== null);
  const tokens = hasTokens ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) : null;
  const cost = formatUsd(usage?.costUsd);
  const peakMemory = formatBytes(usage?.resources.peakMemoryBytes);
  return [
    {
      key: 'tokens',
      label: 'Tổng token đã ghi nhận',
      value: tokens === null ? null : formatNumber(tokens),
      note: usage === undefined ? 'Chưa có dữ liệu' : coverage(usage.coverage.tokenRuns, totalRuns, 'có số liệu'),
    },
    {
      key: 'cost',
      label: 'Chi phí báo cáo',
      value: cost === MISSING ? null : cost,
      note: usage === undefined || usage.coverage.costRuns === 0 ? 'Nhà cung cấp chưa báo chi phí' : coverage(usage.coverage.costRuns, totalRuns, 'có chi phí'),
    },
    {
      key: 'memory',
      label: 'RAM đỉnh đã quan sát',
      value: peakMemory === MISSING ? null : peakMemory,
      note: usage === undefined || usage.resources.measuredRuns === 0 ? 'Chưa có mẫu tài nguyên' : `${usage.resources.measuredRuns} lần chạy có mẫu tài nguyên`,
    },
    {
      key: 'cpuTime',
      label: 'CPU time đã quan sát',
      value: usage?.resources.observedCpuTimeMs == null ? null : formatElapsed(usage.resources.observedCpuTimeMs),
      note: 'Tiến trình ngắn có thể nằm giữa hai mẫu',
    },
  ];
}

const TIER_LABELS: Record<Tier, string> = {
  free: 'FREE',
  trial: 'TRIAL',
  plus: 'PLUS',
  pro: 'PRO',
  team: 'TEAM',
  byok: 'BYOK',
  unknown: 'CHƯA RÕ',
};

export interface TierBadge {
  label: string;
  tone: Tier;
}

/** Tier badge from an agent's last check, or `null` when the agent was never checked. */
export function tierBadge(check: DashboardCheck | null | undefined): TierBadge | null {
  if (!check?.plan) return null;
  const tone: Tier = check.plan.tier in TIER_LABELS ? check.plan.tier : 'unknown';
  return { label: TIER_LABELS[tone], tone };
}

/** `0.5` → `x0.5`, `0` → `Miễn phí`, `null` → `null` (unknown is not zero). */
export function formatMultiplier(value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  if (value === 0) return 'Miễn phí';
  return `x${Number(value.toFixed(2))}`;
}

export interface MultiplierView {
  text: string;
  /** Old price, shown struck through when the offer is discounted. */
  original: string | null;
  promo: string | null;
}

/** Credit multiplier of the model the agent reported as current. */
export function currentMultiplier(check: DashboardCheck | null | undefined): MultiplierView | null {
  const id = check?.currentModel?.id;
  if (!id) return null;
  const offer = check?.models?.find((entry) => entry.id === id);
  if (!offer) return null;
  const text = formatMultiplier(offer.multiplier);
  if (text === null) return null;
  const original = offer.originalMultiplier != null && offer.multiplier != null && offer.originalMultiplier > offer.multiplier
    ? formatMultiplier(offer.originalMultiplier)
    : null;
  return { text, original, promo: offer.promo ?? null };
}

export interface AgentUsageRow {
  agent: AgentId;
  /** `null` when the agent has no measured run yet. */
  usage: ToolUsageRow | null;
  check: DashboardCheck | null;
  tier: TierBadge | null;
  multiplier: MultiplierView | null;
  planName: string | null;
}

/**
 * One row per configured agent (so tiers show before the first run) plus any
 * agent that only appears in the usage ledger.
 */
export function agentUsageRows(usage: ToolUsageRow[], tools: DashboardTool[]): AgentUsageRow[] {
  const rows: AgentUsageRow[] = [];
  const byAgent = new Map<AgentId, AgentUsageRow>();
  const push = (row: AgentUsageRow): void => { rows.push(row); byAgent.set(row.agent, row); };
  for (const tool of tools) {
    push({ agent: tool.agent, usage: null, check: tool.lastCheck, tier: tierBadge(tool.lastCheck), multiplier: currentMultiplier(tool.lastCheck), planName: tool.lastCheck?.plan?.name ?? null });
  }
  for (const row of usage) {
    const existing = byAgent.get(row.agent);
    if (existing) {
      existing.usage = row;
      continue;
    }
    push({ agent: row.agent, usage: row, check: null, tier: null, multiplier: null, planName: null });
  }
  return rows;
}

/** True once at least one run contributed numbers; drives the page-level empty state. */
export function hasUsageData(snapshot: ObservabilitySnapshot | null): boolean {
  if (!snapshot) return false;
  return snapshot.usage.runCount > 0 || snapshot.usageByTool.length > 0 || snapshot.usageByModel.length > 0;
}
