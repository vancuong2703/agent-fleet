import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import type { EventEmitter } from 'node:events';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { BusMsg, Plan, Task, TaskResult } from '../../shared/types.js';
import { getAdapter } from '../../server/adapters/index.js';
import { buildServer } from '../../server/api.js';
import { Bus } from '../../server/bus.js';
import type { FleetConfig } from '../../server/config.js';
import { files } from '../../server/paths.js';
import { FleetError, TaskService } from '../../server/service.js';
import { Store } from '../../server/store.js';
import { makeTempRepo } from '../helpers/repo.js';

const token = '0123456789abcdef0123456789abcdef';
const headers = { 'x-fleet-token': token };
// ws is supplied transitively by @fastify/websocket; no new dependency/types needed.
type WsClient = EventEmitter & { close(): void; terminate(): void };
const WebSocket = createRequire(import.meta.url)('ws') as new (
  url: string, options: { headers?: Record<string, string> },
) => WsClient;
let root: string;
let repo: string;
let store: Store;
let service: TaskService;
let bus: Bus;
let app: FastifyInstance;
let sockets: WsClient[];

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'fleet api-'));
  vi.stubEnv('FLEET_DATA_DIR', root);
  repo = await makeTempRepo();
  const agent = { bin: null, maxParallel: 2, extraArgs: [] };
  const config: FleetConfig = {
    port: 4500,
    agents: { codex: { ...agent }, qodercli: { ...agent }, agy: { ...agent }, opencode: { ...agent } },
    maxParallelTotal: 4,
    timeouts: { totalMin: 1, idleMin: 1 },
  };
  await writeFile(files.config(), JSON.stringify(config));
  store = new Store(files.db());
  bus = new Bus();
  service = new TaskService({ store, bus, config });
  app = buildServer({ service, store, bus, token });
  sockets = [];
});

test.each(['SIGINT', 'SIGTERM'] as const)('server entry starts on loopback, writes PID and closes in order on %s', async (signal) => {
  const order: string[] = [];
  const entryStore = { close: vi.fn(() => { order.push('store.close'); }) };
  const entryService = {
    recover: vi.fn(() => { order.push('recover'); }),
    close: vi.fn(async () => { order.push('service.close'); }),
  };
  const entryApp = {
    listen: vi.fn(async () => { order.push('listen'); return 'http://127.0.0.1:4567'; }),
    close: vi.fn(async () => { order.push('app.close'); }),
  };
  const handlers = new Map<string, () => void>();
  vi.spyOn(process, 'once').mockImplementation((event, listener) => {
    if (event === 'SIGINT' || event === 'SIGTERM') handlers.set(event, listener);
    return process;
  });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { order.push(`exit:${code}`); }) as typeof process.exit);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  const build = vi.fn(() => entryApp);
  vi.doMock('../../server/api.js', () => ({
    buildServer: build,
    createPtyResolver: () => () => ({ cmd: 'cmd.exe', args: [], cwd: '.' }),
  }));
  vi.doMock('../../server/config.js', () => ({ loadConfig: () => ({ port: 4567 }), readOrCreateToken: () => token }));
  vi.doMock('../../server/store.js', () => ({ Store: class { constructor() { return entryStore; } } }));
  vi.doMock('../../server/service.js', () => ({ TaskService: class { constructor() { return entryService; } } }));
  vi.resetModules();
  try {
    await import('../../server/main.js');
    expect(entryService.recover).toHaveBeenCalledOnce();
    expect(entryApp.listen).toHaveBeenCalledWith({ port: 4567, host: '127.0.0.1' });
    expect(build).toHaveBeenCalledWith({ service: entryService, store: entryStore, bus: expect.any(Object), token, ptyManager: expect.any(Object) });
    expect(log).toHaveBeenCalledExactlyOnceWith('Agent fleet server on http://127.0.0.1:4567');
    expect(await readFile(path.join(root, 'server.pid'), 'utf8')).toBe(String(process.pid));
    expect(order).toEqual(['recover', 'listen']);
    await handlers.get(signal)!();
    expect(order).toEqual(['recover', 'listen', 'service.close', 'app.close', 'store.close', 'exit:0']);
    await handlers.get(signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT')!();
    expect(entryService.close).toHaveBeenCalledOnce();
  } finally {
    for (const module of ['api', 'config', 'store', 'service']) vi.doUnmock(`../../server/${module}.js`);
    vi.resetModules();
  }
});

