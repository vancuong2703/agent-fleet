import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ensureServer } from '../../cli/client.js';
import type { Plan, Run, StoredEvent, Task, TaskResult } from '../../shared/types.js';
import { makeTempRepo } from '../helpers/repo.js';

const bin = fileURLToPath(new URL('../../cli/fleet-bin.cjs', import.meta.url));
let dataDir: string;
let repo: string;
let port: number;

async function freePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP port');
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

function cli(...args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [bin, ...args], {
      env: { ...process.env, FLEET_DATA_DIR: dataDir },
      encoding: 'utf8', shell: false, windowsHide: true, timeout: 20_000,
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') return reject(error);
      resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr });
    });
  });
}

async function json<T>(...args: string[]): Promise<T> {
  const response = await cli(...args, '--json');
  expect(response.code, response.stderr).toBe(0);
  const parsed: T = JSON.parse(response.stdout);
  expect(response.stdout).toBe(JSON.stringify(parsed, null, 2) + '\n');
  return parsed;
}

async function api<T>(route: string): Promise<T> {
  const token = await readFile(path.join(dataDir, 'token'), 'utf8');
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { headers: { 'x-fleet-token': token.trim() } });
  expect(response.ok).toBe(true);
  return response.json() as Promise<T>;
}

async function createPlan(): Promise<Plan> {
  return json<Plan>('plan', 'create', 'CLI plan', '--repo', repo, '--base', 'main');
}

async function run(brief = 'hi', extra: string[] = []): Promise<Task> {
  const plan = await createPlan();
  return json<Task>('run', '--plan', plan.id, '--agent', 'fake', '--title', 'T3 Toolbar', '--brief-text', brief, ...extra);
}

async function wait(id: string): Promise<TaskResult> {
  const results = await json<TaskResult[]>('wait', id, '--timeout', '10s');
  expect(results).toHaveLength(1);
  return results[0]!;
}

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'fleet-cli-data-'));
  repo = await makeTempRepo();
  port = await freePort();
  await writeFile(path.join(dataDir, 'fleet.config.json'), JSON.stringify({
    port, agents: Object.fromEntries(['codex', 'qodercli', 'agy', 'opencode'].map((id) => [id, { bin: null }])),
  }));
}, 10_000);

