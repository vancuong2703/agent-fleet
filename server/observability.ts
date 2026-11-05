import { existsSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, freemem, totalmem } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelIdentity, ObservabilitySnapshot, ProcessResourceSample, ResourceSample, RunObservation, RunResourceSummary, UsageSummary } from '../shared/observability.js';
import type { FleetEvent, Run, StoredEvent, Task } from '../shared/types.js';
import { getAdapter } from './adapters/index.js';
import { configuredModel, withMetadata } from './adapters/metadata.js';
import type { Bus } from './bus.js';
import { ModelUsageLedger, isGenericModel, usageByModel as collectUsageByModel, usageByTool as collectUsageByTool } from './model-usage.js';
import { dataDir } from './paths.js';
import type { Store } from './store.js';

const SAMPLE_INTERVAL_MS = 5_000;
const HISTORY_LIMIT = 120;
const SUMMARY_LIMIT = 5_000;
const MAX_TELEMETRY_BYTES = 2_000_000;

export interface NativeResourceSample extends ResourceSample {
  scope: 'desktop-process-tree';
  processes: ProcessResourceSample[];
}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const percent = (value: unknown): value is number | null => value === null || (nonnegative(value) && value <= 100);
const integer = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value);

/** Treat native telemetry as untrusted local input and reject stale/torn samples. */
export function parseNativeSample(value: unknown, now: number): NativeResourceSample | null {
  const source = record(value);
  if (!source || source.scope !== 'desktop-process-tree' || !nonnegative(source.sampledAt)
    || source.sampledAt < now - 15_000 || source.sampledAt > now + 5_000
    || !percent(source.cpuPercent) || !nonnegative(source.memoryBytes) || !nonnegative(source.peakMemoryBytes)
    || !nonnegative(source.cpuTimeMs) || !integer(source.processCount) || source.processCount > 10_000
    || !Array.isArray(source.processes) || source.processes.length > 10_000) return null;

  const processes: ProcessResourceSample[] = [];
  const pids = new Set<number>();
  for (const value of source.processes) {
    const entry = record(value);
    if (!entry || !integer(entry.pid) || entry.pid === 0 || pids.has(entry.pid) || !integer(entry.parentPid)
      || typeof entry.name !== 'string' || entry.name.length > 256
      || !nonnegative(entry.cpuTimeMs) || !percent(entry.cpuPercent) || !nonnegative(entry.memoryBytes)
      || (entry.startedAt !== undefined && !nonnegative(entry.startedAt))) return null;
    pids.add(entry.pid);
    processes.push({ pid: entry.pid, parentPid: entry.parentPid, name: entry.name, cpuTimeMs: entry.cpuTimeMs,
      cpuPercent: entry.cpuPercent, memoryBytes: entry.memoryBytes,
      ...(entry.startedAt === undefined ? {} : { startedAt: entry.startedAt as number }) });
  }
  let gpu: ResourceSample['gpu'] = null;
  if (source.gpu !== null && source.gpu !== undefined) {
    const rawGpu = record(source.gpu);
    if (!rawGpu || typeof rawGpu.name !== 'string' || rawGpu.name.length > 256 || !percent(rawGpu.utilizationPercent)
      || (rawGpu.memoryBytes !== null && !nonnegative(rawGpu.memoryBytes))
      || (rawGpu.scope !== undefined && rawGpu.scope !== 'system' && rawGpu.scope !== 'desktop-process-tree')) return null;
    gpu = { name: rawGpu.name, utilizationPercent: rawGpu.utilizationPercent, memoryBytes: rawGpu.memoryBytes as number | null,
      ...(rawGpu.scope === undefined ? {} : { scope: rawGpu.scope as 'desktop-process-tree' | 'system' }) };
  }
  return { sampledAt: source.sampledAt, scope: 'desktop-process-tree', cpuPercent: source.cpuPercent,
    memoryBytes: source.memoryBytes, peakMemoryBytes: source.peakMemoryBytes, cpuTimeMs: source.cpuTimeMs,
    processCount: source.processCount, gpu, processes };
}

