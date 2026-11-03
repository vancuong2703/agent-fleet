import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ProcessResourceSample, RunObservation } from '../../shared/observability.js';
import type { Run, StoredEvent, Task } from '../../shared/types.js';
import { Bus } from '../../server/bus.js';
import { Observability, attributeProcesses, parseNativeSample, summarizeUsage } from '../../server/observability.js';
import type { Store } from '../../server/store.js';

const directories: string[] = [];
const observers: Observability[] = [];
afterEach(() => {
  observers.splice(0).forEach((observer) => observer.close());
  vi.useRealTimers();
  for (const directory of directories.splice(0)) {
    const resolved = path.resolve(directory);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('fleet-observability-')) {
      throw new Error(`Unexpected cleanup target: ${resolved}`);
    }
    rmSync(resolved, { recursive: true, force: true });
  }
});

function temporary(): string {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fleet-observability-'));
  directories.push(directory);
  return directory;
}

function processSample(pid: number, parentPid: number, cpuTimeMs = 100): ProcessResourceSample {
  return { pid, parentPid, name: 'agent.exe', cpuTimeMs, cpuPercent: 2, memoryBytes: 1_000, startedAt: 1_000 };
}

function native(now = Date.now(), processes = [processSample(11, 1)]): Record<string, unknown> {
  return { sampledAt: now, scope: 'desktop-process-tree', cpuPercent: 2, memoryBytes: 5_000,
    peakMemoryBytes: 6_000, cpuTimeMs: 100, processCount: processes.length, gpu: null, processes };
}

function run(patch: Partial<Run> = {}): Run {
  return { id: 'r-one', taskId: 't-one', attempt: 1, agent: 'codex', brief: 'do it', note: null,
    status: 'running', pid: 11, exitCode: null, startedAt: Date.now() - 1_000, endedAt: null,
    durationMs: null, checkPassed: null, inputTokens: null, outputTokens: null, costUsd: null,
    finalMessage: null, errorCategory: null, sessionId: null, ...patch };
}

function task(): Task {
  return { id: 't-one', planId: 'p-one', title: 'Work', agent: 'codex', status: 'running', branch: 'main',
    worktreePath: 'C:\\worktree', checkCmd: null, createdAt: Date.now(), finishedAt: null };
}

function setup(runs = [run()], events: StoredEvent[] = [], directory = temporary()) {
  const bus = new Bus();
  const store = {
    listTasks: () => [task()], listRuns: () => runs,
    listPlans: () => [{ id: 'p-one' }], readEvents: (id: string) => events.filter((event) => event.runId === id),
  } as unknown as Store;
  const observer = new Observability(store, bus, directory);
  observers.push(observer);
  return { observer, bus, directory, runs };
}

describe('native resource validation', () => {
  test('accepts a fresh native sample and preserves optional process birth time', () => {
    expect(parseNativeSample(native(10_000), 10_001)?.processes[0]?.startedAt).toBe(1_000);
  });
  test('preserves native desktop and whole-system GPU scopes and accepts legacy GPU samples', () => {
    const gpu = { name: 'NVIDIA GPU', utilizationPercent: 34, memoryBytes: 1_024 };
    expect(parseNativeSample({ ...native(10_000), gpu: { ...gpu, scope: 'system' } }, 10_001)?.gpu)
      .toEqual({ ...gpu, scope: 'system' });
    expect(parseNativeSample({ ...native(10_000), gpu: { ...gpu, scope: 'desktop-process-tree' } }, 10_001)?.gpu)
      .toEqual({ ...gpu, scope: 'desktop-process-tree' });
    expect(parseNativeSample({ ...native(10_000), gpu }, 10_001)?.gpu).toEqual(gpu);
    expect(parseNativeSample({ ...native(10_000), gpu: { ...gpu, scope: 'app' } }, 10_001)).toBeNull();
  });
  test.each([
    { sampledAt: 1 }, { sampledAt: 40_000 }, { cpuPercent: 101 }, { memoryBytes: -1 },
    { cpuTimeMs: Number.NaN }, { processes: [processSample(11, 1), processSample(11, 1)] },
    { processes: [{ ...processSample(11, 1), parentPid: '1' }] },
    { gpu: { name: 'GPU', utilizationPercent: 110, memoryBytes: 0 } },
  ])('rejects stale, invalid or duplicated telemetry: %j', (patch) => {
    expect(parseNativeSample({ ...native(20_000), ...patch }, 20_001)).toBeNull();
  });
});

