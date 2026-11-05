import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { DiffView } from '../../web/src/components/DiffView.js';
import { ApiError, api } from '../../web/src/api.js';
import { errorMessage, joinWorktreePath } from '../../web/src/desktop.js';
import { STALL_AFTER_MS, progressOf, progressText } from '../../web/src/stuck.js';
import { buildLogRows, describeFailure, extendLogRows, loadRuns } from '../../web/src/store.js';
import type { FleetEvent, Run, StoredEvent } from '../../shared/types.js';

const run = (id: string, taskId: string): Run => ({
  id, taskId, agent: 'fake', attempt: 1, brief: '', note: null, status: 'done', pid: null, exitCode: 0, startedAt: 0, endedAt: 1, durationMs: 1,
  checkPassed: null, inputTokens: null, outputTokens: null, costUsd: null, finalMessage: null, errorCategory: null, sessionId: null,
});

describe('loadRuns', () => {
  test('one GET /api/runs covers every task without per-task requests', async () => {
    const runs = vi.fn(async () => [run('r9', 't9')]);
    const result = await loadRuns([{ id: 't1' }, { id: 't2' }], { allRuns: async () => [run('r1', 't1'), run('r2', 't2')], runs });
    expect(result.runs.map(item => item.id)).toEqual(['r1', 'r2']);
    expect(result.errors).toEqual({});
    expect(runs).not.toHaveBeenCalled();
  });

  test('a missing /api/runs falls back to per-task reads and records each failure under its own task', async () => {
    const result = await loadRuns([{ id: 't1' }, { id: 't2' }, { id: 't3' }], {
      allRuns: async () => { throw new Error('404 Not Found /api/runs'); },
      runs: async (taskId: string) => { if (taskId === 't2') throw new Error('500 history down'); return [run(`r-${taskId}`, taskId)]; },
    });
    expect(result.runs.map(item => item.id)).toEqual(['r-t1', 'r-t3']);
    expect(result.errors).toEqual({ t2: '500 history down' });
    expect(result.fatal).toBeNull();
  });

  test('db_corrupt is a shared fault: no per-task fallback, the message is kept', async () => {
    const runs = vi.fn(async () => []);
    const result = await loadRuns([{ id: 't1' }], {
      allRuns: async () => { throw new ApiError('503 Service Unavailable /api/runs', 503, 'db_corrupt', 'Database file is damaged'); },
      runs,
    });
    expect(result.fatal).toEqual({ message: 'Database file is damaged', code: 'db_corrupt' });
    expect(runs).not.toHaveBeenCalled();
  });

  test('no tasks means no requests', async () => {
    const allRuns = vi.fn(async () => []);
    expect(await loadRuns([], { allRuns, runs: async () => [] })).toEqual({ runs: [], errors: {}, fatal: null });
    expect(allRuns).not.toHaveBeenCalled();
  });
});

describe('failure messages', () => {
  afterEach(() => vi.unstubAllGlobals());

  test('describeFailure shows the Error message, never "Error: …"', () => {
    expect(describeFailure(new Error('boom'))).toEqual({ message: 'boom', code: null });
    expect(errorMessage(new Error('boom'))).toBe('boom');
    expect(errorMessage('plain')).toBe('plain');
  });

  test('a 503 db_corrupt body becomes an ApiError carrying the server message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, statusText: 'Service Unavailable', text: async () => JSON.stringify({ error: 'db_corrupt', message: 'Database file is damaged' }) })));
    const failure = await api.tasks().catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(ApiError);
    expect(describeFailure(failure)).toEqual({ message: 'Database file is damaged', code: 'db_corrupt' });
  });

  test('other failures keep the status line', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, statusText: 'Server Error', text: async () => 'sweep down' })));
    await expect(api.plans()).rejects.toThrow(/500 Server Error \/api\/plans: sweep down/);
  });
});

describe('joinWorktreePath', () => {
  test('keeps the worktree separator and never doubles it', () => {
    expect(joinWorktreePath('C:\\work\\wt\\', 'src/a/b.ts')).toBe('C:\\work\\wt\\src\\a\\b.ts');
    expect(joinWorktreePath('/home/u/wt', 'src/b.ts')).toBe('/home/u/wt/src/b.ts');
  });
});

