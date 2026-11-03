import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type {
  DashboardAgent,
  DashboardBalance,
  DashboardCheck,
  DashboardCommand,
  DashboardSnapshot,
  DashboardTool,
  TerminalSessionInfo,
} from '../shared/dashboard.js';
import { getAdapter } from './adapters/index.js';
import { loadConfig, type FleetConfig } from './config.js';
import { dataDir } from './paths.js';
import type { PtySession, PtyTarget } from './pty.js';
import { FleetError } from './service.js';
import { terminalStatus } from './terminal-status.js';
import { parseCliStatus, enrichDashboardStatus } from './dashboard-status.js';
import type { Store } from './store.js';

export const DASHBOARD_AGENTS: readonly DashboardAgent[] = ['codex', 'qodercli', 'agy', 'opencode'];

const AGENT_TITLES: Record<DashboardAgent, string> = {
  codex: 'Codex',
  qodercli: 'Qoder CLI',
  agy: 'Antigravity (AGY)',
  opencode: 'OpenCode',
};

const PROBE_TIMEOUT_MS = 8_000;
const PROBE_MAX_OUTPUT = 16_000;
const DEFAULT_MAX_SESSIONS = 8;
const DEFAULT_UNCLAIMED_TTL_MS = 60_000;
const DEFAULT_RECONNECT_GRACE_MS = 5 * 60_000;

