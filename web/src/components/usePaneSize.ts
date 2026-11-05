import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/** localStorage throws in private mode and locked-down webviews; pane sizes are conveniences only. */
function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

function read(key: string): number | null {
  try {
    const raw = storage()?.getItem(key);
    if (raw === null || raw === undefined) return null;
    const value = Number(raw);
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch { return null; }
}

function write(key: string, value: number | null): void {
  try { const store = storage(); if (!store) return; if (value === null) store.removeItem(key); else store.setItem(key, String(value)); } catch { /* Blocked storage: ignore. */ }
}

export interface PaneSizeOptions {
  /** localStorage key holding the dragged width in px. */
  storageKey: string;
  min: number;
  /** Upper bound for a given container width. */
  max: (total: number) => number;
  /** Width shown (and reported to assistive tech) while the user has not dragged. */
  fallback: (total: number) => number;
}

export interface PaneSize {
  /** Attach to the element whose width bounds the pane (the grid). */
  containerRef: RefObject<HTMLDivElement>;
  /** Effective width in px, clamped to the container. */
  size: number;
  /** The dragged width (clamped), or null while the layout default applies. */
  custom: number | null;
  min: number;
  max: number;
  setSize: (value: number) => void;
  reset: () => void;
}

/** Shared by the Terminal side column and the Jobs list/detail divider. */
export function usePaneSize({ storageKey, min, max, fallback }: PaneSizeOptions): PaneSize {
  const containerRef = useRef<HTMLDivElement>(null);
  const [total, setTotal] = useState(0);
  const [stored, setStored] = useState<number | null>(() => read(storageKey));
  useEffect(() => {
    const element = containerRef.current; if (!element) return;
    const measure = () => setTotal(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure); observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const high = total > 0 ? Math.max(min, max(total)) : Number.MAX_SAFE_INTEGER;
  const clamp = (value: number) => Math.round(Math.min(high, Math.max(min, value)));
  const custom = stored === null ? null : clamp(stored);
  const size = custom ?? Math.round(Math.min(high, Math.max(min, fallback(total))));
  const latest = useRef({ high });
  latest.current = { high };
  const setSize = useCallback((value: number) => {
    const next = Math.round(Math.min(latest.current.high, Math.max(min, value)));
    setStored(next); write(storageKey, next);
  }, [min, storageKey]);
  const reset = useCallback(() => { setStored(null); write(storageKey, null); }, [storageKey]);
  return { containerRef, size, custom, min, max: total > 0 ? high : max(1200), setSize, reset };
}
