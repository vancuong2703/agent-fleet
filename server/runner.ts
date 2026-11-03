import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import type { ErrorCategory, FleetEvent } from '../shared/types.js';
import type { AgentAdapter, HeadlessSpec } from './adapters/types.js';
import { configuredModel, withMetadata } from './adapters/metadata.js';
import { killTree } from './process.js';

export interface RunOutcome {
  status: 'done' | 'failed' | 'timeout' | 'interrupted';
  exitCode: number | null;
  finalMessage: string | null;
  errorCategory: ErrorCategory | null;
  sessionId: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  checkPassed: boolean | null;
}

export async function runAttempt(o: {
  adapter: AgentAdapter; bin: string; extraArgs: string[]; brief: string; briefFile: string; cwd: string;
  timeouts: { totalMs: number; idleMs: number }; checkCmd: string | null;
  onEvent: (e: FleetEvent) => void; onSpawn: (pid: number) => void; signal: AbortSignal;
}): Promise<RunOutcome> {
  const outcome: RunOutcome = {
    status: 'failed', exitCode: null, finalMessage: null, errorCategory: null,
    sessionId: null, inputTokens: null, outputTokens: null, costUsd: null, checkPassed: null,
  };
  const events: FleetEvent[] = [];
  const usageIds = new Set<string>();
  let lastErrorCategory: ErrorCategory | null = null;
  let stopped: 'timeout' | 'interrupted' | null = null;
  let active: ChildProcess | null = null;
  let killing: Promise<void> | null = null;
  let systemError: Error | null = null;
  let totalTimer: ReturnType<typeof setTimeout> | undefined;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;

  function clearTimers(): void {
    clearTimeout(totalTimer);
    clearTimeout(idleTimer);
  }

  function terminate(): void {
    if (!active?.pid || killing) return;
    const child = active;
    killing = killTree(child.pid!).catch((error: Error) => {
      systemError = error;
      // Surface denied termination as a system error and close our handles;
      // inherited pipes must not keep the attempt pending indefinitely.
      child.kill();
      child.stdin?.destroy();
      child.stdout?.destroy();
      child.stderr?.destroy();
    });
  }

  function stop(status: 'timeout' | 'interrupted'): void {
    if (stopped) return;
    stopped = status;
    clearTimers();
    terminate();
  }

  function resetIdle(): void {
    clearTimeout(idleTimer);
    if (!stopped && !systemError && active?.exitCode === null && active.signalCode === null) idleTimer = setTimeout(() => stop('timeout'), o.timeouts.idleMs);
  }

  function emit(event: FleetEvent): void {
    events.push(event);
    switch (event.kind) {
      case 'error': lastErrorCategory = event.category ?? 'agent'; break;
      case 'session': outcome.sessionId = event.id; break;
      case 'usage':
        if (event.attributionOnly) break;
        if (event.usageId) {
          const key = `${event.provider ?? ''}/${event.model ?? ''}/${event.usageScope ?? 'delta'}/${event.usageId}`;
          if (usageIds.has(key)) break;
          usageIds.add(key);
        }
        for (const field of ['inputTokens', 'outputTokens', 'costUsd'] as const) {
          const value = event[field];
          if (value !== undefined && Number.isFinite(value) && value >= 0) {
            outcome[field] = event.usageScope === 'cumulative' ? value : (outcome[field] ?? 0) + value;
          }
        }
        break;
    }
    o.onEvent(event);
  }

  function fail(error: Error): void {
    systemError = error;
    clearTimers();
    terminate();
  }

  /** Wait for child exit, then give inherited stdout/stderr at most two seconds to close. */
  async function execute(
    spec: HeadlessSpec,
    onLine: (line: string, stream: 'stdout' | 'stderr') => void,
    onChunk?: (chunk: string) => void,
    reportSpawn = false,
    verbatimArguments = false,
  ): Promise<{ code: number | null; error: Error | null }> {
    let childError: Error | null = null;
    const child = spawn(spec.cmd, spec.args, {
      cwd: path.win32.resolve(o.cwd),
      // Some CLIs (opencode) take PWD over the real cwd; the server's own PWD would point elsewhere.
      env: { ...process.env, ...spec.env, PWD: path.win32.resolve(o.cwd) },
      shell: false,
      windowsHide: true,
      windowsVerbatimArguments: verbatimArguments,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    active = child;
    killing = null;
    resetIdle();

    function readLines(stream: Readable, name: 'stdout' | 'stderr'): () => void {
      let pending = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        try {
          onChunk?.(chunk);
          pending += chunk;
          let end: number;
          while ((end = pending.indexOf('\n')) !== -1) {
            const line = pending.slice(0, end).replace(/\r$/, '');
            pending = pending.slice(end + 1);
            resetIdle();
            onLine(line, name);
          }
        } catch (error) {
          fail(error as Error);
        }
      });
      const flush = () => {
        if (pending.length === 0) return;
        try {
          const line = pending.replace(/\r$/, '');
          pending = '';
          resetIdle();
          onLine(line, name);
        } catch (error) {
          fail(error as Error);
        }
      };
      stream.on('end', flush);
      stream.on('close', flush);
      stream.on('error', fail);
      return flush;
    }

    const closed = new Promise<void>((resolve) => { child.once('close', () => resolve()); });
    const completion = new Promise<number | null>((resolve) => {
      child.once('error', (error) => { childError = error; clearTimeout(idleTimer); resolve(null); });
      child.once('exit', resolve);
    });
    const flushStdout = readLines(child.stdout, 'stdout');
    const flushStderr = readLines(child.stderr, 'stderr');
    child.once('spawn', () => {
      try {
        if (reportSpawn) o.onSpawn(child.pid!);
        if (stopped) terminate();
      } catch (error) {
        fail(error as Error);
      }
    });
    // Some CLIs exit before reading their input. A broken stdin must not
    // become an unhandled stream error (particularly with a long brief).
    child.stdin.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code !== 'EPIPE' && error.code !== 'ERR_STREAM_DESTROYED') fail(error);
    });
    child.stdin.end(spec.stdin ?? '', 'utf8');

    const code = await completion;
    clearTimeout(idleTimer);
    active = null;
    let drainTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([closed, new Promise<void>((resolve) => { drainTimer = setTimeout(resolve, 2_000); })]);
    } finally {
      clearTimeout(drainTimer);
      child.stdout.destroy();
      child.stderr.destroy();
      flushStdout();
      flushStderr();
    }
    await killing;
    return { code: childError ? null : code, error: childError };
  }

  const onAbort = () => stop('interrupted');
  try {
    emit({ kind: 'status', status: 'running' });
    const model = configuredModel(o.extraArgs);
    if (model) emit({ kind: 'model', model, source: 'configured' });
    const briefFile = path.win32.resolve(o.briefFile);
    await mkdir(path.win32.dirname(briefFile), { recursive: true });
    await writeFile(briefFile, o.brief, 'utf8');
    o.signal.addEventListener('abort', onAbort, { once: true });
    if (o.signal.aborted) stop('interrupted');
    if (stopped) return { ...outcome, status: stopped };

    totalTimer = setTimeout(() => stop('timeout'), o.timeouts.totalMs);
    const spec = o.adapter.headless({
      bin: o.bin, extraArgs: o.extraArgs, brief: o.brief, briefFile, cwd: path.win32.resolve(o.cwd),
    });
    if ([spec.cmd, ...spec.args].join(' ').length > 30_000) {
      throw new Error(`Brief quá dài cho dòng lệnh của ${o.adapter.id} (giới hạn ~32k ký tự trên Windows)`);
    }
    const parse = withMetadata(o.adapter.createParser(), o.adapter.id);
    const result = await execute(spec, (line, stream) => {
      for (const event of parse(line, stream)) emit(event);
    }, undefined, true);
    outcome.exitCode = result.code;
    outcome.finalMessage = o.adapter.finalMessage(events);
    if (result.error) systemError = result.error;
    outcome.status = stopped ?? (systemError || result.code !== 0 || lastErrorCategory !== null ? 'failed' : 'done');

    // An independent check is still useful when a zero-exit agent reported a
    // permission error. A passing check must never erase that agent failure.
    if (!stopped && !systemError && result.code === 0 && o.checkCmd !== null) {
      let output = '';
      const check = await execute(
        // cmd /s strips the outer quotes. Pass its command string verbatim:
        // Node's normal argv quoting uses escapes which cmd does not accept.
        { cmd: 'cmd.exe', args: ['/d', '/s', '/c', `"${o.checkCmd}"`] },
        () => {},
        (chunk) => { output += chunk.slice(0, 20_000 - output.length); },
        false,
        true,
      );
      if (check.error) output = (output + check.error.message).slice(0, 20_000);
      outcome.checkPassed = !stopped && !systemError && !check.error && check.code === 0;
      emit({ kind: 'check', cmd: o.checkCmd, passed: outcome.checkPassed, output });
      if (stopped) outcome.status = stopped;
      else if (!outcome.checkPassed) {
        outcome.status = 'failed';
        emit({ kind: 'error', category: check.error || systemError ? 'system' : lastErrorCategory ?? 'check', text: `Check failed: ${o.checkCmd}` });
      }
    }
    if (systemError) emit({ kind: 'error', category: 'system', text: systemError.message });
    if (outcome.status === 'failed') outcome.errorCategory = systemError ? 'system' : lastErrorCategory ?? 'agent';
    return outcome;
  } catch (error) {
    fail(error as Error);
    await killing;
    emit({ kind: 'error', category: 'system', text: (error as Error).message });
    return { ...outcome, status: stopped ?? 'failed', errorCategory: 'system' };
  } finally {
    clearTimers();
    o.signal.removeEventListener('abort', onAbort);
  }
}
