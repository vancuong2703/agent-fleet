/**
 * Stuck-run visibility. A running job that produced no event for a while is
 * easy to miss in a long list; the server already reports how long each run has
 * been silent (`silentForMs`), this turns it into display state.
 */

/** A running job quiet for longer than this turns warning-colored. */
export const STALL_AFTER_MS = 2 * 60_000;

export type Progress =
  /** No measurement: show "Chưa có dữ liệu", never 0. */
  | { kind: 'unknown' }
  | { kind: 'active' | 'stalled'; silentMs: number; minutes: number };

export function progressOf(silentForMs: number | null | undefined): Progress {
  if (silentForMs === null || silentForMs === undefined || !Number.isFinite(silentForMs)) return { kind: 'unknown' };
  const silentMs = Math.max(0, silentForMs);
  return { kind: silentMs > STALL_AFTER_MS ? 'stalled' : 'active', silentMs, minutes: Math.floor(silentMs / 60_000) };
}

/** "Tiến triển cuối 3 phút trước", or "vừa xong" below one minute. */
export function progressText(progress: Progress, t: (en: string, vi: string) => string): string {
  if (progress.kind === 'unknown') return t('No data yet', 'Chưa có dữ liệu');
  if (progress.minutes < 1) return t('Last progress just now', 'Tiến triển cuối vừa xong');
  return t(`Last progress ${progress.minutes} min ago`, `Tiến triển cuối ${progress.minutes} phút trước`);
}
