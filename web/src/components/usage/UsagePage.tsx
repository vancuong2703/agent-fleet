import { ArrowRight, CircleDollarSign, Coins, Cpu, Download, Inbox, MemoryStick, RefreshCw, Timer, TriangleAlert, type LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { DashboardSnapshot, DashboardTool } from '../../../../shared/dashboard.js';
import type { ObservabilitySnapshot, ToolUsageRow } from '../../../../shared/observability.js';
import type { Plan, Task } from '../../../../shared/types.js';
import { exportReport, formatBytes, formatNumber, formatUsd } from '../../observability.js';
import {
  MISSING,
  MISSING_LABEL,
  agentUsageRows,
  attributionLabels,
  chartGeometry,
  hasUsageData,
  modelSourceLabels,
  usageKpis,
  type AgentUsageRow,
  type ChartKind,
  type UsageKpi,
} from '../../usage.js';
import { appStrings } from '../../strings.js';
import { AgentMark } from '../Icon.js';
import { ResourceChart } from './ResourceChart.js';
import '../../styles/usage.css';

const KPI_ICONS: Record<UsageKpi['key'], LucideIcon> = {
  tokens: Coins,
  cost: CircleDollarSign,
  memory: MemoryStick,
  cpuTime: Timer,
};

/**
 * UsagePage keeps working with the props App passes today. `tools` and
 * `onRetry` are optional so the dashboard owner can wire shared state later
 * without changing this page; without `tools` it does one read-only
 * `GET /api/dashboard` (that route never spawns a CLI).
 */
export interface UsagePageProps {
  snapshot: ObservabilitySnapshot | null;
  error: string | null;
  plans: Plan[];
  tasks: Task[];
  onSelectTask: (id: string) => void;
  tools?: DashboardTool[];
  onRetry?: () => void;
}

function useDashboardTools(provided?: DashboardTool[]): DashboardTool[] | null {
  const [fetched, setFetched] = useState<DashboardTool[] | null>(null);
  useEffect(() => {
    if (provided !== undefined) return;
    let disposed = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 8_000);
    void (async () => {
      try {
        const response = await fetch('/api/dashboard', { credentials: 'same-origin', signal: controller.signal });
        if (!response.ok) throw new Error(String(response.status));
        const snapshot = await response.json() as DashboardSnapshot;
        if (!disposed) setFetched(snapshot.tools);
      } catch {
        // Tier and multiplier columns degrade to "Chưa kiểm tra"; usage numbers still render.
        if (!disposed) setFetched([]);
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => { disposed = true; controller.abort(); window.clearTimeout(timeout); };
  }, [provided]);
  return provided ?? fetched;
}

function KpiTile({ kpi }: { kpi: UsageKpi }) {
  const Glyph = KPI_ICONS[kpi.key];
  const empty = kpi.value === null;
  return <article className={`kpi-tile${empty ? ' is-empty' : ''}`} data-kpi={kpi.key}>
    <span className="kpi-icon" aria-hidden="true"><Glyph size={18} strokeWidth={1.75} /></span>
    <div className="kpi-body">
      <span className="kpi-label">{kpi.label}</span>
      <strong className="kpi-value">{empty ? MISSING_LABEL : kpi.value}</strong>
      <small className="kpi-note">{kpi.note}</small>
    </div>
  </article>;
}

function KpiSkeleton() {
  return <div className="usage-kpi-grid" aria-hidden="true">
    {(['tokens', 'cost', 'memory', 'cpuTime'] as const).map((key) => <article className="kpi-tile is-skeleton" key={key}>
      <span className="kpi-icon" />
      <div className="kpi-body"><span className="kpi-skeleton-line short" /><span className="kpi-skeleton-line" /><span className="kpi-skeleton-line tiny" /></div>
    </article>)}
  </div>;
}

function ChartPanel({ title, kind, history }: { title: string; kind: ChartKind; history: ObservabilitySnapshot['history'] }) {
  const geometry = useMemo(() => chartGeometry(history, kind), [history, kind]);
  const Glyph = kind === 'cpu' ? Cpu : MemoryStick;
  return <section className="usage-panel usage-chart">
    <header className="usage-panel-head">
      <h3><Glyph size={16} strokeWidth={1.75} aria-hidden="true" />{title}</h3>
      <span className="usage-panel-meta">{geometry.state === 'ready' ? `${geometry.samples} mẫu gần nhất` : 'Chưa có mẫu'}</span>
    </header>
    <ResourceChart history={history} kind={kind} />
  </section>;
}

function TierCell({ row }: { row: AgentUsageRow }) {
  if (row.tier) return <span className={`tier-badge tier-${row.tier.tone}`} title={row.planName ? `Gói ${row.planName}` : undefined}>{row.tier.label}</span>;
  return <span className="usage-missing">{row.check ? 'Chưa rõ gói' : 'Chưa kiểm tra'}</span>;
}

function MultiplierCell({ row }: { row: AgentUsageRow }) {
  const multiplier = row.multiplier;
  if (!multiplier) return <span className="usage-missing">{MISSING}</span>;
  return <span className={`usage-mult${multiplier.text === 'Miễn phí' ? ' free' : ''}`}>
    {multiplier.original && <s>{multiplier.original}</s>}
    {multiplier.text}
    {multiplier.promo && <em className="usage-promo">{multiplier.promo}</em>}
  </span>;
}

function ModelCell({ row }: { row: AgentUsageRow }) {
  const models = row.usage?.models ?? [];
  if (!models.length) {
    return row.check?.currentModel
      ? <code className="usage-current-model" title="Model do cấu hình CLI báo">{row.check.currentModel.label}</code>
      : <span className="usage-missing">{MISSING}</span>;
  }
  return <>
    {models.map((model) => <code
      key={`${model.provider ?? ''}/${model.name}`}
      className={model.generic ? 'model-generic' : undefined}
      title={`${modelSourceLabels[model.source]}${model.generic ? ' · model chung' : ''}${model.provider ? ` · ${model.provider}` : ''}`}
    >{model.name}</code>)}
  </>;
}

function AgentUsageTable({ rows, loading }: { rows: AgentUsageRow[]; loading: boolean }) {
  return <section className="usage-section">
    <div className="usage-section-head">
      <h2>Theo agent</h2>
      <span className="usage-section-meta">{loading ? 'Đang đọc tier từ Bảng điều khiển…' : 'Tier và hệ số do CLI hoặc catalog báo; cập nhật ở Bảng điều khiển.'}</span>
    </div>
    <div className="table-scroll">
      <table className="compare-table usage-table" aria-label="Mức sử dụng theo agent">
        <thead><tr>
          <th scope="col">Công cụ</th><th scope="col">Tier</th><th scope="col">Model</th><th scope="col">Lần chạy</th>
          <th scope="col">Input</th><th scope="col">Output</th><th scope="col">Chi phí</th>
          <th scope="col">Credit thanh toán</th><th scope="col">Credit danh nghĩa</th><th scope="col">Hệ số</th>
        </tr></thead>
        <tbody>
          {rows.map((row) => <tr key={row.agent} data-agent={row.agent} data-tier={row.tier?.tone ?? 'none'}>
            <td data-label="Công cụ"><AgentMark agent={row.agent} label />{row.planName && <small className="usage-agent-plan">{row.planName}</small>}</td>
            <td data-label="Tier"><TierCell row={row} /></td>
            <td data-label="Model" className="usage-model"><ModelCell row={row} /></td>
            <td data-label="Lần chạy">{usageCell(row.usage, (usage) => formatNumber(usage.runCount))}</td>
            <td data-label="Input">{usageCell(row.usage, (usage) => formatNumber(usage.inputTokens))}</td>
            <td data-label="Output">{usageCell(row.usage, (usage) => formatNumber(usage.outputTokens))}</td>
            <td data-label="Chi phí">{usageCell(row.usage, (usage) => formatUsd(usage.costUsd))}</td>
            <td data-label="Credit thanh toán">{usageCell(row.usage, (usage) => formatNumber(usage.credits))}</td>
            <td data-label="Credit danh nghĩa">{usageCell(row.usage, (usage) => formatNumber(usage.reportedCredits))}</td>
            <td data-label="Hệ số"><MultiplierCell row={row} /></td>
          </tr>)}
          {!rows.length && <tr><td colSpan={10} className="compare-empty">Chưa có dữ liệu agent. Kiểm tra công cụ ở Bảng điều khiển để đọc tier.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}

function usageCell(usage: ToolUsageRow | null, render: (usage: ToolUsageRow) => string) {
  if (!usage) return <span className="usage-missing">{MISSING}</span>;
  const value = render(usage);
  return value === MISSING ? <span className="usage-missing">{MISSING}</span> : value;
}

function PlanTable({ snapshot, plans }: { snapshot: ObservabilitySnapshot; plans: Plan[] }) {
  return <section className="usage-section">
    <div className="usage-section-head"><h2>Theo dự án / plan</h2><span className="usage-section-meta">{snapshot.plans.length} plan có số liệu</span></div>
    <div className="table-scroll">
      <table className="compare-table usage-table" aria-label="Mức sử dụng theo dự án">
        <thead><tr><th scope="col">Dự án</th><th scope="col">Lần chạy</th><th scope="col">Input token</th><th scope="col">Output token</th><th scope="col">Chi phí</th><th scope="col">Credit thanh toán</th><th scope="col">Credit danh nghĩa</th><th scope="col">RAM đỉnh</th></tr></thead>
        <tbody>
          {snapshot.plans.map((usage) => <tr key={usage.planId}>
            <td data-label="Dự án">{plans.find((plan) => plan.id === usage.planId)?.name ?? usage.planId}</td>
            <td data-label="Lần chạy">{usage.runCount}</td>
            <td data-label="Input token">{formatNumber(usage.inputTokens)}</td>
            <td data-label="Output token">{formatNumber(usage.outputTokens)}</td>
            <td data-label="Chi phí">{formatUsd(usage.costUsd)}</td>
            <td data-label="Credit thanh toán">{formatNumber(usage.credits)}</td>
            <td data-label="Credit danh nghĩa">{formatNumber(usage.reportedCredits)}</td>
            <td data-label="RAM đỉnh">{formatBytes(usage.resources.peakMemoryBytes)}</td>
          </tr>)}
          {!snapshot.plans.length && <tr><td colSpan={8} className="compare-empty">Chưa có số liệu dự án. Số liệu xuất hiện sau lần chạy đầu tiên.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}

function ModelTable({ snapshot }: { snapshot: ObservabilitySnapshot }) {
  return <section className="usage-section">
    <div className="usage-section-head"><h2>Theo model</h2><span className="usage-section-meta">{snapshot.usageByModel.length} dòng model</span></div>
    <div className="table-scroll">
      <table className="compare-table usage-table" aria-label="Mức sử dụng theo model">
        <thead><tr><th scope="col">Công cụ</th><th scope="col">Model</th><th scope="col">Nguồn gán</th><th scope="col">Lần chạy</th><th scope="col">Input</th><th scope="col">Output</th><th scope="col">Chi phí</th><th scope="col">Credit thanh toán</th><th scope="col">Credit danh nghĩa</th></tr></thead>
        <tbody>
          {snapshot.usageByModel.map((row, index) => <tr key={`${row.agent}/${row.model ?? 'null'}/${row.attribution}/${index}`}>
            <td data-label="Công cụ">{row.agent}</td>
            {row.model == null
              ? <td className="model-unattributed" data-label="Model">Chưa gán được model</td>
              : <td data-label="Model"><code>{row.model}</code>{row.provider && <small> · {row.provider}</small>}</td>}
            <td data-label="Nguồn gán">{attributionLabels[row.attribution]}</td>
            <td data-label="Lần chạy">{row.runCount}</td>
            <td data-label="Input">{formatNumber(row.inputTokens)}</td>
            <td data-label="Output">{formatNumber(row.outputTokens)}</td>
            <td data-label="Chi phí">{formatUsd(row.costUsd)}</td>
            <td data-label="Credit thanh toán">{formatNumber(row.credits)}</td>
            <td data-label="Credit danh nghĩa">{formatNumber(row.reportedCredits)}</td>
          </tr>)}
          {!snapshot.usageByModel.length && <tr><td colSpan={9} className="compare-empty">Chưa có số liệu theo model. Agent báo model khi chạy xong.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}

export function UsagePage({ snapshot, error, plans, tasks, onSelectTask, tools: providedTools, onRetry }: UsagePageProps) {
  const tools = useDashboardTools(providedTools);
  const [fallback, setFallback] = useState<ObservabilitySnapshot | null>(null);
  const [fallbackError, setFallbackError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const data = snapshot ?? fallback;
  const message = fallback !== null ? fallbackError : error ?? fallbackError;
  const loading = data === null && message === null;

  const retry = async () => {
    if (onRetry) { onRetry(); return; }
    setRetrying(true);
    setFallbackError(null);
    try {
      const response = await fetch('/api/observability', { credentials: 'same-origin' });
      if (!response.ok) throw new Error(`Không tải được số liệu (${response.status})`);
      setFallback(await response.json() as ObservabilitySnapshot);
    } catch (cause) {
      setFallbackError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRetrying(false);
    }
  };

  const kpis = usageKpis(data);
  const rows = useMemo(() => agentUsageRows(data?.usageByTool ?? [], tools ?? []), [data, tools]);
  const history = data?.history ?? [];

  return <div className="usage-page">
    <div className="page-heading">
      <div>
        <span className="eyebrow">{appStrings.eyebrows.usage}</span>
        <h1>{appStrings.usageTitle}</h1>
        <p className="muted">Số liệu thực đo và dữ liệu do agent cung cấp.</p>
      </div>
      <button className="action-btn" disabled={!data} onClick={() => data && exportReport(data)}><Download size={16} strokeWidth={1.75} aria-hidden="true" />Xuất báo cáo</button>
    </div>

    {message && <div className="banner banner-error usage-error" role="alert">
      <TriangleAlert size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>{message}</span>
      <button className="action-btn" onClick={() => void retry()} disabled={retrying}><RefreshCw size={15} strokeWidth={1.75} aria-hidden="true" />{retrying ? 'Đang thử lại…' : 'Thử lại'}</button>
    </div>}

    {loading ? <div className="usage-loading" aria-busy="true" aria-label="Đang tải số liệu sử dụng">
      <KpiSkeleton />
      <div className="usage-charts">
        <section className="usage-panel usage-chart"><header className="usage-panel-head"><h3><Cpu size={16} strokeWidth={1.75} aria-hidden="true" />CPU của ứng dụng</h3></header><p className="chart-empty">Đang tải số liệu…</p></section>
        <section className="usage-panel usage-chart"><header className="usage-panel-head"><h3><MemoryStick size={16} strokeWidth={1.75} aria-hidden="true" />Bộ nhớ ứng dụng</h3></header><p className="chart-empty">Đang tải số liệu…</p></section>
      </div>
      <p className="small-note">Đang đọc số liệu tài nguyên và mức sử dụng…</p>
    </div> : data === null ? null : <>
      <section className="usage-kpi-grid" aria-label="Chỉ số chính">{kpis.map((kpi) => <KpiTile key={kpi.key} kpi={kpi} />)}</section>

      <div className="usage-charts">
        <ChartPanel title="CPU của ứng dụng" kind="cpu" history={history} />
        <ChartPanel title="Bộ nhớ ứng dụng" kind="memory" history={history} />
      </div>

      {!hasUsageData(data) && <section className="usage-empty">
        <Inbox size={22} strokeWidth={1.75} aria-hidden="true" />
        <div>
          <strong>Chưa có số liệu sử dụng</strong>
          <p>Token, chi phí và tài nguyên chỉ được ghi khi có lần chạy. Giao việc cho một agent trong mục <b>Công việc</b>, rồi mở lại trang này — biểu đồ và bảng sẽ tự cập nhật.</p>
        </div>
      </section>}

      {data.activeJobs.length > 0 && <section className="usage-section active-jobs">
        <div className="usage-section-head"><h2>Đang hoạt động · {data.activeJobs.length}</h2><span className="usage-section-meta">Số liệu tạm tính, cập nhật mỗi 3 giây</span></div>
        {data.activeJobs.map((job) => <div className="active-job" key={job.runId}>
          <AgentMark agent={job.agent} />
          <div>
            <div className="active-job-title">{tasks.find((task) => task.id === job.taskId)?.title ?? job.taskId}</div>
            <div className="active-job-model">{job.model ?? 'Model chưa được báo'} · {job.agent}</div>
            <p>{job.currentActivity}</p>
          </div>
          <button className="text-button" onClick={() => onSelectTask(job.taskId)}>{appStrings.usage.viewTask}<ArrowRight size={14} strokeWidth={1.75} aria-hidden="true" /></button>
        </div>)}
      </section>}

      <AgentUsageTable rows={rows} loading={providedTools === undefined && tools === null} />
      <PlanTable snapshot={data} plans={plans} />
      <ModelTable snapshot={data} />

      <footer className="usage-notes">
        <p className="compare-note">Dấu {MISSING} nghĩa là chưa có dữ liệu. Credit thuê bao không được suy ra từ token hoặc USD. Bảng theo model cộng theo từng model và dòng “Chưa gán được model”; mỗi mức sử dụng chỉ tính một lần, không nhân đôi tổng số.</p>
        {data.notes.map((note, index) => <p className="small-note" key={index}>{note}</p>)}
        <p className="small-note">Nguồn model: {modelSourceLabels.reported.toLowerCase()} / {modelSourceLabels.configured.toLowerCase()}.</p>
      </footer>
    </>}
  </div>;
}
