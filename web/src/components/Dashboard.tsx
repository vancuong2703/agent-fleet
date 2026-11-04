import type { Plan, Task } from '../../../shared/types.js';
import type { CliWorkspace } from '../cli-workspace.js';
import { AgentMark, Icon } from './Icon.js';
import { PicksStrip } from './dashboard/PicksStrip.js';
import { ToolCard } from './dashboard/ToolCard.js';
import { Skeleton, clock, hasValue } from './dashboard/blocks.js';
import '../styles/dashboard.css';

/**
 * Bảng điều khiển v3: mỗi công cụ một thẻ, thông tin giúp quyết định (gói, cửa sổ
 * nghẽn, model rẻ nhất) đặt trước, chi tiết lệnh kiểm tra đẩy xuống cuối.
 */
export function Dashboard({ plans, tasks, cli }: { plans: Plan[]; tasks: Task[]; cli: CliWorkspace }) {
  const tools = cli.snapshot?.tools ?? [];
  const batch = cli.checkingAll;
  const title = (agent: string) => tools.find((item) => item.agent === agent)?.title ?? agent;
  const checkedTimes = tools.map((item) => item.lastCheck?.checkedAt).filter(hasValue);
  const busyTasks = tasks.filter((task) => !['merged', 'discarded'].includes(task.status));

  return (
    <div className="dashboard-page">
      <div className="page-heading">
        <div>
          <h1>Bảng điều khiển</h1>
          <p className="muted">Nhìn nhanh: công cụ nào còn hạn mức, model nào rẻ hoặc miễn phí ngay lúc này.</p>
        </div>
        <div className="dash-head">
          <span className="dash-clock">
            {checkedTimes.length ? `Kiểm tra lúc ${clock(Math.max(...checkedTimes))}` : 'Chưa kiểm tra hôm nay'}
          </span>
          <label className="dashboard-location">
            Vị trí mở CLI
            <select aria-label="Vị trí mở CLI" value={cli.selection} onChange={(event) => cli.setSelection(event.target.value)}>
              <option value="workspace">Workspace riêng của công cụ</option>
              {plans.map((plan) => <option key={plan.id} value={`plan:${plan.id}`}>Repo · {plan.name}</option>)}
              {busyTasks.map((task) => <option key={task.id} value={`task:${task.id}`}>Worktree · {task.title}</option>)}
            </select>
          </label>
          <button
            className="action-btn action-primary dash-check-all"
            onClick={() => void cli.checkAll()}
            disabled={batch.active || cli.checking !== null || cli.launching !== null || !tools.length}
            title={!tools.length ? 'Chưa tải được danh sách công cụ' : batch.active ? 'Đang kiểm tra tuần tự' : 'Lần lượt kiểm tra từng công cụ'}
          >
            <Icon name="refresh" size={16} />
            {batch.active ? `Đang kiểm tra ${batch.done}/${batch.total}` : 'Kiểm tra tất cả'}
          </button>
        </div>
      </div>

      {batch.active ? (
        <div className="dash-batch" role="status">
          <div
            className="dash-batch-bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={batch.total}
            aria-valuenow={batch.done}
            aria-label={`Đã kiểm tra ${batch.done} trên ${batch.total} công cụ`}
          >
            <span style={{ width: `${batch.total ? (batch.done / batch.total) * 100 : 0}%` }} />
          </div>
          <span className="dash-batch-text">
            {batch.agent ? `Đang kiểm tra ${title(batch.agent)} (${batch.done}/${batch.total})…` : `Hoàn tất ${batch.done}/${batch.total}…`}
          </span>
        </div>
      ) : null}

      <p className="dashboard-note">
        <Icon name="info" size={19} />
        <span><strong>Mở CLI</strong> chuyển sang mục Terminal. <strong>Kiểm tra</strong> đọc trạng thái và hạn mức khi bạn nhấn; dashboard không tự chạy lệnh nào.</span>
      </p>

      {cli.message ? (
        <div className={`dash-toast dash-toast-${cli.messageKind}`} role={cli.messageKind === 'error' ? 'alert' : 'status'}>
          <Icon name={cli.messageKind === 'error' ? 'close' : 'info'} size={16} />
          <span>{cli.message}</span>
          {cli.messageKind === 'error' ? (
            <button type="button" className="dash-retry" onClick={() => void cli.checkAll()} aria-label="Thử lại toàn bộ">
              <Icon name="refresh" size={14} />Thử lại
            </button>
          ) : null}
        </div>
      ) : null}

      {cli.snapshot && tools.length ? <PicksStrip tools={tools} cli={cli} /> : null}

      <div className="dash-grid">
        {tools.map((tool) => <ToolCard key={tool.agent} tool={tool} cli={cli} />)}
        {!cli.snapshot ? (
          Array.from({ length: 4 }, (_, index) => (
            <article className="tool-card dash-card is-placeholder" key={index} aria-hidden="true">
              <Skeleton lines={2} />
              <Skeleton lines={3} />
              <Skeleton lines={2} />
            </article>
          ))
        ) : null}
      </div>

      {cli.snapshot && !tools.length ? <p className="dash-empty-page">Chưa có công cụ nào để hiển thị.</p> : null}

      {cli.snapshot?.terminalSessions.length ? (
        <section className="dashboard-live-sessions">
          <h2>Phiên đang mở</h2>
          <div className="session-shortcuts">
            {cli.snapshot.terminalSessions.map((session) => (
              <button className="action-btn" key={session.id} onClick={() => cli.select(session.id)}>
                <AgentMark agent={session.agent} />
                {session.title}
                <Icon name="arrow" size={16} />
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
