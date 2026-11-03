import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { AgentId, Plan, Task } from '../../../shared/types.js';
import { api, type AgentInfo } from '../api.js';
import { Icon } from './Icon.js';

/** The composer runs as a two-step assistant: pick the project, then hand over the work. */
export type ComposerStep = 1 | 2;

export interface RepoPathCheck {
  status: 'idle' | 'ok' | 'unknown' | 'error';
  message: string;
}

const AGENT_IDS: AgentId[] = ['codex', 'qodercli', 'agy', 'opencode'];
const NEW_PLAN = '__new__';
export const COMPOSER_PREFS_KEY = 'fleet.composer';
/** Drive letter (`C:\`, `C:/`) or a UNC share (`\\server\share`). */
const WINDOWS_ABSOLUTE_PATH = /^(?:[a-zA-Z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/;

/** localStorage throws in private mode and inside locked-down webviews; remembering is optional. */
function composerStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage; } catch { return null; }
}

export function readComposerPrefs(storage: Storage | null = composerStorage()): { agent?: AgentId; planId?: string } {
  if (!storage) return {};
  try {
    const raw = storage.getItem(COMPOSER_PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { agent?: unknown; planId?: unknown } | null;
    const prefs: { agent?: AgentId; planId?: string } = {};
    if (typeof parsed?.agent === 'string' && (AGENT_IDS as string[]).includes(parsed.agent)) prefs.agent = parsed.agent as AgentId;
    // `__new__` is a transient choice, not a plan that can be restored.
    if (typeof parsed?.planId === 'string' && parsed.planId.length > 0 && parsed.planId !== NEW_PLAN) prefs.planId = parsed.planId;
    return prefs;
  } catch { return {}; }
}

export function saveComposerPrefs(prefs: { agent: AgentId; planId: string }, storage: Storage | null = composerStorage()): void {
  if (!storage) return;
  try { storage.setItem(COMPOSER_PREFS_KEY, JSON.stringify(prefs)); } catch { /* Quota or blocked storage: ignore. */ }
}

function normalizeRepoPath(value: string): string {
  return value.trim().replace(/^"|"$/g, '').replace(/\//g, '\\').replace(/\\+$/, '').toLocaleLowerCase();
}

/**
 * Best-effort check while the field is blurred. `/api/plans` is the only
 * existing endpoint that knows about a repository, so a known repo is
 * confirmed and an unknown absolute path is reported as unconfirmed instead of
 * blocking a legitimate new repo. The server still verifies Git when the plan
 * is created, and that verdict is surfaced in the composer error banner.
 */
export function checkRepoPath(value: string, plans: Plan[]): RepoPathCheck {
  const raw = value.trim().replace(/^"|"$/g, '');
  if (!raw) return { status: 'idle', message: '' };
  if (!WINDOWS_ABSOLUTE_PATH.test(raw)) return { status: 'error', message: 'Đường dẫn phải là đường dẫn tuyệt đối, ví dụ C:\\Projects\\my-app.' };
  const wanted = normalizeRepoPath(raw);
  const known = plans.find((plan) => normalizeRepoPath(plan.repoPath) === wanted);
  if (known) return { status: 'ok', message: `Đã xác nhận: Git repo của plan "${known.name}".` };
  return { status: 'unknown', message: 'Chưa có plan nào dùng đường dẫn này. Hệ thống sẽ kiểm tra Git khi tạo plan.' };
}

const stepListStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, listStyle: 'none', margin: '0 0 18px', padding: 0 };
const rowStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10 };
const inlineNoteStyle: CSSProperties = { margin: 0 };

function stepChipStyle(active: boolean): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 6, padding: '5px 11px', borderRadius: 999, fontSize: 12,
    border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
    background: active ? 'var(--accent-soft)' : 'transparent',
    color: active ? 'var(--text)' : 'var(--muted)', fontWeight: active ? 600 : 500,
  };
}

