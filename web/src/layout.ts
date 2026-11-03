import { useCallback, useEffect, useMemo, useState } from 'react';

export interface WorkspaceLayout { sidebarWidth: number; inspectorWidth: number; terminalHeight: number }
const defaults: WorkspaceLayout = { sidebarWidth: 258, inspectorWidth: 320, terminalHeight: 380 };
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), Number.isFinite(value) ? value : min));
export function normalizeLayout(layout: WorkspaceLayout): WorkspaceLayout {
  return { sidebarWidth: clamp(layout.sidebarWidth, 190, 420), inspectorWidth: clamp(layout.inspectorWidth, 260, 520), terminalHeight: clamp(layout.terminalHeight, 240, 2000) };
}
export function clampLayout(layout: WorkspaceLayout, width = window.innerWidth, height = window.innerHeight): WorkspaceLayout {
  const sidebarWidth = clamp(layout.sidebarWidth, 190, Math.min(420, width - 480));
  return { sidebarWidth, inspectorWidth: clamp(layout.inspectorWidth, 260, Math.min(520, width - sidebarWidth - 360)), terminalHeight: clamp(layout.terminalHeight, 240, Math.max(350, height - 250)) };
}
export function useWorkspaceLayout() {
  const [preference, setPreference] = useState<WorkspaceLayout>(() => {
    try { const value = window.__FLEET_DESKTOP__?.layout ?? JSON.parse(localStorage.getItem('fleet.layout') ?? '{}'); return normalizeLayout({ ...defaults, ...value }); }
    catch { return defaults; }
  });
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));
  const layout = useMemo(() => clampLayout(preference, viewport.width, viewport.height), [preference, viewport]);
  const updateLayout = useCallback((patch: Partial<WorkspaceLayout>) => setPreference((current) => normalizeLayout({ ...current, ...patch })), []);
  useEffect(() => { const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight }); window.addEventListener('resize', resize); return () => window.removeEventListener('resize', resize); }, []);
  useEffect(() => {
    // Keep the requested dimensions even while WebView2 is initially small or
    // the app moves to a smaller monitor; only the rendered layout is clamped.
    const timer = window.setTimeout(() => { try { localStorage.setItem('fleet.layout', JSON.stringify(preference)); window.chrome?.webview?.postMessage({ type: 'fleet:set-layout', layout: preference }); } catch { /* Browser preview can deny storage. */ } }, 180);
    return () => window.clearTimeout(timer);
  }, [preference]);
  return { layout, updateLayout };
}

/** At or below this width the inspector covers the main column instead of sitting beside it. */
export const INSPECTOR_OVERLAY_MAX_WIDTH = 1050;

/**
 * The inspector opens only when there is room for it beside the main column.
 * Narrow windows start closed so the first screen is the work, not the
 * resource panel; the topbar toggle and the panel's own close button control it
 * from there.
 */
export function inspectorDefaultOpen(viewportWidth: number): boolean {
  return viewportWidth > INSPECTOR_OVERLAY_MAX_WIDTH;
}
