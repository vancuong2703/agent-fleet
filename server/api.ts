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
import { FleetError, type TaskService } from './service.js';
import { computeStats } from './stats.js';
import type { Store } from './store.js';
import { diffWorktree } from './worktree.js';

const agentIds = ['codex', 'qodercli', 'agy', 'opencode', 'fake'];
const statuses = ['queued', 'running', 'done', 'failed', 'timeout', 'interrupted', 'taken_over', 'merged', 'discarded'];
const text = { type: 'string' };
const nonempty = { type: 'string', minLength: 1 };
const agent = { type: 'string', enum: agentIds };
const nonnegativeInteger = { type: 'integer', minimum: 0 };
const objectSchema = (properties: Record<string, object>, required: string[] = []) => ({
  type: 'object', properties, required, additionalProperties: false,
});
type IdParams = { Params: { id: string } };

function cookieToken(cookie: string | undefined): string | undefined {
  const value = cookie?.split(';').map((part) => part.trim()).find((part) => part.startsWith('fleet_token='));
  if (!value) return undefined;
  try { return decodeURIComponent(value.slice('fleet_token='.length)); }
  catch { return undefined; }
}

export function buildServer(o: {
  service: TaskService; store: Store; bus: Bus; token: string; webDist?: string;
}): FastifyInstance {
  const { service, store, bus } = o;
  const app = fastify({ ajv: { customOptions: { coerceTypes: true } } });
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
      if (url.pathname === '/api/health' || !protectedPath(url.pathname)) return;
      const authenticated = matches(request.headers['x-fleet-token'])
        || matches(cookieToken(request.headers.cookie))
        || ((url.pathname === '/ws' || url.pathname.startsWith('/ws/')) && matches(url.searchParams.get('token')));
      if (!authenticated) return reply.code(401).send({ error: 'unauthorized', message: 'Invalid or missing fleet token' });
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
    routes.get('/api/health', async () => ({ ok: true }));
    routes.get('/api/plans', async () => store.listPlans());
    routes.post<{ Body: Parameters<TaskService['createPlan']>[0] }>('/api/plans', {
      schema: { body: objectSchema({ name: nonempty, repoPath: nonempty, baseBranch: nonempty }, ['name', 'repoPath']) },
    }, async (request) => service.createPlan(request.body));

    routes.post<{ Body: Parameters<TaskService['run']>[0] }>('/api/tasks', {
      schema: { body: objectSchema({ planId: nonempty, agent, title: nonempty, brief: text, checkCmd: text }, ['planId', 'agent', 'title', 'brief']) },
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
      schema: { body: objectSchema({ agent, note: text }, ['note']) },
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