export function TaskComposer({ plans, initialPlanId, onClose, onCreated }: { plans: Plan[]; initialPlanId?: string; onClose: () => void; onCreated: (task: Task) => void }) {
  const [prefs] = useState(() => readComposerPrefs());
  const rememberedPlan = prefs.planId && plans.some((plan) => plan.id === prefs.planId) ? prefs.planId : undefined;
  const [step, setStep] = useState<ComposerStep>(1);
  const [planId, setPlanId] = useState(rememberedPlan ?? initialPlanId ?? plans[0]?.id ?? NEW_PLAN);
  const [planName, setPlanName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [repoCheck, setRepoCheck] = useState<RepoPathCheck>({ status: 'idle', message: '' });
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [check, setCheck] = useState('');
  const [agent, setAgent] = useState<AgentId>(prefs.agent ?? 'codex');
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [commandPolicy, setCommandPolicy] = useState<'ask' | 'check-only' | 'auto'>('auto');
  const [allowedCommands, setAllowedCommands] = useState('');
  const planRef = useRef<HTMLSelectElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => { (step === 1 ? planRef.current : titleRef.current)?.focus(); }, [step]);
  const detect = async () => { setDetecting(true); try { const list = await api.agents(); setAgents(list); const ready = list.find((entry) => entry.ok); if (ready && !list.some((entry) => entry.id === agent)) setAgent(ready.id); setDetectionError(null); } catch { setDetectionError('Chưa dò được agent. Có thể chọn agent và thử giao việc.'); } finally { setDetecting(false); } };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape);
  }, [onClose, busy]);

  const newPlan = planId === NEW_PLAN;
  const projectReady = newPlan
    ? planName.trim().length > 0 && repoPath.trim().length > 0 && repoCheck.status !== 'error'
    : true;

  async function submit() {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      let targetId = planId;
      if (targetId === NEW_PLAN) {
        const plan = await api.createPlan({ name: planName.trim(), repoPath: repoPath.trim() });
        targetId = plan.id;
        // Preserve a successful plan if agent startup fails, so retry never creates duplicates.
        setPlanId(plan.id);
        setRepoCheck(checkRepoPath(plan.repoPath, [...plans, plan]));
      }
      saveComposerPrefs({ agent, planId: targetId });
      const allowed = allowedCommands.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const task = await api.createTask({ planId: targetId, agent, title: title.trim(), brief, ...(check.trim() ? { checkCmd: check.trim() } : {}), ...(agent === 'agy' ? { commandPolicy, ...(commandPolicy === 'check-only' && allowed.length > 0 ? { allowedCommands: allowed } : {}) } : {}) });
      onCreated(task);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (newPlan && /invalid git repository/i.test(message)) {
        setRepoCheck({ status: 'error', message: 'Đường dẫn không phải Git repo.' });
        setStep(1);
        setError('Đường dẫn không phải Git repo. Kiểm tra lại đường dẫn rồi thử lại.');
      } else setError(message);
    } finally { setBusy(false); }
  }

  function goNext() {
    if (!projectReady) { setError(newPlan ? 'Điền tên plan và đường dẫn Git repo trước khi sang bước giao việc.' : 'Chọn một plan trước khi sang bước giao việc.'); return; }
    setError(null); setStep(2);
  }

  /** One primary action for the button, the form's Enter key and Ctrl+Enter. */
  function primaryAction(event?: FormEvent | ReactKeyboardEvent) {
    event?.preventDefault();
    if (step === 1) goNext(); else void submit();
  }

  const choices: Array<Pick<AgentInfo, 'id' | 'ok'> & { reason?: string; version?: string }> = agents.length ? agents : AGENT_IDS.map((id) => ({ id, ok: true }));
  const selected = agents.find((entry) => entry.id === agent);
  const badge = detecting
    ? { label: 'Đang kiểm tra CLI...', className: '' }
    : selected ? (selected.ok ? { label: selected.version ? `CLI sẵn sàng · ${selected.version}` : 'CLI sẵn sàng', className: 'status-done' } : { label: 'CLI chưa sẵn sàng', className: 'status-failed' })
      : { label: 'Chưa kiểm tra CLI', className: '' };
  const projectLabel = newPlan ? (planName.trim() || 'Plan mới') : plans.find((plan) => plan.id === planId)?.name ?? planId;

  return <div className="modal-overlay" role="presentation"><section className="modal composer-modal" role="dialog" aria-modal="true" aria-labelledby="composer-title">
    <div className="composer-heading"><div><span className="eyebrow">AGENT WORKSPACE</span><h2 id="composer-title">Giao một công việc mới</h2></div><button className="icon-button" title="Đóng tạo task" aria-label="Đóng tạo task" onClick={onClose} disabled={busy}><Icon name="close" /></button></div>
    <form onSubmit={primaryAction} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) primaryAction(event); }} data-step={step}>
      <ol className="composer-steps" aria-label="Các bước giao việc" style={stepListStyle}>
        <li><span className="composer-step" aria-current={step === 1 ? 'step' : undefined} style={stepChipStyle(step === 1)}>1. Dự án</span></li>
        <li><span className="composer-step" aria-current={step === 2 ? 'step' : undefined} style={stepChipStyle(step === 2)}>2. Giao việc</span></li>
      </ol>
      {step === 1 ? <>
        <div className="form-row"><label className="field">Dự án / plan<select ref={planRef} aria-label="Dự án / plan" value={planId} onChange={(event) => { setPlanId(event.target.value); setRepoCheck({ status: 'idle', message: '' }); setError(null); }}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}{planId !== NEW_PLAN && !plans.some((plan) => plan.id === planId) && <option value={planId}>{planName || planId}</option>}<option value={NEW_PLAN}>+ Tạo plan mới</option></select></label><label className="field">Agent<select aria-label="Agent" value={agent} onChange={(event) => setAgent(event.target.value as AgentId)}>{choices.map((entry) => <option key={entry.id} value={entry.id}>{entry.id}{entry.ok ? '' : ' · chưa sẵn sàng'}</option>)}{!choices.some((entry) => entry.id === agent) && <option value={agent}>{agent}</option>}</select></label></div>
        <div className="composer-agent-check" style={rowStyle}><span className={`status-badge ${badge.className}`} role="status">{badge.label}</span><span className="small-note" style={inlineNoteStyle}>{agents.length ? 'Từ lần kiểm tra thủ công gần nhất.' : 'Chưa chạy kiểm tra CLI.'}</span><button type="button" className="text-button" onClick={() => void detect()} disabled={detecting}>{detecting ? 'Đang kiểm tra...' : 'Kiểm tra agent'}</button>{selected && !selected.ok && selected.reason && <span className="small-note" style={inlineNoteStyle}>{selected.reason}</span>}</div>
        {newPlan && <div className="new-plan-fields"><label className="field">Tên plan<input required value={planName} onChange={(event) => setPlanName(event.target.value)} placeholder="Tên dự án hoặc đợt công việc" /></label><label className="field">Đường dẫn Git repository<input required value={repoPath} onChange={(event) => { setRepoPath(event.target.value); if (repoCheck.status !== 'idle') setRepoCheck(checkRepoPath(event.target.value, plans)); }} onBlur={() => setRepoCheck(checkRepoPath(repoPath, plans))} aria-invalid={repoCheck.status === 'error' ? true : undefined} aria-describedby={repoCheck.status === 'idle' ? undefined : 'composer-repo-status'} placeholder="C:\\Projects\\my-app" spellCheck={false} /></label>{/* Reserved height: revealing this line on blur must not move the buttons under the pointer and swallow a click. */}<p id="composer-repo-status" role="status" className="small-note" style={{ margin: '-9px 0 12px', minHeight: '3.2em', color: repoCheck.status === 'error' ? 'var(--red)' : repoCheck.status === 'ok' ? 'var(--green)' : 'var(--muted)' }}>{repoCheck.message}</p></div>}
        <p className="composer-note">Bước 1 chọn dự án và agent. Bước 2 mô tả công việc cần giao.</p>
      </> : <>
        <p className="composer-project-summary small-note" style={{ margin: '0 0 14px' }}>Dự án: <strong>{projectLabel}</strong> · Agent: <strong>{agent}</strong></p>
        <label className="field">Tên công việc<input ref={titleRef} required maxLength={240} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ví dụ: Hoàn thiện màn hình cài đặt" /></label>
        <label className="field">Nội dung giao việc<textarea required rows={6} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Mục tiêu, phạm vi thay đổi và tiêu chí hoàn thành..." /></label>
        <label className="field">Lệnh kiểm tra <span className="muted">(tuỳ chọn)</span><input value={check} onChange={(event) => setCheck(event.target.value)} placeholder="npm test" spellCheck={false} /></label>
        {agent === 'agy' && <fieldset className="command-policy"><legend>Quyền lệnh AGY cho lần chạy này</legend><label className="check-field"><input type="checkbox" checked={commandPolicy === 'auto'} onChange={(event) => setCommandPolicy(event.target.checked ? 'auto' : 'ask')} />Tự duyệt lệnh terminal (task này)</label><p className="small-note">Quyền chỉ áp dụng lần chạy này; ghi log. Agent có thể chạy lệnh trong worktree để hoàn thành công việc.</p>{commandPolicy !== 'auto' && <label className="field">Phạm vi cho phép<select aria-label="Phạm vi quyền AGY" value={commandPolicy} onChange={(event) => setCommandPolicy(event.target.value as 'ask' | 'check-only')}><option value="ask">Hỏi quyền theo mặc định của AGY</option><option value="check-only">Chỉ lệnh kiểm tra và danh sách cho phép</option></select></label>}{commandPolicy === 'check-only' && <label className="field">Lệnh được cho phép thêm<textarea rows={3} value={allowedCommands} onChange={(event) => setAllowedCommands(event.target.value)} placeholder={'npm test\nnode check.cjs'} /></label>}</fieldset>}
        <p className="composer-note">Agent làm việc trong Git worktree riêng. Bạn xem thay đổi và duyệt Merge khi hoàn tất. Nhấn Ctrl+Enter để giao việc.</p>
      </>}
      {detectionError && <p className="muted">{detectionError}</p>}{error && <p className="banner banner-error" role="alert">{error}</p>}
      <div className="modal-actions">{step === 2 && <button className="action-btn" type="button" onClick={() => { setError(null); setStep(1); }} disabled={busy}>Quay lại</button>}<button className="action-btn" type="button" onClick={onClose} disabled={busy}>Huỷ</button>{step === 1
        ? <button className="action-btn action-primary" type="submit" disabled={busy}>Tiếp tục<Icon name="arrow" size={16} /></button>
        : <button className="action-btn action-primary" type="submit" disabled={busy}>{busy ? 'Đang chuẩn bị...' : 'Giao việc'}<Icon name="arrow" size={16} /></button>}</div>
    </form>
  </section></div>;
}