afterEach(async () => {
  for (const socket of sockets) socket.terminate();
  await app.close();
  await service.close();
  store.close();
  // Both targets are temporary roots created by this test.
  await rm(root, { recursive: true, force: true });
  await rm(path.dirname(repo), { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function post(url: string, payload?: object) {
  return app.inject({ method: 'POST', url, headers, ...(payload === undefined ? {} : { payload }) });
}

async function createTask(brief = 'Sửa "lỗi"\n✓'): Promise<Task> {
  const planResponse = await post('/api/plans', { name: 'API plan', repoPath: repo });
  expect(planResponse.statusCode).toBe(200);
  const plan = planResponse.json<Plan>();
  const response = await post('/api/tasks', { planId: plan.id, agent: 'fake', title: 'Write file', brief });
  expect(response.statusCode).toBe(200);
  return response.json<Task>();
}

async function wait(task: Task): Promise<TaskResult> {
  const response = await post('/api/wait', { ids: [task.id], timeoutMs: 8_000 });
  expect(response.statusCode).toBe(200);
  return response.json<TaskResult[]>()[0]!;
}

async function connect(suffix = `?token=${token}`, authHeaders?: Record<string, string>) {
  if (!app.server.listening) await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP address');
  const socket = new WebSocket(`ws://127.0.0.1:${address.port}/ws${suffix}`, { headers: authHeaders });
  sockets.push(socket);
  return socket;
}

describe('HTTP and WebSocket API', () => {
  test('health is public; API requires a matching header or cookie, including unknown API paths', async () => {
    expect((await app.inject('/api/health')).json()).toEqual({ ok: true });
    for (const url of ['/api/plans', '/api/tasks', '/api/stats', '/api/missing', '/ws', '/ws/pty']) {
      expect((await app.inject(url)).statusCode).toBe(401);
    }
    for (const value of ['wrong', 'x'.repeat(token.length), '✓'.repeat(token.length)]) {
      expect((await app.inject({ url: '/api/plans', headers: { 'x-fleet-token': value } })).statusCode).toBe(401);
    }
    expect((await app.inject({ url: '/api/plans', headers })).statusCode).toBe(200);
    expect((await app.inject({ url: '/api/plans', headers: { cookie: `other=1; fleet_token=${token}` } })).statusCode).toBe(200);
    expect((await app.inject(`/api/plans?token=${token}`)).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/plans', headers: { 'content-type': 'application/json' }, payload: '{invalid' })).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/plans', headers: { cookie: 'fleet_token=%broken' } })).statusCode).toBe(401);
  });

  test('/auth validates the query token and issues an HttpOnly cookie usable by the client', async () => {
    expect((await app.inject('/auth')).statusCode).toBe(401);
    expect((await app.inject('/auth?token=wrong')).statusCode).toBe(401);
    const response = await app.inject(`/auth?token=${token}`);
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/');
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('Path=/');
    const cookie = String(response.headers['set-cookie']).split(';')[0]!;
    expect((await app.inject({ url: '/api/plans', headers: { cookie } })).json()).toEqual([]);
  });

  test('full HTTP flow streams bus messages, lists history/events/diff and merges', async () => {
    const socket = await connect();
    const messages: BusMsg[] = [];
    socket.on('message', (data) => messages.push(JSON.parse(data.toString())));
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    const task = await createTask();
    const result = await wait(task);
    expect(result.task.status).toBe('done');
    expect(result.run?.finalMessage).toBe('Sửa "lỗi"\n✓');
    expect((await app.inject({ url: '/api/plans', headers })).json()).toHaveLength(1);
    expect((await app.inject({ url: `/api/tasks?planId=${task.planId}&status=done`, headers })).json()).toEqual([result.task]);
    expect((await app.inject({ url: '/api/tasks?status=failed', headers })).json()).toEqual([]);
    expect((await app.inject({ url: `/api/tasks/${task.id}`, headers })).json()).toEqual(result);
    expect((await app.inject({ url: `/api/tasks/${task.id}/runs`, headers })).json()).toEqual([result.run]);
    const events = store.readEvents(result.run!.id);
    expect((await app.inject({ url: `/api/runs/${result.run!.id}/events?afterSeq=1&tail=2`, headers })).json()).toEqual(events.filter((event) => event.seq > 1).slice(-2));
    const diff = (await app.inject({ url: `/api/tasks/${task.id}/diff`, headers })).json();
    expect(diff.files).toContainEqual({ path: 'fake.txt', added: 1, removed: 0 });
    expect(diff.patch).toContain('+fake agent completed');
    expect((await post(`/api/tasks/${task.id}/merge`)).json()).toEqual({ ok: true });
    expect((await app.inject({ url: `/api/tasks/${task.id}`, headers })).json().task.status).toBe('merged');
    expect((await app.inject({ url: `/api/tasks/${task.id}/diff`, headers })).json()).toEqual({ files: [], patch: '' });
    await vi.waitFor(() => {
      expect(messages.some((message) => message.type === 'event')).toBe(true);
      expect(messages.some((message) => message.type === 'task' && message.task.status === 'merged')).toBe(true);
    });
  });

  test.each(['header', 'cookie'])('WS accepts %s auth and unsubscribes when the client closes', async (auth) => {
    const originalOn = bus.on.bind(bus);
    const off = vi.fn();
    const listener = vi.spyOn(bus, 'on').mockImplementation((fn) => {
      const unsubscribe = originalOn(fn);
      off.mockImplementation(unsubscribe);
      return off;
    });
    const socket = await connect('', auth === 'header' ? headers : { cookie: `fleet_token=${token}` });
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    expect(listener).toHaveBeenCalledOnce();
    // A closed client must no longer receive bus messages or cause send errors.
    await new Promise<void>((resolve) => { socket.once('close', () => resolve()); socket.close(); });
    bus.emit({ type: 'plan', plan: store.createPlan({ name: 'closed', repoPath: repo, baseBranch: 'main' }) });
    await vi.waitFor(() => expect(off).toHaveBeenCalledOnce());
  });

  test.each(['', '?token=wrong'])('WS rejects unauthenticated upgrade %s with 401', async (suffix) => {
    const socket = await connect(suffix);
    const status = await new Promise<number | undefined>((resolve, reject) => {
      socket.once('unexpected-response', (request, response) => {
        response.resume();
        request.destroy();
        resolve(response.statusCode);
      });
      socket.once('open', () => reject(new Error('Unauthenticated WS opened')));
      socket.on('error', () => {});
    });
    expect(status).toBe(401);
  });

  test('retry, stop, takeover, done and discard delegate lifecycle changes', async () => {
    const task = await createTask();
    await wait(task);
    const retry = await post(`/api/tasks/${task.id}/retry`, { note: 'try again' });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ attempt: 2, note: 'try again' });
    await wait(task);
    expect((await post(`/api/tasks/${task.id}/discard`)).statusCode).toBe(204);
    expect(store.getTask(task.id)?.status).toBe('discarded');
    const hang = await createTask('[[hang]]');
    await vi.waitFor(() => expect(store.getTask(hang.id)?.status).toBe('running'));
    expect((await post(`/api/tasks/${hang.id}/takeover`)).statusCode).toBe(204);
    expect(store.getTask(hang.id)?.status).toBe('taken_over');
    expect((await post(`/api/tasks/${hang.id}/done`)).statusCode).toBe(204);
    expect(store.getTask(hang.id)?.status).toBe('done');
    const stopped = await createTask('[[hang]]');
    expect((await post(`/api/tasks/${stopped.id}/stop`)).statusCode).toBe(204);
    expect(store.getTask(stopped.id)?.status).toBe('interrupted');
  });

  test('merge refusal returns 200 and its reason', async () => {
    const task = await createTask();
    await wait(task);
    await writeFile(path.join(repo, 'dirty.txt'), 'keep');
    const response = await post(`/api/tasks/${task.id}/merge`);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: false, reason: 'dirty' });
  });

  test.each(['', '/runs', '/diff'])('unknown task %s returns not_found', async (suffix) => {
    const response = await app.inject({ url: `/api/tasks/missing${suffix}`, headers });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: 'not_found', message: expect.any(String) });
  });

  test('unknown run returns not_found', async () => {
    expect((await app.inject({ url: '/api/runs/missing/events', headers })).statusCode).toBe(404);
  });

  test.each([
    ['not_found', 404], ['bad_request', 400], ['agent_unavailable', 409], ['conflict', 409], ['invalid_state', 409],
  ] as const)('maps FleetError %s to %i', async (code, status) => {
    vi.spyOn(service, 'createPlan').mockRejectedValueOnce(new FleetError(code, 'detail'));
    const response = await post('/api/plans', { name: 'x', repoPath: repo });
    expect(response.statusCode).toBe(status);
    expect(response.json()).toEqual({ error: code, message: 'detail' });
  });

  test('unexpected errors return 500', async () => {
    vi.spyOn(service, 'createPlan').mockRejectedValueOnce(new Error('unexpected'));
    expect((await post('/api/plans', { name: 'x', repoPath: repo })).statusCode).toBe(500);
  });

  test.each([
    ['POST', '/api/plans', {}],
    ['POST', '/api/tasks', { planId: 'x', agent: 'unknown', title: 'x', brief: 'x' }],
    ['POST', '/api/tasks/missing/retry', {}],
    ['POST', '/api/wait', { ids: 'not-an-array', timeoutMs: 1 }],
    ['POST', '/api/wait', { ids: [], timeoutMs: -1 }],
    ['GET', '/api/runs/missing/events?afterSeq=bad', undefined],
    ['GET', '/api/stats?sinceDays=bad', undefined],
  ] as const)('invalid input %s %s returns bad_request', async (method, url, payload) => {
    const response = await app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('bad_request');
  });

  test('agents includes all configured ids, detected status and parallel limits, excluding fake', async () => {
    vi.spyOn(getAdapter('codex'), 'detect').mockResolvedValue({ ok: true, version: 'test-version' });
    const response = await app.inject({ url: '/api/agents', headers });
    expect(response.statusCode).toBe(200);
    const rows = response.json();
    expect(rows.map((row: { id: string }) => row.id).sort()).toEqual(['agy', 'codex', 'opencode', 'qodercli']);
    expect(rows).toContainEqual({ id: 'codex', ok: true, version: 'test-version', maxParallel: 2 });
    expect(rows).toContainEqual({ id: 'opencode', ok: false, reason: expect.any(String), maxParallel: 2 });
  });

  test('stats computes real results and filters repo paths and relative days', async () => {
    const plan = store.createPlan({ name: 'stats', repoPath: repo, baseBranch: 'main' });
    const other = store.createPlan({ name: 'other', repoPath: root, baseBranch: 'main' });
    for (const [planId, age, agent] of [[plan.id, 1, 'fake'], [plan.id, 10, 'fake'], [other.id, 1, 'codex']] as const) {
      const task = store.createTask({ planId, agent, title: 'stats', branch: 'unused', worktreePath: root, checkCmd: null });
      store.updateTask(task.id, { status: 'done', createdAt: Date.now() - age * 86_400_000 });
      const run = store.createRun({ taskId: task.id, agent, brief: '', note: null });
      store.updateRun(run.id, { status: 'done', durationMs: 100 });
    }
    const all = (await app.inject({ url: '/api/stats', headers })).json();
    expect(all).toHaveLength(2);
    const filtered = (await app.inject({ url: `/api/stats?repo=${encodeURIComponent(repo)}&sinceDays=7`, headers })).json();
    expect(filtered).toEqual([{ agent: 'fake', runs: 1, successRate: 1, avgDurationMs: 100, retryRate: 0, mergeRate: null, costUsd: null }]);
  });

  test('serves static assets and SPA fallback publicly, with no fallback for API or WS paths', async () => {
    await app.close();
    const webDist = path.join(root, 'web');
    await mkdir(webDist);
    await writeFile(path.join(webDist, 'index.html'), '<html>Fleet UI</html>');
    await writeFile(path.join(webDist, 'app.js'), 'console.log("fleet");');
    app = buildServer({ service, store, bus, token, webDist });
    for (const url of ['/', '/plans/selected']) {
      const response = await app.inject(url);
      expect(response.statusCode).toBe(200);
      expect(response.body).toBe('<html>Fleet UI</html>');
    }
    expect((await app.inject('/app.js')).body).toBe('console.log("fleet");');
    for (const url of ['/api/missing', '/ws/missing']) {
      expect((await app.inject({ url, headers })).statusCode).toBe(404);
    }
    expect((await app.inject({ method: 'POST', url: '/plans/selected' })).statusCode).toBe(404);
  });
});
