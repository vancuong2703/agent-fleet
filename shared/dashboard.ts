import type { AgentId } from './types.js';

export type DashboardAgent = Exclude<AgentId, 'fake'>;
export type AccountState = 'authenticated' | 'unauthenticated' | 'unknown';
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
