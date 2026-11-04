import type { DashboardCheck, DashboardTool } from '../../../../shared/dashboard.js';
import type { CliWorkspace } from '../../cli-workspace.js';
import { tierBadge } from '../../usage.js';
import { AgentMark, Icon } from '../Icon.js';
import { Block, clock, hasValue, type BlockState } from './blocks.js';
import { CreditPanel, BalanceValue } from './CreditPanel.js';
import { KeyPoolGrid } from './KeyPoolGrid.js';
import { ModelOfferList } from './ModelOfferList.js';
import { PlanStrip } from './PlanStrip.js';
import { QuotaMeters } from './QuotaMeter.js';

const STATUS_LABELS: Record<DashboardCheck['status'], string> = {
  ready: 'Sẵn sàng',
  'needs-login': 'Cần đăng nhập',
  unavailable: 'Chưa cài CLI',
  unknown: 'Chưa xác định',
  error: 'Kiểm tra có lỗi',
};

const STATUS_TONE: Record<DashboardCheck['status'], string> = {
  ready: 'is-ok',
  'needs-login': 'is-warn',
  unavailable: 'is-bad',
  unknown: 'is-idle',
  error: 'is-bad',
};

export interface ToolCardProps {
  tool: DashboardTool;
  cli: CliWorkspace;
}

