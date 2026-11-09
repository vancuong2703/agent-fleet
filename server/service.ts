import { existsSync } from 'node:fs';
import path from 'node:path';
import type { AgentId, FleetEvent, Plan, Run, Task, TaskResult } from '../shared/types.js';
import { getAdapter, getAdapterConfig } from './adapters/index.js';
import type { AgentAdapter } from './adapters/types.js';
import type { Bus } from './bus.js';
import type { FleetConfig } from './config.js';
import { newId } from './ids.js';
import { agyCommandArgs, validateCommandOptions, type CommandOptions } from './command-permissions.js';
import { files } from './paths.js';
import { isAlive, killTree, processImage } from './process.js';
import { runAttempt, type RunOutcome } from './runner.js';
import type { Store } from './store.js';
import {
  commitAll, createWorktree, currentBranch, diffWorktree, mergeBranch, removeWorktree,
  type MergeResult,
} from './worktree.js';

export class FleetError extends Error {
  constructor(public code: 'not_found' | 'bad_request' | 'agent_unavailable' | 'conflict' | 'invalid_state', msg: string) {
    super(msg);
    this.name = 'FleetError';
  }
}

interface ActiveAttempt {
  controller: AbortController;
  done: Promise<void>;
}

/** Mirrors config.ts DEFAULT_NETWORK_MIN for injected configs that omit networkMin. */
const DEFAULT_NETWORK_MIN = 5;
const retryable = new Set(['done', 'failed', 'timeout', 'interrupted', 'merged']);
const pending = (task: Task): boolean => task.status === 'queued' || task.status === 'running';

export class TaskService {
  private readonly store: Store;
  private readonly bus: Bus;
  private readonly config: FleetConfig;
  private readonly adapters: (id: AgentId) => AgentAdapter;
  private readonly onBeforeWorktreeChange?: (taskId: string) => Promise<void> | void;
  // Reserve capacity before the runner's asynchronous brief write/spawn.
  private readonly active = new Map<string, ActiveAttempt>();
  private readonly taskLocks = new Map<string, Promise<void>>();
  private readonly worktreeGuards = new Set<(taskId: string) => Promise<void> | void>();
  private closed = false;

  constructor(o: { store: Store; bus: Bus; config: FleetConfig; adapters?: (id: AgentId) => AgentAdapter; onBeforeWorktreeChange?: (taskId: string) => Promise<void> | void }) {
    this.store = o.store;
    this.bus = o.bus;
    this.config = o.config;
    this.adapters = o.adapters ?? getAdapter;
    this.onBeforeWorktreeChange = o.onBeforeWorktreeChange;
  }

  /** Extra terminal owners can register cleanup without replacing the task PTY hook. */
  addWorktreeGuard(guard: (taskId: string) => Promise<void> | void): () => void {
    this.worktreeGuards.add(guard);
    return () => { this.worktreeGuards.delete(guard); };
  }

  private async prepareWorktree(taskId: string): Promise<void> {
    await this.onBeforeWorktreeChange?.(taskId);
    for (const guard of this.worktreeGuards) await guard(taskId);
  }

  async createPlan(i: { name: string; repoPath: string; baseBranch?: string }): Promise<Plan> {
    this.assertOpen();
    const repoPath = path.win32.resolve(i.repoPath);
    let branch: string;
    try {
      branch = await currentBranch(repoPath);
    } catch (error) {
      throw new FleetError('bad_request', `Invalid git repository: ${String(error)}`);
    }
    if (!i.baseBranch && !branch) throw new FleetError('bad_request', 'Repository has no current branch');
    const plan = this.store.createPlan({ name: i.name, repoPath, baseBranch: i.baseBranch ?? branch });
    this.bus.emit({ type: 'plan', plan });
    return plan;
  }

  async run(i: { planId: string; agent: AgentId; title: string; brief: string; checkCmd?: string } & CommandOptions): Promise<Task> {
    this.assertOpen();
    try { validateCommandOptions(i); } catch (error) { throw new FleetError('bad_request', String(error)); }
    if (i.agent !== 'agy' && ((i.commandPolicy !== undefined && i.commandPolicy !== 'ask') || i.allowedCommands?.length)) {
      throw new FleetError('bad_request', 'Command approval policies are currently supported by AGY only');
    }
    const plan = this.plan(i.planId);
    await this.available(i.agent);
    this.assertOpen();
    let id = newId('t');
    for (let attempt = 0; this.store.getTask(id); attempt++) {
      if (attempt === 5) throw new FleetError('conflict', 'Could not generate a unique task id');
      id = newId('t');
    }
    const branch = `fleet/${plan.slug}/${id}`;
    const worktreePath = files.worktree(path.basename(plan.repoPath), id);
    // A failed git operation must never leave a task visible in the store.
    await createWorktree({ repoPath: plan.repoPath, baseBranch: plan.baseBranch, branch, path: worktreePath });
    const task = this.store.createTask({ id, planId: plan.id, agent: i.agent, title: i.title, branch, worktreePath, checkCmd: i.checkCmd ?? null });
    this.bus.emit({ type: 'task', task });
    this.createRun({ taskId: id, agent: i.agent, brief: i.brief, note: null, commandPolicy: i.commandPolicy, allowedCommands: i.allowedCommands });
    this.schedule();
    return this.task(id);
  }

