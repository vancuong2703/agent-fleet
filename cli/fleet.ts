import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Command, InvalidArgumentError, Option } from 'commander';
import type { CommandPolicy, DiffFile, Plan, Run, StoredEvent, Task, TaskResult } from '../shared/types.js';
import { runDiagnostic, successfulResult } from '../shared/run-diagnostics.js';
import type { MergeResult } from '../server/worktree.js';
import { files } from '../server/paths.js';
import { ApiError, apiRequest, ensureServer, stopServer } from './client.js';

const program = new Command().name('fleet').description('Dispatch and manage local coding agents')
  .option('--json', 'Print the API JSON');
const jsonMode = () => Boolean(program.opts().json);
const output = (value: unknown, human: () => void) => {
  if (jsonMode()) console.log(JSON.stringify(value, null, 2));
  else human();
};
const taskRoute = (id: string) => `/api/tasks/${encodeURIComponent(id)}`;

function duration(value: string): number {
  const match = /^(\d+(?:\.\d+)?)(s|m|h)$/.exec(value);
  const ms = match ? Number(match[1]) * ({ s: 1000, m: 60_000, h: 3_600_000 }[match[2]!] ?? 0) : NaN;
  if (!Number.isFinite(ms) || ms < 0 || ms > 2_147_483_647) {
    throw new InvalidArgumentError('Use a duration such as 30m, 90s or 2h (at most 2147483647 ms).');
  }
  return Math.round(ms);
}

function integer(value: string): number {
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new InvalidArgumentError('Expected a nonnegative integer.');
  }
  return Number(value);
}

function elapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds % 3600 / 60);
  return `${hours ? `${hours}h` : ''}${hours || minutes ? `${minutes}m` : ''}${seconds % 60}s`;
}

function taskLine(task: Task, run: Run | null): string {
  const details: string[] = [];
  if (run?.checkPassed != null) details.push(`check ${run.checkPassed ? '✓' : '✗'}`);
  if (run?.errorCategory) details.push(`error ${run.errorCategory}`);
  if (run?.durationMs != null) details.push(elapsed(run.durationMs));
  return `${task.id}  ${task.status}  ${task.agent}  ${task.title}${details.length ? `  (${details.join(', ')})` : ''}`;
}

function printFiles(files: DiffFile[]): void {
  for (const file of files) console.log(`${file.path}  +${file.added} -${file.removed}`);
}

function printResult(result: TaskResult): void {
  console.log(taskLine(result.task, result.run));
  if (result.run?.finalMessage) console.log(result.run.finalMessage);
  const diagnostic = runDiagnostic(result.run);
  if (diagnostic) console.log(`${diagnostic}\nfleet log ${result.task.id}`);
  printFiles(result.files);
}

function printEvents(events: StoredEvent[]): void {
  for (const { event } of events) {
    switch (event.kind) {
      case 'message': case 'error': case 'raw': console.log(event.text); break;
      case 'command': console.log(`$ ${event.cmd}${event.output ? `\n${event.output}` : ''}`); break;
      case 'file_edit': console.log(event.path); break;
      case 'status': console.log(event.status + (event.note ? `  ${event.note}` : '')); break;
      case 'check': console.log(`check ${event.passed ? '✓' : '✗'}: ${event.cmd}\n${event.output}`); break;
      case 'tool': console.log(`${event.name}${event.detail ? `  ${event.detail}` : ''}`); break;
      case 'session': console.log(`session ${event.id}`); break;
      case 'usage': console.log(JSON.stringify(event)); break;
      case 'model': console.log(`model ${event.model}${event.provider ? ` (${event.provider})` : ''}`); break;
    }
  }
}

const plan = program.command('plan').description('Manage plans');
plan.command('create <name>').requiredOption('--repo <path>').option('--base <branch>')
  .action(async (name: string, opts: { repo: string; base?: string }) => {
    const baseUrl = await ensureServer();
    const created = await apiRequest<Plan>(baseUrl, '/api/plans', {
      name, repoPath: path.win32.resolve(opts.repo), baseBranch: opts.base,
    });
    output(created, () => console.log(created.id));
  });
