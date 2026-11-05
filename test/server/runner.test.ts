import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { FleetEvent } from '../../shared/types.js';
import { getAdapter } from '../../server/adapters/index.js';
import type { AgentAdapter } from '../../server/adapters/types.js';
import { isAlive, killTree } from '../../server/process.js';
import { runAttempt } from '../../server/runner.js';

vi.setConfig({ testTimeout: 15_000, hookTimeout: 15_000 });

let cwd: string;
let events: FleetEvent[];
let pids: number[];
let grandchildren: number[];
let controllers: AbortController[];

beforeEach(async () => {
  cwd = await mkdtemp(path.join(tmpdir(), 'fleet runner with spaces-'));
  events = [];
  pids = [];
  grandchildren = [];
  controllers = [];
});

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const controller of controllers) controller.abort();
  for (const pid of grandchildren) {
    if (isAlive(pid)) process.kill(pid);
    await vi.waitFor(() => expect(isAlive(pid)).toBe(false));
  }
  for (const pid of pids) if (isAlive(pid)) await killTree(pid);
  const root = path.resolve(cwd);
  if (path.dirname(root) !== path.resolve(tmpdir()) || !path.basename(root).startsWith('fleet runner with spaces-')) {
    throw new Error(`Unexpected cleanup path: ${root}`);
  }
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function attempt(brief: string, overrides: Partial<Parameters<typeof runAttempt>[0]> = {}) {
  const controller = new AbortController();
  controllers.push(controller);
  return runAttempt({
    adapter: getAdapter('fake'), bin: process.execPath, extraArgs: [], brief,
    briefFile: path.join(cwd, 'brief.md'), cwd,
    timeouts: { totalMs: 8_000, idleMs: 4_000 }, checkCmd: null,
    onEvent: (event) => { events.push(event); },
    onSpawn: (pid) => { pids.push(pid); }, signal: controller.signal,
    ...overrides,
  });
}

function scriptAdapter(script: string): AgentAdapter {
  return {
    ...getAdapter('fake'),
    headless: () => ({ cmd: process.execPath, args: ['-e', script] }),
  };
}