/** One bounded, read-only command run for a dashboard check. */
export interface CommandProbeResult {
  command: string;
  kind: 'version' | 'status' | 'usage';
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** Injectable probe runner; the default spawns the CLI's fixed read-only commands. */
export type DashboardProbe = (agent: DashboardAgent, bin: string) => Promise<CommandProbeResult[]>;

/** The slice of `PtyManager` a dashboard terminal needs. */
export interface TerminalPty {
  openTarget(id: string, target: PtyTarget | undefined, cols: number, rows: number): PtySession;
  kill(id: string): Promise<void>;
}

export interface DashboardOptions {
  /** Config snapshot; when omitted the loader runs once and is cached. */
  config?: FleetConfig;
  loadConfig?: () => FleetConfig;
  probe?: DashboardProbe;
  /** Inject enrichment with custom probes; default enrichment only accompanies real probes. */
  enrich?: typeof enrichDashboardStatus;
  now?: () => number;
  directory?: string;
  /** Reuse a terminal manager (e.g. to clean sessions by task from the integrator). */
  terminals?: DashboardTerminals;
  maxSessions?: number;
  unclaimedTtlMs?: number;
  reconnectGraceMs?: number;
}

export interface DashboardRouteOptions {
  store: Pick<Store, 'getPlan' | 'getTask'>;
  /** Absent on a CLI-only server; terminal sessions then degrade to unavailable. */
  ptyManager?: TerminalPty;
  dashboard?: DashboardOptions;
}

interface ProbeSpec { args: string[]; kind: CommandProbeResult['kind'] }

/** Fixed local status/usage commands; interactive commands are collected via
 * a short-lived private PTY below, only after an explicit manual check. */
const PROBE_SPECS: Record<DashboardAgent, ProbeSpec[]> = {
  codex: [{ args: ['--version'], kind: 'version' }, { args: ['login', 'status'], kind: 'status' }],
  qodercli: [{ args: ['--version'], kind: 'version' }, { args: ['status', '-o', 'json'], kind: 'status' }],
  agy: [{ args: ['--version'], kind: 'version' }],
  opencode: [{ args: ['--version'], kind: 'version' }, { args: ['auth', 'list'], kind: 'status' }, { args: ['stats', '--json', '--days', '0'], kind: 'usage' }],
};

// ── command suggestions ─────────────────────────────────────────────────────
const stop = (agent: string): DashboardCommand => ({
  id: `${agent}-stop`, label: 'Dừng tiến trình', command: '\u0003', context: 'interactive',
  description: 'Gửi Ctrl+C để dừng agent đang chạy trong phiên.',
});
const interactive = (agent: string, suffix: string, label: string, command: string, description: string): DashboardCommand =>
  ({ id: `${agent}-${suffix}`, label, command, context: 'interactive', description });
const shell = (agent: string, suffix: string, label: string, command: string, description: string): DashboardCommand =>
  ({ id: `${agent}-${suffix}`, label, command, context: 'shell', description });
const resources = (agent: string, executable: string): DashboardCommand => shell(agent, 'resources', 'Xem tiến trình và RAM',
  `tasklist /FI "IMAGENAME eq ${executable}"`, 'Lệnh Windows đọc các tiến trình cùng tên. Biểu đồ CPU/RAM trong app cho biết phạm vi đo chi tiết hơn.');

/** Only commands that are actually supported by the installed CLI are listed. */
const SUGGESTIONS: Record<DashboardAgent, DashboardCommand[]> = {
  codex: [
    stop('codex'),
    interactive('codex', 'status', 'Tài khoản và hạn mức', '/status', 'Đọc model, tài khoản, hạn mức 5 giờ và tuần do Codex trả về.'),
    shell('codex', 'model', 'Chọn model khi mở CLI', 'codex --model MODEL', 'Thay MODEL bằng model có quyền truy cập; mở phiên mới với model đã chọn.'),
    resources('codex', 'codex.exe'),
    shell('codex', 'login', 'Trạng thái đăng nhập', 'codex login status', 'Kiểm tra đăng nhập Codex (chạy tại CMD/PowerShell).'),
    shell('codex', 'help', 'Trợ giúp Codex', 'codex --help', 'Liệt kê lệnh và tùy chọn model của Codex.'),
  ],
  qodercli: [
    stop('qodercli'),
    resources('qodercli', 'qodercli.exe'),
    interactive('qodercli', 'model', 'Đổi model', '/model', 'Slash command trong phiên Qoder (CLI xác nhận có lệnh này).'),
    interactive('qodercli', 'status', 'Trạng thái phiên', '/status', 'Xem trạng thái phiên và tài khoản trong CLI.'),
    interactive('qodercli', 'usage', 'Sử dụng', '/usage', 'Xem mức sử dụng do Qoder báo trong phiên.'),
    shell('qodercli', 'models', 'Liệt kê model', 'qodercli --list-models', 'Liệt kê model khả dụng (đã xác minh help).'),
    shell('qodercli', 'help', 'Trợ giúp Qoder', 'qodercli --help', 'Liệt kê lệnh Qoder CLI hỗ trợ.'),
  ],
  agy: [
    stop('agy'),
    interactive('agy', 'credits', 'Credit còn lại', '/credits', 'Đọc số AI Credits hoặc trạng thái chưa bật credit của AGY.'),
    shell('agy', 'model', 'Chọn model khi mở CLI', 'agy --model MODEL', 'Thay MODEL bằng tên từ danh sách agy models; chỉ đổi model của phiên được mở.'),
    shell('agy', 'models', 'Liệt kê model', 'agy models', 'Đọc danh sách model mà AGY cung cấp.'),
    resources('agy', 'agy.exe'),
    shell('agy', 'help', 'Trợ giúp AGY', 'agy --help', 'Liệt kê lệnh AGY; dùng /help trong CLI để xem thêm các lệnh tương tác.'),
  ],
  opencode: [
    stop('opencode'),
    shell('opencode', 'stats', 'Thống kê hôm nay', 'opencode stats --json --days 0', 'Đọc thống kê phiên, model, token và chi phí do OpenCode cung cấp.'),
    shell('opencode', 'models', 'Liệt kê model', 'opencode models', 'Xem model khả dụng trước khi chọn trong OpenCode.'),
    resources('opencode', 'opencode-cli.exe'),
    shell('opencode', 'help', 'Trợ giúp OpenCode', 'opencode --help', 'Liệt kê lệnh OpenCode CLI hỗ trợ.'),
  ],
};

// ── output sanitising ───────────────────────────────────────────────────────
/** Redact likely secrets and account identifiers before anything leaves the server. */
export function redactSensitive(text: string): string {
  return text
    .replace(/sk-[A-Za-z0-9_-]{6,}/g, 'sk-***')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]{6,}/gi, '$1***')
    .replace(/\b[A-Za-z0-9+/]{40,}={0,2}\b/g, '***')
    .replace(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g, '***@$1');
}

function firstLine(text: string): string {
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return '';
}

function safeSummary(text: string, limit = 300): string {
  return firstLine(redactSensitive(text)).slice(0, limit);
}

