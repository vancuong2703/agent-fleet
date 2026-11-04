import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type { DashboardCheck, DashboardTool, QuotaWindow } from '../../shared/dashboard.js';
import { ComparisonGauges, CreditText } from '../../web/src/ui/Compare.js';
import { Gauge, Meter, Ring } from '../../web/src/ui/Common.js';
import { buildTokenBins, compact, creditWindow, known, lowestQuota, sortOffers, toolHealth } from '../../web/src/ui/model.js';

const balance = { remaining: null, unit: null, resetAt: null, source: 'fixture', reason: null } as const;
const check = (quotaWindows: QuotaWindow[] = []): DashboardCheck => ({ checkedAt: 1, status: 'ready', version: null, account: { state: 'unknown', label: null, source: 'fixture', reason: null }, quota: balance, credits: balance, quotaWindows, probes: [] });
const tool = (lastCheck: DashboardCheck | null, agent: DashboardTool['agent'] = 'codex'): DashboardTool => ({ agent, title: agent, installed: true, configuredBin: null, lastCheck, suggestions: [] });
const html = (component: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(component);

describe('reference UI preserves the meaning of real CLI data', () => {
  test('missing, invalid and zero values remain distinct', () => {
    expect(known(NaN)).toBe(false); expect(known(Infinity)).toBe(false);
    expect(compact(null)).toBe('—'); expect(compact(0)).toBe('0');
    const missing = html(createElement(Ring, { pct: null, label: 'Quota' }));
    expect(missing).toContain('Quota: —'); expect(missing).not.toContain('class="val"');
    const zero = html(createElement(Ring, { pct: 0, label: 'Quota' }));
    expect(zero).toContain('Quota: 0%'); expect(zero).toContain('class="val"');
    expect(html(createElement(Meter, { pct: null }))).not.toContain('role="progressbar"');
    expect(html(createElement(Meter, { pct: 0 }))).toContain('aria-valuenow="0"');
  });
  test('used token gauge uses remaining headroom to determine its color', () => {
    const c = check([{ group: 'Pool', window: 'plan', unit: 'tokens', used: 46, limit: 100, remainingPct: 54 }]);
    const markup = html(createElement(ComparisonGauges, { tool: tool(c, 'opencode') }));
    expect(markup).toContain('46%'); expect(markup).toContain('gbar ok');
    expect(markup).toContain('meter');
    expect(html(createElement(Ring, { pct: 92, used: true, label: 'Used' }))).toContain('donut bad');
  });
  test('ring labels are whole percents, so a decimal never runs over the ring', () => {
    const markup = html(createElement(Ring, { pct: 45.9, label: 'Tokens' }));
    expect(markup).toContain('46%');
    expect(markup).not.toContain('45.9%');
    // the arc still uses the precise value
    expect(markup).toContain('--pct:45.9');
  });
  test('a token allowance is labelled as tokens used, not credits', () => {
    const row: QuotaWindow = { group: 'Pool', window: 'plan', unit: 'tokens', used: 46, limit: 100, remainingPct: 54 };
    const markup = html(createElement(Gauge, { row, used: true, pct: 46, number: '46 / 100' }));
    // the harness renders without a provider, so the default is Vietnamese
    expect(markup).toContain('Token đã dùng');
    expect(markup).not.toContain('Credit còn lại');
    expect(markup).toContain('46%');
  });
  test('separate credit buckets never imply a combined limit', () => {
    const c = check([{ group: 'Plan', window: 'plan', unit: 'credits', used: 90, limit: 100, remainingPct: 10 }, { group: 'Bonus', window: 'plan', unit: 'credits', used: 20, limit: 200, remainingPct: 90 }]);
    expect(creditWindow(c)).toBeNull(); expect(lowestQuota(c)?.group).toBe('Plan');
    c.credits = { ...balance, remaining: 190, unit: 'credits' };
    const markup = html(createElement(CreditText, { check: c }));
    expect(markup).toContain('190'); expect(markup).not.toContain('300');
  });
  test('account failure takes priority over positive quota; no check is unknown', () => {
    expect(toolHealth(tool(null))).toBe('plain');
    expect(toolHealth(tool(check()))).toBe('ok');
    expect(toolHealth(tool({ ...check(), status: 'error' }))).toBe('bad');
    expect(toolHealth(tool({ ...check(), status: 'needs-login' }))).toBe('warn');
  });
  test('explicit free offers sort ahead of paid and unknown prices', () => {
    const models = [null, 1, 0].map((multiplier, index) => ({ id: String(index), label: String(index), source: 'catalog' as const, multiplier }));
    expect(sortOffers(models).map(model => model.multiplier)).toEqual([0, 1, null]);
    expect(models.map(model => model.multiplier)).toEqual([null, 1, 0]);
  });
  test('30-day chart includes the oldest days and assigns each token exactly once', () => {
    const now = new Date(2026, 10, 4, 12).getTime();
    const rows = Array.from({ length: 30 }, (_, index) => ({ startedAt: now - index * 86400000, inputTokens: 1, outputTokens: 2 }));
    const bins = buildTokenBins(rows, 30, now);
    expect(bins).toHaveLength(4);
    expect(bins.reduce((sum, bin) => sum + bin.value, 0)).toBe(90);
    expect(bins[0].start).toBe(now - 30 * 86400000);
    expect(bins.at(-1)?.end).toBe(now);
    expect(buildTokenBins([{ startedAt: now - 31 * 86400000, inputTokens: 50, outputTokens: 50 }], 30, now).every(bin => bin.value === 0)).toBe(true);
  });
});
