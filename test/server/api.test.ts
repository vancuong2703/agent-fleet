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
import type { PtyManager } from '../../server/pty.js';
import { FleetError, TaskService } from '../../server/service.js';
import { Store } from '../../server/store.js';
import * as worktree from '../../server/worktree.js';
import { makeTempRepo } from '../helpers/repo.js';
import { corruptRunsIndex, seedDatabase } from './db-corruption-helper.js';

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

test('leader instructions require authentication, reflect this profile and contain no token', async () => {
  const anonymous = await app.inject({ url: '/api/leader-guide' });
  expect(anonymous.statusCode).toBe(401);
  const response = await app.inject({ url: '/api/leader-guide', headers });
  expect(response.statusCode).toBe(200);
  expect(response.headers['cache-control']).toBe('no-store');
  expect(response.json().dataDir).toBe(root);
  expect(response.json().content).toContain('function fleet');
  expect(response.body).not.toContain(token);
});

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

test.each(['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK', 'EADDRINUSE'] as const)('server entry listens before recovery and handles %s', async (signal) => {
  const order: string[] = [];
  const entryStore = { close: vi.fn(() => { order.push('store.close'); }) };
  const entryService = {
    recover: vi.fn(() => { order.push('recover'); }),
    close: vi.fn(async () => { order.push('service.close'); }),
  };
  const entryApp = {
    listen: vi.fn(async () => {
      order.push('listen');
      if (signal === 'EADDRINUSE') throw Object.assign(new Error('busy'), { code: 'EADDRINUSE' });
      return 'http://127.0.0.1:4567';
    }),
    close: vi.fn(async () => { order.push('app.close'); }),
  };
  const handlers = new Map<string, () => void>();
  vi.spyOn(process, 'once').mockImplementation((event, listener) => {
    if (typeof event === 'string' && ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK'].includes(event)) handlers.set(event, listener);
    return process;
  });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { order.push(`exit:${code}`); }) as typeof process.exit);
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const build = vi.fn(() => entryApp);
  vi.doMock('../../server/api.js', () => ({
    buildServer: build,
    createPtyResolver: () => () => ({ cmd: 'cmd.exe', args: [], cwd: '.' }),
  }));
  vi.doMock('../../server/config.js', () => ({ loadConfig: () => ({ port: 4567 }), readOrCreateToken: () => token }));
  vi.doMock('../../server/store.js', () => ({ Store: class { constructor() { return entryStore; } } }));
  vi.doMock('../../server/service.js', () => ({ TaskService: class { constructor() { return entryService; } } }));
  vi.resetModules();
  if (signal === 'EADDRINUSE') await writeFile(path.join(root, 'server.pid'), 'original-server');
  try {
    await import('../../server/main.js');
    if (signal === 'EADDRINUSE') {
      expect(entryService.recover).not.toHaveBeenCalled();
      expect(await readFile(path.join(root, 'server.pid'), 'utf8')).toBe('original-server');
      expect(process.exitCode).toBe(1);
      return;
    }
    expect(entryService.recover).toHaveBeenCalledOnce();
    expect(entryApp.listen).toHaveBeenCalledWith({ port: 4567, host: '127.0.0.1' });
    expect(build).toHaveBeenCalledWith({ service: entryService, store: entryStore, bus: expect.any(Object), token, ptyManager: expect.any(Object), port: 4567, shutdown: expect.any(Function) });
    expect(log).toHaveBeenCalledExactlyOnceWith('Agent fleet server on http://127.0.0.1:4567');
    expect(await readFile(path.join(root, 'server.pid'), 'utf8')).toBe(String(process.pid));
    expect(order).toEqual(['listen', 'recover']);
    await handlers.get(signal)!();
    expect(order).toEqual(['listen', 'recover', 'service.close', 'app.close', 'store.close', 'exit:0']);
    await handlers.get(signal === 'SIGINT' ? 'SIGTERM' : 'SIGINT')!();
    expect(entryService.close).toHaveBeenCalledOnce();
  } finally {
    process.exitCode = 0;
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

test('repository validation is authenticated, read-only and does not create plans or tasks', async () => {
  const route = '/api/repositories/validate';
  expect((await app.inject({ method: 'POST', url: route, payload: { repoPath: repo } })).statusCode).toBe(401);
  const response = await post(route, { repoPath: repo });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ valid: true, repoPath: repo, branch: 'main' });
  expect((await post(route, { repoPath: path.join(root, 'missing') })).json()).toMatchObject({ valid: false, repoPath: null });
  expect((await post(route, {})).statusCode).toBe(400);
  expect(store.listPlans()).toEqual([]);
  expect(store.listTasks()).toEqual([]);
});