function capOutput(text: string): string {
  return text.length > PROBE_MAX_OUTPUT ? text.slice(0, PROBE_MAX_OUTPUT) : text;
}

function runCommand(bin: string, spec: ProbeSpec): Promise<CommandProbeResult> {
  const command = `${path.basename(bin)} ${spec.args.join(' ')}`.trim();
  return new Promise((resolve) => {
    execFile(
      bin,
      spec.args,
      { timeout: PROBE_TIMEOUT_MS, shell: false, windowsHide: true, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' },
      (error, stdout, stderr) => {
        const raw = error as { code?: unknown } | null;
        const exitCode = error ? (typeof raw?.code === 'number' ? raw.code : null) : 0;
        resolve({ command, kind: spec.kind, ok: !error, exitCode, stdout: capOutput(String(stdout ?? '')), stderr: capOutput(String(stderr ?? '')) });
      },
    );
  });
}

export const defaultDashboardProbe: DashboardProbe = async (agent, bin) => {
  const results = await Promise.all(PROBE_SPECS[agent].map((spec) => runCommand(bin, spec)));
  if (agent !== 'opencode') results.push(await terminalStatus(agent, bin, dataDir()));
  return results;
};

/** Placeholder when the server has no PTY manager (CLI-only mode). */
const unavailablePty: TerminalPty = {
  openTarget(): PtySession {
    throw new Error('Terminal tương tác không khả dụng trên server này.');
  },
  async kill(): Promise<void> { /* nothing to kill */ },
};

// ── check analysis ──────────────────────────────────────────────────────────
function classifyAccount(agent: DashboardAgent, results: CommandProbeResult[]): DashboardCheck['account'] {
  const status = results.filter((result) => result.kind === 'status');
  if (status.length === 0) {
    return { state: 'unknown', label: null, source: 'không hỗ trợ', reason: `${AGENT_TITLES[agent]} không có lệnh trạng thái đăng nhập đã xác minh; không suy diễn tài khoản.` };
  }
  const ok = status.filter((result) => result.ok);
  const text = status.map((result) => `${result.stdout}\n${result.stderr}`).join('\n');
  if (/not\s+(logged|signed)\s*in|not authenticated|no active session|chưa đăng nhập/i.test(text)) {
    return { state: 'unauthenticated', label: 'Chưa đăng nhập', source: status[0]!.command, reason: null };
  }
  if (ok.length === 0) {
    const reason = safeSummary(status[0]!.stderr) || 'CLI không trả về trạng thái tài khoản.';
    return { state: 'unknown', label: null, source: status[0]!.command, reason };
  }
  const source = ok[0]!.command;
  if (/not\s+(logged|signed)\s*in|not authenticated|no active session|chưa đăng nhập/i.test(text)) {
    return { state: 'unauthenticated', label: 'Chưa đăng nhập', source, reason: null };
  }
  if (/logged\s*in|signed\s*in|authenticated|đã đăng nhập/i.test(text)) {
    return { state: 'authenticated', label: 'Đã đăng nhập', source, reason: null };
  }
  const label = safeSummary(text, 120);
  return label
    ? { state: 'unknown', label, source, reason: null }
    : { state: 'unknown', label: null, source, reason: 'Không đọc được trạng thái tài khoản.' };
}

export function buildDashboardCheck(agent: DashboardAgent, installed: boolean, results: CommandProbeResult[], checkedAt: number): DashboardCheck {
  const versionResult = results.find((result) => result.kind === 'version' && result.ok);
  const version = versionResult ? (safeSummary(versionResult.stdout || versionResult.stderr) || null) : null;
  const parsed = parseCliStatus(agent, results, redactSensitive);
  const account = parsed.account ?? classifyAccount(agent, results);

  let status: DashboardCheck['status'];
  if (!installed) status = 'unavailable';
  else if (account.state === 'unauthenticated') status = 'needs-login';
  else if (version !== null || account.state === 'authenticated') status = 'ready';
  else if (results.length > 0 && results.every((result) => !result.ok)) status = 'error';
  else status = 'unknown';

  return {
    ...parsed,
    checkedAt, status, version, account,
    quota: parsed.quota,
    credits: parsed.credits,
    details: parsed.details,
    quotas: parsed.quotas,
    probes: results.map((result) => ({
      command: result.command, ok: result.ok, exitCode: result.exitCode,
      summary: safeSummary(result.stderr || result.stdout),
      output: redactSensitive(`${result.stdout}\n${result.stderr}`).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '').replace(/\n{3,}/g, '\n\n').slice(-8000),
    })),
  };
}

