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
import { api, ApiError, type DiffResult, type MergeResult } from './api.js';
import type { IconName } from './components/Icon.js';
import { appStrings } from './strings.js';
import { connectBus } from './ws.js';

// ── state ───────────────────────────────────────────────────────────────────

export interface RunsLoadState {
  loaded: boolean;
  refreshing: boolean;
  error: string | null;
}

export interface FleetState {
  plans: Plan[];
  tasks: Task[];
  runsByTask: Record<string, Run[]>;
  eventsByRun: Record<string, StoredEvent[]>;
  runsLoadState: RunsLoadState;
}

export function initialFleetState(): FleetState {
  return {
    plans: [],
    tasks: [],
    runsByTask: {},
    eventsByRun: {},
    runsLoadState: { loaded: false, refreshing: true, error: null },
  };
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
  const existing = state.eventsByRun[runId] ?? [];
  let ordered: StoredEvent[];
  // Streaming usually appends one monotonically increasing sequence number;
  // avoid sorting thousands of existing rows for every output line.
  if (incoming.length === 1 && (!existing.length || incoming[0]!.seq > existing[existing.length - 1]!.seq)) {
    ordered = [...existing, incoming[0]!].slice(-4_000);
  } else {
    const merged = new Map<number, StoredEvent>();
    for (const event of existing) merged.set(event.seq, event);
    for (const event of incoming) merged.set(event.seq, event);
    ordered = [...merged.values()].sort((a, b) => a.seq - b.seq).slice(-4_000);
  }
  const eventsByRun = { ...state.eventsByRun };
  // Refresh insertion order, keeping at most 30 recently streamed/opened logs.
  delete eventsByRun[runId];
  eventsByRun[runId] = ordered;
  for (const key of Object.keys(eventsByRun).slice(0, -30)) delete eventsByRun[key];
  return { ...state, eventsByRun };
}

// ── selectors ───────────────────────────────────────────────────────────────

export interface TaskCounts {
  running: number;
  waiting: number;
  failed: number;
  done: number;
}

/**
 * Statuses the topbar chips stand for. "Lỗi" covers every run the user has to
 * act on: a failed check, a timeout and an interrupted attempt all need a person.
 */
export const FILTER_STATUSES = {
  running: ['running'],
  waiting: ['queued'],
  failed: ['failed', 'timeout', 'interrupted'],
} as const satisfies Record<string, readonly TaskStatus[]>;

/** `all` is the neutral state: no chip is pressed and the sidebar lists every task. */
export type StatusFilter = 'all' | keyof typeof FILTER_STATUSES;

export function matchesFilter(status: TaskStatus, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  return (FILTER_STATUSES[filter] as readonly TaskStatus[]).includes(status);
}

/** Sidebar rows for one chip; `all` keeps the incoming order. */
export function filterTasks(tasks: Task[], filter: StatusFilter): Task[] {
  return filter === 'all' ? tasks : tasks.filter((task) => matchesFilter(task.status, filter));
}

