import type { AgentId, FleetEvent } from '../shared/types.js';
import type { ModelIdentity, ModelUsageRow, RunObservation, ToolUsageRow, UsageMetrics } from '../shared/observability.js';

type UsageEvent = Extract<FleetEvent, { kind: 'usage' }>;
type Metric = 'inputTokens' | 'outputTokens' | 'costUsd' | 'credits' | 'reportedCredits';
type Counters = Record<Metric, number | null>;
const metrics: Metric[] = ['inputTokens', 'outputTokens', 'costUsd', 'credits', 'reportedCredits'];
/** Floating point tolerance so exact totals are not reported as a phantom residual. */
const EPSILON = 1e-9;
const emptyCounters = (): Counters => ({ inputTokens: null, outputTokens: null, costUsd: null, credits: null, reportedCredits: null });
const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const sum = (values: (number | null)[]): number | null => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((total, value) => total + value, 0) : null;
};
const modelKey = (name: string | null, provider: string | null) => JSON.stringify([provider, name]);

/** A runtime placeholder such as `qfmodel` is kept verbatim, never aliased. */
export const isGenericModel = (name: string): boolean => /^qfmodel$/i.test(name);

function applyCounters(target: Counters, usage: UsageEvent): void {
  for (const field of metrics) {
    let value = usage[field];
    // A non-billable request costs nothing even though its nominal credit is kept below.
    if (field === 'credits' && usage.billable === false && valid(value)) value = 0;
    if (field === 'reportedCredits' && value === undefined && valid(usage.credits)) {
      // A final charged total must not erase nominal non-billable request credits.
      if (usage.usageScope === 'cumulative' && target.reportedCredits !== null) continue;
      value = usage.credits;
    }
    if (!valid(value)) continue;
    target[field] = usage.usageScope === 'cumulative' ? value : (target[field] ?? 0) + value;
  }
}

/**
 * Separates a run's authoritative totals from per-model attribution. Model rows
 * and the unattributed residual always add up to the totals and are never summed
 * together. `attributionOnly` events only ever assign a model; they never change
 * totals, and attribution that exceeds the reported total falls back to residual
 * instead of inventing per-model charges.
 */
export class ModelUsageLedger {
  private readonly identities = new Map<string, ModelIdentity>();
  private readonly allocations = new Map<string, { model: string | null; provider: string | null; counters: Counters }>();
  private readonly aggregate = emptyCounters();
  private readonly seen = new Set<string>();

  addModel(name: string, source: 'reported' | 'configured', provider: string | null = null): void {
    if (!name || name.length > 200) return;
    const key = modelKey(name, provider);
    const previous = this.identities.get(key);
    // A real report always beats a configured default for the same identity.
    if (previous?.source === 'reported' && source === 'configured') return;
    this.identities.delete(key);
    this.identities.set(key, { name, source, provider, generic: isGenericModel(name) });
  }

  models(): ModelIdentity[] { return [...this.identities.values()]; }

  /** Prefers a concrete model over a generic runtime placeholder. */
  primary(): ModelIdentity | null {
    const models = this.models().reverse();
    return models.find((model) => !model.generic) ?? models[0] ?? null;
  }

  addUsage(event: UsageEvent): void {
    // Same dedupe key as the runner so a streamed snapshot is not charged twice.
    if (event.usageId && event.usageScope !== 'cumulative') {
      const key = JSON.stringify([event.attributionOnly ?? false, event.provider ?? null, event.model ?? null, event.usageScope ?? 'delta', event.usageId]);
      if (this.seen.has(key)) return;
      this.seen.add(key);
    }
    const model = typeof event.model === 'string' && event.model.length > 0 ? event.model : null;
    const provider = event.provider ?? null;
    if (model !== null) this.addModel(model, 'reported', provider);
    // Only real usage moves the run's aggregate; attribution is tracked separately.
    if (!event.attributionOnly) applyCounters(this.aggregate, event);
    if (model !== null || event.attributionOnly) {
      const key = modelKey(model, provider);
      const allocation = this.allocations.get(key) ?? { model, provider, counters: emptyCounters() };
      applyCounters(allocation.counters, event);
      this.allocations.set(key, allocation);
    }
  }

