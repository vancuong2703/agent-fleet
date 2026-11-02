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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { credentials: 'same-origin', ...init });
  const text = await response.text();
  if (!response.ok) {
    const detail = text.trim().length > 0 ? `: ${text}` : '';
    throw new Error(`${response.status} ${response.statusText} ${path}${detail}`);
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
  health: (): Promise<{ ok: boolean }> => request('/api/health'),

  plans: (): Promise<Plan[]> => request('/api/plans'),
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
  }): Promise<Task> => request('/api/tasks', jsonInit('POST', body)),
  task: (id: string): Promise<TaskResult> => request(`/api/tasks/${id}`),
  runs: (id: string): Promise<Run[]> => request(`/api/tasks/${id}/runs`),
  events: (
    runId: string,
    options?: { afterSeq?: number; tail?: number },
  ): Promise<StoredEvent[]> => request(`/api/runs/${runId}/events${query(options)}`),
  diff: (id: string): Promise<DiffResult> => request(`/api/tasks/${id}/diff`),

  wait: (ids: string[], timeoutMs: number): Promise<TaskResult[]> =>
    request('/api/wait', jsonInit('POST', { ids, timeoutMs })),
  retry: (id: string, body: { agent?: AgentId; note: string }): Promise<Run> =>
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
