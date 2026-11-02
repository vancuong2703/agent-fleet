import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { PtyManager } from '../../server/pty.js';

let root: string;
let manager: PtyManager;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'fleet pty-'));
  manager = new PtyManager(() => ({ cmd: 'cmd.exe', args: [], cwd: root }));
});

afterEach(async () => {
  // Every PTY this suite opened must be dead before the temp dir can go.
  manager.killAll();
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('PtyManager', () => {
  test('kill(taskId) waits for exit, releases its slot and ignores missing sessions', async () => {
    const session = manager.open('t-target');
    const exit = vi.fn();
    session.onExit(exit);
    await manager.kill('t-target');
    expect(exit).toHaveBeenCalledOnce();
    expect(manager.get('t-target')).toBeUndefined();
    await expect(manager.kill('missing')).resolves.toBeUndefined();
  }, 10_000);
  test('runs the fallback shell, delivers output and reuses one session per task', async () => {
    const session = manager.open('t-aaaa', 80, 24);
    let output = '';
    const off = session.onData((data) => { output += data; });
    try {
      session.write('echo fleet-ok\r');
      await vi.waitFor(() => expect(output).toContain('fleet-ok'), { timeout: 4_000 });
      expect(manager.get('t-aaaa')).toBe(session);
      expect(manager.open('t-aaaa', 80, 24)).toBe(session);
    } finally {
      off();
    }
  }, 10_000);

  test('re-attaching replays the buffered output', async () => {
    const session = manager.open('t-cccc', 80, 24);
    let first = '';
    const off = session.onData((data) => { first += data; });
    session.write('echo replay-me\r');
    await vi.waitFor(() => expect(first).toContain('replay-me'), { timeout: 4_000 });
    off();

    let replay = '';
    session.onData((data) => { replay += data; });
    expect(replay).toContain('replay-me');
  }, 10_000);

  test('kill fires onExit and releases the task slot', async () => {
    const session = manager.open('t-bbbb', 120, 30);
    const exited = new Promise<number>((resolve) => { session.onExit(resolve); });
    session.kill();
    await expect(exited).resolves.toBeTypeOf('number');
    expect(manager.get('t-bbbb')).toBeUndefined();
  }, 10_000);
});