test('attributes descendants to the nearest run and tolerates parent cycles', () => {
  const grouped = attributeProcesses([
    processSample(11, 1), processSample(12, 11), processSample(13, 12),
    processSample(14, 13), processSample(15, 99), processSample(90, 91), processSample(91, 90),
  ], [{ id: 'outer', pid: 11 }, { id: 'inner', pid: 13 }]);
  expect(grouped.get('outer')?.map((entry) => entry.pid)).toEqual([11, 12]);
  expect(grouped.get('inner')?.map((entry) => entry.pid)).toEqual([13, 14]);
  expect([...grouped.values()].flat()).toHaveLength(4);
});

test('usage totals preserve unknown values, zero charges, and coverage', () => {
  const observation = (patch: Partial<RunObservation>): RunObservation => ({
    taskId: 't-one', runId: 'r-one', agent: 'codex', status: 'done', model: null, modelSource: 'unknown',
    models: [], currentActivity: '', lastEventAt: null, silentForMs: null, inputTokens: null, outputTokens: null,
    costUsd: null, credits: null, reportedCredits: null, usageByModel: [], resources: null, ...patch,
  });
  const summary = summarizeUsage('p-one', [task()], [observation({ inputTokens: 12, outputTokens: 4, costUsd: 0 }),
    observation({ runId: 'r-two', credits: 2.5 }), observation({ runId: 'r-three' })]);
  expect(summary.inputTokens).toBe(12);
  expect(summary.costUsd).toBe(0);
  expect(summary.credits).toBe(2.5);
  expect(summary.coverage).toEqual({ tokenRuns: 1, costRuns: 1, creditRuns: 1, totalRuns: 3 });
  expect(summary.resources.peakMemoryBytes).toBeNull();
  expect(summarizeUsage(null, [], []).inputTokens).toBeNull();
});

test('falls back to server-only metrics for missing/stale desktop data and exposes system RAM separately', () => {
  const { observer, directory } = setup();
  writeFileSync(path.join(directory, 'resources.json'), JSON.stringify(native(Date.now() - 30_000)));
  const snapshot = observer.snapshot();
  expect(snapshot.resource.scope).toBe('server-only');
  expect(snapshot.resource.memoryBytes).toBeGreaterThan(0);
  expect(snapshot.resource.processCount).toBe(1);
  expect(snapshot.system.totalMemoryBytes).toBeGreaterThan(0);
  expect(snapshot.app.desktop).toBe(false);
  expect(snapshot.usage.inputTokens).toBeNull();
  expect(snapshot.usage.credits).toBeNull();
});

test('uses persisted run totals without double-counting historical usage; aggregates live credits and model', () => {
  const initialEvents: StoredEvent[] = [
    { runId: 'r-one', seq: 1, ts: Date.now(), event: { kind: 'usage', inputTokens: 100, outputTokens: 10, costUsd: 0.2 } },
  ];
  const { observer, bus } = setup([run({ inputTokens: 100, outputTokens: 10, costUsd: 0.2 })], initialEvents);
  observer.start();
  const model = { runId: 'r-one', seq: 2, ts: Date.now(), event: { kind: 'model', model: 'small-model', source: 'reported' } } as unknown as StoredEvent;
  const credit = { runId: 'r-one', seq: 3, ts: Date.now(), event: { kind: 'usage', credits: 1.5 } } as unknown as StoredEvent;
  bus.emit({ type: 'event', taskId: 't-one', stored: model });
  bus.emit({ type: 'event', taskId: 't-one', stored: credit });
  bus.emit({ type: 'event', taskId: 't-one', stored: credit });
  bus.emit({ type: 'event', taskId: 't-one', stored: { runId: 'r-one', seq: 4, ts: Date.now(), event: { kind: 'command', cmd: 'npm test' } } });
  const snapshot = observer.snapshot();
  expect(snapshot.usage.inputTokens).toBe(100);
  expect(snapshot.usage.costUsd).toBe(0.2);
  expect(snapshot.usage.credits).toBe(1.5);
  expect(snapshot.activeJobs[0]).toMatchObject({ model: 'small-model', modelSource: 'reported', currentActivity: 'Chạy: npm test' });
});

