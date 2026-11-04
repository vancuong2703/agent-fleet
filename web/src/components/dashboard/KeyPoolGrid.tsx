import type { KeyPool } from '../../../../shared/dashboard.js';
import { dayLabel, hasValue, num, roundPct } from './blocks.js';
import { meterTone } from './QuotaMeter.js';

/**
 * `server/key-pools.ts` ghi lý do pool không chạy vào cuối `limitLabel`
 * ("… · pool không chạy") vì kiểu `KeyPool` không có trường `reason`.
 */
export function poolReason(pool: KeyPool): string | null {
  const parts = pool.limitLabel.split(' · ');
  return parts.length > 1 ? parts.slice(1).join(' · ') : null;
}

function poolLimit(pool: KeyPool): string {
  return pool.limitLabel.split(' · ')[0];
}

/** Một ô cho mỗi key, màu theo trạng thái; nhãn đã được mask ở server. */
function KeyCells({ pool }: { pool: KeyPool }) {
  return (
    <div className="dash-keys" role="list" aria-label={`${pool.total} key của pool ${pool.name}`}>
      {pool.keys.map((key) => (
        <span
          className={`dash-key is-${key.status}`}
          key={key.label}
          role="listitem"
          title={hasValue(key.pct) ? `${key.label} · còn ${roundPct(key.pct)}%` : `${key.label} · chưa rõ mức còn lại`}
        >
          {key.label}
        </span>
      ))}
    </div>
  );
}

function PoolBar({ pct, label }: { pct: number | null; label: string }) {
  const shown = pct === null ? null : roundPct(pct);
  return (
    <div className="dash-meter">
      <span className="dash-meter-name">{label}</span>
      <span className="dash-meter-val">
        {shown === null ? <span className="dash-unknown">Chưa có dữ liệu</span> : `${shown}%`}
      </span>
      <div
        className={`dash-bar ${meterTone(pct)}`}
        role={shown === null ? undefined : 'progressbar'}
        aria-valuenow={shown ?? undefined}
        aria-valuemin={shown === null ? undefined : 0}
        aria-valuemax={shown === null ? undefined : 100}
        aria-label={`${label} còn ${shown ?? 'chưa rõ'}%`}
      >
        <span style={shown === null ? undefined : { width: `${Math.max(0, Math.min(100, shown))}%` }} />
      </div>
    </div>
  );
}

export interface KeyPoolGridProps {
  pools: readonly KeyPool[] | null | undefined;
}

export function KeyPoolGrid({ pools }: KeyPoolGridProps) {
  const list = [...(pools ?? [])];
  if (!list.length) {
    return <p className="dash-block-state"><span>Chưa có dữ liệu · chưa đọc được pool key nào.</span></p>;
  }
  return (
    <div className="dash-pools">
      {list.map((pool) => {
        const reason = poolReason(pool);
        const reset = dayLabel(pool.resetAt);
        return (
          <article className="dash-pool" data-pool={pool.name} key={pool.name}>
            <div className="dash-pool-head">
              <span className="dash-pool-name">harbor-key · {pool.name}</span>
              <span className="dash-pool-meta">
                {pool.total > 0 ? `${num(pool.total)} key` : 'chưa đọc được key'}
                {pool.exhausted > 0 ? <em className="dash-pool-warn">{pool.exhausted} key cạn</em> : null}
              </span>
            </div>
            {pool.keys.length ? <KeyCells pool={pool} /> : null}
            <PoolBar pct={pool.remainingPct} label={pool.total > 0 ? `${pool.ok}/${pool.total} key còn hạn mức` : 'Mức còn lại của pool'} />
            <p className="dash-pool-limit">
              {poolLimit(pool)}
              {reset && reset !== pool.resetAt ? <> · key cạn reset {reset}</> : null}
              {reason ? <em className="dash-pool-reason">{reason}</em> : null}
            </p>
          </article>
        );
      })}
    </div>
  );
}