/** Counts for the top bar: "N đang chạy · N chờ · N lỗi". */
export function taskCounts(tasks: Task[]): TaskCounts {
  let running = 0;
  let waiting = 0;
  let failed = 0;
  let done = 0;
  for (const task of tasks) {
    if (task.status === 'running') running += 1;
    else if (task.status === 'queued') waiting += 1;
    else if ((FILTER_STATUSES.failed as readonly TaskStatus[]).includes(task.status)) failed += 1;
    if (task.status === 'done' || task.status === 'merged') done += 1;
  }
  return { running, waiting, failed, done };
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

/**
 * `buildLogRows` for an events array that only grew at the end. Rows that did
 * not change keep their identity so memoized row components skip rendering; only
 * the open raw group (if any) and the new tail are rebuilt. Anything else (a
 * trimmed head, a replaced log) falls back to a full rebuild.
 */
export function extendLogRows(
  previous: { events: StoredEvent[]; rows: LogRow[] } | null,
  events: StoredEvent[],
): LogRow[] {
  const before = previous?.events;
  const grew = previous !== null && before !== undefined && before.length > 0 && events.length >= before.length
    && events[0] === before[0] && events[before.length - 1] === before[before.length - 1];
  if (!grew || previous === null) return buildLogRows(events);
  if (events.length === before!.length) return previous.rows;
  const rows = previous.rows.slice();
  let restart = before!.length;
  const last = rows[rows.length - 1];
  // A trailing raw group may continue into the new events, so it is rebuilt.
  if (last?.raw) {
    rows.pop();
    restart -= last.events.length;
  }
  return [...rows, ...buildLogRows(events.slice(restart))];
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
      if (event.credits !== undefined) parts.push(`${event.credits.toFixed(3)} credit`);
      return parts.length > 0 ? parts.join(' · ') : 'usage';
    }
    case 'model':
      return `${event.provider ? `${event.provider} / ` : ''}${event.model}${event.source === 'configured' ? ' (cấu hình)' : ''}`;
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

/**
 * Status glyphs are lucide icon names, never Unicode symbols: the old `◐ ○ ⑂ ⏱`
 * characters render unevenly in Segoe UI and carry no accessible name.
 */
const STATUS_META: Record<TaskStatus, { label: string; icon: IconName }> = {
  queued: { label: 'đang chờ', icon: 'status-queued' },
  running: { label: 'đang chạy', icon: 'status-running' },
  done: { label: 'xong', icon: 'status-done' },
  failed: { label: 'lỗi', icon: 'status-failed' },
  timeout: { label: 'quá hạn', icon: 'status-timeout' },
  interrupted: { label: 'bị dừng', icon: 'status-interrupted' },
  taken_over: { label: 'tiếp quản', icon: 'status-taken-over' },
  merged: { label: 'đã merge', icon: 'status-merged' },
  discarded: { label: 'đã huỷ', icon: 'status-discarded' },
};

export function statusLabel(status: TaskStatus): string {
  return STATUS_META[status].label;
}

export function statusIcon(status: TaskStatus): IconName {
  return STATUS_META[status].icon;
}

// ── task actions ────────────────────────────────────────────────────────────

/** Action buttons the detail panel offers for a task status. */
export type TaskAction = 'stop' | 'markDone' | 'merge' | 'discard';

/**
 * Which actions apply to a status:
 * running → Dừng; taken_over → Đánh dấu xong; done/failed/timeout/interrupted
 * → Huỷ; only done offers Merge. Queued/merged/discarded → none.
 */
export function taskActions(status: TaskStatus): TaskAction[] {
  switch (status) {
    case 'running':
      return ['stop'];
    case 'taken_over':
      return ['markDone'];
    case 'done':
      return ['merge', 'discard'];
    case 'failed':
    case 'timeout':
    case 'interrupted':
      return ['discard'];
    default:
      return [];
  }
}

/** Vietnamese message for a rejected merge, including the base branch name. */
export function mergeErrorMessage(result: MergeResult, baseBranch: string): string {
  if (result.ok) return '';
  switch (result.reason) {
    case 'error':
      return `Merge lỗi: ${result.message ?? ''}`;
    case 'dirty':
      return 'Repo gốc còn thay đổi chưa commit';
    case 'wrong_branch':
      return `Repo gốc không ở nhánh ${baseBranch}`;
    case 'conflict': {
      const files = result.files ?? [];
      return files.length > 0 ? `Xung đột: ${files.join(', ')}` : 'Xung đột';
    }
  }
}

// ── load state ──────────────────────────────────────────────────────────────

/**
 * Whether one async read finished, and why it failed. A screen must tell the
 * three states apart: loading shows a skeleton, an error shows a banner with a
 * retry button, and only a finished read may show the empty copy.
 */
export interface LoadState {
  loaded: boolean;
  error: string | null;
}

export const NOT_LOADED: LoadState = { loaded: false, error: null };
export const LOADED: LoadState = { loaded: true, error: null };

export function loadError(cause: unknown): LoadState {
  return { loaded: false, error: cause instanceof Error ? cause.message : String(cause) };
}

/**
 * "Thay đổi (n)" only once the patch was read. While the read is in flight the
 * tab must not claim "Thay đổi (0)", which reads as "no changes".
 */
export function diffBadgeLabel(loaded: boolean, fileCount: number): string {
  return appStrings.diffBadge(loaded, fileCount);
}

/** Keep per-run load bookkeeping bounded like the event buffers themselves. */
export function withLoadState(
  states: Record<string, LoadState>,
  key: string,
  next: LoadState,
): Record<string, LoadState> {
  // Re-insert the key so the newest entry is last and the cap drops old runs.
  const merged: Record<string, LoadState> = { ...states };
  delete merged[key];
  merged[key] = next;
  for (const stale of Object.keys(merged).slice(0, Math.max(0, Object.keys(merged).length - 30))) {
    delete merged[stale];
  }
  return merged;
}

/** Why a read failed: the readable message and, for known server faults, a code. */
export interface LoadFailure {
  message: string;
  code: string | null;
}

/**
 * Message for a failed read. A `db_corrupt` 503 carries its own readable
 * `message`; that is shown instead of the raw status line. Anything else keeps
 * `Error.message` (never `String(cause)`, which renders as "Error: …").
 */
export function describeFailure(cause: unknown): LoadFailure {
  if (cause instanceof ApiError && cause.code === 'db_corrupt') {
    return { message: cause.detail ?? cause.message, code: 'db_corrupt' };
  }
  return { message: cause instanceof Error ? cause.message : String(cause), code: null };
}

export interface RunsLoad {
  runs: Run[];
  /** Per-task failures; a task listed here must show a warning and a retry. */
  errors: Record<string, string>;
  /** A fault shared by every task (database corruption); per-task retries cannot help. */
  fatal: LoadFailure | null;
}

/**
 * Load run history for a task list. One `GET /api/runs` covers everything; when
 * it is missing or fails, fall back to one request per task and record each
 * failure under its task so one bad task cannot blank the whole list.
 */
export async function loadRuns(
  tasks: readonly Pick<Task, 'id'>[],
  source: { allRuns: () => Promise<Run[]>; runs: (taskId: string) => Promise<Run[]> },
): Promise<RunsLoad> {
  if (tasks.length === 0) return { runs: [], errors: {}, fatal: null };
  try {
    return { runs: await source.allRuns(), errors: {}, fatal: null };
  } catch (cause) {
    const failure = describeFailure(cause);
    if (failure.code === 'db_corrupt') return { runs: [], errors: {}, fatal: failure };
  }
  const settled = await Promise.allSettled(tasks.map((task) => source.runs(task.id)));
  const runs: Run[] = [];
  const errors: Record<string, string> = {};
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') runs.push(...result.value);
    else errors[tasks[index]!.id] = describeFailure(result.reason).message;
  });
  return { runs, errors, fatal: null };
}

