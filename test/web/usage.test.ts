import { describe, expect, test } from 'vitest';

import type { DashboardCheck, DashboardTool } from '../../shared/dashboard.js';
import type { ObservabilitySnapshot, ResourceSample, ToolUsageRow } from '../../shared/observability.js';
import {
  MISSING,
  agentUsageRows,
  chartGeometry,
  chartGuidance,
  currentMultiplier,
  formatMultiplier,
  hasUsageData,
  tierBadge,
  usageKpis,
} from '../../web/src/usage.js';

function sample(over: Partial<ResourceSample> = {}): ResourceSample {
  return {
    sampledAt: 0,
    scope: 'server-only',
    cpuPercent: 10,
    memoryBytes: 512 * 1024 ** 2,
    peakMemoryBytes: 512 * 1024 ** 2,
    cpuTimeMs: 1_000,
    processCount: 1,
    gpu: null,
    ...over,
  };
}

function check(over: Partial<DashboardCheck> = {}): DashboardCheck {
  return {
    checkedAt: 0,
    status: 'ready',
    version: '1.0.0',
    account: { state: 'authenticated', label: 'test', source: 'cli', reason: null },
    quota: { remaining: null, unit: null, resetAt: null, source: 'cli', reason: null },
    credits: { remaining: null, unit: null, resetAt: null, source: 'cli', reason: null },
    probes: [],
    ...over,
  };
}

function tool(agent: DashboardTool['agent'], over: Partial<DashboardTool> = {}): DashboardTool {
  return { agent, title: agent, configuredBin: null, installed: true, lastCheck: null, suggestions: [], ...over };
}

function toolUsage(agent: ToolUsageRow['agent'], over: Partial<ToolUsageRow> = {}): ToolUsageRow {
  return {
    agent,
    runCount: 1,
    inputTokens: null,
    outputTokens: null,
    costUsd: null,
    credits: null,
    reportedCredits: null,
    coverage: { tokenRuns: 0, costRuns: 0, creditRuns: 0, totalRuns: 1 },
    models: [],
    ...over,
  };
}

function emptySnapshot(over: Partial<ObservabilitySnapshot> = {}): ObservabilitySnapshot {
  const resource = sample();
  return {
    sampledAt: 0,
    app: { version: '2.2.0', platform: 'win32', nodeVersion: '24', uptimeMs: 1_000, desktop: false },
    resource,
    history: [],
    system: { totalMemoryBytes: 1, usedMemoryBytes: 1, logicalCpuCount: 8 },
    usage: {
      planId: null,
      taskCount: 0,
      runCount: 0,
      completedRuns: 0,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      credits: null,
      reportedCredits: null,
      coverage: { tokenRuns: 0, costRuns: 0, creditRuns: 0, totalRuns: 0 },
      resources: { measuredRuns: 0, peakMemoryBytes: null, observedCpuTimeMs: null },
    },
    plans: [],
    runs: [],
    activeJobs: [],
    usageByTool: [],
    usageByModel: [],
    notes: [],
    ...over,
  };
}

