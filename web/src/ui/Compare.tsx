import { useMemo, useState } from 'react';
import type { DashboardAgent, DashboardCheck, DashboardTool } from '../../../shared/dashboard.js';
import type { Plan } from '../../../shared/types.js';
import type { CliWorkspace } from '../cli-workspace.js';
import { Icon } from '../components/Icon.js';
import { AgentHeader, CheckTime, Gauge, Legend, Logo, Notice, PageHead, PeriodPicker, Stats, Tier } from './Common.js';
import { useLanguage } from './language.js';
import { agentNames, creditWindow, download, duration, known, lowestQuota, quotaRows, rate, tone, useStats } from './model.js';

export function ComparisonGauges({ tool }: { tool: DashboardTool }) {
  const { t, language } = useLanguage(); const check = tool.lastCheck;
  const rows = quotaRows(check); const credit = creditWindow(check) ?? rows.filter(row => row.unit === 'credits' && known(row.remainingPct)).sort((a, b) => a.remainingPct! - b.remainingPct!)[0];
  if (tool.agent === 'qodercli') return <div className="gauges"><Gauge pct={credit?.remainingPct} label={credit && rows.filter(row => row.unit === 'credits').length > 1 ? credit.group : t('Credits left', 'Credit còn lại')} number={known(credit?.limit) && known(credit?.used) ? `${(credit.limit - credit.used).toLocaleString(language)} / ${credit.limit.toLocaleString(language)}` : known(check?.credits.remaining) ? check.credits.remaining.toLocaleString(language) : null} reset={credit?.resetAt} /></div>;
  if (tool.agent === 'opencode' && rows.some(row => row.unit === 'tokens' && known(row.limit) && row.limit > 0 && known(row.used))) {
    const row = rows.find(row => row.unit === 'tokens' && known(row.limit) && row.limit > 0 && known(row.used))!;
    return <div className="gauges"><Gauge used pct={row.used! / row.limit! * 100} label={t('Tokens used', 'Token đã dùng')} number={`${(row.used! / 1e6).toFixed(2)}M / ${+(row.limit! / 1e6).toFixed(2)}M`} reset={row.resetAt} /></div>;
  }
  if (tool.agent === 'opencode' && !rows.length) {
    const pool = check?.keyPools?.[0];
    return <div className="gauges"><Gauge pct={pool?.remainingPct} label={t('Key pool left', 'Key pool còn lại')} number={pool && known(pool.remainingPct) ? `${pool.ok} / ${pool.total} ${t('keys available', 'key còn hạn mức')}` : null} reset={pool?.resetAt} /></div>;
  }
  const firstGroup = rows[0]?.group;
  const selected = tool.agent === 'agy' ? rows.filter(row => row.group === firstGroup).slice(0, 2) : rows.slice(0, 2);
  return <div className="gauges">{selected.length ? selected.map(row => <Gauge key={`${row.group}/${row.window}`} row={row} />) : <Gauge pct={null} label={t('Quota left', 'Hạn mức còn lại')} />}</div>;
}

export function CreditText({ check }: { check?: DashboardCheck | null }) {
  const { t, language } = useLanguage(); const credit = creditWindow(check);
  if (known(credit?.used) && known(credit?.limit)) return <>{credit.used.toLocaleString(language)} / {credit.limit.toLocaleString(language)} {t('credits used', 'credit đã dùng')}</>;
  if (known(check?.credits.remaining)) return <>{check.credits.remaining.toLocaleString(language)} {t('credits left', 'credit còn lại')}</>;
  if (check?.plan && (check.plan.tier === 'plus' || check.plan.tier === 'pro') && check.credits.unit === null) return <>{t('included in', 'đã gồm trong')} {check.plan.name}</>;
  return <>{check?.keyPools?.[0]?.limitLabel ?? '—'}</>;
}

