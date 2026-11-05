import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { apiRequest, detectTokenMismatch, ensureServer, stopServer } from '../../cli/client.js';

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(() => { throw new Error('Unexpected second server'); }),
}));
vi.mock('../../server/config.js', () => ({ loadConfig: () => ({ port: 4500 }) }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

const health = (extra: object = {}) => new Response(JSON.stringify({ ok: true, service: 'agent-fleet', instanceId: 'inst-A', ...extra }));

test('a listener that is not Agent Fleet is not healthy (bare ok:true is rejected)', async () => {
  vi.stubEnv('FLEET_SERVER_URL', 'http://127.0.0.1:49130');
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true}'));
  await expect(ensureServer()).rejects.toThrow('Pinned Fleet app is unavailable');
});

test('pinned instance mismatch names expected and actual and tells user to recopy', async () => {
  vi.stubEnv('FLEET_SERVER_URL', 'http://127.0.0.1:49131');
  vi.stubEnv('FLEET_SERVER_INSTANCE', 'inst-B');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => health());
  const error = await ensureServer().catch((e: Error) => e) as Error;
  expect(error.message).toContain('expected instance inst-B');
  expect(error.message).toContain('got inst-A');
  expect(error.message).toMatch(/recopy the connection/i);
  expect(spawn).not.toHaveBeenCalled();
});

test('pinned instance match is accepted', async () => {
  vi.stubEnv('FLEET_SERVER_URL', 'http://127.0.0.1:49132');
  vi.stubEnv('FLEET_SERVER_INSTANCE', 'inst-A');
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => health());
  expect(await ensureServer()).toBe('http://127.0.0.1:49132');
});

test('a mismatched instance never receives the token', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fleet-instance-'));
  await writeFile(path.join(dir, 'token'), 'test-local-connection-credential');
  vi.stubEnv('FLEET_TOKEN_FILE', path.join(dir, 'token'));
  vi.stubEnv('FLEET_SERVER_INSTANCE', 'inst-B');
  let sawToken = false;
  const server = createServer((req, res) => {
    if (req.headers['x-fleet-token']) sawToken = true;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true, service: 'agent-fleet', instanceId: 'inst-A' }));
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server');
    vi.stubEnv('FLEET_SERVER_URL', `http://127.0.0.1:${address.port}`);
    await expect(ensureServer()).rejects.toThrow('expected instance inst-B');
    await expect(stopServer()).rejects.toThrow('expected instance inst-B');
    expect(sawToken).toBe(false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});

test('unpinned start timeout reports startup-error.json from the data directory', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fleet-startup-'));
  await writeFile(path.join(dir, 'startup-error.json'), JSON.stringify({ code: 'db_corrupt', message: 'integrity check failed', hint: 'Run fleet db repair', at: 1 }));
  vi.stubEnv('FLEET_DATA_DIR', dir);
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
  vi.mocked(spawn).mockImplementationOnce((() => ({ once: () => {}, unref: () => {} })) as never);
  try {
    const error = await ensureServer({ startTimeoutMs: 400 }).catch((e: Error) => e) as Error;
    expect(error.message).toContain('did not become healthy');
    expect(error.message).toContain('db_corrupt: integrity check failed');
    expect(error.message).toContain('Run fleet db repair');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

describe('detectTokenMismatch', () => {
  const local = 'C:\\Users\\Real User\\AppData\\Local';
  const data = `${local}\\AgentFleetDesktop`;
  const shadow = `${local}\\Packages\\Host.Pfn_abc\\LocalCache\\Local\\AgentFleetDesktop\\token`;
  const fakeFs = (present: string[]) => ({
    listDir: (dir: string) => dir === `${local}\\Packages` ? ['Host.Pfn_abc', 'Other_x'] : [],
    exists: (file: string) => present.includes(file),
  });

  test('names the shadow file and prints a UNC FLEET_TOKEN_FILE line for the real path', () => {
    const info = detectTokenMismatch({ LOCALAPPDATA: local }, data, fakeFs([shadow]));
    expect(info.shadowFiles).toEqual([shadow]);
    expect(info.powershell).toBe("$env:FLEET_TOKEN_FILE = '\\\\localhost\\C$\\Users\\Real User\\AppData\\Local\\AgentFleetDesktop\\token'");
  });
  test('no shadow found still gives the real path line, and data outside LOCALAPPDATA has no shadows', () => {
    expect(detectTokenMismatch({ LOCALAPPDATA: local }, data, fakeFs([])).shadowFiles).toEqual([]);
    expect(detectTokenMismatch({ LOCALAPPDATA: local }, 'D:\\elsewhere', fakeFs([shadow])).shadowFiles).toEqual([]);
  });
  test('apostrophes are doubled in the PowerShell literal', () => {
    const info = detectTokenMismatch({ LOCALAPPDATA: local }, "C:\\O'Brien\\data", fakeFs([]));
    expect(info.powershell).toContain("O''Brien");
  });
});

test('401 from the server throws a token-mismatch error naming the shadow file, never the token', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fleet-401-'));
  const local = path.join(dir, 'Local');
  const data = path.join(local, 'agent-fleet');
  const shadow = path.join(local, 'Packages', 'Host_pfn', 'LocalCache', 'Local', 'agent-fleet', 'token');
  await mkdir(path.dirname(shadow), { recursive: true });
  await mkdir(data, { recursive: true });
  await writeFile(shadow, 'test-shadow-credential');
  vi.stubEnv('LOCALAPPDATA', local);
  vi.stubEnv('FLEET_DATA_DIR', data);
  vi.stubEnv('FLEET_TOKEN_FILE', shadow);
  const server = createServer((_req, res) => { res.statusCode = 401; res.setHeader('content-type', 'application/json'); res.end('{"message":"Unauthorized"}'); });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server');
    const error = await apiRequest(`http://127.0.0.1:${address.port}`, '/api/plans').catch((e: Error) => e) as Error;
    expect(error.message).toContain('does not match this app');
    expect(error.message).toContain(shadow);
    expect(error.message).toContain('$env:FLEET_TOKEN_FILE = ');
    expect(error.message).not.toContain('test-shadow-credential');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
});
