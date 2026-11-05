import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, expect, test, vi } from 'vitest';
import { apiRequest, ensureServer } from '../../cli/client.js';
import { spawn } from 'node:child_process';

vi.mock('node:child_process', async importOriginal => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(() => { throw new Error('Unexpected second server'); }),
}));
vi.mock('../../server/config.js', () => ({ loadConfig: () => ({ port: 4500 }) }));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

test('pinned app connection ignores a stale profile port', async () => {
  vi.stubEnv('FLEET_SERVER_URL', 'http://127.0.0.1:49123');
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{"ok":true,"service":"agent-fleet","instanceId":"inst-1"}'));
  expect(await ensureServer()).toBe('http://127.0.0.1:49123');
  expect(fetch).toHaveBeenCalledWith('http://127.0.0.1:49123/api/health', expect.anything());
});

test('unavailable pinned app fails immediately without starting a second server', async () => {
  vi.stubEnv('FLEET_SERVER_URL', 'http://127.0.0.1:49124');
  const fetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
  await expect(ensureServer()).rejects.toThrow('Pinned Fleet app is unavailable');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(spawn).not.toHaveBeenCalled();
});

test.each(['https://127.0.0.1:4500', 'http://example.com', 'http://127.0.0.1:4500/path', 'http://user:secret@127.0.0.1:4500', 'http://127.0.0.1:4500/?key=secret'])('rejects invalid pinned endpoint without exposing it: %s', async (url) => {
  vi.stubEnv('FLEET_SERVER_URL', url);
  const fetch = vi.spyOn(globalThis, 'fetch');
  await expect(ensureServer()).rejects.toThrow(/^FLEET_SERVER_URL must be an HTTP loopback origin$/);
  expect(fetch).not.toHaveBeenCalled();
});

test('API reads explicitly selected token file without using the redirected profile', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'fleet-connection-'));
  const tokenFile = path.join(dir, 'connection-token');
  await writeFile(tokenFile, 'test-local-connection-credential\n');
  vi.stubEnv('FLEET_TOKEN_FILE', tokenFile);
  let received: string | undefined;
  const server = createServer((req, res) => {
    received = req.headers['x-fleet-token'] as string;
    res.setHeader('content-type', 'application/json');
    res.end('{"ok":true}');
  });
  try {
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP server');
    expect(await apiRequest(`http://127.0.0.1:${address.port}`, '/api/health')).toEqual({ ok: true });
    expect(received).toBe('test-local-connection-credential');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    // Only the unique test directory created above is removed.
    await rm(dir, { recursive: true, force: true });
  }
});