test('GET /api/connections returns connected tool info recorded from client headers', async () => {
  const unauth = await app.inject({ method: 'GET', url: '/api/connections' });
  expect(unauth.statusCode).toBe(401);

  const clientHeaders = {
    ...headers,
    'x-fleet-client-tool': 'agy',
    'x-fleet-client-pid': '12345',
    'x-fleet-client-cwd': encodeURIComponent('C:\\projects\\fleet'),
    'x-fleet-client-cmd': encodeURIComponent('fleet connection'),
  };

  const response1 = await app.inject({ method: 'GET', url: '/api/connections', headers: clientHeaders });
  expect(response1.statusCode).toBe(200);
  const connections1 = response1.json<Array<{
    id: string;
    toolId: string;
    toolName: string;
    pid: number;
    cwd: string;
    lastCommand: string;
    requestCount: number;
  }>>();
  expect(connections1).toHaveLength(1);
  expect(connections1[0]).toMatchObject({
    id: 'agy:C:\\projects\\fleet',
    toolId: 'agy',
    toolName: 'Antigravity CLI',
    pid: 12345,
    cwd: 'C:\\projects\\fleet',
    lastCommand: 'fleet connection',
    requestCount: 1,
  });

  // Second request from same tool in same directory updates count
  const response2 = await app.inject({ method: 'GET', url: '/api/connections', headers: clientHeaders });
  expect(response2.statusCode).toBe(200);
  const connections2 = response2.json<Array<{ requestCount: number }>>();
  expect(connections2[0]?.requestCount).toBe(2);
});

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
  test('dashboard metadata and terminal mutations use the existing authentication boundary', async () => {
    for (const url of ['/api/dashboard', '/api/terminal-sessions']) {
      const response = await app.inject({ method: url.endsWith('terminal-sessions') ? 'POST' : 'GET', url, ...(url.endsWith('terminal-sessions') ? { payload: { agent: 'codex' } } : {}) });
      expect(response.statusCode).toBe(401);
    }
    expect((await app.inject({ url: '/api/dashboard', headers })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/dashboard/check', headers: { cookie: `fleet_token=${token}`, 'content-type': 'text/plain' }, payload: '{"agent":"codex"}' })).statusCode).toBe(415);
    expect((await app.inject({ method: 'POST', url: '/api/terminal-sessions', headers, payload: { agent: 'codex', cmd: 'arbitrary.exe', cwd: 'C:\\Windows' } })).statusCode).toBe(400);
  });

  test('run approval input is validated by API and persisted on AGY attempts', async () => {
    const created = await post('/api/plans', { name: 'Approval API', repoPath: repo });
    const plan = created.json<Plan>();
    expect((await post('/api/tasks', { planId: plan.id, agent: 'agy', title: 'bad command', brief: '', commandPolicy: 'invalid' })).statusCode).toBe(400);
    expect((await post('/api/tasks', { planId: plan.id, agent: 'agy', title: 'bad command', brief: '', commandPolicy: 'check-only', allowedCommands: ['one\ntwo'] })).statusCode).toBe(400);
    expect(store.listTasks()).toHaveLength(0);
  });

  test('rejects wrong Host and Origin on all paths except GET health', async () => {
    await app.close();
    app = buildServer({ service, store, bus, token, port: 4500 });
    for (const url of ['/api/plans', '/auth', '/', '/ws', '/ws/pty']) {
      for (const host of ['evil.test:4500', 'localhost:4501', '127.0.0.1', 'localhost:4500.evil.test']) {
        const response = await app.inject({ url, headers: { ...headers, host } });
        expect(response.statusCode).toBe(403);
        expect(response.json()).toEqual({ error: 'forbidden' });
      }
      expect((await app.inject({ url, headers: { ...headers, host: 'localhost:4500', origin: 'http://evil.test:4500' } })).statusCode).toBe(403);
    }
    expect((await app.inject({ url: '/api/health', headers: { host: 'evil.test', origin: 'http://evil.test' } })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/health', headers: { host: 'evil.test' } })).statusCode).toBe(403);
  });

  test('cookie mutations require JSON while same-origin cookies and header tokens work', async () => {
    const task = await createTask();
    await wait(task);
    const cookie = `fleet_token=${token}`;
    const url = `/api/tasks/${task.id}/discard`;
    const headerTask = await createTask();
    await wait(headerTask);
    for (const contentType of [undefined, 'text/plain']) {
      const response = await app.inject({ method: 'POST', url, headers: { cookie, ...(contentType ? { 'content-type': contentType } : {}) }, ...(contentType ? { payload: '{}' } : {}) });
      expect(response.statusCode).toBe(415);
      expect(store.getTask(task.id)?.status).toBe('done');
    }
    await app.close();
    app = buildServer({ service, store, bus, token, port: 4500 });
    for (const host of ['localhost:4500', '127.0.0.1:4500']) {
      expect((await app.inject({ url: '/api/plans', headers: { cookie, host, origin: `http://${host}` } })).statusCode).toBe(200);
    }
    expect((await app.inject({ method: 'POST', url, headers: { cookie, host: 'localhost:4500', origin: 'http://localhost:4500', 'content-type': 'application/json; charset=utf-8' }, payload: '{}' })).statusCode).toBe(204);
    // The header token is sufficient even without JSON or a cookie.
    expect((await app.inject({ method: 'POST', url: `/api/tasks/${headerTask.id}/discard`, headers: { ...headers, host: 'localhost:4500' } })).statusCode).toBe(204);
  });

  test.each(['', '/pty', '/terminal'])('cross-origin WS /ws%s is rejected before upgrade', async (suffix) => {
    const socket = await connect(`${suffix}?token=${token}`, { origin: 'http://evil.test' });
    const status = await new Promise<number | undefined>((resolve, reject) => {
      socket.once('unexpected-response', (request, response) => { response.resume(); request.destroy(); resolve(response.statusCode); });
      socket.once('open', () => { socket.close(); reject(new Error('Cross-origin WS opened')); });
      socket.on('error', () => {});
    });
    expect(status).toBe(403);
  });

  test.each(['queued', 'running', 'merged', 'discarded', 'taken_over', 'done', 'failed', 'timeout', 'interrupted'] as const)('PTY checks task status %s before opening', async (status) => {
    const plan = store.createPlan({ name: 'pty', repoPath: repo, baseBranch: 'main' });
    const task = store.createTask({ planId: plan.id, title: 'pty', agent: 'fake', branch: 'unused', worktreePath: repo, checkCmd: null });
    store.updateTask(task.id, { status });
    const open = vi.fn(() => ({ onData: () => () => {}, onExit: () => () => {} }));
    await app.close();
    app = buildServer({ service, store, bus, token, ptyManager: { open } as unknown as PtyManager });
    const socket = await connect(`/pty?taskId=${task.id}&token=${token}`);
    const allowed = ['taken_over', 'done', 'failed', 'timeout', 'interrupted'].includes(status);
    if (allowed) {
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      expect(open).toHaveBeenCalledWith(task.id, 80, 24);
    } else {
      const closed = await new Promise<{ code: number; reason: string }>((resolve) => {
        socket.once('close', (code, reason) => resolve({ code, reason: reason.toString() }));
      });
      expect(closed.code).toBe(1008);
      expect(closed.reason).toContain(status);
      expect(open).not.toHaveBeenCalled();
    }
  });

  test('shutdown requires authentication and replies 202 before calling shutdown', async () => {
    const shutdown = vi.fn();
    await app.close();
    app = buildServer({ service, store, bus, token, shutdown });
    expect((await app.inject({ method: 'POST', url: '/api/shutdown' })).statusCode).toBe(401);
    expect(shutdown).not.toHaveBeenCalled();
    const response = await app.inject({ method: 'POST', url: '/api/shutdown', headers });
    expect(response.statusCode).toBe(202);
    await vi.waitFor(() => expect(shutdown).toHaveBeenCalledOnce());
  });
  test('health is public; API requires a matching header or cookie, including unknown API paths', async () => {
    const health = (await app.inject('/api/health')).json();
    expect(health).toEqual({ ok: true, service: 'agent-fleet', instanceId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
    expect((await app.inject('/api/health')).json().instanceId).toBe(health.instanceId);
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


  test('/api/runs returns every run in one authenticated call; /summary returns only the task', async () => {
    const task = await createTask();
    await wait(task);
    expect((await app.inject('/api/runs')).statusCode).toBe(401);
    const runs = (await app.inject({ url: '/api/runs', headers })).json<Array<{ id: string; taskId: string }>>();
    expect(runs.map(run => run.id)).toEqual(store.listRuns().map(run => run.id));
    expect(runs.every(run => run.taskId === task.id)).toBe(true);
    const summary = await app.inject({ url: `/api/tasks/${task.id}/summary`, headers });
    expect(summary.statusCode).toBe(200);
    expect(Object.keys(summary.json())).toEqual(['task']);
    expect(summary.json().task.id).toBe(task.id);
    expect((await app.inject({ url: '/api/tasks/missing/summary', headers })).statusCode).toBe(404);
  });

  test('concurrent diff polls for one task share a single worktree diff', async () => {
    const task = await createTask();
    await wait(task);
    const diff = vi.spyOn(worktree, 'diffWorktree').mockImplementation(async () => {
      await new Promise(resolve => setTimeout(resolve, 100));
      return { files: [], patch: 'shared' };
    });
    const responses = await Promise.all([1, 2, 3].map(() => app.inject({ url: `/api/tasks/${task.id}/diff`, headers })));
    expect(responses.map(response => response.json().patch)).toEqual(['shared', 'shared', 'shared']);
    expect(diff).toHaveBeenCalledTimes(1);
    await app.inject({ url: `/api/tasks/${task.id}/diff`, headers });
    expect(diff).toHaveBeenCalledTimes(2);
  });

  test('a corrupted history index answers 503 db_corrupt instead of a generic 500', async () => {
    const dbPath = path.join(root, 'corrupt', 'fleet.db');
    const { taskId } = seedDatabase(dbPath);
    corruptRunsIndex(dbPath, 'garbage');
    const broken = new Store(dbPath);
    const brokenApp = buildServer({ service: new TaskService({ store: broken, bus: new Bus(), config: service['config'] }), store: broken, bus: new Bus(), token });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await brokenApp.inject({ url: `/api/tasks/${taskId}/runs`, headers });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ error: 'db_corrupt', message: expect.stringContaining('--repair-db') });
      expect(response.body).not.toContain(token);
    } finally {
      await brokenApp.close();
      broken.close();
    }
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

  test('observability requires authentication and accepts header or HttpOnly-cookie authentication', async () => {
    expect((await app.inject('/api/observability')).statusCode).toBe(401);
    expect((await app.inject({ url: '/api/observability', headers: { 'x-fleet-token': 'wrong' } })).statusCode).toBe(401);
    for (const auth of [headers, { cookie: `fleet_token=${token}` }]) {
      const response = await app.inject({ url: '/api/observability', headers: auth });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ resource: { scope: 'server-only', processCount: 1 },
        usage: { taskCount: 0, runCount: 0, inputTokens: null, costUsd: null, credits: null }, activeJobs: [] });
    }
  });

  test('observability scopes usage to a plan and keeps native/app resource scope explicit', async () => {
    const first = store.createPlan({ name: 'first', repoPath: repo, baseBranch: 'main' });
    const second = store.createPlan({ name: 'second', repoPath: root, baseBranch: 'main' });
    for (const [plan, inputTokens, credits] of [[first, 100, 1.5], [second, 200, 2.5]] as const) {
      const task = store.createTask({ planId: plan.id, agent: 'qodercli', title: 'usage', branch: 'unused', worktreePath: root, checkCmd: null });
      const run = store.createRun({ taskId: task.id, agent: 'qodercli', brief: '', note: null });
      store.updateRun(run.id, { status: 'done', inputTokens, outputTokens: 10, costUsd: 0.1 });
      store.appendEvent(run.id, { kind: 'usage', inputTokens, outputTokens: 10, costUsd: 0.1 });
      store.appendEvent(run.id, { kind: 'usage', credits } as Parameters<Store['appendEvent']>[1]);
    }
    const all = (await app.inject({ url: '/api/observability', headers })).json();
    expect(all.usage).toMatchObject({ taskCount: 2, runCount: 2, inputTokens: 300, outputTokens: 20, costUsd: 0.2, credits: 4 });
    const scoped = (await app.inject({ url: `/api/observability?planId=${first.id}`, headers })).json();
    expect(scoped.usage).toMatchObject({ planId: first.id, taskCount: 1, runCount: 1, inputTokens: 100, credits: 1.5,
      coverage: { tokenRuns: 1, costRuns: 1, creditRuns: 1, totalRuns: 1 } });
    expect(scoped.plans).toHaveLength(2);
    expect(scoped.runs).toHaveLength(1);
    expect(scoped.resource.scope).toBe('server-only');
  });

  test('observability rejects an unknown plan or empty plan identifier', async () => {
    expect((await app.inject({ url: '/api/observability?planId=missing', headers })).statusCode).toBe(404);
    expect((await app.inject({ url: '/api/observability?planId=', headers })).statusCode).toBe(400);
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