// ── hook ────────────────────────────────────────────────────────────────────

export interface FleetStore {
  state: FleetState;
  connected: boolean;
  error: string | null;
  /** Server fault code behind `error` (for example `db_corrupt`), when it has one. */
  errorCode: string | null;
  /** True once the task list was read; run history may still be loading or failed. */
  tasksLoaded: boolean;
  /** Tasks whose run history could not be read, with the reason. */
  runErrors: Record<string, string>;
  /** Runs load state shortcut. */
  runsLoadState?: RunsLoadState;
  /** Re-read the run history of one task only or all runs. */
  retryRuns: (taskId?: string) => Promise<void> | void;
  /** Load state of one run's log; a task without runs is "nothing to load". */
  logState: (runId: string | null) => LoadState;
  /** Re-run the initial GET sweep (plans, tasks, runs). */
  reload: () => void;
  refresh?: () => Promise<void>;
  bootstrap?: () => Promise<void>;
  /** Fetch a run's stored events once; `retry` bypasses the loaded bookmark. */
  loadEvents: (runId: string, retry?: boolean) => void;
}

export class FleetStoreClass implements FleetStore {
  state: FleetState;
  connected = false;
  error: string | null = null;
  errorCode: string | null = null;
  tasksLoaded = false;
  runErrors: Record<string, string> = {};
  logStates: Record<string, LoadState> = {};

  hydrating = false;
  pendingFrames: BusMsg[] = [];

  private listeners = new Set<() => void>();
  private api: any;
  private loadedRuns = new Set<string>();
  private loadingRuns = new Set<string>();

