import { lazy, Suspense, useRef, useState, type KeyboardEvent } from 'react';
import type { DashboardTool, TerminalSessionInfo } from '../../../shared/dashboard.js';
import type { CliWorkspace } from '../cli-workspace.js';
import { copyText } from '../desktop.js';
import { AgentMark, Icon } from './Icon.js';
import { ConfirmDialog } from './ConfirmDialog.js';
const TerminalPanel=lazy(()=>import('./TerminalPanel.js').then(module=>({default:module.TerminalPanel})));

/** Horizontal tablist keyboard model: arrows wrap, Home/End jump to the edges. */
export function tabIndexForKey(key: string, current: number, count: number): number | null {
  if (count <= 0) return null;
  switch (key) {
    case 'ArrowRight': return (current + 1) % count;
    case 'ArrowLeft': return (current - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return null;
  }
}

function Session({session,tool,cli,onClose}: {session:TerminalSessionInfo;tool?:DashboardTool;cli:CliWorkspace;onClose:()=>void}) {
  const send=useRef<((text:string)=>void)|null>(null);
  const [ready,setReady]=useState(false);
  return <><div className="terminal-session-panel"><Suspense fallback={<p>Đang kết nối terminal...</p>}><TerminalPanel fill socketPath={`/ws/terminal?sessionId=${encodeURIComponent(session.id)}`} title={tool?.title??session.agent} subtitle={session.cwd} closeLabel="Kết thúc tiến trình" onClose={onClose} onInputReady={writer=>{send.current=writer;setReady(Boolean(writer));}}/></Suspense></div>
    <details className="terminal-commands"><summary><Icon name="commands" size={18}/>Lệnh và phím tắt<span>{tool?.title}</span></summary><div className="command-suggestions">{tool?.suggestions.map(hint=><div className="command-hint" key={hint.id}><div><strong>{hint.label}</strong><code>{hint.command==='\u0003'?'Ctrl+C':hint.command}</code><p>{hint.description}</p><span>{hint.context==='interactive'?'Trong phiên CLI':'Tại CMD / PowerShell'}</span></div><div className="hint-actions"><button className="text-button" onClick={()=>void copyText(hint.command==='\u0003'?'Ctrl+C':hint.command).then(()=>cli.setMessage('Đã sao chép lệnh.')).catch(error=>cli.setMessage(String(error)))}><Icon name="copy" size={15}/>Sao chép</button>{hint.context==='interactive'&&<button className="text-button" disabled={!ready} onClick={()=>send.current?.(hint.command)}>{hint.command==='\u0003'?'Gửi Ctrl+C':'Điền vào terminal'}<Icon name="arrow" size={15}/></button>}</div></div>)}</div></details></>;
}
export function TerminalPage({cli,onDashboard}: {cli:CliWorkspace;onDashboard:()=>void}) {
  const [closing,setClosing]=useState<TerminalSessionInfo|null>(null);
  const tabRefs=useRef<Record<string,HTMLButtonElement|null>>({});
  const sessions=cli.snapshot?.terminalSessions??[];
  const activeIndex=Math.max(0,sessions.findIndex(session=>session.id===cli.activeId));
  const moveTab=(event:KeyboardEvent<HTMLButtonElement>,index:number)=>{
    const next=tabIndexForKey(event.key,index,sessions.length);
    if(next===null)return;
    event.preventDefault();
    const target=sessions[next];
    if(!target)return;
    cli.select(target.id);
    tabRefs.current[target.id]?.focus();
  };
  return <div className="terminal-page">
    <div className="terminal-page-heading"><div><h1>Terminal</h1><p className="muted">Phiên CLI trực tiếp trên máy của bạn.</p></div><button className="action-btn" onClick={onDashboard}><Icon name="plus" size={18}/>Mở công cụ</button></div>
    {cli.message&&<div className="terminal-message" role="status">{cli.message}</div>}
    {!sessions.length?<div className="terminal-empty"><Icon name="terminal" size={40}/><h2>Mở một phiên terminal</h2><p>Chọn công cụ để bắt đầu. Mỗi tab giữ riêng tiến trình và lịch sử cuộn.</p><div className="session-shortcuts">{cli.snapshot?.tools.map(tool=><button className="action-btn" key={tool.agent} disabled={Boolean(cli.launching)} aria-label={`Mở ${tool.title}`} onClick={()=>void cli.launch(tool.agent)}><AgentMark agent={tool.agent} label/><Icon name="plus" size={17}/></button>)}</div></div>:<><div className="terminal-tablist" role="tablist" aria-label="Phiên CLI" aria-orientation="horizontal">{sessions.map((session,index)=><div className={`terminal-tab ${cli.activeId===session.id?'active':''}`} key={session.id}><button id={`tab-${session.id}`} role="tab" ref={element=>{tabRefs.current[session.id]=element;}} aria-selected={cli.activeId===session.id} aria-controls={`cli-${session.id}`} tabIndex={index===activeIndex?0:-1} onKeyDown={event=>moveTab(event,index)} onClick={()=>cli.select(session.id)}><AgentMark agent={session.agent}/><span>{session.title}</span></button><button className="icon-button" aria-label={`Kết thúc tiến trình ${session.title}`} onClick={()=>setClosing(session)}><Icon name="close" size={16}/></button></div>)}</div><div className="terminal-session-stack">{sessions.map(session=><section role="tabpanel" id={`cli-${session.id}`} aria-labelledby={`tab-${session.id}`} tabIndex={0} key={session.id} hidden={cli.activeId!==session.id} className="terminal-session"><Session session={session} tool={cli.snapshot?.tools.find(tool=>tool.agent===session.agent)} cli={cli} onClose={()=>setClosing(session)}/></section>)}</div></>}
    {closing&&<ConfirmDialog title="Kết thúc tiến trình CLI?" message={`Dừng ${closing.title} và đóng tiến trình của phiên này?`} confirmLabel="Kết thúc tiến trình" danger onConfirm={()=>{void cli.close(closing.id);setClosing(null);}} onCancel={()=>setClosing(null)}/>}
  </div>;
}