export function ToolCard({ tool, cli }: ToolCardProps) {
  const check = tool.lastCheck;
  const busy = cli.checking === tool.agent;
  const failed = check?.status === 'error';
  const windows = check?.quotaWindows ?? [];
  const pools = check?.keyPools;
  // OpenCode là tool duy nhất có pool key; khi chưa kiểm tra thì giữ khối này
  // để người dùng thấy đủ trạng thái thay vì đột ngột xuất hiện sau lần bấm.
  const showPools = check ? pools !== undefined : tool.agent === 'opencode';
  const models = check?.models;

  const state = (present: boolean): BlockState => {
    if (busy && !check) return 'loading';
    if (!check) return 'unchecked';
    if (failed) return 'error';
    return present ? 'data' : 'empty';
  };
  const retry = () => void cli.check(tool.agent);
  // Chỉ nói "lệnh không hoàn tất" khi thật sự có tín hiệu lỗi; trạng thái thiếu
  // dữ liệu phải đọc là "chưa có dữ liệu", không phải một lời lỗi.
  const failedProbe = check?.probes.find((probe) => !probe.ok) ?? null;
  const errorDetail = failedProbe?.summary ?? (failed ? 'Lần kiểm tra trước có lỗi · hãy thử lại.' : null);

  const tier = tierBadge(check);
  const status = busy ? (check ? 'Đang kiểm tra lại…' : 'Đang kiểm tra…') : check ? STATUS_LABELS[check.status] : 'Chưa kiểm tra';

  return (
    <article className="tool-card dash-card" data-tool={tool.agent} aria-busy={busy || undefined}>
      <header className="tool-heading dash-card-top">
        <AgentMark agent={tool.agent} />
        <div className="dash-card-title">
          <h2>
            {tool.title}
            {tier ? <span className={`tier-badge tier-${tier.tone}`}>{tier.label}</span> : null}
          </h2>
          <span className="tool-version">
            {check?.version ?? (tool.installed ? 'Đã tìm thấy CLI trên máy' : 'Chưa tìm thấy CLI')}
          </span>
        </div>
        <span className={`tool-status dash-status ${busy ? 'is-idle' : check ? STATUS_TONE[check.status] : 'is-idle'}`}>{status}</span>
      </header>

      <Block title="Gói · model mặc định" state={state(Boolean(check?.plan || check?.currentModel))} detail={errorDetail} onRetry={check ? retry : undefined} retryLabel={`Kiểm tra lại gói của ${tool.title}`}>
        {check ? <PlanStrip check={check} /> : null}
      </Block>

      <div className="dash-split">
        <Block
          title="Hạn mức còn lại"
          hint={windows.length ? 'thanh = cửa sổ thấp hơn' : null}
          state={state(windows.length > 0 || hasValue(check?.quota.remaining))}
          detail={failed ? errorDetail : check?.quota.reason ?? null}
          onRetry={check ? retry : undefined}
          retryLabel={`Kiểm tra lại hạn mức của ${tool.title}`}
        >
          {windows.length ? <QuotaMeters windows={windows} /> : <BalanceLine value={check?.quota} />}
        </Block>

        <Block
          title="Tài khoản & credit"
          state={state(Boolean(check?.account.label) || hasValue(check?.credits.remaining) || windows.some((row) => row.unit === 'credits'))}
          detail={failed ? errorDetail : check?.credits.reason ?? null}
          onRetry={check ? retry : undefined}
          retryLabel={`Kiểm tra lại tài khoản của ${tool.title}`}
        >
          {check ? (
            <>
              <p className="tool-account">
                <Icon name="user" size={16} />
                {check.account.label ?? <span className="dash-unknown" title={check.account.reason ?? undefined}>Chưa có dữ liệu</span>}
              </p>
              <CreditPanel check={check} />
            </>
          ) : null}
        </Block>
      </div>

      {showPools ? (
        <Block
          title="Key pool (harbor-key)"
          hint={pools?.length ? `${pools.length} pool` : null}
          state={state(Boolean(pools?.length))}
          detail={errorDetail}
          onRetry={check ? retry : undefined}
          retryLabel={`Kiểm tra lại key pool của ${tool.title}`}
        >
          <KeyPoolGrid pools={pools} />
        </Block>
      ) : null}

      <Block
        title="Hệ số credit theo model"
        hint={models?.length ? 'rẻ nhất trước' : null}
        state={state(Boolean(models?.length))}
        detail={errorDetail}
        onRetry={check ? retry : undefined}
        retryLabel={`Kiểm tra lại danh sách model của ${tool.title}`}
      >
        <ModelOfferList models={models} />
      </Block>

      {check?.highlights?.length ? (
        <ul className="dash-notes">
          {check.highlights.map((note) => <li key={note}><Icon name="info" size={14} />{note}</li>)}
        </ul>
      ) : null}

      <footer className="dash-card-foot">
        <span className="muted">
          <Icon name="refresh" size={14} />
          {check ? `Đã kiểm tra ${clock(check.checkedAt)}` : 'Chỉ kiểm tra khi bạn nhấn nút.'}
        </span>
        <div className="tool-actions">
          <button
            className="action-btn"
            disabled={Boolean(cli.checking)}
            onClick={retry}
            aria-label={`Kiểm tra ${tool.title}`}
            title={cli.checking && cli.checking !== tool.agent ? 'Đang kiểm tra công cụ khác…' : undefined}
          >
            <Icon name="refresh" size={16} />
            {busy ? 'Đang kiểm tra…' : 'Kiểm tra'}
          </button>
          <button
            className="action-btn action-primary"
            disabled={Boolean(cli.launching)}
            onClick={() => void cli.launch(tool.agent)}
            aria-label={`Mở ${tool.title}`}
          >
            <Icon name="terminal" size={16} />
            {cli.launching === tool.agent ? 'Đang mở…' : 'Mở CLI'}
          </button>
        </div>
      </footer>

      {check ? (
        <details className="tool-probes">
          <summary>Chi tiết kiểm tra ({check.probes.length} lệnh)</summary>
          {check.probes.map((probe, index) => (
            <div key={`${probe.command}-${index}`}>
              <code>{probe.command}</code>
              <p>{probe.ok ? 'Đã đọc kết quả' : 'Lệnh chưa hoàn tất'} · exit {probe.exitCode ?? '—'}</p>
              <pre>{probe.output ?? probe.summary}</pre>
            </div>
          ))}
        </details>
      ) : null}
    </article>
  );
}

/** Số dư hạn mức theo kiểu cũ (một con số duy nhất) khi tool không có cửa sổ nào. */
function BalanceLine({ value }: { value: DashboardCheck['quota'] | undefined }) {
  return (
    <p className="dash-balance">
      <BalanceValue value={value} />
      {!hasValue(value?.remaining) ? <small>{value?.reason ?? 'Chưa đọc được tỷ lệ còn lại.'}</small> : null}
    </p>
  );
}
