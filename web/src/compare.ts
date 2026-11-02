import type { AgentId, Plan } from '../../shared/types.js';
import type { AgentInfo, AgentStats } from './api.js';

/** Placeholder for a value the stats endpoint has no data for. */
export const EMPTY_VALUE = '—';

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** A 0..1 rate as a whole percent: `0.83` → `83%`; null → `—`. */
export function formatRate(value: number | null): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  return `${Math.round(value * 100)}%`;
}

/** Average duration: `45s`, `4m12s`, `1h03m`; null → `—`. */
export function formatDurationMs(value: number | null): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  const totalSeconds = Math.max(0, Math.floor(value / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m${pad2(seconds)}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h${pad2(minutes % 60)}m`;
}

/** Total cost in USD with two decimals: `$0.05`; null → `—`. */
export function formatCostUsd(value: number | null): string {
  if (value === null || value === undefined) return EMPTY_VALUE;
  return `$${value.toFixed(2)}`;
}

/** One table row: an agent from `/api/agents` plus its stats, if any. */
export interface CompareRow {
  agent: AgentId;
  ok: boolean;
  version?: string;
  reason?: string;
  stats: AgentStats | null;
}

/**
 * Build the comparison table: one row per agent reported by `/api/agents`,
 * newest stats attached by agent id. Agents the stats endpoint does not know
 * keep `stats: null` so every metric renders as `—`. Stats for agents that the
 * server does not list are ignored.
 */
export function buildCompareRows(agents: AgentInfo[], stats: AgentStats[]): CompareRow[] {
  const statsByAgent = new Map<AgentId, AgentStats>();
  for (const entry of stats) statsByAgent.set(entry.agent, entry);

  return agents.map((agent) => ({
    agent: agent.id,
    ok: agent.ok,
    ...(agent.version !== undefined ? { version: agent.version } : {}),
    ...(agent.reason !== undefined ? { reason: agent.reason } : {}),
    stats: statsByAgent.get(agent.id) ?? null,
  }));
}

/** Distinct repo paths from the plans, sorted, for the repo filter. */
export function repoOptions(plans: Plan[]): string[] {
  return [...new Set(plans.map((plan) => plan.repoPath))].sort((a, b) => a.localeCompare(b));
}