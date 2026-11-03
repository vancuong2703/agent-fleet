import { describe, expect, test } from 'vitest';
import type { ModelIdentity, ModelUsageRow, RunObservation } from '../../shared/observability.js';
import { ModelUsageLedger, isGenericModel, usageByModel, usageByTool } from '../../server/model-usage.js';

function row(patch: Partial<ModelUsageRow> = {}): ModelUsageRow {
  return {
    agent: 'codex', model: 'alpha', provider: null, attribution: 'reported', runCount: 1,
    inputTokens: null, outputTokens: null, costUsd: null, credits: null, reportedCredits: null,
    coverage: { tokenRuns: 0, costRuns: 0, creditRuns: 0, totalRuns: 1 }, ...patch,
  };
}

function observation(patch: Partial<RunObservation> = {}): RunObservation {
  return {
    taskId: 't-one', runId: 'r-one', agent: 'codex', status: 'done', model: null, modelSource: 'unknown',
    models: [], currentActivity: '', lastEventAt: null, silentForMs: null, inputTokens: null,
    outputTokens: null, costUsd: null, credits: null, reportedCredits: null, usageByModel: [], resources: null, ...patch,
  };
}

const identity = (name: string, provider: string | null = null): ModelIdentity =>
  ({ name, provider, source: 'reported', generic: isGenericModel(name) });

function attributed(rows: ModelUsageRow[], metric: keyof ModelUsageRow): number {
  return rows.reduce((total, entry) => total + ((entry[metric] as number | null) ?? 0), 0);
}

describe('ModelUsageLedger totals and attribution', () => {
  test('model rows plus the unattributed residual equal the totals', () => {
    const ledger = new ModelUsageLedger();
    ledger.addUsage({ kind: 'usage', model: 'alpha', inputTokens: 10 });
    ledger.addUsage({ kind: 'usage', model: 'beta', inputTokens: 5 });
    ledger.addUsage({ kind: 'usage', inputTokens: 7 });
    const totals = ledger.totals();
    expect(totals.inputTokens).toBe(22);
    const rows = ledger.rows('codex', totals);
    expect(rows.find((entry) => entry.model === 'alpha')?.inputTokens).toBe(10);
    expect(rows.find((entry) => entry.model === 'beta')?.inputTokens).toBe(5);
    expect(rows.find((entry) => entry.model === null)?.inputTokens).toBe(7);
    expect(attributed(rows, 'inputTokens')).toBe(22);
  });

  test('a persisted total is never copied onto every model row', () => {
    const ledger = new ModelUsageLedger();
    ledger.addUsage({ kind: 'usage', model: 'alpha', inputTokens: 10 });
    const rows = ledger.rows('codex', ledger.totals({ inputTokens: 100 }));
    expect(rows.find((entry) => entry.model === 'alpha')?.inputTokens).toBe(10);
    expect(rows.find((entry) => entry.model === null)?.inputTokens).toBe(90);
    expect(attributed(rows, 'inputTokens')).toBe(100);
  });

  test('attribution that exceeds the total moves everything to residual without rescaling', () => {
    const ledger = new ModelUsageLedger();
    ledger.addUsage({ kind: 'usage', model: 'alpha', inputTokens: 60 });
    ledger.addUsage({ kind: 'usage', model: 'beta', inputTokens: 60 });
    const rows = ledger.rows('codex', ledger.totals({ inputTokens: 100 }));
    expect(rows.filter((entry) => entry.model !== null).every((entry) => entry.inputTokens === null)).toBe(true);
    expect(rows.find((entry) => entry.model === null)?.inputTokens).toBe(100);
    expect(attributed(rows, 'inputTokens')).toBe(100);
  });

  test('attributionOnly events assign a model but never change totals', () => {
    const ledger = new ModelUsageLedger();
    ledger.addUsage({ kind: 'usage', model: 'alpha', inputTokens: 50, attributionOnly: true });
    expect(ledger.totals().inputTokens).toBeNull();
    ledger.addUsage({ kind: 'usage', inputTokens: 60 });
    const totals = ledger.totals();
    expect(totals.inputTokens).toBe(60);
    const rows = ledger.rows('codex', totals);
    expect(rows.find((entry) => entry.model === 'alpha')?.inputTokens).toBe(50);
    expect(rows.find((entry) => entry.model === null)?.inputTokens).toBe(10);
  });

  test('identical usageId deltas are counted once while cumulative totals overwrite', () => {
    const deduped = new ModelUsageLedger();
    deduped.addUsage({ kind: 'usage', model: 'alpha', inputTokens: 10, usageId: 'u-one' });
    deduped.addUsage({ kind: 'usage', model: 'alpha', inputTokens: 10, usageId: 'u-one' });
    expect(deduped.totals().inputTokens).toBe(10);

    const cumulative = new ModelUsageLedger();
    cumulative.addUsage({ kind: 'usage', inputTokens: 10 });
    cumulative.addUsage({ kind: 'usage', inputTokens: 4, usageScope: 'cumulative' });
    expect(cumulative.totals().inputTokens).toBe(4);
  });

  test('zero is a real charge while a missing value stays unknown', () => {
    const ledger = new ModelUsageLedger();
    ledger.addUsage({ kind: 'usage', model: 'alpha', costUsd: 0 });
    expect(ledger.totals().costUsd).toBe(0);
    expect(ledger.totals().credits).toBeNull();
  });

  test('reportedCredits stays separate from charged credits', () => {
    const ledger = new ModelUsageLedger();
    ledger.addUsage({ kind: 'usage', model: 'alpha', credits: 0, reportedCredits: 2.5, billable: false, usageId: 'm1' });
    const totals = ledger.totals();
    expect(totals.credits).toBe(0);
    expect(totals.reportedCredits).toBe(2.5);
  });

  test('a cumulative charged total overrides credits without erasing nominal reportedCredits', () => {
    const ledger = new ModelUsageLedger();
    ledger.addUsage({ kind: 'usage', model: 'alpha', credits: 5, reportedCredits: 5, usageId: 'm1' });
    ledger.addUsage({ kind: 'usage', model: 'alpha', credits: 3, usageScope: 'cumulative', usageId: 'result' });
    const totals = ledger.totals();
    expect(totals.credits).toBe(3);
    expect(totals.reportedCredits).toBe(5);
  });

  test('a non-billable request keeps its nominal credit but charges nothing', () => {
    const ledger = new ModelUsageLedger();
    ledger.addUsage({ kind: 'usage', model: 'alpha', credits: 0.17, reportedCredits: 0.17, billable: false });
    expect(ledger.totals().credits).toBe(0);
    expect(ledger.totals().reportedCredits).toBe(0.17);
  });
});

