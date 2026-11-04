import type { QuotaWindow } from '../../../../shared/dashboard.js';
import { Icon, type IconName } from '../Icon.js';
import { hasValue, num, roundPct } from './blocks.js';

export type MeterTone = 'ok' | 'warn' | 'bad' | 'empty';

export const WINDOW_LABELS: Record<QuotaWindow['window'], string> = {
  '5h': '5 giờ', day: 'ngày', week: 'tuần', month: 'tháng', plan: 'gói',
};

const UNIT_LABELS: Record<QuotaWindow['unit'], string> = {
  tokens: 'token', credits: 'credit', requests: 'request', percent: '%',
};

/** ≥50% xanh, 25–50% cam, dưới 25% đỏ; `null` là "chưa có dữ liệu", không phải đỏ. */
export function meterTone(pct: number | null): MeterTone {
  if (!hasValue(pct)) return 'empty';
  if (pct >= 50) return 'ok';
  if (pct >= 25) return 'warn';
  return 'bad';
}

export interface Bottleneck {
  pct: number | null;
  lowest: QuotaWindow | null;
  others: QuotaWindow[];
}

/**
 * Một nhóm model có thể có hai cửa sổ (5 giờ và tuần). Thanh luôn vẽ cửa sổ
 * thấp hơn vì đó là điểm nghẽn thật; các cửa sổ còn lại chỉ được ghi nhỏ bên cạnh.
 */
export function bottleneck(windows: readonly QuotaWindow[]): Bottleneck {
  const known = windows.filter((row) => hasValue(row.remainingPct));
  if (!known.length) return { pct: null, lowest: null, others: [...windows] };
  const lowest = known.reduce((best, row) => (row.remainingPct! < best.remainingPct! ? row : best), known[0]);
  return { pct: lowest.remainingPct, lowest, others: windows.filter((row) => row !== lowest) };
}

export interface QuotaGroup {
  name: string;
  windows: QuotaWindow[];
}

/** Gộp cửa sổ theo `group` để mỗi nhóm chỉ có một thanh; giữ nguyên thứ tự xuất hiện. */
export function groupQuotaWindows(windows: readonly QuotaWindow[] | undefined | null): QuotaGroup[] {
  const groups = new Map<string, QuotaWindow[]>();
  for (const row of windows ?? []) {
    const bucket = groups.get(row.group);
    if (bucket) bucket.push(row);
    else groups.set(row.group, [row]);
  }
  return [...groups].map(([name, rows]) => ({ name, windows: rows }));
}

/**
 * AGY trả về tiêu đề màn hình in hoa toàn bộ ("CLAUDE AND GPT MODELS").
 * Viết lại dạng câu cho dễ đọc nhưng giữ nguyên các từ viết tắt quen thuộc.
 */
export function formatGroupName(name: string): string {
  if (!/^[A-Z0-9&. ]+$/.test(name.trim())) return name;
  return name.toLowerCase().split(/\s+/).map((word, index) => {
    const upper = word.toUpperCase();
    if (index > 0 && (STOP_WORDS.has(word) || !WORD_STARTS.test(word))) return word;
    return ACRONYMS.has(upper) ? upper : word.charAt(0).toUpperCase() + word.slice(1);
  }).join(' ');
}

const ACRONYMS = new Set(['GPT', 'API', 'AI', 'CLI', 'IDE', 'SDK', 'URL', 'CTX']);
/** Từ nối và danh từ chung: giữ chữ thường khi nằm giữa tên nhóm. */
const STOP_WORDS = new Set(['and', 'or', 'of', 'the', 'for', 'with', 'to', 'in', 'on', 'models']);
/** Chỉ viết hoa các token chữ (không phải chữ số hoặc ký hiệu). */
const WORD_STARTS = /^[a-z]/;

function meterIcon(row: QuotaWindow | null): IconName {
  if (row?.window === 'week' || row?.window === 'month') return 'chart';
  return row?.window === 'plan' ? 'tasks' : 'activity';
}

/** Dòng chữ mờ dưới thanh: số đã dùng, hạn mức và thời điểm làm mới. */
function subText(lowest: QuotaWindow | null, usage: (number | null | undefined)[], rowCount: number, shown: number | null): string {
  if (shown === null) {
    return rowCount > 1 ? `${rowCount} cửa sổ chưa đọc được tỷ lệ còn lại.` : 'Chưa đọc được tỷ lệ còn lại cho nhóm này.';
  }
  const parts: string[] = [];
  if (usage[0] != null && usage[1] != null) {
    parts.push(`Đã dùng ${num(usage[0])} / ${num(usage[1])} ${lowest ? UNIT_LABELS[lowest.unit] : ''}`.trim());
  }
  if (lowest?.resetAt) parts.push(`Làm mới ${lowest.resetAt}`);
  return parts.length ? parts.join(' · ') : 'Chưa ghi nhận thời điểm làm mới.';
}

export interface QuotaMeterProps {
  name: string;
  windows: readonly QuotaWindow[];
}

export function QuotaMeter({ name, windows }: QuotaMeterProps) {
  const rows = [...windows];
  const { pct, lowest, others } = bottleneck(rows);
  const tone = meterTone(pct);
  const shown = pct === null ? null : roundPct(pct);
  const usage = lowest?.unit === 'credits' || lowest?.unit === 'tokens' || lowest?.unit === 'requests'
    ? [lowest.used, lowest.limit]
    : [null, null];

  return (
    <div className="dash-meter" data-group={name}>
      <span className="dash-meter-name">
        <Icon name={meterIcon(lowest)} size={14} />
        {formatGroupName(name)}
      </span>
      <span className="dash-meter-val">
        {shown === null ? (
          <span className="dash-unknown">Chưa có dữ liệu</span>
        ) : (
          <>
            {shown}%
            <small>
              {lowest ? WINDOW_LABELS[lowest.window] : ''}
              {others.length ? ` · ${others.map((row) => `${WINDOW_LABELS[row.window]} ${hasValue(row.remainingPct) ? `${roundPct(row.remainingPct)}%` : 'chưa rõ'}`).join(' · ')}` : ''}
            </small>
          </>
        )}
      </span>
      <div
        className={`dash-bar ${tone}`}
        role={shown === null ? undefined : 'progressbar'}
        aria-valuenow={shown ?? undefined}
        aria-valuemin={shown === null ? undefined : 0}
        aria-valuemax={shown === null ? undefined : 100}
        aria-label={shown === null ? undefined : `${formatGroupName(name)} còn ${shown}%`}
      >
        <span style={shown === null ? undefined : { width: `${Math.max(0, Math.min(100, shown))}%` }} />
      </div>
      <span className="dash-meter-sub">{subText(lowest, usage, rows.length, shown)}</span>
    </div>
  );
}

/** Toàn bộ cửa sổ của một lần kiểm tra, mỗi nhóm một thanh. */
export function QuotaMeters({ windows }: { windows: readonly QuotaWindow[] | undefined | null }) {
  const groups = groupQuotaWindows(windows);
  return (
    <div className="dash-meters">
      {groups.map((group) => <QuotaMeter key={group.name} name={group.name} windows={group.windows} />)}
    </div>
  );
}
