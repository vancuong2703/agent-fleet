import { describe, expect, test } from 'vitest';

import { computeStats } from '../../server/stats.js';
import type { AgentId, Plan, Run, Task } from '../../shared/types.js';

// ── builders for hand-made domain objects ──────────────────────────────────

function plan(over: Partial<Plan> & { id: string }): Plan {
  return {
    id: over.id,
    name: over.name ?? over.id,
    slug: over.slug ?? over.id,
    repoPath: over.repoPath ?? 'C:\\repo',
    baseBranch: over.baseBranch ?? 'main',
    createdAt: over.createdAt ?? 0,
  };
}

function task(over: Partial<Task> & { id: string; planId: string }): Task {
  return {
    id: over.id,
    planId: over.planId,
    title: over.title ?? 'việc',
    agent: over.agent ?? 'codex',
    status: over.status ?? 'done',
    branch: over.branch ?? `fleet/p-1/${over.id}`,
    worktreePath: over.worktreePath ?? `C:\\wt\\${over.id}`,
    checkCmd: over.checkCmd ?? null,
    createdAt: over.createdAt ?? 0,
    finishedAt: over.finishedAt ?? null,
  };
}

function run(
  over: Partial<Run> & { id: string; taskId: string; attempt: number; agent: AgentId },
): Run {
  return {
    id: over.id,
    taskId: over.taskId,
    attempt: over.attempt,
    agent: over.agent,
    brief: over.brief ?? 'b',
    note: over.note ?? null,
    status: over.status ?? 'done',
    pid: over.pid ?? null,
    exitCode: over.exitCode ?? null,
    startedAt: over.startedAt ?? null,
    endedAt: over.endedAt ?? null,
    durationMs: over.durationMs ?? null,
    checkPassed: over.checkPassed ?? null,
    inputTokens: over.inputTokens ?? null,
    outputTokens: over.outputTokens ?? null,
    costUsd: over.costUsd ?? null,
    finalMessage: over.finalMessage ?? null,
    errorCategory: over.errorCategory ?? null,
    sessionId: over.sessionId ?? null,
  };
}

function only(stats: ReturnType<typeof computeStats>, agent: AgentId) {
  const found = stats.find((s) => s.agent === agent);
  expect(found, `expected a stats row for ${agent}`).toBeDefined();
  return found!;
}

// ── tests ──────────────────────────────────────────────────────────────────