// ── persisted cache ─────────────────────────────────────────────────────────
interface DashboardCacheFile { version: 1; checks: Partial<Record<DashboardAgent, DashboardCheck>> }

function parseCachedCheck(value: unknown): DashboardCheck | null {
  if (!value || typeof value !== 'object') return null;
  const check = value as Record<string, unknown>;
  if (typeof check.checkedAt !== 'number') return null;
  if (!['ready', 'needs-login', 'unavailable', 'unknown', 'error'].includes(String(check.status))) return null;
  if (typeof check.version !== 'string' && check.version !== null) return null;
  if (!check.account || typeof check.account !== 'object') return null;
  if (!check.quota || typeof check.quota !== 'object' || !check.credits || typeof check.credits !== 'object') return null;
  if (!Array.isArray(check.probes)) return null;
  return check as unknown as DashboardCheck;
}

// ── dashboard terminals ─────────────────────────────────────────────────────
interface TerminalRecord {
  id: string;
  agent: DashboardAgent;
  title: string;
  cwd: string;
  source: TerminalSessionInfo['source'];
  planId: string | null;
  taskId: string | null;
  createdAt: number;
  connected: boolean;
  claimed: boolean;
  connections: number;
  reconnectGraceMs: number;
  session: PtySession | null;
  offExit: (() => void) | null;
  ttlTimer: ReturnType<typeof setTimeout> | null;
  graceTimer: ReturnType<typeof setTimeout> | null;
}

export interface TerminalAttach { record: TerminalSessionInfo; session: PtySession }

function terminalId(): string {
  return `term-${randomBytes(12).toString('hex')}`;
}

function clampTitle(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160);
}

/**
 * Dashboard-owned interactive terminals. A session is created from a server
 * id only (agent / planId / taskId); the executable, argv and cwd are derived
 * from configuration and the store, never from the client. Unclaimed sessions
 * expire after a short TTL; disconnected ones keep a reconnection grace.
 */
export class DashboardTerminals {
  private readonly records = new Map<string, TerminalRecord>();

  constructor(private readonly options: {
    store: Pick<Store, 'getPlan' | 'getTask'>;
    pty: TerminalPty;
    config: () => FleetConfig;
    now: () => number;
    directory: string;
    maxSessions: number;
    unclaimedTtlMs: number;
    reconnectGraceMs: number;
  }) {}

  list(): TerminalSessionInfo[] {
    return [...this.records.values()].map((record) => this.info(record));
  }

  get(id: string): TerminalSessionInfo | undefined {
    const record = this.records.get(id);
    return record ? this.info(record) : undefined;
  }

  async create(input: { agent: DashboardAgent; planId?: string; taskId?: string }): Promise<TerminalSessionInfo> {
    if (this.records.size >= this.options.maxSessions) {
      throw new FleetError('conflict', `Đã đủ ${this.options.maxSessions} phiên terminal đang mở.`);
    }
    const target = this.resolve(input);
    const cfg = this.options.config();
    const bin = cfg.agents[input.agent]?.bin ?? null;
    if (!bin || !existsSync(bin)) {
      throw new FleetError('agent_unavailable', `Agent ${input.agent} chưa có executable.`);
    }
    const spec = getAdapter(input.agent).interactive({ bin, cwd: target.cwd, sessionId: null });
    const ptyTarget: PtyTarget = { cmd: spec.cmd, args: spec.args, cwd: target.cwd };
    const id = terminalId();
    const record: TerminalRecord = {
      id, agent: input.agent, title: clampTitle(target.title), cwd: target.cwd, source: target.source,
      planId: target.planId, taskId: target.taskId, createdAt: this.options.now(), connected: false,
      claimed: false, connections: 0, reconnectGraceMs: this.options.reconnectGraceMs,
      session: null, offExit: null, ttlTimer: null, graceTimer: null,
    };
    this.records.set(id, record);
    try {
      const session = this.options.pty.openTarget(id, ptyTarget, 80, 24);
      record.session = session;
      record.offExit = session.onExit(() => this.handleExit(id));
    } catch (error) {
      this.records.delete(id);
      throw new FleetError('agent_unavailable', `Không mở được terminal cho ${input.agent}: ${(error as Error).message}`);
    }
    record.ttlTimer = setTimeout(() => { void this.close(id); }, this.options.unclaimedTtlMs);
    record.ttlTimer.unref?.();
    return this.info(record);
  }