test('samples native process trees once per timestamp and persists per-run CPU without double-counting on restart', () => {
  vi.useFakeTimers();
  const { observer, directory } = setup();
  writeFileSync(path.join(directory, 'resources.json'), JSON.stringify(native(Date.now(), [processSample(11, 1, 100), processSample(12, 11, 20)])));
  observer.start();
  expect(observer.snapshot().runs[0]?.resources).toMatchObject({ samples: 1, observedCpuTimeMs: 120, peakMemoryBytes: 2_000 });
  vi.advanceTimersByTime(5_000);
  // The unchanged native timestamp is deduplicated even when polled again.
  expect(observer.snapshot().runs[0]?.resources?.samples).toBe(1);
  writeFileSync(path.join(directory, 'resources.json'), JSON.stringify(native(Date.now(), [processSample(11, 1, 150), processSample(12, 11, 30)])));
  vi.advanceTimersByTime(5_000);
  expect(observer.snapshot().runs[0]?.resources).toMatchObject({ samples: 2, observedCpuTimeMs: 180 });
  observer.close();
  const saved = JSON.parse(readFileSync(path.join(directory, 'observability.json'), 'utf8'));
  expect(saved.runs[0].observedCpuTimeMs).toBe(180);
  const restarted = setup([run()], [], directory).observer;
  writeFileSync(path.join(directory, 'resources.json'), JSON.stringify(native(Date.now(), [processSample(11, 1, 170), processSample(12, 11, 40)])));
  expect(restarted.snapshot().runs[0]?.resources?.observedCpuTimeMs).toBe(210);
});

test('bounds history and stops the sampler on close', () => {
  vi.useFakeTimers();
  const { observer } = setup();
  observer.start();
  vi.advanceTimersByTime(700_000);
  expect(observer.snapshot().history.length).toBeLessThanOrEqual(120);
  observer.close();
  expect(vi.getTimerCount()).toBe(0);
});

test('reads configured models without guessing provider defaults', () => {
  const { observer, directory } = setup();
  writeFileSync(path.join(directory, 'fleet.config.json'), JSON.stringify({ agents: { codex: { extraArgs: ['--model=small-model'] } } }));
  expect(observer.snapshot().runs[0]).toMatchObject({ model: 'small-model', modelSource: 'configured' });
});

test('does not assign the current configured model to a finished run', () => {
  const { observer, directory } = setup([run({ status: 'done' })]);
  writeFileSync(path.join(directory, 'fleet.config.json'), JSON.stringify({ agents: { codex: { extraArgs: ['--model=small-model'] } } }));
  expect(observer.snapshot().runs[0]).toMatchObject({ model: null, modelSource: 'unknown', models: [] });
});