/** A child belongs to the closest measured run ancestor, never two runs. */
export function attributeProcesses(processes: ProcessResourceSample[], runs: Pick<Run, 'id' | 'pid'>[]): Map<string, ProcessResourceSample[]> {
  const parents = new Map(processes.map((entry) => [entry.pid, entry.parentPid]));
  const owners = new Map(runs.filter((run) => run.pid !== null).map((run) => [run.pid!, run.id]));
  const groups = new Map<string, ProcessResourceSample[]>();
  for (const process of processes) {
    let pid: number | undefined = process.pid;
    const visited = new Set<number>();
    while (pid !== undefined && pid > 0 && !visited.has(pid)) {
      visited.add(pid);
      const owner = owners.get(pid);
      if (owner !== undefined) {
        const entries = groups.get(owner) ?? [];
        entries.push(process);
        groups.set(owner, entries);
        break;
      }
      pid = parents.get(pid);
    }
  }
  return groups;
}

interface RunInfo {
  lastSeq: number;
  activity: string;
  lastEventAt: number | null;
  ledger: ModelUsageLedger;
  /** Historical raw JSON is parsed at most once per run to seed missing metadata. */
  rawSeeded: boolean;
}

function emptyInfo(): RunInfo {
  return { lastSeq: 0, activity: 'Chờ agent', lastEventAt: null, ledger: new ModelUsageLedger(), rawSeeded: false };
}

function trackModel(info: RunInfo, event: Extract<FleetEvent, { kind: 'model' }>): void {
  info.ledger.addModel(event.model, event.source === 'configured' ? 'configured' : 'reported', event.provider ?? null);
}

function applyEvent(info: RunInfo, stored: StoredEvent): void {
  if (stored.seq <= info.lastSeq) return;
  info.lastSeq = stored.seq;
  const event = stored.event;
  info.lastEventAt = stored.ts;
  if (event.kind === 'model') trackModel(info, event);
  else if (event.kind === 'usage') info.ledger.addUsage(event);
  switch (event.kind) {
    case 'message': info.activity = String(event.text ?? '').slice(0, 300); break;
    case 'command': info.activity = `${event.exitCode === undefined ? 'Chạy' : 'Đã chạy'}: ${String(event.cmd ?? '')}`.slice(0, 300); break;
    case 'file_edit': info.activity = `Sửa tệp: ${String(event.path ?? '')}`.slice(0, 300); break;
    case 'tool': info.activity = `${String(event.name ?? '')} ${String(event.detail ?? '')}`.trim().slice(0, 300); break;
    case 'check': info.activity = `Kiểm tra ${event.passed ? 'PASS' : 'FAIL'}: ${String(event.cmd ?? '')}`.slice(0, 300); break;
    case 'error': info.activity = String(event.text ?? '').slice(0, 300); break;
  }
}

const sumKnown = (values: (number | null)[]): number | null => {
  const known = values.filter((value): value is number => value !== null);
  return known.length > 0 ? known.reduce((sum, value) => sum + value, 0) : null;
};

export function summarizeUsage(planId: string | null, tasks: Task[], observations: RunObservation[]): UsageSummary {
  const measured = observations.flatMap((run) => run.resources ? [run.resources] : []);
  return {
    planId, taskCount: tasks.length, runCount: observations.length,
    completedRuns: observations.filter((run) => !['queued', 'running', 'taken_over'].includes(run.status)).length,
    inputTokens: sumKnown(observations.map((run) => run.inputTokens)),
    outputTokens: sumKnown(observations.map((run) => run.outputTokens)),
    costUsd: sumKnown(observations.map((run) => run.costUsd)), credits: sumKnown(observations.map((run) => run.credits)),
    reportedCredits: sumKnown(observations.map((run) => run.reportedCredits)),
    coverage: {
      tokenRuns: observations.filter((run) => run.inputTokens !== null || run.outputTokens !== null).length,
      costRuns: observations.filter((run) => run.costUsd !== null).length,
      creditRuns: observations.filter((run) => run.credits !== null).length, totalRuns: observations.length,
    },
    resources: {
      measuredRuns: measured.length,
      peakMemoryBytes: measured.length ? Math.max(...measured.map((run) => run.peakMemoryBytes)) : null,
      observedCpuTimeMs: sumKnown(measured.map((run) => run.observedCpuTimeMs)),
    },
  };
}

interface PersistedRun extends RunResourceSummary { processCpu: Record<string, number> }
interface Persistence { version: 1; history: ResourceSample[]; runs: PersistedRun[] }

