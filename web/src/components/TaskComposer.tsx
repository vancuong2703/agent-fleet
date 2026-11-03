import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react';
import type { RepositoryValidation } from '../../../shared/repository.js';
import type { AgentId, Plan, Task } from '../../../shared/types.js';
import { api, type AgentInfo } from '../api.js';
import { Icon } from './Icon.js';

/** The composer runs as a two-step assistant: pick the project, then hand over the work. */
export type ComposerStep = 1 | 2;

export interface RepoPathCheck {
  status: 'idle' | 'ok' | 'unknown' | 'error';
  message: string;
}

/**
 * `hint` is a local syntax/known-plan hint only. The authoritative verdict
 * (`valid` / `invalid` / `failed`) always comes from the repository validation
 * endpoint, so a newly typed path is never certified by plan lookup alone.
 */
export type RepoValidationStatus = 'idle' | 'hint' | 'checking' | 'valid' | 'invalid' | 'failed';

export interface RepoValidation {
  status: RepoValidationStatus;
  message: string;
  /** Canonical Git root returned by the server; only set for `valid`. */
  root: string | null;
  /** Cleaned input this verdict belongs to. */
  input: string;
}

const IDLE_VALIDATION: RepoValidation = { status: 'idle', message: '', root: null, input: '' };

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

export function saveComposerPrefs(prefs: { agent: AgentId; planId?: string }, storage: Storage | null = composerStorage()): void {
  if (!storage) return;
  try {
    const payload: { agent: AgentId; planId?: string } = { agent: prefs.agent };
    if (prefs.planId) payload.planId = prefs.planId;
    storage.setItem(COMPOSER_PREFS_KEY, JSON.stringify(payload));
  } catch { /* Quota or blocked storage: ignore. */ }
}

/**
 * Explorer's "Copy as path" wraps the path in double quotes. Strip only a
 * matching surrounding pair, never a stray quote in the middle of the path.
 */
export function cleanRepoPath(value: string): string {
  let cleaned = value.trim();
  if (cleaned.length >= 2 && cleaned.startsWith('"') && cleaned.endsWith('"')) cleaned = cleaned.slice(1, -1).trim();
  return cleaned;
}

