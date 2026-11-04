import { useEffect, useState } from 'react';
import type { ObservabilitySnapshot } from '../../shared/observability.js';

export function useObservability(planId?: string) {
  const [snapshot, setSnapshot] = useState<ObservabilitySnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let disposed = false;
    let timer: number | undefined;
    let controller: AbortController | null = null;
    let running = false;
    setSnapshot(null);
    const refresh = async () => {
      if (disposed || running) return;
      running = true;
      controller = new AbortController();
      const requestTimeout = window.setTimeout(() => controller?.abort(), 10_000);
      try {
        const response = await fetch(`/api/observability${planId ? `?planId=${encodeURIComponent(planId)}` : ''}`, { credentials: 'same-origin', signal: controller.signal });
        if (!response.ok) throw new Error(`Không tải được số liệu (${response.status})`);
        const data = await response.json() as ObservabilitySnapshot;
        if (!disposed) { setSnapshot(data); setError(null); }
      } catch (cause) { if (!disposed) setError(cause instanceof Error ? cause.message : String(cause)); }
      finally { window.clearTimeout(requestTimeout); running = false; if (!disposed) timer = window.setTimeout(refresh, document.hidden ? 15_000 : 3_000); }
    };
    void refresh();
    const resume = () => { if (!document.hidden) { window.clearTimeout(timer); void refresh(); } };
    document.addEventListener('visibilitychange', resume);
    return () => { disposed = true; controller?.abort(); window.clearTimeout(timer); document.removeEventListener('visibilitychange', resume); };
  }, [planId, revision]);
  return { snapshot, error, reload: () => setRevision(value => value + 1) };
}

export const formatNumber = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat('vi-VN').format(value);
export const formatBytes = (value: number | null | undefined) => value == null ? '—' : value >= 1024 ** 3 ? `${(value / 1024 ** 3).toFixed(2)} GB` : `${(value / 1024 ** 2).toFixed(1)} MB`;
export const formatUsd = (value: number | null | undefined) => value == null ? '—' : `$${value.toFixed(4)}`;
export function exportReport(snapshot: ObservabilitySnapshot): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `agent-fleet-usage-${new Date(snapshot.sampledAt).toISOString().slice(0, 10)}.json`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