/** One sampler per server, with bounded history and incremental event aggregation. */
export class Observability {
  private readonly directory: string;
  private readonly summaries = new Map<string, PersistedRun>();
  private readonly info = new Map<string, RunInfo>();
  private history: ResourceSample[] = [];
  private latest: ResourceSample | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private off: (() => void) | undefined;
  private lastPersistAt = 0;
  private previousCpu = process.cpuUsage();
  private previousCpuAt = Date.now();
  private peakServerMemory = 0;
  private configuredModels = new Map<string, string>();
  private readonly version: string;

  constructor(private readonly store: Store, private readonly bus: Bus, directory?: string) {
    this.directory = directory ?? dataDir();
    try { this.version = String(JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version); }
    catch { this.version = '2.6.1'; }
    this.restore();
  }

  start(): void {
    if (this.timer) return;
    this.off = this.bus.on((message) => {
      if (message.type !== 'event') return;
      const info = this.ensureInfo(message.stored.runId);
      applyEvent(info, message.stored);
    });
    this.sample();
    this.timer = setInterval(() => this.sample(), SAMPLE_INTERVAL_MS);
    this.timer.unref();
  }

  close(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.off?.();
    this.off = undefined;
    this.persist();
  }

  snapshot(planId?: string): ObservabilitySnapshot {
    const now = Date.now();
    if (!this.latest || now - this.latest.sampledAt >= SAMPLE_INTERVAL_MS) this.sample();
    const allTasks = this.store.listTasks();
    const allRuns = this.store.listRuns();
    this.refreshConfiguredModels();
    const allObservations = allRuns.map((run) => this.observeRun(run, now));
    const tasks = allTasks.filter((task) => planId === undefined || task.planId === planId);
    const taskIds = new Set(tasks.map((task) => task.id));
    const runs = allObservations.filter((run) => taskIds.has(run.taskId));
    const plans = this.store.listPlans().map((plan) => {
      const planTasks = allTasks.filter((task) => task.planId === plan.id);
      const ids = new Set(planTasks.map((task) => task.id));
      return summarizeUsage(plan.id, planTasks, allObservations.filter((run) => ids.has(run.taskId)));
    });
    const resource = this.latest!;
    return {
      sampledAt: now,
      app: { version: this.version, platform: process.platform, nodeVersion: process.versions.node,
        uptimeMs: Math.floor(process.uptime() * 1_000), desktop: resource.scope === 'desktop-process-tree' },
      resource, history: this.history.slice(),
      system: { totalMemoryBytes: totalmem(), usedMemoryBytes: totalmem() - freemem(), logicalCpuCount: availableParallelism() },
      usage: summarizeUsage(planId ?? null, tasks, runs), plans, runs,
      activeJobs: runs.filter((run) => ['running', 'queued', 'taken_over'].includes(run.status)),
      usageByTool: collectUsageByTool(runs),
      usageByModel: collectUsageByModel(runs),
      notes: [
        resource.scope === 'desktop-process-tree' ? 'CPU/RAM bao gồm cửa sổ desktop, server và các tiến trình con đang đo.' : 'CPU/RAM hiện chỉ đo server Node; mở app desktop để đo cả cây tiến trình.',
        'Token, USD và credit chỉ cộng số liệu agent báo; thiếu dữ liệu được giữ là chưa rõ. Không quy đổi credit thuê bao từ USD/token.',
        'Tài nguyên theo run được lấy mẫu mỗi 5 giây; tiến trình tồn tại ngắn giữa hai mẫu có thể không được ghi nhận. RAM là working set, không phải tổng RAM tiêu thụ theo thời gian.',
        ...(resource.gpu === null ? ['GPU chưa có nguồn đo khả dụng; không suy diễn mức sử dụng GPU từ CPU hoặc agent.'] : []),
        ...(resource.gpu?.scope === 'system' ? ['GPU là mức sử dụng toàn thiết bị trên máy, bao gồm các ứng dụng khác; không quy cho Fleet hoặc một run cụ thể.'] : []),
        ...(resource.gpu?.scope === 'desktop-process-tree' ? ['GPU desktop lấy từ bộ đếm Windows của các tiến trình Fleet: phần trăm là engine bận nhất, không cộng các engine; bộ nhớ là dedicated GPU memory của các tiến trình được đo.'] : []),
      ],
    };
  }

  private ensureInfo(runId: string): RunInfo {
    let info = this.info.get(runId);
    if (info) return info;
    info = emptyInfo();
    this.info.set(runId, info);
    for (const event of this.store.readEvents(runId)) applyEvent(info, event);
    return info;
  }

