import { ChartSpline } from 'lucide-react';
import type { ResourceSample } from '../../../../shared/observability.js';
import { chartGeometry, chartGuidance, type ChartKind } from '../../usage.js';

/**
 * Sparkline for measured CPU or memory. With fewer than two usable samples it
 * renders an explanatory empty state instead of an axis with a flat line.
 */
export function ResourceChart({ history, kind = 'cpu', compact = false }: { history: ResourceSample[]; kind?: ChartKind; compact?: boolean }) {
  const label = kind === 'cpu' ? 'Lịch sử CPU' : 'Lịch sử bộ nhớ';
  const geometry = chartGeometry(history, kind);
  if (geometry.state !== 'ready') {
    const guidance = compact
      ? kind === 'cpu' ? 'Chưa có mẫu CPU' : 'Chưa có mẫu bộ nhớ'
      : chartGuidance(kind, geometry.state);
    return (
      <div className={`chart-empty ${kind}${compact ? ' compact' : ''}`} role="img" aria-label={`${label}: ${guidance}`} data-chart-state={geometry.state}>
        <ChartSpline size={compact ? 13 : 18} strokeWidth={1.75} aria-hidden="true" />
        <span>{guidance}</span>
      </div>
    );
  }
  return (
    <svg className={`resource-chart ${kind}`} viewBox="0 0 260 50" preserveAspectRatio="none" role="img" aria-label={label} data-chart-state="ready" data-samples={geometry.samples}>
      <path d="M0 46H260M0 24H260" stroke="var(--border)" strokeWidth=".6" fill="none" />
      <polyline points={geometry.points} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
    </svg>
  );
}
