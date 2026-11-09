import { appendFileSync, closeSync, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  ErrorCategory,
  FleetEvent,
  Plan,
  Run,
  RunStatus,
  StoredEvent,
  Task,
  TaskStatus,
} from '../shared/types.js';
import { newId, slugify } from './ids.js';
import { files } from './paths.js';

/** Values `node:sqlite` accepts as bound parameters. */
type DbValue = null | number | string;
type Row = Record<string, unknown>;

const PLAN_COLUMNS = ['id', 'name', 'slug', 'repoPath', 'baseBranch', 'createdAt'] as const;

const TASK_COLUMNS = [
  'id',
  'planId',
  'title',
  'agent',
  'status',
  'branch',
  'worktreePath',
  'checkCmd',
  'createdAt',
  'finishedAt',
] as const;

const RUN_COLUMNS = [
  'id',
  'taskId',
  'attempt',
  'agent',
  'brief',
  'note',
  'status',
  'pid',
  'exitCode',
  'startedAt',
  'endedAt',
  'durationMs',
  'checkPassed',
  'inputTokens',
  'outputTokens',
  'costUsd',
  'finalMessage',
  'errorCategory',
  'sessionId',
  'commandPolicy',
  'allowedCommands',
] as const;

/** `id` is never patched: it is the primary key used to locate the row. */
const TASK_PATCHABLE = TASK_COLUMNS.filter((c) => c !== 'id');
const RUN_PATCHABLE = RUN_COLUMNS.filter((c) => c !== 'id');

/**
 * SQLite-backed store for plans, tasks and runs, plus a JSONL event log per run
 * (`files.log(runId)`). One connection per `Store` instance; call `close()`
 * before removing the data directory on Windows.
 */