export function Compare({ cli, plans, onDetails }: { cli: CliWorkspace; plans: Plan[]; onDetails: (agent: DashboardAgent) => void }) {
  const { t } = useLanguage(); const [days, setDays] = useState(7); const [repo, setRepo] = useState(''); const stats = useStats(days, repo);
  const tools = cli.snapshot?.tools ?? []; const byAgent = useMemo(() => new Map(stats.rows.map(row => [row.agent, row])), [stats.rows]);
  const exportCsv = () => {
    const csv = [['Agent', 'Plan', 'Model', 'Average duration (ms)', 'Success rate', 'Runs'], ...tools.map(tool => [agentNames[tool.agent], tool.lastCheck?.plan?.name ?? '', tool.lastCheck?.currentModel?.id ?? '', byAgent.get(tool.agent)?.avgDurationMs ?? '', byAgent.get(tool.agent)?.successRate ?? '', byAgent.get(tool.agent)?.runs ?? ''])].map(row => row.map(value => `"${String(value).replace(/^[=+@-]/, "'$&").replaceAll('"', '""')}"`).join(',')).join('\r\n');
    download(`agent-fleet-compare-${days}d.csv`, '\ufeff' + csv, 'text/csv;charset=utf-8');
  };
  return <div className="wrap compare-page" data-page="compare">
    <PageHead title="COM" accent="PARE" label={t('Compare', 'So sánh agent')} eyebrow={t('Side by side', 'Đặt cạnh nhau')} actions={<>{plans.length > 1 && <select className="repo-filter" aria-label={t('Repository', 'Repo')} value={repo} onChange={event => setRepo(event.target.value)}><option value="">{t('All repos', 'Tất cả repo')}</option>{[...new Set(plans.map(plan => plan.repoPath))].map(path => <option key={path}>{path}</option>)}</select>}<PeriodPicker days={days} onChange={setDays} /><button className="btn" onClick={exportCsv} disabled={!stats.loaded || Boolean(stats.error)}><Icon name="download" size={14} />{t('Export', 'Xuất')}</button></>} />
    {stats.error && <Notice message={stats.error} error onRetry={stats.retry} />}
    <div className="cmp" aria-busy={!cli.snapshot || !stats.loaded}>
      {tools.map(tool => <article className="card" data-tool={tool.agent} key={tool.agent}><AgentHeader tool={tool} /><div className="statusline" title={tool.lastCheck?.currentModel?.id}>{tool.lastCheck?.currentModel?.label ?? t('Model not reported', 'Chưa đọc được model')}{tool.lastCheck?.currentModel?.effort ? ` · effort ${tool.lastCheck.currentModel.effort}` : ''}</div><ComparisonGauges tool={tool} /><Stats stats={stats.error || !stats.loaded ? undefined : byAgent.get(tool.agent)} /><footer className="foot"><CheckTime tool={tool} /><button className="btn ghost" onClick={() => onDetails(tool.agent)}>{t('Details', 'Chi tiết')} →</button></footer></article>)}
      {!cli.snapshot && [0, 1, 2, 3].map(index => <article className="card skeleton-card" key={index}><div /><div /><div /></article>)}
    </div>
    <div className="noterow"><p className="tablenote">{t('Avg time, Success and Tasks follow the selected range; the gauges show the plan window.', 'Thời gian TB, Thành công và Số công việc theo khoảng ngày đang chọn; vòng hạn mức là cửa sổ gói hiện tại.')}</p><Legend /></div>
    <section className="panel summary fill"><h4>{t('Side-by-side summary', 'Bảng tổng hợp')}<span className="spacer">{t(`Last ${days} days`, `${days} ngày gần nhất`)}</span></h4><div className="tscroll"><table className="table compare-table" aria-label={t('Agent comparison', 'So sánh agent')}><thead><tr>{[t('Agent', 'Agent'), t('Plan', 'Gói'), 'Model', t('Lowest quota', 'Hạn mức thấp nhất'), t('Credit / token', 'Credit / token'), t('Avg time', 'Thời gian TB'), t('Success', 'Thành công')].map(label => <th key={label}>{label}</th>)}</tr></thead><tbody>
      {tools.map(tool => { const check = tool.lastCheck; const quota = lowestQuota(check); const row = stats.error || !stats.loaded ? undefined : byAgent.get(tool.agent); return <tr key={tool.agent}><td><span className="row"><Logo agent={tool.agent} small />{agentNames[tool.agent]}</span></td><td><Tier check={check} /></td><td className="model mono" title={check?.currentModel?.id}>{check?.currentModel?.label ?? '—'}</td><td>{quota ? <span className={`badge ${tone(quota.remainingPct)}`}>{quota.remainingPct}% · {quota.window}</span> : <span className="badge plain">{t('No data', 'Chưa có dữ liệu')}</span>}</td><td><div className="mono small"><CreditText check={check} /></div></td><td className="num">{duration(row?.avgDurationMs)}</td><td className="num"><span className={`badge ${!known(row?.successRate) ? 'plain' : row.successRate >= .94 ? 'ok' : 'warn'}`}>{rate(row?.successRate)}</span></td></tr>; })}
      {stats.rows.filter(row => !tools.some(tool => tool.agent === row.agent)).map(row => <tr key={row.agent}><td>{agentNames[row.agent]}</td><td>—</td><td>—</td><td>—</td><td>—</td><td className="num">{duration(row.avgDurationMs)}</td><td className="num">{rate(row.successRate)}</td></tr>)}
    </tbody></table></div><p className="tablenote">{t('Credit / token is usage against each agent’s own cap. Missing values stay unknown; the plan allowance is independent of the selected range.', 'Credit / token là mức dùng so với hạn mức riêng của mỗi agent. Giá trị thiếu được giữ là chưa có dữ liệu; hạn mức gói độc lập với khoảng ngày đang chọn.')}</p></section>
  </div>;
}
