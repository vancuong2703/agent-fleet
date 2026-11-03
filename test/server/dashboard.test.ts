import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import fastify, { type FastifyInstance } from 'fastify';
import websocket from '@fastify/websocket';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { DashboardCheck } from '../../shared/dashboard.js';
import type { Plan, Task } from '../../shared/types.js';
import type { FleetConfig } from '../../server/config.js';
import {
  DashboardTerminals,
  registerDashboardRoutes,
  type DashboardProbe,
  type TerminalPty,
} from '../../server/dashboard.js';
import type { PtySession, PtyTarget } from '../../server/pty.js';
import { FleetError } from '../../server/service.js';
import type { Store } from '../../server/store.js';

vi.mock('node:child_process', async () => {
  const actual = await vi.importActual<typeof import('node:child_process')>('node:child_process');
  const wrap = (fn: unknown) => vi.fn((...args: unknown[]) => (fn as (...a: unknown[]) => unknown)(...args));
  return { ...actual, execFile: wrap(actual.execFile), spawn: wrap(actual.spawn), spawnSync: wrap(actual.spawnSync) };
});
import { execFile, spawn, spawnSync } from 'node:child_process';

const directories: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const app of apps.splice(0)) await app.close();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function temporary(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fleet-dashboard-'));
  directories.push(directory);
  return directory;
}

function config(): FleetConfig {
  const agent = { bin: process.execPath, maxParallel: 2, extraArgs: [] as string[] };
  return {
    port: 4500,
    agents: { codex: { ...agent }, qodercli: { ...agent }, agy: { ...agent }, opencode: { ...agent } },
    maxParallelTotal: 4,
    timeouts: { totalMin: 1, idleMin: 1 },
  };
}

function plan(overrides: Partial<Plan> = {}): Plan {
  return { id: 'p-one', name: 'Repo One', slug: 'repo-one', repoPath: 'C:\\repo', baseBranch: 'main', createdAt: 1, ...overrides };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 't-one', planId: 'p-one', title: 'Work', agent: 'codex', status: 'done', branch: 'fleet/x',
    worktreePath: 'C:\\worktree', checkCmd: null, createdAt: 1, finishedAt: 2, ...overrides,
  };
}

function store(plans: Plan[] = [], tasks: Task[] = []): Pick<Store, 'getPlan' | 'getTask'> {
  return { getPlan: (id) => plans.find((entry) => entry.id === id), getTask: (id) => tasks.find((entry) => entry.id === id) };
}

class FakeSession implements PtySession {
  private readonly dataListeners = new Set<(data: string) => void>();
  private readonly exitListeners = new Set<(code: number) => void>();
  private buffer = 'ready';
  private code: number | null = null;
  exited = false;
  writes: string[] = [];
  resizes: [number, number][] = [];
  onData(listener: (data: string) => void): () => void {
    if (this.buffer) listener(this.buffer);
    this.dataListeners.add(listener);
    return () => { this.dataListeners.delete(listener); };
  }
  onExit(listener: (code: number) => void): () => void {
    if (this.exited && this.code !== null) { queueMicrotask(() => listener(this.code!)); return () => {}; }
    this.exitListeners.add(listener);
    return () => { this.exitListeners.delete(listener); };
  }
  write(data: string): void { this.writes.push(data); this.buffer += data; for (const listener of this.dataListeners) listener(data); }
  resize(cols: number, rows: number): void { this.resizes.push([cols, rows]); }
  kill(): void { this.exit(0); }
  exit(code: number): void {
    if (this.exited) return;
    this.exited = true;
    this.code = code;
    for (const listener of this.exitListeners) listener(code);
  }
}

class FakePty implements TerminalPty {
  readonly sessions = new Map<string, FakeSession>();
  readonly targets = new Map<string, PtyTarget>();
  readonly kills: string[] = [];
  openTarget(id: string, target: PtyTarget | undefined): PtySession {
    const session = new FakeSession();
    this.sessions.set(id, session);
    if (target) this.targets.set(id, target);
    return session;
  }
  async kill(id: string): Promise<void> {
    this.kills.push(id);
    const session = this.sessions.get(id);
    if (session) { this.sessions.delete(id); session.exit(0); }
  }
}

function errorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof FleetError) {
      const codes = { not_found: 404, bad_request: 400, agent_unavailable: 409, conflict: 409, invalid_state: 409 };
      return reply.code(codes[error.code]).send({ error: error.code, message: error.message });
    }
    const err = error as { statusCode?: number; message?: string };
    const status = err.statusCode ?? 500;
    return reply.code(status).send({ error: status === 400 ? 'bad_request' : 'internal_error', message: err.message ?? 'error' });
  });
}

async function makeApp(options: Parameters<typeof registerDashboardRoutes>[1]): Promise<{ app: FastifyInstance; terminals: DashboardTerminals }> {
  const app = fastify();
  errorHandler(app);
  await app.register(websocket);
  let terminals: DashboardTerminals | undefined;
  await app.register(async (routes) => { terminals = registerDashboardRoutes(routes, options); });
  await app.ready();
  apps.push(app);
  return { app, terminals: terminals! };
}

beforeEach(() => {
  vi.mocked(execFile).mockClear();
  vi.mocked(spawn).mockClear();
  vi.mocked(spawnSync).mockClear();
});

describe('GET /api/dashboard', () => {
  test('reads config and cache without spawning any process', async () => {
    const directory = temporary();
    const { app } = await makeApp({ store: store(), ptyManager: new FakePty(), dashboard: { config: config(), directory } });
    const response = await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(response.statusCode).toBe(200);
    const snapshot = response.json();
    expect(snapshot.tools.map((tool: { agent: string }) => tool.agent)).toEqual(['codex', 'qodercli', 'agy', 'opencode']);
    expect(snapshot.tools[0]).toMatchObject({ installed: true, lastCheck: null });
    expect(snapshot.tools[0].suggestions.length).toBeGreaterThan(0);
    expect(snapshot.terminalSessions).toEqual([]);
    expect(execFile).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
    expect(spawnSync).not.toHaveBeenCalled();
  });

  test('keeps the persisted lastCheck instead of probing again', async () => {
    const directory = temporary();
    const cached: Partial<Record<string, DashboardCheck>> = {
      codex: {
        checkedAt: 123, status: 'ready', version: '1.2.3',
        account: { state: 'authenticated', label: 'Đã đăng nhập', source: 'codex login status', reason: null },
        quota: { remaining: null, unit: null, resetAt: null, source: 'x', reason: 'y' },
        credits: { remaining: null, unit: null, resetAt: null, source: 'x', reason: 'y' },
        probes: [],
      },
    };
    writeFileSync(path.join(directory, 'dashboard-checks.json'), JSON.stringify({ version: 1, checks: cached }));
    const { app } = await makeApp({ store: store(), ptyManager: new FakePty(), dashboard: { config: config(), directory } });
    const snapshot = (await app.inject({ method: 'GET', url: '/api/dashboard' })).json();
    expect(snapshot.tools[0].lastCheck).toMatchObject({ checkedAt: 123, version: '1.2.3' });
    expect(execFile).not.toHaveBeenCalled();
  });
});