describe('chartGeometry never invents a flat line', () => {
  test('an empty history is empty, not a zero line', () => {
    expect(chartGeometry([], 'cpu')).toEqual({ state: 'empty', points: '', samples: 0 });
    expect(chartGeometry([], 'memory')).toEqual({ state: 'empty', points: '', samples: 0 });
  });

  test('CPU samples without a measurement are skipped', () => {
    const history = [sample({ cpuPercent: null }), sample({ cpuPercent: null })];
    expect(chartGeometry(history, 'cpu').state).toBe('empty');
  });

  test('unmeasured memory (0 bytes) is skipped instead of drawing a line at the floor', () => {
    // Regression: the old chart mapped a 0-byte sample to y=46 and drew a flat line.
    const history = [sample({ memoryBytes: 0 }), sample({ memoryBytes: 0 })];
    expect(chartGeometry(history, 'memory')).toEqual({ state: 'empty', points: '', samples: 0 });
  });

  test('one usable sample is collecting, not a one-point line', () => {
    const geometry = chartGeometry([sample({ cpuPercent: 42 })], 'cpu');
    expect(geometry.state).toBe('collecting');
    expect(geometry.points).toBe('');
    expect(geometry.samples).toBe(1);
  });

  test('two or more samples produce points inside the view box', () => {
    const history = [sample({ cpuPercent: 4 }), sample({ cpuPercent: 62 }), sample({ cpuPercent: null }), sample({ cpuPercent: 97 })];
    const geometry = chartGeometry(history, 'cpu');
    expect(geometry.state).toBe('ready');
    expect(geometry.samples).toBe(3);
    const points = geometry.points.split(' ').map((pair) => pair.split(',').map(Number));
    expect(points).toHaveLength(3);
    for (const [x, y] of points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(260);
      expect(y).toBeGreaterThanOrEqual(6);
      expect(y).toBeLessThanOrEqual(46);
    }
    expect(points[0]![0]).toBe(0);
    expect(points.at(-1)![0]).toBe(260);
  });

  test('a real, measured flat series still draws because it carries data', () => {
    const geometry = chartGeometry([sample({ cpuPercent: 12 }), sample({ cpuPercent: 12 })], 'cpu');
    expect(geometry.state).toBe('ready');
    expect(geometry.points.split(' ')).toHaveLength(2);
  });

  test('only the last 60 samples are drawn', () => {
    const history = Array.from({ length: 120 }, (_, index) => sample({ cpuPercent: index % 100 }));
    expect(chartGeometry(history, 'cpu').samples).toBe(60);
  });

  test('guidance explains how to get data', () => {
    expect(chartGuidance('cpu', 'empty')).toMatch(/Chưa có mẫu CPU/);
    expect(chartGuidance('memory', 'empty')).toMatch(/Chưa có mẫu bộ nhớ/);
    expect(chartGuidance('memory', 'collecting')).toMatch(/1 mẫu bộ nhớ/);
    expect(chartGuidance('cpu', 'ready')).toBe('');
  });
});

describe('usageKpis keep null distinct from zero', () => {
  test('no snapshot yields null values and no 0/0 coverage', () => {
    const kpis = usageKpis(null);
    expect(kpis.map((kpi) => kpi.key)).toEqual(['tokens', 'cost', 'memory', 'cpuTime']);
    for (const kpi of kpis) expect(kpi.value).toBeNull();
    for (const kpi of kpis) expect(kpi.note).not.toContain('0/0');
  });

  test('a snapshot without any run keeps null values', () => {
    const kpis = usageKpis(emptySnapshot());
    for (const kpi of kpis) expect(kpi.value).toBeNull();
    expect(kpis[0]!.note).toBe('Chưa có lần chạy nào');
    expect(kpis[2]!.note).toBe('Chưa có mẫu tài nguyên');
  });

  test('measured values are formatted with their coverage note', () => {
    const snapshot = emptySnapshot({
      usage: {
        planId: null,
        taskCount: 2,
        runCount: 3,
        completedRuns: 3,
        inputTokens: 1_500,
        outputTokens: 250,
        costUsd: 0.0123,
        credits: 2,
        reportedCredits: 4,
        coverage: { tokenRuns: 2, costRuns: 1, creditRuns: 1, totalRuns: 3 },
        resources: { measuredRuns: 2, peakMemoryBytes: 512 * 1024 ** 2, observedCpuTimeMs: 65_000 },
      },
    });
    const [tokens, cost, memory, cpuTime] = usageKpis(snapshot);
    expect(tokens!.value).toBe('1.750');
    expect(tokens!.note).toBe('2/3 lần chạy có số liệu');
    expect(cost!.value).toBe('$0.0123');
    expect(cost!.note).toBe('1/3 lần chạy có chi phí');
    expect(memory!.value).toBe('512.0 MB');
    expect(memory!.note).toBe('2 lần chạy có mẫu tài nguyên');
    expect(cpuTime!.value).toBe('1m 05s');
  });

  test('a provider without cost data reports a reason instead of $0', () => {
    const snapshot = emptySnapshot({
      usage: {
        ...emptySnapshot().usage,
        runCount: 1,
        coverage: { tokenRuns: 1, costRuns: 0, creditRuns: 0, totalRuns: 1 },
      },
    });
    expect(usageKpis(snapshot)[1]!.value).toBeNull();
    expect(usageKpis(snapshot)[1]!.note).toBe('Nhà cung cấp chưa báo chi phí');
  });
});