  /**
   * Older runs may only contain `raw` JSON lines when the normalizer did not yet
   * recognize a shape. Parse those at most once per run to seed a missing model
   * or usage, never both a normalized and a seeded copy of the same event.
   */
  private seedRaw(info: RunInfo, run: Run): void {
    if (info.rawSeeded) return;
    info.rawSeeded = true;
    const stored = this.store.readEvents(run.id);
    const hasModel = stored.some((entry) => entry.event.kind === 'model');
    const hasUsage = stored.some((entry) => entry.event.kind === 'usage');
    if (hasModel && hasUsage) return;
    const parse = withMetadata(getAdapter(run.agent).createParser(), run.agent);
    for (const entry of stored) {
      if (entry.event.kind !== 'raw') continue;
      for (const event of parse(entry.event.text, entry.event.stream)) {
        if (event.kind === 'model' && !hasModel) trackModel(info, event);
        else if (event.kind === 'usage' && !hasUsage) info.ledger.addUsage(event);
      }
    }
  }

  private refreshConfiguredModels(): void {
    this.configuredModels.clear();
    try {
      const config = JSON.parse(readFileSync(path.join(this.directory, 'fleet.config.json'), 'utf8')) as {
        agents?: Record<string, { extraArgs?: unknown }>;
      };
      for (const [agent, entry] of Object.entries(config.agents ?? {})) {
        const args = entry.extraArgs;
        if (!Array.isArray(args)) continue;
        const model = configuredModel(args.filter((value): value is string => typeof value === 'string'));
        if (model !== null) this.configuredModels.set(agent, model);
      }
    } catch { /* No configured model is not an error. */ }
  }

  private observeRun(run: Run, now: number): RunObservation {
    const info = this.ensureInfo(run.id);
    this.seedRaw(info, run);
    // Current config is not evidence of which model an old finished run used.
    const reportedModels = info.ledger.models();
    const configured = reportedModels.length === 0 && ['queued', 'running'].includes(run.status) ? this.configuredModels.get(run.agent) ?? null : null;
    const models: ModelIdentity[] = configured
      ? [...reportedModels, { name: configured, provider: null, source: 'configured', generic: isGenericModel(configured) }]
      : reportedModels;
    const primary = info.ledger.primary();
    const totals = info.ledger.totals({ inputTokens: run.inputTokens, outputTokens: run.outputTokens, costUsd: run.costUsd });
    const summary = this.summaries.get(run.id);
    const { processCpu: _private, ...resources } = summary ?? { processCpu: {} };
    return {
      taskId: run.taskId, runId: run.id, agent: run.agent, status: run.status,
      model: primary?.name ?? configured, modelSource: primary ? primary.source : configured ? 'configured' : 'unknown',
      models,
      currentActivity: info.activity, lastEventAt: info.lastEventAt,
      silentForMs: run.status === 'running' ? Math.max(0, now - (info.lastEventAt ?? run.startedAt ?? now)) : null,
      inputTokens: totals.inputTokens, outputTokens: totals.outputTokens, costUsd: totals.costUsd,
      credits: totals.credits, reportedCredits: totals.reportedCredits,
      usageByModel: info.ledger.rows(run.agent, totals),
      resources: summary ? resources as RunResourceSummary : null,
    };
  }

  private sample(): void {
    const now = Date.now();
    let native: NativeResourceSample | null = null;
    try {
      const file = path.join(this.directory, 'resources.json');
      if (existsSync(file) && statSync(file).size <= MAX_TELEMETRY_BYTES) native = parseNativeSample(JSON.parse(readFileSync(file, 'utf8')), now);
    } catch { /* Atomic replacement or an unavailable desktop falls back to server metrics. */ }
    const currentCpu = process.cpuUsage();
    const elapsedMs = now - this.previousCpuAt;
    const cpuDeltaMs = (currentCpu.user + currentCpu.system - this.previousCpu.user - this.previousCpu.system) / 1_000;
    const memoryBytes = process.memoryUsage().rss;
    this.peakServerMemory = Math.max(this.peakServerMemory, memoryBytes);
    const sample: ResourceSample = native ? (({ processes: _processes, ...sample }) => sample)(native) : {
      sampledAt: now, scope: 'server-only', cpuPercent: elapsedMs > 0 ? Math.min(100, Math.max(0, cpuDeltaMs / elapsedMs / availableParallelism() * 100)) : null,
      memoryBytes, peakMemoryBytes: this.peakServerMemory, cpuTimeMs: (currentCpu.user + currentCpu.system) / 1_000,
      processCount: 1, gpu: null,
    };
    this.previousCpu = currentCpu;
    this.previousCpuAt = now;
    const newSample = this.latest?.scope !== sample.scope || this.latest.sampledAt !== sample.sampledAt;
    this.latest = sample;
    if (newSample) {
      this.history = [...this.history, sample].filter((entry) => entry.sampledAt >= now - HISTORY_LIMIT * SAMPLE_INTERVAL_MS).slice(-HISTORY_LIMIT);
      if (native) this.measureRuns(native);
    }
    if (now - this.lastPersistAt >= 30_000) this.persist();
  }