  constructor(options?: { api?: any }) {
    this.state = initialFleetState();
    this.api = options?.api ?? api;
    this.logState = this.logState.bind(this);
    this.loadEvents = this.loadEvents.bind(this);
    this.retryRuns = this.retryRuns.bind(this);
    this.reload = this.reload.bind(this);
    this.bootstrap = this.bootstrap.bind(this);
  }

  get runsLoadState(): RunsLoadState {
    return this.state.runsLoadState;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (err) {
        console.error(err);
      }
    }
  }

  mergePlan(plan: Plan): void {
    this.state = reduceFleet(this.state, { type: 'plan', plan });
  }

  mergeTask(task: Task): void {
    this.state = reduceFleet(this.state, { type: 'task', task });
  }

  mergeRun(run: Run): void {
    this.state = reduceFleet(this.state, { type: 'run', run });
  }

  flushFrame(frame: BusMsg): void {
    this.state = reduceFleet(this.state, frame);
  }

  handleMessage(message: BusMsg): void {
    if (this.hydrating) {
      this.pendingFrames.push(message);
    }
    this.state = reduceFleet(this.state, message);
    this.emit();
  }

  async bootstrap(): Promise<void> {
    if (this.hydrating) return;
    this.hydrating = true;
    this.pendingFrames = [];

    this.state = {
      ...this.state,
      runsLoadState: {
        loaded: this.state.runsLoadState.loaded,
        refreshing: true,
        error: null,
      },
    };
    this.emit();

    const fetchPlans = this.api.listPlans ? () => this.api.listPlans() : this.api.plans ? () => this.api.plans() : () => Promise.resolve([]);
    const fetchTasks = this.api.listTasks ? () => this.api.listTasks() : this.api.tasks ? () => this.api.tasks() : () => Promise.resolve([]);
    const fetchRuns = this.api.listRuns ? () => this.api.listRuns() : null;

    try {
      const [plansRes, tasksRes, runsRes] = await Promise.allSettled([
        fetchPlans(),
        fetchTasks(),
        fetchRuns ? fetchRuns() : Promise.reject(new Error('no direct runs method')),
      ]);

      let sweepFailed = false;
      if (plansRes.status === 'fulfilled') {
        for (const plan of plansRes.value) {
          this.mergePlan(plan);
        }
      } else {
        sweepFailed = true;
        const failure = describeFailure(plansRes.reason);
        this.error = failure.message;
        this.errorCode = failure.code;
      }

      let loadedTasks: Task[] = [];
      if (tasksRes.status === 'fulfilled') {
        loadedTasks = tasksRes.value;
        for (const task of loadedTasks) {
          this.mergeTask(task);
        }
      } else {
        sweepFailed = true;
        const failure = describeFailure(tasksRes.reason);
        this.error = failure.message;
        this.errorCode = failure.code;
      }

      if (!sweepFailed) {
        this.error = null;
        this.errorCode = null;
        this.tasksLoaded = true;
        const earlyPending = this.pendingFrames.slice();
        for (const frame of earlyPending) {
          this.flushFrame(frame);
        }
        this.emit();
      }

      if (runsRes.status === 'fulfilled') {
        for (const run of runsRes.value) {
          this.mergeRun(run);
        }
        this.state = {
          ...this.state,
          runsLoadState: { loaded: true, refreshing: false, error: null },
        };
      } else {
        // Fallback to loadRuns if direct runs failed and api.runs exists
        if (typeof this.api.runs === 'function' && !this.api.listRuns) {
          try {
            const history = await loadRuns(loadedTasks, this.api);
            for (const run of history.runs) {
              this.mergeRun(run);
            }
            this.runErrors = history.errors;
            if (history.fatal) {
              this.error = history.fatal.message;
              this.errorCode = history.fatal.code;
              this.state = {
                ...this.state,
                runsLoadState: { loaded: false, refreshing: false, error: history.fatal.message },
              };
            } else {
              this.state = {
                ...this.state,
                runsLoadState: { loaded: true, refreshing: false, error: null },
              };
            }
          } catch (cause) {
            const failure = describeFailure(cause);
            this.error = failure.message;
            this.errorCode = failure.code;
            this.state = {
              ...this.state,
              runsLoadState: { loaded: false, refreshing: false, error: failure.message },
            };
          }
        } else {
          const failure = describeFailure(runsRes.reason);
          this.error = failure.message;
          this.errorCode = failure.code;
          this.state = {
            ...this.state,
            runsLoadState: { loaded: false, refreshing: false, error: failure.message },
          };
        }
      }

      // Replay pending frames buffered during hydration
      const pending = this.pendingFrames.slice();
      this.pendingFrames = [];
      for (const frame of pending) {
        this.flushFrame(frame);
      }

      await Promise.all([...this.loadedRuns].map((runId) => this.fetchEvents(runId, true)));
    } finally {
      this.hydrating = false;
      this.emit();
    }
  }

  async retryRuns(taskId?: string): Promise<void> {
    if (taskId) {
      try {
        const runs = await this.api.runs(taskId);
        for (const run of runs) {
          this.mergeRun(run);
        }
        const nextErrors = { ...this.runErrors };
        delete nextErrors[taskId];
        this.runErrors = nextErrors;
        this.emit();
      } catch (cause) {
        this.runErrors = { ...this.runErrors, [taskId]: describeFailure(cause).message };
        this.emit();
      }
    } else {
      this.state = {
        ...this.state,
        runsLoadState: { loaded: this.state.runsLoadState.loaded, refreshing: true, error: null },
      };
      this.emit();
      try {
        if (this.api.listRuns) {
          const runs = await this.api.listRuns();
          for (const run of runs) {
            this.mergeRun(run);
          }
          this.state = {
            ...this.state,
            runsLoadState: { loaded: true, refreshing: false, error: null },
          };
        } else {
          const history = await loadRuns(this.state.tasks, this.api);
          for (const run of history.runs) {
            this.mergeRun(run);
          }
          this.runErrors = history.errors;
          if (history.fatal) {
            this.error = history.fatal.message;
            this.errorCode = history.fatal.code;
            this.state = {
              ...this.state,
              runsLoadState: { loaded: false, refreshing: false, error: history.fatal.message },
            };
          } else {
            this.state = {
              ...this.state,
              runsLoadState: { loaded: true, refreshing: false, error: null },
            };
          }
        }
      } catch (cause) {
        const failure = describeFailure(cause);
        this.error = failure.message;
        this.state = {
          ...this.state,
          runsLoadState: { loaded: false, refreshing: false, error: failure.message },
        };
      } finally {
        this.emit();
      }
    }
  }

  refresh(): Promise<void> {
    return this.bootstrap();
  }

  reload(): void {
    void this.bootstrap();
  }

  async fetchEvents(runId: string, catchUp = false, retry = false): Promise<void> {
    if (this.loadingRuns.has(runId)) return;
    const existing = this.state.eventsByRun[runId];
    if (!catchUp && !retry && this.loadedRuns.has(runId) && existing) return;
    this.loadingRuns.add(runId);
    try {
      const afterSeq = catchUp && existing?.length ? existing[existing.length - 1]!.seq : undefined;
      const events = await this.api.events(runId, afterSeq === undefined ? { tail: 4_000 } : { afterSeq, tail: 4_000 });
      this.loadedRuns.add(runId);
      for (const key of [...this.loadedRuns].slice(0, -30)) this.loadedRuns.delete(key);
      this.state = addEvents(this.state, runId, events);
      this.logStates = withLoadState(this.logStates, runId, LOADED);
      this.emit();
    } catch (cause) {
      this.loadedRuns.delete(runId);
      this.logStates = withLoadState(this.logStates, runId, loadError(cause));
      this.emit();
    } finally {
      this.loadingRuns.delete(runId);
    }
  }

  loadEvents(runId: string, retry = false): void {
    if (retry) {
      this.loadedRuns.delete(runId);
      this.logStates = withLoadState(this.logStates, runId, NOT_LOADED);
      this.emit();
    }
    void this.fetchEvents(runId, false, retry);
  }

  logState(runId: string | null): LoadState {
    return runId === null ? LOADED : this.logStates[runId] ?? NOT_LOADED;
  }
}

