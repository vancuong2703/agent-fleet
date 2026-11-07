import { describe, expect, test } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import type { FleetConfig } from '../../server/config.js';
import { getAdapter, getAdapterConfig } from '../../server/adapters/index.js';

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'fleet-fake-'));
}

function parser() {
  return getAdapter('fake').createParser();
}

describe('fake adapter parser', () => {
  test('maps a message event', () => {
    expect(parser()('{"type":"message","text":"xin chào"}', 'stdout')).toEqual([
      { kind: 'message', text: 'xin chào' },
    ]);
  });

  test('maps a command event with its optional fields', () => {
    expect(
      parser()('{"type":"command","cmd":"npm test","exitCode":1,"output":"fail"}', 'stdout'),
    ).toEqual([{ kind: 'command', cmd: 'npm test', exitCode: 1, output: 'fail' }]);
  });

  test('maps a command event without optional fields', () => {
    expect(parser()('{"type":"command","cmd":"dir"}', 'stdout')).toEqual([
      { kind: 'command', cmd: 'dir' },
    ]);
  });

  test('maps an edit event to file_edit', () => {
    expect(
      parser()('{"type":"edit","path":"src/a.ts","added":3,"removed":1}', 'stdout'),
    ).toEqual([{ kind: 'file_edit', path: 'src/a.ts', added: 3, removed: 1 }]);
  });

  test('maps a usage event', () => {
    expect(
      parser()('{"type":"usage","inputTokens":10,"outputTokens":20,"costUsd":0.5}', 'stdout'),
    ).toEqual([{ kind: 'usage', inputTokens: 10, outputTokens: 20, costUsd: 0.5 }]);
  });

  test('maps a session event', () => {
    expect(parser()('{"type":"session","id":"sess-1"}', 'stdout')).toEqual([
      { kind: 'session', id: 'sess-1' },
    ]);
  });

  test('maps an error event', () => {
    expect(parser()('{"type":"error","text":"boom"}', 'stdout')).toEqual([
      { kind: 'error', text: 'boom' },
    ]);
  });

  test('classifies a rate limit error as quota', () => {
    expect(parser()('{"type":"error","text":"rate limit exceeded"}', 'stdout')).toEqual([
      { kind: 'error', text: 'rate limit exceeded', category: 'quota' },
    ]);
  });

  test('keeps an explicit category and recognises auth errors', () => {
    expect(
      parser()('{"type":"error","text":"not logged in","category":"auth"}', 'stdout'),
    ).toEqual([{ kind: 'error', text: 'not logged in', category: 'auth' }]);
  });

  test('turns a non-JSON line into a raw event with the stream', () => {
    expect(parser()('plain text', 'stderr')).toEqual([
      { kind: 'raw', stream: 'stderr', text: 'plain text' },
    ]);
  });

  test('turns an unknown JSON type into a raw event', () => {
    expect(parser()('{"type":"mystery","text":"?"}', 'stdout')).toEqual([
      { kind: 'raw', stream: 'stdout', text: '{"type":"mystery","text":"?"}' },
    ]);
  });

  test('turns malformed JSON into a raw event', () => {
    expect(parser()('{"type":', 'stdout')).toEqual([
      { kind: 'raw', stream: 'stdout', text: '{"type":' },
    ]);
  });
});

describe('fake adapter', () => {
  test('has id fake, supports headless and always detects ok', async () => {
    const adapter = getAdapter('fake');
    expect(adapter.id).toBe('fake');
    expect(adapter.headlessSupported).toBe(true);
    await expect(
      adapter.detect({ bin: process.execPath, maxParallel: 2, extraArgs: [] }),
    ).resolves.toEqual({ ok: true });
  });

  test('runs the fake agent with node, defaults to success and sends the brief on stdin', () => {
    const spec = getAdapter('fake').headless({
      bin: process.execPath,
      brief: 'làm việc này\nvà việc kia',
      briefFile: 'C:\\tmp\\brief.md',
      cwd: 'C:\\tmp',
      extraArgs: [],
    });

    expect(spec.cmd).toBe(process.execPath);
    expect(spec.args[1]).toBe('success');
    expect(spec.args[0]?.endsWith('fake-agent.mjs')).toBe(true);
    expect(spec.stdin).toBe('làm việc này\nvà việc kia');
  });

  test('takes the scenario from a [[name]] brief prefix and keeps the full brief', () => {
    const brief = '[[slow]] chạy chậm thôi';
    const spec = getAdapter('fake').headless({
      bin: process.execPath,
      brief,
      briefFile: '',
      cwd: '.',
      extraArgs: [],
    });

    expect(spec.args[1]).toBe('slow');
    expect(spec.stdin).toBe(brief);
  });

  test('finalMessage returns the text of the last message event', () => {
    expect(
      getAdapter('fake').finalMessage([
        { kind: 'message', text: 'đầu tiên' },
        { kind: 'raw', stream: 'stdout', text: 'noise' },
        { kind: 'message', text: 'cuối cùng' },
        { kind: 'error', text: 'boom' },
      ]),
    ).toBe('cuối cùng');
  });

  test('finalMessage returns null when there is no message', () => {
    expect(getAdapter('fake').finalMessage([{ kind: 'error', text: 'boom' }])).toBeNull();
  });
});

