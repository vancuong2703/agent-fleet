import type { DashboardBalance, DashboardTool } from '../../../shared/dashboard.js';
import type { Plan, Task } from '../../../shared/types.js';
import type { CliWorkspace } from '../cli-workspace.js';
import { AgentMark, Icon } from './Icon.js';

const states: Record<string,string> = {ready:'CLI hoạt động','needs-login':'Cần đăng nhập',unavailable:'Chưa cài CLI',unknown:'Chưa xác định',error:'Kiểm tra có lỗi'};
function Balance({value}: {value: DashboardBalance | undefined}) {
  return <>{value?.remaining == null ? <span className="muted" title={value?.reason ?? undefined}>{value?.reason?.includes('chưa được bật') ? 'Chưa bật AI Credits' : 'Chưa có dữ liệu'}</span> : <strong>{value.remaining.toLocaleString('vi-VN')}{value.unit === 'percent' ? '%' : ` ${value.unit ?? ''}`}</strong>}</>;
}
function ToolCard({tool,cli}: {tool: DashboardTool;cli: CliWorkspace}) {
  const check=tool.lastCheck;
  return <section className="tool-card">
    <div className="tool-heading"><AgentMark agent={tool.agent} label/><span className={`tool-status ${check?.status === 'ready'?'ready':''}`}>{check?states[check.status]:'Chưa kiểm tra'}</span></div>
    <div className="tool-version">{check?.version??(tool.installed?'Đã tìm thấy CLI trên máy':'Chưa tìm thấy CLI')}</div>
    <p className="tool-account" title={check?.account.reason??undefined}><Icon name="user" size={17}/>{check?.account.label??'Kiểm tra để xem tài khoản'}</p>
    <dl className="tool-facts"><div><dt>{tool.agent === 'agy' ? 'Quota model hiện tại' : 'Quota còn lại'}</dt><dd><Balance value={check?.quota}/></dd></div><div><dt>Credit còn lại</dt><dd><Balance value={check?.credits}/></dd></div></dl>
    {Boolean(check?.quotas?.length)&&<div className="quota-groups">{check?.quotas?.map((group,index)=><div className={group.remaining < 10 ? 'quota-row low' : 'quota-row'} key={index}><span>{group.group}<small>{group.window}</small></span><strong>{group.remaining}%</strong><progress max="100" value={group.remaining}/>{group.reset&&<small className="quota-reset">{group.reset}</small>}</div>)}</div>}
    {Boolean(check?.details?.length)&&<dl className="tool-status-details">{check?.details?.map((detail,index)=><div key={index}><dt>{detail.label}</dt><dd>{detail.value}</dd></div>)}</dl>}
    <div className="tool-card-footer"><p className="small-note">{check?`Đã kiểm tra ${new Date(check.checkedAt).toLocaleTimeString('vi-VN')}`:'Chỉ kiểm tra khi bạn nhấn nút.'}</p><div className="tool-actions"><button className="action-btn" disabled={Boolean(cli.checking)} onClick={()=>void cli.check(tool.agent)} aria-label={`Kiểm tra ${tool.title}`}><Icon name="refresh" size={17}/>{cli.checking===tool.agent?'Đang kiểm tra…':'Kiểm tra'}</button><button className="action-btn action-primary" disabled={Boolean(cli.launching)} onClick={()=>void cli.launch(tool.agent)} aria-label={`Mở ${tool.title}`}><Icon name="terminal" size={17}/>{cli.launching===tool.agent?'Đang mở…':'Mở CLI'}</button></div></div>
    {check&&<details className="tool-probes"><summary>Chi tiết kiểm tra</summary>{[check.quota,check.credits].filter(item=>item.remaining==null&&item.reason).map((item,index)=><p key={index}>{item.reason} · nguồn {item.source}</p>)}{check.probes.map((probe,index)=><div key={index}><code>{probe.command}</code><p>{probe.ok?'Đã đọc kết quả':'Lệnh chưa hoàn tất'} · exit {probe.exitCode??'—'}</p><pre>{probe.output??probe.summary}</pre></div>)}</details>}
  </section>;
}
export function Dashboard({plans,tasks,cli}: {plans:Plan[];tasks:Task[];cli:CliWorkspace}) {
  return <div className="dashboard-page">
    <div className="page-heading"><div><h1>Bảng điều khiển</h1><p className="muted">Công cụ của bạn, trạng thái hiện tại và lối tắt để bắt đầu.</p></div><label className="dashboard-location">Vị trí mở CLI<select aria-label="Vị trí mở CLI" value={cli.selection} onChange={event=>cli.setSelection(event.target.value)}><option value="workspace">Workspace riêng của công cụ</option>{plans.map(plan=><option key={plan.id} value={`plan:${plan.id}`}>Repo · {plan.name}</option>)}{tasks.filter(task=>!['merged','discarded'].includes(task.status)).map(task=><option key={task.id} value={`task:${task.id}`}>Worktree · {task.title}</option>)}</select></label></div>
    <p className="dashboard-note"><Icon name="info" size={19}/><span><strong>Mở CLI</strong> chuyển sang mục Terminal. <strong>Kiểm tra</strong> đọc trạng thái và hạn mức khi bạn nhấn.</span></p>
    {cli.message&&<div className="banner banner-error" role="status">{cli.message}</div>}
    <div className="tool-grid">{cli.snapshot?.tools.map(tool=><ToolCard key={tool.agent} tool={tool} cli={cli}/>)}{!cli.snapshot&&<p>Đang tải công cụ…</p>}</div>
    {Boolean(cli.snapshot?.terminalSessions.length)&&<section className="dashboard-live-sessions"><h2>Phiên đang mở</h2><div className="session-shortcuts">{cli.snapshot?.terminalSessions.map(session=><button className="action-btn" key={session.id} onClick={()=>cli.select(session.id)}><AgentMark agent={session.agent}/>{session.title}<Icon name="arrow" size={17}/></button>)}</div></section>}
  </div>;
}