  /** Attach a websocket; null means the id is unknown/expired (never resurrected). */
  attach(id: string): TerminalAttach | null {
    const record = this.records.get(id);
    if (!record || record.session === null || record.offExit === null) return null;
    record.claimed = true;
    record.connections += 1;
    record.connected = true;
    this.clearTimer(record, 'ttlTimer');
    this.clearTimer(record, 'graceTimer');
    return { record: this.info(record), session: record.session };
  }

  /** A websocket detached; keep the process alive for the reconnection grace. */
  detach(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    record.connections = Math.max(0, record.connections - 1);
    if (record.connections > 0) return;
    record.connected = false;
    this.clearTimer(record, 'graceTimer');
    record.graceTimer = setTimeout(() => { void this.close(id); }, this.options.reconnectGraceMs);
    record.graceTimer.unref?.();
  }

  /** Explicit close: kill the process and drop the metadata. */
  async close(id: string): Promise<boolean> {
    const record = this.records.get(id);
    if (!record) return false;
    this.release(record);
    this.records.delete(id);
    await this.options.pty.kill(id);
    return true;
  }

  /** Kill every dashboard terminal belonging to a task (worktree removed/replaced). */
  async closeForTask(taskId: string): Promise<void> {
    const ids = [...this.records.values()].filter((record) => record.taskId === taskId).map((record) => record.id);
    await Promise.all(ids.map((id) => this.close(id)));
  }

  /** Kill every open terminal; used on server shutdown. */
  async closeAll(): Promise<void> {
    await Promise.all([...this.records.keys()].map((id) => this.close(id)));
  }

  private resolve(input: { agent: DashboardAgent; planId?: string; taskId?: string }): { cwd: string; source: TerminalSessionInfo['source']; planId: string | null; taskId: string | null; title: string } {
    if (input.taskId !== undefined) {
      const task = this.options.store.getTask(input.taskId);
      if (!task) throw new FleetError('not_found', `Task not found: ${input.taskId}`);
      if (input.planId !== undefined && task.planId !== input.planId) {
        throw new FleetError('bad_request', 'Task không thuộc plan đã chọn.');
      }
      if (task.status === 'queued' || task.status === 'running') {
        throw new FleetError('conflict', `Task ${task.id} đang chạy; không mở terminal trùng agent.`);
      }
      if (!existsSync(task.worktreePath)) throw new FleetError('conflict', `Worktree của task ${task.id} không còn tồn tại.`);
      return { cwd: task.worktreePath, source: 'task', planId: task.planId, taskId: task.id, title: `${AGENT_TITLES[input.agent]} · ${task.title}` };
    }
    if (input.planId !== undefined) {
      const plan = this.options.store.getPlan(input.planId);
      if (!plan) throw new FleetError('not_found', `Plan not found: ${input.planId}`);
      if (!existsSync(plan.repoPath)) throw new FleetError('conflict', `Repo của plan ${plan.id} không còn tồn tại.`);
      return { cwd: plan.repoPath, source: 'plan', planId: plan.id, taskId: null, title: `${AGENT_TITLES[input.agent]} · ${plan.name}` };
    }
    const cwd = path.join(this.options.directory, 'terminal-workspaces', input.agent);
    mkdirSync(cwd, { recursive: true });
    return { cwd, source: 'workspace', planId: null, taskId: null, title: `${AGENT_TITLES[input.agent]} · Workspace` };
  }

  private handleExit(id: string): void {
    const record = this.records.get(id);
    if (!record) return;
    this.release(record);
    this.records.delete(id);
  }

  private release(record: TerminalRecord): void {
    this.clearTimer(record, 'ttlTimer');
    this.clearTimer(record, 'graceTimer');
    record.offExit?.();
    record.offExit = null;
    record.connected = false;
    record.session = null;
  }

