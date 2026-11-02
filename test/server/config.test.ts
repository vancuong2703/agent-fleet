import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { dataDir, files } from '../../server/paths.js';
import { newId, slugify } from '../../server/ids.js';
import { loadConfig, readOrCreateToken } from '../../server/config.js';

let savedDataDir: string | undefined;
let savedLocalAppData: string | undefined;

beforeEach(() => {
  savedDataDir = process.env.FLEET_DATA_DIR;
  savedLocalAppData = process.env.LOCALAPPDATA;
});

afterEach(() => {
  if (savedDataDir === undefined) delete process.env.FLEET_DATA_DIR;
  else process.env.FLEET_DATA_DIR = savedDataDir;
  if (savedLocalAppData === undefined) delete process.env.LOCALAPPDATA;
  else process.env.LOCALAPPDATA = savedLocalAppData;
});

function tempDir(): string {
  return mkdtempSync(path.join(tmpdir(), 'fleet-task3-'));
}

describe('slugify', () => {
  test('strips Vietnamese diacritics and punctuation to [a-z0-9-]', () => {
    expect(slugify('Plan 2 – Editor Việt')).toBe('plan-2-editor-viet');
  });

  test('handles đ/Đ and collapses separators', () => {
    expect(slugify('Sửa lỗi Đăng nhập!!')).toBe('sua-loi-dang-nhap');
  });

  test('truncates to 40 characters without a trailing dash', () => {
    const long = slugify('a'.repeat(39) + ' b');
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long.endsWith('-')).toBe(false);
  });
});

describe('newId', () => {
  test('task ids match t- plus four base36 chars', () => {
    expect(newId('t')).toMatch(/^t-[0-9a-z]{4}$/);
  });

  test('plan and run ids use their prefix and length', () => {
    expect(newId('p')).toMatch(/^p-[0-9a-z]{4}$/);
    expect(newId('r')).toMatch(/^r-[0-9a-z]{6}$/);
  });
});

describe('paths', () => {
  test('dataDir honors FLEET_DATA_DIR on every call and creates it', () => {
    const first = tempDir();
    const second = tempDir();
    process.env.FLEET_DATA_DIR = first;
    expect(dataDir()).toBe(first);
    expect(existsSync(first)).toBe(true);

    process.env.FLEET_DATA_DIR = second;
    expect(dataDir()).toBe(second);
    expect(existsSync(second)).toBe(true);
  });

  test('files live under the current data dir', () => {
    const dir = tempDir();
    process.env.FLEET_DATA_DIR = dir;

    expect(files.db()).toBe(path.join(dir, 'fleet.db'));
    expect(files.log('r-abc123')).toBe(path.join(dir, 'logs', 'r-abc123.jsonl'));
    expect(files.brief('r-abc123')).toBe(path.join(dir, 'briefs', 'r-abc123.md'));
    expect(files.worktree('my-repo', 't-1a2b')).toBe(
      path.join(dir, 'worktrees', 'my-repo', 't-1a2b'),
    );
    expect(files.token()).toBe(path.join(dir, 'token'));
    expect(files.config()).toBe(path.join(dir, 'fleet.config.json'));
  });
});

describe('loadConfig', () => {
  test('writes a config with detected bins and defaults when missing', () => {
    const dir = tempDir();
    process.env.FLEET_DATA_DIR = dir;

    const cfg = loadConfig();

    expect(cfg.port).toBe(4500);
    expect(cfg.maxParallelTotal).toBe(4);
    expect(cfg.timeouts).toEqual({ totalMin: 30, idleMin: 10 });

    const raw = JSON.parse(readFileSync(files.config(), 'utf8')) as {
      port: number;
      maxParallelTotal: number;
      timeouts: { totalMin: number; idleMin: number };
      agents: Record<string, { bin: string | null; maxParallel: number; extraArgs: string[] }>;
    };
    expect(raw.port).toBe(4500);
    expect(raw.maxParallelTotal).toBe(4);
    expect(raw.timeouts).toEqual({ totalMin: 30, idleMin: 10 });
    expect(Object.keys(raw.agents).sort()).toEqual(['agy', 'codex', 'opencode', 'qodercli']);
    for (const id of Object.keys(raw.agents)) {
      const agent = raw.agents[id]!;
      expect(agent.maxParallel).toBe(2);
      expect(agent.extraArgs).toEqual([]);
      expect(agent.bin === null || typeof agent.bin === 'string').toBe(true);
    }
  });

  test('fills missing keys with defaults from a partial config', () => {
    const dir = tempDir();
    process.env.FLEET_DATA_DIR = dir;
    writeFileSync(files.config(), JSON.stringify({ port: 4600 }), 'utf8');

    const cfg = loadConfig();

    expect(cfg.port).toBe(4600);
    expect(cfg.maxParallelTotal).toBe(4);
    expect(cfg.timeouts).toEqual({ totalMin: 30, idleMin: 10 });
    expect(cfg.agents.codex.maxParallel).toBe(2);
    expect(cfg.agents.codex.extraArgs).toEqual([]);
    expect(cfg.agents.opencode.maxParallel).toBe(2);
  });

  test('keeps provided agent fields and explicit null bins', () => {
    const dir = tempDir();
    process.env.FLEET_DATA_DIR = dir;
    writeFileSync(
      files.config(),
      JSON.stringify({
        port: 4700,
        agents: { codex: { bin: null, maxParallel: 5, extraArgs: ['--fast'] } },
        timeouts: { idleMin: 3 },
      }),
      'utf8',
    );

    const cfg = loadConfig();

    expect(cfg.port).toBe(4700);
    expect(cfg.agents.codex).toEqual({ bin: null, maxParallel: 5, extraArgs: ['--fast'] });
    expect(cfg.timeouts).toEqual({ totalMin: 30, idleMin: 3 });
    expect(cfg.agents.agy.maxParallel).toBe(2);
  });
});

describe('readOrCreateToken', () => {
  test('returns the same 32-character hex token twice and stores it', () => {
    const dir = tempDir();
    process.env.FLEET_DATA_DIR = dir;

    const first = readOrCreateToken();
    const second = readOrCreateToken();

    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(second).toBe(first);
    expect(readFileSync(files.token(), 'utf8').trim()).toBe(first);
  });
});
