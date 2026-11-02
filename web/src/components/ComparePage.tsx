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

  const repos = useMemo(() => repoOptions(plans), [plans]);

  useEffect(() => {
    let cancelled = false;
    const sinceDays = period === 0 ? undefined : period;
    Promise.all([
      api.agents(),
      api.stats({ repo: repo.length > 0 ? repo : undefined, sinceDays }),
    ])
      .then(([agentList, statList]) => {
        if (cancelled) return;
        setAgents(agentList);
        setStats(statList);
        setError(null);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [repo, period]);

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
        <div className="banner banner-error">Không tải được số liệu: {error}</div>
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
                Chưa có agent nào.
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