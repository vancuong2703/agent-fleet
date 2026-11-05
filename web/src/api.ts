import type {
  AgentId,
  DiffFile,
  MergeResult,
  Plan,
  Run,
  StoredEvent,
  Task,
  TaskResult,
  TaskStatus,
} from '../../shared/types.js';
import type { RepositoryValidation } from '../../shared/repository.js';
import type { LeaderGuide } from '../../shared/leader-guide.js';
export type { RepositoryValidation } from '../../shared/repository.js';

/** `GET /api/agents` row. */
export interface AgentInfo {
  id: AgentId;
  ok: boolean;
  version?: string;
  reason?: string;
  maxParallel: number;
}

/** One row of `GET /api/stats`. Mirrors `server/stats.ts` `AgentStats`. */
export interface AgentStats {
  agent: AgentId;
  runs: number;
  successRate: number | null;
  avgDurationMs: number | null;
  retryRate: number | null;
  mergeRate: number | null;
  costUsd: number | null;
}

/** Result of `POST /api/tasks/:id/merge`. */
export type { MergeResult } from '../../shared/types.js';

/** `GET /api/tasks/:id/diff`. */
export interface DiffResult {
  files: DiffFile[];
  patch: string;
}

function query(params: Record<string, string | number | undefined> | undefined): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const serialized = search.toString();
  return serialized.length > 0 ? `?${serialized}` : '';
}

/**
 * HTTP failure that keeps the status and the server's machine-readable `error`
 * code. A `db_corrupt` 503 can come from any route and carries a readable
 * `message`; the screens show it instead of the raw status line.
 */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null, readonly detail: string | null) {
    super(message);
    this.name = 'ApiError';
  }
}

function parseErrorBody(text: string): { code: string | null; message: string | null } {
  try {
    const body = JSON.parse(text) as { error?: unknown; message?: unknown };
    return { code: typeof body.error === 'string' ? body.error : null, message: typeof body.message === 'string' ? body.message : null };
  } catch {
    return { code: null, message: null };
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  const text = await response.text();
  if (!response.ok) {
    const detail = text.trim().length > 0 ? `: ${text}` : '';
    const parsed = response.status === 503 ? parseErrorBody(text) : { code: null, message: null };
    throw new ApiError(`${response.status} ${response.statusText} ${path}${detail}`, response.status, parsed.code, parsed.message);
  }
  return (text.length > 0 ? JSON.parse(text) : undefined) as T;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  };
}

/**
 * Thin typed client for the Task 9 HTTP API. The token travels in the
 * `fleet_token` HttpOnly cookie, so every call is same-origin with credentials
 * and never builds an auth header.
 */
export const api = {
  leaderGuide: (): Promise<LeaderGuide> => request('/api/leader-guide'),
  health: (): Promise<{ ok: boolean }> => request('/api/health'),

  plans: (): Promise<Plan[]> => request('/api/plans'),
  validateRepository: (repoPath: string): Promise<RepositoryValidation> =>
    request('/api/repositories/validate', jsonInit('POST', { repoPath })),
  createPlan: (body: {
    name: string;
    repoPath: string;
    baseBranch?: string;
  }): Promise<Plan> => request('/api/plans', jsonInit('POST', body)),

  tasks: (filter?: { planId?: string; status?: TaskStatus }): Promise<Task[]> =>
    request(`/api/tasks${query(filter)}`),
  createTask: (body: {
    planId: string;
    agent: AgentId;
    title: string;
    brief: string;
    checkCmd?: string;
    commandPolicy?: 'ask' | 'check-only' | 'auto';
    allowedCommands?: string[];
  }): Promise<Task> => request('/api/tasks', jsonInit('POST', body)),
  task: (id: string): Promise<TaskResult> => request(`/api/tasks/${id}`),
  runs: (id: string): Promise<Run[]> => request(`/api/tasks/${id}/runs`),
  /** Every run of every task in one read; older servers answer 404 and the caller falls back to `runs`. */
  allRuns: (): Promise<Run[]> => request('/api/runs'),
  events: (
    runId: string,
    options?: { afterSeq?: number; tail?: number },
  ): Promise<StoredEvent[]> => request(`/api/runs/${runId}/events${query(options)}`),
  diff: (id: string): Promise<DiffResult> => request(`/api/tasks/${id}/diff`),

  wait: (ids: string[], timeoutMs: number): Promise<TaskResult[]> =>
    request('/api/wait', jsonInit('POST', { ids, timeoutMs })),
  retry: (id: string, body: { agent?: AgentId; note: string; commandPolicy?: 'ask' | 'check-only' | 'auto'; allowedCommands?: string[] }): Promise<Run> =>
    request(`/api/tasks/${id}/retry`, jsonInit('POST', body)),
  stop: (id: string): Promise<void> => request(`/api/tasks/${id}/stop`, jsonInit('POST')),
  takeover: (id: string): Promise<void> =>
    request(`/api/tasks/${id}/takeover`, jsonInit('POST')),
  markDone: (id: string): Promise<void> =>
    request(`/api/tasks/${id}/done`, jsonInit('POST')),
  merge: (id: string): Promise<MergeResult> =>
    request(`/api/tasks/${id}/merge`, jsonInit('POST')),
  discard: (id: string): Promise<void> =>
    request(`/api/tasks/${id}/discard`, jsonInit('POST')),

  agents: (): Promise<AgentInfo[]> => request('/api/agents'),
  stats: (filter?: {
    repo?: string;
    sinceDays?: number;
  }): Promise<AgentStats[]> => request(`/api/stats${query(filter)}`),
};

export type Api = typeof api;