afterEach(async () => {
  try {
    const pid = Number(await readFile(path.join(dataDir, 'server.pid'), 'utf8'));
    process.kill(pid);
    // Windows termination is asynchronous; wait for SQLite handles to close.
    await delay(100);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  } finally {
    // Only remove the two roots created by this test.
    for (const [dir, prefix] of [[dataDir, 'fleet-cli-data-'], [path.dirname(repo), 'agent-fleet repo-']]) {
      const resolved = path.resolve(dir!);
      if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith(prefix!)) {
        throw new Error(`Unexpected cleanup path: ${resolved}`);
      }
    }
    await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    await rm(path.dirname(repo), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
}, 15_000);

describe('fleet CLI', { timeout: 30_000 }, () => {
  test('initial health probe allows three seconds before starting another server', async () => {
    vi.stubEnv('FLEET_DATA_DIR', dataDir);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true,"service":"agent-fleet","instanceId":"inst-1"}'));
    try {
      expect(await ensureServer()).toBe(`http://127.0.0.1:${port}`);
      expect(timeout).toHaveBeenCalledExactlyOnceWith(3_000);
    } finally {
      vi.restoreAllMocks();
      vi.unstubAllEnvs();
    }
  });
  test('server stop shuts down the existing server and prints stopped', async () => {
    await createPlan();
    const response = await cli('server', 'stop');
    expect(response.code, response.stderr).toBe(0);
    expect(response.stdout.trim()).toBe('stopped');
    await expect(readFile(path.join(dataDir, 'server.pid'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fetch(`http://127.0.0.1:${port}/api/health`)).rejects.toThrow();
  });
  test('plan create --json returns an id and subsequent commands reuse the server', async () => {
    const plan = await createPlan();
    expect(plan.id).toMatch(/^p-[a-z0-9]{6}$/);
    const pid = await readFile(path.join(dataDir, 'server.pid'), 'utf8');
    expect(await json<Plan[]>('plan', 'list')).toEqual([plan]);
    expect(await readFile(path.join(dataDir, 'server.pid'), 'utf8')).toBe(pid);
  });

  test('run --agent fake --brief-text hi --json returns a task id', async () => {
    const task = await run();
    expect(task.id).toMatch(/^t-[a-z0-9]{6}$/);
    expect(task.agent).toBe('fake');
  });

  test('wait --json returns the raw API result with done status and exit code 0', async () => {
    const task = await run();
    const result = await wait(task.id);
    expect(result.task.status).toBe('done');
    expect(result.run?.finalMessage).toBe('hi');
    expect(result).toEqual(await api(`/api/tasks/${task.id}`));
  });

  test('diff --stat prints fake.txt and --json keeps files and patch', async () => {
    const task = await run();
    await wait(task.id);
    const stat = await cli('diff', task.id, '--stat');
    expect(stat.code, stat.stderr).toBe(0);
    expect(stat.stdout).toContain('fake.txt');
    expect(stat.stdout).toContain('+1');
    expect((await cli('diff', task.id)).stdout).toContain('+fake agent completed');
    expect(await json('diff', task.id, '--stat')).toEqual(await api(`/api/tasks/${task.id}/diff`));
  });

  test('merge prints merged', async () => {
    const task = await run();
    await wait(task.id);
    const response = await cli('merge', task.id);
    expect(response.code, response.stderr).toBe(0);
    expect(response.stdout).toContain('merged');
    expect(await readFile(path.join(repo, 'fake.txt'), 'utf8')).toContain('fake agent completed');
  });

  test('wait on a fail task exits 1 and preserves API JSON', async () => {
    const task = await run('[[fail]] x');
    const response = await cli('wait', task.id, '--json');
    expect(response.code).toBe(1);
    const results: TaskResult[] = JSON.parse(response.stdout);
    expect(results[0]?.task.status).toBe('failed');
    expect(response.stdout).toBe(JSON.stringify(results, null, 2) + '\n');
  });

  test('failed checks make wait exit 1 and show a useful human diagnostic', async () => {
    const task = await run('hi', ['--check', 'exit 1']);
    const response = await cli('wait', task.id, '--json');
    expect(response.code).toBe(1);
    const results: TaskResult[] = JSON.parse(response.stdout);
    expect(results[0]?.run).toMatchObject({ status: 'failed', errorCategory: 'check', checkPassed: false });
    const human = await cli('result', task.id);
    expect(human.stdout).toContain('Kiểm tra thất bại');
    expect(human.stdout).toContain(`fleet log ${task.id}`);
    expect((await cli('merge', task.id)).code).toBe(1);
  });

  test.each([{ checkPassed: false, errorCategory: null }, { checkPassed: true, errorCategory: 'permission' }])('wait rejects legacy done responses with %j', async (run) => {
    const result = { task: { id: 't-legacy', status: 'done' }, run, files: [] };
    await writeFile(path.join(dataDir, 'token'), 'test-token');
    const server = createHttpServer((request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify(request.url === '/api/health' ? { ok: true, service: 'agent-fleet', instanceId: 'inst-1' } : [result]));
    });
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    try {
      const response = await cli('wait', 't-legacy', '--json');
      expect(response.code).toBe(1);
      expect(JSON.parse(response.stdout)).toEqual([result]);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  test('list shows one task line with status, agent, title, check and duration', async () => {
    const task = await run('hi', ['--check', 'exit 0']);
    await wait(task.id);
    const response = await cli('list', '--plan', task.planId, '--status', 'done');
    expect(response.code, response.stderr).toBe(0);
    expect(response.stdout.trim()).toMatch(new RegExp(`^${task.id}  done  fake  T3 Toolbar  \\(check ✓, \\d+s\\)$`));
    expect(await json('list', '--plan', task.planId, '--status', 'failed')).toEqual([]);
  });

  test('UTF-8 brief files preserve quotes, newlines and Vietnamese text', async () => {
    const plan = await createPlan();
    const brief = 'Sửa "lỗi" ở \'đây\'\nDòng 2 — ✓';
    const filename = path.join(dataDir, 'brief with space.md');
    await writeFile(filename, brief, 'utf8');
    const task = await json<Task>('run', '--plan', plan.id, '--agent', 'fake', '--title', 'Brief file', '--brief', filename);
    await wait(task.id);
    const result = await json<TaskResult>('result', task.id);
    expect(result.run?.finalMessage).toBe(brief);
    expect(result).toEqual(await api(`/api/tasks/${task.id}`));
  });

  test('retry forwards note and agent, and discard handles an empty API response', async () => {
    const task = await run();
    await wait(task.id);
    const retry = await json<Run>('retry', task.id, '--agent', 'fake', '--note', 'Sửa tiếp ✓');
    expect(retry).toMatchObject({ attempt: 2, agent: 'fake', note: 'Sửa tiếp ✓' });
    await wait(task.id);
    expect(await json('discard', task.id)).toBeNull();
    expect((await json<TaskResult>('result', task.id)).task.status).toBe('discarded');
  });

  test.each(['0.001m', '0.05s', '0.00001h'])('wait timeout %s returns current state with exit code 1; stop interrupts', async (timeout) => {
    const task = await run('[[hang]] x');
    const response = await cli('wait', task.id, '--timeout', timeout, '--json');
    expect(response.code).toBe(1);
    expect(['running', 'queued']).toContain(JSON.parse(response.stdout)[0].task.status);
    const stopped = await cli('stop', task.id);
    expect(stopped.code, stopped.stderr).toBe(0);
    expect(stopped.stdout).toContain('interrupted');
  });

  test('wait handles multiple ids and logs tail the latest run', async () => {
    const first = await run('first');
    const second = await run('second');
    const results = await json<TaskResult[]>('wait', first.id, second.id, '--timeout', '90s');
    expect(results.map((result) => result.task.status)).toEqual(['done', 'done']);
    const events = await json<StoredEvent[]>('log', first.id, '--tail', '2');
    expect(events).toHaveLength(2);
    expect(events).toEqual(await api(`/api/runs/${results[0]!.run!.id}/events?tail=2`));
    expect((await cli('log', first.id, '--tail', '50')).stdout).toContain('first');
  });

  test('log --follow drains the final event and exits when the run stops', async () => {
    const task = await run('[[hang]] x');
    let follower: ReturnType<typeof execFile>;
    let started!: () => void;
    const firstOutput = new Promise<void>((resolve) => { started = resolve; });
    const finished = new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      follower = execFile(process.execPath, [bin, 'log', task.id, '--tail', '1', '--follow'], {
        env: { ...process.env, FLEET_DATA_DIR: dataDir },
        encoding: 'utf8', shell: false, windowsHide: true, timeout: 10_000,
      }, (error, stdout, stderr) => resolve({ code: error ? 1 : 0, stdout, stderr }));
      follower.stdout!.once('data', started);
    });
    try {
      await firstOutput;
      expect((await cli('stop', task.id)).code).toBe(0);
      const response = await finished;
      expect(response.code, response.stderr).toBe(0);
      expect(response.stdout.trim().split(/\r?\n/).at(-1)).toBe('interrupted');
    } finally {
      follower!.kill();
    }
  });

  test('doctor prints raw agent API JSON', async () => {
    expect(await json('doctor')).toEqual(await api('/api/agents'));
    expect((await cli('doctor')).stdout).toContain('opencode');
  });

  test('merge refusal is a nonzero exit with its raw API response', async () => {
    const task = await run();
    await wait(task.id);
    await writeFile(path.join(repo, 'dirty.txt'), 'keep');
    const response = await cli('merge', task.id, '--json');
    expect(response.code).toBe(1);
    expect(response.stdout).toBe(JSON.stringify({ ok: false, reason: 'dirty' }, null, 2) + '\n');
  });

  test('API errors exit nonzero and JSON errors retain the server shape', async () => {
    const response = await cli('result', 'missing', '--json');
    expect(response.code).toBe(1);
    const body = JSON.parse(response.stdout);
    expect(body).toMatchObject({ error: 'not_found', message: expect.stringContaining('missing') });
    expect(response.stdout).toBe(JSON.stringify(body, null, 2) + '\n');
    expect((await cli('result', 'missing')).stderr).toContain('missing');
  });

  test('run requires exactly one brief source and invalid durations fail', async () => {
    const plan = await createPlan();
    const args = ['run', '--plan', plan.id, '--agent', 'fake', '--title', 'Invalid'];
    expect((await cli(...args)).code).toBe(1);
    expect((await cli(...args, '--brief', 'missing', '--brief-text', 'x')).code).toBe(1);
    expect((await cli('wait', 'missing', '--timeout', 'oops')).code).toBe(1);
    expect(await json('list')).toEqual([]);
  });
});
