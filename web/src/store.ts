import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  BusMsg,
  FleetEvent,
  Plan,
  Run,
  StoredEvent,
  Task,
  TaskStatus,
} from '../../shared/types.js';
import { api } from './api.js';
import { connectBus } from './ws.js';

// ── state ───────────────────────────────────────────────────────────────────

export interface FleetState {
  plans: Plan[];
  tasks: Task[];
  runsByTask: Record<string, Run[]>;
  eventsByRun: Record<string, StoredEvent[]>;
}

export function initialFleetState(): FleetState {
  return { plans: [], tasks: [], runsByTask: {}, eventsByRun: {} };
}

function upsert<T extends { id: string }>(list: T[], item: T): T[] {
  const index = list.findIndex((entry) => entry.id === item.id);
  if (index === -1) return [...list, item];
  const next = list.slice();
  next[index] = item;
  return next;
}

function sortRuns(runs: Run[]): Run[] {
  return runs
    .slice()
    .sort((a, b) => a.attempt - b.attempt || a.id.localeCompare(b.id));
}

/**
 * Pure reducer behind `useFleet`. Every server push is applied here so the
 * stream and the initial GET converge on the same shape.
 */
export function reduceFleet(state: FleetState, message: BusMsg): FleetState {
  switch (message.type) {
    case 'plan':
      return { ...state, plans: upsert(state.plans, message.plan) };
    case 'task':
      return { ...state, tasks: upsert(state.tasks, message.task) };
    case 'run': {
      const existing = state.runsByTask[message.run.taskId] ?? [];
      const runs = sortRuns(upsert(existing, message.run));
      return { ...state, runsByTask: { ...state.runsByTask, [message.run.taskId]: runs } };
    }
    case 'event':
      return addEvents(state, message.stored.runId, [message.stored]);
  }
}

/** Merge events into a run's log, deduplicated and ordered by `seq`. */
export function addEvents(
  state: FleetState,
  runId: string,
  incoming: StoredEvent[],
): FleetState {
  const merged = new Map<number, StoredEvent>();
  for (const event of state.eventsByRun[runId] ?? []) merged.set(event.seq, event);
  for (const event of incoming) merged.set(event.seq, event);
  const ordered = [...merged.values()].sort((a, b) => a.seq - b.seq);
  return { ...state, eventsByRun: { ...state.eventsByRun, [runId]: ordered } };
}

// ── selectors ───────────────────────────────────────────────────────────────

export interface TaskCounts {
  running: number;
  waiting: number;
  done: number;
}

/** Counts for the top bar: "N đang chạy · N chờ · N xong". */
export function taskCounts(tasks: Task[]): TaskCounts {
  let running = 0;
  let waiting = 0;
  let done = 0;
  for (const task of tasks) {
    if (task.status === 'running') running += 1;
    else if (task.status === 'queued') waiting += 1;
    else if (task.status === 'done' || task.status === 'merged') done += 1;
  }
  return { running, waiting, done };
}

export interface Progress {
  done: number;
  total: number;
}

/** A task counts as finished once it is `done` or `merged`. */
export function taskProgress(tasks: Task[]): Progress {
  let done = 0;
  for (const task of tasks) {
    if (task.status === 'done' || task.status === 'merged') done += 1;
  }
  return { done, total: tasks.length };
}

export interface PlanGroup {
  plan: Plan;
  tasks: Task[];
  done: number;
  total: number;
}

export interface RepoGroup {
  repoPath: string;
  name: string;
  plans: PlanGroup[];
}

/** Last path segment of a Windows or POSIX path, without importing `node:path`. */
export function repoName(repoPath: string): string {
  const parts = repoPath.split(/[\\/]/).filter((part) => part.length > 0);
  return parts[parts.length - 1] ?? repoPath;
}

/** Sidebar model: plans grouped by repo, tasks grouped by plan, oldest first. */
export function groupByRepo(plans: Plan[], tasks: Task[]): RepoGroup[] {
  const groups = new Map<string, RepoGroup>();
  for (const plan of [...plans].sort((a, b) => a.createdAt - b.createdAt)) {
    const group = groups.get(plan.repoPath) ?? {
      repoPath: plan.repoPath,
      name: repoName(plan.repoPath),
      plans: [],
    };
    const planTasks = tasks
      .filter((task) => task.planId === plan.id)
      .sort((a, b) => a.createdAt - b.createdAt);
    group.plans.push({ plan, tasks: planTasks, ...taskProgress(planTasks) });
    groups.set(plan.repoPath, group);
  }
  return [...groups.values()].sort((a, b) => a.repoPath.localeCompare(b.repoPath));
}

// ── formatting ──────────────────────────────────────────────────────────────

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** Log line timestamp: `HH:MM:SS` in the browser's local time. */
export function formatClock(ts: number): string {
  const date = new Date(ts);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

/** Compact duration: `12s`, `4m 05s`, `1h 30m`. */
export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return `${minutes}m ${pad2(seconds)}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${pad2(minutes % 60)}m`;
}

/** Milliseconds a run has been (or was) running, given a `now`. */
export function runElapsed(run: Run, now: number): number | null {
  if (run.startedAt !== null) return Math.max(0, (run.endedAt ?? now) - run.startedAt);
  if (run.durationMs !== null) return run.durationMs;
  return null;
}

// ── log rendering ───────────────────────────────────────────────────────────