  retry(taskId: string, i: { agent?: AgentId; note: string; resumeSession?: boolean } & CommandOptions): Promise<Run> {
    try { validateCommandOptions(i); } catch (error) { return Promise.reject(new FleetError('bad_request', String(error))); }
    return this.withTask(taskId, async () => {
      await this.prepareWorktree(taskId);
      this.assertOpen();
      const task = this.task(taskId);
      this.requireState(task, retryable);
      if (!existsSync(task.worktreePath)) {
        const plan = this.plan(task.planId);
        await createWorktree({ repoPath: plan.repoPath, baseBranch: plan.baseBranch, branch: task.branch, path: task.worktreePath });
      }
      const agent = i.agent ?? task.agent;
      if (agent !== 'agy' && ((i.commandPolicy !== undefined && i.commandPolicy !== 'ask') || i.allowedCommands?.length)) {
        throw new FleetError('bad_request', 'Command approval policies are currently supported by AGY only');
      }
      await this.available(agent);
      const original = this.store.listRuns({ taskId })[0];
      if (!original) throw new FleetError('invalid_state', 'Task has no original run');
      const attempt = this.latest(taskId).attempt + 1;
      const previous = this.latest(taskId);
      const sessionId = i.resumeSession !== false && previous.agent === agent ? previous.sessionId : null;
      const run = this.createRun({ taskId, agent, note: i.note, brief: `${original.brief}\n\n## Ghi chú lần thử ${attempt}\n${i.note}`,
        commandPolicy: i.commandPolicy ?? (previous.agent === agent ? previous.commandPolicy : 'ask'),
        allowedCommands: i.allowedCommands ?? (previous.agent === agent ? previous.allowedCommands : []),
        sessionId });
      this.updateTask(taskId, { agent, status: 'queued', finishedAt: null });
      this.schedule();
      return this.store.getRun(run.id)!;
    });
  }

  stop(taskId: string): Promise<void> {
    return this.withTask(taskId, () => this.stopAttempt(this.task(taskId)));
  }

  takeOver(taskId: string): Promise<void> {
    return this.withTask(taskId, async () => {
      const task = this.task(taskId);
      this.requireState(task, new Set(['running']));
      await this.stopAttempt(task);
      this.finish(this.latest(taskId), { status: 'taken_over' });
    });
  }

  markDone(taskId: string): Promise<void> {
    return this.withTask(taskId, async () => {
      const task = this.task(taskId);
      this.requireState(task, new Set(['taken_over']));
      this.finish(this.latest(taskId), { status: 'done' });
    });
  }

  merge(taskId: string): Promise<MergeResult> {
    return this.withTask(taskId, async () => {
      await this.prepareWorktree(taskId);
      const task = this.task(taskId);
      this.requireState(task, new Set(['done']));
      // Older versions stored done even when checks failed. Reject those runs
      // before committing the worktree, too.
      const run = this.latest(taskId);
      if (run.checkPassed === false || run.errorCategory !== null) {
        throw new FleetError('invalid_state', 'Task has a failed check or agent error; retry and review before merging');
      }
      const plan = this.plan(task.planId);
      await commitAll(task.worktreePath, `fleet: ${task.title}`);
      const result = await mergeBranch({ repoPath: plan.repoPath, baseBranch: plan.baseBranch, branch: task.branch });
      if (result.ok) {
        this.updateTask(taskId, { status: 'merged' });
        try { await this.remove(task, plan); }
        catch (error) { console.error(`Could not remove worktree for ${taskId}`, error); }
      }
      return result;
    });
  }

  discard(taskId: string): Promise<void> {
    return this.withTask(taskId, async () => {
      await this.prepareWorktree(taskId);
      const task = this.task(taskId);
      if (task.status === 'merged' || task.status === 'discarded') throw new FleetError('invalid_state', `Task is ${task.status}`);
      if (pending(task)) await this.stopAttempt(task);
      await this.remove(task, this.plan(task.planId));
      this.updateTask(taskId, { status: 'discarded', finishedAt: this.task(taskId).finishedAt ?? Date.now() });
    });
  }

