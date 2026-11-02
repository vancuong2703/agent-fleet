import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Store } from '../../server/store.js';
import { files } from '../../server/paths.js';
import type { Task } from '../../shared/types.js';

let savedDataDir: string | undefined;
let dir: string;
let stores: Store[];

beforeEach(() => {
  savedDataDir = process.env.FLEET_DATA_DIR;
  dir = mkdtempSync(path.join(tmpdir(), 'fleet-task4-'));
  process.env.FLEET_DATA_DIR = dir;
  stores = [];
});

afterEach(() => {
  for (const store of stores) {
    try {
      store.close();
    } catch {
      /* already closed */
    }
  }
  if (savedDataDir === undefined) delete process.env.FLEET_DATA_DIR;
  else process.env.FLEET_DATA_DIR = savedDataDir;
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

function makeStore(): Store {
  const store = new Store(files.db());
  stores.push(store);
  return store;
}

function newPlan(store: Store, name = 'Plan 1 – Việt') {
  return store.createPlan({
    name,
    repoPath: path.win32.join(dir, 'repo'),
    baseBranch: 'main',
  });
}

function newTask(store: Store, planId: string, checkCmd: string | null = null): Task {
  return store.createTask({
    planId,
    title: 'Sửa lỗi "đăng nhập"',
    agent: 'fake',
    branch: 'fleet/plan-1/t-1a2b',
    worktreePath: path.win32.join(dir, 'worktrees', 'repo', 't-1a2b'),
    checkCmd,
  });
}

describe('plans', () => {
  test('createPlan fills id, slug and createdAt and round-trips', () => {
    const store = makeStore();
    const before = Date.now();
    const plan = store.createPlan({
      name: 'Plan 2 – Editor Việt',
      repoPath: 'C:\\repo with space',
      baseBranch: 'main',
    });

    expect(plan.id).toMatch(/^p-[0-9a-z]{4}$/);
    expect(plan.slug).toBe('plan-2-editor-viet');
    expect(plan.createdAt).toBeGreaterThanOrEqual(before);
    expect(store.getPlan(plan.id)).toEqual(plan);
    expect(store.listPlans()).toEqual([plan]);
    expect(store.getPlan('p-nope')).toBeUndefined();
  });

  test('listPlans returns every plan', () => {
    const store = makeStore();
    const a = newPlan(store, 'Alpha');
    const b = newPlan(store, 'Beta');

    expect(store.listPlans().map((p) => p.id).sort()).toEqual([a.id, b.id].sort());
  });
});

describe('tasks', () => {
  test('createTask defaults to queued with null finishedAt and round-trips null checkCmd', () => {
    const store = makeStore();
    const plan = newPlan(store);
    const task = newTask(store, plan.id);

    expect(task.id).toMatch(/^t-[0-9a-z]{4}$/);
    expect(task.status).toBe('queued');
    expect(task.finishedAt).toBeNull();
    expect(task.checkCmd).toBeNull();
    expect(store.getTask(task.id)).toEqual(task);
    expect(store.getTask('t-nope')).toBeUndefined();
  });

  test('createTask accepts an explicit id and a check command', () => {
    const store = makeStore();
    const plan = newPlan(store);
    const task = store.createTask({
      id: 't-7k2f',
      planId: plan.id,
      title: 'Toolbar',
      agent: 'codex',
      branch: 'fleet/plan-1/t-7k2f',
      worktreePath: 'C:\\wt\\t-7k2f',
      checkCmd: 'npm test',
    });

    expect(task.id).toBe('t-7k2f');
    expect(task.checkCmd).toBe('npm test');
    expect(store.getTask('t-7k2f')).toEqual(task);
  });

  test('listTasks filters by planId and by status', () => {
    const store = makeStore();
    const planA = newPlan(store, 'Alpha');
    const planB = newPlan(store, 'Beta');
    const a1 = newTask(store, planA.id);
    const a2 = newTask(store, planA.id);
    const b1 = newTask(store, planB.id);
    store.updateTask(a1.id, { status: 'done', finishedAt: 123 });

    expect(store.listTasks().map((t) => t.id).sort()).toEqual([a1.id, a2.id, b1.id].sort());
    expect(store.listTasks({ planId: planA.id }).map((t) => t.id).sort()).toEqual(
      [a1.id, a2.id].sort(),
    );
    expect(store.listTasks({ status: 'done' }).map((t) => t.id)).toEqual([a1.id]);
    expect(store.listTasks({ planId: planB.id, status: 'queued' }).map((t) => t.id)).toEqual([
      b1.id,
    ]);
    expect(store.listTasks({ planId: planA.id, status: 'merged' })).toEqual([]);
  });

  test('updateTask persists a partial patch and returns the updated row', () => {
    const store = makeStore();
    const plan = newPlan(store);
    const task = newTask(store, plan.id);

    const updated = store.updateTask(task.id, {
      status: 'taken_over',
      finishedAt: 456,
      checkCmd: 'npm run check',
    });

    expect(updated.status).toBe('taken_over');
    expect(updated.finishedAt).toBe(456);
    expect(updated.checkCmd).toBe('npm run check');
    expect(updated.title).toBe(task.title);
    expect(store.getTask(task.id)).toEqual(updated);
  });

  test('updateTask throws for an unknown task', () => {
    const store = makeStore();
    expect(() => store.updateTask('t-nope', { status: 'done' })).toThrow();
  });
});

describe('runs', () => {
  test('createRun starts queued with nulls and attempt 1', () => {
    const store = makeStore();
    const task = newTask(store, newPlan(store).id);

    const run = store.createRun({
      taskId: task.id,
      agent: 'fake',
      brief: 'Làm việc này',
      note: null,
    });

    expect(run.id).toMatch(/^r-[0-9a-z]{6}$/);
    expect(run.attempt).toBe(1);
    expect(run.status).toBe('queued');
    expect(run.note).toBeNull();
    expect(run.pid).toBeNull();
    expect(run.exitCode).toBeNull();
    expect(run.startedAt).toBeNull();
    expect(run.endedAt).toBeNull();
    expect(run.durationMs).toBeNull();
    expect(run.checkPassed).toBeNull();
    expect(run.inputTokens).toBeNull();
    expect(run.outputTokens).toBeNull();
    expect(run.costUsd).toBeNull();
    expect(run.finalMessage).toBeNull();
    expect(run.errorCategory).toBeNull();
    expect(run.sessionId).toBeNull();
    expect(store.getRun(run.id)).toEqual(run);
  });

  test('createRun twice yields attempts 1 and 2; latestRun returns attempt 2', () => {
    const store = makeStore();
    const task = newTask(store, newPlan(store).id);

    const first = store.createRun({ taskId: task.id, agent: 'fake', brief: 'one', note: null });
    const second = store.createRun({
      taskId: task.id,
      agent: 'codex',
      brief: 'two',
      note: 'thử lại',
    });

    expect(first.attempt).toBe(1);
    expect(second.attempt).toBe(2);
    expect(second.note).toBe('thử lại');
    expect(store.latestRun(task.id)?.id).toBe(second.id);
    expect(store.listRuns({ taskId: task.id }).map((r) => r.attempt)).toEqual([1, 2]);
  });

  test('attempt numbering is per task', () => {
    const store = makeStore();
    const plan = newPlan(store);
    const taskA = newTask(store, plan.id);
    const taskB = newTask(store, plan.id);

    store.createRun({ taskId: taskA.id, agent: 'fake', brief: 'a1', note: null });
    store.createRun({ taskId: taskA.id, agent: 'fake', brief: 'a2', note: null });
    const b1 = store.createRun({ taskId: taskB.id, agent: 'fake', brief: 'b1', note: null });

    expect(b1.attempt).toBe(1);
  });

  test('latestRun is undefined when a task has no runs', () => {
    const store = makeStore();
    const task = newTask(store, newPlan(store).id);
    expect(store.latestRun(task.id)).toBeUndefined();
  });

  test('updateRun round-trips checkPassed false and other nullable fields', () => {
    const store = makeStore();
    const task = newTask(store, newPlan(store).id);
    const run = store.createRun({ taskId: task.id, agent: 'fake', brief: 'brief', note: null });

    const updated = store.updateRun(run.id, {
      status: 'done',
      pid: null,
      exitCode: 0,
      startedAt: 1000,
      endedAt: 2500,
      durationMs: 1500,
      checkPassed: false,
      inputTokens: 12,
      outputTokens: 34,
      costUsd: 0.0125,
      finalMessage: 'Xong rồi — ✓',
      errorCategory: null,
      sessionId: 'ses-123',
    });

    expect(updated.checkPassed).toBe(false);
    expect(updated.status).toBe('done');
    expect(updated.exitCode).toBe(0);
    expect(updated.durationMs).toBe(1500);
    expect(updated.costUsd).toBeCloseTo(0.0125);
    expect(updated.finalMessage).toBe('Xong rồi — ✓');
    expect(updated.sessionId).toBe('ses-123');
    expect(store.getRun(run.id)).toEqual(updated);
  });

  test('updateRun stores true/false booleans and null checkPassed', () => {
    const store = makeStore();
    const task = newTask(store, newPlan(store).id);
    const run = store.createRun({ taskId: task.id, agent: 'fake', brief: 'b', note: null });

    expect(store.updateRun(run.id, { checkPassed: true }).checkPassed).toBe(true);
    expect(store.updateRun(run.id, { checkPassed: false }).checkPassed).toBe(false);
    expect(store.updateRun(run.id, { checkPassed: null }).checkPassed).toBeNull();
  });

  test('listRuns filters by taskId and status', () => {
    const store = makeStore();
    const plan = newPlan(store);
    const taskA = newTask(store, plan.id);
    const taskB = newTask(store, plan.id);
    const a1 = store.createRun({ taskId: taskA.id, agent: 'fake', brief: '1', note: null });
    const a2 = store.createRun({ taskId: taskA.id, agent: 'fake', brief: '2', note: null });
    const b1 = store.createRun({ taskId: taskB.id, agent: 'fake', brief: '3', note: null });
    store.updateRun(a2.id, { status: 'done' });

    expect(store.listRuns().map((r) => r.id).sort()).toEqual([a1.id, a2.id, b1.id].sort());
    expect(store.listRuns({ taskId: taskA.id }).map((r) => r.id)).toEqual([a1.id, a2.id]);
    expect(store.listRuns({ status: 'done' }).map((r) => r.id)).toEqual([a2.id]);
    expect(store.listRuns({ taskId: taskB.id, status: 'done' })).toEqual([]);
  });

  test('updateRun throws for an unknown run', () => {
    const store = makeStore();
    expect(() => store.updateRun('r-nope', { status: 'done' })).toThrow();
  });
});

describe('events', () => {
  test('appendEvent assigns per-run seq starting at 1 and writes one JSON line each', () => {
    const store = makeStore();
    const task = newTask(store, newPlan(store).id);
    const runA = store.createRun({ taskId: task.id, agent: 'fake', brief: 'a', note: null });
    const runB = store.createRun({ taskId: task.id, agent: 'fake', brief: 'b', note: null });

    const before = Date.now();
    const first = store.appendEvent(runA.id, { kind: 'message', text: 'xin chào' });
    const second = store.appendEvent(runA.id, { kind: 'error', text: 'hỏng', category: 'agent' });
    const third = store.appendEvent(runA.id, { kind: 'status', status: 'running' });
    const other = store.appendEvent(runB.id, { kind: 'message', text: 'khác' });

    expect(first.seq).toBe(1);
    expect(second.seq).toBe(2);
    expect(third.seq).toBe(3);
    expect(other.seq).toBe(1);
    expect(first.runId).toBe(runA.id);
    expect(first.ts).toBeGreaterThanOrEqual(before);
    expect(first.event).toEqual({ kind: 'message', text: 'xin chào' });

    expect(store.readEvents(runA.id).map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(store.readEvents(runB.id).map((e) => e.seq)).toEqual([1]);
  });

  test('readEvents supports afterSeq and tail', () => {
    const store = makeStore();
    const task = newTask(store, newPlan(store).id);
    const run = store.createRun({ taskId: task.id, agent: 'fake', brief: 'b', note: null });
    store.appendEvent(run.id, { kind: 'message', text: 'one' });
    store.appendEvent(run.id, { kind: 'message', text: 'two' });
    store.appendEvent(run.id, { kind: 'message', text: 'three' });

    expect(store.readEvents(run.id, { afterSeq: 1 }).map((e) => e.seq)).toEqual([2, 3]);
    expect(store.readEvents(run.id, { tail: 1 }).map((e) => e.seq)).toEqual([3]);
    expect(store.readEvents(run.id, { afterSeq: 1, tail: 1 }).map((e) => e.seq)).toEqual([3]);
    expect(store.readEvents(run.id, { afterSeq: 99 })).toEqual([]);
    expect(store.readEvents(run.id, { tail: 0 })).toEqual([]);
  });

  test('readEvents returns [] when the run has no log file', () => {
    const store = makeStore();
    expect(store.readEvents('r-missing')).toEqual([]);
  });

  test('events with Vietnamese text round-trip byte-for-byte', () => {
    const store = makeStore();
    const task = newTask(store, newPlan(store).id);
    const run = store.createRun({ taskId: task.id, agent: 'fake', brief: 'b', note: null });
    const text = 'Sửa "lỗi" ở \'đây\'\nDòng 2 — ✓ 🚀';

    store.appendEvent(run.id, { kind: 'message', text });
    store.appendEvent(run.id, {
      kind: 'check',
      cmd: 'npm test',
      passed: false,
      output: 'LỖI: không tìm thấy tệp',
    });

    const events = store.readEvents(run.id);
    expect(events).toHaveLength(2);
    expect(events[0]!.event).toEqual({ kind: 'message', text });
    expect(events[1]!.event).toEqual({
      kind: 'check',
      cmd: 'npm test',
      passed: false,
      output: 'LỖI: không tìm thấy tệp',
    });
  });

  test('event seq continues from the log file after a new Store opens it', () => {
    const first = makeStore();
    const task = newTask(first, newPlan(first).id);
    const run = first.createRun({ taskId: task.id, agent: 'fake', brief: 'b', note: null });
    first.appendEvent(run.id, { kind: 'message', text: 'one' });
    first.appendEvent(run.id, { kind: 'message', text: 'two' });

    const second = makeStore();
    const third = second.appendEvent(run.id, { kind: 'message', text: 'three' });

    expect(third.seq).toBe(3);
    expect(second.readEvents(run.id).map((e) => e.seq)).toEqual([1, 2, 3]);
  });
});

describe('persistence', () => {
  test('a second Store on the same file sees data written by the first', () => {
    const first = makeStore();
    const plan = newPlan(first);
    const task = newTask(first, plan.id, 'npm test');
    const run = first.createRun({ taskId: task.id, agent: 'fake', brief: 'brief', note: null });
    first.updateTask(task.id, { status: 'running' });
    first.updateRun(run.id, { status: 'running', pid: 4321, startedAt: 99 });
    first.appendEvent(run.id, { kind: 'message', text: 'đang chạy' });

    const second = makeStore();

    expect(second.getPlan(plan.id)).toEqual(first.getPlan(plan.id));
    expect(second.getTask(task.id)).toEqual(first.getTask(task.id));
    expect(second.getRun(run.id)).toEqual(first.getRun(run.id));
    expect(second.readEvents(run.id)).toEqual(first.readEvents(run.id));
  });

  test('WAL journal mode is enabled', () => {
    const store = makeStore();
    expect(store.journalMode()).toBe('wal');
  });
});