test('reports every model, the unattributed residual and nominal reportedCredits', () => {
  const events: StoredEvent[] = [
    { runId: 'r-one', seq: 1, ts: 1, event: { kind: 'model', model: 'Qwen3.8-Flash', source: 'reported' } },
    { runId: 'r-one', seq: 2, ts: 2, event: { kind: 'model', model: 'qfmodel', source: 'reported' } },
    { runId: 'r-one', seq: 3, ts: 3, event: { kind: 'usage', model: 'qfmodel', credits: 0, reportedCredits: 2, billable: false, usageId: 'm1' } },
    { runId: 'r-one', seq: 4, ts: 4, event: { kind: 'usage', credits: 0, usageScope: 'cumulative', usageId: 'result' } },
  ];
  const { observer } = setup([run({ agent: 'qodercli' })], events);
  const snapshot = observer.snapshot();
  const run0 = snapshot.runs[0]!;
  expect(run0.model).toBe('Qwen3.8-Flash');
  expect(run0.models.map((model) => model.name).sort()).toEqual(['Qwen3.8-Flash', 'qfmodel']);
  expect(run0.credits).toBe(0);
  expect(run0.reportedCredits).toBe(2);
  expect(snapshot.usage.reportedCredits).toBe(2);
  expect(snapshot.usage.credits).toBe(0);
  expect(snapshot.usageByModel.find((row) => row.model === 'qfmodel')).toMatchObject({ credits: 0, reportedCredits: 2 });
  expect(snapshot.usageByTool).toHaveLength(1);
});

test('cumulative totals and attributionOnly never inflate a run; conflicting attribution moves to residual', () => {
  const events: StoredEvent[] = [
    { runId: 'r-one', seq: 1, ts: 1, event: { kind: 'usage', model: 'alpha', inputTokens: 10, usageId: 'd1' } },
    { runId: 'r-one', seq: 2, ts: 2, event: { kind: 'usage', model: 'alpha', inputTokens: 10, usageId: 'd1' } },
    { runId: 'r-one', seq: 3, ts: 3, event: { kind: 'usage', model: 'beta', inputTokens: 300, attributionOnly: true } },
    { runId: 'r-one', seq: 4, ts: 4, event: { kind: 'usage', inputTokens: 24, usageScope: 'cumulative', usageId: 'final' } },
  ];
  const { observer } = setup([run()], events);
  const run0 = observer.snapshot().runs[0]!;
  expect(run0.inputTokens).toBe(24);
  const attributed = run0.usageByModel.filter((row) => row.model !== null);
  expect(attributed.every((row) => row.inputTokens === null)).toBe(true);
  expect(run0.usageByModel.find((row) => row.model === null)).toMatchObject({ inputTokens: 24 });
});

test('seeds missing model metadata from historical raw JSON exactly once', () => {
  const init = JSON.stringify({ type: 'system', subtype: 'init', model: 'Qwen3.8-Flash', session_id: 's1' });
  const assistant = JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'qfmodel', usage: { credits: 0.25, billable: true }, content: [] } });
  const events: StoredEvent[] = [
    { runId: 'r-one', seq: 1, ts: 1, event: { kind: 'raw', stream: 'stdout', text: init } },
    { runId: 'r-one', seq: 2, ts: 2, event: { kind: 'raw', stream: 'stdout', text: assistant } },
  ];
  const { observer } = setup([run({ agent: 'qodercli' })], events);
  const run0 = observer.snapshot().runs[0]!;
  expect(run0.model).toBe('Qwen3.8-Flash');
  expect(run0.models.map((model) => model.name).sort()).toEqual(['Qwen3.8-Flash', 'qfmodel']);
  expect(run0.credits).toBe(0.25);
});

test('normalized events win over historical raw JSON without double counting', () => {
  const assistant = JSON.stringify({ type: 'assistant', message: { id: 'raw', model: 'rawmodel', usage: { credits: 9, billable: true }, content: [] } });
  const events: StoredEvent[] = [
    { runId: 'r-one', seq: 1, ts: 1, event: { kind: 'model', model: 'normalized', source: 'reported' } },
    { runId: 'r-one', seq: 2, ts: 2, event: { kind: 'usage', credits: 1, usageId: 'n1' } },
    { runId: 'r-one', seq: 3, ts: 3, event: { kind: 'raw', stream: 'stdout', text: assistant } },
  ];
  const { observer } = setup([run({ agent: 'qodercli' })], events);
  const run0 = observer.snapshot().runs[0]!;
  expect(run0.credits).toBe(1);
  expect(run0.models.map((model) => model.name)).toEqual(['normalized']);
});