plan.command('list').action(async () => {
  const plans = await apiRequest<Plan[]>(await ensureServer(), '/api/plans');
  output(plans, () => { for (const p of plans) console.log(`${p.id}  ${p.name}  ${p.repoPath}  ${p.baseBranch}`); });
});

program.command('run').requiredOption('--plan <id>').requiredOption('--agent <agent>')
  .requiredOption('--title <title>')
  .addOption(new Option('--brief <file>').conflicts('briefText'))
  .addOption(new Option('--brief-text <text>').conflicts('brief'))
  .option('--check <cmd>')
  .addOption(new Option('--command-policy <policy>', 'AGY command approval for this run').choices(['ask', 'check-only', 'auto']))
  .option('--allow-command <command>', 'Explicit command to allow for check-only policy (repeatable)', (value: string, previous: string[] = []) => [...previous, value])
  .action(async (opts: { plan: string; agent: string; title: string; brief?: string; briefText?: string; check?: string; commandPolicy?: CommandPolicy; allowCommand?: string[] }) => {
    if (opts.brief === undefined && opts.briefText === undefined) throw new Error('Provide --brief <file> or --brief-text <text>');
    const brief = opts.brief === undefined ? opts.briefText! : await readFile(path.win32.resolve(opts.brief), 'utf8');
    const task = await apiRequest<Task>(await ensureServer(), '/api/tasks', {
      planId: opts.plan, agent: opts.agent, title: opts.title, brief, checkCmd: opts.check, commandPolicy: opts.commandPolicy, allowedCommands: opts.allowCommand,
    });
    output(task, () => console.log(task.id));
  });

program.command('wait <ids...>').option('--timeout <duration>', 'Maximum wait', duration, 30 * 60_000)
  .action(async (ids: string[], opts: { timeout: number }) => {
    const results = await apiRequest<TaskResult[]>(await ensureServer(), '/api/wait', { ids, timeoutMs: opts.timeout });
    output(results, () => { for (const result of results) printResult(result); });
    if (results.some((result) => !successfulResult(result))) process.exitCode = 1;
  });

program.command('result <id>').action(async (id: string) => {
  const result = await apiRequest<TaskResult>(await ensureServer(), taskRoute(id));
  output(result, () => printResult(result));
});

program.command('log <id>').option('--tail <count>', 'Last events', integer, 50).option('--follow', 'Follow the latest run until it finishes')
  .action(async (id: string, opts: { tail: number; follow?: boolean }) => {
    const baseUrl = await ensureServer();
    const runsRoute = `${taskRoute(id)}/runs`;
    let run = (await apiRequest<Run[]>(baseUrl, runsRoute)).at(-1);
    if (!run) { output([], () => {}); return; }
    const runId = run.id;
    const route = `/api/runs/${encodeURIComponent(runId)}/events`;
    // tail=0 must still establish the cursor so follow never replays older events.
    const initial = await apiRequest<StoredEvent[]>(baseUrl, `${route}?tail=${Math.max(1, opts.tail)}`);
    let afterSeq = initial.at(-1)?.seq ?? 0;
    const events = opts.tail === 0 ? [] : initial.slice(-opts.tail);
    output(events, () => printEvents(events));
    while (opts.follow && (run?.status === 'queued' || run?.status === 'running')) {
      await delay(200);
      // Read status first, then drain events, including the final status event.
      run = (await apiRequest<Run[]>(baseUrl, runsRoute)).find((attempt) => attempt.id === runId);
      const next = await apiRequest<StoredEvent[]>(baseUrl, `${route}?afterSeq=${afterSeq}`);
      if (next.length) {
        afterSeq = next.at(-1)!.seq;
        output(next, () => printEvents(next));
      }
    }
  });

