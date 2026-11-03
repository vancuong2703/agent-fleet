import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { AgentId, Plan, Task } from '../../../shared/types.js';
import { api, type AgentInfo } from '../api.js';
import { Icon } from './Icon.js';

export function TaskComposer({ plans, initialPlanId, onClose, onCreated }: { plans: Plan[]; initialPlanId?: string; onClose: () => void; onCreated: (task: Task) => void }) {
  const [planId, setPlanId] = useState(initialPlanId ?? plans[0]?.id ?? '__new__');
  const [planName, setPlanName] = useState('');
  const [repoPath, setRepoPath] = useState('');
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [check, setCheck] = useState('');
  const [agent, setAgent] = useState<AgentId>('codex');
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detectionError, setDetectionError] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [commandPolicy, setCommandPolicy] = useState<'ask' | 'check-only' | 'auto'>('auto');
  const [allowedCommands, setAllowedCommands] = useState('');
  const titleRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  const detect = async () => { setDetecting(true); try { const list = await api.agents(); setAgents(list); const ready = list.find((entry) => entry.ok); if (ready) setAgent(ready.id); setDetectionError(null); } catch { setDetectionError('Chưa dò được agent. Có thể chọn agent và thử giao việc.'); } finally { setDetecting(false); } };
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busy) onClose(); };
    document.addEventListener('keydown', escape); return () => document.removeEventListener('keydown', escape);
  }, [onClose, busy]);
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      let targetId = planId;
      if (targetId === '__new__') {
        const plan = await api.createPlan({ name: planName.trim(), repoPath: repoPath.trim() });
        targetId = plan.id;
        // Preserve a successful plan if agent startup fails, so retry never creates duplicates.
        setPlanId(plan.id);
      }
      const allowed = allowedCommands.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const task = await api.createTask({ planId: targetId, agent, title: title.trim(), brief, ...(check.trim() ? { checkCmd: check.trim() } : {}), ...(agent === 'agy' ? { commandPolicy, ...(commandPolicy === 'check-only' && allowed.length > 0 ? { allowedCommands: allowed } : {}) } : {}) });
      onCreated(task);
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  const choices = agents.length ? agents : (['codex', 'qodercli', 'agy', 'opencode'] as AgentId[]).map((id) => ({ id, ok: true }));
  return <div className="modal-overlay" role="presentation"><section className="modal composer-modal" role="dialog" aria-modal="true" aria-labelledby="composer-title">
    <div className="composer-heading"><div><span className="eyebrow">AGENT WORKSPACE</span><h2 id="composer-title">Giao một công việc mới</h2></div><button className="icon-button" title="Đóng tạo task" aria-label="Đóng tạo task" onClick={onClose} disabled={busy}><Icon name="close" /></button></div>
    <form onSubmit={submit}>
      <label className="field">Tên công việc<input ref={titleRef} required maxLength={240} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ví dụ: Hoàn thiện màn hình cài đặt" /></label>
      <div className="form-row"><label className="field">Dự án / plan<select aria-label="Dự án / plan" value={planId} onChange={(event) => setPlanId(event.target.value)}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}{planId !== '__new__' && !plans.some((plan) => plan.id === planId) && <option value={planId}>{planName || planId}</option>}<option value="__new__">+ Tạo plan mới</option></select></label><label className="field">Agent<select aria-label="Agent" value={agent} onChange={(event) => setAgent(event.target.value as AgentId)}>{choices.map((entry) => <option key={entry.id} value={entry.id}>{entry.id}{entry.ok ? '' : ' · chưa sẵn sàng'}</option>)}</select></label></div>
      <div className="composer-agent-check"><span className="small-note">{agents.length ? 'Trạng thái từ lần kiểm tra thủ công gần nhất.' : 'Chưa chạy kiểm tra CLI.'}</span><button type="button" className="text-button" onClick={() => void detect()} disabled={detecting}>{detecting ? 'Đang kiểm tra…' : 'Kiểm tra agent'}</button></div>
      {planId === '__new__' && <div className="new-plan-fields"><label className="field">Tên plan<input required value={planName} onChange={(event) => setPlanName(event.target.value)} placeholder="Tên dự án hoặc đợt công việc" /></label><label className="field">Đường dẫn Git repository<input required value={repoPath} onChange={(event) => setRepoPath(event.target.value)} placeholder="C:\\Projects\\my-app" spellCheck={false} /></label></div>}
      <label className="field">Nội dung giao việc<textarea required rows={6} value={brief} onChange={(event) => setBrief(event.target.value)} placeholder="Mục tiêu, phạm vi thay đổi và tiêu chí hoàn thành…" /></label>
      <label className="field">Lệnh kiểm tra <span className="muted">(tuỳ chọn)</span><input value={check} onChange={(event) => setCheck(event.target.value)} placeholder="npm test" spellCheck={false} /></label>
      {agent === 'agy' && <fieldset className="command-policy"><legend>Quyền lệnh AGY cho lần chạy này</legend><label className="check-field"><input type="checkbox" checked={commandPolicy === 'auto'} onChange={(event) => setCommandPolicy(event.target.checked ? 'auto' : 'ask')} />Tự duyệt lệnh terminal (task này)</label><p className="small-note">Quyền chỉ áp dụng lần chạy này; ghi log. Agent có thể chạy lệnh trong worktree để hoàn thành công việc.</p>{commandPolicy !== 'auto' && <label className="field">Phạm vi cho phép<select aria-label="Phạm vi quyền AGY" value={commandPolicy} onChange={(event) => setCommandPolicy(event.target.value as 'ask' | 'check-only')}><option value="ask">Hỏi quyền theo mặc định của AGY</option><option value="check-only">Chỉ lệnh kiểm tra và danh sách cho phép</option></select></label>}{commandPolicy === 'check-only' && <label className="field">Lệnh được cho phép thêm<textarea rows={3} value={allowedCommands} onChange={(event) => setAllowedCommands(event.target.value)} placeholder={'npm test\nnode check.cjs'} /></label>}</fieldset>}
      <p className="composer-note">Agent làm việc trong Git worktree riêng. Bạn xem thay đổi và duyệt Merge khi hoàn tất.</p>
      {detectionError && <p className="muted">{detectionError}</p>}{error && <p className="banner banner-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="action-btn" type="button" onClick={onClose} disabled={busy}>Huỷ</button><button className="action-btn action-primary" type="submit" disabled={busy}>{busy ? 'Đang chuẩn bị…' : 'Giao việc'}<Icon name="arrow" size={16} /></button></div>
    </form>
  </section></div>;
}