describe('fake-agent.mjs fixture', () => {
  test('success echoes the full brief, writes fake.txt and exits 0', () => {
    const dir = tempDir();
    const brief = '[[success]] Sửa "lỗi" ở \'đây\'\nDòng 2 — ✓';
    const adapter = getAdapter('fake');
    const spec = adapter.headless({
      bin: process.execPath,
      brief,
      briefFile: '',
      cwd: dir,
      extraArgs: [],
    });

    const result = spawnSync(spec.cmd, spec.args, {
      cwd: dir,
      input: spec.stdin,
      encoding: 'utf8',
      windowsHide: true,
    });

    expect(result.status).toBe(0);
    expect(existsSync(path.join(dir, 'fake.txt'))).toBe(true);

    const parse = adapter.createParser();
    const events = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .flatMap((line) => parse(line, 'stdout'));
    expect(adapter.finalMessage(events)).toBe(brief);
  });

  test('quota prints a rate limit error and exits 1', () => {
    const dir = tempDir();
    const adapter = getAdapter('fake');
    const spec = adapter.headless({
      bin: process.execPath,
      brief: '[[quota]] hãy làm việc',
      briefFile: '',
      cwd: dir,
      extraArgs: [],
    });

    const result = spawnSync(spec.cmd, spec.args, {
      cwd: dir,
      input: spec.stdin,
      encoding: 'utf8',
      windowsHide: true,
    });

    expect(result.status).toBe(1);
    const parse = adapter.createParser();
    const events = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .flatMap((line) => parse(line, 'stdout'));
    expect(events).toContainEqual({
      kind: 'error',
      text: 'rate limit exceeded',
      category: 'quota',
    });
  });

  test('fail exits with code 3', () => {
    const dir = tempDir();
    const adapter = getAdapter('fake');
    const spec = adapter.headless({
      bin: process.execPath,
      brief: '[[fail]] hỏng',
      briefFile: '',
      cwd: dir,
      extraArgs: [],
    });

    const result = spawnSync(spec.cmd, spec.args, { cwd: dir, input: spec.stdin, encoding: 'utf8', windowsHide: true });
    expect(result.status).toBe(3);
  });
});

describe('getAdapterConfig', () => {
  const config = {
    port: 4500,
    agents: {
      codex: { bin: 'C:\\codex.exe', maxParallel: 3, extraArgs: ['--fast'] },
      qodercli: { bin: 'C:\\qodercli.exe', maxParallel: 2, extraArgs: [] },
      agy: { bin: null, maxParallel: 2, extraArgs: [] },
      opencode: { bin: null, maxParallel: 2, extraArgs: [] },
    },
    maxParallelTotal: 4,
    timeouts: { totalMin: 30, idleMin: 10 },
  } as FleetConfig;

  test('returns a built-in config for fake without needing a config entry', () => {
    expect(getAdapterConfig('fake', config)).toEqual({
      bin: process.execPath,
      maxParallel: 2,
      extraArgs: [],
    });
  });

  test('returns the configured entry for real agents', () => {
    expect(getAdapterConfig('codex', config)).toEqual({
      bin: 'C:\\codex.exe',
      maxParallel: 3,
      extraArgs: ['--fast'],
    });
    expect(getAdapterConfig('agy', config).bin).toBeNull();
  });
});
