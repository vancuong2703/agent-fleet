import { useEffect, useMemo, useState } from 'react';

import type { Plan } from '../../../shared/types.js';
import { api, type AgentInfo, type AgentStats } from '../api.js';
import {
  EMPTY_VALUE,
  buildCompareRows,
  formatCostUsd,
  formatDurationMs,
  formatRate,
  repoOptions,
} from '../compare.js';

const PERIODS = [
  { value: 7, label: '7 ngày' },
  { value: 30, label: '30 ngày' },
  { value: 0, label: 'Tất cả' },
] as const;

type Period = (typeof PERIODS)[number]['value'];

export interface ComparePageProps {
  plans: Plan[];
}

/**
 * Agent comparison table. Fetches `/api/agents` and `/api/stats` for the
 * selected repo and period, then renders one row per agent. Agents that are
 * not installed stay visible, greyed, with the reason the server reported.
 */
export function ComparePage({ plans }: ComparePageProps) {
  const [repo, setRepo] = useState('');
  const [period, setPeriod] = useState<Period>(7);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [stats, setStats] = useState<AgentStats[]>([]);
  const [error, setError] = useState<string | null>(null);
  // Agent detection runs each CLI's --version, so the first load can take a few seconds.
  const [loaded, setLoaded] = useState(false);
  // Bumped by the retry button; the polling timer alone cannot rescue a failed first read.
  const [attempt, setAttempt] = useState(0);

  const repos = useMemo(() => repoOptions(plans), [plans]);

  useEffect(() => {
    let cancelled = false;
    void api.agents().then((list) => { if (!cancelled) setAgents(list); }).catch(() => {});
    return () => { cancelled = true; };
  // Retry re-reads the agent list as well: a failed first sweep must not leave the table empty.
  }, [attempt]);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const sinceDays = period === 0 ? undefined : period;
    const refresh = () => {
      void api.stats({ repo: repo.length > 0 ? repo : undefined, sinceDays })
      .then((statList) => {
        if (cancelled) return;
        setStats(statList);
        setError(null);
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // Keep the error: the table must not sit on "Đang tải..." forever.
        setError(cause instanceof Error ? cause.message : String(cause));
        setLoaded(false);
      }).finally(() => { if (!cancelled) timer = window.setTimeout(refresh, document.hidden ? 15_000 : 5_000); });
    };
    refresh();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [repo, period, attempt]);

  const retry = (): void => {
    setError(null);
    setLoaded(false);
    setAttempt((value) => value + 1);
  };

  const rows = useMemo(() => buildCompareRows(agents, stats), [agents, stats]);

  return (
    <div className="compare-page">
      <h2>So sánh agent</h2>

      <div className="compare-filters">
        <label className="compare-filter">
          <span>Repo</span>
          <select value={repo} onChange={(event) => setRepo(event.target.value)}>
            <option value="">Tất cả repo</option>
            {repos.map((path) => (
              <option key={path} value={path}>
                {path}
              </option>
            ))}
          </select>
        </label>
        <label className="compare-filter">
          <span>Thời gian</span>
          <select
            value={period}
            onChange={(event) => setPeriod(Number(event.target.value) as Period)}
          >
            {PERIODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error !== null && (
        <div className="banner banner-error" role="alert">
          Không tải được số liệu: {error}
          <button type="button" className="banner-retry" onClick={retry}>Thử lại</button>
        </div>
      )}

      <table className="compare-table">
        <thead>
          <tr>
            <th>Agent</th>
            <th>Số lần chạy</th>
            <th>Tỉ lệ thành công</th>
            <th>Thời gian TB</th>
            <th>Phải làm lại</th>
            <th>Được merge</th>
            <th>Chi phí</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="compare-empty" colSpan={7}>
                {error !== null ? 'Không tải được số liệu.' : loaded ? 'Chưa có agent nào.' : 'Đang tải…'}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const rowStats = row.stats;
              return (
                <tr
                  key={row.agent}
                  className={`compare-row${row.ok ? '' : ' compare-row-off'}`}
                >
                  <td>
                    <span className="compare-agent">{row.agent}</span>
                    {row.ok ? (
                      row.version !== undefined ? (
                        <span className="compare-meta">{row.version}</span>
                      ) : null
                    ) : (
                      <span className="compare-meta">{row.reason ?? 'chưa cài'}</span>
                    )}
                  </td>
                  <td>{rowStats !== null ? rowStats.runs : EMPTY_VALUE}</td>
                  <td>{formatRate(rowStats?.successRate ?? null)}</td>
                  <td>{formatDurationMs(rowStats?.avgDurationMs ?? null)}</td>
                  <td>{formatRate(rowStats?.retryRate ?? null)}</td>
                  <td>{formatRate(rowStats?.mergeRate ?? null)}</td>
                  <td>{formatCostUsd(rowStats?.costUsd ?? null)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      <p className="compare-note">Lỗi quota và đăng nhập không tính vào tỉ lệ thất bại.</p>
    </div>
  );
}
