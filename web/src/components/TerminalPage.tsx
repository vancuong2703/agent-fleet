import { lazy, Suspense, useRef, useState } from 'react';
import type { DashboardTool, TerminalSessionInfo } from '../../../shared/dashboard.js';
import type { CliWorkspace } from '../cli-workspace.js';
import { copyText } from '../desktop.js';
import { AgentMark, Icon } from './Icon.js';
import { ConfirmDialog } from './ConfirmDialog.js';
const TerminalPanel=lazy(()=>import('./TerminalPanel.js').then(module=>({default:module.TerminalPanel})));

function Session({session,tool,cli,onClose}: {session:TerminalSessionInfo;tool?:DashboardTool;cli:CliWorkspace;onClose:()=>void}) {
  const send=useRef<((text:string)=>void)|null>(null);
  const [ready,setReady]=useState(false);
  return <><div className="terminal-session-panel"><Suspense fallback={<p>Đang kết nối terminal…</p>}><TerminalPanel fill socketPath={`/ws/terminal?sessionId=${encodeURIComponent(session.id)}`} title={tool?.title??session.agent} subtitle={session.cwd} closeLabel="Kết thúc phiên" onClose={onClose} onInputReady={writer=>{send.current=writer;setReady(Boolean(writer));}}/></Suspense></div>
    <details className="terminal-commands"><summary><Icon name="commands" size={18}/>Lệnh và phím tắt<span>{tool?.title}</span></summary><div className="command-suggestions">{tool?.suggestions.map(hint=><div className="command-hint" key={hint.id}><div><strong>{hint.label}</strong><code>{hint.command==='\u0003'?'Ctrl+C':hint.command}</code><p>{hint.description}</p><span>{hint.context==='interactive'?'Trong phiên CLI':'Tại CMD / PowerShell'}</span></div><div className="hint-actions"><button className="text-button" onClick={()=>void copyText(hint.command==='\u0003'?'Ctrl+C':hint.command).then(()=>cli.setMessage('Đã sao chép lệnh.')).catch(error=>cli.setMessage(String(error)))}><Icon name="copy" size={15}/>Sao chép</button>{hint.context==='interactive'&&<button className="text-button" disabled={!ready} onClick={()=>send.current?.(hint.command)}>{hint.command==='\u0003'?'Gửi Ctrl+C':'Điền vào terminal'}<Icon name="arrow" size={15}/></button>}</div></div>)}</div></details></>;
}
export function TerminalPage({cli,onDashboard}: {cli:CliWorkspace;onDashboard:()=>void}) {
  const [closing,setClosing]=useState<TerminalSessionInfo|null>(null);
  const sessions=cli.snapshot?.terminalSessions??[];
  return <div className="terminal-page">
    <div className="terminal-page-heading"><div><h1>Terminal</h1><p className="muted">Phiên CLI trực tiếp trên máy của bạn.</p></div><button className="action-btn" onClick={onDashboard}><Icon name="plus" size={18}/>Mở công cụ</button></div>
    {cli.message&&<div className="terminal-message" role="status">{cli.message}</div>}
    {!sessions.length?<div className="terminal-empty"><Icon name="terminal" size={40}/><h2>Mở một phiên terminal</h2><p>Chọn công cụ để bắt đầu. Mỗi tab giữ riêng tiến trình và lịch sử cuộn.</p><div className="session-shortcuts">{cli.snapshot?.tools.map(tool=><button className="action-btn" key={tool.agent} disabled={Boolean(cli.launching)} aria-label={`Mở ${tool.title}`} onClick={()=>void cli.launch(tool.agent)}><AgentMark agent={tool.agent} label/><Icon name="plus" size={17}/></button>)}</div></div>:<><div className="terminal-tablist" role="tablist" aria-label="Phiên CLI">{sessions.map(session=><div className={`terminal-tab ${cli.activeId===session.id?'active':''}`} key={session.id}><button role="tab" aria-selected={cli.activeId===session.id} aria-controls={`cli-${session.id}`} onClick={()=>cli.select(session.id)}><AgentMark agent={session.agent}/><span>{session.title}</span></button><button className="icon-button" aria-label={`Kết thúc ${session.title}`} onClick={()=>setClosing(session)}><Icon name="close" size={16}/></button></div>)}</div><div className="terminal-session-stack">{sessions.map(session=><section role="tabpanel" id={`cli-${session.id}`} key={session.id} hidden={cli.activeId!==session.id} className="terminal-session"><Session session={session} tool={cli.snapshot?.tools.find(tool=>tool.agent===session.agent)} cli={cli} onClose={()=>setClosing(session)}/></section>)}</div></>}
    {closing&&<ConfirmDialog title="Kết thúc phiên CLI?" message={`Dừng ${closing.title} và đóng tiến trình của phiên này?`} confirmLabel="Kết thúc" danger onConfirm={()=>{void cli.close(closing.id);setClosing(null);}} onCancel={()=>setClosing(null)}/>}
  </div>;
}
