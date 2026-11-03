export type AgentId = 'codex' | 'qodercli' | 'agy' | 'opencode' | 'fake';
export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'timeout' | 'interrupted' | 'taken_over';
export type TaskStatus = RunStatus | 'merged' | 'discarded';
export type ErrorCategory = 'quota' | 'auth' | 'permission' | 'check' | 'agent' | 'system';
export type CommandPolicy = 'ask' | 'check-only' | 'auto';
export type FleetEvent =
  | { kind: 'message'; text: string }
  | { kind: 'command'; cmd: string; exitCode?: number; output?: string }
  | { kind: 'file_edit'; path: string; added?: number; removed?: number }
  | { kind: 'tool'; name: string; detail?: string }
  | { kind: 'usage'; inputTokens?: number; outputTokens?: number; costUsd?: number; credits?: number; reportedCredits?: number; model?: string; provider?: string; usageScope?: 'delta' | 'cumulative'; usageId?: string; billable?: boolean; attributionOnly?: boolean }
  | { kind: 'model'; model: string; source?: 'reported' | 'configured'; provider?: string }
  | { kind: 'session'; id: string }
  | { kind: 'error'; text: string; category?: ErrorCategory }
  | { kind: 'raw'; stream: 'stdout' | 'stderr'; text: string }
  | { kind: 'status'; status: RunStatus; note?: string }
  | { kind: 'check'; cmd: string; passed: boolean; output: string };
export interface StoredEvent { runId: string; seq: number; ts: number; event: FleetEvent }
export interface Plan { id: string; name: string; slug: string; repoPath: string; baseBranch: string; createdAt: number }
export interface Task { id: string; planId: string; title: string; agent: AgentId; status: TaskStatus; branch: string; worktreePath: string; checkCmd: string | null; createdAt: number; finishedAt: number | null }
export interface Run { id: string; taskId: string; attempt: number; agent: AgentId; brief: string; note: string | null; status: RunStatus; pid: number | null; exitCode: number | null; startedAt: number | null; endedAt: number | null; durationMs: number | null; checkPassed: boolean | null; inputTokens: number | null; outputTokens: number | null; costUsd: number | null; finalMessage: string | null; errorCategory: ErrorCategory | null; sessionId: string | null; commandPolicy?: CommandPolicy; allowedCommands?: string[] }
export interface DiffFile { path: string; added: number; removed: number }
export interface TaskResult { task: Task; run: Run | null; files: DiffFile[] }
export type MergeResult = { ok: true } | { ok: false; reason: 'dirty' | 'wrong_branch' | 'conflict' | 'error'; files?: string[]; message?: string };

/**
 * Messages the server pushes over `WS /ws` (Task 8 `Bus`). Shared by server,
 * cli and web so both ends agree on the wire format.
 */
export type BusMsg =
  | { type: 'event'; taskId: string; stored: StoredEvent }
  | { type: 'task'; task: Task }
  | { type: 'run'; run: Run }
  | { type: 'plan'; plan: Plan };
