import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardAgent, DashboardSnapshot, DashboardTool, TerminalSessionInfo } from '../../shared/dashboard.js';

class CliRequestError extends Error { constructor(readonly status: number, message: string) {super(message);} }

async function request<T>(url: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(url, { method, credentials: 'same-origin', ...(method !== 'GET' ? {headers:{'content-type':'application/json'},body:JSON.stringify(body ?? {})} : {}) });
  if (!response.ok) { let message = await response.text(); try { message = JSON.parse(message).message ?? message; } catch {} throw new CliRequestError(response.status,message); }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

/**
 * Loại thông báo. `success` và `info` là tin tốt/nhẹ và không bao giờ được hiển thị
 * bằng kiểu lỗi; chỉ `error` mới có màu đỏ.
 */
export type NoticeKind = 'success' | 'info' | 'error';

export interface Notice { text: string; kind: NoticeKind; token: number }

export interface CheckAllProgress { done: number; total: number; agent: DashboardAgent | null }

export interface CheckAllResult extends CheckAllProgress {
  failures: { agent: DashboardAgent; message: string }[];
}

/**
 * Chạy tuần tự từng lệnh kiểm tra. Một công cụ lỗi không được chặn các công cụ
 * còn lại, vì người dùng vẫn cần biết hạn mức của những công cụ kia.
 */
export async function checkAllAgents(
  agents: readonly DashboardAgent[],
  run: (agent: DashboardAgent) => Promise<void>,
  options: { onProgress?: (state: CheckAllProgress) => void } = {},
): Promise<CheckAllResult> {
  const failures: CheckAllResult['failures'] = [];
  let done = 0;
  options.onProgress?.({ done, total: agents.length, agent: agents[0] ?? null });
  for (const [index, agent] of agents.entries()) {
    try {
      await run(agent);
      done += 1;
    } catch (cause) {
      failures.push({ agent, message: cause instanceof Error ? cause.message : String(cause) });
    }
    options.onProgress?.({ done, total: agents.length, agent: agents[index + 1] ?? null });
  }
  return { done, total: agents.length, agent: null, failures };
}

/**Toast thành công tự ẩn sau 3 giây. */
const SUCCESS_TTL_MS = 3_000;

export function useCliWorkspace(openTerminal: () => void) {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [checking, setChecking] = useState<DashboardAgent | null>(null);
  const [launching, setLaunching] = useState<DashboardAgent | null>(null);
  const [selection, setSelection] = useState('workspace');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [checkingAll, setCheckingAll] = useState<CheckAllProgress & { active: boolean }>({ active: false, done: 0, total: 0, agent: null });
  const noticeToken = useRef(0);

  /**
   * Giữ nguyên chữ ký cũ (`setMessage(text)`) cho mọi nơi đang gọi; chỉ thêm
   * loại thông báo để dashboard phân biệt được toast xanh và lỗi đỏ.
   */
  const setMessage = useCallback((text: string | null, kind: NoticeKind = 'error') => {
    noticeToken.current += 1;
    setNotice(text === null ? null : { text, kind, token: noticeToken.current });
  }, []);

  // Toast thành công tự biến mất, nhưng không được xoá một thông báo mới hơn.
  useEffect(() => {
    if (!notice || notice.kind !== 'success') return;
    const timer = window.setTimeout(() => {
      setNotice((current) => (current && current.token === notice.token ? null : current));
    }, SUCCESS_TTL_MS);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    let cancelled = false;
    void request<DashboardSnapshot>('/api/dashboard').then(data => { if (!cancelled) {setSnapshot(data);setActiveId(data.terminalSessions[0]?.id ?? null);} }).catch(error => {if (!cancelled) setMessage(String(error));});
    return () => {cancelled = true;};
  }, [setMessage]);

  /** Gọi API kiểm tra một công cụ và cập nhật snapshot; ném lỗi cho nơi gọi xử lý. */
  const runCheck = useCallback(async (agent: DashboardAgent) => {
    const tool = await request<DashboardTool>('/api/dashboard/check','POST',{agent});
    setSnapshot(current => current ? {...current,tools:current.tools.map(item => item.agent === agent ? tool : item)} : current);
  },[]);

  const check = async (agent: DashboardAgent) => {
    setChecking(agent);setMessage(null);
    try {
      await runCheck(agent);
      const title = snapshot?.tools.find(item => item.agent === agent)?.title ?? agent;
      setMessage(`Đã kiểm tra ${title}.`, 'success');
    }catch(error){setMessage(String(error));}finally{setChecking(null);}
  };

  const checkAll = async () => {
    const agents = (snapshot?.tools ?? []).map(item => item.agent);
    if (!agents.length || checkingAll.active) return;
    setMessage(`Đang kiểm tra lần lượt ${agents.length} công cụ…`, 'info');
    setCheckingAll({ active: true, done: 0, total: agents.length, agent: agents[0] ?? null });
    const result = await checkAllAgents(agents, async (agent) => {
      setChecking(agent);
      await runCheck(agent);
      setChecking(null);
    }, { onProgress: (state) => setCheckingAll({ active: true, ...state }) });
    setChecking(null);
    setCheckingAll({ active: false, ...result });
    const failed = result.failures.length;
    if (failed) {
      const names = result.failures.map(item => snapshot?.tools.find(tool => tool.agent === item.agent)?.title ?? item.agent).join(', ');
      setMessage(`Đã kiểm tra ${result.done}/${result.total} công cụ · ${failed} công cụ lỗi: ${names}.`, 'error');
    } else {
      setMessage(`Đã kiểm tra ${result.done}/${result.total} công cụ.`, 'success');
    }
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
  return {
    snapshot,
    checking,
    launching,
    selection,
    setSelection,
    activeId,
    message: notice?.text ?? null,
    messageKind: notice?.kind ?? 'info',
    setMessage,
    check,
    checkAll,
    checkingAll,
    launch,
    select,
    close,
  };
}
export type CliWorkspace = ReturnType<typeof useCliWorkspace>;
