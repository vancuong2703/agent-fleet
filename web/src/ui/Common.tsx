import type { CSSProperties, ReactNode } from 'react';
import type { DashboardCheck, DashboardTool, QuotaWindow } from '../../../shared/dashboard.js';
import type { AgentId } from '../../../shared/types.js';
import type { AgentStats } from '../api.js';
import { Icon } from '../components/Icon.js';
import { useLanguage } from './language.js';
import { agentNames, clock, duration, known, planLabel, rate, tone, toolHealth } from './model.js';

const logoFiles: Record<AgentId, string | null> = { codex: 'codex', qodercli: 'qoder', agy: 'antigravity', opencode: 'opencode', fake: null };
export function Logo({ agent, small = false }: { agent: AgentId; small?: boolean }) { return <span className={`logo lg-${agent === 'qodercli' ? 'qoder' : agent}${small ? ' xs' : ''}`} aria-hidden="true">{logoFiles[agent] ? <img src={`/agents/${logoFiles[agent]}.svg`} alt="" draggable={false} /> : 'F'}</span>; }
export function Tier({ check }: { check?: DashboardCheck | null }) { const label = planLabel(check); return label ? <span className={`tier ${check?.plan?.tier}`}>{label}</span> : null; }
export function AgentHeader({ tool }: { tool: DashboardTool }) {
  const { t } = useLanguage(); const health = toolHealth(tool);
  const status = !tool.lastCheck ? t('Not checked', 'Chưa kiểm tra') : tool.lastCheck.status === 'ready' ? health === 'warn' ? t('Warning: low quota or exhausted key', 'Cảnh báo: hạn mức thấp hoặc key cạn') : t('Ready', 'Sẵn sàng') : tool.lastCheck.status;
  const prefix = tool.agent === 'codex' ? 'codex-cli' : tool.agent === 'qodercli' ? 'qodercli' : tool.agent === 'agy' ? 'agy' : 'opencode';
  const version = tool.lastCheck?.version;
  return <div className="card-top"><Logo agent={tool.agent} /><div className="card-title"><h3>{agentNames[tool.agent]} <Tier check={tool.lastCheck} /></h3><span className="ver">{version ? version.includes(prefix) ? version : `${prefix} ${version}` : tool.installed ? t('CLI detected', 'Đã tìm thấy CLI') : t('CLI not found', 'Chưa tìm thấy CLI')}</span></div><span className={`dot ${health === 'ok' ? '' : health}`} role="img" aria-label={status} title={status} /></div>;
}
export function Ring({ pct, small = false, label, used = false }: { pct: number | null | undefined; small?: boolean; label: string; used?: boolean }) {
  const precise = known(pct) ? Math.max(0, Math.min(100, pct)) : null;
  // The number inside the ring is a whole percent, never a decimal: "100%" is
  // four glyphs and always fits, while "45.9%" runs over the stroke at both
  // 80 px and 56 px. The arc keeps the precise value; only the label rounds.
  const value = precise === null ? null : Math.round(precise);
  const colour = tone(precise === null ? null : used ? 100 - precise : precise);
  const fillPct = precise === null ? 0 : Math.round(precise * 10) / 10;
  return (
    <div
      className={`donut${small ? ' sm' : ''} ${colour} energy-ring${precise === null ? ' is-empty' : ''}`}
      style={{ '--pct': fillPct, '--col': precise === null ? 'var(--faint)' : `var(--${colour})` } as CSSProperties}
      role="img"
      aria-label={`${label}: ${value === null ? '—' : value + '%'}`}
    >
      <svg viewBox="0 0 44 44" aria-hidden="true">
        <defs>
          <linearGradient id="energy-grad-ok" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10B981" />
            <stop offset="55%" stopColor="#14B8A6" />
            <stop offset="100%" stopColor="#06B6D4" />
          </linearGradient>
          <linearGradient id="energy-grad-warn" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#F97316" />
          </linearGradient>
          <linearGradient id="energy-grad-bad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F43F5E" />
            <stop offset="100%" stopColor="#E11D48" />
          </linearGradient>
        </defs>
        <circle className="edge" cx="22" cy="22" r="21" />
        <circle className="core" cx="22" cy="22" r="11.2" />
        <circle className="trk" cx="22" cy="22" r="15" />
        {precise !== null && <circle className="val" cx="22" cy="22" r="15" pathLength="100" />}
      </svg>
      <span className="pct">{value === null ? '—' : `${value}%`}</span>
    </div>
  );
}
export function Bar({ pct, label, number, reset, used = false }: { pct: number | null | undefined; label: string; number?: string | null; reset?: string | null; used?: boolean }) {
  const precise = known(pct) ? Math.max(0, Math.min(100, pct)) : null;
  const value = precise === null ? null : Math.round(precise);
  const colour = tone(precise === null ? null : used ? 100 - precise : precise);
  const parsedReset = reset ? Date.parse(reset) : NaN;
  const resetLabel = Number.isFinite(parsedReset) ? new Date(parsedReset).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }) : reset;
  return <div className={`gbar ${colour}`} style={{ '--pct': precise === null ? 0 : Math.round(precise * 10) / 10, '--col': precise === null ? 'var(--faint)' : `var(--${colour})` } as CSSProperties}>
    <span className="g-cap">{label}</span>
    <span className="pct">{value === null ? '—' : `${value}%`}</span>
    <span className="meter" aria-hidden="true"><i /><b className="energy-cells" /></span>
    {number && <span className="g-num">{number}</span>}
    {reset && <span className="g-reset" title={reset}>↻ {resetLabel}</span>}
  </div>;
}
export function Gauge({ row, pct, label, number, reset, used = false }: { row?: QuotaWindow; pct?: number | null; label?: string; number?: string | null; reset?: string | null; used?: boolean }) {
  const { t } = useLanguage(); const windowLabels: Record<string, string> = { '5h': t('5 hours', '5 giờ'), week: t('Week', 'Tuần'), day: t('Day', 'Ngày'), month: t('Month', 'Tháng') };
  // A quota row carries its own unit: when the number is a "used" percentage a
  // token allowance reads "tokens used"; when it is the remaining headroom it
  // reads "tokens left". Never call a token allowance "credits".
  const unitLabel = row?.unit === 'tokens' ? (used ? t('Tokens used', 'Token đã dùng') : t('Tokens left', 'Token còn lại')) : row?.unit === 'credits' ? (used ? t('Credits used', 'Credit đã dùng') : t('Credits left', 'Credit còn lại')) : undefined;
  const caption = label ?? unitLabel ?? (row ? windowLabels[row.window] ?? row.window : '—');
  const rawReset = row?.resetAt ?? reset;
  const parsedReset = rawReset ? Date.parse(rawReset) : NaN;
  const resetLabel = Number.isFinite(parsedReset) ? new Date(parsedReset).toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' }) : rawReset;
  return <div className="gauge"><Ring pct={pct ?? row?.remainingPct ?? null} used={used} label={caption} /><span className="g-cap">{caption}</span>{number && <span className="g-num">{number}</span>}{rawReset && <span className="g-reset" title={rawReset}>↻ {resetLabel}</span>}</div>;
}
export function Meter({ pct }: { pct: number | null | undefined }) { return <div className={`bar energy-bar ${tone(pct)}`} role={known(pct) ? 'progressbar' : undefined} aria-label="Remaining" aria-valuemin={known(pct) ? 0 : undefined} aria-valuemax={known(pct) ? 100 : undefined} aria-valuenow={known(pct) ? Math.max(0, Math.min(100, pct)) : undefined}><span style={{ width: known(pct) ? `${Math.max(0, Math.min(100, pct))}%` : '0%' }} /><i className="energy-cells" aria-hidden="true" /></div>; }
export function Stats({ stats, dashboard = false }: { stats?: AgentStats; dashboard?: boolean }) { const { t } = useLanguage(); return <div className="stats"><div className="stat"><span className="k">{t('Avg time', 'Thời gian TB')}</span><span className="v">{duration(stats?.avgDurationMs)}</span></div><div className="stat"><span className="k">{t('Success', 'Thành công')}</span><span className="v">{rate(stats?.successRate)}</span></div><div className="stat"><span className="k">{dashboard ? t('Tasks 7d', 'Việc 7 ngày') : t('Tasks', 'Công việc')}</span><span className="v">{stats?.runs ?? '—'}</span></div></div>; }
export function PageHead({ title, accent, eyebrow, actions, large, label }: { title?: string; accent?: string; eyebrow: string; actions?: ReactNode; large?: boolean; label?: string }) {
  const heading = label || `${title ?? ''}${accent ?? ''}`;
  return <header className="head"><div><div className="eyebrow">{eyebrow}</div><h1 className="title">{heading}</h1></div>{actions && <div className="actions">{actions}</div>}</header>;
}
export function PeriodPicker({ days, onChange }: { days: number; onChange: (value: number) => void }) { const { t } = useLanguage(); return <div className="filters" role="group" aria-label={t('Time window', 'Khoảng thời gian')}>{[7, 30].map(value => <button className="chip" key={value} aria-pressed={days === value} onClick={() => onChange(value)}>{value} {t('days', 'ngày')}</button>)}</div>; }
export function Legend() { const { t } = useLanguage(); return <p className="legend"><span><i className="dot" />{t('OK', 'Ổn')}</span><span><i className="dot warn" />{t('Warning: low headroom or an expired key', 'Cảnh báo: hạn mức thấp hoặc key cạn')}</span><span><i className="dot bad" />{t('Failed', 'Lỗi')}</span></p>; }
export function Notice({ message, error = false, onRetry }: { message: string; error?: boolean; onRetry?: () => void }) { const { t } = useLanguage(); return <div className={`notice${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}><Icon name="info" size={16} /><span className="txt">{message}</span>{onRetry && <button className="btn" onClick={onRetry}>{t('Retry', 'Thử lại')}</button>}</div>; }
export function CheckTime({ tool }: { tool: DashboardTool }) { const { t } = useLanguage(); return <span className="when">{tool.lastCheck ? `${t('check', 'kiểm tra')} ${clock(tool.lastCheck.checkedAt)}` : t('Not checked yet', 'Chưa kiểm tra')}</span>; }
