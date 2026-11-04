import { timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import type { AgentId, TaskStatus } from '../shared/types.js';
import { getAdapter, getAdapterConfig } from './adapters/index.js';
import type { Bus } from './bus.js';
import { loadConfig } from './config.js';
import { agyCommandArgs } from './command-permissions.js';
import { registerDashboardRoutes } from './dashboard.js';
import { Observability } from './observability.js';
import type { PtyManager, PtyResolver } from './pty.js';
import { FleetError, type TaskService } from './service.js';
import { computeStats } from './stats.js';
import type { Store } from './store.js';
import { diffWorktree } from './worktree.js';
import { validateRepository } from './repository-validation.js';
import { leaderGuide } from './leader-guide.js';

const agentIds = ['codex', 'qodercli', 'agy', 'opencode', 'fake'];
const statuses = ['queued', 'running', 'done', 'failed', 'timeout', 'interrupted', 'taken_over', 'merged', 'discarded'];
const text = { type: 'string' };
const nonempty = { type: 'string', minLength: 1 };
const agent = { type: 'string', enum: agentIds };
const nonnegativeInteger = { type: 'integer', minimum: 0 };
const commandOptionsSchema = {
  commandPolicy: { type: 'string', enum: ['ask', 'check-only', 'auto'] },
  allowedCommands: { type: 'array', maxItems: 64, items: { type: 'string', minLength: 1, maxLength: 2_000, pattern: '^[^\\r\\n\\u0000]+$' } },
};
const objectSchema = (properties: Record<string, object>, required: string[] = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});
type IdParams = { Params: { id: string } };

/**
 * Resolves the command a task's terminal runs: the adapter's interactive form
 * for the task's agent, or a plain `cmd.exe` when the agent has no binary (or
 * is the test `fake` agent). `main.ts` feeds this into a `PtyManager`.
 */
export function createPtyResolver(store: Store): PtyResolver {
  return (taskId) => {
    const task = store.getTask(taskId);
    if (!task) throw new FleetError('not_found', `Task not found: ${taskId}`);
    const run = store.latestRun(taskId) ?? null;
    const cfg = getAdapterConfig(task.agent, loadConfig());
    if (task.agent === 'fake' || !cfg.bin) {
      return { cmd: 'cmd.exe', args: [], cwd: task.worktreePath };
    }
    const spec = getAdapter(task.agent).interactive({
      bin: cfg.bin,
      cwd: task.worktreePath,
      sessionId: run?.sessionId ?? null,
    });
    const args = task.agent === 'agy' && run ? agyCommandArgs(spec.args, run, task.checkCmd, task.worktreePath).args : spec.args;
    return { cmd: spec.cmd, args, cwd: task.worktreePath };
  };
}

function dimension(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 5_000 ? parsed : fallback;
}

function cookieToken(cookie: string | undefined): string | undefined {
  const value = cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('fleet_token='));
  if (!value) return undefined;
  try { return decodeURIComponent(value.slice('fleet_token='.length)); }
  catch { return undefined; }
}