describe('computeStats', () => {
  test('returns no rows for empty input', () => {
    expect(computeStats([], [], [])).toEqual([]);
  });

  test('excludes quota and auth failures from counted runs', () => {
    const p = plan({ id: 'p-1' });
    const t = task({ id: 't-1', planId: 'p-1' });
    const runs = [
      run({ id: 'r-1', taskId: 't-1', attempt: 1, agent: 'codex', status: 'failed', errorCategory: 'quota' }),
      run({ id: 'r-2', taskId: 't-1', attempt: 2, agent: 'codex', status: 'failed', errorCategory: 'auth' }),
      run({ id: 'r-3', taskId: 't-1', attempt: 3, agent: 'codex', status: 'done', durationMs: 1000 }),
    ];

    const stats = computeStats([t], runs, [p]);
    const codex = only(stats, 'codex');

    expect(codex.runs).toBe(1);
    expect(codex.successRate).toBe(1);
    expect(codex.avgDurationMs).toBe(1000);
    // The task still has three attempts, so it counts as retried.
    expect(codex.retryRate).toBe(1);
    expect(codex.mergeRate).toBeNull();
  });

  test('a done run with checkPassed false counts as a failure', () => {
    const p = plan({ id: 'p-1' });
    const t = task({ id: 't-1', planId: 'p-1' });
    const runs = [
      run({ id: 'r-1', taskId: 't-1', attempt: 1, agent: 'codex', status: 'done', checkPassed: false, durationMs: 500 }),
    ];

    const codex = only(computeStats([t], runs, [p]), 'codex');

    expect(codex.runs).toBe(1);
    expect(codex.successRate).toBe(0);
    expect(codex.avgDurationMs).toBe(500);
    expect(codex.retryRate).toBe(0);
  });

  test('a done run with checkPassed null still counts as a success', () => {
    const p = plan({ id: 'p-1' });
    const t = task({ id: 't-1', planId: 'p-1' });
    const runs = [
      run({ id: 'r-1', taskId: 't-1', attempt: 1, agent: 'codex', status: 'done', checkPassed: null }),
    ];

    const codex = only(computeStats([t], runs, [p]), 'codex');

    expect(codex.successRate).toBe(1);
  });

  test('timeout and failed runs count as failures', () => {
    const p = plan({ id: 'p-1' });
    const t = task({ id: 't-1', planId: 'p-1' });
    const runs = [
      run({ id: 'r-1', taskId: 't-1', attempt: 1, agent: 'codex', status: 'timeout', durationMs: 30000 }),
      run({ id: 'r-2', taskId: 't-1', attempt: 2, agent: 'codex', status: 'failed', errorCategory: 'agent', durationMs: 1000 }),
      run({ id: 'r-3', taskId: 't-1', attempt: 3, agent: 'codex', status: 'done', durationMs: 2000 }),
    ];

    const codex = only(computeStats([t], runs, [p]), 'codex');

    expect(codex.runs).toBe(3);
    expect(codex.successRate).toBeCloseTo(1 / 3);
    expect(codex.avgDurationMs).toBe(11000);
  });

  test('rates are null when the denominator is zero', () => {
    const p = plan({ id: 'p-1' });
    const t = task({ id: 't-1', planId: 'p-1', status: 'queued' });
    const runs = [
      run({ id: 'r-1', taskId: 't-1', attempt: 1, agent: 'codex', status: 'queued' }),
    ];

    const codex = only(computeStats([t], runs, [p]), 'codex');

    expect(codex.runs).toBe(0);
    expect(codex.successRate).toBeNull();
    expect(codex.avgDurationMs).toBeNull();
    expect(codex.retryRate).toBe(0); // one task attributed, not retried
    expect(codex.mergeRate).toBeNull(); // no merged/discarded task
    expect(codex.costUsd).toBeNull();
  });

  test('a task belongs to its first run\'s agent while each run counts toward its own agent', () => {
    const p = plan({ id: 'p-1' });
    const t = task({ id: 't-1', planId: 'p-1', status: 'done' });
    const runs = [
      run({ id: 'r-1', taskId: 't-1', attempt: 1, agent: 'codex', status: 'failed', errorCategory: 'agent', durationMs: 1000 }),
      run({ id: 'r-2', taskId: 't-1', attempt: 2, agent: 'qodercli', status: 'done', durationMs: 2000, costUsd: 0.5 }),
    ];

    const stats = computeStats([t], runs, [p]);
    const codex = only(stats, 'codex');
    const qoder = only(stats, 'qodercli');

    // Retry attribution follows the task's first run (codex).
    expect(codex.runs).toBe(1);
    expect(codex.successRate).toBe(0);
    expect(codex.avgDurationMs).toBe(1000);
    expect(codex.retryRate).toBe(1);

    // The retry run itself is credited to qodercli, not to codex.
    expect(qoder.runs).toBe(1);
    expect(qoder.successRate).toBe(1);
    expect(qoder.avgDurationMs).toBe(2000);
    expect(qoder.retryRate).toBeNull();
    expect(qoder.costUsd).toBe(0.5);
  });

  test('mergeRate is merged over tasks that reached merged or discarded', () => {
    const p = plan({ id: 'p-1' });
    const merged = task({ id: 't-1', planId: 'p-1', status: 'merged' });
    const discarded = task({ id: 't-2', planId: 'p-1', status: 'discarded' });
    const done = task({ id: 't-3', planId: 'p-1', status: 'done' });
    const runs = [
      run({ id: 'r-1', taskId: 't-1', attempt: 1, agent: 'codex', status: 'done' }),
      run({ id: 'r-2', taskId: 't-2', attempt: 1, agent: 'codex', status: 'failed', errorCategory: 'agent' }),
      run({ id: 'r-3', taskId: 't-3', attempt: 1, agent: 'codex', status: 'done' }),
    ];

    const codex = only(computeStats([merged, discarded, done], runs, [p]), 'codex');

    expect(codex.mergeRate).toBeCloseTo(0.5);
    expect(codex.runs).toBe(3); // done, agent-failed and done all count
  });

  test('cost sums only counted runs and is null when there are no costs', () => {
    const p = plan({ id: 'p-1' });
    const t = task({ id: 't-1', planId: 'p-1' });
    const runs = [
      run({ id: 'r-1', taskId: 't-1', attempt: 1, agent: 'codex', status: 'done', costUsd: 0.25 }),
      // A quota failure is excluded, so its cost is not counted either.
      run({ id: 'r-2', taskId: 't-1', attempt: 2, agent: 'codex', status: 'failed', errorCategory: 'quota', costUsd: 9.99 }),
    ];

    expect(only(computeStats([t], runs, [p]), 'codex').costUsd).toBe(0.25);

    const noCostRuns = [run({ id: 'r-3', taskId: 't-1', attempt: 1, agent: 'codex', status: 'done' })];
    expect(only(computeStats([t], noCostRuns, [p]), 'codex').costUsd).toBeNull();
  });

  test('avgDurationMs only averages counted runs that recorded a duration', () => {
    const p = plan({ id: 'p-1' });
    const t = task({ id: 't-1', planId: 'p-1' });
    const runs = [
      run({ id: 'r-1', taskId: 't-1', attempt: 1, agent: 'codex', status: 'done', durationMs: null }),
      run({ id: 'r-2', taskId: 't-1', attempt: 2, agent: 'codex', status: 'failed', errorCategory: 'agent', durationMs: 3000 }),
    ];

    expect(only(computeStats([t], runs, [p]), 'codex').avgDurationMs).toBe(3000);
  });

  test('repoPath filters tasks by their plan\'s repo', () => {
    const planA = plan({ id: 'p-a', repoPath: 'C:\\repoA' });
    const planB = plan({ id: 'p-b', repoPath: 'C:\\repoB' });
    const taskA = task({ id: 't-a', planId: 'p-a', agent: 'codex' });
    const taskB = task({ id: 't-b', planId: 'p-b', agent: 'qodercli' });
    const runs = [
      run({ id: 'r-a', taskId: 't-a', attempt: 1, agent: 'codex', status: 'done' }),
      run({ id: 'r-b', taskId: 't-b', attempt: 1, agent: 'qodercli', status: 'done' }),
    ];
    const tasks = [taskA, taskB];

    expect(computeStats(tasks, runs, [planA, planB], { repoPath: 'C:\\repoA' }).map((s) => s.agent)).toEqual(['codex']);
    expect(computeStats(tasks, runs, [planA, planB], { repoPath: 'C:\\repoB' }).map((s) => s.agent)).toEqual(['qodercli']);
    expect(computeStats(tasks, runs, [planA, planB])).toHaveLength(2);
  });

  test('sinceMs filters tasks created before the cutoff', () => {
    const p = plan({ id: 'p-1' });
    const oldTask = task({ id: 't-old', planId: 'p-1', agent: 'codex', createdAt: 1000 });
    const newTask = task({ id: 't-new', planId: 'p-1', agent: 'qodercli', createdAt: 5000 });
    const runs = [
      run({ id: 'r-old', taskId: 't-old', attempt: 1, agent: 'codex', status: 'done' }),
      run({ id: 'r-new', taskId: 't-new', attempt: 1, agent: 'qodercli', status: 'done' }),
    ];

    const stats = computeStats([oldTask, newTask], runs, [p], { sinceMs: 3000 });
    expect(stats.map((s) => s.agent)).toEqual(['qodercli']);

    const all = computeStats([oldTask, newTask], runs, [p], { sinceMs: 0 });
    expect(all.map((s) => s.agent)).toEqual(['codex', 'qodercli']);
  });

  test('rows are sorted by agent id', () => {
    const p = plan({ id: 'p-1' });
    const tasks = [
      task({ id: 't-1', planId: 'p-1', agent: 'qodercli' }),
      task({ id: 't-2', planId: 'p-1', agent: 'agy' }),
      task({ id: 't-3', planId: 'p-1', agent: 'codex' }),
    ];
    const runs = tasks.map((t, i) =>
      run({ id: `r-${i}`, taskId: t.id, attempt: 1, agent: t.agent, status: 'done' }),
    );

    expect(computeStats(tasks, runs, [p]).map((s) => s.agent)).toEqual(['agy', 'codex', 'qodercli']);
  });
});
