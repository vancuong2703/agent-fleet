import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { DailyTokenChart } from '../../web/src/ui/DailyTokenChart.js';
import {
  buildDailyTokenSeries,
  validToken,
  type DailyTokenBin,
} from '../../web/src/ui/model.js';

describe('validToken', () => {
  test('accepts finite non-negative numbers', () => {
    expect(validToken(0)).toBe(true);
    expect(validToken(100)).toBe(true);
    expect(validToken(1.5)).toBe(true);
  });

  test('rejects negative numbers, NaN, Infinity, null, undefined, strings', () => {
    expect(validToken(-1)).toBe(false);
    expect(validToken(-0.01)).toBe(false);
    expect(validToken(NaN)).toBe(false);
    expect(validToken(Infinity)).toBe(false);
    expect(validToken(-Infinity)).toBe(false);
    expect(validToken(null)).toBe(false);
    expect(validToken(undefined)).toBe(false);
    expect(validToken('100')).toBe(false);
    expect(validToken({})).toBe(false);
  });
});

describe('buildDailyTokenSeries', () => {
  test('constructs 7 local calendar bins ending on today', () => {
    const now = new Date(2026, 10, 6, 14, 30, 0).getTime(); // 2026-11-06 14:30
    const bins = buildDailyTokenSeries([], 7, now);

    expect(bins).toHaveLength(7);
    expect(bins[0]!.dateKey).toBe('2026-10-31');
    expect(bins[0]!.key).toBe('2026-10-31');
    expect(bins[0]!.isToday).toBe(false);

    expect(bins[6]!.dateKey).toBe('2026-11-06');
    expect(bins[6]!.key).toBe('2026-11-06');
    expect(bins[6]!.isToday).toBe(true);

    // Check midnight local boundaries
    for (const bin of bins) {
      const s = new Date(bin.start);
      expect(s.getHours()).toBe(0);
      expect(s.getMinutes()).toBe(0);
      expect(s.getSeconds()).toBe(0);
      expect(s.getMilliseconds()).toBe(0);

      const e = new Date(bin.end);
      expect(e.getHours()).toBe(0);
      expect(e.getMinutes()).toBe(0);
      expect(e.getSeconds()).toBe(0);
      expect(e.getMilliseconds()).toBe(0);
      expect(bin.end).toBeGreaterThan(bin.start);
    }
  });

  test('keeps a 23:50 local run in that local day even if UTC date differs', () => {
    // Construct local midnight boundaries
    const localDay = new Date(2026, 10, 4, 23, 50, 0); // 2026-11-04 23:50
    const now = new Date(2026, 10, 6, 12, 0, 0).getTime();
    const bins = buildDailyTokenSeries([
      { id: 'r-late', startedAt: localDay.getTime(), inputTokens: 50, outputTokens: 25 },
    ], 7, now);

    const targetBin = bins.find((b) => b.dateKey === '2026-11-04');
    expect(targetBin).toBeDefined();
    expect(targetBin!.totalTokens).toBe(75);
    expect(targetBin!.reportedRuns).toBe(1);
    expect(targetBin!.inputTokens).toBe(50);
    expect(targetBin!.outputTokens).toBe(25);
  });

  test('reportedTotal / totalTokens is null when reportedRuns === 0', () => {
    const now = new Date(2026, 10, 6, 12).getTime();
    const bins = buildDailyTokenSeries([], 7, now);

    expect(bins[6]!.totalTokens).toBeNull();
    expect(bins[6]!.reportedTotal).toBeNull();
    expect(bins[6]!.reportedRuns).toBe(0);
    expect(bins[6]!.unreportedRuns).toBe(0);
    expect(bins[6]!.coverage).toBe('none');
  });

  test('reportedTotal / totalTokens is 0 when a run explicitly reports 0/0', () => {
    const now = new Date(2026, 10, 6, 12).getTime();
    const bins = buildDailyTokenSeries([
      { id: 'r-zero', startedAt: new Date(2026, 10, 6, 8).getTime(), inputTokens: 0, outputTokens: 0 },
    ], 7, now);

    expect(bins[6]!.totalTokens).toBe(0);
    expect(bins[6]!.reportedTotal).toBe(0);
    expect(bins[6]!.reportedRuns).toBe(1);
    expect(bins[6]!.unreportedRuns).toBe(0);
    expect(bins[6]!.coverage).toBe('complete');
  });

  test('partial coverage when only inputTokens is reported', () => {
    const now = new Date(2026, 10, 6, 12).getTime();
    const bins = buildDailyTokenSeries([
      { id: 'r-a', startedAt: new Date(2026, 10, 6, 9).getTime(), inputTokens: 120, outputTokens: null },
    ], 7, now);

    expect(bins).toHaveLength(7);
    expect(bins[0]!.key).toBe('2026-10-31');
    expect(bins[6]).toMatchObject({
      key: '2026-11-06',
      input: 120,
      output: null,
      reportedTotal: 120,
      runs: 1,
      reportedRuns: 1,
      coverage: 'partial',
    });
  });

  test('deduplicates by run.id keeping the latest array entry', () => {
    const now = new Date(2026, 10, 6, 12).getTime();
    const ts = new Date(2026, 10, 6, 8).getTime();
    const runs = [
      { id: 'r-dup', startedAt: ts, inputTokens: 10, outputTokens: 5 },
      { id: 'r-dup', startedAt: ts, inputTokens: 100, outputTokens: 50 },
    ];
    const bins = buildDailyTokenSeries(runs, 7, now);

    expect(bins[6]!.reportedRuns).toBe(1);
    expect(bins[6]!.inputTokens).toBe(100);
    expect(bins[6]!.outputTokens).toBe(50);
    expect(bins[6]!.totalTokens).toBe(150);
  });

  test('does not collapse distinct runs without id', () => {
    const now = new Date(2026, 10, 6, 12).getTime();
    const ts = new Date(2026, 10, 6, 8).getTime();
    const runs = [
      { startedAt: ts, inputTokens: 10, outputTokens: 5 },
      { startedAt: ts, inputTokens: 20, outputTokens: 10 },
    ];
    const bins = buildDailyTokenSeries(runs, 7, now);

    expect(bins[6]!.reportedRuns).toBe(2);
    expect(bins[6]!.totalTokens).toBe(45);
  });

  test('ignores runs outside window, in the future (> now), or with invalid startedAt', () => {
    const now = new Date(2026, 10, 6, 12).getTime();
    const oldTs = new Date(2026, 9, 20).getTime(); // far in past
    const futureTs = new Date(2026, 10, 6, 13).getTime(); // > now

    const runs = [
      { id: 'r-old', startedAt: oldTs, inputTokens: 100, outputTokens: 100 },
      { id: 'r-future', startedAt: futureTs, inputTokens: 200, outputTokens: 200 },
      { id: 'r-null', startedAt: null, inputTokens: 300, outputTokens: 300 },
      { id: 'r-nan', startedAt: NaN, inputTokens: 400, outputTokens: 400 },
    ];

    const bins = buildDailyTokenSeries(runs as any, 7, now);
    const totalReported = bins.reduce((sum, b) => sum + b.reportedRuns, 0);
    expect(totalReported).toBe(0);
  });

  test('classifies runs with NaN or negative tokens as unreported', () => {
    const now = new Date(2026, 10, 6, 12).getTime();
    const ts = new Date(2026, 10, 6, 8).getTime();
    const runs = [
      { id: 'r-neg', startedAt: ts, inputTokens: -10, outputTokens: NaN },
    ];

    const bins = buildDailyTokenSeries(runs as any, 7, now);
    expect(bins[6]!.reportedRuns).toBe(0);
    expect(bins[6]!.unreportedRuns).toBe(1);
    expect(bins[6]!.totalTokens).toBeNull();
  });

  test('accumulates tokens by agent correctly', () => {
    const now = new Date(2026, 10, 6, 12).getTime();
    const ts = new Date(2026, 10, 6, 8).getTime();
    const runs = [
      { id: 'r-1', agent: 'codex', startedAt: ts, inputTokens: 100, outputTokens: 50 },
      { id: 'r-2', agent: 'qodercli', startedAt: ts, inputTokens: 200, outputTokens: 100 },
      { id: 'r-3', agent: 'codex', startedAt: ts, inputTokens: 50, outputTokens: 25 },
    ];

    const bins = buildDailyTokenSeries(runs as any, 7, now);
    expect(bins[6]!.byAgent.codex).toBe(225);
    expect(bins[6]!.byAgent.qodercli).toBe(300);
    expect(bins[6]!.totalTokens).toBe(525);
  });

  test('does not mutate input array', () => {
    const now = new Date(2026, 10, 6, 12).getTime();
    const runs = Object.freeze([
      Object.freeze({ id: 'r-1', startedAt: now - 1000, inputTokens: 10, outputTokens: 20 }),
    ]);

    expect(() => buildDailyTokenSeries(runs, 7, now)).not.toThrow();
  });
});

