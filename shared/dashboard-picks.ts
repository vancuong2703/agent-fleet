import type { DashboardAgent, DashboardTool } from './dashboard.js';

export interface Pick {
  id: string;
  agent: DashboardAgent;
  kind: 'model' | 'tool' | 'warning';
  label: string;
  reason: string;
  modelId?: string;
  remainingPct?: number | null;
}

const percentage = (value: number | null): value is number =>
  value !== null && Number.isFinite(value) && value >= 0 && value <= 100;

/** Rank only explicit observations. Never infer price or turn missing quota into zero. */
export function rankPicks(tools: readonly DashboardTool[]): Pick[] {
  const models: { pick: Pick; multiplier: number }[] = [];
  const quotas: Pick[] = [];
  const warnings: Pick[] = [];
  for (const tool of tools) {
    const check = tool.lastCheck;
    if (!check) continue;
    const known = (check.quotaWindows ?? []).map(row => row.remainingPct).filter(percentage);
    const remaining = known.length ? Math.min(...known) : null;
    const exhausted = (check.keyPools ?? []).filter(pool => pool.exhausted > 0);
    const reasons: string[] = [];
    if (remaining !== null && remaining < 25) reasons.push(`Hạn mức thấp nhất còn ${remaining}%.`);
    for (const pool of exhausted) reasons.push(`Pool ${pool.name} có ${pool.exhausted} key cạn hạn mức.`);
    if (reasons.length) warnings.push({ id: `${tool.agent}:warning`, agent: tool.agent, kind: 'warning', label: tool.title, reason: reasons.join(' '), remainingPct: remaining });
    if (check.status !== 'ready' || remaining === 0) continue;
    const seen = new Set<string>();
    for (const model of check.models ?? []) {
      const price = model.multiplier;
      if (price === null || !Number.isFinite(price) || price < 0 || price > 0.1 || seen.has(model.id)) continue;
      seen.add(model.id);
      models.push({ multiplier: price, pick: { id: `${tool.agent}:model:${model.id}`, agent: tool.agent, kind: 'model', label: model.label, modelId: model.id, remainingPct: remaining,
        reason: price === 0 ? `${tool.title} đang sẵn sàng, model miễn phí.` : `${tool.title} đang sẵn sàng, hệ số ${price}×.` } });
    }
    if (remaining !== null) quotas.push({ id: `${tool.agent}:quota`, agent: tool.agent, kind: 'tool', label: tool.title, remainingPct: remaining,
      reason: `Hạn mức thấp nhất còn ${remaining}%.` });
  }
  models.sort((a, b) => a.multiplier - b.multiplier || (b.pick.remainingPct ?? -1) - (a.pick.remainingPct ?? -1) || a.pick.id.localeCompare(b.pick.id));
  quotas.sort((a, b) => b.remainingPct! - a.remainingPct! || a.id.localeCompare(b.id));
  warnings.sort((a, b) => (a.remainingPct ?? 101) - (b.remainingPct ?? 101) || a.id.localeCompare(b.id));
  return [...models.map(row => row.pick), ...quotas, ...warnings];
}