function normalizeRepoPath(value: string): string {
  return cleanRepoPath(value).replace(/\//g, '\\').replace(/\\+$/, '').toLocaleLowerCase();
}

/**
 * Map the validation endpoint response to composer state. A server-side Git
 * timeout is `valid: false` but retryable, so it must offer "Thử lại" instead
 * of reading like a definitive "not a repository" verdict.
 */
export function repoValidationFromResponse(response: RepositoryValidation, input: string): RepoValidation {
  if (response.valid && response.repoPath) {
    const branch = response.branch ? ` · nhánh ${response.branch}` : '';
    return { status: 'valid', message: `Git repo hợp lệ${branch}.`, root: response.repoPath, input };
  }
  const message = response.message || 'Đường dẫn không phải Git repo.';
  return { status: /thử lại/i.test(message) ? 'failed' : 'invalid', message, root: null, input };
}

/**
 * Local hint shown while typing and on blur. A known plan path or an unknown
 * absolute path is deliberately *not* treated as a verified Git repository;
 * the async `api.validateRepository` call decides that.
 */
export function checkRepoPath(value: string, plans: Plan[]): RepoPathCheck {
  const raw = cleanRepoPath(value);
  if (!raw) return { status: 'idle', message: '' };
  if (!WINDOWS_ABSOLUTE_PATH.test(raw)) return { status: 'error', message: 'Đường dẫn phải là đường dẫn tuyệt đối, ví dụ C:\\Projects\\my-app.' };
  const wanted = normalizeRepoPath(raw);
  const known = plans.find((plan) => normalizeRepoPath(plan.repoPath) === wanted);
  if (known) return { status: 'ok', message: `Đã dùng cho plan "${known.name}". Vẫn cần kiểm tra Git.` };
  return { status: 'unknown', message: 'Chưa có plan nào dùng đường dẫn này. Hệ thống sẽ kiểm tra Git khi rời ô nhập.' };
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

function repoStatusColor(status: RepoValidationStatus): string {
  if (status === 'invalid') return 'var(--red)';
  if (status === 'valid') return 'var(--green)';
  if (status === 'failed') return 'var(--amber)';
  return 'var(--muted)';
}

export function TaskComposer({ plans, initialPlanId, onClose, onCreated }: { plans: Plan[]; initialPlanId?: string; onClose: () => void; onCreated: (task: Task) => void }) {
  const [prefs] = useState(() => readComposerPrefs());
  const rememberedPlan = prefs.planId && plans.some((plan) => plan.id === prefs.planId) ? prefs.planId : undefined;
  const [step, setStep] = useState<ComposerStep>(1);
  const [planId, setPlanId] = useState(rememberedPlan ?? initialPlanId ?? plans[0]?.id ?? NEW_PLAN);
  const [planName, setPlanName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [repoValidation, setRepoValidation] = useState<RepoValidation>(IDLE_VALIDATION);
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
  const formRef = useRef<HTMLFormElement>(null);
  const planRef = useRef<HTMLSelectElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  // Latest-value refs let async validation compare its verdict with the live form state.
  const repoPathRef = useRef(repoPath);
  const planIdRef = useRef(planId);
  const plansRef = useRef(plans);
  const rememberedPlanRef = useRef(rememberedPlan);
  const validationSeq = useRef(0);
  const validationCache = useRef<{ input: string; promise: Promise<RepoValidation> } | null>(null);
  const mountedRef = useRef(true);
  repoPathRef.current = repoPath;
  planIdRef.current = planId;
  plansRef.current = plans;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; validationSeq.current += 1; };
  }, []);

  useEffect(() => { (step === 1 ? planRef.current : titleRef.current)?.focus(); }, [step]);

  // Remember choices as soon as they change, so closing or cancelling the composer keeps them.
  useEffect(() => {
    const validPlan = planId !== NEW_PLAN && plans.some((plan) => plan.id === planId);
    if (validPlan) rememberedPlanRef.current = planId;
    const planToRemember = validPlan ? planId : rememberedPlanRef.current;
    saveComposerPrefs({ agent, ...(planToRemember ? { planId: planToRemember } : {}) });
  }, [agent, planId, plans]);

  const detect = async () => { setDetecting(true); try { const list = await api.agents(); setAgents(list); const ready = list.find((entry) => entry.ok); if (ready && !list.some((entry) => entry.id === agent)) setAgent(ready.id); setDetectionError(null); } catch { setDetectionError('Chưa dò được agent. Có thể chọn agent và thử giao việc.'); } finally { setDetecting(false); } };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape);
  }, [onClose, busy]);

  const newPlan = planId === NEW_PLAN;

  function cancelPendingValidation(): void {
    validationSeq.current += 1;
    validationCache.current = null;
  }

  /** Local hint while typing; never authoritative. */
  function changeRepoPath(value: string): void {
    setRepoPath(value);
    repoPathRef.current = value;
    cancelPendingValidation();
    const hint = checkRepoPath(value, plans);
    if (!hint.message) { setRepoValidation(IDLE_VALIDATION); return; }
    setRepoValidation({ status: hint.status === 'error' ? 'invalid' : 'hint', message: hint.message, root: null, input: cleanRepoPath(value) });
  }

  /** Async Git check. Only the newest request for the current input may update the UI. */
  function validateRepo(force = false): Promise<RepoValidation> {
    const input = cleanRepoPath(repoPathRef.current);
    const hint = checkRepoPath(input, plansRef.current);
    const finish = (result: RepoValidation): RepoValidation => { setRepoValidation(result); return result; };
    if (!input) { cancelPendingValidation(); return Promise.resolve(finish({ status: 'invalid', message: 'Nhập đường dẫn Git repo trước khi tiếp tục.', root: null, input })); }
    if (hint.status === 'error') { cancelPendingValidation(); return Promise.resolve(finish({ status: 'invalid', message: hint.message, root: null, input })); }
    if (planIdRef.current !== NEW_PLAN) return Promise.resolve({ ...IDLE_VALIDATION, input });
    const cached = validationCache.current;
    if (!force && cached && cached.input === input) return cached.promise;
    const seq = ++validationSeq.current;
    setRepoValidation({ status: 'checking', message: 'Đang kiểm tra Git repo...', root: null, input });
    let entry: { input: string; promise: Promise<RepoValidation> };
    let timer: ReturnType<typeof setTimeout> | undefined;
    // The server bounds Git at 3 s; this guards an unreachable server as well.
    const timeout = new Promise<RepositoryValidation>((resolve) => {
      timer = setTimeout(() => resolve({ valid: false, repoPath: null, branch: null, message: 'Kiểm tra Git quá thời gian; hãy thử lại.' }), 8_000);
    });
    const settled = Promise.race([api.validateRepository(input), timeout])
      .then((response) => repoValidationFromResponse(response, input))
      .catch((cause): RepoValidation => ({
        status: 'failed',
        message: `Không kiểm tra được Git repo: ${cause instanceof Error ? cause.message : String(cause)}. Bấm "Thử lại" để kiểm tra lại.`,
        root: null, input,
      })).then((result) => {
        if (timer !== undefined) clearTimeout(timer);
        // A failed request is retryable, so it must not be served from the cache.
        if (result.status === 'failed' && validationCache.current === entry) validationCache.current = null;
        // Ignore a late verdict from a path, plan or component that is no longer current.
        if (mountedRef.current && seq === validationSeq.current && cleanRepoPath(repoPathRef.current) === input && planIdRef.current === NEW_PLAN) {
          setRepoValidation(result);
        }
        return result;
      });
    entry = { input, promise: settled };
    validationCache.current = entry;
    return settled;
  }

  function cancelValidationForPlanChange(value: string): void {
    setPlanId(value);
    planIdRef.current = value;
    cancelPendingValidation();
    setRepoValidation(IDLE_VALIDATION);
    setError(null);
  }

  async function submit() {
    if (busy) return;
    const canonicalRoot = repoValidation.status === 'valid' && repoValidation.input === cleanRepoPath(repoPath) ? repoValidation.root : null;
    if (newPlan && !canonicalRoot) {
      setError('Kiểm tra Git repo ở bước 1 trước khi giao việc.');
      setStep(1);
      return;
    }
    setBusy(true); setError(null);
    try {
      let targetId = planId;
      if (targetId === NEW_PLAN) {
        const plan = await api.createPlan({ name: planName.trim(), repoPath: canonicalRoot! });
        targetId = plan.id;
        // Preserve a successful plan if agent startup fails, so retry never creates duplicates.
        setPlanId(plan.id);
        setRepoValidation({ status: 'valid', message: 'Git repo hợp lệ.', root: plan.repoPath, input: cleanRepoPath(repoPath) });
      }
      saveComposerPrefs({ agent, planId: targetId });
      const allowed = allowedCommands.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const task = await api.createTask({ planId: targetId, agent, title: title.trim(), brief, ...(check.trim() ? { checkCmd: check.trim() } : {}), ...(agent === 'agy' ? { commandPolicy, ...(commandPolicy === 'check-only' && allowed.length > 0 ? { allowedCommands: allowed } : {}) } : {}) });
      onCreated(task);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      if (newPlan && /invalid git repository/i.test(message)) {
        setRepoValidation({ status: 'invalid', message: 'Đường dẫn không phải Git repo.', root: null, input: cleanRepoPath(repoPath) });
        setStep(1);
        setError('Đường dẫn không phải Git repo. Kiểm tra lại đường dẫn rồi thử lại.');
      } else setError(message);
    } finally { setBusy(false); }
  }

  async function goNext() {
    if (busy) return;
    if (planIdRef.current !== NEW_PLAN) {
      if (!plansRef.current.some((plan) => plan.id === planIdRef.current)) { setError('Chọn một plan trước khi sang bước giao việc.'); return; }
      setError(null); setStep(2); return;
    }
    if (!planName.trim()) { setError('Điền tên plan trước khi sang bước giao việc.'); return; }
    setError(null);
    // The live Git verdict — not the local hint or a remembered plan — gates step 2.
    const result = await validateRepo();
    if (!mountedRef.current) return;
    if (result.status !== 'valid' || !result.root) {
      setError(result.status === 'failed' ? result.message : `${result.message} Kiểm tra lại đường dẫn Git repo.`);
      return;
    }
    setStep(2);
  }

  /** One primary action for the button, Enter and Ctrl+Enter. Ctrl+Enter goes through the form so native required validation still runs. */
  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === 1) void goNext(); else void submit();
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
    <form ref={formRef} onSubmit={handleSubmit} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); formRef.current?.requestSubmit(); } }} data-step={step}>
      <ol className="composer-steps" aria-label="Các bước giao việc" style={stepListStyle}>
        <li><span className="composer-step" aria-current={step === 1 ? 'step' : undefined} style={stepChipStyle(step === 1)}>1. Dự án</span></li>
        <li><span className="composer-step" aria-current={step === 2 ? 'step' : undefined} style={stepChipStyle(step === 2)}>2. Giao việc</span></li>
      </ol>
      {step === 1 ? <>
        <div className="form-row"><label className="field">Dự án / plan<select ref={planRef} aria-label="Dự án / plan" value={planId} onChange={(event) => cancelValidationForPlanChange(event.target.value)}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}{planId !== NEW_PLAN && !plans.some((plan) => plan.id === planId) && <option value={planId}>{planName || planId}</option>}<option value={NEW_PLAN}>+ Tạo plan mới</option></select></label><label className="field">Agent<select aria-label="Agent" value={agent} onChange={(event) => setAgent(event.target.value as AgentId)}>{choices.map((entry) => <option key={entry.id} value={entry.id}>{entry.id}{entry.ok ? '' : ' · chưa sẵn sàng'}</option>)}{!choices.some((entry) => entry.id === agent) && <option value={agent}>{agent}</option>}</select></label></div>
        <div className="composer-agent-check" style={rowStyle}><span className={`status-badge ${badge.className}`} role="status">{badge.label}</span><span className="small-note" style={inlineNoteStyle}>{agents.length ? 'Từ lần kiểm tra thủ công gần nhất.' : 'Chưa chạy kiểm tra CLI.'}</span><button type="button" className="text-button" onClick={() => void detect()} disabled={detecting}>{detecting ? 'Đang kiểm tra...' : 'Kiểm tra agent'}</button>{selected && !selected.ok && selected.reason && <span className="small-note" style={inlineNoteStyle}>{selected.reason}</span>}</div>
        {newPlan && <div className="new-plan-fields"><label className="field">Tên plan<input required value={planName} onChange={(event) => setPlanName(event.target.value)} placeholder="Tên dự án hoặc đợt công việc" /></label><label className="field">Đường dẫn Git repository<input required value={repoPath} onChange={(event) => changeRepoPath(event.target.value)} onBlur={() => { if (planIdRef.current === NEW_PLAN) void validateRepo(); }} aria-invalid={repoValidation.status === 'invalid' ? true : undefined} aria-describedby={repoValidation.status === 'idle' ? undefined : 'composer-repo-status'} aria-busy={repoValidation.status === 'checking'} placeholder="C:\\Projects\\my-app" spellCheck={false} /></label>{/* Reserved height: revealing this line on blur must not move the buttons under the pointer and swallow a click. */}<p id="composer-repo-status" role="status" className="small-note" style={{ margin: '-9px 0 12px', minHeight: '3.2em', color: repoStatusColor(repoValidation.status) }}>{repoValidation.message}{repoValidation.status === 'failed' && <> <button type="button" className="text-button" onClick={() => void validateRepo(true)}>Thử lại</button></>}</p></div>}
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