  /**
   * Totals from persisted run fields when present, otherwise from the event
   * aggregate. Allocations are never added on top of the authoritative total.
   */
  totals(persisted: Partial<Counters> = {}): Counters {
    const result = emptyCounters();
    for (const metric of metrics) {
      result[metric] = valid(persisted[metric]) ? persisted[metric]! : this.aggregate[metric];
    }
    return result;
  }

  rows(agent: AgentId, totals: Counters = this.totals()): ModelUsageRow[] {
    const rows = new Map<string, ModelUsageRow>();
    for (const identity of this.identities.values()) {
      rows.set(modelKey(identity.name, identity.provider), {
        agent, model: identity.name, provider: identity.provider, attribution: identity.source,
        runCount: 1, ...emptyCounters(), coverage: { tokenRuns: 0, costRuns: 0, creditRuns: 0, totalRuns: 1 },
      });
    }
    for (const allocation of this.allocations.values()) {
      if (allocation.model === null) continue;
      const key = modelKey(allocation.model, allocation.provider);
      const base = rows.get(key) ?? {
        agent, model: allocation.model, provider: allocation.provider, attribution: 'reported' as const,
        runCount: 1, ...emptyCounters(), coverage: { tokenRuns: 0, costRuns: 0, creditRuns: 0, totalRuns: 1 },
      };
      rows.set(key, { ...base, ...allocation.counters });
    }
    const unknown: ModelUsageRow = {
      agent, model: null, provider: null, attribution: 'unattributed',
      runCount: 1, ...emptyCounters(), coverage: { tokenRuns: 0, costRuns: 0, creditRuns: 0, totalRuns: 1 },
    };
    let residualNeeded = false;
    for (const metric of metrics) {
      const total = totals[metric];
      // Without an authoritative total there is nothing to attribute.
      if (total === null) {
        for (const row of rows.values()) row[metric] = null;
        continue;
      }
      const attributed = sum([...rows.values()].map((row) => row[metric]));
      if (attributed !== null && attributed > total + EPSILON) {
        // Conflicting attribution cannot be rescaled without inventing charges.
        for (const row of rows.values()) row[metric] = null;
        unknown[metric] = total;
        residualNeeded = true;
      } else {
        const residual = total - (attributed ?? 0);
        if (residual > EPSILON) {
          unknown[metric] = residual;
          residualNeeded = true;
        }
      }
    }
    if (residualNeeded) rows.set(modelKey(null, null), unknown);
    for (const row of rows.values()) row.coverage = coverage([row]);
    return [...rows.values()];
  }
}

function coverage(rows: Pick<UsageMetrics, 'inputTokens' | 'outputTokens' | 'costUsd' | 'credits'>[]): UsageMetrics['coverage'] {
  return {
    tokenRuns: rows.filter((row) => row.inputTokens !== null || row.outputTokens !== null).length,
    costRuns: rows.filter((row) => row.costUsd !== null).length,
    creditRuns: rows.filter((row) => row.credits !== null).length, totalRuns: rows.length,
  };
}

export function usageByModel(runs: Pick<RunObservation, 'usageByModel'>[]): ModelUsageRow[] {
  const groups = new Map<string, ModelUsageRow[]>();
  for (const run of runs) for (const row of run.usageByModel) {
    const key = JSON.stringify([row.agent, row.provider, row.model]);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  return [...groups.values()].map((rows) => ({
    ...rows[0]!, runCount: rows.length,
    attribution: rows.some((row) => row.attribution === 'reported') ? 'reported' : rows[0]!.attribution,
    ...Object.fromEntries(metrics.map((metric) => [metric, sum(rows.map((row) => row[metric]))])) as Counters,
    coverage: coverage(rows),
  })).sort((a, b) => a.agent.localeCompare(b.agent) || (a.model ?? '\uffff').localeCompare(b.model ?? '\uffff'));
}

export function usageByTool(runs: RunObservation[]): ToolUsageRow[] {
  const agents = [...new Set(runs.map((run) => run.agent))].sort();
  return agents.map((agent) => {
    const selected = runs.filter((run) => run.agent === agent);
    const models = new Map<string, ModelIdentity>();
    for (const run of selected) for (const model of run.models) models.set(modelKey(model.name, model.provider), model);
    return {
      agent, runCount: selected.length, models: [...models.values()],
      ...Object.fromEntries(metrics.map((metric) => [metric, sum(selected.map((run) => run[metric]))])) as Counters,
      coverage: coverage(selected),
    };
  });
}
