/** Keep the v2 import path working while agent tasks own separate modules. */
export { parseCliStatus, enrichDashboardStatus } from './dashboard/parsers/index.js';
export type { ParsedCliStatus, DashboardEnrichment, DashboardEnrichmentContext } from './dashboard/parsers/index.js';
