import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import { TaskActions } from '../../web/src/components/TaskActions.js';
import { JobCheck } from '../../web/src/ui/JobCheck.js';

vi.mock('../../web/src/components/TerminalPanel.js', () => ({ TerminalPanel: () => null }));

import {
  addEvents,
  buildLogRows,
  eventText,
  formatClock,
  formatElapsed,
  groupByRepo,
  initialFleetState,
  mergeErrorMessage,
  reduceFleet,
  taskActions,
  taskCounts,
  taskProgress,
} from '../../web/src/store.js';
import type {
  FleetEvent,
  Plan,
  Run,
  StoredEvent,
  Task,
  TaskStatus,
} from '../../shared/types.js';

function makePlan(id: string, over: Partial<Plan> = {}): Plan {
  return {
    id,
    name: `Plan ${id}`,
    slug: id,
    repoPath: 'C:\\repo',
    baseBranch: 'main',
    createdAt: 0,
    ...over,
  };
}

function makeTask(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    planId: 'p-1',
    title: `Task ${id}`,
    agent: 'fake',
    status: 'queued',
    branch: `fleet/plan/${id}`,
    worktreePath: `C:\\wt\\${id}`,
    checkCmd: null,
    createdAt: 0,
    finishedAt: null,
    ...over,
  };
}

function makeRun(id: string, over: Partial<Run> = {}): Run {
  return {
    id,
    taskId: 't-1',
    attempt: 1,
    agent: 'fake',
    brief: 'hi',
    note: null,
    status: 'queued',
    pid: null,
    exitCode: null,
    startedAt: null,
    endedAt: null,
    durationMs: null,
    checkPassed: null,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    finalMessage: null,
    errorCategory: null,
    sessionId: null,
    ...over,
  };
}

function makeEvent(runId: string, seq: number, event: FleetEvent): StoredEvent {
  return { runId, seq, ts: seq * 1000, event };
}

function taskWith(status: TaskStatus, id = `t-${status}`): Task {
  return makeTask(id, { status });
}

test('log buffers retain recent events and evict old run buffers', () => {
  let state = addEvents(initialFleetState(), 'large', Array.from({length:4_100}, (_,index)=>makeEvent('large',index+1,{kind:'message',text:'event'})));
  expect(state.eventsByRun.large).toHaveLength(4_000);
  expect(state.eventsByRun.large![0]!.seq).toBe(101);
  for(let index=0;index<30;index++) state=addEvents(state,`r-${index}`,[makeEvent(`r-${index}`,1,{kind:'message',text:'latest'})]);
  expect(Object.keys(state.eventsByRun)).toHaveLength(30);
  expect(state.eventsByRun.large).toBeUndefined();
});

describe('reduceFleet', () => {
  test('starts empty', () => {
    const state = initialFleetState();
    expect(state.plans).toEqual([]);
    expect(state.tasks).toEqual([]);
    expect(state.runsByTask).toEqual({});
    expect(state.eventsByRun).toEqual({});
  });

  test('upserts plans by id instead of duplicating them', () => {
    let state = initialFleetState();
    state = reduceFleet(state, { type: 'plan', plan: makePlan('p-1', { name: 'A' }) });
    state = reduceFleet(state, { type: 'plan', plan: makePlan('p-1', { name: 'B' }) });

    expect(state.plans).toHaveLength(1);
    expect(state.plans[0]?.name).toBe('B');
  });

  test('upserts tasks by id so status changes replace the row', () => {
    let state = initialFleetState();
    state = reduceFleet(state, { type: 'task', task: makeTask('t-1', { status: 'queued' }) });
    state = reduceFleet(state, { type: 'task', task: makeTask('t-1', { status: 'running' }) });

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]?.status).toBe('running');
  });

  test('keeps runs per task ordered by attempt', () => {
    let state = initialFleetState();
    state = reduceFleet(state, {
      type: 'run',
      run: makeRun('r-2', { taskId: 't-1', attempt: 2 }),
    });
    state = reduceFleet(state, {
      type: 'run',
      run: makeRun('r-1', { taskId: 't-1', attempt: 1 }),
    });

    expect(state.runsByTask['t-1']?.map((run) => run.attempt)).toEqual([1, 2]);
  });

  test('appends events to their run without mutating the previous state', () => {
    const empty = initialFleetState();
    const first = reduceFleet(empty, {
      type: 'event',
      taskId: 't-1',
      stored: makeEvent('r-1', 1, { kind: 'message', text: 'a' }),
    });
    const second = reduceFleet(first, {
      type: 'event',
      taskId: 't-1',
      stored: makeEvent('r-1', 2, { kind: 'message', text: 'b' }),
    });

    expect(empty.eventsByRun).toEqual({});
    expect(first.eventsByRun['r-1']?.map((event) => event.seq)).toEqual([1]);
    expect(second.eventsByRun['r-1']?.map((event) => event.seq)).toEqual([1, 2]);
  });
});

