import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardAgent, DashboardCheck, DashboardSnapshot, DashboardTool, TerminalSessionInfo } from '../../shared/dashboard.js';

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

export interface CheckOutcome {
  status: DashboardCheck['status'];
  noticeKind: NoticeKind;
  summaryVi: string;
  summaryEn: string;
}

/**
 * Phân loại kết quả kiểm tra CLI sang status, noticeKind ('success' | 'info' | 'error')
 * và thông điệp tóm tắt VI/EN.
 */
export function classifyCheckOutcome(tool: DashboardTool | null | undefined): CheckOutcome {
  const status = tool?.lastCheck?.status ?? 'unknown';
  const title = tool?.title || (tool?.agent ? String(tool.agent) : 'CLI');
  switch (status) {
    case 'ready':
      return {
        status: 'ready',
        noticeKind: 'success',
        summaryVi: `Đã kiểm tra ${title}: Sẵn sàng.`,
        summaryEn: `Checked ${title}: Ready.`,
      };
    case 'needs-login':
      return {
        status: 'needs-login',
        noticeKind: 'info',
        summaryVi: `Đã kiểm tra ${title}: Cần đăng nhập.`,
        summaryEn: `Checked ${title}: Sign-in needed.`,
      };
    case 'unavailable':
      return {
        status: 'unavailable',
        noticeKind: 'error',
        summaryVi: `Đã kiểm tra ${title}: Chưa cài đặt hoặc không khả dụng.`,
        summaryEn: `Checked ${title}: Unavailable.`,
      };
    case 'error':
      return {
        status: 'error',
        noticeKind: 'error',
        summaryVi: `Đã kiểm tra ${title}: Lỗi kiểm tra.`,
        summaryEn: `Checked ${title}: Check failed.`,
      };
    case 'unknown':
    default:
      return {
        status: 'unknown',
        noticeKind: 'info',
        summaryVi: `Đã kiểm tra ${title}: Không rõ trạng thái.`,
        summaryEn: `Checked ${title}: Status unknown.`,
      };
  }
}

/**
 * Chạy tuần tự từng lệnh kiểm tra. Một công cụ lỗi không được chặn các công cụ
 * còn lại, vì người dùng vẫn cần biết hạn mức của những công cụ kia.
 */
export async function checkAllAgents(
  agents: readonly DashboardAgent[],
  run: (agent: DashboardAgent) => Promise<void> | Promise<DashboardTool>,
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
  const [lastResults, setLastResults] = useState<Partial<Record<DashboardAgent, { status: DashboardCheck['status']; at: number }>>>({});
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
  const runCheck = useCallback(async (agent: DashboardAgent): Promise<DashboardTool> => {
    const tool = await request<DashboardTool>('/api/dashboard/check', 'POST', { agent });
    setSnapshot(current => current ? { ...current, tools: current.tools.map(item => item.agent === agent ? tool : item) } : current);
    return tool;
  }, []);

  const check = async (agent: DashboardAgent) => {
    setChecking(agent);
    setMessage(null);
    try {
      const tool = await runCheck(agent);
      setLastResults(current => ({
        ...current,
        [agent]: { status: tool.lastCheck?.status ?? 'unknown', at: Date.now() },
      }));
      const title = tool.title || snapshot?.tools.find(item => item.agent === agent)?.title || agent;
      const outcome = classifyCheckOutcome({ ...tool, title });
      setMessage(outcome.summaryVi, outcome.noticeKind);
    } catch (error) {
      setLastResults(current => ({
        ...current,
        [agent]: { status: 'error', at: Date.now() },
      }));
      setMessage(String(error), 'error');
    } finally {
      setChecking(null);
    }
  };

  const checkAll = async () => {
    const agents = (snapshot?.tools ?? []).map(item => item.agent);
    if (!agents.length || checkingAll.active) return;
    setMessage(`Đang kiểm tra lần lượt ${agents.length} công cụ…`, 'info');
    setCheckingAll({ active: true, done: 0, total: agents.length, agent: agents[0] ?? null });

    const checkedTools: DashboardTool[] = [];
    const result = await checkAllAgents(agents, async (agent) => {
      setChecking(agent);
      try {
        const tool = await runCheck(agent);
        checkedTools.push(tool);
        setLastResults(current => ({
          ...current,
          [agent]: { status: tool.lastCheck?.status ?? 'unknown', at: Date.now() },
        }));
      } catch (cause) {
        setLastResults(current => ({
          ...current,
          [agent]: { status: 'error', at: Date.now() },
        }));
        throw cause;
      } finally {
        setChecking(null);
      }
    }, { onProgress: (state) => setCheckingAll({ active: true, ...state }) });

    setChecking(null);
    setCheckingAll({ active: false, ...result });

    const getToolTitle = (agent: DashboardAgent) =>
      checkedTools.find(t => t.agent === agent)?.title ||
      snapshot?.tools.find(item => item.agent === agent)?.title ||
      agent;

    const failedOrUnavailable: { agent: DashboardAgent; title: string; status: 'error' | 'unavailable' }[] = [];
    let readyCount = 0;
    let needsLoginCount = 0;
    let unknownCount = 0;

    for (const failure of result.failures) {
      failedOrUnavailable.push({ agent: failure.agent, title: getToolTitle(failure.agent), status: 'error' });
    }

    for (const tool of checkedTools) {
      const st = tool.lastCheck?.status ?? 'unknown';
      if (st === 'ready') {
        readyCount += 1;
      } else if (st === 'needs-login') {
        needsLoginCount += 1;
      } else if (st === 'unavailable') {
        failedOrUnavailable.push({ agent: tool.agent, title: tool.title || tool.agent, status: 'unavailable' });
      } else if (st === 'error') {
        failedOrUnavailable.push({ agent: tool.agent, title: tool.title || tool.agent, status: 'error' });
      } else {
        unknownCount += 1;
      }
    }

    if (failedOrUnavailable.length > 0) {
      const names = failedOrUnavailable.map(item => item.title).join(', ');
      setMessage(`Đã kiểm tra ${result.done}/${result.total} công cụ · ${failedOrUnavailable.length} công cụ lỗi hoặc không khả dụng: ${names}.`, 'error');
    } else if (needsLoginCount > 0 || unknownCount > 0) {
      const parts: string[] = [];
      if (readyCount > 0) parts.push(`${readyCount} sẵn sàng`);
      if (needsLoginCount > 0) parts.push(`${needsLoginCount} cần đăng nhập`);
      if (unknownCount > 0) parts.push(`${unknownCount} chưa xác định`);
      setMessage(`Đã kiểm tra ${result.done}/${result.total} công cụ: ${parts.join(', ')}.`, 'info');
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
    lastResults,
    launch,
    select,
    close,
  };
}
export type CliWorkspace = ReturnType<typeof useCliWorkspace>;