describe('POST /api/dashboard/check', () => {
  const readyProbe: DashboardProbe = async () => ([
    { command: 'codex --version', kind: 'version', ok: true, exitCode: 0, stdout: 'codex-cli 1.2.3', stderr: '' },
    { command: 'codex login status', kind: 'status', ok: true, exitCode: 0, stdout: 'Logged in as someone@example.com', stderr: '' },
  ]);

  test('runs only the injected probe, reports ready and keeps quota/credits unknown', async () => {
    const probe = vi.fn(readyProbe);
    const { app } = await makeApp({ store: store(), ptyManager: new FakePty(), dashboard: { config: config(), probe, directory: temporary() } });
    const response = await app.inject({ method: 'POST', url: '/api/dashboard/check', payload: { agent: 'codex' } });
    expect(response.statusCode).toBe(200);
    const tool = response.json();
    expect(tool.lastCheck).toMatchObject({
      status: 'ready', version: 'codex-cli 1.2.3',
      account: { state: 'authenticated', label: 'Đã đăng nhập' },
    });
    expect(tool.lastCheck.quota.remaining).toBeNull();
    expect(tool.lastCheck.quota.unit).toBeNull();
    expect(tool.lastCheck.quota.reason).toBeTruthy();
    expect(tool.lastCheck.credits.remaining).toBeNull();
    expect(tool.lastCheck.credits.reason).toBeTruthy();
    expect(probe).toHaveBeenCalledWith('codex', process.execPath);
    expect(execFile).not.toHaveBeenCalled();
  });

  test('enriches only explicit checks and persists structured fields through the compatibility API', async () => {
    const directory = temporary();
    const custom = config();
    const enrich = vi.fn(async () => ({ models: [{ id: 'free', label: 'Free', multiplier: 0, source: 'cli' as const }],
      quotaWindows: [{ group: 'main', window: 'week' as const, remainingPct: null, unit: 'percent' as const }] }));
    const { app } = await makeApp({ store: store(), dashboard: { config: custom, directory, probe: readyProbe, enrich } });
    await app.inject({ method: 'GET', url: '/api/dashboard' });
    expect(enrich).not.toHaveBeenCalled();
    const response = await app.inject({ method: 'POST', url: '/api/dashboard/check', payload: { agent: 'codex' } });
    expect(response.statusCode).toBe(200);
    expect(response.json().lastCheck.models[0].multiplier).toBe(0);
    expect(response.json().lastCheck.quotaWindows[0].remainingPct).toBeNull();
    expect(enrich).toHaveBeenCalledWith('codex', expect.objectContaining({ bin: process.execPath, directory, config: custom, runCommand: expect.any(Function) }));
    const { app: restarted } = await makeApp({ store: store(), dashboard: { config: custom, directory, probe: readyProbe, enrich } });
    expect((await restarted.inject({ method: 'GET', url: '/api/dashboard' })).json().tools[0].lastCheck.models[0].id).toBe('free');
    expect(enrich).toHaveBeenCalledTimes(1);
  });

  test('masks account identifiers and secrets in labels and probe summaries', async () => {
    const probe: DashboardProbe = async () => ([
      { command: 'qodercli --version', kind: 'version', ok: true, exitCode: 0, stdout: '1.0.0', stderr: '' },
      { command: 'qodercli status', kind: 'status', ok: true, exitCode: 0, stdout: 'Account: someone@example.com key sk-abcdef123456', stderr: '' },
    ]);
    const { app } = await makeApp({ store: store(), ptyManager: new FakePty(), dashboard: { config: config(), probe, directory: temporary() } });
    const tool = (await app.inject({ method: 'POST', url: '/api/dashboard/check', payload: { agent: 'qodercli' } })).json();
    const serialized = JSON.stringify(tool);
    expect(serialized).not.toContain('someone@example.com');
    expect(serialized).not.toContain('sk-abcdef123456');
    expect(tool.lastCheck.probes[1].summary).toContain('***@example.com');
  });

  test('an unavailable bin reports unavailable without probing', async () => {
    const probe = vi.fn(readyProbe);
    const custom = config();
    custom.agents.agy.bin = null;
    const { app } = await makeApp({ store: store(), ptyManager: new FakePty(), dashboard: { config: custom, probe, directory: temporary() } });
    const tool = (await app.inject({ method: 'POST', url: '/api/dashboard/check', payload: { agent: 'agy' } })).json();
    expect(tool.installed).toBe(false);
    expect(tool.lastCheck.status).toBe('unavailable');
    expect(probe).not.toHaveBeenCalled();
  });

  test('concurrent checks for one agent share a single probe run', async () => {
    let second: Promise<unknown> | undefined;
    let calls = 0;
    const probe = vi.fn(async (): Promise<Awaited<ReturnType<DashboardProbe>>> => {
      calls += 1;
      if (calls === 1) {
        // The first probe is still running here, so the second request must join it.
        second = app.inject({ method: 'POST', url: '/api/dashboard/check', payload: { agent: 'codex' } });
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
      return [{ command: 'x --version', kind: 'version', ok: true, exitCode: 0, stdout: '1.0.0', stderr: '' }];
    });
    const { app } = await makeApp({ store: store(), ptyManager: new FakePty(), dashboard: { config: config(), probe, directory: temporary() } });
    await app.inject({ method: 'POST', url: '/api/dashboard/check', payload: { agent: 'codex' } });
    await second;
    expect(probe).toHaveBeenCalledTimes(1);
  });

  test('rejects an unknown or fake agent', async () => {
    const { app } = await makeApp({ store: store(), ptyManager: new FakePty(), dashboard: { config: config(), directory: temporary() } });
    expect((await app.inject({ method: 'POST', url: '/api/dashboard/check', payload: { agent: 'fake' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/dashboard/check', payload: {} })).statusCode).toBe(400);
  });
});

describe('terminal sessions', () => {
  function newTerminals(overrides: Partial<ConstructorParameters<typeof DashboardTerminals>[0]> = {}): { terminals: DashboardTerminals; pty: FakePty; directory: string } {
    const pty = new FakePty();
    const directory = temporary();
    const terminals = new DashboardTerminals({
      store: store(), pty, config, now: () => Date.now(), directory,
      maxSessions: 8, unclaimedTtlMs: 60_000, reconnectGraceMs: 300_000, ...overrides,
    });
    return { terminals, pty, directory };
  }

  test('derives the interactive executable and cwd from the server, never the client', async () => {
    const { terminals, pty, directory } = newTerminals();
    const info = await terminals.create({ agent: 'codex' });
    expect(info.id).toMatch(/^term-/);
    expect(info.source).toBe('workspace');
    expect(info.cwd).toBe(path.join(directory, 'terminal-workspaces', 'codex'));
    expect(existsSync(info.cwd)).toBe(true);
    const target = pty.targets.get(info.id);
    expect(target?.cmd).toBe(process.execPath);
    expect(target?.cwd).toBe(info.cwd);
  });

  test('two sessions get distinct server ids and the count is capped', async () => {
    const { terminals } = newTerminals({ maxSessions: 2 });
    const first = await terminals.create({ agent: 'codex' });
    const second = await terminals.create({ agent: 'qodercli' });
    expect(first.id).not.toBe(second.id);
    await expect(terminals.create({ agent: 'agy' })).rejects.toBeInstanceOf(FleetError);
  });

  test('resolves plan and task working directories', async () => {
    const repository = temporary();
    const worktree = temporary();
    const plans = [plan({ repoPath: repository })];
    const tasks = [task({ worktreePath: worktree })];
    const pty = new FakePty();
    const terminals = new DashboardTerminals({
      store: store(plans, tasks), pty, config, now: () => Date.now(), directory: temporary(),
      maxSessions: 8, unclaimedTtlMs: 60_000, reconnectGraceMs: 300_000,
    });
    expect(await terminals.create({ agent: 'codex', planId: 'p-one' })).toMatchObject({ source: 'plan', cwd: repository });
    expect(await terminals.create({ agent: 'codex', taskId: 't-one' })).toMatchObject({ source: 'task', cwd: worktree });
    await expect(terminals.create({ agent: 'codex', taskId: 'missing' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(terminals.create({ agent: 'codex', planId: 'missing' })).rejects.toMatchObject({ code: 'not_found' });
    await expect(terminals.create({ agent: 'codex', planId: 'p-other', taskId: 't-one' })).rejects.toMatchObject({ code: 'bad_request' });
  });

  test('rejects running tasks, deleted worktrees and unknown agents', async () => {
    const worktree = temporary();
    const pty = new FakePty();
    const terminals = new DashboardTerminals({
      store: store([plan()], [task({ worktreePath: worktree, status: 'running' })]), pty, config,
      now: () => Date.now(), directory: temporary(), maxSessions: 8, unclaimedTtlMs: 60_000, reconnectGraceMs: 300_000,
    });
    await expect(terminals.create({ agent: 'codex', taskId: 't-one' })).rejects.toMatchObject({ code: 'conflict' });
  });

  test('unclaimed sessions expire after the TTL and disconnected ones after the grace', async () => {
    vi.useFakeTimers();
    const { terminals, pty } = newTerminals();
    const ttl = await terminals.create({ agent: 'codex' });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(pty.kills).toContain(ttl.id);
    expect(terminals.list()).toHaveLength(0);

    const grace = await terminals.create({ agent: 'codex' });
    const attach = terminals.attach(grace.id);
    expect(attach).not.toBeNull();
    terminals.detach(grace.id);
    await vi.advanceTimersByTimeAsync(299_000);
    expect(pty.kills).not.toContain(grace.id);
    terminals.attach(grace.id);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pty.kills).not.toContain(grace.id);
    terminals.detach(grace.id);
    await vi.advanceTimersByTimeAsync(300_000);
    expect(pty.kills).toContain(grace.id);
  });

  test('explicit close and shutdown kill the process and remove metadata', async () => {
    const { terminals, pty } = newTerminals();
    const first = await terminals.create({ agent: 'codex' });
    expect(await terminals.close(first.id)).toBe(true);
    expect(pty.kills).toContain(first.id);
    expect(terminals.get(first.id)).toBeUndefined();
    expect(await terminals.close('term-missing')).toBe(false);

    const second = await terminals.create({ agent: 'codex' });
    const third = await terminals.create({ agent: 'codex' });
    await terminals.closeAll();
    expect(terminals.list()).toHaveLength(0);
    expect(pty.kills).toEqual(expect.arrayContaining([second.id, third.id]));
  });

  test('a dead session frees its slot and cannot be reattached', async () => {
    const { terminals, pty } = newTerminals();
    const info = await terminals.create({ agent: 'codex' });
    pty.sessions.get(info.id)?.exit(0);
    expect(terminals.get(info.id)).toBeUndefined();
    expect(terminals.attach(info.id)).toBeNull();
  });
});

describe('terminal session routes', () => {
  function routed(plans: Plan[] = [], tasks: Task[] = []) {
    const pty = new FakePty();
    const directory = temporary();
    return makeApp({
      store: store(plans, tasks), ptyManager: pty,
      dashboard: { config: config(), directory, unclaimedTtlMs: 60_000, reconnectGraceMs: 300_000 },
    }).then(({ app, terminals }) => ({ app, terminals, pty, directory }));
  }

  test('rejects client-supplied cmd/cwd/title and unknown agents', async () => {
    const { app } = await routed();
    for (const payload of [{ agent: 'codex', cmd: 'evil.exe' }, { agent: 'codex', cwd: 'C:\\' }, { agent: 'codex', title: 'x' }, { agent: 'fake' }]) {
      expect((await app.inject({ method: 'POST', url: '/api/terminal-sessions', payload })).statusCode).toBe(400);
    }
  });

  test('creates, lists and deletes a session', async () => {
    const { app, pty } = await routed();
    const created = await app.inject({ method: 'POST', url: '/api/terminal-sessions', payload: { agent: 'codex' } });
    expect(created.statusCode).toBe(200);
    const info = created.json();
    expect(info.id).toMatch(/^term-/);
    expect((await app.inject({ method: 'GET', url: '/api/dashboard' })).json().terminalSessions).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/terminal-sessions/${info.id}` })).statusCode).toBe(204);
    expect(pty.kills).toContain(info.id);
    expect((await app.inject({ method: 'DELETE', url: '/api/terminal-sessions/missing' })).statusCode).toBe(404);
  });

  test('maps plan/task lookup failures to HTTP errors', async () => {
    const repository = temporary();
    const worktree = temporary();
    const { app } = await routed([plan({ repoPath: repository })], [task({ worktreePath: worktree })]);
    expect((await app.inject({ method: 'POST', url: '/api/terminal-sessions', payload: { agent: 'codex', planId: 'missing' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/terminal-sessions', payload: { agent: 'codex', taskId: 'missing' } })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/terminal-sessions', payload: { agent: 'codex', planId: 'p-other', taskId: 't-one' } })).statusCode).toBe(400);
    expect((await app.inject({ method: 'POST', url: '/api/terminal-sessions', payload: { agent: 'codex', taskId: 't-one' } })).statusCode).toBe(200);
  });

  test('degrades gracefully when the server has no PTY manager', async () => {
    const directory = temporary();
    const { app } = await makeApp({ store: store(), dashboard: { config: config(), directory } });
    const response = await app.inject({ method: 'POST', url: '/api/terminal-sessions', payload: { agent: 'codex' } });
    expect(response.statusCode).toBe(409);
  });
});