describe('stuck-run progress', () => {
  test('null is unknown, never zero minutes', () => {
    expect(progressOf(null)).toEqual({ kind: 'unknown' });
    expect(progressOf(undefined)).toEqual({ kind: 'unknown' });
    expect(progressText(progressOf(null), (en) => en)).toBe('No data yet');
    expect(progressText(progressOf(null), (_en, vi) => vi)).toBe('Chưa có dữ liệu');
  });

  test('warning starts after two minutes of silence', () => {
    expect(progressOf(STALL_AFTER_MS).kind).toBe('active');
    expect(progressOf(STALL_AFTER_MS + 1).kind).toBe('stalled');
    expect(progressText(progressOf(5 * 60_000), (_en, vi) => vi)).toBe('Tiến triển cuối 5 phút trước');
    expect(progressText(progressOf(20_000), (en) => en)).toBe('Last progress just now');
  });
});

function event(seq: number, kind: 'message' | 'raw', text = `line ${seq}`): StoredEvent {
  const payload: FleetEvent = kind === 'raw' ? { kind: 'raw', stream: 'stdout', text } : { kind: 'message', text };
  return { runId: 'r1', seq, ts: seq, event: payload };
}

describe('extendLogRows', () => {
  test('appending keeps old rows by identity and equals a full rebuild', () => {
    const first = [event(1, 'message'), event(2, 'raw'), event(3, 'message')];
    const rows = buildLogRows(first);
    const grown = [...first, event(4, 'message'), event(5, 'raw')];
    const next = extendLogRows({ events: first, rows }, grown);
    expect(next).toEqual(buildLogRows(grown));
    expect(next[0]).toBe(rows[0]);
    expect(next[2]).toBe(rows[2]);
  });

  test('a raw group that continues is rebuilt as one row', () => {
    const first = [event(1, 'message'), event(2, 'raw')];
    const grown = [...first, event(3, 'raw')];
    const next = extendLogRows({ events: first, rows: buildLogRows(first) }, grown);
    expect(next).toEqual(buildLogRows(grown));
    expect(next).toHaveLength(2);
    expect(next[1]!.events).toHaveLength(2);
  });

  test('a trimmed head or no previous state rebuilds everything', () => {
    const first = [event(1, 'message'), event(2, 'message')];
    const trimmed = [event(2, 'message'), event(3, 'message')];
    expect(extendLogRows({ events: first, rows: buildLogRows(first) }, trimmed)).toEqual(buildLogRows(trimmed));
    expect(extendLogRows(null, first)).toEqual(buildLogRows(first));
  });
});

describe('DiffView sections', () => {
  const files = (count: number) => Array.from({ length: count }, (_, index) => ({ path: `src/f${index}.ts`, added: index + 1, removed: 0 }));
  const patch = (count: number) => files(count).map(file => `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n@@ -0,0 +1 @@\n+line in ${file.path}\n`).join('');
  const render = (count: number) => renderToStaticMarkup(createElement(DiffView, { files: files(count), patch: patch(count), taskId: 't1', worktreePath: 'C:\\wt' }));

  test('up to three files open every section', () => {
    const html = render(3);
    expect(html.match(/class="diff-body"/g)).toHaveLength(3);
  });

  test('more than three files open only the first and render lines for it alone', () => {
    const html = render(5);
    expect(html.match(/<section class="diff-section/g)).toHaveLength(5);
    expect(html.match(/class="diff-body"/g)).toHaveLength(1);
    expect(html).toContain('line in src/f0.ts');
    expect(html).not.toContain('line in src/f1.ts');
    expect(html).toContain('Mở rộng tất cả');
  });

  test('outside the desktop app the reveal control is a copy-path button, not a disabled one', () => {
    const html = render(1);
    expect(html).toContain('aria-label="Sao chép đường dẫn"');
    expect(html).not.toContain('disabled');
  });
});