program.command('diff <id>').option('--stat').action(async (id: string, opts: { stat?: boolean }) => {
  const diff = await apiRequest<{ files: DiffFile[]; patch: string }>(await ensureServer(), `${taskRoute(id)}/diff`);
  output(diff, () => { if (opts.stat) printFiles(diff.files); else process.stdout.write(diff.patch); });
});

program.command('retry <id>').option('--agent <agent>').requiredOption('--note <text>')
  .addOption(new Option('--command-policy <policy>', 'AGY command approval for this run').choices(['ask', 'check-only', 'auto']))
  .option('--allow-command <command>', 'Explicit command to allow (repeatable)', (value: string, previous: string[] = []) => [...previous, value])
  .action(async (id: string, opts: { agent?: string; note: string; commandPolicy?: CommandPolicy; allowCommand?: string[] }) => {
    const run = await apiRequest<Run>(await ensureServer(), `${taskRoute(id)}/retry`, { agent: opts.agent, note: opts.note, commandPolicy: opts.commandPolicy, allowedCommands: opts.allowCommand });
    output(run, () => console.log(`${id}  ${run.status}  ${run.agent}  attempt ${run.attempt}  ${run.id}`));
  });

for (const [action, status] of [['stop', 'interrupted'], ['discard', 'discarded']] as const) {
  program.command(`${action} <id>`).action(async (id: string) => {
    const response = await apiRequest<null>(await ensureServer(), `${taskRoute(id)}/${action}`, {});
    output(response, () => console.log(`${id}  ${status}`));
  });
}

program.command('merge <id>').action(async (id: string) => {
  const result = await apiRequest<MergeResult>(await ensureServer(), `${taskRoute(id)}/merge`, {});
  output(result, () => console.log(result.ok ? `${id}  merged` : `${id}  merge refused: ${result.reason}${result.files?.length ? `  ${result.files.join(', ')}` : ''}`));
  if (!result.ok) process.exitCode = 1;
});

program.command('list').option('--plan <id>').option('--status <status>')
  .action(async (opts: { plan?: string; status?: string }) => {
    const query = new URLSearchParams();
    if (opts.plan !== undefined) query.set('planId', opts.plan);
    if (opts.status !== undefined) query.set('status', opts.status);
    const baseUrl = await ensureServer();
    const tasks = await apiRequest<Task[]>(baseUrl, `/api/tasks?${query}`);
    if (jsonMode()) { output(tasks, () => {}); return; }
    const runs = await Promise.all(tasks.map((task) => apiRequest<Run[]>(baseUrl, `${taskRoute(task.id)}/runs`)));
    for (const [index, task] of tasks.entries()) console.log(taskLine(task, runs[index]!.at(-1) ?? null));
  });

program.command('doctor').action(async () => {
  const agents = await apiRequest<Array<{ id: string; ok: boolean; version?: string; reason?: string; maxParallel: number }>>(await ensureServer(), '/api/agents');
  output(agents, () => {
    for (const agent of agents) console.log(`${agent.id}  ${agent.ok ? 'ok' : 'unavailable'}  ${agent.version ?? agent.reason ?? ''}  maxParallel ${agent.maxParallel}`);
  });
});

program.command('ui').action(async () => {
  const baseUrl = await ensureServer();
  const token = (await readFile(files.token(), 'utf8')).trim();
  const url = `${baseUrl}/auth?token=${encodeURIComponent(token)}`;
  await new Promise<void>((resolve, reject) => {
    const child = spawn('cmd.exe', ['/c', 'start', '', url], { shell: false, windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(`Could not open browser (${code})`)));
  });
  output({ url }, () => console.log(url));
});

const server = program.command('server').description('Run the server in the foreground').action(async () => {
  await import('../server/main.js');
});
server.command('stop').description('Stop the running server').action(async () => {
  await stopServer();
  output({ stopped: true }, () => console.log('stopped'));
});

try {
  await program.parseAsync();
} catch (error) {
  if (error instanceof ApiError && jsonMode()) console.log(JSON.stringify(error.body, null, 2));
  else console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
