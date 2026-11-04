import { describe, expect, test } from 'vitest';
import type { Task, TaskStatus } from '../../shared/types.js';
import { buildPaletteItems, filterPalette, stepIndex } from '../../web/src/palette.js';
import { filterTasks, matchesFilter, taskCounts } from '../../web/src/store.js';

function task(id: string, status: TaskStatus, createdAt = 0): Task {
  return {
    id, planId: 'p1', title: `Việc ${id}`, agent: 'codex', status,
    branch: `fleet/p1/${id}`, worktreePath: `C:\\wt\\${id}`, checkCmd: null,
    createdAt, finishedAt: null,
  };
}

describe('status chips', () => {
  const tasks = [
    task('a', 'running'), task('b', 'queued'), task('c', 'queued'),
    task('d', 'failed'), task('e', 'timeout'), task('f', 'interrupted'),
    task('g', 'done'), task('h', 'merged'), task('i', 'discarded'),
  ];

  test('every chip count matches the rows the chip filters to', () => {
    const counts = taskCounts(tasks);
    expect(counts.running).toBe(filterTasks(tasks, 'running').length);
    expect(counts.waiting).toBe(filterTasks(tasks, 'waiting').length);
    expect(counts.failed).toBe(filterTasks(tasks, 'failed').length);
    expect(counts).toMatchObject({ running: 1, waiting: 2, failed: 3, done: 2 });
  });

  test('a person must act on failed, timeout and interrupted alike', () => {
    expect(matchesFilter('failed', 'failed')).toBe(true);
    expect(matchesFilter('timeout', 'failed')).toBe(true);
    expect(matchesFilter('interrupted', 'failed')).toBe(true);
    expect(matchesFilter('discarded', 'failed')).toBe(false);
    expect(matchesFilter('done', 'failed')).toBe(false);
  });

  test('the neutral filter keeps every row and the original order', () => {
    expect(filterTasks(tasks, 'all')).toEqual(tasks);
    expect(filterTasks(tasks, 'all')).toBe(tasks);
  });

  test('an empty fleet reports zero of everything instead of NaN', () => {
    expect(taskCounts([])).toEqual({ running: 0, waiting: 0, failed: 0, done: 0 });
    expect(filterTasks([], 'failed')).toEqual([]);
  });
});

describe('command palette items', () => {
  const tasks = [task('old', 'done', 1), task('new', 'running', 9), task('mid', 'queued', 5)];

  test('offers create, every screen, every agent and every theme', () => {
    const items = buildPaletteItems({ tasks });
    const ids = items.map((item) => item.id);
    expect(ids).toContain('create');
    for (const view of ['dashboard', 'terminal', 'tasks', 'compare', 'usage']) expect(ids).toContain(`view:${view}`);
    for (const agent of ['codex', 'qodercli', 'agy', 'opencode']) expect(ids).toContain(`agent:${agent}`);
    for (const theme of ['light', 'dark', 'system']) expect(ids).toContain(`theme:${theme}`);
  });

  test('lists the newest tasks first and honours the limit', () => {
    expect(buildPaletteItems({ tasks }).filter((item) => item.id.startsWith('task:')).map((item) => item.id))
      .toEqual(['task:new', 'task:mid', 'task:old']);
    expect(buildPaletteItems({ tasks, taskLimit: 1 }).filter((item) => item.id.startsWith('task:')).map((item) => item.id))
      .toEqual(['task:new']);
  });

  test('a task item carries its status as the hint, not a made-up label', () => {
    const item = buildPaletteItems({ tasks }).find((entry) => entry.id === 'task:mid');
    expect(item?.hint).toBe('đang chờ');
    expect(item?.action).toEqual({ type: 'task', taskId: 'mid' });
  });
});

describe('command palette filtering', () => {
  const items = buildPaletteItems({ tasks: [task('abc123', 'failed')] });

  test('an empty query keeps the display order', () => {
    expect(filterPalette(items, '   ')).toEqual(items);
  });

  test('ranks a label prefix above a keyword hit', () => {
    const result = filterPalette(items, 'tạo');
    expect(result[0]?.id).toBe('create');
  });

  test('matches a hidden keyword such as a task id or a view slug', () => {
    expect(filterPalette(items, 'abc123').map((item) => item.id)).toContain('task:abc123');
    expect(filterPalette(items, 'compare').map((item) => item.id)).toContain('view:compare');
  });

  test('is case-insensitive and reports nothing for an unknown query', () => {
    expect(filterPalette(items, 'OPENCODE').map((item) => item.id)).toContain('agent:opencode');
    expect(filterPalette(items, 'zzz-không-có')).toEqual([]);
  });
});

describe('palette cursor', () => {
  test('wraps at both ends', () => {
    expect(stepIndex(-1, 1, 3)).toBe(0);
    expect(stepIndex(-1, -1, 3)).toBe(2);
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
  });

  test('has no position when the list is empty', () => {
    expect(stepIndex(0, 1, 0)).toBe(-1);
  });
});