export const FleetStore = FleetStoreClass;

/**
 * Live fleet store: an initial GET sweep seeds plans/tasks/runs, then every
 * `BusMsg` from `WS /ws` is reduced into the same state. Event logs load lazily
 * per run via `loadEvents` and stream in afterwards. A failed log read is kept
 * as an error instead of being swallowed, so the log can offer a retry.
 */
export function useFleet(apiClient = api): FleetStore {
  const storeRef = useRef<FleetStoreClass | null>(null);
  if (!storeRef.current) {
    storeRef.current = new FleetStoreClass({ api: apiClient });
  }
  const store = storeRef.current;
  const [, setTick] = useState(0);

  useEffect(() => {
    let mounted = true;
    const unsub = store.subscribe(() => {
      if (mounted) setTick((v) => v + 1);
    });

    const closeBus = connectBus({
      onMessage: (message) => store.handleMessage(message),
      onOpen: () => {
        store.connected = true;
        store.emit();
        void store.bootstrap();
      },
      onClose: () => {
        store.connected = false;
        store.emit();
      },
    });

    void store.bootstrap();

    const refreshVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'hidden') {
        void store.bootstrap();
      }
    };
    const timer = typeof window !== 'undefined' ? window.setInterval(refreshVisible, 15_000) : undefined;
    if (typeof window !== 'undefined') {
      window.addEventListener('focus', refreshVisible);
      document.addEventListener('visibilitychange', refreshVisible);
    }

    return () => {
      mounted = false;
      unsub();
      closeBus();
      if (timer !== undefined) window.clearInterval(timer);
      if (typeof window !== 'undefined') {
        window.removeEventListener('focus', refreshVisible);
        document.removeEventListener('visibilitychange', refreshVisible);
      }
    };
  }, [store]);

  return store;
}