  private clearTimer(record: TerminalRecord, key: 'ttlTimer' | 'graceTimer'): void {
    const timer = record[key];
    if (timer) { clearTimeout(timer); record[key] = null; }
  }

  private info(record: TerminalRecord): TerminalSessionInfo {
    return {
      id: record.id, agent: record.agent, title: record.title, cwd: record.cwd, source: record.source,
      planId: record.planId, taskId: record.taskId, createdAt: record.createdAt,
      connected: record.connected, reconnectGraceMs: record.reconnectGraceMs,
    };
  }
}

// ── routes ──────────────────────────────────────────────────────────────────
function dimension(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 5_000 ? parsed : fallback;
}

/**
 * Fastify's default AJV strips unknown body keys instead of rejecting them.
 * These routes must refuse a client-supplied executable/argv/cwd, so the raw
 * body (still intact during preValidation) is checked explicitly.
 */
function rejectUnknownKeys(allowed: readonly string[]) {
  return async (request: { body: unknown }, reply: { code: (status: number) => { send: (payload: unknown) => unknown } }): Promise<void> => {
    const body = request.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) return;
    const extra = Object.keys(body).filter((key) => !allowed.includes(key));
    if (extra.length > 0) {
      await reply.code(400).send({ error: 'bad_request', message: `Unexpected properties: ${extra.join(', ')}` });
    }
  };
}

/**
 * Register the authenticated dashboard/terminal routes on an already-authenticated
 * Fastify scope. The routes never spawn a CLI on read; only `POST /api/dashboard/check`
 * runs the fixed, bounded, read-only probes.
 */
