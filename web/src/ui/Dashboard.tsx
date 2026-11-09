import { useEffect, useMemo, useRef, useState } from 'react';
import type { DashboardAgent, DashboardTool, KeyPool } from '../../../shared/dashboard.js';
import type { Plan, Run, Task } from '../../../shared/types.js';
import type { CliWorkspace } from '../cli-workspace.js';
import type { RunsLoadState } from '../store.js';
import { Icon } from '../components/Icon.js';
import { formatGroupName, sortOffers, formatContext, buildDailyTokenSeries } from './model.js';
import { DailyTokenChart } from './DailyTokenChart.js';
import { AgentHeader, CheckTime, Gauge, Legend, Meter, Notice, PageHead, Ring, Stats } from './Common.js';
import { useLanguage } from './language.js';
import { agentNames, clock, compact, creditWindow, known, quotaRows, toolHealth, useStats } from './model.js';

export function ToolQuota({ tool, expanded = false }: { tool: DashboardTool; expanded?: boolean }) {
  const { t, language } = useLanguage(); const check = tool.lastCheck; const rows = quotaRows(check);
  if (!check) return <div className="tool-empty">{t('Not checked yet. Check reads the CLI on this machine.', 'Chưa kiểm tra. Nhấn Kiểm tra để đọc CLI trên máy.')}</div>;
  if (check.status === 'error') return <Notice message={check.probes.find(probe => !probe.ok)?.summary ?? t('The last check failed.', 'Lần kiểm tra trước bị lỗi.')} error />;
  if (tool.agent === 'agy' && rows.length) {
    const groups = [...new Set(rows.map(row => row.group))];
    return <table className="mtx" aria-label={t('Quota by model', 'Hạn mức theo model')}><thead><tr><th /><th>{t('5 hours', '5 giờ')}</th><th>{t('Week', 'Tuần')}</th></tr></thead><tbody>{groups.map(group => <tr key={group}><td>{formatGroupName(group).replace(' and ', ' & ').replace(/ models$/i, '')}</td>{(['5h', 'week'] as const).map(window => { const row = rows.find(row => row.group === group && row.window === window); return <td key={window} title={row?.resetAt ?? undefined}><Ring pct={row?.remainingPct} small label={`${group} · ${window}${row?.resetAt ? ` · ↻ ${row.resetAt}` : ''}`} /></td>; })}</tr>)}</tbody></table>;
  }
  if (tool.agent === 'qodercli') {
    const window = creditWindow(check); const credit = check.credits.remaining;
    return <div><div className="g-cap credit-caption">{t('Credits remaining', 'Credit còn lại')}</div><div className="credit"><b>{known(credit) ? credit.toLocaleString(language) : '—'}</b>{known(window?.limit) && <small>/ {window.limit.toLocaleString(language)}</small>}</div><Meter pct={window?.remainingPct ?? (rows.length === 1 ? rows[0]?.remainingPct : null)} /><div className="creditline"><span>{known(window?.used) ? `${window.used.toLocaleString(language)} ${t('used', 'đã dùng')}` : t('Provider-reported credits', 'Credit do CLI báo cáo')}</span>{window?.resetAt && <span title={window.resetAt}>↻ {window.resetAt}</span>}</div>{expanded && rows.length > 1 && rows.map(row => <div className="credit-sub" key={row.group}><span>{row.group} · {row.remainingPct ?? '—'}%</span><Meter pct={row.remainingPct} /></div>)}</div>;
  }
  if (tool.agent === 'opencode' && !rows.length) {
    const pools = check.keyPools ?? [];
    return <div className="pool-overview">{pools.length ? pools.map(pool => <div key={pool.name}><div className="creditline"><strong>{pool.name}</strong><span>{known(pool.remainingPct) ? `${+pool.remainingPct.toFixed(1)}%` : '—'}</span></div><Meter pct={pool.remainingPct} /><div className="creditline"><span>{known(pool.remainingPct) ? `${pool.ok}/${pool.total} ${t('keys', 'key')}` : t('No pool data', 'Chưa có dữ liệu pool')}</span>{pool.resetAt && <span>↻ {pool.resetAt}</span>}</div></div>) : <p className="tool-empty">{check.quota.reason ?? t('No pool data. Run a check to read the local pool.', 'Chưa có dữ liệu pool. Nhấn Kiểm tra để đọc pool cục bộ.')}</p>}</div>;
  }
  return <div className="gauges">{rows.length ? rows.map(row => { const tokens = row.unit === 'tokens' && known(row.used) && known(row.limit) && row.limit > 0; return <Gauge key={`${row.group}/${row.window}`} row={row} used={tokens} pct={tokens ? row.used! / row.limit! * 100 : row.remainingPct} number={tokens ? `${compact(row.used)} / ${compact(row.limit)}` : null} />; }) : <div className="tool-empty">{check.quota.reason ?? t('Quota not reported by this CLI.', 'CLI chưa cung cấp hạn mức.')}</div>}</div>;
}

