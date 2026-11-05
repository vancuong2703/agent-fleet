import { execFile } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const bin = fileURLToPath(new URL('../../cli/fleet-bin.cjs', import.meta.url));
const secret = 'test-cli-command-credential';
let dir: string;
let server: Server | undefined;
let url: string;

function cli(args: string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [bin, ...args], {
      env: { ...process.env, FLEET_DATA_DIR: dir, FLEET_SERVER_URL: '', FLEET_SERVER_INSTANCE: '', FLEET_TOKEN_FILE: '', ...env },
      encoding: 'utf8', shell: false, windowsHide: true, timeout: 25_000,
    }, (error, stdout, stderr) => {
      if (error && typeof error.code !== 'number') return reject(error);
      resolve({ code: typeof error?.code === 'number' ? error.code : 0, stdout, stderr });
    });
  });
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'fleet-cli-cmd-'));
  await writeFile(path.join(dir, 'token'), secret);
  server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    if (req.url === '/api/health') res.end(JSON.stringify({ ok: true, service: 'agent-fleet', instanceId: 'inst-live' }));
    else if (req.headers['x-fleet-token'] !== secret) { res.statusCode = 401; res.end('{"message":"Unauthorized"}'); }
    else res.end('[]');
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected TCP server');
  url = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  await new Promise<void>(resolve => server!.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});

describe('fleet db / connection', { timeout: 40_000 }, () => {
  test('db repair without --yes refuses and describes the steps', async () => {
    const result = await cli(['db', 'repair']);
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/back up/i);
    expect(result.stderr).toContain('REINDEX');
    expect(result.stderr).toContain('--yes');
  });

  test('db repair --yes refuses while a server answers on the pinned URL', async () => {
    const result = await cli(['db', 'repair', '--yes'], { FLEET_SERVER_URL: url });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain(`A Fleet server is running at ${url}`);
  });

  test('connection prints url, instance, pin state and token source, never the token', async () => {
    const result = await cli(['connection', '--json'], { FLEET_SERVER_URL: url, FLEET_SERVER_INSTANCE: 'inst-live' });
    expect(result.code, result.stderr).toBe(0);
    const info = JSON.parse(result.stdout) as Record<string, unknown>;
    expect(info).toMatchObject({ url, instanceId: 'inst-live', pinned: true, instancePinned: true, authenticated: true, tokenSource: path.join(dir, 'token') });
    expect(result.stdout + result.stderr).not.toContain(secret);
  });

  test('connection fails with a mismatch message for the wrong instance', async () => {
    const result = await cli(['connection'], { FLEET_SERVER_URL: url, FLEET_SERVER_INSTANCE: 'inst-other' });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('expected instance inst-other');
    expect(result.stderr).toContain('got inst-live');
  });

  test('connection reports a token mismatch (401) with the PowerShell fix', async () => {
    const wrong = path.join(dir, 'wrong-token');
    await writeFile(wrong, 'not-the-right-credential');
    const result = await cli(['connection'], { FLEET_SERVER_URL: url, FLEET_TOKEN_FILE: wrong });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('does not match this app');
    expect(result.stderr).toContain('$env:FLEET_TOKEN_FILE');
    expect(result.stderr).not.toContain('not-the-right-credential');
  });
});
