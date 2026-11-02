import { describe, expect, test } from 'vitest';

import type { Plan } from '../../shared/types.js';
import type { AgentInfo, AgentStats } from '../../web/src/api.js';
import {
  buildCompareRows,
  formatCostUsd,
  formatDurationMs,
  formatRate,
  repoOptions,
} from '../../web/src/compare.js';

function makePlan(id: string, repoPath: string): Plan {
  return {
    id,
    name: `Plan ${id}`,
    slug: id,
    repoPath,
    baseBranch: 'main',
    createdAt: 0,
  };
}

function makeAgent(id: AgentInfo['id'], over: Partial<AgentInfo> = {}): AgentInfo {
  return { id, ok: true, maxParallel: 2, ...over };
}

function makeStats(agent: AgentStats['agent'], over: Partial<AgentStats> = {}): AgentStats {
  return {
    agent,
    runs: 0,
    successRate: null,
    avgDurationMs: null,
    retryRate: null,
    mergeRate: null,
    costUsd: null,
    ...over,
  };
}

describe('formatRate', () => {
  test('rounds a 0..1 rate to a whole percent', () => {
    expect(formatRate(0.83)).toBe('83%');
    expect(formatRate(0.835)).toBe('84%');
    expect(formatRate(0.5)).toBe('50%');
    expect(formatRate(1)).toBe('100%');
    expect(formatRate(0)).toBe('0%');
  });

  test('shows a dash when the rate is null', () => {
    expect(formatRate(null)).toBe('—');
  });
});

describe('formatDurationMs', () => {
  test('formats seconds, minutes and hours without spaces', () => {
    expect(formatDurationMs(0)).toBe('0s');
    expect(formatDurationMs(45_000)).toBe('45s');
    expect(formatDurationMs(59_999)).toBe('59s');
    expect(formatDurationMs(60_000)).toBe('1m00s');
    expect(formatDurationMs(252_000)).toBe('4m12s');
    expect(formatDurationMs(3_600_000)).toBe('1h00m');
    expect(formatDurationMs(3_780_000)).toBe('1h03m');
  });

  test('never shows a negative duration and dashes null', () => {
    expect(formatDurationMs(-1)).toBe('0s');
    expect(formatDurationMs(null)).toBe('—');
  });
});

describe('formatCostUsd', () => {
  test('formats a cost with two decimals', () => {
    expect(formatCostUsd(0.05)).toBe('$0.05');
    expect(formatCostUsd(1.5)).toBe('$1.50');
    expect(formatCostUsd(0)).toBe('$0.00');
  });

  test('shows a dash when the cost is null', () => {
    expect(formatCostUsd(null)).toBe('—');
  });
});

describe('buildCompareRows', () => {
  test('makes one row per agent from the agents list', () => {
    const rows = buildCompareRows(
      [makeAgent('codex'), makeAgent('agy'), makeAgent('opencode')],
      [makeStats('codex'), makeStats('agy')],
    );

    expect(rows.map((row) => row.agent)).toEqual(['codex', 'agy', 'opencode']);
  });

  test('attaches stats by agent id and leaves unstatted agents null', () => {
    const codex = makeStats('codex', { runs: 4, successRate: 0.75 });
    const rows = buildCompareRows([makeAgent('codex'), makeAgent('qodercli')], [codex]);

    expect(rows[0]?.stats).toBe(codex);
    expect(rows[1]?.stats).toBeNull();
  });

  test('keeps the ok flag and reason of an unavailable agent', () => {
    const rows = buildCompareRows(
      [makeAgent('opencode', { ok: false, reason: 'chưa cài' })],
      [],
    );

    expect(rows[0]).toMatchObject({ agent: 'opencode', ok: false, reason: 'chưa cài' });
  });

  test('ignores stats for agents the server does not list', () => {
    const rows = buildCompareRows([makeAgent('codex')], [makeStats('fake', { runs: 9 })]);

    expect(rows).toHaveLength(1);
    expect(rows[0]?.stats).toBeNull();
  });
});

describe('repoOptions', () => {
  test('lists each repo path once, sorted', () => {
    const plans = [
      makePlan('p-1', 'C:\\work\\b'),
      makePlan('p-2', 'C:\\work\\a'),
      makePlan('p-3', 'C:\\work\\b'),
    ];

    expect(repoOptions(plans)).toEqual(['C:\\work\\a', 'C:\\work\\b']);
  });

  test('returns an empty list without plans', () => {
    expect(repoOptions([])).toEqual([]);
  });
});