type Translate = (en: string, vi: string) => string;
const windowLabels: Record<string, [string, string]> = { '5h': ['5-hour', '5 giờ'], day: ['daily', 'ngày'], week: ['weekly', 'tuần'], month: ['monthly', 'tháng'], plan: ['plan', 'gói'] };
const poolScore = (pool: KeyPool) => known(pool.remainingPct) ? pool.remainingPct : pool.exhausted > 0 ? 0 : 101;
/** Compact names for the attention rows, where the long title would wrap. */
const shortNames: Record<string, string> = { codex: 'Codex', qodercli: 'Qoder', agy: 'AGY', opencode: 'OpenCode', fake: 'Test' };
/** One short, data-backed sentence for the "Needs attention" row. */
function attention(tool: DashboardTool, t: Translate): string {
  const generic = t('Low quota or exhausted pool key', 'Hạn mức thấp hoặc key trong pool cạn'); const check = tool.lastCheck;
  if (!check) return generic;
  if (check.status === 'needs-login') return t('Sign-in needed', 'Cần đăng nhập');
  if (check.status === 'error') return check.probes.find(probe => !probe.ok)?.summary ?? t('The last check failed', 'Lần kiểm tra trước bị lỗi');
  const rows = quotaRows(check).filter(row => known(row.remainingPct));
  const row = rows.length ? rows.reduce((worst, item) => item.remainingPct! < worst.remainingPct! ? item : worst) : null;
  if (row) {
    const pct = Math.round(row.remainingPct!); const [en, vi] = windowLabels[row.window] ?? [row.window, row.window];
    if (pct <= 0) {
      if (row.unit === 'credits') return t('Credit exhausted', 'Credit đã cạn');
      if (row.unit === 'tokens') return t('Token quota exhausted', 'Hết hạn mức token');
      return t(`${en} exhausted`, `Hết hạn mức ${vi}`);
    }
    if (pct < 20) {
      if (row.unit === 'credits') return t(`Credit ${pct}% left`, `Credit còn ${pct}%`);
      if (row.unit === 'tokens') return t(`Token ${100 - pct}% used`, `Đã dùng ${100 - pct}% token`);
      return t(`${en} ${pct}% left`, `${vi} còn ${pct}%`);
    }
  }
  const pools = check.keyPools ?? [];
  if (pools.length) {
    const worst = pools.reduce((best, pool) => poolScore(pool) < poolScore(best) ? pool : best);
    if ((known(worst.remainingPct) && worst.remainingPct <= 0) || (worst.ok === 0 && worst.total > 0)) return t('Pool exhausted', 'Hết key pool');
    if (worst.exhausted > 0 || (known(worst.remainingPct) && worst.remainingPct < 20)) return t(`Pool ${worst.ok}/${worst.total} keys`, `Pool còn ${worst.ok}/${worst.total} key`);
  }
  return generic;
}

export function ModelRows({ tool, limit = 2 }: { tool: DashboardTool; limit?: number }) {
  const { t } = useLanguage(); const offers = sortOffers(tool.lastCheck?.models ?? []).slice(0, limit);
  return offers.length ? <div className="models">{offers.map(offer => <div className="m" key={offer.id}><span className="mn" title={offer.id}>{offer.label}</span>{limit > 3 && <span className="tk model-meta">{formatContext(offer.contextTokens)}{offer.source === 'catalog' && <small>{t('Catalog price', 'Giá catalog')}</small>}{offer.promo && <small>{offer.promo}</small>}{known(offer.originalMultiplier) && offer.originalMultiplier !== offer.multiplier && <small><s>x{offer.originalMultiplier}</s></small>}</span>}<span className={`mult${offer.multiplier === 0 ? ' free' : ''}`}>{!known(offer.multiplier) ? '—' : offer.multiplier === 0 ? t('FREE', 'MIỄN PHÍ') : `x${offer.multiplier}`}</span></div>)}</div> : null;
}