export class Store {
  private readonly db: DatabaseSync;
  /** Next seq to hand out per run; seeded from the existing log file on demand. */
  private readonly nextSeqByRun = new Map<string, number>();

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      mkdirSync(path.win32.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plans (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        slug        TEXT NOT NULL,
        repoPath    TEXT NOT NULL,
        baseBranch  TEXT NOT NULL,
        createdAt   INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS tasks (
        id           TEXT PRIMARY KEY,
        planId       TEXT NOT NULL,
        title        TEXT NOT NULL,
        agent        TEXT NOT NULL,
        status       TEXT NOT NULL,
        branch       TEXT NOT NULL,
        worktreePath TEXT NOT NULL,
        checkCmd     TEXT,
        createdAt    INTEGER NOT NULL,
        finishedAt   INTEGER
      );
      CREATE TABLE IF NOT EXISTS runs (
        id            TEXT PRIMARY KEY,
        taskId        TEXT NOT NULL,
        attempt       INTEGER NOT NULL,
        agent         TEXT NOT NULL,
        brief         TEXT NOT NULL,
        note          TEXT,
        status        TEXT NOT NULL,
        pid           INTEGER,
        exitCode      INTEGER,
        startedAt     INTEGER,
        endedAt       INTEGER,
        durationMs    INTEGER,
        checkPassed   INTEGER,
        inputTokens   INTEGER,
        outputTokens  INTEGER,
        costUsd       REAL,
        finalMessage  TEXT,
        errorCategory TEXT,
        sessionId     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_planId ON tasks (planId);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks (status);
      CREATE INDEX IF NOT EXISTS idx_runs_taskId ON runs (taskId, attempt);
      CREATE INDEX IF NOT EXISTS idx_runs_status ON runs (status);
    `);
    // Additive migration preserves existing task/run history on desktop upgrade.
    const runColumns = this.db.prepare('PRAGMA table_info(runs)').all() as Row[];
    if (!runColumns.some(column => column.name === 'commandPolicy')) this.db.exec("ALTER TABLE runs ADD COLUMN commandPolicy TEXT NOT NULL DEFAULT 'ask'");
    if (!runColumns.some(column => column.name === 'allowedCommands')) this.db.exec("ALTER TABLE runs ADD COLUMN allowedCommands TEXT NOT NULL DEFAULT '[]'");
  }

  /** Close the connection (and its WAL handles). */
  close(): void {
    this.db.close();
  }

  /** Current SQLite journal mode; `wal` on file-backed databases. */
  journalMode(): string {
    const row = this.db.prepare('PRAGMA journal_mode').get() as Row | undefined;
    return String(row?.journal_mode ?? '');
  }

  // ── plans ────────────────────────────────────────────────────────────────

  createPlan(p: Omit<Plan, 'id' | 'createdAt' | 'slug'>): Plan {
    const plan: Plan = {
      id: newId('p'),
      name: p.name,
      slug: slugify(p.name),
      repoPath: p.repoPath,
      baseBranch: p.baseBranch,
      createdAt: Date.now(),
    };
    this.db
      .prepare(
        'INSERT INTO plans (id, name, slug, repoPath, baseBranch, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        plan.id,
        plan.name,
        plan.slug,
        plan.repoPath,
        plan.baseBranch,
        plan.createdAt,
      );
    return plan;
  }

  getPlan(id: string): Plan | undefined {
    const row = this.db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as Row | undefined;
    return row ? toPlan(row) : undefined;
  }

  listPlans(): Plan[] {
    const rows = this.db
      .prepare('SELECT * FROM plans ORDER BY createdAt ASC, id ASC')
      .all() as Row[];
    return rows.map(toPlan);
  }

  // ── tasks ────────────────────────────────────────────────────────────────

  createTask(t: Omit<Task, 'id' | 'createdAt' | 'finishedAt' | 'status'> & { id?: string }): Task {
    const task: Task = {
      id: t.id ?? newId('t'),
      planId: t.planId,
      title: t.title,
      agent: t.agent,
      status: 'queued',
      branch: t.branch,
      worktreePath: t.worktreePath,
      checkCmd: t.checkCmd,
      createdAt: Date.now(),
      finishedAt: null,
    };
    this.db
      .prepare(
        `INSERT INTO tasks (${TASK_COLUMNS.join(', ')})
         VALUES (${placeholders(TASK_COLUMNS.length)})`,
      )
      .run(...TASK_COLUMNS.map((c) => toDb(task[c])));
    return task;
  }

  getTask(id: string): Task | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Row | undefined;
    return row ? toTask(row) : undefined;
  }

  listTasks(f?: { planId?: string; status?: TaskStatus }): Task[] {
    const where: string[] = [];
    const params: DbValue[] = [];
    if (f?.planId !== undefined) {
      where.push('planId = ?');
      params.push(f.planId);
    }
    if (f?.status !== undefined) {
      where.push('status = ?');
      params.push(f.status);
    }
    const sql =
      'SELECT * FROM tasks' +
      (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY createdAt ASC, id ASC';
    const rows = this.db.prepare(sql).all(...params) as Row[];
    return rows.map(toTask);
  }

  updateTask(id: string, patch: Partial<Task>): Task {
    const entries = patchEntries(patch, TASK_PATCHABLE);
    if (entries.length > 0) {
      const assignments = entries.map(([column]) => `${column} = ?`).join(', ');
      this.db
        .prepare(`UPDATE tasks SET ${assignments} WHERE id = ?`)
        .run(...entries.map(([, value]) => toDb(value)), id);
    }
    const task = this.getTask(id);
    if (!task) throw new Error(`task not found: ${id}`);
    return task;
  }

  // ── runs ─────────────────────────────────────────────────────────────────

  createRun(r: Pick<Run, 'taskId' | 'agent' | 'brief' | 'note' | 'commandPolicy' | 'allowedCommands'> & { sessionId?: string | null }): Run {
    const maxRow = this.db
      .prepare('SELECT MAX(attempt) AS maxAttempt FROM runs WHERE taskId = ?')
      .get(r.taskId) as Row | undefined;
    const attempt = Number(maxRow?.maxAttempt ?? 0) + 1;

    const run: Run = {
      id: newId('r'),
      taskId: r.taskId,
      attempt,
      agent: r.agent,
      brief: r.brief,
      note: r.note,
      status: 'queued',
      pid: null,
      exitCode: null,
      startedAt: null,
      endedAt: null,
      durationMs: null,
      checkPassed: null,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      finalMessage: null,
      errorCategory: null,
      sessionId: r.sessionId ?? null,
      commandPolicy: r.commandPolicy ?? 'ask',
      allowedCommands: r.allowedCommands ?? [],
    };
    this.db
      .prepare(
        `INSERT INTO runs (${RUN_COLUMNS.join(', ')})
         VALUES (${placeholders(RUN_COLUMNS.length)})`,
      )
      .run(...RUN_COLUMNS.map((c) => toDb(run[c])));
    return run;
  }

  getRun(id: string): Run | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Row | undefined;
    return row ? toRun(row) : undefined;
  }

  listRuns(f?: { taskId?: string; status?: RunStatus }): Run[] {
    const where: string[] = [];
    const params: DbValue[] = [];
    if (f?.taskId !== undefined) {
      where.push('taskId = ?');
      params.push(f.taskId);
    }
    if (f?.status !== undefined) {
      where.push('status = ?');
      params.push(f.status);
    }
    const sql =
      'SELECT * FROM runs' +
      (where.length > 0 ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY rowid ASC';
    const rows = this.db.prepare(sql).all(...params) as Row[];
    return rows.map(toRun);
  }

  latestRun(taskId: string): Run | undefined {
    const row = this.db
      .prepare('SELECT * FROM runs WHERE taskId = ? ORDER BY attempt DESC, rowid DESC LIMIT 1')
      .get(taskId) as Row | undefined;
    return row ? toRun(row) : undefined;
  }

  updateRun(id: string, patch: Partial<Run>): Run {
    const entries = patchEntries(patch, RUN_PATCHABLE);
    if (entries.length > 0) {
      const assignments = entries.map(([column]) => `${column} = ?`).join(', ');
      this.db
        .prepare(`UPDATE runs SET ${assignments} WHERE id = ?`)
        .run(...entries.map(([, value]) => toDb(value)), id);
    }
    const run = this.getRun(id);
    if (!run) throw new Error(`run not found: ${id}`);
    return run;
  }

  // ── events (JSONL log) ───────────────────────────────────────────────────

  appendEvent(runId: string, e: FleetEvent): StoredEvent {
    const seq = this.takeSeq(runId);
    const stored: StoredEvent = { runId, seq, ts: Date.now(), event: e };
    appendFileSync(files.log(runId), `${JSON.stringify(stored)}\n`, 'utf8');
    return stored;
  }

  readEvents(runId: string, o?: { afterSeq?: number; tail?: number }): StoredEvent[] {
    const logPath = files.log(runId);
    if (!existsSync(logPath)) return [];
    // Tail reads (the live UI) only need the end of a possibly large log.
    if (o?.tail !== undefined) return o.tail <= 0 ? [] : readTailEvents(logPath, o.tail, o.afterSeq);

    const events: StoredEvent[] = [];
    for (const line of readFileSync(logPath, 'utf8').split('\n')) {
      if (line.trim().length === 0) continue;
      try {
        events.push(JSON.parse(line) as StoredEvent);
      } catch {
        // A torn final line (crash mid-write) is skipped so the rest survives.
      }
    }

    const afterSeq = o?.afterSeq;
    const filtered =
      afterSeq === undefined ? events : events.filter((event) => event.seq > afterSeq);

    if (o?.tail === undefined) return filtered;
    if (o.tail <= 0) return [];
    return filtered.slice(-o.tail);
  }

  private takeSeq(runId: string): number {
    const cached = this.nextSeqByRun.get(runId);
    if (cached !== undefined) {
      this.nextSeqByRun.set(runId, cached + 1);
      return cached;
    }
    const next = lastSeqInFile(files.log(runId)) + 1;
    this.nextSeqByRun.set(runId, next + 1);
    return next;
  }
}

const TAIL_CHUNK = 64 * 1024;

/**
 * Last `tail` parsable events with seq > afterSeq, reading the file backwards in chunks. Splits on
 * the 0x0a byte so multibyte text is never cut, and skips unparsable (torn) lines like a full read.
 */
function readTailEvents(logPath: string, tail: number, afterSeq: number | undefined): StoredEvent[] {
  const fd = openSync(logPath, 'r');
  const found: StoredEvent[] = [];
  try {
    let position = fstatSync(fd).size;
    let carry = Buffer.alloc(0);
    while (position > 0 && found.length < tail) {
      const length = Math.min(TAIL_CHUNK, position);
      position -= length;
      const chunk = Buffer.alloc(length);
      readSync(fd, chunk, 0, length, position);
      const data = Buffer.concat([chunk, carry]);
      const firstBreak = position === 0 ? -1 : data.indexOf(0x0a);
      if (position > 0 && firstBreak === -1) { carry = data; continue; }
      carry = position === 0 ? Buffer.alloc(0) : data.subarray(0, firstBreak);
      collectTail(data.subarray(firstBreak + 1), tail, afterSeq, found);
    }
  } finally {
    closeSync(fd);
  }
  return found.reverse();
}

/** Appends the complete lines of `block`, last first, until `found` holds `tail` events. */
function collectTail(block: Buffer, tail: number, afterSeq: number | undefined, found: StoredEvent[]): void {
  const lines = block.toString('utf8').split('\n');
  for (let i = lines.length - 1; i >= 0 && found.length < tail; i--) {
    const line = lines[i]!;
    if (line.trim().length === 0) continue;
    try {
      const event = JSON.parse(line) as StoredEvent;
      if (afterSeq === undefined || event.seq > afterSeq) found.push(event);
    } catch {
      // A torn line is skipped so the rest survives.
    }
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/** Patch entries filtered to the table's mutable columns, skipping `undefined`. */
function patchEntries(patch: Record<string, unknown>, allowed: readonly string[]): [string, unknown][] {
  const entries: [string, unknown][] = [];
  for (const column of allowed) {
    if (!Object.prototype.hasOwnProperty.call(patch, column)) continue;
    const value = patch[column];
    if (value === undefined) continue;
    entries.push([column, value]);
  }
  return entries;
}

function toDb(value: unknown): DbValue {
  if (value === null || value === undefined) return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'number' || typeof value === 'string') return value;
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return JSON.stringify(value);
  throw new TypeError(`cannot bind value of type ${typeof value} to SQLite`);
}

function toPlan(row: Row): Plan {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    repoPath: String(row.repoPath),
    baseBranch: String(row.baseBranch),
    createdAt: Number(row.createdAt),
  };
}

function toTask(row: Row): Task {
  return {
    id: String(row.id),
    planId: String(row.planId),
    title: String(row.title),
    agent: String(row.agent) as Task['agent'],
    status: String(row.status) as TaskStatus,
    branch: String(row.branch),
    worktreePath: String(row.worktreePath),
    checkCmd: nullableString(row.checkCmd),
    createdAt: Number(row.createdAt),
    finishedAt: nullableNumber(row.finishedAt),
  };
}

function toRun(row: Row): Run {
  return {
    id: String(row.id),
    taskId: String(row.taskId),
    attempt: Number(row.attempt),
    agent: String(row.agent) as Run['agent'],
    brief: String(row.brief),
    note: nullableString(row.note),
    status: String(row.status) as RunStatus,
    pid: nullableNumber(row.pid),
    exitCode: nullableNumber(row.exitCode),
    startedAt: nullableNumber(row.startedAt),
    endedAt: nullableNumber(row.endedAt),
    durationMs: nullableNumber(row.durationMs),
    checkPassed: nullableBoolean(row.checkPassed),
    inputTokens: nullableNumber(row.inputTokens),
    outputTokens: nullableNumber(row.outputTokens),
    costUsd: nullableNumber(row.costUsd),
    finalMessage: nullableString(row.finalMessage),
    errorCategory: nullableString(row.errorCategory) as ErrorCategory | null,
    sessionId: nullableString(row.sessionId),
    commandPolicy: row.commandPolicy === 'auto' || row.commandPolicy === 'check-only' ? row.commandPolicy : 'ask',
    allowedCommands: parseCommands(row.allowedCommands),
  };
}

function parseCommands(value: unknown): string[] {
  try { const parsed: unknown = JSON.parse(String(value ?? '[]')); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []; }
  catch { return []; }
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function nullableBoolean(value: unknown): boolean | null {
  if (value === null || value === undefined) return null;
  return Number(value) !== 0;
}

/** Highest seq already present in a run's log file, or 0 when it does not exist. */
function lastSeqInFile(logPath: string): number {
  if (!existsSync(logPath)) return 0;
  let max = 0;
  for (const line of readFileSync(logPath, 'utf8').split('\n')) {
    if (line.trim().length === 0) continue;
    try {
      const parsed = JSON.parse(line) as { seq?: unknown };
      if (typeof parsed.seq === 'number' && parsed.seq > max) max = parsed.seq;
    } catch {
      // ignore torn lines
    }
  }
  return max;
}
