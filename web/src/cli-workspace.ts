import { useEffect, useState } from 'react';
import type { DashboardAgent, DashboardSnapshot, DashboardTool, TerminalSessionInfo } from '../../shared/dashboard.js';

class CliRequestError extends Error { constructor(readonly status: number, message: string) {super(message);} }

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, credentials: 'same-origin', ...(method !== 'GET' ? {headers:{'content-type':'application/json'},body:JSON.stringify(body ?? {})} : {}) });
  if (!response.ok) { let message = await response.text(); try { message = JSON.parse(message).message ?? message; } catch {} throw new CliRequestError(response.status,message); }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

export function useCliWorkspace(openTerminal: () => void) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [checking, setChecking] = useState<DashboardAgent | null>(null);
  const [launching, setLaunching] = useState<DashboardAgent | null>(null);
  const [selection, setSelection] = useState('workspace');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void request<DashboardSnapshot>('/api/dashboard').then(data => { if (!cancelled) {setSnapshot(data);setActiveId(data.terminalSessions[0]?.id ?? null);} }).catch(error => {if (!cancelled) setMessage(String(error));});
    return () => {cancelled = true;};
  }, []);
  const check = async (agent: DashboardAgent) => {
    setChecking(agent);setMessage(null);
    try { const tool = await request<DashboardTool>('/api/dashboard/check','POST',{agent});setSnapshot(current => current ? {...current,tools:current.tools.map(item => item.agent === agent ? tool : item)} : current); }
    catch(error){setMessage(String(error));}finally{setChecking(null);}
  };
  const launch = async (agent: DashboardAgent) => {
    setLaunching(agent);setMessage(null);
    try {
      const [kind,id] = selection.split(':');
      const session = await request<TerminalSessionInfo>('/api/terminal-sessions','POST',{agent,...(kind==='plan'?{planId:id}:kind==='task'?{taskId:id}:{})});
      setSnapshot(current => current ? {...current,terminalSessions:[...current.terminalSessions.filter(item=>item.id!==session.id),session]} : current);
      setActiveId(session.id);openTerminal();
    }catch(error){setMessage(String(error));}finally{setLaunching(null);}
  };
  const select = (id: string) => {setActiveId(id);openTerminal();};
  const close = async (id: string) => {
    const forget = () => {
      setSnapshot(current=>current?{...current,terminalSessions:current.terminalSessions.filter(item=>item.id!==id)}:current);
      setActiveId(current=>current===id?snapshot?.terminalSessions.find(item=>item.id!==id)?.id??null:current);
    };
    try {
      await request(`/api/terminal-sessions/${encodeURIComponent(id)}`,'DELETE');
      forget();
    }catch(error){if(error instanceof CliRequestError && error.status===404)forget();else setMessage(String(error));}
  };
  return {snapshot,checking,launching,selection,setSelection,activeId,message,setMessage,check,launch,select,close};
}
export type CliWorkspace = ReturnType<typeof useCliWorkspace>;
