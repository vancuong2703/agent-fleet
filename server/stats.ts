import type { AgentId, ErrorCategory, Plan, Run, RunStatus, Task, TaskStatus } from '../shared/types.js';

/** One row of the agent comparison table (`/api/stats`). */
export interface AgentStats {
  agent: AgentId;
  runs: number;
  successRate: number | null;
  avgDurationMs: number | null;
  retryRate: number | null;
  mergeRate: number | null;
  costUsd: number | null;
}

/**
 * Run statuses that are finished and therefore count towards an agent's stats.
 * `queued`, `running`, `interrupted` and `taken_over` are left out.
 */
const COUNTED_RUN_STATUSES: ReadonlySet<RunStatus> = new Set<RunStatus>([
  'done',
  'failed',
  'timeout',
]);

/** Quota and auth failures never count against an agent (spec §7). */
const EXCLUDED_CATEGORIES: ReadonlySet<ErrorCategory> = new Set<ErrorCategory>(['quota', 'auth']);

/** Task statuses that close a task for the merge-rate denominator. */
const MERGE_DENOMINATOR_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'merged',
  'discarded',
]);

/**
 * Compute the per-agent comparison table.
 *
 * - A **task** is in scope when its plan matches `repoPath` (if given) and its
 *   `createdAt` is at or after `sinceMs` (if given). Its runs follow the task.
 * - Runs are attributed to `run.agent`; a task's retry/merge metrics are
 *   attributed to the agent of its **first** run (lowest attempt), so a task
 *   started by codex and retried by qodercli still counts as a codex retry.
 * - Counted runs are finished runs (`done|failed|timeout`) whose
 *   `errorCategory` is not `quota` or `auth`.
 * - A success is a counted `done` run whose `checkPassed` is not `false`.
 * - Rows are sorted by agent id; agents with no in-scope runs or tasks are
 *   omitted and every rate is `null` when its denominator is zero.
 */
export function computeStats(
  tasks: Task[],
  runs: Run[],
  plans: Plan[],
  f?: { repoPath?: string; sinceMs?: number },
): AgentStats[] {
  const repoPath = f?.repoPath;
  const sinceMs = f?.sinceMs;

  const planMatches = (planId: string): boolean => {
    if (repoPath === undefined) return true;
    return plans.some((plan) => plan.id === planId && plan.repoPath === repoPath);
  };

  const scopedTasks = tasks.filter(
    (task) =>
      planMatches(task.planId) && (sinceMs === undefined || task.createdAt >= sinceMs),
  );
  const scopedTaskIds = new Set(scopedTasks.map((task) => task.id));
  const scopedRuns = runs.filter((run) => scopedTaskIds.has(run.taskId));

  const runsByTask = new Map<string, Run[]>();
  for (const run of scopedRuns) {
    const list = runsByTask.get(run.taskId);
    if (list) list.push(run);
    else runsByTask.set(run.taskId, [run]);
  }

  /** Agent of each task's first (lowest-attempt) run, when it has any run. */
  const firstAgentByTask = new Map<string, AgentId>();
  for (const task of scopedTasks) {
    const taskRuns = runsByTask.get(task.id);
    if (!taskRuns || taskRuns.length === 0) continue;
    let first = taskRuns[0]!;
    for (const run of taskRuns) {
      if (run.attempt < first.attempt) first = run;
    }
    firstAgentByTask.set(task.id, first.agent);
  }

  const agents = new Set<AgentId>();
  for (const run of scopedRuns) agents.add(run.agent);
  for (const agent of firstAgentByTask.values()) agents.add(agent);

  return [...agents].sort().map((agent) => {
    const counted = scopedRuns.filter(
      (run) =>
        run.agent === agent &&
        COUNTED_RUN_STATUSES.has(run.status) &&
        (run.errorCategory === null || !EXCLUDED_CATEGORIES.has(run.errorCategory)),
    );

    const runsCount = counted.length;
    const successCount = counted.filter(
      (run) => run.status === 'done' && run.checkPassed !== false,
    ).length;

    const durations = counted
      .map((run) => run.durationMs)
      .filter((value): value is number => value !== null && value !== undefined);
    const costs = counted
      .map((run) => run.costUsd)
      .filter((value): value is number => value !== null && value !== undefined);

    const attributed = scopedTasks.filter(
      (task) => firstAgentByTask.get(task.id) === agent,
    );
    const retried = attributed.filter(
      (task) => (runsByTask.get(task.id)?.length ?? 0) > 1,
    ).length;
    const mergeDenominator = attributed.filter((task) =>
      MERGE_DENOMINATOR_STATUSES.has(task.status),
    );
    const merged = mergeDenominator.filter((task) => task.status === 'merged').length;

    return {
      agent,
      runs: runsCount,
      successRate: runsCount > 0 ? successCount / runsCount : null,
      avgDurationMs:
        durations.length > 0
          ? durations.reduce((sum, value) => sum + value, 0) / durations.length
          : null,
      retryRate: attributed.length > 0 ? retried / attributed.length : null,
      mergeRate:
        mergeDenominator.length > 0 ? merged / mergeDenominator.length : null,
      costUsd:
        costs.length > 0 ? costs.reduce((sum, value) => sum + value, 0) : null,
    } satisfies AgentStats;
  });
}