describe('network-step watchdog', () => {
  const emitCommand = (cmd: string, exitCode?: number) =>
    `console.log(JSON.stringify({ type: 'command', cmd: ${JSON.stringify(cmd)}${exitCode === undefined ? '' : `, exitCode: ${exitCode}`} }));`;
  const hang = 'setInterval(() => {}, 1000);';
  const watch = (script: string, networkMs = 400, extra: Partial<Parameters<typeof runAttempt>[0]> = {}) =>
    attempt('', { adapter: scriptAdapter(script), timeouts: { totalMs: 6_000, idleMs: 5_000, networkMs }, ...extra });
  const watchdogError = () => events.find(event => event.kind === 'error' && event.text.startsWith('Lệnh mạng không phản hồi sau '));

  test.each([
    'curl -s https://example.invalid/x', 'wget http://example.invalid', 'powershell -c "Invoke-WebRequest http://x"',
    'iwr http://x', 'Invoke-RestMethod http://x', 'irm http://x', 'Start-BitsTransfer http://x c:\\y', 'aria2c http://x',
    'C:\\tools\\curl.exe -L http://x',
  ])('a started %s with no further event stops the run as timeout', async (cmd) => {
    const outcome = await watch(emitCommand(cmd) + hang);
    expect(outcome.status).toBe('timeout');
    expect(watchdogError()).toMatchObject({ kind: 'error', text: expect.stringMatching(/^Lệnh mạng không phản hồi sau [\d.]+ phút: /) });
  });

  test('long commands are truncated in the message', async () => {
    await watch(emitCommand('curl ' + 'a'.repeat(500)) + hang);
    expect((watchdogError() as { text: string }).text.length).toBeLessThan(220);
  });

  test('a command that finishes in time, or a non-network command, does not trigger it', async () => {
    const finishes = emitCommand('curl http://x') + `setTimeout(() => { ${emitCommand('curl http://x', 0)} }, 100); setTimeout(() => process.exit(0), 900);`;
    expect((await watch(finishes)).status).toBe('done');
    const outcome = await watch(emitCommand('git status') + hang, 400, { timeouts: { totalMs: 1_800, idleMs: 5_000, networkMs: 400 } });
    expect(outcome.status).toBe('timeout');
    expect(watchdogError()).toBeUndefined();
  });

  test('another non-usage event cancels the watch; usage events do not', async () => {
    const progress = emitCommand('curl http://x') + `setTimeout(() => console.log(JSON.stringify({ type: 'message', text: 'progress' })), 150); setTimeout(() => process.exit(0), 900);`;
    expect((await watch(progress)).status).toBe('done');
    events.length = 0;
    const usage = "setInterval(() => console.log(JSON.stringify({ type: 'usage', inputTokens: 1 })), 100);";
    expect((await watch(emitCommand('curl http://x') + usage)).status).toBe('timeout');
    expect(watchdogError()).toBeDefined();
  });

  test('raw heartbeat lines do not keep a stuck network command alive', async () => {
    const heartbeat = "setInterval(() => console.log('still alive'), 100);";
    expect((await watch(emitCommand('curl http://x') + heartbeat)).status).toBe('timeout');
    expect(watchdogError()).toBeDefined();
  });

  test('qodercli Bash tool_use with a network command is a started network step', async () => {
    const toolUse = (name: string, command: string) => `console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'tool_use', name: ${JSON.stringify(name)}, input: { command: ${JSON.stringify(command)} } }] } }));`;
    const qoder = { ...getAdapter('qodercli') };
    const stuck = await attempt('', { adapter: { ...qoder, headless: () => ({ cmd: process.execPath, args: ['-e', toolUse('Bash', 'curl -s http://x') + hang] }) }, timeouts: { totalMs: 6_000, idleMs: 5_000, networkMs: 400 } });
    expect(stuck.status).toBe('timeout');
    expect(watchdogError()).toBeDefined();
    events.length = 0;
    const other = await attempt('', { adapter: { ...qoder, headless: () => ({ cmd: process.execPath, args: ['-e', toolUse('Read', 'curl http://x') + hang] }) }, timeouts: { totalMs: 1_500, idleMs: 5_000, networkMs: 400 } });
    expect(other.status).toBe('timeout');
    expect(watchdogError()).toBeUndefined();
  });

  test('networkMs 0 or undefined disables it', async () => {
    for (const networkMs of [0, undefined]) {
      events.length = 0;
      const outcome = await attempt('', { adapter: scriptAdapter(emitCommand('curl http://x') + hang), timeouts: { totalMs: 1_500, idleMs: 5_000, networkMs } });
      expect(outcome.status).toBe('timeout');
      expect(watchdogError()).toBeUndefined();
    }
  });
});

