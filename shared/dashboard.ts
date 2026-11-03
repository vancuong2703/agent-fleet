import type { AgentId } from './types.js';

export type DashboardAgent = Exclude<AgentId, 'fake'>;
export type AccountState = 'authenticated' | 'unauthenticated' | 'unknown';
export type Tier = 'free' | 'trial' | 'plus' | 'pro' | 'team' | 'byok' | 'unknown';
export interface PlanInfo { name: string; tier: Tier; renewsAt?: string | null; source: string }
export interface CurrentModel { id: string; label: string; effort?: string | null }
export interface ModelOffer {
  id: string; label: string; provider?: string | null;
  /** Explicit CLI/catalog price; null means unknown, zero means free. */
  multiplier: number | null;
  originalMultiplier?: number | null;
  promo?: string | null;
  contextTokens?: number | null;
  source: 'cli' | 'pty' | 'catalog' | 'config';
}
export interface QuotaWindow {
  group: string; window: '5h' | 'day' | 'week' | 'month' | 'plan';
  remainingPct: number | null; used?: number | null; limit?: number | null;
  unit: 'tokens' | 'credits' | 'requests' | 'percent'; resetAt?: string | null;
}
export interface KeyPool {
  name: string; total: number; ok: number; exhausted: number;
  remainingPct: number | null; limitLabel: string; resetAt?: string | null;
  /** Labels contain only masked key names, never key values. */
  keys: { label: string; status: 'ok' | 'low' | 'out'; pct: number | null }[];
}
export interface DashboardCommand {
  id: string;
  label: string;
  command: string;
  context: 'shell' | 'interactive';
  description: string;
}
export interface DashboardBalance {
  remaining: number | null;
  unit: 'tokens' | 'credits' | 'requests' | 'percent' | null;
  resetAt: string | null;
  source: string;
  reason: string | null;
}
export interface DashboardCheck {
  checkedAt: number;
  status: 'ready' | 'needs-login' | 'unavailable' | 'unknown' | 'error';
  version: string | null;
  account: { state: AccountState; label: string | null; source: string; reason: string | null };
  quota: DashboardBalance;
  credits: DashboardBalance;
  details?: { label: string; value: string }[];
  quotas?: { group: string; window: string; remaining: number; reset: string | null }[];
  plan?: PlanInfo;
  currentModel?: CurrentModel;
  models?: ModelOffer[];
  quotaWindows?: QuotaWindow[];
  keyPools?: KeyPool[];
  highlights?: string[];
  probes: { command: string; ok: boolean; exitCode: number | null; summary: string; output?: string }[];
}
export interface DashboardTool {
  agent: DashboardAgent;
  title: string;
  configuredBin: string | null;
  installed: boolean;
  lastCheck: DashboardCheck | null;
  suggestions: DashboardCommand[];
}
export interface TerminalSessionInfo {
  id: string;
  agent: DashboardAgent;
  title: string;
  cwd: string;
  source: 'workspace' | 'plan' | 'task';
  planId: string | null;
  taskId: string | null;
  createdAt: number;
  connected: boolean;
  reconnectGraceMs: number;
}
export interface DashboardSnapshot {
  generatedAt: number;
  tools: DashboardTool[];
  terminalSessions: TerminalSessionInfo[];
}