export function buildServer(o: {
  service: TaskService; store: Store; bus: Bus; token: string; webDist?: string; ptyManager?: PtyManager;
  port?: number; shutdown?: () => Promise<void> | void;
}): FastifyInstance {
  const { service, store, bus } = o;
  const app = fastify({ ajv: { customOptions: { coerceTypes: true, removeAdditional: false } } });
  const observability = new Observability(store, bus);
  app.addHook('onClose', async () => { observability.close(); });
  const expectedToken = Buffer.from(o.token);
  const matches = (value: unknown): boolean => {
    if (typeof value !== 'string') return false;
    const candidate = Buffer.from(value);
    return candidate.length === expectedToken.length && timingSafeEqual(candidate, expectedToken);
  };
  const protectedPath = (pathname: string) => pathname === '/api' || pathname.startsWith('/api/') || pathname === '/ws' || pathname.startsWith('/ws/');

  // Let the websocket plugin mark upgrade requests before auth can reject them.
  app.register(websocket);
  app.after(() => {
    app.addHook('onRequest', async (request, reply) => {
      const url = new URL(request.raw.url ?? '/', 'http://127.0.0.1');
      if (request.method === 'GET' && url.pathname === '/api/health') return;
      const hosts = [`127.0.0.1:${o.port}`, `localhost:${o.port}`];
      if (o.port !== undefined && !hosts.includes(request.headers.host ?? '')) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      const port = o.port ?? request.raw.socket.localPort ?? 80;
      if (request.headers.origin !== undefined && ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(request.headers.origin)) {
        return reply.code(403).send({ error: 'forbidden' });
      }
      if (!protectedPath(url.pathname)) return;
      const headerAuth = matches(request.headers['x-fleet-token']);
      const authenticated = headerAuth
        || matches(cookieToken(request.headers.cookie))
        || ((url.pathname === '/ws' || url.pathname.startsWith('/ws/')) && matches(url.searchParams.get('token')));
      if (!authenticated) return reply.code(401).send({ error: 'unauthorized', message: 'Invalid or missing fleet token' });
      if (request.method !== 'GET' && url.pathname.startsWith('/api/') && !headerAuth
        && !request.headers['content-type']?.startsWith('application/json')) {
        return reply.code(415).send({ error: 'unsupported_media_type' });
      }
    });
  });

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof FleetError) {
      const statuses = { not_found: 404, bad_request: 400, agent_unavailable: 409, conflict: 409, invalid_state: 409 };
      return reply.code(statuses[error.code]).send({ error: error.code, message: error.message });
    }
    if (error instanceof Error && 'statusCode' in error && error.statusCode === 400) {
      return reply.code(400).send({ error: 'bad_request', message: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ error: 'internal_error', message: 'Internal server error' });
  });

  const task = (id: string) => {
    const found = store.getTask(id);
    if (!found) throw new FleetError('not_found', `Task not found: ${id}`);
    return found;
  };

  // Register routes after the websocket plugin so upgrades use its lifecycle hooks.
  app.register(async (routes) => {
    const dashboardTerminals = registerDashboardRoutes(routes, { store, ptyManager: o.ptyManager ?? {
      openTarget() { throw new FleetError('invalid_state', 'Terminal is unavailable in this server'); },
      async kill() {},
    } });
    const removeWorktreeGuard = service.addWorktreeGuard(taskId => dashboardTerminals.closeForTask(taskId));
    routes.addHook('onClose', async () => { removeWorktreeGuard(); });
    routes.get('/api/health', async () => ({ ok: true }));
    routes.get('/api/leader-guide', async (request, reply) => {
      reply.header('Cache-Control', 'no-store');
      return leaderGuide(o.port ?? request.raw.socket.localPort ?? loadConfig().port);
    });
    routes.post('/api/shutdown', async (_request, reply) => {
      reply.raw.once('finish', () => { setImmediate(() => { void o.shutdown?.(); }); });
      return reply.code(202).send({ ok: true });
    });
    routes.get('/api/plans', async () => store.listPlans());
    routes.post<{ Body: { repoPath: string } }>('/api/repositories/validate', {
      schema: { body: objectSchema({ repoPath: { type: 'string', minLength: 1, maxLength: 32_767 } }, ['repoPath']) },
    }, async (request) => validateRepository(request.body.repoPath));
    routes.get<{ Querystring: { planId?: string } }>('/api/observability', {
      schema: { querystring: objectSchema({ planId: nonempty }) },
    }, async (request) => {
      if (request.query.planId !== undefined && !store.getPlan(request.query.planId)) {
        throw new FleetError('not_found', `Plan not found: ${request.query.planId}`);
      }
      // Start on the first dashboard request; CLI-only servers do no unused polling.
      observability.start();
      return observability.snapshot(request.query.planId);
    });
    routes.post<{ Body: Parameters<TaskService['createPlan']>[0] }>('/api/plans', {
      schema: { body: objectSchema({ name: nonempty, repoPath: nonempty, baseBranch: nonempty }, ['name', 'repoPath']) },
    }, async (request) => service.createPlan(request.body));

    routes.post<{ Body: Parameters<TaskService['run']>[0] }>('/api/tasks', {
      schema: { body: objectSchema({ planId: nonempty, agent, title: nonempty, brief: text, checkCmd: text, ...commandOptionsSchema }, ['planId', 'agent', 'title', 'brief']) },
    }, async (request) => service.run(request.body));
    routes.get<{ Querystring: { planId?: string; status?: TaskStatus } }>('/api/tasks', {
      schema: { querystring: objectSchema({ planId: nonempty, status: { type: 'string', enum: statuses } }) },
    }, async (request) => store.listTasks(request.query));
    routes.get<IdParams>('/api/tasks/:id', async (request) => service.result(request.params.id));
    routes.get<IdParams>('/api/tasks/:id/runs', async (request) => {
      task(request.params.id);
      return store.listRuns({ taskId: request.params.id });
    });
    routes.get<IdParams & { Querystring: { afterSeq?: number; tail?: number } }>('/api/runs/:id/events', {
      schema: { querystring: objectSchema({ afterSeq: nonnegativeInteger, tail: nonnegativeInteger }) },
    }, async (request) => {
      if (!store.getRun(request.params.id)) throw new FleetError('not_found', `Run not found: ${request.params.id}`);
      return store.readEvents(request.params.id, request.query);
    });
    routes.get<IdParams>('/api/tasks/:id/diff', async (request) => {
      const found = task(request.params.id);
      if (found.status === 'merged' || found.status === 'discarded') return { files: [], patch: '' };
      const plan = store.getPlan(found.planId);
      if (!plan) throw new FleetError('not_found', `Plan not found: ${found.planId}`);
      return diffWorktree(found.worktreePath, plan.baseBranch);
    });
    routes.post<IdParams & { Body: Parameters<TaskService['retry']>[1] }>('/api/tasks/:id/retry', {
      schema: { body: objectSchema({ agent, note: text, ...commandOptionsSchema }, ['note']) },
    }, async (request) => service.retry(request.params.id, request.body));
    for (const [action, method] of [
      ['stop', 'stop'], ['takeover', 'takeOver'], ['done', 'markDone'], ['discard', 'discard'],
    ] as const) {
      routes.post<IdParams>(`/api/tasks/:id/${action}`, async (request, reply) => {
        await service[method](request.params.id);
        return reply.code(204).send();
      });
    }
    routes.post<IdParams>('/api/tasks/:id/merge', async (request) => service.merge(request.params.id));
    routes.post<{ Body: { ids: string[]; timeoutMs: number } }>('/api/wait', {
      schema: { body: objectSchema({ ids: { type: 'array', items: nonempty }, timeoutMs: { ...nonnegativeInteger, maximum: 2_147_483_647 } }, ['ids', 'timeoutMs']) },
    }, async (request) => service.wait(request.body.ids, request.body.timeoutMs));

    routes.get('/api/agents', async () => {
      const config = loadConfig();
      const ids = Object.keys(config.agents) as Exclude<AgentId, 'fake'>[];
      return Promise.all(ids.map(async (id) => {
        const cfg = getAdapterConfig(id, config);
        return { id, ...await getAdapter(id).detect(cfg), maxParallel: cfg.maxParallel };
      }));
    });
    routes.get<{ Querystring: { repo?: string; sinceDays?: number } }>('/api/stats', {
      schema: { querystring: objectSchema({ repo: text, sinceDays: { type: 'number', minimum: 0 } }) },
    }, async (request) => computeStats(store.listTasks(), store.listRuns(), store.listPlans(), {
      repoPath: request.query.repo,
      sinceMs: request.query.sinceDays === undefined ? undefined : Date.now() - request.query.sinceDays * 86_400_000,
    }));

    routes.get<{ Querystring: { token?: string } }>('/auth', async (request, reply) => {
      if (!matches(request.query.token)) return reply.code(401).send({ error: 'unauthorized', message: 'Invalid or missing fleet token' });
      return reply.header('set-cookie', `fleet_token=${encodeURIComponent(o.token)}; Path=/; HttpOnly; SameSite=Strict`).redirect('/', 302);
    });
    routes.get('/ws', { websocket: true }, (socket) => {
      const off = bus.on((message) => {
        if (socket.readyState === 1) socket.send(JSON.stringify(message));
      });
      socket.once('close', off);
      socket.once('error', off);
    });

    // Terminal takeover: one PTY per task, reused across re-connects. The
    // upgrade is authenticated by the same hook (`?token=` or cookie).
    routes.get<{ Querystring: { taskId?: string; cols?: string; rows?: string } }>(
      '/ws/pty',
      { websocket: true },
      (socket, request) => {
        const manager = o.ptyManager;
        const taskId = request.query.taskId;
        if (!manager || !taskId) {
          socket.close(1008, 'Thiếu task hoặc terminal không khả dụng');
          return;
        }
        let session;
        try {
          const found = task(taskId);
          if (!['taken_over', 'done', 'failed', 'timeout', 'interrupted'].includes(found.status)) {
            socket.close(1008, `Task ${taskId} is ${found.status}`);
            return;
          }
          session = manager.open(
            taskId,
            dimension(request.query.cols, 80),
            dimension(request.query.rows, 24),
          );
        } catch (error) {
          request.log.error(error);
          if (socket.readyState === 1) socket.send(JSON.stringify({ t: 'exit', code: 1 }));
          socket.close(1011, 'Không mở được terminal');
          return;
        }
        const offData = session.onData((data) => {
          if (socket.readyState === 1) socket.send(JSON.stringify({ t: 'out', d: data }));
        });
        const offExit = session.onExit((code) => {
          if (socket.readyState === 1) socket.send(JSON.stringify({ t: 'exit', code }));
          socket.close();
        });
        socket.on('message', (raw: Buffer) => {
          let message: { t?: string; d?: string; cols?: number; rows?: number };
          try {
            message = JSON.parse(raw.toString()) as typeof message;
          } catch {
            return;
          }
          if (message.t === 'in' && typeof message.d === 'string') session.write(message.d);
          else if (message.t === 'resize' && typeof message.cols === 'number' && typeof message.rows === 'number') {
            session.resize(message.cols, message.rows);
          }
        });
        const detach = (): void => {
          offData();
          offExit();
        };
        socket.once('close', detach);
        socket.once('error', detach);
      },
    );
  });

  const webDist = path.resolve(o.webDist ?? fileURLToPath(new URL('../web/dist/', import.meta.url)));
  if (existsSync(webDist)) {
    app.register(fastifyStatic, { root: webDist });
    app.setNotFoundHandler((request, reply) => {
      const pathname = new URL(request.raw.url ?? '/', 'http://127.0.0.1').pathname;
      if (request.method === 'GET' && !protectedPath(pathname) && existsSync(path.join(webDist, 'index.html'))) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'not_found', message: 'Route not found' });
    });
  }
  return app;
}
