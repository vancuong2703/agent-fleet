import type { DashboardBalance, DashboardCheck, QuotaWindow } from '../../../../shared/dashboard.js';
import { hasValue, num } from './blocks.js';

const UNIT_LABELS: Record<NonNullable<DashboardBalance['unit']>, string> = {
  tokens: 'token', credits: 'credit', requests: 'request', percent: '%',
};

export function unitLabel(unit: DashboardBalance['unit'] | QuotaWindow['unit'] | null | undefined): string {
  if (!unit || unit === 'percent') return unit === 'percent' ? '%' : '';
  return UNIT_LABELS[unit];
}

/** Giá trị tuyệt đối của một hạn mức; `null` phải đọc là "chưa có dữ liệu". */
export function BalanceValue({ value }: { value: DashboardBalance | undefined }) {
  if (!hasValue(value?.remaining)) {
    const reason = value?.reason ?? null;
    const label = reason?.includes('chưa được bật') ? 'Chưa bật AI Credits' : reason ?? 'Chưa có dữ liệu';
    return <span className="dash-unknown" title={reason ?? undefined}>{label}</span>;
  }
  const label = unitLabel(value?.unit ?? null);
  return (
    <strong>
      {num(value.remaining)}
      {label ? <small> {label}</small> : null}
    </strong>
  );
}

export interface CreditPanelProps {
  check: DashboardCheck;
}

/**
 * Số dư credit. Các cửa sổ `unit === 'credits'` chỉ được dùng để lấy hạn mức
 * gói và đơn vị; bản thân từng cửa sổ hiện ở khối "Hạn mức còn lại" (QuotaMeter)
 * để không lặp lại một số liệu hai lần trong thẻ.
 */
export function CreditPanel({ check }: CreditPanelProps) {
  const credits = check.credits;
  const primary = (check.quotaWindows ?? []).find((row) => row.unit === 'credits') ?? null;
  const remaining = credits.remaining;
  return (
    <div className="dash-credit">
      <div className="dash-credit-big kpi-value">
        {hasValue(remaining) ? (
          <>
            {num(remaining)}
            {hasValue(primary?.limit) ? <> / {num(primary.limit)}</> : null}
            <small> {unitLabel(primary?.unit ?? credits.unit ?? null)}</small>
          </>
        ) : (
          <span className="dash-unknown">Chưa có dữ liệu</span>
        )}
      </div>
      {!hasValue(remaining) && credits.reason ? <p className="dash-block-note">{credits.reason}</p> : null}
      {hasValue(remaining) && credits.resetAt ? <p className="dash-block-note">Làm mới {credits.resetAt}</p> : null}
    </div>
  );
}
