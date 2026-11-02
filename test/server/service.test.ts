import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { AgentId, BusMsg, Plan, Task } from '../../shared/types.js';
import { getAdapter } from '../../server/adapters/index.js';
import type { AgentAdapter } from '../../server/adapters/types.js';
import { Bus } from '../../server/bus.js';
import type { FleetConfig } from '../../server/config.js';
import { git } from '../../server/git.js';
import { files } from '../../server/paths.js';
import { isAlive } from '../../server/process.js';
import { FleetError, TaskService } from '../../server/service.js';
import { Store } from '../../server/store.js';
import { makeTempRepo } from '../helpers/repo.js';

let root: string;
let repo: string;
let store: Store;
let bus: Bus;
let config: FleetConfig;
let service: TaskService;
let plan: Plan;
let messages: BusMsg[];

const fakeBacked = (id: AgentId): AgentAdapter => ({ ...getAdapter('fake'), id });

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'fleet service-'));
  vi.stubEnv('FLEET_DATA_DIR', root);
  repo = await makeTempRepo();
  store = new Store(files.db());
  bus = new Bus();
  messages = [];
  bus.on((message) => messages.push(message));
  config = {
    port: 4500,
    agents: {
      codex: { bin: process.execPath, maxParallel: 1, extraArgs: [] },
      qodercli: { bin: process.execPath, maxParallel: 1, extraArgs: [] },
      agy: { bin: process.execPath, maxParallel: 1, extraArgs: [] },
      opencode: { bin: process.execPath, maxParallel: 1, extraArgs: [] },
    },
    maxParallelTotal: 4,
    timeouts: { totalMin: 0.15, idleMin: 0.1 },
  };
  service = new TaskService({ store, bus, config });
  plan = await service.createPlan({ name: 'Editor Việt', repoPath: repo });
});

afterEach(async () => {
  await service.close();
  store.close();
  // Both roots were created by this test; close processes and SQLite first.
  await rm(root, { recursive: true, force: true });
  await rm(path.dirname(repo), { recursive: true, force: true });
  vi.unstubAllEnvs();
});

function run(brief = 'Sửa "lỗi" ở đây\n✓', agent: AgentId = 'fake'): Promise<Task> {
  return service.run({ planId: plan.id, title: 'Write fake file', agent, brief });
}

async function running(task: Task): Promise<void> {
  await vi.waitFor(() => expect(store.getTask(task.id)?.status).toBe('running'));
}

async function finished(task: Task) {
  return (await service.wait([task.id], 8_000))[0]!;
}

