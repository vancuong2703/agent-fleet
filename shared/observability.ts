import type { AgentId, RunStatus } from './types.js';

export interface ProcessResourceSample {
  pid: number;
  parentPid: number;
  name: string;
  cpuTimeMs: number;
  cpuPercent: number | null;
  memoryBytes: number;
  startedAt?: number;
}

export interface GpuSample {
  name: string;
  utilizationPercent: number | null;
  memoryBytes: number | null;
  /** Desktop counters are owned-process metrics; system fallback includes other apps. */
  scope?: 'desktop-process-tree' | 'system';
}

/** CPU is normalized to the whole machine (0–100); memory is working set. */
export interface ResourceSample {
  sampledAt: number;
  scope: 'desktop-process-tree' | 'server-only';
  cpuPercent: number | null;
  memoryBytes: number;
  peakMemoryBytes: number;
  cpuTimeMs: number;
  processCount: number;
  gpu: GpuSample | null;
}

export interface RunResourceSummary {
  runId: string;
  samples: number;
  firstSampledAt: number;
  lastSampledAt: number;
  peakMemoryBytes: number;
  peakCpuPercent: number | null;
  /** CPU observed between samples; short-lived child processes may be missed. */
  observedCpuTimeMs: number;
}

export interface UsageSummary {
  planId: string | null;
  taskCount: number;
  runCount: number;
  completedRuns: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  /** Reported provider credits only; never derived from tokens or dollars. */
  credits: number | null;
  /** Nominal provider credits, including explicitly non-billable usage. */
  reportedCredits: number | null;
  coverage: { tokenRuns: number; costRuns: number; creditRuns: number; totalRuns: number };
  resources: { measuredRuns: number; peakMemoryBytes: number | null; observedCpuTimeMs: number | null };
}

export interface ModelIdentity {
  name: string;
  provider: string | null;
  source: 'reported' | 'configured';
  /** A runtime placeholder such as qfmodel is kept without inventing an alias. */
  generic: boolean;
}

export interface UsageMetrics {
  runCount: number;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  credits: number | null;
  reportedCredits: number | null;
  coverage: { tokenRuns: number; costRuns: number; creditRuns: number; totalRuns: number };
}

export interface ModelUsageRow extends UsageMetrics {
  agent: AgentId;
  /** null means an aggregate that cannot be assigned to a specific model. */
  model: string | null;
  provider: string | null;
  attribution: 'reported' | 'configured' | 'unattributed';
}

export interface ToolUsageRow extends UsageMetrics {
  agent: AgentId;
  models: ModelIdentity[];
}

export interface RunObservation {
  taskId: string;
  runId: string;
  agent: AgentId;
  status: RunStatus;
  model: string | null;
  modelSource: 'reported' | 'configured' | 'unknown';
  models: ModelIdentity[];
  currentActivity: string;
  lastEventAt: number | null;
  silentForMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  credits: number | null;
  reportedCredits: number | null;
  usageByModel: ModelUsageRow[];
  resources: RunResourceSummary | null;
}

export interface ObservabilitySnapshot {
  sampledAt: number;
  app: { version: string; platform: string; nodeVersion: string; uptimeMs: number; desktop: boolean };
  resource: ResourceSample;
  history: ResourceSample[];
  system: { totalMemoryBytes: number; usedMemoryBytes: number; logicalCpuCount: number };
  usage: UsageSummary;
  plans: UsageSummary[];
  runs: RunObservation[];
  activeJobs: RunObservation[];
  usageByTool: ToolUsageRow[];
  usageByModel: ModelUsageRow[];
  notes: string[];
}
