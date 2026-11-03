import type { DashboardAgent, DashboardBalance, DashboardCheck } from '../../../shared/dashboard.js';
import type { FleetConfig } from '../../config.js';
import type { CommandProbeResult } from '../../dashboard.js';

/** New fields remain optional so persisted v2 checks and old callers stay valid. */
export type DashboardEnrichment = Pick<DashboardCheck, 'plan' | 'currentModel' | 'models' | 'quotaWindows' | 'keyPools' | 'highlights'>;
export interface ParsedCliStatus extends DashboardEnrichment {
  account?: DashboardCheck['account'];
  quota: DashboardBalance;
  credits: DashboardBalance;
  details: NonNullable<DashboardCheck['details']>;
  quotas: NonNullable<DashboardCheck['quotas']>;
}
export interface DashboardEnrichmentContext {
  agent: DashboardAgent;
  bin: string;
  directory: string;
  config: FleetConfig;
  check: DashboardCheck;
  results: CommandProbeResult[];
  redact: (text: string) => string;
  /** Executes a fixed read-only argv with the dashboard's existing timeout/output bounds. */
  runCommand: (args: string[], kind?: CommandProbeResult['kind']) => Promise<CommandProbeResult>;
}

export const unknown = (source: string, reason: string): DashboardBalance => ({ remaining: null, unit: null, resetAt: null, source, reason });
export const amount = (value: string) => Number(value.replaceAll(',', ''));
export const lastMatch = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].at(-1);

export function createParseContext(results: CommandProbeResult[], redact: (text: string) => string) {
  const source = results.find(row => row.command.includes('→'))?.command
    ?? results.find(row => row.kind === 'status')?.command ?? 'CLI';
  const result: ParsedCliStatus = {
    quota: unknown(source, 'Lệnh trạng thái chưa trả hạn mức còn lại.'),
    credits: unknown(source, 'Lệnh trạng thái chưa trả số credit còn lại.'),
    details: [], quotas: [],
  };
  return { result, source, text: results.map(row => `${row.stdout}\n${row.stderr}`).join('\n'),
    add: (label: string, value: string) => result.details.push({ label, value: redact(value).slice(0, 300) }) };
}
