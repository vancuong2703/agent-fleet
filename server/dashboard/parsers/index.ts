import type { DashboardAgent } from '../../../shared/dashboard.js';
import type { CommandProbeResult } from '../../dashboard.js';
import { parseCodexStatus, enrichCodex } from './codex.js';
import { parseQoderStatus, enrichQoder } from './qoder.js';
import { parseAgyStatus, enrichAgy } from './agy.js';
import { parseOpencodeStatus, enrichOpencode } from './opencode.js';
import type { DashboardEnrichmentContext } from './common.js';

const parsers = { codex: parseCodexStatus, qodercli: parseQoderStatus, agy: parseAgyStatus, opencode: parseOpencodeStatus };
const enrichers = { codex: enrichCodex, qodercli: enrichQoder, agy: enrichAgy, opencode: enrichOpencode };

/** Compatibility entry point; each agent now owns its parser independently. */
export function parseCliStatus(agent: DashboardAgent, results: CommandProbeResult[], redact: (text: string) => string) {
  return parsers[agent](results, redact);
}

export function enrichDashboardStatus(agent: DashboardAgent, context: DashboardEnrichmentContext) {
  return enrichers[agent](context);
}
export type { ParsedCliStatus, DashboardEnrichment, DashboardEnrichmentContext } from './common.js';
