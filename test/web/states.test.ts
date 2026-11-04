import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { DiffView } from '../../web/src/components/DiffView.js';
import { LogView } from '../../web/src/components/LogView.js';
import { Skeleton } from '../../web/src/components/Skeleton.js';
import { diffBadgeLabel, loadError, withLoadState } from '../../web/src/store.js';
import { INSPECTOR_OVERLAY_MAX_WIDTH, inspectorDefaultOpen } from '../../web/src/layout.js';
import type { Run, StoredEvent } from '../../shared/types.js';

function makeRun(id = 'r-1'): Run {
  return {
    id,
    taskId: 't-1',
    attempt: 1,
    agent: 'fake',
    brief: 'raw fixture',
    note: null,
    status: 'done',
    pid: null,
    exitCode: 0,
    startedAt: 0,
    endedAt: 1000,
    durationMs: 1000,
    checkPassed: true,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    finalMessage: null,
    errorCategory: null,
    sessionId: null,
  };
}

function rawEvent(seq: number, text: string): StoredEvent {
  return { runId: 'r-1', seq, ts: seq * 1000, event: { kind: 'raw', stream: 'stdout', text } };
}

function renderLog(props: Partial<Parameters<typeof LogView>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(LogView, {
      runs: [makeRun()],
      events: [],
      runId: 'r-1',
      onSelectRun: () => {},
      ...props,
    }),
  );
}

describe('load-state helpers', () => {
  test('"Thay đổi (n)" waits for the patch before showing a count', () => {
    expect(diffBadgeLabel(false, 0)).toBe('Thay đổi');
    expect(diffBadgeLabel(false, 3)).toBe('Thay đổi');
    expect(diffBadgeLabel(true, 0)).toBe('Thay đổi (0)');
    expect(diffBadgeLabel(true, 3)).toBe('Thay đổi (3)');
  });

  test('a load error keeps the message for the retry banner', () => {
    expect(loadError(new Error('boom'))).toEqual({ loaded: false, error: 'boom' });
    expect(loadError('plain')).toEqual({ loaded: false, error: 'plain' });
  });

  test('per-run load bookkeeping stays bounded', () => {
    let states: Record<string, ReturnType<typeof loadError>> = {};
    for (let index = 0; index < 40; index += 1) {
      states = withLoadState(states, `run-${index}`, loadError('failed'));
    }
    expect(Object.keys(states)).toHaveLength(30);
    expect(states['run-0']).toBeUndefined();
    expect(states['run-39']).toEqual({ loaded: false, error: 'failed' });
    // Updating an existing run keeps its newest state instead of trimming it.
    states = withLoadState(states, 'run-39', { loaded: true, error: null });
    expect(states['run-39']).toEqual({ loaded: true, error: null });
    expect(Object.keys(states)).toHaveLength(30);
  });

  test('the inspector starts closed at the overlay breakpoint and below', () => {
    expect(inspectorDefaultOpen(INSPECTOR_OVERLAY_MAX_WIDTH)).toBe(false);
    expect(inspectorDefaultOpen(375)).toBe(false);
    expect(inspectorDefaultOpen(1051)).toBe(true);
    expect(inspectorDefaultOpen(1440)).toBe(true);
  });
});

describe('loading placeholders never render empty-state copy', () => {
  test('the welcome skeleton is announced as busy', () => {
    const html = renderToStaticMarkup(createElement(Skeleton, { label: 'Đang tải công việc' }));
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('Đang tải công việc');
  });

  test('log shows a skeleton instead of "Chưa có sự kiện." while loading', () => {
    const html = renderLog({ loading: true });
    expect(html).toContain('Đang tải nhật ký');
    expect(html).not.toContain('Chưa có sự kiện.');
  });

  test('log shows the empty copy only after a successful read', () => {
    const html = renderLog({ loading: false });
    expect(html).toContain('Chưa có sự kiện.');
    expect(html).not.toContain('Đang tải nhật ký...');
  });

  test('a failed log read shows a retry banner and never the empty copy', () => {
    const html = renderLog({ error: 'mất kết nối', onRetry: () => {} });
    expect(html).toContain('Không tải được nhật ký: mất kết nối');
    expect(html).toContain('Thử lại');
    expect(html).not.toContain('Chưa có sự kiện.');
  });

  test('diff shows a skeleton and an error with retry instead of "no changes"', () => {
    const loading = renderToStaticMarkup(createElement(DiffView, { files: [], patch: '', loading: true }));
    expect(loading).toContain('Đang tải thay đổi');
    expect(loading).not.toContain('Chưa có thay đổi');

    const failed = renderToStaticMarkup(createElement(DiffView, { files: [], patch: '', error: 'hỏng', onRetry: () => {} }));
    expect(failed).toContain('Không tải được thay đổi: hỏng');
    expect(failed).toContain('Thử lại');
    expect(failed).not.toContain('Chưa có thay đổi');
  });
});

describe('raw log rows are real buttons', () => {
  test('the collapsed raw group and every rendered raw line is a button', () => {
    const html = renderLog({ events: [rawEvent(1, 'one'), rawEvent(2, 'two')] });
    expect(html).toContain('<button type="button" class="log-line raw-toggle"');
    expect(html).not.toContain('role="button"');
    expect(html).not.toContain('<div class="log-line kind-line-raw"');
  });

  test('a normal line stays a plain div so it does not steal focus', () => {
    const html = renderLog({ events: [{ runId: 'r-1', seq: 1, ts: 1000, event: { kind: 'message', text: 'hi' } }] });
    expect(html).toContain('<div class="log-line kind-line-message"');
    expect(html).not.toContain('raw-toggle');
  });

  test('event kinds display Vietnamese labels while class names and payload keep the raw kind', () => {
    const html = renderLog({
      events: [{ runId: 'r-1', seq: 1, ts: 1000, event: { kind: 'file_edit', path: 'src/a.ts', added: 2, removed: 1 } }],
    });
    expect(html).toContain('kind-file_edit');
    expect(html).toContain('Sửa tệp');
    expect(html).toContain('src/a.ts');
    expect(html).not.toContain('>file_edit</span>');
  });

  test('collapsed raw runs use a Vietnamese label without hiding the payload text', () => {
    const html = renderLog({ events: [rawEvent(1, 'payload-one'), rawEvent(2, 'payload-two')] });
    expect(html).toContain('Dữ liệu thô');
    expect(html).toContain('2 dòng dữ liệu thô');
  });
});