export function registerDashboardRoutes(routes: FastifyInstance, options: DashboardRouteOptions): DashboardTerminals {
  const deps = options.dashboard ?? {};
  const now = deps.now ?? (() => Date.now());
  const directory = deps.directory ?? dataDir();
  const probe = deps.probe ?? defaultDashboardProbe;

  let configCache: FleetConfig | null = deps.config ?? null;
  const config = (): FleetConfig => {
    if (!configCache) configCache = (deps.loadConfig ?? loadConfig)();
    return configCache;
  };

  const terminals = deps.terminals ?? new DashboardTerminals({
    store: options.store,
    pty: options.ptyManager ?? unavailablePty,
    config,
    now,
    directory,
    maxSessions: deps.maxSessions ?? DEFAULT_MAX_SESSIONS,
    unclaimedTtlMs: deps.unclaimedTtlMs ?? DEFAULT_UNCLAIMED_TTL_MS,
    reconnectGraceMs: deps.reconnectGraceMs ?? DEFAULT_RECONNECT_GRACE_MS,
  });

  const cachePath = path.join(directory, 'dashboard-checks.json');
  const checks = new Map<DashboardAgent, DashboardCheck>();
  try {
    if (existsSync(cachePath)) {
      const saved = JSON.parse(readFileSync(cachePath, 'utf8')) as DashboardCacheFile;
      if (saved.version === 1 && saved.checks) {
        for (const agent of DASHBOARD_AGENTS) {
          const check = parseCachedCheck(saved.checks[agent]);
          if (check) checks.set(agent, check);
        }
      }
    }
  } catch { /* A corrupt cache must never prevent startup. */ }

  const persist = (): void => {
    try {
      const saved: DashboardCacheFile = { version: 1, checks: Object.fromEntries([...checks.entries()]) };
      const temporary = `${cachePath}.${process.pid}.tmp`;
      writeFileSync(temporary, JSON.stringify(saved), 'utf8');
      renameSync(temporary, cachePath);
    } catch { /* Read-only data dir must not break the API. */ }
  };

  const toolFor = (agent: DashboardAgent): DashboardTool => {
    const bin = config().agents[agent]?.bin ?? null;
    return {
      agent, title: AGENT_TITLES[agent], configuredBin: bin,
      installed: bin !== null && existsSync(bin),
      lastCheck: checks.get(agent) ?? null,
      suggestions: SUGGESTIONS[agent],
    };
  };

  const inflight = new Map<DashboardAgent, Promise<DashboardCheck>>();
  const performCheck = (agent: DashboardAgent): Promise<DashboardCheck> => {
    const existing = inflight.get(agent);
    if (existing) return existing;
    const pending = (async () => {
      try {
        const bin = config().agents[agent]?.bin ?? null;
        const installed = bin !== null && existsSync(bin);
        const results = installed ? await probe(agent, bin!) : [];
        const check = buildDashboardCheck(agent, installed, results, now());
        const enrich = deps.enrich ?? (probe === defaultDashboardProbe ? enrichDashboardStatus : undefined);
        if (installed && enrich) Object.assign(check, await enrich(agent, {
          agent, bin: bin!, directory, config: config(), check, results, redact: redactSensitive,
          runCommand: (args, kind = 'status') => runCommand(bin!, { args, kind }),
        }));
        checks.set(agent, check);
        persist();
        return check;
      } finally {
        inflight.delete(agent);
      }
    })();
    inflight.set(agent, pending);
    return pending;
  };

  routes.get('/api/dashboard', async (): Promise<DashboardSnapshot> => ({
    generatedAt: now(),
    tools: DASHBOARD_AGENTS.map(toolFor),
    terminalSessions: terminals.list(),
  }));

  routes.post<{ Body: { agent: DashboardAgent } }>('/api/dashboard/check', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['agent'],
        properties: { agent: { type: 'string', enum: [...DASHBOARD_AGENTS] } },
      },
    },
    preValidation: rejectUnknownKeys(['agent']),
  }, async (request): Promise<DashboardTool> => {
    const agent = request.body.agent;
    if (!DASHBOARD_AGENTS.includes(agent)) throw new FleetError('bad_request', `Unknown dashboard agent: ${String(agent)}`);
    await performCheck(agent);
    return toolFor(agent);
  });

  routes.post<{ Body: { agent: DashboardAgent; planId?: string; taskId?: string } }>('/api/terminal-sessions', {
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['agent'],
        properties: {
          agent: { type: 'string', enum: [...DASHBOARD_AGENTS] },
          planId: { type: 'string', minLength: 1 },
          taskId: { type: 'string', minLength: 1 },
        },
      },
    },
    preValidation: rejectUnknownKeys(['agent', 'planId', 'taskId']),
  }, async (request): Promise<TerminalSessionInfo> => {
    const { agent, planId, taskId } = request.body;
    if (!DASHBOARD_AGENTS.includes(agent)) throw new FleetError('bad_request', `Unknown dashboard agent: ${String(agent)}`);
    return terminals.create({ agent, planId, taskId });
  });

  routes.delete<{ Params: { id: string } }>('/api/terminal-sessions/:id', async (request, reply) => {
    const closed = await terminals.close(request.params.id);
    if (!closed) throw new FleetError('not_found', `Terminal session not found: ${request.params.id}`);
    return reply.code(204).send();
  });

  routes.get<{ Querystring: { sessionId?: string; cols?: string; rows?: string } }>(
    '/ws/terminal',
    { websocket: true },
    (socket, request) => {
      const query = request.query as { sessionId?: string; cols?: string; rows?: string };
      const attach = terminals.attach(query.sessionId ?? '');
      if (!attach) {
        try { socket.send(JSON.stringify({ t: 'exit', code: 1 })); } catch { /* already closed */ }
        socket.close(1008, 'Phiên terminal không hợp lệ');
        return;
      }
      const { session, record } = attach;
      session.resize(dimension(query.cols, 80), dimension(query.rows, 24));
      const offData = session.onData((data) => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ t: 'out', d: data }));
      });
      const offExit = session.onExit((code) => {
        if (socket.readyState === 1) socket.send(JSON.stringify({ t: 'exit', code }));
        socket.close();
      });
      socket.on('message', (raw: Buffer) => {
        let message: { t?: string; d?: string; cols?: number; rows?: number };
        try { message = JSON.parse(raw.toString()) as typeof message; } catch { return; }
        if (message.t === 'in' && typeof message.d === 'string') session.write(message.d);
        else if (message.t === 'resize' && typeof message.cols === 'number' && typeof message.rows === 'number') {
          session.resize(message.cols, message.rows);
        }
      });
      let detached = false;
      const cleanup = (): void => {
        if (detached) return;
        detached = true;
        offData();
        offExit();
        terminals.detach(record.id);
      };
      socket.once('close', cleanup);
      socket.once('error', cleanup);
    },
  );

  routes.addHook('onClose', async () => { await terminals.closeAll(); });
  return terminals;
}
