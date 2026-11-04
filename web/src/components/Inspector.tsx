import { useState } from 'react';
import type { ModelIdentity, ModelUsageRow, ObservabilitySnapshot } from '../../../shared/observability.js';
import type { Plan, Run, Task } from '../../../shared/types.js';
import { copyText, isDesktop, openLocation } from '../desktop.js';
import { exportReport, formatBytes, formatNumber, formatUsd } from '../observability.js';
import { formatElapsed } from '../store.js';
import { appStrings } from '../strings.js';
import { attributionLabels, modelSourceLabels as sourceLabels } from '../usage.js';
import { AgentMark, Icon } from './Icon.js';
import { ResourceChart } from './usage/ResourceChart.js';

/** Compatibility re-exports: `UsagePage` and `ResourceChart` used to live in this file. */
export { UsagePage } from './usage/UsagePage.js';
export { ResourceChart } from './usage/ResourceChart.js';

export function ModelChips({ models }: { models: ModelIdentity[] }) {
  if (!models.length) return null;
  return <div className="model-chips">{models.map((model) => <span className="model-chip" key={`${model.provider ?? ''}/${model.name}/${model.source}`} title={`${sourceLabels[model.source]}${model.generic ? ' · model chung (placeholder)' : ''}`}><code>{model.name}</code>{model.provider && <small>{model.provider}</small>}<i>{sourceLabels[model.source]}</i>{model.generic && <b className="generic-tag">chung</b>}</span>)}</div>;
}

export function ModelUsageTable({ rows, caption }: { rows: ModelUsageRow[]; caption: string }) {
  if (!rows.length) return null;
  return <table className="model-usage-table" aria-label={caption}><thead><tr><th>Model</th><th>Nguồn</th><th>Input</th><th>Output</th><th>Chi phí</th><th>Credit</th><th>Credit DN</th></tr></thead><tbody>{rows.map((row, index) => <tr key={`${row.agent}/${row.model ?? 'null'}/${row.attribution}/${index}`}>{row.model == null ? <td className="model-unattributed">Chưa gán được model</td> : <td><code>{row.model}</code>{row.provider && <small> · {row.provider}</small>}</td>}{<td>{attributionLabels[row.attribution]}</td>}<td>{formatNumber(row.inputTokens)}</td><td>{formatNumber(row.outputTokens)}</td><td>{formatUsd(row.costUsd)}</td><td title="Credit tính phí do nhà cung cấp báo cáo">{formatNumber(row.credits)}</td><td title="Credit danh nghĩa, gồm cả mức không tính phí">{formatNumber(row.reportedCredits)}</td></tr>)}</tbody></table>;
}

