import { useState } from 'react';
import type { DashboardAgent } from '../../../shared/dashboard.js';
import type { RunsLoadState } from '../store.js';
import { useLanguage } from './language.js';
import { agentNames, compact, type DailyTokenBin } from './model.js';

export interface DailyTokenChartProps {
  bins: DailyTokenBin[];
  runsLoadState?: RunsLoadState;
  onRetry?: () => void;
}

function weekdayLabel(bin: DailyTokenBin, lang: 'en' | 'vi'): string {
  const day = new Date(bin.start).getDay();
  const enDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const viDays = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  return lang === 'vi' ? viDays[day]! : enDays[day]!;
}

function formatMonthDay(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function formatFullDate(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export function DailyTokenChart({ bins, runsLoadState, onRetry }: DailyTokenChartProps) {
  const { t, language } = useLanguage();
  const [showTable, setShowTable] = useState(false);
  const [activeDayKey, setActiveDayKey] = useState<string | null>(null);

  const reportedBins = bins.filter((b) => b.totalTokens !== null);
  const total7d = reportedBins.length > 0
    ? reportedBins.reduce((sum, b) => sum + (b.totalTokens ?? 0), 0)
    : null;
  const todayBin = bins.find((b) => b.isToday) ?? bins[bins.length - 1];
  const todayTokens = todayBin?.totalTokens ?? null;
  const totalReportedRuns = bins.reduce((sum, b) => sum + b.reportedRuns, 0);
  const totalUnreportedRuns = bins.reduce((sum, b) => sum + b.unreportedRuns, 0);

  const isLoading = Boolean(runsLoadState && !runsLoadState.loaded && runsLoadState.refreshing);
  const isError = Boolean(runsLoadState && !runsLoadState.loaded && runsLoadState.error);

  const maxTokens = Math.max(...bins.map((b) => b.totalTokens ?? 0), 100);

  return (
    <div className="daily-token-chart" role="region" aria-label={t('Daily token usage', 'Mức dùng token theo ngày')}>
      <div className="token-chart-header">
        <div className="token-chart-summary">
          <div className="token-kpi-main">
            <span className="token-kpi-label">{t('7-day total', 'Tổng 7 ngày')}</span>
            <b className="token-kpi-value tabular-nums">{compact(total7d)}</b>
          </div>
          <div className="token-kpi-sub">
            <span className="token-today-badge">
              {t('Today', 'Hôm nay')}:{' '}
              <b className="tabular-nums">
                {todayTokens !== null ? compact(todayTokens) : t('No data', 'Chưa có')}
              </b>
            </span>
            {todayBin && todayBin.reportedRuns > 0 && (
              <span className="token-today-breakdown tabular-nums">
                ({todayBin.inputTokens.toLocaleString(language)} in / {todayBin.outputTokens.toLocaleString(language)} out)
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          className="btn sm ghost token-view-toggle"
          aria-pressed={showTable}
          onClick={() => setShowTable((prev) => !prev)}
        >
          {showTable ? t('Show chart', 'Xem biểu đồ') : t('View data', 'Xem dữ liệu')}
        </button>
      </div>

      {showTable ? (
        <div className="token-table-wrap">
          <table className="table token-data-table">
            <thead>
              <tr>
                <th scope="col">{t('Date', 'Ngày')}</th>
                <th scope="col">{t('Day', 'Thứ')}</th>
                <th scope="col">{t('Total tokens', 'Tổng token')}</th>
                <th scope="col">{t('Input', 'Input')}</th>
                <th scope="col">{t('Output', 'Output')}</th>
                <th scope="col">{t('Reported runs', 'Lần chạy có báo cáo')}</th>
                <th scope="col">{t('Unreported runs', 'Lần chạy không báo cáo')}</th>
              </tr>
            </thead>
            <tbody>
              {bins.map((bin) => (
                <tr key={bin.dateKey} className={bin.isToday ? 'is-today' : undefined}>
                  <td>{bin.dateKey}{bin.isToday ? ` (${t('Today', 'Hôm nay')})` : ''}</td>
                  <td>{weekdayLabel(bin, language)}</td>
                  <td className="tabular-nums">
                    {bin.totalTokens !== null ? bin.totalTokens.toLocaleString(language) : '—'}
                  </td>
                  <td className="tabular-nums">
                    {bin.input !== null ? bin.input.toLocaleString(language) : '—'}
                  </td>
                  <td className="tabular-nums">
                    {bin.output !== null ? bin.output.toLocaleString(language) : '—'}
                  </td>
                  <td className="tabular-nums">{bin.reportedRuns}</td>
                  <td className="tabular-nums">{bin.unreportedRuns}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : isLoading ? (
        <div className="token-chart-skeleton" role="status" aria-label={t('Loading token history…', 'Đang tải lịch sử token…')}>
          <div className="token-skeleton-bars" aria-hidden="true">
            {Array.from({ length: 7 }, (_, i) => (
              <div key={i} className="token-skeleton-bar" />
            ))}
          </div>
          <p className="minilegend">{t('Loading token history…', 'Đang tải lịch sử token…')}</p>
        </div>
      ) : isError ? (
        <div className="token-chart-error" role="alert">
          <p className="minilegend">{runsLoadState?.error}</p>
          {onRetry && (
            <button type="button" className="btn sm" onClick={onRetry}>
              {t('Retry', 'Thử lại')}
            </button>
          )}
        </div>
      ) : totalReportedRuns === 0 ? (
        <div className="token-chart-empty-wrap">
          <div className="token-axis-row" aria-hidden="true">
            {bins.map((bin) => (
              <div key={bin.dateKey} className={`token-axis-col${bin.isToday ? ' is-today' : ''}`}>
                <div className="token-bar-area">
                  <span className="token-bar-value token-bar-null">—</span>
                  <div className="token-bar-null-tick" />
                </div>
                <div className="token-bar-axis-label">
                  <span className="weekday">{weekdayLabel(bin, language)}</span>
                  <span className="monthday">{formatMonthDay(bin.start)}</span>
                  {bin.isToday && <span className="today-badge">{t('Today', 'Hôm nay')}</span>}
                </div>
              </div>
            ))}
          </div>
          {totalUnreportedRuns === 0 ? (
            <p className="minilegend token-chart-empty">
              {t('No runs in the last 7 days.', 'Chưa có lần chạy trong 7 ngày qua.')}
            </p>
          ) : (
            <p className="minilegend token-chart-unreported">
              {t(
                `${totalUnreportedRuns} runs did not report tokens (CLI only reports plan % / credits).`,
                `${totalUnreportedRuns} lần chạy không báo cáo token (CLI chỉ trả % gói hoặc credit).`,
              )}
            </p>
          )}
        </div>
      ) : (
        <div className="token-chart-body">
          <div className="token-chart-visual">
            <div className="token-y-axis" aria-hidden="true">
              <div className="token-y-level top">
                <span>{compact(maxTokens)}</span>
                <i className="token-grid-line" />
              </div>
              <div className="token-y-level mid">
                <span>{compact(Math.round(maxTokens / 2))}</span>
                <i className="token-grid-line" />
              </div>
              <div className="token-y-level bot">
                <span>0</span>
                <i className="token-grid-line" />
              </div>
            </div>

            <div className="token-bars-track">
              {bins.map((bin) => {
                const isCurrent = activeDayKey === bin.dateKey;
                const hasTokens = bin.totalTokens !== null && bin.totalTokens > 0;
                const isZero = bin.totalTokens === 0;
                const isNull = bin.totalTokens === null;
                const heightPct = hasTokens ? Math.max(4, Math.round((bin.totalTokens! / maxTokens) * 100)) : 0;
                const accessibleLabel = `${formatFullDate(bin.start)}: ${
                  bin.totalTokens !== null ? bin.totalTokens.toLocaleString(language) : t('Not reported', 'Chưa báo cáo')
                } tokens (${bin.inputTokens.toLocaleString(language)} in / ${bin.outputTokens.toLocaleString(language)} out, ${
                  bin.reportedRuns
                } reported, ${bin.unreportedRuns} unreported)`;

                return (
                  <div
                    key={bin.dateKey}
                    className={`token-bar-col${bin.isToday ? ' is-today' : ''}${isCurrent ? ' is-active' : ''}`}
                    role="button"
                    tabIndex={0}
                    aria-label={accessibleLabel}
                    aria-expanded={isCurrent}
                    onMouseEnter={() => setActiveDayKey(bin.dateKey)}
                    onMouseLeave={() => setActiveDayKey((curr) => (curr === bin.dateKey ? null : curr))}
                    onFocus={() => setActiveDayKey(bin.dateKey)}
                    onBlur={() => setActiveDayKey((curr) => (curr === bin.dateKey ? null : curr))}
                    onClick={() => setActiveDayKey(bin.dateKey)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        e.stopPropagation();
                        setActiveDayKey(null);
                      } else if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setActiveDayKey(bin.dateKey);
                      }
                    }}
                  >
                    <div className="token-bar-area">
                      {hasTokens && (
                        <>
                          <span className="token-bar-value tabular-nums">{compact(bin.totalTokens)}</span>
                          <div className="token-bar-fill" style={{ height: `${heightPct}%` }} />
                        </>
                      )}
                      {isZero && (
                        <>
                          <span className="token-bar-value tabular-nums">0</span>
                          <div className="token-bar-zero-tick" />
                        </>
                      )}
                      {isNull && (
                        <>
                          <span className="token-bar-value token-bar-null">—</span>
                          <div className="token-bar-null-tick" />
                        </>
                      )}
                    </div>
                    <div className="token-bar-axis-label" aria-hidden="true">
                      <span className="weekday">{weekdayLabel(bin, language)}</span>
                      <span className="monthday">{formatMonthDay(bin.start)}</span>
                      {bin.isToday && <span className="today-badge">{t('Today', 'Hôm nay')}</span>}
                    </div>

                    {isCurrent && (
                      <div className="token-day-detail" role="tooltip">
                        <div className="token-detail-head">
                          <b>{formatFullDate(bin.start)}</b>
                          {bin.isToday && <span className="today-tag">{t('Today', 'Hôm nay')}</span>}
                        </div>
                        <div className="token-detail-row">
                          <span className="k">{t('Total tokens', 'Tổng token')}:</span>
                          <span className="v tabular-nums">
                            {bin.totalTokens !== null ? bin.totalTokens.toLocaleString(language) : t('Not reported', 'Chưa báo cáo')}
                          </span>
                        </div>
                        <div className="token-detail-row">
                          <span className="k">{t('Input / Output', 'Input / Output')}:</span>
                          <span className="v tabular-nums">
                            {bin.reportedRuns > 0
                              ? `${bin.inputTokens.toLocaleString(language)} in / ${bin.outputTokens.toLocaleString(language)} out`
                              : '—'}
                          </span>
                        </div>
                        <div className="token-detail-row">
                          <span className="k">{t('Runs', 'Lần chạy')}:</span>
                          <span className="v">
                            {bin.reportedRuns} {t('reported', 'có báo cáo')}
                            {bin.unreportedRuns > 0 && ` · ${bin.unreportedRuns} ${t('unreported', 'không báo cáo')}`}
                          </span>
                        </div>
                        {Object.keys(bin.byAgent).length > 0 && (
                          <div className="token-detail-agents">
                            <div className="token-detail-agents-title">{t('By agent', 'Theo agent')}:</div>
                            {Object.entries(bin.byAgent).map(([ag, val]) => (
                              <div key={ag} className="token-detail-agent-row">
                                <span>{agentNames[ag as DashboardAgent] ?? ag}:</span>
                                <span className="tabular-nums">{val?.toLocaleString(language)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {totalUnreportedRuns > 0 && (
            <p className="token-chart-footer-note minilegend">
              {t(
                `${totalReportedRuns} runs reported tokens · ${totalUnreportedRuns} runs did not report tokens`,
                `${totalReportedRuns} lần chạy có báo cáo token · ${totalUnreportedRuns} lần chạy không báo cáo token`,
              )}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