describe('TaskService', () => {
  test('creates a plan with the current branch, normalized path and bus message', () => {
    expect(plan).toMatchObject({ slug: 'editor-viet', repoPath: path.win32.resolve(repo), baseBranch: 'main' });
    expect(messages).toContainEqual({ type: 'plan', plan });
  });

  test('rejects non-git paths without creating a plan', async () => {
    await expect(service.createPlan({ name: 'bad', repoPath: root })).rejects.toMatchObject({ code: 'bad_request' });
    expect(store.listPlans()).toHaveLength(1);
  });

  test('run → wait → result persists all bookkeeping, brief, events and diff', async () => {
    const task = await run();
    expect(task.worktreePath).toBe(files.worktree(path.basename(repo), task.id));
    expect(task.branch).toBe(`fleet/${plan.slug}/${task.id}`);
    const result = await finished(task);
    expect(result.task.status).toBe('done');
    expect(result.files).toContainEqual({ path: 'fake.txt', added: 1, removed: 0 });
    expect(result.run).toMatchObject({ attempt: 1, status: 'done', exitCode: 0, finalMessage: 'Sửa "lỗi" ở đây\n✓', errorCategory: null });
    expect(result.run!.pid).toBeGreaterThan(0);
    expect(result.run!.startedAt).toBeGreaterThan(0);
    expect(result.run!.endedAt).toBe(result.task.finishedAt);
    expect(result.run!.durationMs).toBe(result.run!.endedAt! - result.run!.startedAt!);
    expect(await readFile(files.brief(result.run!.id), 'utf8')).toBe(result.run!.brief);
    const events = store.readEvents(result.run!.id);
    expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
    expect(messages.filter((m) => m.type === 'event').map((m) => m.stored)).toEqual(events);
    expect(messages).toContainEqual({ type: 'task', task: result.task });
    expect(messages).toContainEqual({ type: 'run', run: result.run });
    expect(messages).toContainEqual(expect.objectContaining({ type: 'run', run: expect.objectContaining({ status: 'running', pid: expect.any(Number) }) }));
  });

  test('retry uses the original brief and latest note in the same worktree', async () => {
    const task = await run('original');
    await finished(task);
    const second = await service.retry(task.id, { note: 'fix tests' });
    expect(second).toMatchObject({ attempt: 2, brief: 'original\n\n## Ghi chú lần thử 2\nfix tests', note: 'fix tests' });
    await finished(task);
    const third = await service.retry(task.id, { note: 'last note' });
    expect(third.brief).toBe('original\n\n## Ghi chú lần thử 3\nlast note');
    expect((await finished(task)).task.worktreePath).toBe(task.worktreePath);
    expect(store.listRuns({ taskId: task.id })).toHaveLength(3);
  });

  test('per-agent limit queues FIFO while another agent can run', async () => {
    await service.close();
    service = new TaskService({ store, bus, config, adapters: fakeBacked });
    const first = await run('[[hang]]', 'codex');
    await running(first);
    const second = await run('[[slow]]', 'codex');
    const third = await run('[[slow]]', 'codex');
    const other = await run('[[hang]]', 'qodercli');
    await running(other);
    expect(store.getTask(second.id)?.status).toBe('queued');
    expect(store.getTask(third.id)?.status).toBe('queued');
    await service.stop(first.id);
    await running(second);
    expect(store.getTask(third.id)?.status).toBe('queued');
    expect((await finished(second)).task.status).toBe('done');
    expect((await finished(third)).task.status).toBe('done');
  });

  test('global limit queues immediately and stop queued never spawns', async () => {
    config.maxParallelTotal = 1;
    const first = await run('[[hang]]');
    await running(first);
    const second = await run('[[slow]]');
    expect(store.getTask(second.id)?.status).toBe('queued');
    await service.stop(second.id);
    expect(store.latestRun(second.id)).toMatchObject({ status: 'interrupted', pid: null, startedAt: null });
    await service.stop(first.id);
    expect((await finished(second)).task.status).toBe('interrupted');
  });

  test('stop waits for the running process to die and persists interrupted', async () => {
    const task = await run('[[hang]]');
    await running(task);
    const pid = store.latestRun(task.id)!.pid!;
    await service.stop(task.id);
    expect(isAlive(pid)).toBe(false);
    expect((await finished(task)).run!.status).toBe('interrupted');
  });

  test('takeOver waits for shutdown, then markDone updates both task and run', async () => {
    const task = await run('[[hang]]');
    await running(task);
    await service.takeOver(task.id);
    expect(store.getTask(task.id)?.status).toBe('taken_over');
    expect(store.latestRun(task.id)?.status).toBe('taken_over');
    await service.markDone(task.id);
    expect((await finished(task)).run!.status).toBe('done');
  });

  test('merge commits changes, removes worktree and branch, preserves run history', async () => {
    const task = await run();
    await finished(task);
    expect(await service.merge(task.id)).toEqual({ ok: true });
    expect(await readFile(path.join(repo, 'fake.txt'), 'utf8')).toBe('fake agent completed\n');
    expect(existsSync(task.worktreePath)).toBe(false);
    expect((await git(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${task.branch}`])).code).toBe(1);
    expect(await service.result(task.id)).toMatchObject({ task: { status: 'merged' }, run: { status: 'done' }, files: [] });
  });

  test('merge refuses a dirty original repo and keeps task done', async () => {
    const task = await run();
    await finished(task);
    await writeFile(path.join(repo, 'dirty.txt'), 'keep');
    expect(await service.merge(task.id)).toEqual({ ok: false, reason: 'dirty' });
    expect(store.getTask(task.id)?.status).toBe('done');
    expect(existsSync(task.worktreePath)).toBe(true);
  });

  test('discard stops running work, deletes branch and returns empty files', async () => {
    const task = await run('[[hang]]');
    await running(task);
    const pid = store.latestRun(task.id)!.pid!;
    await service.discard(task.id);
    expect(isAlive(pid)).toBe(false);
    expect(existsSync(task.worktreePath)).toBe(false);
    expect((await git(repo, ['show-ref', '--verify', '--quiet', `refs/heads/${task.branch}`])).code).toBe(1);
    expect(await service.result(task.id)).toMatchObject({ task: { status: 'discarded' }, files: [] });
  });

  test.each([999999, null])('recover marks orphaned running pid %s interrupted and preserves logs', async (pid) => {
    const task = await run();
    const result = await finished(task);
    await service.close();
    store.updateRun(result.run!.id, { status: 'running', pid, endedAt: null });
    store.updateTask(task.id, { status: 'running', finishedAt: null });
    service = new TaskService({ store, bus, config });
    service.recover();
    expect(store.latestRun(task.id)).toMatchObject({ status: 'interrupted', endedAt: expect.any(Number) });
    expect(store.getTask(task.id)?.status).toBe('interrupted');
    expect(store.readEvents(result.run!.id)).toContainEqual(expect.objectContaining({ event: { kind: 'message', text: result.run!.brief } }));
  });

  test('recover kills a surviving orphan, marks it interrupted, and schedules queued work once', async () => {
    config.maxParallelTotal = 0;
    const live = await run('[[hang]]');
    const queued = await run();
    // A real process stands in for an agent that outlived the previous server.
    const orphan = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
    store.updateRun(store.latestRun(live.id)!.id, { status: 'running', pid: orphan.pid! });
    store.updateTask(live.id, { status: 'running' });
    config.maxParallelTotal = 1;
    service.recover();
    service.recover();
    expect(store.getTask(live.id)?.status).toBe('interrupted');
    await new Promise<void>((resolve) => { if (orphan.exitCode !== null || orphan.signalCode !== null) resolve(); else orphan.once('exit', () => resolve()); });
    expect(isAlive(orphan.pid!)).toBe(false);
    expect((await finished(queued)).task.status).toBe('done');
    expect(store.readEvents(store.latestRun(queued.id)!.id).filter((e) => e.event.kind === 'message')).toHaveLength(1);
  });

  test('wait times out with current running state and supports empty/multiple ids', async () => {
    const task = await run('[[hang]]');
    await running(task);
    const started = Date.now();
    expect((await service.wait([task.id], 300))[0]!.task.status).toBe('running');
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
    expect(await service.wait([], 300)).toEqual([]);
    await service.stop(task.id);
    expect(await service.wait([task.id, task.id], 300)).toHaveLength(2);
  });

  test('unavailable bin rejects before creating a worktree or task', async () => {
    config.agents.codex.bin = null;
    await expect(run('hi', 'codex')).rejects.toMatchObject({ code: 'agent_unavailable' });
    expect(store.listTasks()).toEqual([]);
    expect(existsSync(path.join(root, 'worktrees'))).toBe(false);
  });

  test('detect failure rejects before creating a task', async () => {
    await service.close();
    service = new TaskService({ store, bus, config, adapters: (id) => ({ ...fakeBacked(id), detect: async () => ({ ok: false, reason: 'auth required' }) }) });
    await expect(run()).rejects.toMatchObject({ code: 'agent_unavailable', message: expect.stringContaining('auth required') });
    expect(store.listTasks()).toEqual([]);
  });

  test('worktree creation failure leaves no task or run', async () => {
    const bad = await service.createPlan({ name: 'missing base', repoPath: repo, baseBranch: 'missing' });
    await expect(service.run({ planId: bad.id, agent: 'fake', title: 'bad', brief: 'hi' })).rejects.toThrow();
    expect(store.listTasks()).toEqual([]);
    expect(store.listRuns()).toEqual([]);
  });

  test.each([['[[fail]]', 'failed', 'agent'], ['[[quota]]', 'failed', 'quota']] as const)('persists %s outcome', async (brief, status, errorCategory) => {
    expect((await finished(await run(brief))).run).toMatchObject({ status, errorCategory, endedAt: expect.any(Number) });
  });

  test('timeouts use the injected config in minutes', async () => {
    config.timeouts = { totalMin: 0.01, idleMin: 0.005 };
    expect((await finished(await run('[[hang]]'))).run!.status).toBe('timeout');
  });

  test('persists usage, session and failed check without changing done status', async () => {
    await service.close();
    const data = [
      { type: 'usage', inputTokens: 5, outputTokens: 2, costUsd: 0.1 },
      { type: 'session', id: 'session-1' }, { type: 'message', text: 'finished' },
    ].map((e) => JSON.stringify(e)).join('\n');
    service = new TaskService({ store, bus, config, adapters: (id) => ({
      ...fakeBacked(id), headless: () => ({ cmd: process.execPath, args: ['-e', `process.stdout.write(${JSON.stringify(data)})`] }),
    }) });
    const task = await service.run({ planId: plan.id, agent: 'fake', title: 'usage', brief: 'hi', checkCmd: 'exit 1' });
    expect((await finished(task)).run).toMatchObject({ status: 'done', checkPassed: false, inputTokens: 5, outputTokens: 2, costUsd: 0.1, sessionId: 'session-1', finalMessage: 'finished' });
  });

  test('rejects unknown ids and invalid lifecycle transitions', async () => {
    await expect(service.result('missing')).rejects.toBeInstanceOf(FleetError);
    await expect(service.wait(['missing'], 100)).rejects.toMatchObject({ code: 'not_found' });
    const task = await run('[[hang]]');
    await running(task);
    await expect(service.retry(task.id, { note: 'no' })).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(service.merge(task.id)).rejects.toMatchObject({ code: 'invalid_state' });
    await expect(service.markDone(task.id)).rejects.toMatchObject({ code: 'invalid_state' });
  });

  test('close aborts active attempts, waits for death and leaves queued work unspawned', async () => {
    config.maxParallelTotal = 1;
    const active = await run('[[hang]]');
    await running(active);
    const queued = await run();
    const pid = store.latestRun(active.id)!.pid!;
    await service.close();
    expect(isAlive(pid)).toBe(false);
    expect(store.getTask(active.id)?.status).toBe('interrupted');
    expect(store.latestRun(queued.id)).toMatchObject({ status: 'queued', pid: null });
    await service.close();
  });
});

test('Bus unsubscribe removes only its listener and supports many waiters', () => {
  const bus = new Bus();
  const listener = vi.fn();
  const off = bus.on(listener);
  const message: BusMsg = { type: 'plan', plan: { id: 'p-test', name: 'test', slug: 'test', repoPath: 'C:\\repo', baseBranch: 'main', createdAt: 0 } };
  bus.emit(message);
  off();
  bus.emit(message);
  expect(listener).toHaveBeenCalledExactlyOnceWith(message);
});