describe('DailyTokenChart component rendering', () => {
  const now = new Date(2026, 10, 6, 12).getTime();

  test('renders calm skeleton state when loading', () => {
    const bins = buildDailyTokenSeries([], 7, now);
    const html = renderToStaticMarkup(
      createElement(DailyTokenChart, {
        bins,
        runsLoadState: { loaded: false, refreshing: true, error: null },
      }),
    );

    expect(html).toContain('token-chart-skeleton');
    expect(html).toContain('role="status"');
    expect(html).toContain('Đang tải lịch sử token…');
  });

  test('renders error state with retry button when load failed', () => {
    const bins = buildDailyTokenSeries([], 7, now);
    const html = renderToStaticMarkup(
      createElement(DailyTokenChart, {
        bins,
        runsLoadState: { loaded: false, refreshing: false, error: 'Database error' },
        onRetry: () => {},
      }),
    );

    expect(html).toContain('token-chart-error');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Database error');
    expect(html).toContain('Thử lại');
  });

  test('renders empty state with 7-day axis when no runs in 7 days', () => {
    const bins = buildDailyTokenSeries([], 7, now);
    const html = renderToStaticMarkup(
      createElement(DailyTokenChart, {
        bins,
        runsLoadState: { loaded: true, refreshing: false, error: null },
      }),
    );

    expect(html).toContain('Chưa có lần chạy trong 7 ngày qua.');
    expect(html).toContain('token-axis-row');
    expect(html).toContain('Hôm nay');
  });

  test('renders unreported-only message when runs exist but none reported tokens', () => {
    const runs = [
      { id: 'r-u1', startedAt: new Date(2026, 10, 5, 10).getTime(), inputTokens: null, outputTokens: null },
      { id: 'r-u2', startedAt: new Date(2026, 10, 6, 10).getTime(), inputTokens: null, outputTokens: null },
    ];
    const bins = buildDailyTokenSeries(runs, 7, now);
    const html = renderToStaticMarkup(
      createElement(DailyTokenChart, {
        bins,
        runsLoadState: { loaded: true, refreshing: false, error: null },
      }),
    );

    expect(html).toContain('2 lần chạy không báo cáo token (CLI chỉ trả % gói hoặc credit).');
    expect(html).toContain('token-axis-row');
  });

  test('renders populated 7-day chart with bars, y-axis, and today highlight', () => {
    const runs = [
      { id: 'r-1', agent: 'codex', startedAt: new Date(2026, 10, 5, 10).getTime(), inputTokens: 5000, outputTokens: 1000 },
      { id: 'r-2', agent: 'qodercli', startedAt: new Date(2026, 10, 6, 10).getTime(), inputTokens: 12000, outputTokens: 3000 },
    ];
    const bins = buildDailyTokenSeries(runs as any, 7, now);
    const html = renderToStaticMarkup(
      createElement(DailyTokenChart, {
        bins,
        runsLoadState: { loaded: true, refreshing: false, error: null },
      }),
    );

    expect(html).toContain('daily-token-chart');
    expect(html).toContain('token-bars-track');
    expect(html).toContain('token-y-axis');
    expect(html).toContain('is-today');
    expect(html).toContain('Tổng 7 ngày');
    expect(html).toContain('Xem dữ liệu');
  });
});