export function Inspector({ snapshot, error, task, run, plan, onClose }: { snapshot: ObservabilitySnapshot | null; error: string | null; task: Task | null; run: Run | null; plan: Plan | null; onClose: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  const observed = snapshot?.runs.find((entry) => entry.runId === run?.id) ?? null;
  const resource = snapshot?.resource;
  const usage = snapshot?.usage;
  const action = async (fn: () => Promise<void>, success?: string) => { try { await fn(); setMessage(success ?? null); } catch (cause) { setMessage(cause instanceof Error ? cause.message : String(cause)); } };
  return <aside className="inspector" aria-label="Thông tin và tài nguyên">
    <div className="inspector-title">Thông tin workspace<button type="button" className="icon-button inspector-close" aria-label="Đóng bảng thông tin" title="Đóng bảng thông tin" onClick={onClose}><Icon name="close" size={16} /></button></div>
    <section className="inspector-section">
      <h3>Agent & model</h3>
      {task ? <><div className="inspector-agent"><AgentMark agent={task.agent} label /><span className={`activity-dot ${task.status === 'running' ? 'active' : ''}`} /></div><div className="model-name">{observed?.model ?? 'Model chưa được báo'}</div><p className="small-note">{observed?.modelSource === 'configured' ? 'Theo cấu hình CLI' : observed?.modelSource === 'reported' ? 'Agent báo trực tiếp' : 'Hiển thị khi CLI cung cấp thông tin model'}</p>{observed && observed.models.length > 0 && <><div className="model-list-label">Các model của lần chạy</div><ModelChips models={observed.models} /></>}{observed && observed.usageByModel.length > 0 && <><div className="model-list-label">Sử dụng theo model (lần chạy này)</div><ModelUsageTable rows={observed.usageByModel} caption={`Mức sử dụng theo model của ${task.title}`} /></>}{observed == null && <p className="small-note">Số liệu model xuất hiện khi server quan sát thấy usage.</p>}<p className="activity-text" title={observed?.currentActivity}>{observed?.currentActivity ?? (task.status === 'running' ? 'Đang chờ hoạt động từ agent…' : 'Chưa có hoạt động mới')}</p>{observed?.silentForMs != null && observed.silentForMs > 60_000 && task.status === 'running' && <p className="silence-note">Chưa có output mới trong {formatElapsed(observed.silentForMs)}.</p>}</> : <p className="small-note">{appStrings.inspector.chooseTask}</p>}
    </section>
    <section className="inspector-section">
      <div className="section-heading"><h3>Tài nguyên trực tiếp</h3><span className="live-label">{appStrings.live}</span></div>
      {error && <p className="small-note resource-error">{error}</p>}
      <div className="resource-grid"><div><span>CPU</span><strong>{resource?.cpuPercent == null ? '—' : `${resource.cpuPercent.toFixed(1)}%`}</strong></div><div><span>RAM</span><strong>{formatBytes(resource?.memoryBytes)}</strong></div></div>
      <ResourceChart history={snapshot?.history ?? []} compact />
      <div className="resource-detail"><span>RAM cao nhất</span><span>{formatBytes(resource?.peakMemoryBytes)}</span></div>
      <div className="resource-detail"><span>Tiến trình</span><span>{resource?.processCount ?? '—'}</span></div>
      <div className="resource-detail"><span>{resource?.gpu?.scope === 'desktop-process-tree' ? 'GPU app' : resource?.gpu?.scope === 'system' ? 'GPU toàn máy' : 'GPU'}</span><span>{resource?.gpu?.utilizationPercent != null ? `${resource.gpu.utilizationPercent.toFixed(1)}%` : 'Chưa có dữ liệu'}</span></div>
      {resource?.gpu && <><div className="resource-detail"><span>VRAM</span><span>{formatBytes(resource.gpu.memoryBytes)}</span></div><p className="small-note">{resource.gpu.name}{resource.gpu.scope === 'system' ? ' · Số liệu toàn máy; không đại diện riêng cho agent.' : ' · Đo các tiến trình thuộc app.'}</p></>}
      <p className="small-note">{resource?.scope === 'desktop-process-tree' ? 'Đo app và các tiến trình con. CPU chuẩn hoá toàn máy. RAM là tổng working set, có thể tính trùng vùng nhớ dùng chung.' : 'Chỉ đo server Node. Mở bản Desktop để đo toàn bộ app.'}</p>
    </section>
    <section className="inspector-section"><div className="section-heading"><h3>{plan ? 'Sử dụng của plan' : 'Tổng mức sử dụng'}</h3><button className="icon-button" title="Xuất báo cáo JSON" aria-label="Xuất báo cáo JSON" disabled={!snapshot} onClick={() => snapshot && exportReport(snapshot)}><Icon name="download" size={16} /></button></div>
      <div className="usage-total">{formatNumber(usage?.inputTokens != null || usage?.outputTokens != null ? (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) : null)}<span>tokens đã ghi nhận</span></div>
      <div className="resource-detail"><span>Input / output</span><span>{formatNumber(usage?.inputTokens)} / {formatNumber(usage?.outputTokens)}</span></div><div className="resource-detail"><span>Chi phí báo cáo</span><strong>{formatUsd(usage?.costUsd)}</strong></div><div className="resource-detail"><span title="Credit tính phí do nhà cung cấp báo cáo">Credit thanh toán</span><span>{formatNumber(usage?.credits)}</span></div><div className="resource-detail"><span title="Credit danh nghĩa, gồm cả mức sử dụng không tính phí">Credit danh nghĩa</span><span>{formatNumber(usage?.reportedCredits)}</span></div>
      <p className="small-note">Token: {usage ? `${usage.coverage.tokenRuns}/${usage.coverage.totalRuns} lần chạy có dữ liệu` : 'chưa có lần chạy nào'}. Chi phí và credit theo báo cáo của nhà cung cấp.</p>
    </section>
    <section className="inspector-section"><h3>Vị trí làm việc</h3>{plan && <><div className="path-label">Repository</div><div className="path-text" title={plan.repoPath}>{plan.repoPath}</div><div className="path-actions"><button className="text-button" onClick={() => action(() => openLocation({ planId: plan.id }))} disabled={!isDesktop()} title={isDesktop() ? 'Mở repository trong Explorer' : 'Có trong ứng dụng Desktop'}><Icon name="folder" size={14} />Mở thư mục</button><button className="icon-button" aria-label="Sao chép đường dẫn repo" title="Sao chép đường dẫn repo" onClick={() => action(() => copyText(plan.repoPath), 'Đã sao chép đường dẫn.')}><Icon name="copy" size={14} /></button></div></>}{task && <><div className="path-label">Worktree</div><div className="path-text" title={task.worktreePath}>{task.worktreePath}</div><div className="path-actions"><button className="text-button" disabled={!isDesktop() || task.status === 'merged' || task.status === 'discarded'} onClick={() => action(() => openLocation({ taskId: task.id }))}><Icon name="folder" size={14} />Mở worktree</button><button className="icon-button" aria-label="Sao chép đường dẫn worktree" title="Sao chép đường dẫn worktree" onClick={() => action(() => copyText(task.worktreePath), 'Đã sao chép đường dẫn.')}><Icon name="copy" size={14} /></button></div></>}{!plan && <p className="small-note">{appStrings.inspector.pathHint}</p>}{message && <p className="small-note" role="status">{message}</p>}</section>
    <div className="inspector-foot">{snapshot ? `Cập nhật ${new Date(snapshot.sampledAt).toLocaleTimeString('vi-VN')}` : 'Đang kết nối số liệu…'}</div>
  </aside>;
}