describe('tierBadge', () => {
  test('no check or no plan means no badge', () => {
    expect(tierBadge(null)).toBeNull();
    expect(tierBadge(undefined)).toBeNull();
    expect(tierBadge(check())).toBeNull();
  });

  test.each([
    ['free', 'FREE'],
    ['trial', 'TRIAL'],
    ['plus', 'PLUS'],
    ['pro', 'PRO'],
    ['team', 'TEAM'],
    ['byok', 'BYOK'],
    ['unknown', 'CHƯA RÕ'],
  ] as const)('maps %s tier to the %s badge', (tier, label) => {
    const badge = tierBadge(check({ plan: { name: 'ChatGPT Plus', tier, source: 'cli' } }));
    expect(badge).toEqual({ label, tone: tier });
  });

  test('an unexpected tier from an old cache still renders a badge', () => {
    const weird = check({ plan: { name: 'Mystery', tier: 'enterprise' as never, source: 'cli' } });
    expect(tierBadge(weird)).toEqual({ label: 'CHƯA RÕ', tone: 'unknown' });
  });
});

describe('credit multiplier', () => {
  test.each([
    [0, 'Miễn phí'],
    [0.5, 'x0.5'],
    [1, 'x1'],
    [1.256, 'x1.26'],
    [null, null],
    [undefined, null],
  ] as const)('formats %s as %s', (value, expected) => {
    expect(formatMultiplier(value)).toBe(expected);
  });

  test('reads the multiplier of the current model only', () => {
    const current = check({
      currentModel: { id: 'qwen3.8-flash', label: 'Qwen3.8-Flash' },
      models: [
        { id: 'qwen3.8-flash', label: 'Qwen3.8-Flash', multiplier: 0, source: 'cli' },
        { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', multiplier: 2, source: 'cli' },
      ],
    });
    expect(currentMultiplier(current)?.text).toBe('Miễn phí');
  });

  test('a discounted offer keeps the old multiplier', () => {
    const current = check({
      currentModel: { id: 'deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1 Flash 1017' },
      models: [{ id: 'deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1 Flash 1017', multiplier: 0.5, originalMultiplier: 1, promo: 'Đang giảm', source: 'cli' }],
    });
    expect(currentMultiplier(current)).toEqual({ text: 'x0.5', original: 'x1', promo: 'Đang giảm' });
  });

  test('unknown current model or unknown multiplier stays empty', () => {
    expect(currentMultiplier(check({ currentModel: { id: 'other', label: 'Other' }, models: [] }))).toBeNull();
    expect(currentMultiplier(check({ currentModel: { id: 'x', label: 'X' }, models: [{ id: 'x', label: 'X', multiplier: null, source: 'catalog' }] }))).toBeNull();
    expect(currentMultiplier(null)).toBeNull();
  });
});

describe('agentUsageRows', () => {
  test('lists configured agents first, then usage-only agents', () => {
    const rows = agentUsageRows(
      [toolUsage('opencode', { runCount: 2 }), toolUsage('fake', { runCount: 1 })],
      [
        tool('codex', { lastCheck: check({ plan: { name: 'ChatGPT Plus', tier: 'plus', source: 'cli' } }) }),
        tool('opencode'),
        tool('agy'),
        tool('qodercli'),
      ],
    );
    expect(rows.map((row) => row.agent)).toEqual(['codex', 'opencode', 'agy', 'qodercli', 'fake']);
    expect(rows[0]).toMatchObject({ usage: null, tier: { label: 'PLUS', tone: 'plus' }, planName: 'ChatGPT Plus' });
    expect(rows[1]!.usage?.runCount).toBe(2);
    expect(rows[1]!.tier).toBeNull();
    expect(rows[4]!.check).toBeNull();
  });

  test('an unchecked agent keeps a null usage row so the table shows a placeholder', () => {
    const [row] = agentUsageRows([], [tool('codex')]);
    expect(row!.usage).toBeNull();
    expect(row!.multiplier).toBeNull();
  });
});

test('hasUsageData separates "no runs" from "runs without numbers"', () => {
  expect(hasUsageData(null)).toBe(false);
  expect(hasUsageData(emptySnapshot())).toBe(false);
  const withRun = emptySnapshot({
    usage: { ...emptySnapshot().usage, runCount: 1 },
  });
  expect(hasUsageData(withRun)).toBe(true);
});

test('the missing placeholder is the em dash, never a zero', () => {
  expect(MISSING).toBe('—');
});
