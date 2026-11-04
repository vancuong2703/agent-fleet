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
import { api, type DiffResult, type MergeResult } from './api.js';
import type { IconName } from './components/Icon.js';
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
 * "Diff (n)" only once the patch was read. While the read is in flight the tab
 * must not claim `Diff (0)`, which reads as "no changes". The Vietnamese label
 * for this tab belongs to the shared glossary pass, so keep "Diff" here.
 */
export function diffBadgeLabel(loaded: boolean, fileCount: number): string {
  return loaded ? `Diff (${fileCount})` : 'Diff';
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

// ── hook ────────────────────────────────────────────────────────────────────

export interface FleetStore {
  state: FleetState;
  connected: boolean;
  error: string | null;
  /** True once the initial plans/tasks sweep succeeded. */
  tasksLoaded: boolean;
  /** Load state of one run's log; a task without runs is "nothing to load". */
  logState: (runId: string | null) => LoadState;
  /** Re-run the initial GET sweep (plans, tasks, runs). */
  reload: () => void;
  /** Fetch a run's stored events once; `retry` bypasses the loaded bookmark. */
  loadEvents: (runId: string, retry?: boolean) => void;
}

/**
 * Live fleet store: an initial GET sweep seeds plans/tasks/runs, then every
 * `BusMsg` from `WS /ws` is reduced into the same state. Event logs load lazily
 * per run via `loadEvents` and stream in afterwards. A failed log read is kept
 * as an error instead of being swallowed, so the log can offer a retry.
 */
export function useFleet(): FleetStore {
  const [state, setState] = useState<FleetState>(initialFleetState);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tasksLoaded, setTasksLoaded] = useState(false);
  const [logStates, setLogStates] = useState<Record<string, LoadState>>({});
  const stateRef = useRef(state);
  stateRef.current = state;
  const mounted = useRef(true);
  const loadedRuns = useRef<Set<string>>(new Set());
  const loadingRuns = useRef<Set<string>>(new Set());
  const buffered = useRef<BusMsg[] | null>(null);
  const hydrating = useRef(false);

  const fetchEvents = useCallback(async (runId: string, catchUp = false, retry = false): Promise<void> => {
    if (loadingRuns.current.has(runId)) return;
    const existing = stateRef.current.eventsByRun[runId];
    if (!catchUp && !retry && loadedRuns.current.has(runId) && existing) return;
    loadingRuns.current.add(runId);
    try {
      const afterSeq = catchUp && existing?.length ? existing[existing.length - 1]!.seq : undefined;
      const events = await api.events(runId, afterSeq === undefined ? { tail: 4_000 } : { afterSeq, tail: 4_000 });
      if (!mounted.current) return;
      loadedRuns.current.add(runId);
      // Bound bookkeeping as well as the actual event buffers.
      for (const key of [...loadedRuns.current].slice(0, -30)) loadedRuns.current.delete(key);
      setState((current) => addEvents(current, runId, events));
      setLogStates((current) => withLoadState(current, runId, LOADED));
    } catch (cause) {
      loadedRuns.current.delete(runId);
      // Dropping this error used to leave the log showing "Chưa có sự kiện".
      if (mounted.current) setLogStates((current) => withLoadState(current, runId, loadError(cause)));
    } finally {
      loadingRuns.current.delete(runId);
    }
  }, []);

  const hydrate = useCallback(() => {
    if (hydrating.current) return;
    hydrating.current = true;
    buffered.current = [];
    void (async () => {
      try {
        const plans = await api.plans();
        const tasks = await api.tasks();
        const runLists = await Promise.all(
          tasks.map((task) => api.runs(task.id)),
        );
        if (!mounted.current) return;
        const pending = buffered.current?.slice() ?? [];
        buffered.current = null;
        setState((current) => {
          let next = current;
          for (const plan of plans) next = reduceFleet(next, { type: 'plan', plan });
          for (const task of tasks) next = reduceFleet(next, { type: 'task', task });
          for (const runs of runLists) {
            for (const run of runs) next = reduceFleet(next, { type: 'run', run });
          }
          // A GET may return a snapshot older than a push that arrived while it
          // was in flight. Replay that push after the snapshot to preserve it.
          for (const message of pending) next = reduceFleet(next, message);
          return next;
        });
        setError(null);
        setTasksLoaded(true);
        await Promise.all([...loadedRuns.current].map((runId) => fetchEvents(runId, true)));
      } catch (cause) {
        if (mounted.current) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        buffered.current = null;
        hydrating.current = false;
      }
    })();
  }, [fetchEvents]);

  useEffect(() => {
    mounted.current = true;
    hydrate();
    const close = connectBus({
      onMessage: (message) => {
        buffered.current?.push(message);
        setState((current) => reduceFleet(current, message));
      },
      onOpen: () => { setConnected(true); hydrate(); },
      onClose: () => setConnected(false),
    });
    const refreshVisible = () => { if (document.visibilityState !== 'hidden') hydrate(); };
    // Reconcile missed pushes (sleep/resume, reconnect, or a transport proxy).
    // Healthy streaming remains immediate; this slow fallback limits idle work.
    const timer = window.setInterval(refreshVisible, 15_000);
    window.addEventListener('focus', refreshVisible);
    document.addEventListener('visibilitychange', refreshVisible);
    return () => {
      mounted.current = false;
      close();
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVisible);
      document.removeEventListener('visibilitychange', refreshVisible);
    };
  }, [hydrate]);

  const loadEvents = useCallback((runId: string, retry = false) => {
    if (retry) {
      loadedRuns.current.delete(runId);
      setLogStates((current) => withLoadState(current, runId, NOT_LOADED));
    }
    void fetchEvents(runId, false, retry);
  }, [fetchEvents]);

  const logState = useCallback(
    (runId: string | null): LoadState => (runId === null ? LOADED : logStates[runId] ?? NOT_LOADED),
    [logStates],
  );

  return { state, connected, error, tasksLoaded, logState, reload: hydrate, loadEvents };
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
 * Read `/api/tasks/:id/diff` for the selected task, refreshing every few
 * seconds while the task runs and the Diff tab is open. `reload` retries a
 * failed read immediately instead of waiting for the next poll.
 */
export function useTaskDiff(taskId: string | null, status: TaskStatus | null, active: boolean): TaskDiff {
  const [entry, setEntry] = useState<DiffEntry>({ taskId: null, ...EMPTY_DIFF });
  const [attempt, setAttempt] = useState(0);
  // The render of a newly selected task must not expose the previous patch.
  const current: DiffEntry = entry.taskId === taskId ? entry : { taskId, ...EMPTY_DIFF };

  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    let timer: number | undefined;
    const refresh = async (): Promise<void> => {
      try {
        const result = await api.diff(taskId);
        if (cancelled) return;
        setEntry({ taskId, diff: result, loaded: true, error: null });
      } catch (cause) {
        if (cancelled) return;
        setEntry({ taskId, diff: null, ...loadError(cause) });
      } finally {
        const polling = active && (status === 'running' || status === 'taken_over');
        if (!cancelled && polling) timer = window.setTimeout(refresh, document.hidden ? 10_000 : 3_000);
      }
    };
    void refresh();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [taskId, status, active, attempt]);

  const reload = useCallback(() => {
    setEntry({ taskId, ...EMPTY_DIFF });
    setAttempt((value) => value + 1);
  }, [taskId]);

  return { diff: current.diff, loaded: current.loaded, error: current.error, reload };
}

