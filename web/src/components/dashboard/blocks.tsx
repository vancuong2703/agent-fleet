import type { ReactNode } from 'react';
import { Icon } from '../Icon.js';

/**
 * Every block on a tool card answers the same four questions: đang tải,
 * chưa kiểm tra, lỗi, hay chưa có dữ liệu. `data` is the only state that may
 * render real numbers, which keeps `null` from ever being dressed up as 0.
 */
export type BlockState = 'loading' | 'unchecked' | 'error' | 'empty' | 'data';

export interface BlockProps {
  title: string;
  state: BlockState;
  /** Nhãn phụ bên phải tiêu đề, ví dụ "rẻ nhất trước". */
  hint?: string | null;
  /** Nguyên nhân khi lỗi hoặc khi thiếu dữ liệu. */
  detail?: string | null;
  /** Ghi chú mờ bên dưới khối (lý do CLI không trả về số liệu). */
  note?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  children?: ReactNode;
}

export function Block({ title, state, hint, detail, note, onRetry, retryLabel, children }: BlockProps) {
  return (
    <section className="dash-panel" data-state={state}>
      <div className="dash-section-h">
        <span>{title}</span>
        {hint ? <span className="dash-section-hint">{hint}</span> : null}
      </div>
      {state === 'loading' ? (
        <div className="dash-skeleton">
          <span className="dash-skeleton-line" /><span className="dash-skeleton-line short" />
          <span className="dash-skeleton-text">Đang tải…</span>
        </div>
      ) : null}
      {state === 'unchecked' ? (
        <p className="dash-block-state">
          <Icon name="info" size={15} />
          <span>Chưa kiểm tra · bấm <strong>Kiểm tra</strong> để đọc {lower(title)}.</span>
        </p>
      ) : null}
      {state === 'error' ? (
        <p className="dash-block-state is-error">
          <Icon name="close" size={15} />
          <span>{detail ?? 'Lần kiểm tra trước không đọc được khối này.'}</span>
          {onRetry ? (
            <button type="button" className="dash-retry" onClick={onRetry} aria-label={retryLabel ?? `Kiểm tra lại ${lower(title)}`}>
              <Icon name="refresh" size={14} />Thử lại
            </button>
          ) : null}
        </p>
      ) : null}
      {state === 'empty' ? (
        <p className="dash-block-state">
          <Icon name="info" size={15} />
          <span>Chưa có dữ liệu{detail ? ` · ${detail}` : ''}</span>
        </p>
      ) : null}
      {state === 'data' ? children : null}
      {note && state !== 'loading' ? <p className="dash-block-note">{note}</p> : null}
    </section>
  );
}

/** "Hạn mức theo nhóm model" → "hạn mức theo nhóm model" cho câu hướng dẫn. */
function lower(text: string): string {
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : text;
}

export function Skeleton({ lines = 2 }: { lines?: number }) {
  return (
    <div className="dash-skeleton">
      {Array.from({ length: lines }, (_, index) => (
        <span className={`dash-skeleton-line${index % 2 ? ' short' : ''}`} key={index} />
      ))}
    </div>
  );
}

// ── định dạng ───────────────────────────────────────────────────────────────

/** `null` và `0` là hai kết quả khác nhau: chỉ `null` mới là "chưa có dữ liệu". */
export function hasValue(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function num(value: number): string {
  return value.toLocaleString('vi-VN');
}

/** 62 → "62", 69.38 → "69.4"; làm tròn một chữ số để thanh và số luôn khớp nhau. */
export function roundPct(value: number): number {
  return Math.round(value * 10) / 10;
}

export function clock(ms: number): string {
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString('vi-VN', { hour12: false }) : '—';
}

/**
 * `2026-11-28T12:00:00Z` → `28/11`. Tự ghép định dạng thay vì dựa ICU:
 * `toLocaleDateString('vi-VN')` trả `28-11` trên một số máy, không giống mockup.
 * Chuỗi mô tả ("sau 4 ngày") giữ nguyên.
 */
export function dayLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;
}