describe('addEvents', () => {
  test('merges by seq, keeps order and ignores duplicates', () => {
    const state = initialFleetState();
    const seeded = addEvents(state, 'r-1', [
      makeEvent('r-1', 2, { kind: 'message', text: 'two' }),
      makeEvent('r-1', 1, { kind: 'message', text: 'one' }),
    ]);
    const merged = addEvents(seeded, 'r-1', [
      makeEvent('r-1', 2, { kind: 'message', text: 'two' }),
      makeEvent('r-1', 3, { kind: 'raw', stream: 'stdout', text: 'three' }),
    ]);

    expect(merged.eventsByRun['r-1']?.map((event) => event.seq)).toEqual([1, 2, 3]);
    expect(merged.eventsByRun['r-1']).toHaveLength(3);
  });
});

describe('taskCounts', () => {
  test('counts running, waiting, failed and finished tasks', () => {
    const counts = taskCounts([
      taskWith('running', 't-a'),
      taskWith('running', 't-b'),
      taskWith('queued', 't-c'),
      taskWith('done', 't-d'),
      taskWith('merged', 't-e'),
      taskWith('failed', 't-f'),
      taskWith('timeout', 't-g'),
      taskWith('taken_over', 't-h'),
      taskWith('interrupted', 't-i'),
      taskWith('discarded', 't-j'),
    ]);

    // The Lỗi chip covers the three statuses a person has to act on; taken_over
    // and discarded need no attention, so they are only ever visible under "all".
    expect(counts).toEqual({ running: 2, waiting: 1, failed: 3, done: 2 });
  });
});

describe('taskProgress', () => {
  test('counts done and merged as finished', () => {
    const progress = taskProgress([
      taskWith('done', 't-a'),
      taskWith('merged', 't-b'),
      taskWith('running', 't-c'),
      taskWith('failed', 't-d'),
      taskWith('queued', 't-e'),
    ]);

    expect(progress).toEqual({ done: 2, total: 5 });
  });
});

describe('groupByRepo', () => {
  test('groups plans by repo and tasks by plan with progress', () => {
    const plans = [
      makePlan('p-1', { name: 'One', repoPath: 'C:\\work\\app', createdAt: 1 }),
      makePlan('p-2', { name: 'Two', repoPath: 'C:\\work\\app', createdAt: 2 }),
      makePlan('p-3', { name: 'Other', repoPath: 'C:\\work\\other', createdAt: 3 }),
    ];
    const tasks = [
      makeTask('t-1', { planId: 'p-1', status: 'done', createdAt: 1 }),
      makeTask('t-2', { planId: 'p-1', status: 'running', createdAt: 2 }),
      makeTask('t-3', { planId: 'p-2', status: 'merged', createdAt: 3 }),
    ];

    const groups = groupByRepo(plans, tasks);

    expect(groups.map((group) => group.name)).toEqual(['app', 'other']);
    expect(groups[0]?.plans.map((group) => group.plan.id)).toEqual(['p-1', 'p-2']);
    expect(groups[0]?.plans[0]).toMatchObject({ done: 1, total: 2 });
    expect(groups[0]?.plans[1]).toMatchObject({ done: 1, total: 1 });
    expect(groups[1]?.plans[0]?.tasks).toEqual([]);
  });
});

describe('formatClock', () => {
  test('formats local time as HH:MM:SS', () => {
    const ts = new Date(2026, 0, 2, 9, 5, 3).getTime();
    expect(formatClock(ts)).toBe('09:05:03');
  });
});

describe('formatElapsed', () => {
  test('formats seconds, minutes and hours', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(4_000)).toBe('4s');
    expect(formatElapsed(65_000)).toBe('1m 05s');
    expect(formatElapsed(3_600_000)).toBe('1h 00m');
    expect(formatElapsed(3_725_000)).toBe('1h 02m');
  });

  test('never shows a negative duration', () => {
    expect(formatElapsed(-5)).toBe('0s');
  });
});