  async wait(ids: string[], timeoutMs: number): Promise<TaskResult[]> {
    ids.forEach((id) => this.task(id));
    await new Promise<void>((resolve) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const complete = () => { off(); clearTimeout(timer); resolve(); };
      const check = () => { if (ids.every((id) => !pending(this.task(id)))) complete(); };
      const off = this.bus.on((message) => { if (message.type === 'task') check(); });
      timer = setTimeout(complete, Math.max(0, timeoutMs));
      check();
    });
    return Promise.all(ids.map((id) => this.result(id)));
  }

  async result(taskId: string): Promise<TaskResult> {
    const task = this.task(taskId);
    const run = this.store.latestRun(taskId) ?? null;
    const files = task.status === 'merged' || task.status === 'discarded'
      ? [] : (await diffWorktree(task.worktreePath, this.plan(task.planId).baseBranch)).files;
    return { task, run, files };
  }

  recover(): void {
    this.assertOpen();
    for (const run of this.store.listRuns({ status: 'running' })) {
      if (this.active.has(run.id)) continue;
      // Nobody reads an orphan's output after a restart, so a live one is killed too, but only if the
      // pid still belongs to the agent's executable: Windows reuses pids after a reboot.
      if (run.pid !== null && isAlive(run.pid) && this.ownsPid(run)) void killTree(run.pid).catch(() => {});
      this.finish(run, { status: 'interrupted' });
    }
    this.schedule();
  }

  async close(): Promise<void> {
    this.closed = true;
    const attempts = [...this.active.values()];
    for (const attempt of attempts) attempt.controller.abort();
    await Promise.all(attempts.map((attempt) => attempt.done));
  }

  private schedule(): void {
    if (this.closed) return;
    // Store insertion order is the durable FIFO queue, including after restart.
    const busy = this.store.listRuns().filter((run) => run.status === 'running' || this.active.has(run.id));
    let total = busy.length;
    const counts = new Map<AgentId, number>();
    for (const run of busy) counts.set(run.agent, (counts.get(run.agent) ?? 0) + 1);
    for (const run of this.store.listRuns({ status: 'queued' })) {
      if (total >= this.config.maxParallelTotal) break;
      if (this.active.has(run.id)) continue;
      const task = this.task(run.taskId);
      if (task.status !== 'queued' || this.latest(task.id).id !== run.id) continue;
      const cfg = getAdapterConfig(run.agent, this.config);
      if ((counts.get(run.agent) ?? 0) >= cfg.maxParallel) continue;
      const attempt: ActiveAttempt = { controller: new AbortController(), done: Promise.resolve() };
      this.active.set(run.id, attempt);
      // Deferring to a microtask ensures the reservation has its completion
      // promise before runner callbacks can emit bus messages.
      attempt.done = Promise.resolve().then(() => this.execute(run, task, attempt.controller.signal)).catch((error: unknown) => {
        console.error(`Run ${run.id} failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`);
      }).finally(() => {
        this.active.delete(run.id);
        this.schedule();
      });
      total++;
      counts.set(run.agent, (counts.get(run.agent) ?? 0) + 1);
    }
  }

  private async execute(run: Run, task: Task, signal: AbortSignal): Promise<void> {
    const cfg = getAdapterConfig(run.agent, this.config);
    let outcome: RunOutcome;
    try {
      const approval = run.agent === 'agy' ? agyCommandArgs(cfg.extraArgs, run, task.checkCmd, task.worktreePath) : { args: cfg.extraArgs, rules: [] };
      if (approval.rules.length) this.event(run, { kind: 'tool', name: 'command_permissions', detail: `AGY ${run.commandPolicy}: ${approval.rules.join(', ')} (session only)` });
      outcome = await runAttempt({
        adapter: this.adapters(run.agent), bin: cfg.bin!, extraArgs: approval.args,
        brief: run.brief, briefFile: files.brief(run.id), cwd: task.worktreePath, checkCmd: task.checkCmd,
        timeouts: {
          totalMs: this.config.timeouts.totalMin * 60_000, idleMs: this.config.timeouts.idleMin * 60_000,
          networkMs: (this.config.timeouts.networkMin ?? DEFAULT_NETWORK_MIN) * 60_000,
        },
        signal,
        sessionId: run.sessionId,
        prompt: run.sessionId && run.note && run.agent !== 'fake' ? run.note : run.brief,
        onEvent: (event) => this.event(run, event),
        onSpawn: (pid) => {
          this.updateRun(run.id, { pid, startedAt: Date.now(), status: 'running' });
          this.updateTask(task.id, { status: 'running', finishedAt: null });
        },
      });
    } catch (error) {
      this.event(run, { kind: 'error', category: 'system', text: String(error) });
      outcome = { status: 'failed', errorCategory: 'system', exitCode: null, finalMessage: null, sessionId: null, inputTokens: null, outputTokens: null, costUsd: null, checkPassed: null };
    }
    // A store failure here (for example a corrupt database) must not become an unhandled rejection.
    try { this.finish(this.store.getRun(run.id)!, outcome); }
    catch (error) { console.error(`Could not record the outcome of run ${run.id}: ${error instanceof Error ? error.message : String(error)}`); }
  }

  private async stopAttempt(task: Task): Promise<void> {
    this.requireState(task, new Set(['queued', 'running']));
    const run = this.latest(task.id);
    const attempt = this.active.get(run.id);
    if (attempt) {
      attempt.controller.abort();
      await attempt.done;
    } else {
      if (run.status === 'running' && run.pid !== null && isAlive(run.pid)) await killTree(run.pid);
      this.finish(run, { status: 'interrupted' });
      this.schedule();
    }
  }

  private finish(run: Run, patch: Partial<Run> & Pick<Run, 'status'>): void {
    const endedAt = Date.now();
    const updated = this.updateRun(run.id, { ...patch, endedAt, durationMs: run.startedAt === null ? null : endedAt - run.startedAt });
    const task = this.task(run.taskId);
    if (this.latest(task.id).id === run.id && task.status !== 'merged' && task.status !== 'discarded') {
      this.updateTask(task.id, { status: updated.status, finishedAt: endedAt });
    }
    this.event(run, { kind: 'status', status: updated.status });
  }

  private event(run: Run, event: FleetEvent): void {
    const stored = this.store.appendEvent(run.id, event);
    this.bus.emit({ type: 'event', taskId: run.taskId, stored });
  }

  private createRun(input: Pick<Run, 'taskId' | 'agent' | 'brief' | 'note' | 'commandPolicy' | 'allowedCommands'> & { sessionId?: string | null }): Run {
    const run = this.store.createRun(input);
    this.bus.emit({ type: 'run', run });
    return run;
  }

  private updateTask(id: string, patch: Partial<Task>): Task {
    const task = this.store.updateTask(id, patch);
    this.bus.emit({ type: 'task', task });
    return task;
  }

  private updateRun(id: string, patch: Partial<Run>): Run {
    const run = this.store.updateRun(id, patch);
    this.bus.emit({ type: 'run', run });
    return run;
  }

  private task(id: string): Task {
    const task = this.store.getTask(id);
    if (!task) throw new FleetError('not_found', `Task not found: ${id}`);
    return task;
  }

  private plan(id: string): Plan {
    const plan = this.store.getPlan(id);
    if (!plan) throw new FleetError('not_found', `Plan not found: ${id}`);
    return plan;
  }

  private latest(taskId: string): Run {
    const run = this.store.latestRun(taskId);
    if (!run) throw new FleetError('invalid_state', 'Task has no run');
    return run;
  }

  private async available(id: AgentId): Promise<AgentAdapter> {
    const cfg = getAdapterConfig(id, this.config);
    if (!cfg.bin) throw new FleetError('agent_unavailable', `Agent ${id} has no executable`);
    const adapter = this.adapters(id);
    const detected = await adapter.detect(cfg);
    if (!detected.ok) throw new FleetError('agent_unavailable', detected.reason ?? `Agent ${id} is unavailable`);
    return adapter;
  }

  private ownsPid(run: Run): boolean {
    const bin = getAdapterConfig(run.agent, this.config).bin;
    return bin !== null && processImage(run.pid!) === path.win32.basename(bin).toLowerCase();
  }

  private requireState(task: Task, allowed: ReadonlySet<string>): void {
    if (!allowed.has(task.status)) throw new FleetError('invalid_state', `Task ${task.id} is ${task.status}`);
  }

  private assertOpen(): void {
    if (this.closed) throw new FleetError('invalid_state', 'Task service is closed');
  }

  private remove(task: Task, plan: Plan): Promise<void> {
    return removeWorktree({ repoPath: plan.repoPath, path: task.worktreePath, branch: task.branch, deleteBranch: true });
  }

  private async withTask<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.taskLocks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const lock = new Promise<void>((resolve) => { release = resolve; });
    this.taskLocks.set(id, lock);
    await previous;
    try { return await fn(); }
    finally {
      release();
      if (this.taskLocks.get(id) === lock) this.taskLocks.delete(id);
    }
  }
}
