export interface SkeletonProps {
  /** Announced and displayed above the bars, e.g. "Đang tải nhật ký…". */
  label: string;
  /** Number of placeholder bars. */
  lines?: number;
  /** Extra class for a screen-specific size, e.g. `welcome-skeleton`. */
  className?: string;
}

/**
 * Placeholder shown while a read is in flight. Screens used to render their
 * empty copy ("Chưa có sự kiện", "Chưa có thay đổi") during the first load,
 * which read as "there is nothing here"; a skeleton cannot be mistaken for it.
 */
export function Skeleton({ label, lines = 3, className }: SkeletonProps) {
  return (
    <div className={`skeleton${className ? ` ${className}` : ''}`} role="status" aria-busy="true">
      <span className="skeleton-label">{label}</span>
      <span className="skeleton-lines" aria-hidden="true">
        {Array.from({ length: Math.max(1, lines) }, (_, index) => (
          <span key={index} className="skeleton-line" />
        ))}
      </span>
    </div>
  );
}
