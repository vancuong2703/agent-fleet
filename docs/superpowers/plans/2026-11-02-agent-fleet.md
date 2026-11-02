# Agent Fleet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local Windows app where a leader model dispatches coding tasks to agent CLIs (codex, qodercli, agy, opencode) via a `fleet` CLI, each task in its own git worktree, with a live web UI for logs, diffs, terminal takeover and agent comparison.

**Architecture:** One Node 24 TypeScript server (Fastify + WebSocket) owns state (built-in `node:sqlite` + JSONL logs), git worktrees, agent processes (per-agent adapters) and PTYs. A thin `fleet` CLI talks HTTP to it; a React + Vite UI talks HTTP + WS to it.

**Tech Stack:** Node 24, TypeScript, tsx, Vitest, Fastify 5 + @fastify/websocket + @fastify/static, `node:sqlite`, commander, @lydell/node-pty (prebuilt Windows binaries), React 18 + Vite, xterm.js (@xterm/xterm), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-02-agent-fleet-design.md`

## Global Constraints

- Platform: Windows 11, Node v24.20.0. All paths handed to git/CLIs are absolute, normalized with `path.win32`, and spawned without a shell (`shell: false`) so quoting is never string-built.
- Data dir: `%LOCALAPPDATA%\agent-fleet\` (`fleet.db`, `logs\<run-id>.jsonl`, `briefs\<run-id>.md`, `worktrees\<repo-name>\<task-id>\`, `token`, `fleet.config.json`). Env `FLEET_DATA_DIR` overrides it (tests always set it to a temp dir).
- Server binds `127.0.0.1` only, default port `4500`; every HTTP/WS request needs the token (header `x-fleet-token`, or cookie `fleet_token`).
- Branch name: `fleet/<plan-slug>/<task-id>`; task id format `t-` + 4 lowercase base36 chars; plan id `p-` + 4 chars; run id `r-` + 6 chars.
- Defaults: `maxParallel` 2 per agent, `maxParallelTotal` 4, `timeouts.totalMin` 30, `timeouts.idleMin` 10.
- Merge = `git merge --no-ff` into `baseBranch` in the original repo; worktree changes committed first with message `fleet: <title>`.
- `quota` and `auth` error categories never count as agent failures in stats.
- UI copy is Vietnamese, sentence case, light and dark mode.
- Single package (no npm workspaces): folders `shared/`, `server/`, `cli/`, `web/`, `test/`.

## Review Focus

1. Briefs containing quotes, newlines and Vietnamese diacritics reach the agent byte-for-byte → Task 7 test `brief survives unicode and quotes`.
2. Stop/timeout must kill the agent's whole process tree, not just the parent → Task 7 test `timeout kills child processes`.
3. Server restarted while a run is `running` → run becomes `interrupted`, never stuck as running → Task 8 test `recover marks orphaned runs interrupted`.
4. Repo path containing spaces → Task 5 tests run in a temp dir named `repo with space`.
5. Two `fleet run` calls on the same repo at once (git `index.lock` contention) → git ops serialized per repo; Task 5 test `parallel createWorktree on same repo`.

---

## File Structure

```
package.json, tsconfig.json, vitest.config.ts, playwright.config.ts
shared/types.ts            domain types + FleetEvent (used by server, cli, web)
server/paths.ts            data dir + file locations
server/config.ts           fleet.config.json load/detect
server/ids.ts              id generation, slugify
server/store.ts            SQLite plans/tasks/runs + JSONL events
server/git.ts              git exec helper + per-repo mutex
server/worktree.ts         worktree create/diff/commit/merge/remove
server/adapters/types.ts   AgentAdapter, LineParser
server/adapters/fake.ts    + test/fixtures/fake-agent.mjs
server/adapters/{codex,qodercli,agy,opencode}.ts
server/adapters/index.ts   registry
server/process.ts          spawn + killTree
server/runner.ts           run one agent attempt, timeouts, check
server/bus.ts              typed EventEmitter
server/service.ts          TaskService (lifecycle, scheduler, wait, recover)
server/stats.ts            agent comparison
server/pty.ts              PtyManager
server/api.ts              Fastify routes + WS
server/main.ts             start server
cli/client.ts, cli/fleet.ts
web/ (Vite app): src/main.tsx, api.ts, ws.ts, App.tsx, components/*
test/** mirrors the above
```

---

### Task 1: Project scaffold and native-dependency check

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `shared/types.ts`, `test/smoke.test.ts`

**Interfaces:**
- Produces (`shared/types.ts`):
```ts
export type AgentId = 'codex' | 'qodercli' | 'agy' | 'opencode' | 'fake';
export type RunStatus = 'queued' | 'running' | 'done' | 'failed' | 'timeout' | 'interrupted' | 'taken_over';
export type TaskStatus = RunStatus | 'merged' | 'discarded';
export type ErrorCategory = 'quota' | 'auth' | 'agent' | 'system';
export type FleetEvent = /* exactly the union in spec §3 */;
export interface StoredEvent { runId: string; seq: number; ts: number; event: FleetEvent }
export interface Plan { id: string; name: string; slug: string; repoPath: string; baseBranch: string; createdAt: number }
export interface Task { id: string; planId: string; title: string; agent: AgentId; status: TaskStatus; branch: string; worktreePath: string; checkCmd: string | null; createdAt: number; finishedAt: number | null }
export interface Run { id: string; taskId: string; attempt: number; agent: AgentId; brief: string; note: string | null; status: RunStatus; pid: number | null; exitCode: number | null; startedAt: number | null; endedAt: number | null; durationMs: number | null; checkPassed: boolean | null; inputTokens: number | null; outputTokens: number | null; costUsd: number | null; finalMessage: string | null; errorCategory: ErrorCategory | null; sessionId: string | null }
export interface DiffFile { path: string; added: number; removed: number }
export interface TaskResult { task: Task; run: Run | null; files: DiffFile[] }
```

- [ ] **Step 1:** `npm init`, set `"type": "module"`, scripts `test` (`vitest run`), `dev:server` (`tsx watch server/main.ts`), `dev:web` (`vite web`), `build:web` (`vite build web`), `fleet` (`tsx cli/fleet.ts`), `bin: { fleet: "cli/fleet-bin.cjs" }` (tiny CJS shim that runs `tsx cli/fleet.ts` with args). Install deps from Tech Stack. tsconfig: `strict`, `module`/`moduleResolution` `NodeNext`, `jsx: react-jsx`.
- [ ] **Step 2: Write `test/smoke.test.ts`** asserting: `await import('node:sqlite')` opens `:memory:` and `SELECT 1` returns 1; `@lydell/node-pty` spawns `cmd.exe /c echo hi` and its output contains `hi` within 5 s.
- [ ] **Step 3:** Run `npm test`. Expected: PASS. If node-pty fails to load, try `@homebridge/node-pty-prebuilt-multiarch`; record the chosen package in `package.json` and report it — later tasks import it only via `server/pty.ts`.
- [ ] **Step 4:** Commit `chore: scaffold project`.

### Task 2: Probe real agent CLIs and record fixtures

**Files:**
- Create: `scripts/probe.ps1`, `server/adapters/__fixtures__/{codex,qodercli,agy}/{success.stdout.txt,success.stderr.txt,NOTES.md}`

This task spends a little agent quota. It must be run by someone allowed to execute the user's CLIs; do not log in anywhere — if a CLI needs auth, record that in NOTES.md and stop for that agent.

- [ ] **Step 1:** Write `scripts/probe.ps1 <agent> <outDir>`: creates a temp git repo (one README commit), runs the agent headless with brief `Tạo file hello.txt chứa chữ "xin chào". Không làm gì khác.`, captures stdout/stderr raw to the fixture files, prints exit code and whether `hello.txt` exists.
- [ ] **Step 2:** For each agent, discover the real headless flags with `--help` first (`codex exec --help`, `qodercli --help`, `agy --help`), starting from spec §3's table. Required facts per agent in `NOTES.md`: exact command line used; how the brief is passed (stdin / arg / file); output format (JSONL schema sample of each event type seen); which line carries the final answer; usage/cost fields if any; session id field and the interactive resume command; exit code on success; what an auth error and a quota error look like if documented.
- [ ] **Step 3:** Run the probe for codex, qodercli, agy. Expected: `hello.txt` created by each, fixtures non-empty. If agy has no stable headless mode, write that in `agy/NOTES.md` (agy adapter then becomes terminal-only per spec §9).
- [ ] **Step 4:** Commit `test: record agent CLI fixtures`.

### Task 3: Paths, ids and config

**Files:**
- Create: `server/paths.ts`, `server/ids.ts`, `server/config.ts`, `test/server/config.test.ts`

**Interfaces:**
- Produces:
```ts
// paths.ts
export function dataDir(): string; // FLEET_DATA_DIR ?? %LOCALAPPDATA%\agent-fleet, created if missing
export const files: { db(): string; log(runId: string): string; brief(runId: string): string; worktree(repoName: string, taskId: string): string; token(): string; config(): string };
// ids.ts
export function newId(prefix: 'p' | 't' | 'r'): string; export function slugify(s: string): string; // Vietnamese diacritics stripped, [a-z0-9-], max 40
// config.ts
export interface AgentConfig { bin: string | null; maxParallel: number; extraArgs: string[] }
export interface FleetConfig { port: number; agents: Record<Exclude<AgentId,'fake'>, AgentConfig>; maxParallelTotal: number; timeouts: { totalMin: number; idleMin: number } }
export function loadConfig(): FleetConfig;      // creates file with detected bins + defaults if missing; fills missing keys with defaults
export function detectBin(agent: AgentId): string | null; // `where.exe <name>` then known paths: %LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe, %USERPROFILE%\.qoder\bin\qodercli\qodercli.exe, %LOCALAPPDATA%\agy\bin\agy.exe
export function readOrCreateToken(): string;    // 32 random hex chars
```

- [ ] **Step 1: Tests:** `slugify('Plan 2 – Editor Việt')` → `'plan-2-editor-viet'`; `newId('t')` matches `/^t-[0-9a-z]{4}$/`; `loadConfig()` with empty `FLEET_DATA_DIR` writes `fleet.config.json` containing `port: 4500`, `maxParallelTotal: 4`, `timeouts {30,10}`; a partial config file `{ "port": 4600 }` loads with port 4600 and all other defaults; `readOrCreateToken()` returns the same value twice.
- [ ] **Step 2:** Run, see FAIL. **Step 3:** Implement. **Step 4:** Run, PASS. **Step 5:** Commit `feat: paths, ids, config`.

### Task 4: Store

**Files:**
- Create: `server/store.ts`, `test/server/store.test.ts`

**Interfaces:**
- Produces:
```ts
export class Store {
  constructor(dbPath: string);
  createPlan(p: Omit<Plan,'id'|'createdAt'|'slug'>): Plan; getPlan(id): Plan | undefined; listPlans(): Plan[];
  createTask(t: Omit<Task,'id'|'createdAt'|'finishedAt'|'status'> & { id?: string }): Task; // status 'queued'
  getTask(id): Task | undefined; listTasks(f?: { planId?: string; status?: TaskStatus }): Task[]; updateTask(id, patch: Partial<Task>): Task;
  createRun(r: Pick<Run,'taskId'|'agent'|'brief'|'note'>): Run; // attempt = previous max + 1, status 'queued'
  updateRun(id, patch: Partial<Run>): Run; getRun(id): Run | undefined; listRuns(f?: { taskId?: string; status?: RunStatus }): Run[]; latestRun(taskId): Run | undefined;
  appendEvent(runId: string, e: FleetEvent): StoredEvent; // seq per run starting at 1, ts = Date.now(), appended as one JSON line to files.log(runId)
  readEvents(runId: string, o?: { afterSeq?: number; tail?: number }): StoredEvent[];
}
```
Tables `plans`, `tasks`, `runs` with columns matching the types (booleans as INTEGER, nullable fields NULL). Use `node:sqlite` `DatabaseSync`, WAL mode.

- [ ] **Step 1: Tests:** plan/task/run round-trip including nulls and `checkPassed=false`; `createRun` twice → attempts 1 and 2; `latestRun` returns attempt 2; `appendEvent` ×3 then `readEvents(id,{afterSeq:1})` returns seqs [2,3] and `{tail:1}` returns [3]; events with Vietnamese text round-trip; a second `Store` on the same file sees data written by the first.
- [ ] **Steps 2–5:** fail → implement → pass → commit `feat: sqlite store and event log`.

### Task 5: Git worktree manager

**Files:**
- Create: `server/git.ts`, `server/worktree.ts`, `test/server/worktree.test.ts`, `test/helpers/repo.ts` (`makeTempRepo(): Promise<string>` → repo in a temp dir named `repo with space`, one commit on `main`)

**Interfaces:**
- Produces:
```ts
// git.ts
export function git(cwd: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
export function withRepoLock<T>(repoPath: string, fn: () => Promise<T>): Promise<T>; // in-process mutex keyed by normalized repo path
// worktree.ts
export function currentBranch(repo: string): Promise<string>;
export function createWorktree(o: { repoPath: string; baseBranch: string; branch: string; path: string }): Promise<void>; // throws Error with git stderr
export function diffWorktree(wt: string, baseBranch: string): Promise<{ files: DiffFile[]; patch: string }>; // `git add -A` then `git diff --cached --numstat <base>` / patch; includes new files
export function commitAll(wt: string, message: string): Promise<boolean>; // false if nothing to commit
export type MergeResult = { ok: true } | { ok: false; reason: 'dirty' | 'wrong_branch' | 'conflict'; files?: string[] };
export function mergeBranch(o: { repoPath: string; baseBranch: string; branch: string }): Promise<MergeResult>; // checks status --porcelain empty and HEAD==base first; on conflict runs merge --abort
export function removeWorktree(o: { repoPath: string; path: string; branch: string; deleteBranch: boolean }): Promise<void>;
```
All mutating functions run inside `withRepoLock(repoPath)`.

- [ ] **Step 1: Tests** (each on `makeTempRepo()`): create worktree → dir exists, on the new branch; write a new file + modify README → `diffWorktree` lists both with correct added/removed; `commitAll` true then false; `mergeBranch` ok → file present in repo on `main`; repo dirty → `{ok:false,reason:'dirty'}`; repo checked out on other branch → `wrong_branch`; two worktrees editing the same README line, merge first ok, second → `conflict` with `files:['README.md']` and repo left clean; `parallel createWorktree on same repo` (5 at once via `Promise.all`) all succeed; `removeWorktree` deletes dir and branch.
- [ ] **Steps 2–5:** fail → implement → pass → commit `feat: git worktree manager`.

### Task 6: Adapter contract and fake agent

**Files:**
- Create: `server/adapters/types.ts`, `server/adapters/fake.ts`, `server/adapters/index.ts`, `test/fixtures/fake-agent.mjs`, `test/server/fake-adapter.test.ts`

**Interfaces:**
- Produces:
```ts
export type LineParser = (line: string, stream: 'stdout' | 'stderr') => FleetEvent[];
export interface HeadlessSpec { cmd: string; args: string[]; env?: Record<string, string>; stdin?: string }
export interface AgentAdapter {
  id: AgentId;
  headlessSupported: boolean;
  detect(cfg: AgentConfig): Promise<{ ok: boolean; version?: string; reason?: string }>;
  headless(i: { bin: string; brief: string; briefFile: string; cwd: string; extraArgs: string[] }): HeadlessSpec;
  createParser(): LineParser;                     // stateful per run; unknown lines → [{kind:'raw',...}]
  finalMessage(events: FleetEvent[]): string | null; // default: text of last 'message'
  interactive(i: { bin: string; cwd: string; sessionId: string | null }): { cmd: string; args: string[] };
}
export function getAdapter(id: AgentId): AgentAdapter; // index.ts registry
export function getAdapterConfig(id: AgentId, cfg: FleetConfig): AgentConfig;
```
`fake-agent.mjs <scenario>` reads the brief from stdin and prints JSON lines `{"type":"message"|"command"|"edit"|"usage"|"session"|"error", ...}`. Scenarios: `success` (echoes the brief back in a message, writes `fake.txt` in cwd, exit 0), `fail` (exit 3), `hang` (prints one line then sleeps forever), `spawn-child-hang` (spawns a detached-less child `node -e "setInterval(()=>{},1000)"` that writes its pid to `child.pid`, then hangs), `quota` (prints `{"type":"error","text":"rate limit exceeded"}` exit 1), `slow` (message every 200 ms for 1 s, exit 0). The fake adapter maps these JSON types onto `FleetEvent`, classifies `rate limit` → `category:'quota'`. Scenario is chosen by a brief that starts with `[[<scenario>]]` (default `success`); the adapter passes it as the script argument. `fake` needs no config entry: its bin is always `process.execPath`, `detect()` always ok, `maxParallel` 2. `getAdapterConfig(id, config): AgentConfig` in `index.ts` returns that for `fake` and `config.agents[id]` otherwise — service and API use it everywhere.

- [ ] **Step 1: Tests:** fake parser maps each JSON type to the right `kind`; non-JSON line → `raw`; `rate limit` error → `category:'quota'`; `getAdapter('fake').headless(...)` returns `cmd = process.execPath` and passes brief via `stdin`.
- [ ] **Steps 2–5:** fail → implement → pass → commit `feat: adapter contract and fake agent`.

### Task 7: Process control and runner

**Files:**
- Create: `server/process.ts`, `server/runner.ts`, `test/server/runner.test.ts`

**Interfaces:**
- Consumes: `AgentAdapter`, `HeadlessSpec` (Task 6).
- Produces:
```ts
// process.ts
export function killTree(pid: number): Promise<void>; // taskkill /PID <pid> /T /F; ignore "not found"
export function isAlive(pid: number): boolean;
// runner.ts
export interface RunOutcome { status: 'done' | 'failed' | 'timeout' | 'interrupted'; exitCode: number | null; finalMessage: string | null; errorCategory: ErrorCategory | null; sessionId: string | null; inputTokens: number | null; outputTokens: number | null; costUsd: number | null; checkPassed: boolean | null }
export function runAttempt(o: {
  adapter: AgentAdapter; bin: string; extraArgs: string[]; brief: string; briefFile: string; cwd: string;
  timeouts: { totalMs: number; idleMs: number }; checkCmd: string | null;
  onEvent: (e: FleetEvent) => void; onSpawn: (pid: number) => void; signal: AbortSignal;
}): Promise<RunOutcome>;
```
Behavior: writes brief to `briefFile` (UTF-8) before spawn; spawns with `shell:false`, `windowsHide:true`, stdin = `spec.stdin` (UTF-8) then closed; splits stdout/stderr by line (handle `\r\n` and chunks splitting multi-byte chars — use `setEncoding('utf8')`); every parsed event → `onEvent`; emits `{kind:'status',status:'running'}` at start. Idle timer resets on any output line. Abort or timeout → `killTree`, status `interrupted` / `timeout`. Exit 0 → `done`, else `failed` with `errorCategory` = last error event's category or `'agent'`. Usage events summed. If `done` and `checkCmd`: run via `cmd.exe /d /s /c <checkCmd>` in cwd, emit `{kind:'check',...}` with output truncated to 20 000 chars, set `checkPassed`.

- [ ] **Step 1: Tests** (using fake adapter, temp dir as cwd): `success` → `done`, `fake.txt` exists, finalMessage contains brief; `brief survives unicode and quotes` — brief `Sửa "lỗi" ở 'đây'\nDòng 2 — ✓` echoed back exactly; `fail` → `failed`, exitCode 3, category `agent`; `quota` → `failed`, category `quota`; `hang` with idleMs 500 → `timeout` within 2 s; `timeout kills child processes` — `spawn-child-hang` with totalMs 1000 → `timeout`, and pid in `child.pid` is not alive 1 s later; abort signal → `interrupted`; checkCmd `exit 0` → `checkPassed true`, `exit 1` → false and run still `done`; `slow` emits ≥ 4 message events in order.
- [ ] **Steps 2–5:** fail → implement → pass → commit `feat: agent runner with timeouts and checks`.

### Task 8: Task service (lifecycle, scheduler, wait, recovery)

**Files:**
- Create: `server/bus.ts`, `server/service.ts`, `test/server/service.test.ts`

**Interfaces:**
- Consumes: Store (4), worktree (5), adapters (6), runAttempt/killTree/isAlive (7), loadConfig (3).
- Produces:
```ts
// bus.ts
export type BusMsg = { type: 'event'; taskId: string; stored: StoredEvent } | { type: 'task'; task: Task } | { type: 'run'; run: Run } | { type: 'plan'; plan: Plan };
export class Bus { on(fn: (m: BusMsg) => void): () => void; emit(m: BusMsg): void }
// service.ts
export class FleetError extends Error { constructor(public code: 'not_found' | 'bad_request' | 'agent_unavailable' | 'conflict' | 'invalid_state', msg: string) }
export class TaskService {
  constructor(o: { store: Store; bus: Bus; config: FleetConfig; adapters?: (id: AgentId) => AgentAdapter });
  createPlan(i: { name: string; repoPath: string; baseBranch?: string }): Promise<Plan>; // baseBranch default = currentBranch(repo); rejects non-git path (bad_request)
  run(i: { planId: string; agent: AgentId; title: string; brief: string; checkCmd?: string }): Promise<Task>; // detect() fails → agent_unavailable; creates worktree, task, run(queued); schedules
  retry(taskId: string, i: { agent?: AgentId; note: string }): Promise<Run>; // only from done/failed/timeout/interrupted; brief = original + "\n\n## Ghi chú lần thử <n>\n" + note
  stop(taskId: string): Promise<void>;           // running → interrupted; queued → interrupted without spawning
  takeOver(taskId: string): Promise<void>;       // stops a running run, sets run+task 'taken_over'
  markDone(taskId: string): Promise<void>;       // taken_over → done
  merge(taskId: string): Promise<MergeResult>;   // commitAll + mergeBranch; ok → removeWorktree(deleteBranch true), task 'merged'
  discard(taskId: string): Promise<void>;        // stop if running, removeWorktree(deleteBranch true), task 'discarded'
  wait(ids: string[], timeoutMs: number): Promise<TaskResult[]>; // resolves when no id is queued/running; on timeout returns current state
  result(taskId: string): Promise<TaskResult>;   // files from diffWorktree (empty after merge/discard)
  recover(): void;                               // runs 'running' with dead/null pid → 'interrupted'; 'queued' → rescheduled
}
```
Scheduler: FIFO queue; start a queued run when running count for its agent < `maxParallel` and total < `maxParallelTotal`. Task status mirrors its latest run's status except when terminal `merged`/`discarded`. Every store mutation emits the matching bus message; every runner event is stored via `appendEvent` and emitted.

- [ ] **Step 1: Tests** (fake adapter, temp repo, `FLEET_DATA_DIR` temp): run → wait → task `done`, result.files contains `fake.txt`; retry with note → run attempt 2, its brief ends with the note under `## Ghi chú lần thử 2`; config `maxParallel` 1 → second fake `slow` task stays `queued` until the first finishes; stop running `hang` → `interrupted`; takeOver then markDone → `done`; merge → `merged`, `fake.txt` on main, worktree dir gone; merge with repo dirty → returns `dirty`, task still `done`; discard → `discarded`, branch deleted; `recover marks orphaned runs interrupted` — insert a run `running` with pid 999999 directly in the store, new service `recover()` → `interrupted`; wait with 300 ms timeout on `hang` returns task still `running`; run on unavailable agent (`bin:null`) → `FleetError('agent_unavailable')` and no worktree created.
- [ ] **Steps 2–5:** fail → implement → pass → commit `feat: task service`.

### Task 9: HTTP + WebSocket API and server entry

**Files:**
- Create: `server/api.ts`, `server/main.ts`, `test/server/api.test.ts`

**Interfaces:**
- Consumes: TaskService, Bus, Store, stats (Task 12 adds the route body; register `/api/stats` here returning `[]` until then), PtyManager (Task 15 adds `/ws/pty`).
- Produces: `buildServer(o: { service; store; bus; token: string; webDist?: string }): FastifyInstance`; `main.ts` = loadConfig + token + Store + recover + listen `127.0.0.1:<port>`, writes `server.pid`.
Routes (JSON; FleetError code → 404/400/409/409/409):
```
GET  /api/health                      (no auth) {ok:true}
POST /api/plans {name,repoPath,baseBranch?}     GET /api/plans
POST /api/tasks {planId,agent,title,brief,checkCmd?}
GET  /api/tasks?planId&status         GET /api/tasks/:id → TaskResult
GET  /api/tasks/:id/runs              GET /api/runs/:id/events?afterSeq&tail
GET  /api/tasks/:id/diff → {files,patch}
POST /api/tasks/:id/{retry|stop|takeover|done|merge|discard}
POST /api/wait {ids,timeoutMs} → TaskResult[]
GET  /api/agents → [{id, ok, version?, reason?, maxParallel}]
GET  /api/stats?repo&sinceDays
GET  /auth?token=…  → sets HttpOnly cookie fleet_token, 302 to /
WS   /ws  → server pushes BusMsg JSON
static web/dist at /
```
- [ ] **Step 1: Tests** (`fastify.inject` + a real WS client on an ephemeral port): no token → 401 on `/api/plans`, 200 on `/api/health`; header token → 200; `/auth?token=` sets cookie and cookie works; full flow via HTTP with fake agent: create plan, create task, `/api/wait` → `done`, `/diff` lists `fake.txt`, merge → `merged`; unknown task → 404; WS client receives at least one `event` and one `task` message during the flow; WS without token rejected.
- [ ] **Steps 2–5:** fail → implement → pass → commit `feat: http and websocket api`.

### Task 10: `fleet` CLI

**Files:**
- Create: `cli/client.ts`, `cli/fleet.ts`, `cli/fleet-bin.cjs`, `test/cli/fleet.test.ts`

**Interfaces:**
- Consumes: API routes (Task 9), `files.token()`, `loadConfig().port`.
- Produces: commands exactly as spec §5. `client.ts`: `ensureServer(): Promise<string /*baseUrl*/>` — GET `/api/health`; if down, spawn `tsx server/main.ts` detached + `windowsHide`, poll health up to 10 s. Human output: one line per task `t-7k2f  done  codex  T3 Toolbar  (check ✓, 4m12s)`; `--json` prints raw API JSON. `wait` exits 0 if all tasks `done`, 1 otherwise. `--brief <file>` read as UTF-8. Durations accept `30m`, `90s`, `2h`. `fleet ui` opens `http://127.0.0.1:<port>/auth?token=…` via `start ""`.
- [ ] **Step 1: Tests** (spawn the CLI with `FLEET_DATA_DIR` temp and a free port in config; failing task uses `--brief-text "[[fail]]"`): `plan create --json` returns id; `run --agent fake --brief-text hi --json` returns task id; `wait <id> --json` returns status `done`, exit code 0; `diff <id> --stat` prints `fake.txt`; `merge <id>` prints merged; `wait` on a `fail` task exits 1; `list` shows the task line.
- [ ] **Steps 2–5:** fail → implement → pass → commit `feat: fleet cli`.

### Task 11: Real adapters (codex, qodercli, agy, opencode)

**Files:**
- Create: `server/adapters/{codex,qodercli,agy,opencode}.ts`, `test/server/adapters.test.ts`
- Modify: `server/adapters/index.ts` (register)

**Interfaces:**
- Consumes: fixtures + NOTES.md from Task 2; `AgentAdapter` (Task 6).
- Produces: four adapters. Command lines, brief passing, final-message source, usage fields and resume command come from each agent's `NOTES.md` (not from spec guesses). opencode has no fixture: implement from `opencode run --help` docs, `detect()` returns `{ok:false, reason:'chưa cài'}` when bin is null. agy: if NOTES.md says no stable headless mode, `headlessSupported=false`, and TaskService.run for agy creates the task directly in `taken_over` (add that branch + a service test).
- [ ] **Step 1: Tests:** for each recorded fixture, feeding every line through `createParser()` yields: ≥ 1 `message`; ≥ 1 `file_edit` or `command` mentioning `hello.txt`; zero events lost (every line produces ≥ 1 event, raw allowed); `finalMessage` non-null; usage summed when present; `session` emitted when present. `headless()` output snapshot per adapter (args array) with a brief containing quotes and newlines.
- [ ] **Step 2:** Run, FAIL. **Step 3:** Implement. **Step 4:** Run, PASS.
- [ ] **Step 5: Live check:** `fleet doctor` lists codex/qodercli/agy ok, opencode `chưa cài`. **Step 6:** Commit `feat: real agent adapters`.

### Task 12: Agent comparison stats

**Files:**
- Create: `server/stats.ts`, `test/server/stats.test.ts`
- Modify: `server/api.ts` (`/api/stats`)

**Interfaces:**
- Produces:
```ts
export interface AgentStats { agent: AgentId; runs: number; successRate: number | null; avgDurationMs: number | null; retryRate: number | null; mergeRate: number | null; costUsd: number | null }
export function computeStats(tasks: Task[], runs: Run[], plans: Plan[], f?: { repoPath?: string; sinceMs?: number }): AgentStats[];
```
Definitions: counted runs = finished runs (`done|failed|timeout`) excluding `errorCategory` `quota|auth`; success = `done` and `checkPassed !== false`; retryRate = tasks (first run's agent) having > 1 run / tasks; mergeRate = merged / tasks that reached merged or discarded; cost = sum of non-null costUsd (null if none); rates null when denominator 0. Runs attributed to `run.agent`.
- [ ] **Step 1: Tests** with hand-built arrays: quota failure excluded; check-failed done counts as failure; rates null on empty; repo and since filters.
- [ ] **Steps 2–5:** fail → implement → pass → commit `feat: agent stats`.

### Task 13: Web UI shell with live task list and log

**Files:**
- Create: `web/index.html`, `web/vite.config.ts` (proxy `/api`, `/ws`, `/auth` → `127.0.0.1:4500`), `web/src/{main.tsx,api.ts,ws.ts,store.ts,App.tsx,theme.css}`, `web/src/components/{Sidebar.tsx,TaskHeader.tsx,LogView.tsx}`

**Interfaces:**
- Consumes: API + WS (Task 9), `shared/types.ts`.
- Produces: `useFleet()` store hook (plans, tasks, runs by task, events by run) fed by initial GET + WS `BusMsg`; components per spec §6 and the approved mockup: top bar (tabs `Tasks` / `So sánh agent`, counts "N đang chạy · N chờ · N xong"), sidebar grouped by repo → plan with progress bar and task rows (status icon, title, agent), task header (title, status badge with live elapsed time, agent, `lần thử N`, branch), `LogView` (colored by kind, mono font, `raw` collapsed, autoscroll that pauses when user scrolls up, run selector). Colors via CSS variables with `prefers-color-scheme` dark variant.
- [ ] **Step 1:** Build it. **Step 2:** `npm run build:web` passes typecheck. **Step 3:** Manually: server + `fleet run --agent fake` with `slow` scenario → task appears in sidebar and log lines stream without reload. **Step 4:** Commit `feat(web): task list and live log`.

### Task 14: Web UI diff, brief and actions

**Files:**
- Create: `web/src/components/{DiffView.tsx,BriefView.tsx,TaskActions.tsx,ConfirmDialog.tsx}`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `/api/tasks/:id/diff`, `/runs`, action routes.
- Produces: tabs `Log` / `Diff (n)` / `Brief`; DiffView = file list + unified diff of the selected file (patch split per file, added/removed lines colored); BriefView = original brief + each retry note with attempt number; actions `Dừng` (running), `Đánh dấu xong` (taken_over), `Merge` and `Huỷ` (with ConfirmDialog; merge error reasons shown in Vietnamese: dirty → "Repo gốc còn thay đổi chưa commit", wrong_branch → "Repo gốc không ở nhánh <base>", conflict → "Xung đột: <files>").
- [ ] **Steps:** build → typecheck → manual check with a fake task (diff shows `fake.txt`, merge works, dirty-repo message shows) → commit `feat(web): diff, brief, actions`.

### Task 15: Terminal takeover (PTY)

**Files:**
- Create: `server/pty.ts`, `web/src/components/TerminalPanel.tsx`, `test/server/pty.test.ts`
- Modify: `server/api.ts` (`WS /ws/pty?taskId=…&token=…`), `web/src/components/TaskActions.tsx` (`Mở terminal`)

**Interfaces:**
- Consumes: `service.takeOver`, adapter `interactive()`, node-pty package chosen in Task 1.
- Produces: `class PtyManager { open(taskId: string, cols: number, rows: number): PtySession; get(taskId): PtySession | undefined }` where `PtySession` exposes `onData`, `write`, `resize`, `kill`, `onExit`; one session per task, re-attaching reuses it and replays the last 200 KB of output. WS protocol: client → `{t:'in',d}` / `{t:'resize',cols,rows}`; server → `{t:'out',d}` / `{t:'exit',code}`. Opening a terminal on a running task: UI asks "Dừng agent đang chạy để tiếp quản?" then calls `/takeover` before connecting; on a non-running task it opens without changing status. Command = adapter `interactive({bin, cwd: worktreePath, sessionId: latestRun.sessionId})`; if adapter has no bin, fall back to `cmd.exe` in the worktree.
- [ ] **Step 1: Test:** PtyManager with fallback `cmd.exe` in a temp dir: write `echo fleet-ok\r`, output contains `fleet-ok`; second `open` for same task returns same session; `kill` fires `onExit`.
- [ ] **Steps 2–4:** fail → implement → pass. **Step 5:** Manual: open terminal on a finished fake task, run `dir`, see `fake.txt`. **Step 6:** Commit `feat: terminal takeover`.

### Task 16: Agent comparison page

**Files:**
- Create: `web/src/components/ComparePage.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `/api/stats?repo&sinceDays`, `/api/agents`.
- Produces: table one row per agent (Agent, Số lần chạy, Tỉ lệ thành công, Thời gian TB, Phải làm lại, Được merge, Chi phí), `—` for null, agents not installed shown greyed "chưa cài"; filters repo (from plans) and time (7 / 30 / tất cả ngày); note under table: "Lỗi quota và đăng nhập không tính vào tỉ lệ thất bại."
- [ ] **Steps:** build → typecheck → manual check after a few fake runs → commit `feat(web): agent comparison`.

### Task 17: UI smoke tests, leader guide, acceptance

**Files:**
- Create: `playwright.config.ts`, `test/e2e/ui.spec.ts`, `README.md`, `docs/leader-guide.md`

- [ ] **Step 1: Playwright tests** (server started by `webServer` with temp `FLEET_DATA_DIR`, web built): open `/auth?token=…`; create plan + `slow` fake task via API → task row appears, log gains lines without reload; after done, Diff tab lists `fake.txt`; `Mở terminal` shows xterm and typing `echo hi` + Enter echoes `hi`; Compare tab shows a `fake` row.
- [ ] **Step 2:** Run `npx playwright test`. Expected: PASS.
- [ ] **Step 3: `docs/leader-guide.md`** — the copy-paste block for a leader's CLAUDE.md/AGENTS.md: how to create a plan, write a brief file (goal, files, done criteria, check command), `fleet run … --json`, `fleet wait`, read `fleet result`/`fleet diff`, then `merge` or `retry --note`. README: install (`npm install`, `npm link`), `fleet doctor`, `fleet ui`.
- [ ] **Step 4: Manual acceptance:** on a sandbox repo, one real task each for codex, qodercli, agy via `fleet run`; watch in UI; `fleet wait`; `fleet merge`. Record results (time, pass) in the PR/hand-off notes.
- [ ] **Step 5:** Commit `test: ui smoke tests and leader guide`.