  private measureRuns(sample: NativeResourceSample): void {
    const activeRuns = this.store.listRuns().filter((run) => ['running', 'taken_over'].includes(run.status) && run.pid !== null);
    const activeIds = new Set(activeRuns.map((run) => run.id));
    for (const [runId, summary] of this.summaries) {
      if (!activeIds.has(runId)) summary.processCpu = {};
    }
    const groups = attributeProcesses(sample.processes, activeRuns);
    for (const [runId, processes] of groups) {
      const summary = this.summaries.get(runId) ?? {
        runId, samples: 0, firstSampledAt: sample.sampledAt, lastSampledAt: 0,
        peakMemoryBytes: 0, peakCpuPercent: null, observedCpuTimeMs: 0, processCpu: {},
      };
      if (summary.lastSampledAt >= sample.sampledAt) continue;
      summary.samples++;
      summary.lastSampledAt = sample.sampledAt;
      summary.peakMemoryBytes = Math.max(summary.peakMemoryBytes, processes.reduce((sum, process) => sum + process.memoryBytes, 0));
      const knownCpu = processes.map((process) => process.cpuPercent).filter((value): value is number => value !== null);
      if (knownCpu.length) summary.peakCpuPercent = Math.max(summary.peakCpuPercent ?? 0, Math.min(100, knownCpu.reduce((sum, value) => sum + value, 0)));
      let knownProcessCount = Object.keys(summary.processCpu).length;
      for (const process of processes) {
        const key = `${process.pid}:${process.startedAt ?? process.name}`;
        if (!(key in summary.processCpu)) {
          if (knownProcessCount >= 2_000) continue;
          knownProcessCount++;
        }
        const previous = summary.processCpu[key] ?? 0;
        summary.observedCpuTimeMs += Math.max(0, process.cpuTimeMs - previous);
        summary.processCpu[key] = Math.max(previous, process.cpuTimeMs);
      }
      this.summaries.set(runId, summary);
    }
    while (this.summaries.size > SUMMARY_LIMIT) this.summaries.delete(this.summaries.keys().next().value!);
  }

  private restore(): void {
    try {
      const file = path.join(this.directory, 'observability.json');
      if (!existsSync(file) || statSync(file).size > 10_000_000) return;
      const saved = JSON.parse(readFileSync(file, 'utf8')) as Persistence;
      if (saved.version !== 1 || !Array.isArray(saved.runs)) return;
      // History restarts with the server; lifetime run summaries remain available.
      for (const summary of saved.runs.slice(-SUMMARY_LIMIT)) {
        if (typeof summary.runId !== 'string' || !integer(summary.samples) || !nonnegative(summary.peakMemoryBytes)
          || !nonnegative(summary.observedCpuTimeMs) || !nonnegative(summary.firstSampledAt) || !nonnegative(summary.lastSampledAt)
          || !percent(summary.peakCpuPercent) || !record(summary.processCpu)) continue;
        const entries = Object.entries(summary.processCpu);
        if (entries.length > 10_000 || entries.some(([key, value]) => key.length > 512 || !nonnegative(value))) continue;
        this.summaries.set(summary.runId, summary);
      }
    } catch { /* A corrupt optional metrics file must never prevent startup. */ }
  }

  private persist(): void {
    try {
      const file = path.join(this.directory, 'observability.json');
      const saved: Persistence = { version: 1, history: [], runs: [...this.summaries.values()] };
      const temporary = `${file}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(saved), 'utf8');
      renameSync(temporary, file);
      this.lastPersistAt = Date.now();
    } catch { /* Disk-full/read-only metrics storage does not interrupt an agent run. */ }
  }
}
