import { describe, expect, test } from 'vitest';
import type { DashboardCheck, DashboardTool, ModelOffer, QuotaWindow } from '../../shared/dashboard.js';
import { rankPicks } from '../../shared/dashboard-picks.js';

const window = (remainingPct: number | null): QuotaWindow => ({ group: 'quota', window: 'week', remainingPct, unit: 'percent' });
const offer = (id: string, multiplier: number | null): ModelOffer => ({ id, label: id, multiplier, source: 'cli' });
function tool(agent: DashboardTool['agent'], patch: Partial<DashboardCheck> = {}): DashboardTool {
  return { agent, title: agent, configuredBin: null, installed: true, suggestions: [], lastCheck: {
    checkedAt: 1, status: 'ready', version: '1', account: { state: 'authenticated', label: null, source: 'CLI', reason: null },
    quota: { remaining: null, unit: null, resetAt: null, source: 'CLI', reason: null },
    credits: { remaining: null, unit: null, resetAt: null, source: 'CLI', reason: null }, probes: [], ...patch,
  } };
}
describe('rankPicks', () => {
  test('free models precede inexpensive models, then tools by quota bottleneck', () => {
    const picks = rankPicks([
      tool('codex', { quotaWindows: [window(90)] }),
      tool('qodercli', { models: [offer('cheap', 0.1), offer('free', 0)], quotaWindows: [window(40)] }),
    ]);
    expect(picks.slice(0, 3).map(p => p.modelId ?? p.agent)).toEqual(['free', 'cheap', 'codex']);
  });
  test('uses the lowest window instead of the highest window', () => {
    const picks = rankPicks([tool('codex', { quotaWindows: [window(99), window(30)] }), tool('agy', { quotaWindows: [window(50)] })]);
    expect(picks.filter(p => p.kind === 'tool').map(p => p.agent)).toEqual(['agy', 'codex']);
  });
  test('unchecked tools and tools needing login never become recommendations', () => {
    const unchecked = { ...tool('codex'), lastCheck: null };
    expect(rankPicks([unchecked, tool('agy', { status: 'needs-login', models: [offer('free', 0)] })])).toEqual([]);
  });
  test('null is not exhausted or a known quota', () => {
    expect(rankPicks([tool('codex', { quotaWindows: [window(null)] })])).toEqual([]);
    expect(rankPicks([tool('codex', { models: [offer('unknown price', null)] })])).toEqual([]);
  });
  test('all exhausted tools produce warnings and no misleading recommendations', () => {
    const picks = rankPicks([tool('codex', { quotaWindows: [window(0)], models: [offer('free', 0)] }), tool('agy', { quotaWindows: [window(0)] })]);
    expect(picks).toHaveLength(2);
    expect(picks.every(p => p.kind === 'warning')).toBe(true);
  });
  test('warns below 25 percent but not exactly at the threshold', () => {
    const picks = rankPicks([tool('codex', { quotaWindows: [window(24.9)] }), tool('agy', { quotaWindows: [window(25)] })]);
    expect(picks.filter(p => p.kind === 'warning').map(p => p.agent)).toEqual(['codex']);
  });
  test('pool exhaustion warns even if the windows are unknown', () => {
    const picks = rankPicks([tool('opencode', { keyPools: [{ name: 'pool', total: 2, ok: 1, exhausted: 1, remainingPct: null, limitLabel: 'requests', keys: [] }] })]);
    expect(picks).toHaveLength(1);
    expect(picks[0]).toMatchObject({ kind: 'warning', agent: 'opencode' });
    expect(picks[0]?.reason).toContain('cạn');
  });
  test('never treats invalid numbers as low-price offers or usable quota', () => {
    expect(rankPicks([tool('codex', { models: [offer('negative', -1), offer('NaN', NaN)], quotaWindows: [window(NaN), window(-1), window(101)] })])).toEqual([]);
  });
  test('unknown windows do not replace a reported zero with a made-up positive value', () => {
    const picks = rankPicks([tool('codex', { quotaWindows: [window(null), window(0)] })]);
    expect(picks).toHaveLength(1);
    expect(picks[0]?.kind).toBe('warning');
  });
  test('does not mutate inputs; all picks have Vietnamese reasons and stable ids', () => {
    const tools = [tool('qodercli', { models: [offer('b', 0.1), offer('a', 0)], quotaWindows: [window(70)] })];
    const before = JSON.stringify(tools);
    const first = rankPicks(tools);
    expect(JSON.stringify(tools)).toBe(before);
    expect(first).toEqual(rankPicks(tools));
    expect(first.every(p => p.reason.length > 0 && /miễn phí|hệ số|hạn mức/i.test(p.reason))).toBe(true);
    expect(new Set(first.map(p => p.id)).size).toBe(first.length);
  });
});