describe('runAttempt', () => {
  test('usage attribution, duplicates and cumulative totals never inflate run accounting', async () => {
    const usage: FleetEvent[] = [
      { kind: 'usage', model: 'one', inputTokens: 10, outputTokens: 2, costUsd: 0.1, usageId: 'delta-one' },
      { kind: 'usage', model: 'one', inputTokens: 10, outputTokens: 2, costUsd: 0.1, usageId: 'delta-one' },
      { kind: 'usage', model: 'two', inputTokens: 300, costUsd: 99, attributionOnly: true },
      { kind: 'usage', inputTokens: 24, outputTokens: 5, costUsd: 0.3, usageScope: 'cumulative', usageId: 'final' },
    ];
    const adapter: AgentAdapter = { ...scriptAdapter("console.log('usage')"), createParser: () => () => usage };
    const outcome = await attempt('', { adapter });
    expect(outcome).toMatchObject({ status: 'done', inputTokens: 24, outputTokens: 5, costUsd: 0.3 });
  });

  test('child exit completes within five seconds even when a detached grandchild inherits stdout', async () => {
    const adapter = scriptAdapter(`
      const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        detached: true, stdio: ['ignore', process.stdout, process.stderr], windowsHide: true,
      });
      require('node:fs').writeFileSync('grandchild.pid', String(child.pid));
      child.unref();
    `);
    const start = Date.now();
    const pending = attempt('', { adapter, timeouts: { totalMs: 15_000, idleMs: 10_000 } });
    const pid = await vi.waitFor(() => Number(readFileSync(path.join(cwd, 'grandchild.pid'), 'utf8')));
    grandchildren.push(pid);
    expect((await pending).status).toBe('done');
    expect(Date.now() - start).toBeLessThan(5_000);
  });

  test('rejects an oversized positional brief with a system error before spawning', async () => {
    const adapter = getAdapter('opencode');
    expect(await attempt('x'.repeat(30_001), { adapter })).toMatchObject({ status: 'failed', errorCategory: 'system' });
    expect(pids).toEqual([]);
    expect(events).toContainEqual({ kind: 'error', category: 'system', text: 'Brief quá dài cho dòng lệnh của opencode (giới hạn ~32k ký tự trên Windows)' });
  });
  test('success writes fake.txt and returns the brief as its final message', async () => {
    const outcome = await attempt('do x');
    expect(outcome).toEqual({
      status: 'done', exitCode: 0, finalMessage: 'do x', errorCategory: null,
      sessionId: null, inputTokens: null, outputTokens: null, costUsd: null, checkPassed: null,
    });
    expect(await readFile(path.join(cwd, 'fake.txt'), 'utf8')).toContain('completed');
    expect(events[0]).toEqual({ kind: 'status', status: 'running' });
    expect(pids).toHaveLength(1);
    expect(isAlive(pids[0]!)).toBe(false);
  });

  test('brief survives unicode and quotes', async () => {
    const brief = 'Sửa "lỗi" ở \'đây\'\nDòng 2 — ✓';
    expect((await attempt(brief)).finalMessage).toBe(brief);
    expect(await readFile(path.join(cwd, 'brief.md'), 'utf8')).toBe(brief);
  });

  test('agent sees PWD equal to its working directory, not the server PWD', async () => {
    // opencode trusts PWD over the real cwd; a stale one made it write into the main repo.
    vi.stubEnv('PWD', 'C:\\somewhere\\else');
    const script = 'console.log(JSON.stringify({ type: "message", text: process.env.PWD }))';
    const outcome = await attempt('x', { adapter: scriptAdapter(script) });
    expect(outcome.finalMessage).toBe(path.win32.resolve(cwd));
  });

  test('writes the brief before asking the adapter to build its command', async () => {
    const fake = getAdapter('fake');
    const headless = vi.fn((input: Parameters<AgentAdapter['headless']>[0]) => {
      expect(readFileSync(input.briefFile, 'utf8')).toBe(input.brief);
      return fake.headless(input);
    });
    const outcome = await attempt('saved first', { adapter: { ...fake, headless } });
    expect(outcome.status).toBe('done');
    expect(headless).toHaveBeenCalledWith(expect.objectContaining({
      bin: process.execPath, extraArgs: [], brief: 'saved first',
      briefFile: path.join(cwd, 'brief.md'), cwd,
    }));
  });

  test('fail returns exit code 3 and agent category', async () => {
    expect(await attempt('[[fail]] do x')).toMatchObject({ status: 'failed', exitCode: 3, errorCategory: 'agent' });
  });

  test('quota returns the category from the last error event', async () => {
    expect(await attempt('[[quota]] do x')).toMatchObject({ status: 'failed', exitCode: 1, errorCategory: 'quota' });
  });

  test('hang reaches the idle timeout within two seconds', async () => {
    const started = Date.now();
    expect((await attempt('[[hang]] do x', { timeouts: { totalMs: 8_000, idleMs: 500 } })).status).toBe('timeout');
    expect(Date.now() - started).toBeLessThan(2_000);
  });

  test('timeout kills child processes', async () => {
    const outcome = await attempt('[[spawn-child-hang]] do x', { timeouts: { totalMs: 1_000, idleMs: 5_000 } });
    const childPid = Number(await readFile(path.join(cwd, 'child.pid'), 'utf8'));
    pids.push(childPid);
    expect(outcome.status).toBe('timeout');
    await delay(1_000);
    expect(isAlive(childPid)).toBe(false);
  });

  test('abort interrupts the running agent', async () => {
    const controller = new AbortController();
    const outcome = await attempt('[[hang]] do x', {
      signal: controller.signal,
      onSpawn: (pid) => { pids.push(pid); controller.abort(); },
    });
    expect(outcome.status).toBe('interrupted');
    expect(isAlive(pids[0]!)).toBe(false);
  });

  test('an already aborted signal does not spawn', async () => {
    const controller = new AbortController();
    controller.abort();
    expect((await attempt('do x', { signal: controller.signal })).status).toBe('interrupted');
    expect(pids).toEqual([]);
  });

  test.each([['exit 0', true], ['exit 1', false]] as const)('check %s records %s and determines the final outcome', async (checkCmd, passed) => {
    expect(await attempt('do x', { checkCmd })).toMatchObject({ status: passed ? 'done' : 'failed', exitCode: 0, checkPassed: passed, errorCategory: passed ? null : 'check' });
    expect(events).toContainEqual({ kind: 'check', cmd: checkCmd, passed, output: '' });
  });

  test('AGY permission denial remains failed even with exit 0 and a passing independent check', async () => {
    const line = JSON.stringify({ event: 'step_update', step_update: {
      state: 'ERROR', step_type: 'tool', tool_name: 'run_command',
      tool_info: { error: { message: 'permission check failed: user denied permission to run command: node check.cjs' } },
    } });
    const adapter: AgentAdapter = {
      ...getAdapter('agy'),
      headless: () => ({ cmd: process.execPath, args: ['-e', `console.log(${JSON.stringify(line)})`] }),
    };
    expect(await attempt('', { adapter, checkCmd: 'exit 0' })).toMatchObject({
      status: 'failed', exitCode: 0, errorCategory: 'permission', checkPassed: true,
    });
    expect(events).toContainEqual({ kind: 'check', cmd: 'exit 0', passed: true, output: '' });
  });

  test('explicit agent errors with exit 0 cannot produce a successful run', async () => {
    const adapter = scriptAdapter(`console.log('{"type":"error","category":"auth","text":"Login required"}')`);
    expect(await attempt('', { adapter })).toMatchObject({ status: 'failed', exitCode: 0, errorCategory: 'auth' });
  });

  test('does not run a check after agent failure', async () => {
    expect((await attempt('[[fail]]', { checkCmd: 'exit 0' })).checkPassed).toBeNull();
    expect(events.some((event) => event.kind === 'check')).toBe(false);
  });

  test('slow messages stay in order and keep resetting the idle timeout', async () => {
    const outcome = await attempt('[[slow]] do x', { timeouts: { totalMs: 8_000, idleMs: 600 } });
    expect(outcome.status).toBe('done');
    expect(events.filter((event) => event.kind === 'message').map((event) => event.text))
      .toEqual(['slow 1', 'slow 2', 'slow 3', 'slow 4', 'slow 5']);
  });

  test('decodes split UTF-8, CRLF, stderr and a final unterminated line', async () => {
    const adapter = scriptAdapter(`
      const b = Buffer.from(JSON.stringify({type:'message',text:'✓ Việt'}) + '\\r\\n');
      const i = b.indexOf(Buffer.from('✓')) + 1;
      process.stdout.write(b.subarray(0, i));
      setTimeout(() => { process.stdout.write(b.subarray(i)); process.stderr.write('plain error\\r\\nlast'); }, 30);
    `);
    expect((await attempt('', { adapter })).finalMessage).toBe('✓ Việt');
    expect(events).toContainEqual({ kind: 'raw', stream: 'stderr', text: 'plain error' });
    expect(events).toContainEqual({ kind: 'raw', stream: 'stderr', text: 'last' });
  });

  test('sums usage and keeps the last session and error category', async () => {
    const data = [
      { type: 'usage', inputTokens: 2, costUsd: 0.25 },
      { type: 'usage', inputTokens: 3, outputTokens: 7, costUsd: 0.5 },
      { type: 'session', id: 'first' }, { type: 'session', id: 'last' },
      { type: 'error', text: 'quota', category: 'quota' },
      { type: 'error', text: 'auth', category: 'auth' },
    ].map((event) => JSON.stringify(event)).join('\n') + '\n';
    const adapter = scriptAdapter(`process.stdout.write(${JSON.stringify(data)}); process.exitCode = 2;`);
    expect(await attempt('', { adapter })).toMatchObject({
      status: 'failed', errorCategory: 'auth', sessionId: 'last', inputTokens: 5, outputTokens: 7, costUsd: 0.75,
    });
  });

  test('a later uncategorized error falls back to agent', async () => {
    const adapter = scriptAdapter(`console.log('{"type":"error","text":"quota","category":"quota"}'); console.log('{"type":"error","text":"oops"}'); process.exitCode = 1;`);
    expect((await attempt('', { adapter })).errorCategory).toBe('agent');
  });

  test('merges adapter environment into the child environment', async () => {
    const adapter: AgentAdapter = {
      ...getAdapter('fake'),
      headless: () => ({ cmd: process.execPath, args: ['-e', 'console.log(process.env.FLEET_RUNNER_TEST); console.log(Boolean(process.env.SystemRoot))'], env: { FLEET_RUNNER_TEST: 'hello' } }),
    };
    expect((await attempt('', { adapter })).status).toBe('done');
    expect(events).toContainEqual({ kind: 'raw', stream: 'stdout', text: 'hello' });
    expect(events).toContainEqual({ kind: 'raw', stream: 'stdout', text: 'true' });
  });

  test('handles a large stdin when the agent exits without reading it', async () => {
    expect((await attempt('[[fail]]' + 'x'.repeat(1_000_000))).status).toBe('failed');
  });

  test('a missing executable fails with a system error', async () => {
    const adapter: AgentAdapter = { ...getAdapter('fake'), headless: () => ({ cmd: path.join(cwd, 'missing.exe'), args: [] }) };
    expect(await attempt('', { adapter })).toMatchObject({ status: 'failed', exitCode: null, errorCategory: 'system' });
    expect(events).toContainEqual(expect.objectContaining({ kind: 'error', category: 'system' }));
  });

  test('truncates check output to 20,000 characters', async () => {
    await writeFile(path.join(cwd, 'check.cjs'), "process.stdout.write('x'.repeat(25_000)); process.stderr.write('end');");
    const checkCmd = `"${process.execPath}" check.cjs`;
    expect((await attempt('', { checkCmd })).checkPassed).toBe(true);
    expect(events.find((event) => event.kind === 'check')).toEqual({ kind: 'check', cmd: checkCmd, passed: true, output: 'x'.repeat(20_000) });
  });

  test('a hanging check is bounded by the total timeout', async () => {
    expect((await attempt('', { checkCmd: 'for /l %i in (0,0,1) do @rem', timeouts: { totalMs: 1_000, idleMs: 5_000 } })).status).toBe('timeout');
  });

  test('abort also interrupts a hanging check', async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1_000);
    try {
      expect((await attempt('', { checkCmd: 'for /l %i in (0,0,1) do @rem', signal: controller.signal })).status).toBe('interrupted');
    } finally {
      clearTimeout(timer);
    }
  });
});

describe('process control', () => {
  test('isAlive recognizes this process and a missing PID', () => {
    expect(isAlive(process.pid)).toBe(true);
    expect(isAlive(999_999_999)).toBe(false);
  });

  test('isAlive treats EPERM as alive', () => {
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error('denied'), { code: 'EPERM' }); });
    expect(isAlive(123)).toBe(true);
    expect(kill).toHaveBeenCalledWith(123, 0);
  });

  test('killTree ignores a missing process', async () => {
    await expect(killTree(999_999_999)).resolves.toBeUndefined();
  });
});