describe('model identity', () => {
  test('a generic runtime model is kept but never chosen as the primary identity', () => {
    const ledger = new ModelUsageLedger();
    ledger.addModel('qfmodel', 'reported');
    ledger.addModel('Qwen3.8-Flash', 'reported');
    expect(isGenericModel('QFmodel')).toBe(true);
    expect(ledger.models().find((model) => model.name === 'qfmodel')?.generic).toBe(true);
    expect(ledger.primary()?.name).toBe('Qwen3.8-Flash');
  });

  test('a reported model wins over a configured one and both are retained', () => {
    const ledger = new ModelUsageLedger();
    ledger.addModel('same', 'configured');
    ledger.addModel('same', 'reported');
    ledger.addModel('extra', 'configured');
    ledger.addModel('same', 'configured');
    const models = ledger.models();
    expect(models).toHaveLength(2);
    expect(models.find((model) => model.name === 'same')?.source).toBe('reported');
    expect(models.find((model) => model.name === 'extra')?.source).toBe('configured');
  });
});

describe('tool and model aggregation', () => {
  test('usageByTool groups models and metrics per agent', () => {
    const first = observation({ runId: 'r1', inputTokens: 10, models: [identity('alpha')], usageByModel: [row({ model: 'alpha', inputTokens: 10 })] });
    const second = observation({ runId: 'r2', inputTokens: 5, models: [identity('beta')], usageByModel: [row({ model: 'beta', inputTokens: 5 })] });
    const tools = usageByTool([first, second]);
    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({ agent: 'codex', runCount: 2, inputTokens: 15 });
    expect(tools[0]!.models.map((model) => model.name).sort()).toEqual(['alpha', 'beta']);
  });

  test('usageByModel merges the same model across runs and keeps the unattributed bucket', () => {
    const runs = [
      observation({ runId: 'r1', usageByModel: [row({ model: 'alpha', inputTokens: 4 }), row({ model: null, provider: null, attribution: 'unattributed', inputTokens: 6 })] }),
      observation({ runId: 'r2', usageByModel: [row({ model: 'alpha', inputTokens: 1 }), row({ model: null, provider: null, attribution: 'unattributed', inputTokens: 9 })] }),
    ];
    const rows = usageByModel(runs);
    expect(rows.find((entry) => entry.model === 'alpha')).toMatchObject({ runCount: 2, inputTokens: 5 });
    expect(rows.find((entry) => entry.model === null)).toMatchObject({ runCount: 2, inputTokens: 15 });
  });
});
