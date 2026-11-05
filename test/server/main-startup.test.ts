import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { corruptRunsIndex, seedDatabase } from './db-corruption-helper.js';

vi.setConfig({ testTimeout: 60_000, hookTimeout: 20_000 });

const tsx = path.resolve('node_modules/tsx/dist/cli.mjs');
const entry = path.resolve('server/main.ts');
let dir: string;
const blockers: net.Server[] = [];

beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'fleet-main-')); });
afterEach(async () => {
  for (const server of blockers.splice(0)) await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

async function freePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => server.close(() => resolve()));
  return port;
}

function writeConfig(port: number): void {
  const agent = { bin: null, maxParallel: 1, extraArgs: [] };
  writeFileSync(path.join(dir, 'fleet.config.json'), JSON.stringify({
    port, agents: { codex: agent, qodercli: agent, agy: agent, opencode: agent }, maxParallelTotal: 1,
    timeouts: { totalMin: 1, idleMin: 1 },
  }));
}

function runMain(args: string[] = []): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [tsx, entry, ...args], {
      env: { ...process.env, FLEET_DATA_DIR: dir }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += String(chunk); });
    child.stderr.on('data', chunk => { stderr += String(chunk); });
    const timer = setTimeout(() => { child.kill(); reject(new Error(`main did not exit\n${stdout}\n${stderr}`)); }, 40_000);
    child.once('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

const startupError = () => JSON.parse(readFileSync(path.join(dir, 'startup-error.json'), 'utf8')) as Record<string, string>;
const noStack = (text: string) => expect(text).not.toMatch(/\n\s+at\s|node:internal|\.ts:\d+/);

describe('server startup failures', () => {
  test('a corrupt history index exits 1 with a db_corrupt report and no raw stack', async () => {
    writeConfig(await freePort());
    seedDatabase(path.join(dir, 'fleet.db'));
    corruptRunsIndex(path.join(dir, 'fleet.db'));
    const result = await runMain();
    expect(result.code).toBe(1);
    expect(startupError()).toMatchObject({ code: 'db_corrupt', message: expect.any(String), hint: expect.stringContaining('--repair-db'), at: expect.any(String) });
    noStack(result.stdout + result.stderr);
  });

  test('a malformed database file also reports db_corrupt', async () => {
    writeConfig(await freePort());
    seedDatabase(path.join(dir, 'fleet.db'));
    corruptRunsIndex(path.join(dir, 'fleet.db'), 'garbage');
    const result = await runMain();
    expect(result.code).toBe(1);
    expect(startupError().code).toBe('db_corrupt');
    noStack(result.stdout + result.stderr);
  });

  test('a busy port reports port_in_use and the report never holds the token', async () => {
    const blocker = net.createServer();
    await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
    blockers.push(blocker);
    writeConfig((blocker.address() as net.AddressInfo).port);
    const result = await runMain();
    expect(result.code).toBe(1);
    expect(startupError().code).toBe('port_in_use');
    const token = readFileSync(path.join(dir, 'token'), 'utf8').trim();
    expect(readFileSync(path.join(dir, 'startup-error.json'), 'utf8')).not.toContain(token);
    noStack(result.stdout + result.stderr);
  });

  test('an unreadable config reports unknown with a Vietnamese hint', async () => {
    writeFileSync(path.join(dir, 'fleet.config.json'), '{ not json');
    const result = await runMain();
    expect(result.code).toBe(1);
    expect(startupError().code).toBe('unknown');
    expect(startupError().hint).toMatch(/[ạảãàáâăêôơưđ]/);
  });
});

describe('node server/main.js --repair-db', () => {
  test('repairs a broken index offline (port busy is irrelevant), prints one JSON line and starts no server', async () => {
    const blocker = net.createServer();
    await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
    blockers.push(blocker);
    writeConfig((blocker.address() as net.AddressInfo).port);
    const { runs } = seedDatabase(path.join(dir, 'fleet.db'));
    corruptRunsIndex(path.join(dir, 'fleet.db'));
    const result = await runMain(['--repair-db']);
    expect(result.code).toBe(0);
    const lines = result.stdout.trim().split(/\r?\n/);
    expect(lines).toHaveLength(1);
    const report = JSON.parse(lines[0]!);
    expect(report).toMatchObject({ ok: true, errors: [], rowCounts: { runs } });
    expect(existsSync(report.backupPath)).toBe(true);
    expect(path.dirname(report.backupPath)).toBe(path.join(dir, 'backups'));
    expect(existsSync(path.join(dir, 'server.pid'))).toBe(false);
  });

  test('repairs garbage index pages too (exit 0, strategy reported)', async () => {
    const { runs } = seedDatabase(path.join(dir, 'fleet.db'));
    corruptRunsIndex(path.join(dir, 'fleet.db'), 'garbage');
    const result = await runMain(['--repair-db']);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toMatchObject({ ok: true, rowCounts: { runs }, strategy: expect.any(String) });
  });

  test('a stale server.pid that is not a node process does not block repair', async () => {
    seedDatabase(path.join(dir, 'fleet.db'));
    corruptRunsIndex(path.join(dir, 'fleet.db'));
    writeFileSync(path.join(dir, 'server.pid'), "4");
    const result = await runMain(['--repair-db']);
    expect(result.code).toBe(0);
  });

  test('a live node process in server.pid blocks repair and nothing is touched', async () => {
    seedDatabase(path.join(dir, 'fleet.db'));
    corruptRunsIndex(path.join(dir, 'fleet.db'));
    const before = readFileSync(path.join(dir, 'fleet.db'));
    writeFileSync(path.join(dir, 'server.pid'), String(process.pid));
    const result = await runMain(['--repair-db']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout.trim()).errors[0]).toContain(String(process.pid));
    expect(readFileSync(path.join(dir, 'fleet.db')).equals(before)).toBe(true);
    expect(existsSync(path.join(dir, 'backups'))).toBe(false);
  });

  test('exits 1 and leaves the file as it was when repair cannot work', async () => {
    seedDatabase(path.join(dir, 'fleet.db'));
    writeFileSync(path.join(dir, 'fleet.db'), 'not a database '.repeat(300));
    const before = readFileSync(path.join(dir, 'fleet.db'));
    const result = await runMain(['--repair-db']);
    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout.trim()).ok).toBe(false);
    expect(readFileSync(path.join(dir, 'fleet.db')).equals(before)).toBe(true);
    expect(readdirSync(path.join(dir, 'backups')).length).toBeGreaterThan(0);
  });
});