/**
 * The worktree patch of one task. Kept in the store so the Diff tab can tell
 * loading, an error with a retry, and a real "no changes" apart.
 */
export interface TaskDiff {
  diff: DiffResult | null;
  loaded: boolean;
  error: string | null;
  reload: () => void;
}

interface DiffEntry {
  taskId: string | null;
  diff: DiffResult | null;
  loaded: boolean;
  error: string | null;
}

const EMPTY_DIFF: Omit<DiffEntry, 'taskId'> = { diff: null, loaded: false, error: null };

/**
 * Read `/api/tasks/:id/diff` for the selected task. Every read runs git on the
 * server, so the patch is fetched once when a task is selected (the tab count
 * needs it) and re-fetched when its status changes. It only keeps polling
 * every few seconds while the task is live AND the Changes tab is open
 * (`active`). `reload` retries a failed read immediately.
 */
export function useTaskDiff(taskId: string | null, status: TaskStatus | null, active: boolean): TaskDiff {
  const [entry, setEntry] = useState<DiffEntry>({ taskId: null, ...EMPTY_DIFF });
  const [attempt, setAttempt] = useState(0);
  // The render of a newly selected task must not expose the previous patch.
  const current: DiffEntry = entry.taskId === taskId ? entry : { taskId, ...EMPTY_DIFF };
  const live = status === 'running' || status === 'taken_over';
  const polling = active && live;

  const read = useCallback(async (id: string, cancelled: () => boolean): Promise<void> => {
    try {
      const result = await api.diff(id);
      if (!cancelled()) setEntry({ taskId: id, diff: result, loaded: true, error: null });
    } catch (cause) {
      if (!cancelled()) setEntry({ taskId: id, diff: null, ...loadError(cause) });
    }
  }, []);

  // One read per selection / status change / retry, whichever tab is open.
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    void read(taskId, () => cancelled);
    return () => { cancelled = true; };
  }, [taskId, status, attempt, read]);

  // The poll runs only for a live task on the Changes tab; it starts after one interval.
  useEffect(() => {
    if (!taskId || !polling) return;
    let cancelled = false;
    let timer: number | undefined;
    const tick = (): void => {
      timer = window.setTimeout(async () => {
        await read(taskId, () => cancelled);
        if (!cancelled) tick();
      }, document.hidden ? 10_000 : 3_000);
    };
    tick();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [taskId, polling, attempt, read]);

  const reload = useCallback(() => {
    setEntry({ taskId, ...EMPTY_DIFF });
    setAttempt((value) => value + 1);
  }, [taskId]);

  return { diff: current.diff, loaded: current.loaded, error: current.error, reload };
}