export interface LogRow {
  id: string;
  raw: boolean;
  events: StoredEvent[];
}

/**
 * Build the log rows: every normal event is one row, and each run of
 * consecutive `raw` events collapses into a single toggleable row.
 */
export function buildLogRows(events: StoredEvent[]): LogRow[] {
  const rows: LogRow[] = [];
  let raw: StoredEvent[] = [];

  const flushRaw = (): void => {
    if (raw.length === 0) return;
    const first = raw[0]!;
    const last = raw[raw.length - 1]!;
    rows.push({ id: `raw-${first.runId}-${first.seq}-${last.seq}`, raw: true, events: raw });
    raw = [];
  };

  for (const stored of events) {
    if (stored.event.kind === 'raw') {
      raw.push(stored);
    } else {
      flushRaw();
      rows.push({ id: `e-${stored.runId}-${stored.seq}`, raw: false, events: [stored] });
    }
  }
  flushRaw();
  return rows;
}

/** One-line summary of an event for the log's text column. */
export function eventText(event: FleetEvent): string {
  switch (event.kind) {
    case 'message':
      return event.text;
    case 'command':
      return event.exitCode === undefined ? event.cmd : `${event.cmd} (exit ${event.exitCode})`;
    case 'file_edit': {
      const stat: string[] = [];
      if (event.added !== undefined) stat.push(`+${event.added}`);
      if (event.removed !== undefined) stat.push(`-${event.removed}`);
      return stat.length > 0 ? `${event.path} ${stat.join(' ')}` : event.path;
    }
    case 'tool':
      return event.detail ? `${event.name} ${event.detail}` : event.name;
    case 'usage': {
      const parts: string[] = [];
      if (event.inputTokens !== undefined) parts.push(`in ${event.inputTokens}`);
      if (event.outputTokens !== undefined) parts.push(`out ${event.outputTokens}`);
      if (event.costUsd !== undefined) parts.push(`$${event.costUsd.toFixed(4)}`);
      return parts.length > 0 ? parts.join(' · ') : 'usage';
    }
    case 'session':
      return event.id;
    case 'error':
      return event.category ? `[${event.category}] ${event.text}` : event.text;
    case 'raw':
      return event.text;
    case 'status':
      return event.note ? `${event.status} — ${event.note}` : event.status;
    case 'check':
      return `${event.cmd} ${event.passed ? '✓' : '✗'}`;
  }
}

// ── status display ──────────────────────────────────────────────────────────

const STATUS_META: Record<TaskStatus, { label: string; icon: string }> = {
  queued: { label: 'đang chờ', icon: '○' },
  running: { label: 'đang chạy', icon: '◐' },
  done: { label: 'xong', icon: '✓' },
  failed: { label: 'lỗi', icon: '✗' },
  timeout: { label: 'quá hạn', icon: '⏱' },
  interrupted: { label: 'bị dừng', icon: '■' },
  taken_over: { label: 'tiếp quản', icon: '⌨' },
  merged: { label: 'đã merge', icon: '⑂' },
  discarded: { label: 'đã huỷ', icon: '✕' },
};

export function statusLabel(status: TaskStatus): string {
  return STATUS_META[status].label;
}

export function statusIcon(status: TaskStatus): string {
  return STATUS_META[status].icon;
}

// ── hook ────────────────────────────────────────────────────────────────────

export interface FleetStore {
  state: FleetState;
  connected: boolean;
  error: string | null;
  /** Re-run the initial GET sweep (plans, tasks, runs). */
  reload: () => void;
  /** Fetch a run's stored events once; safe to call repeatedly. */
  loadEvents: (runId: string) => void;
}

/**
 * Live fleet store: an initial GET sweep seeds plans/tasks/runs, then every
 * `BusMsg` from `WS /ws` is reduced into the same state. Event logs load lazily
 * per run via `loadEvents` and stream in afterwards.
 */
export function useFleet(): FleetStore {
  const [state, setState] = useState<FleetState>(initialFleetState);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hydrate = useCallback(() => {
    void (async () => {
      try {
        const plans = await api.plans();
        const tasks = await api.tasks();
        const runLists = await Promise.all(
          tasks.map((task) => api.runs(task.id).catch(() => [] as Run[])),
        );
        setState((current) => {
          let next = current;
          for (const plan of plans) next = reduceFleet(next, { type: 'plan', plan });
          for (const task of tasks) next = reduceFleet(next, { type: 'task', task });
          for (const runs of runLists) {
            for (const run of runs) next = reduceFleet(next, { type: 'run', run });
          }
          return next;
        });
        setError(null);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, []);

  useEffect(() => {
    hydrate();
    const close = connectBus({
      onMessage: (message) => setState((current) => reduceFleet(current, message)),
      onOpen: () => setConnected(true),
      onClose: () => setConnected(false),
    });
    return close;
  }, [hydrate]);

  const loadedRuns = useRef<Set<string>>(new Set());
  const loadEvents = useCallback((runId: string) => {
    if (loadedRuns.current.has(runId)) return;
    loadedRuns.current.add(runId);
    void api
      .events(runId)
      .then((events) => setState((current) => addEvents(current, runId, events)))
      .catch(() => {
        // Allow a retry on the next selection; the WS stream still fills in live.
        loadedRuns.current.delete(runId);
      });
  }, []);

  return { state, connected, error, reload: hydrate, loadEvents };
}