export type DashboardCardId =
  | 'cli:codex'
  | 'cli:qodercli'
  | 'cli:agy'
  | 'cli:opencode'
  | 'tokens'
  | 'jobs'
  | 'attention';

export interface DashboardProps {
  visible?: boolean;
  cli: CliWorkspace;
  tasks: Task[];
  plans: Plan[];
  runsByTask: Record<string, Run[]>;
  runsLoadState?: RunsLoadState;
  onRetryRuns?: () => void;
  onDetails: (agent: DashboardAgent) => void;
  onTask: (id: string) => void;
}

export function Dashboard({
  visible = true,
  cli,
  tasks,
  plans,
  runsByTask,
  runsLoadState,
  onRetryRuns,
  onDetails,
  onTask,
}: DashboardProps) {
  const { t } = useLanguage(); const stats = useStats(7, '', visible); const tools = cli.snapshot?.tools ?? [];
  const checks = tools.map((tool) => tool.lastCheck?.checkedAt).filter(known);
  const today = new Date().setHours(0, 0, 0, 0);
  const todayTasks = tasks.filter(task => task.createdAt >= today);
  const allRuns = useMemo(() => Object.values(runsByTask).flat(), [runsByTask]);
  const dailyBins = useMemo(() => buildDailyTokenSeries(allRuns, 7), [allRuns]);

  const warnings = tools.filter(tool => ['warn', 'bad'].includes(toolHealth(tool)));
  const todaySegs = (['running', 'done', 'queued', 'failed', 'merged', 'interrupted'] as const).map(status => ({ status, count: todayTasks.filter(task => task.status === status).length }));
  const todayLegend = [{ status: 'running', label: t('running', 'đang chạy') }, { status: 'done', label: t('review', 'chờ duyệt') }, { status: 'failed', label: t('failed', 'lỗi') }].map(item => ({ count: todaySegs.find(seg => seg.status === item.status)!.count, label: item.label })).filter(item => item.count > 0);
  const todayCaption = !todayTasks.length ? t('No jobs today yet', 'Chưa có việc nào hôm nay') : todayLegend.length ? todayLegend.map(item => `${item.count} ${item.label}`).join(' · ') : `${todayTasks.length} ${t('jobs', 'việc')}`;
  const [focusedCardId, setFocusedCardId] = useState<DashboardCardId | null>(null);
  const focusBtnRefs = useRef<Partial<Record<DashboardCardId, HTMLButtonElement | null>>>({});
  const pointerDownOnFocusBtnRef = useRef(false);

  useEffect(() => {
    if (!visible) setFocusedCardId(null);
  }, [visible]);

  useEffect(() => {
    if (!focusedCardId || !visible) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (document.querySelector('[role="dialog"], .modal, .palette, .drawer-scrim, .token-day-detail')) return;
      const prevId = focusedCardId;
      setFocusedCardId(null);
      focusBtnRefs.current[prevId]?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [focusedCardId, visible]);

  const handleCardClick = (cardId: DashboardCardId, e: React.MouseEvent) => {
    const target = e.target as HTMLElement | null;
    const isInteractive = Boolean(
      target?.closest('button, a, input, select, textarea, summary, [role="button"], [role="tab"], [data-no-card-focus]'),
    );
    if (!isInteractive) {
      setFocusedCardId((curr) => (curr === cardId ? null : cardId));
    } else if (focusedCardId !== null && focusedCardId !== cardId) {
      setFocusedCardId(cardId);
    }
  };

  const handlePageClick = (e: React.MouseEvent) => {
    if (focusedCardId === null) return;
    const target = e.target as HTMLElement | null;
    if (!target) return;
    if (target.closest('[data-card-id]') || target.closest('.head')) return;
    setFocusedCardId(null);
  };

  return <div className="wrap dashboard-page" data-page="dashboard" onClick={handlePageClick}>
    <PageHead title="DASH" accent="BOARD" large label={t('Dashboard', 'Bảng điều khiển')} eyebrow={t('AI workspace', 'Không gian làm việc AI')} actions={<><span className="stamp">{checks.length ? clock(Math.max(...checks)) : '—'}</span><button className={`check-all${cli.checkingAll.active ? ' is-checking' : ''}`} aria-busy={cli.checkingAll.active || undefined} disabled={!tools.length || Boolean(cli.checking) || cli.checkingAll.active} onClick={() => void cli.checkAll()}><svg className="check-pill-beam" aria-hidden="true"><rect pathLength={100} /></svg><span className={cli.checkingAll.active ? 'spin' : ''}><Icon name="refresh" size={16} /></span><span>{cli.checkingAll.active ? `${t('Checking', 'Đang kiểm tra')} ${cli.checkingAll.done}/${cli.checkingAll.total}` : t('Check all', 'Kiểm tra tất cả')}</span></button></>} />
    {cli.message && <Notice message={cli.message} error={cli.messageKind === 'error'} onRetry={cli.messageKind === 'error' ? () => void cli.checkAll() : undefined} />}
    {stats.error && <Notice message={stats.error} error onRetry={stats.retry} />}
    <div className="zones">
      {tools.map((tool) => {
        const cardId = `cli:${tool.agent}` as DashboardCardId;
        const cardLabel = tool.title || agentNames[tool.agent] || tool.agent;
        const isFocused = focusedCardId === cardId;
        const isDimmed = focusedCardId !== null && !isFocused;
        const last = [...tasks].reverse().find((task) => task.agent === tool.agent);
        return (
          <article
            className={`card${isFocused ? ' is-focused' : ''}${isDimmed ? ' is-dimmed' : ''}`}
            data-card-id={cardId}
            data-tool={tool.agent}
            key={tool.agent}
            aria-busy={cli.checking === tool.agent || undefined}
            onFocusCapture={() => {
              if (pointerDownOnFocusBtnRef.current) return;
              if (focusedCardId !== null && focusedCardId !== cardId) setFocusedCardId(cardId);
            }}
            onClick={(e) => handleCardClick(cardId, e)}
          >
            <div className="card-head-row">
              <AgentHeader tool={tool} />
              <button
                ref={(el) => {
                  focusBtnRefs.current[cardId] = el;
                }}
                type="button"
                className={`card-focus-btn${isFocused ? ' active' : ''}`}
                aria-pressed={isFocused}
                aria-label={isFocused ? `${t('Unfocus', 'Bỏ tập trung')} ${cardLabel}` : `${t('Focus', 'Tập trung')} ${cardLabel}`}
                onPointerDown={() => {
                  pointerDownOnFocusBtnRef.current = true;
                }}
                onClick={(e) => {
                  pointerDownOnFocusBtnRef.current = false;
                  e.stopPropagation();
                  setFocusedCardId((curr) => (curr === cardId ? null : cardId));
                }}
              >
                {isFocused ? t('Unfocus', 'Bỏ tập trung') : t('Focus', 'Tập trung')}
              </button>
            </div>
            <div className="statusline" title={tool.lastCheck?.currentModel?.id ?? tool.lastCheck?.plan?.name}>
              {tool.lastCheck?.currentModel?.label
                ? `${tool.lastCheck.currentModel.label}${tool.lastCheck.currentModel.effort ? ` · effort ${tool.lastCheck.currentModel.effort}` : ''}`
                : tool.agent === 'qodercli'
                  ? (tool.lastCheck?.plan?.name ?? t('Credit-based CLI', 'CLI tính theo credit'))
                  : tool.agent === 'agy'
                    ? t('Multi-model quota matrix', 'Ma trận hạn mức đa model')
                    : tool.agent === 'opencode'
                      ? ((tool.lastCheck?.keyPools?.length ?? 0) > 0
                          ? `${tool.lastCheck!.keyPools!.length} ${t('key pool configured', 'key pool đã cấu hình')}`
                          : t('BYOK multi-provider CLI', 'CLI đa nguồn BYOK'))
                      : t('Model not reported', 'Chưa đọc được model')}
            </div>
            <ToolQuota tool={tool} />
            {(tool.agent === 'qodercli' || tool.agent === 'opencode') && <ModelRows tool={tool} />}
            <Stats stats={stats.loaded && !stats.error ? stats.rows.find((row) => row.agent === tool.agent) : undefined} dashboard />
            <button className="lastjob" disabled={!last} onClick={() => last && onTask(last.id)}>
              <span className="lj-head">
                <span className="lj-k">{t('Last job', 'Công việc gần nhất')}</span>
                <span className={`lj-s ${last?.status === 'failed' ? 'bad' : 'ok'}`}>{last?.status ?? '—'}</span>
              </span>
              <span className="lj-t" title={last?.title}>
                {last ? <><b>{last.id}</b> {last.title}</> : t('No jobs yet', 'Chưa có công việc')}
              </span>
            </button>
            <footer className="foot">
              <CheckTime tool={tool} />
              <button
                className={`btn${cli.checking === tool.agent ? ' is-checking' : ''}`}
                aria-busy={cli.checking === tool.agent || undefined}
                disabled={Boolean(cli.checking)}
                onClick={() => void cli.check(tool.agent)}
                aria-label={`${t('Check', 'Kiểm tra')} ${tool.title}`}
              >
                <svg className="check-pill-beam" aria-hidden="true">
                  <rect pathLength={100} />
                </svg>
                <span className={cli.checking === tool.agent ? 'spin' : ''}>
                  <Icon name="refresh" size={14} />
                </span>
                {cli.checking === tool.agent ? t('Checking…', 'Đang kiểm tra…') : t('Check', 'Kiểm tra')}
              </button>
              <button className="btn ghost" onClick={() => onDetails(tool.agent)}>
                {t('Details', 'Chi tiết')} →
              </button>
            </footer>
          </article>
        );
      })}
      {!cli.snapshot && [0, 1, 2, 3].map(index => <article className="card skeleton-card" key={index}><div /><div /><div /></article>)}
    </div>
    <div className="row3">
      <section
        className={`panel${focusedCardId === 'tokens' ? ' is-focused' : ''}${focusedCardId !== null && focusedCardId !== 'tokens' ? ' is-dimmed' : ''}`}
        data-card-id="tokens"
        onFocusCapture={() => {
          if (pointerDownOnFocusBtnRef.current) return;
          if (focusedCardId !== null && focusedCardId !== 'tokens') setFocusedCardId('tokens');
        }}
        onClick={(e) => handleCardClick('tokens', e)}
      >
        <div className="panel-head-row">
          <h4>
            {t('Tokens per day', 'Token theo ngày')}
            <span className="spacer">{t('Last 7 days', '7 ngày gần nhất')}</span>
          </h4>
          <button
            ref={(el) => {
              focusBtnRefs.current['tokens'] = el;
            }}
            type="button"
            className={`card-focus-btn${focusedCardId === 'tokens' ? ' active' : ''}`}
            aria-pressed={focusedCardId === 'tokens'}
            aria-label={
              focusedCardId === 'tokens'
                ? `${t('Unfocus', 'Bỏ tập trung')} ${t('Tokens per day', 'Token theo ngày')}`
                : `${t('Focus', 'Tập trung')} ${t('Tokens per day', 'Token theo ngày')}`
            }
            onPointerDown={() => {
              pointerDownOnFocusBtnRef.current = true;
            }}
            onClick={(e) => {
              pointerDownOnFocusBtnRef.current = false;
              e.stopPropagation();
              setFocusedCardId((curr) => (curr === 'tokens' ? null : 'tokens'));
            }}
          >
            {focusedCardId === 'tokens' ? t('Unfocus', 'Bỏ tập trung') : t('Focus', 'Tập trung')}
          </button>
        </div>
        <DailyTokenChart bins={dailyBins} runsLoadState={runsLoadState} onRetry={onRetryRuns} />
      </section>
      <section
        className={`panel${focusedCardId === 'jobs' ? ' is-focused' : ''}${focusedCardId !== null && focusedCardId !== 'jobs' ? ' is-dimmed' : ''}`}
        data-card-id="jobs"
        onFocusCapture={() => {
          if (pointerDownOnFocusBtnRef.current) return;
          if (focusedCardId !== null && focusedCardId !== 'jobs') setFocusedCardId('jobs');
        }}
        onClick={(e) => handleCardClick('jobs', e)}
      >
        <div className="panel-head-row">
          <h4>
            {t('Jobs today', 'Công việc hôm nay')}
            <span className="spacer">{plans.length} {t('projects', 'dự án')}</span>
          </h4>
          <button
            ref={(el) => {
              focusBtnRefs.current['jobs'] = el;
            }}
            type="button"
            className={`card-focus-btn${focusedCardId === 'jobs' ? ' active' : ''}`}
            aria-pressed={focusedCardId === 'jobs'}
            aria-label={
              focusedCardId === 'jobs'
                ? `${t('Unfocus', 'Bỏ tập trung')} ${t('Jobs today', 'Công việc hôm nay')}`
                : `${t('Focus', 'Tập trung')} ${t('Jobs today', 'Công việc hôm nay')}`
            }
            onPointerDown={() => {
              pointerDownOnFocusBtnRef.current = true;
            }}
            onClick={(e) => {
              pointerDownOnFocusBtnRef.current = false;
              e.stopPropagation();
              setFocusedCardId((curr) => (curr === 'jobs' ? null : 'jobs'));
            }}
          >
            {focusedCardId === 'jobs' ? t('Unfocus', 'Bỏ tập trung') : t('Focus', 'Tập trung')}
          </button>
        </div>
        <div className="kpi">
          <b>{todayTasks.length}</b>
          <small>{t('run today', 'việc hôm nay')}</small>
        </div>
        <div className="stackbar">
          {todaySegs.map((seg) => {
            const segTone =
              seg.count > 0 && seg.status === 'failed'
                ? 'bad'
                : seg.count > 0 && (seg.status === 'running' || seg.status === 'merged')
                ? 'ok'
                : 'plain';
            return (
              <span
                className={`sg ${segTone}`}
                key={seg.status}
                style={{ flex: todayTasks.length === 0 ? 1 : Math.max(1, seg.count) }}
                title={`${seg.count} ${seg.status}`}
              />
            );
          })}
        </div>
        <p className="minilegend">{todayCaption}</p>
      </section>

      <section
        className={`panel${focusedCardId === 'attention' ? ' is-focused' : ''}${focusedCardId !== null && focusedCardId !== 'attention' ? ' is-dimmed' : ''}`}
        data-card-id="attention"
        onFocusCapture={() => {
          if (pointerDownOnFocusBtnRef.current) return;
          if (focusedCardId !== null && focusedCardId !== 'attention') setFocusedCardId('attention');
        }}
        onClick={(e) => handleCardClick('attention', e)}
      >
        <div className="panel-head-row">
          <h4>
            {t('Needs attention', 'Cần chú ý')}
            <span className="spacer">{warnings.length}</span>
          </h4>
          <button
            ref={(el) => {
              focusBtnRefs.current['attention'] = el;
            }}
            type="button"
            className={`card-focus-btn${focusedCardId === 'attention' ? ' active' : ''}`}
            aria-pressed={focusedCardId === 'attention'}
            aria-label={
              focusedCardId === 'attention'
                ? `${t('Unfocus', 'Bỏ tập trung')} ${t('Needs attention', 'Cần chú ý')}`
                : `${t('Focus', 'Tập trung')} ${t('Needs attention', 'Cần chú ý')}`
            }
            onPointerDown={() => {
              pointerDownOnFocusBtnRef.current = true;
            }}
            onClick={(e) => {
              pointerDownOnFocusBtnRef.current = false;
              e.stopPropagation();
              setFocusedCardId((curr) => (curr === 'attention' ? null : 'attention'));
            }}
          >
            {focusedCardId === 'attention' ? t('Unfocus', 'Bỏ tập trung') : t('Focus', 'Tập trung')}
          </button>
        </div>
        <ul className="attn">
          {warnings.map((tool) => (
            <li key={tool.agent}>
              <i className={`dot ${toolHealth(tool)}`} />
              <span className="at-t">
                <b>{shortNames[tool.agent] ?? tool.title}</b> · {attention(tool, t)}
              </span>
              <button className="attn-open" onClick={() => onDetails(tool.agent)}>
                {t('Open', 'Mở')}
              </button>
            </li>
          ))}
        </ul>
        {!warnings.length && (
          <p className="minilegend">{t('No warnings in the latest checks.', 'Chưa có cảnh báo trong lần kiểm tra gần nhất.')}</p>
        )}
      </section></div>
    <div className="noterow"><p className="tablenote">{t('Each card is one tool zone. The dot shows the latest quota and key health.', 'Mỗi thẻ là một công cụ. Chấm trạng thái theo lần kiểm tra hạn mức và key gần nhất.')}</p><Legend /></div>
  </div>;
}
