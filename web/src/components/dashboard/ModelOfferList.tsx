import type { ModelOffer } from '../../../../shared/dashboard.js';
import { formatMultiplier } from '../../usage.js';
import { hasValue } from './blocks.js';

/** Số dòng hiển thị trước khi phải bấm "Xem tất cả". */
export const DEFAULT_MODEL_ROWS = 6;

/** Hệ số tăng dần (rẻ nhất trước); model chưa rõ hệ số luôn xếp cuối theo tên. */
export function sortOffers(models: readonly ModelOffer[]): ModelOffer[] {
  return [...models].sort((a, b) => {
    const price = hasValue(a.multiplier) ? a.multiplier : null;
    const other = hasValue(b.multiplier) ? b.multiplier : null;
    if (price === null && other === null) return a.label.localeCompare(b.label);
    if (price === null) return 1;
    if (other === null) return -1;
    return price - other || a.label.localeCompare(b.label);
  });
}

/** `1_000_000` → `1M ctx`; thiếu dữ liệu trả `null` chứ không phải `0`. */
export function formatContext(tokens: number | null | undefined): string | null {
  if (!hasValue(tokens) || tokens <= 0) return null;
  if (tokens >= 1_000_000) return `${Math.round((tokens / 1_000_000) * 10) / 10}M ctx`;
  return `${Math.round(tokens / 1_000)}K ctx`;
}

function multClass(multiplier: number | null): string {
  if (!hasValue(multiplier)) return 'dash-mult unknown';
  if (multiplier === 0) return 'dash-mult free';
  if (multiplier <= 0.25) return 'dash-mult cheap';
  return 'dash-mult';
}

function discounted(offer: ModelOffer): number | null {
  const original = offer.originalMultiplier;
  if (!hasValue(original) || !hasValue(offer.multiplier)) return null;
  return original > offer.multiplier ? original : null;
}

function Row({ offer }: { offer: ModelOffer }) {
  const original = discounted(offer);
  const text = formatMultiplier(offer.multiplier);
  return (
    <li className="dash-model" data-model={offer.id}>
      <span className="dash-mname">
        <span className="dash-mname-text">{offer.label}</span>
        {offer.promo ? <em className="dash-sale">{offer.promo}</em> : null}
        {offer.source === 'catalog' ? <em className="dash-src">theo catalog</em> : null}
      </span>
      <span className="dash-ctx" title={offer.provider ? `provider: ${offer.provider}` : undefined}>
        {formatContext(offer.contextTokens) ?? '—'}
      </span>
      <span className={multClass(offer.multiplier)} title={text ? undefined : 'Chưa đọc được hệ số giá cho model này'}>
        {original != null ? <s>{formatMultiplier(original)}</s> : null}
        {text ?? 'Chưa rõ'}
      </span>
    </li>
  );
}

export interface ModelOfferListProps {
  models: readonly ModelOffer[] | null | undefined;
  /** Vượt quá ngưỡng này thì phần còn lại nằm trong `<details>`. */
  limit?: number;
}

export function ModelOfferList({ models, limit = DEFAULT_MODEL_ROWS }: ModelOfferListProps) {
  const sorted = sortOffers(models ?? []);
  if (!sorted.length) {
    return <p className="dash-block-state"><span>Chưa có dữ liệu · lần kiểm tra tới sẽ đọc danh sách model.</span></p>;
  }
  const head = sorted.slice(0, limit);
  const rest = sorted.slice(head.length);
  const unknown = sorted.filter((offer) => !hasValue(offer.multiplier)).length;
  return (
    <div className="dash-model-panel">
      <ul className="dash-models">{head.map((offer) => <Row key={offer.id} offer={offer} />)}</ul>
      {rest.length ? (
        <details className="dash-more">
          <summary>Xem tất cả {sorted.length} model{unknown ? ` · ${unknown} chưa rõ hệ số` : ''}</summary>
          <ul className="dash-models">{rest.map((offer) => <Row key={offer.id} offer={offer} />)}</ul>
        </details>
      ) : null}
    </div>
  );
}