describe('buildLogRows', () => {
  test('groups consecutive raw events into one collapsible row', () => {
    const rows = buildLogRows([
      makeEvent('r-1', 1, { kind: 'message', text: 'hello' }),
      makeEvent('r-1', 2, { kind: 'raw', stream: 'stdout', text: 'x' }),
      makeEvent('r-1', 3, { kind: 'raw', stream: 'stdout', text: 'y' }),
      makeEvent('r-1', 4, { kind: 'command', cmd: 'npm test' }),
    ]);

    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ raw: false });
    expect(rows[0]?.events).toHaveLength(1);
    expect(rows[1]).toMatchObject({ raw: true });
    expect(rows[1]?.events.map((event) => event.seq)).toEqual([2, 3]);
    expect(rows[2]?.events[0]?.event.kind).toBe('command');
    expect(new Set(rows.map((row) => row.id)).size).toBe(3);
  });

  test('separates raw runs around normal events', () => {
    const rows = buildLogRows([
      makeEvent('r-1', 1, { kind: 'raw', stream: 'stdout', text: 'a' }),
      makeEvent('r-1', 2, { kind: 'message', text: 'm' }),
      makeEvent('r-1', 3, { kind: 'raw', stream: 'stderr', text: 'b' }),
    ]);

    expect(rows.map((row) => row.raw)).toEqual([true, false, true]);
  });
});

describe('eventText', () => {
  test('renders each event kind as one readable line', () => {
    expect(eventText({ kind: 'message', text: 'xin chào' })).toBe('xin chào');
    expect(eventText({ kind: 'command', cmd: 'npm test' })).toBe('npm test');
    expect(eventText({ kind: 'file_edit', path: 'src/a.ts' })).toBe('src/a.ts');
    expect(eventText({ kind: 'error', text: 'rate limit' })).toBe('rate limit');
    expect(eventText({ kind: 'raw', stream: 'stdout', text: 'noise' })).toBe('noise');
    expect(eventText({ kind: 'session', id: 'ses-1' })).toBe('ses-1');
    expect(eventText({ kind: 'status', status: 'running' })).toContain('running');
    expect(eventText({ kind: 'check', cmd: 'npm test', passed: true, output: '' })).toContain(
      'npm test',
    );
  });
});

describe('taskActions', () => {
  test.each(['queued', 'merged', 'discarded', 'running', 'taken_over', 'done', 'failed', 'timeout', 'interrupted'] as const)('terminal button visibility for %s', (status) => {
    const html = renderToStaticMarkup(createElement(TaskActions, { task: taskWith(status), baseBranch: 'main' }));
    const label = status === 'running' ? 'Tiếp quản terminal' : 'Mở terminal';
    expect(html.includes(label)).toBe(!['queued', 'merged', 'discarded'].includes(status));
  });
  test('maps each status to the actions the task supports', () => {
    expect(taskActions('running')).toEqual(['stop']);
    expect(taskActions('taken_over')).toEqual(['markDone']);
    expect(taskActions('done')).toEqual(['merge', 'discard']);
    expect(taskActions('failed')).toEqual(['discard']);
    expect(taskActions('timeout')).toEqual(['discard']);
    expect(taskActions('interrupted')).toEqual(['discard']);
  });

  test('legacy done task cannot offer an enabled merge when its check failed', () => {
    const html = renderToStaticMarkup(createElement(TaskActions, {
      task: taskWith('done'), baseBranch: 'main', run: makeRun('r-1', { checkPassed: false }),
    }));
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Merge<\/button>/);
  });

  test('header distinguishes a passing fleet check from a blocked agent', () => {
    const html = renderToStaticMarkup(createElement(JobCheck, {
      run: makeRun('r-1', { status: 'failed', checkPassed: true, errorCategory: 'permission' }),
    }));
    expect(html).toContain('Kiểm tra: PASS');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Agent bị từ chối quyền');
    expect(html).toContain('Mở terminal');
  });

  test('offers no actions while queued or once the task is final', () => {
    expect(taskActions('queued')).toEqual([]);
    expect(taskActions('merged')).toEqual([]);
    expect(taskActions('discarded')).toEqual([]);
  });
});

describe('mergeErrorMessage', () => {
  test('shows the stderr of a non-conflict merge error', () => {
    expect(mergeErrorMessage({ ok: false, reason: 'error', message: 'hook failed' }, 'main')).toBe('Merge lỗi: hook failed');
  });
  test('renders each failure reason in Vietnamese', () => {
    expect(mergeErrorMessage({ ok: false, reason: 'dirty' }, 'main')).toBe(
      'Repo gốc còn thay đổi chưa commit',
    );
    expect(mergeErrorMessage({ ok: false, reason: 'wrong_branch' }, 'main')).toBe(
      'Repo gốc không ở nhánh main',
    );
    expect(
      mergeErrorMessage({ ok: false, reason: 'conflict', files: ['README.md', 'a.ts'] }, 'main'),
    ).toBe('Xung đột: README.md, a.ts');
  });

  test('handles a conflict without a file list', () => {
    expect(mergeErrorMessage({ ok: false, reason: 'conflict' }, 'main')).toBe('Xung đột');
  });
});
