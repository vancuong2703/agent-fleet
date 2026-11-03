import { spawn } from '@lydell/node-pty';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import headless from '@xterm/headless';
import type { DashboardAgent } from '../shared/dashboard.js';
import type { CommandProbeResult } from './dashboard.js';

export function snapshotTerminal(screen: headless.Terminal): string {
  const buffer = screen.buffer.active;
  return Array.from({length:buffer.length},(_,index)=>buffer.getLine(index)?.translateToString(true)??'').join('\n').trim();
}

/** Slash commands each branch walks, in order. The first one is what gets typed. */
const STATUS_COMMANDS: Record<DashboardAgent, string[]> = {
  codex: ['/status'],
  qodercli: ['/usage', '/model'],
  agy: ['/help', '/usage', '/credits'],
  opencode: ['/help'],
};

export function statusProbeCommands(agent: DashboardAgent): string[] {
  return STATUS_COMMANDS[agent];
}

/** `/usage` answered: both credit lines are on screen, so the numbers are final. */
export function isQoderUsageScreen(text: string): boolean {
  return /Plan\s*Credits\s*Used\s*:/.test(text) && /Add-on\s*Credits\s*Used\s*:/.test(text);
}

/** The `/model` picker painted at least one priced row (`<n> Nx Credit`). */
export function isQoderPickerScreen(text: string): boolean {
  return /Default\s*\(\d+\)/.test(text) && /\d+(?:\.\d+)?x\s*Credit/.test(text);
}

/** Groups the picker exposes: the one it opens on, plus two Tab hops (Default · New · Custom). */
const QODER_PICKER_GROUPS = 3;
/** Hard cap on Tab hops so a picker that keeps repainting still terminates. */
const QODER_PICKER_MAX_HOPS = 6;

export type QoderGroupSight =
  | { kind: 'retry'; record: false; stop: false }
  | { kind: 'priced'; record: boolean; stop: boolean }
  | { kind: 'empty'; record: false; stop: boolean };

/**
 * Deterministic controller for walking the `/model` picker's Tab groups. Feed it one
 * snapshot per repaint via `observe`; it decides whether the group is priced/empty, whether
 * the snapshot is new (so a priced group is captured exactly once), and when traversal stops.
 *
 * The bug this replaces: an empty group (`No models in this group`, e.g. `Custom (0)`) used to
 * end the whole walk, so with Tab order Default → New → Custom opening on New the collector
 * stopped at Custom and never reached Default's prices, and opening on Custom captured nothing.
 * An empty group is now just one visited group; traversal keeps hopping until every group has
 * been seen (`groups`) or the hop budget is spent (`maxHops`) — a full bounded cycle.
 */
export function createQoderPickerWalk(options: { groups?: number; maxHops?: number } = {}) {
  const groups = Math.max(1, options.groups ?? QODER_PICKER_GROUPS);
  const maxHops = Math.max(1, options.maxHops ?? QODER_PICKER_MAX_HOPS);
  const seen = new Set<string>();
  const screens: string[] = [];
  let hops = 0;
  return {
    /** Distinct priced group screens, in the order first seen. */
    screens,
    get groupsVisited() { return seen.size; },
    observe(view: string): QoderGroupSight {
      const priced = isQoderPickerScreen(view);
      const empty = !priced && /No\s*models\s*in\s*this\s*group/i.test(view);
      // Neither priced nor empty: the screen has not painted a group yet — sample again.
      if (!priced && !empty) return { kind: 'retry', record: false, stop: false };
      const first = !seen.has(view);
      if (first) seen.add(view);
      const record = priced && first;
      if (record) screens.push(view);
      hops++;
      const stop = seen.size >= groups || hops >= maxHops;
      return priced ? { kind: 'priced', record, stop } : { kind: 'empty', record: false, stop };
    },
  };
}

/**
 * Drives a picker walk to completion from a `read`/`tab` pair and returns the captured priced
 * screens. The production PTY supplies these through timers; tests supply a scripted sequence,
 * which is why the traversal policy lives here rather than inline. Always terminates: it stops
 * on the walk's `stop`, and a bounded guard covers a `read` that never settles into a group.
 */
export function collectQoderPickerScreens(
  read: () => string,
  tab: () => void,
  options: { groups?: number; maxHops?: number; maxSettles?: number } = {},
): string[] {
  const maxSettles = options.maxSettles ?? 3;
  const walk = createQoderPickerWalk(options);
  for (let guard = 0, settles = 0; guard <= QODER_PICKER_MAX_HOPS * (maxSettles + 1); guard++) {
    const sight = walk.observe(read());
    if (sight.stop) break;
    if (sight.kind === 'retry') { if (++settles < maxSettles) continue; settles = 0; }
    else settles = 0;
    tab();
  }
  return walk.screens;
}

/** Fixed local slash commands, never a user prompt. The private empty directory
 * keeps status inspection separate from the user's running CLI/worktree. */
export async function terminalStatus(agent: DashboardAgent, bin: string, directory: string): Promise<CommandProbeResult> {
  const commands = STATUS_COMMANDS[agent];
  const command = commands[0]!;
  const cwd = path.join(directory, 'status-workspaces', agent);
  mkdirSync(cwd, { recursive: true });
  const label = `${path.basename(bin)} → ${commands.join(' → ')}`;
  return new Promise((resolve) => {
    let terminal: ReturnType<typeof spawn>;
    try { terminal = spawn(bin, [], { cwd, cols: 160, rows: 60, name: 'xterm-256color', env: { ...process.env, PWD: cwd, TERM: 'xterm-256color', COLORTERM: 'truecolor' } }); }
    catch (error) { resolve({ command: label, kind: 'status', ok: false, exitCode: null, stdout: '', stderr: String(error) }); return; }
    const screen = new headless.Terminal({cols:160,rows:60,scrollback:300,allowProposedApi:true});
    const replies = screen.onData(text => { if (!finished) terminal.write(text); });
    const captured: string[] = [];
    let lastScreen = '';
    let raw = '', sent = false, trusted = false, finished = false, creditsSent = false, usageSent = false, usageRead = false, refreshing = false, refreshes = 0;
    let modelSent = false;
    const walk = createQoderPickerWalk();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const later = (callback: () => void, ms: number) => { const timer = setTimeout(() => { timers.delete(timer); if (!finished) callback(); }, ms); timers.add(timer); };
    const finish = (ok: boolean, reason = '') => {
      if (finished) return;
      finished = true;
      for (const timer of timers) clearTimeout(timer);
      data.dispose(); exit.dispose();
      replies.dispose(); screen.dispose();
      try { terminal.kill(); } catch { /* already exited */ }
      resolve({ command: label, kind: 'status', ok, exitCode: ok ? 0 : null, stdout: [...captured,lastScreen || stripVTControlCharacters(raw)].join('\n\n'), stderr: reason });
    };
    const send = () => {
      if (sent) return; sent = true;
      // Allow the TUI to finish initialising its input handler; separate typing
      // from Enter so a burst cannot be treated as pasted-but-unsubmitted text.
      later(() => { terminal.write(command); later(() => terminal.write('\r'), 250); }, agent === 'codex' ? 3000 : 700);
    };
    /**
     * The picker repaints on key events only, so sample the rebuilt screen instead of
     * waiting for output: /usage never shows a per-model rate, /model always does.
     * `walk` treats each priced or empty group as one visited group; an empty Custom never
     * stops the sweep, so Default's prices are collected even when the picker opens on New/Custom.
     */
    const pickGroups = (settled = 0) => {
      if (finished) return;
      const view = snapshotTerminal(screen);
      const sight = walk.observe(view);
      if (sight.record) captured.push(view);
      if (sight.stop) { finish(true); return; }
      // A transitional screen (group still painting) gets bounded retries, then hops like the
      // old code so a slow group is not mistaken for the end; the /usage capture already stands alone.
      if (sight.kind === 'retry' && settled < 3) { later(() => pickGroups(settled + 1), 700); return; }
      terminal.write('\t');
      later(() => pickGroups(), 1_300);
    };
    const analyse = (text: string) => {
      lastScreen = text;
      // Trust only this server-created empty status directory, never a repo.
      if (!trusted && /Do\s*you\s*trust|trust\s*(?:the\s*files|this\s*folder|this\s*directory)/i.test(text)) {
        trusted = true; later(() => terminal.write('\r'), 250); return;
      }
      const ready = agent === 'codex' ? /Ask\s*Codex|for\s*shortcuts/ : agent === 'qodercli' ? /Type\s*your\s*message/ : /\?\s*for\s*shortcuts/;
      if (!sent && ready.test(text) && !/Do you trust[^]*$/.test(text.slice(-500))) send();
      if (!sent) return;
      if (agent === 'codex' && /refresh\s*requested|data\s*not\s*available\s*yet/i.test(text) && !refreshing && refreshes < 2) {
        refreshing = true; refreshes++;
        later(() => { terminal.write('/status'); later(() => { terminal.write('\r'); later(() => { refreshing = false; }, 1000); }, 250); }, 1700);
      }
      if (agent === 'agy' && !usageSent && /Quick\s*Reference|Project\s*Config:/.test(text)) {
        usageSent = true;
        captured.push(text);
        later(() => { terminal.write('\x1b'); later(() => { terminal.write('/usage'); later(() => terminal.write('\r'), 250); }, 250); }, 300);
        return;
      }
      if (agent === 'agy' && usageSent && !usageRead && /Models\s*&\s*Quota/.test(text) && /(?:Weekly|Five\s*Hour)\s*Limit\s*Remaining/.test(text)) {
        usageRead = true;
        captured.push(text);
        // The CLI uses a pager on short terminals; collect the end too.
        later(() => { terminal.write('\x1b[6~'); later(() => {
          captured.push(snapshotTerminal(screen));
          creditsSent = true; terminal.write('\x1b');
          later(() => { terminal.write('/credits'); later(() => terminal.write('\r'), 250); }, 250);
        }, 500); }, 400);
        return;
      }
      // qodercli: /usage carries the credits, /model carries the per-model rates, so walk both.
      if (agent === 'qodercli' && sent && !modelSent && isQoderUsageScreen(text)) {
        modelSent = true;
        captured.push(text);
        later(() => { terminal.write('\x1b'); later(() => { terminal.write('/model'); later(() => { terminal.write('\r'); later(pickGroups, 1_500); }, 250); }, 250); }, 300);
        return;
      }
      const complete = agent === 'codex' ? /Weekly\s*limit:/ : agent === 'qodercli' ? null : /Remaining\s*(?:AI\s*)?Credits\s*:/i;
      if (complete?.test(text)) later(() => finish(true), 900);
    };
    const data = terminal.onData(chunk => {
      raw = (raw + chunk).slice(-250_000);
      screen.write(chunk, () => { if (!finished) analyse(snapshotTerminal(screen)); });
    });
    const exit = terminal.onExit(({exitCode}) => finish(false, `CLI kết thúc trước khi trả trạng thái (mã ${exitCode}).`));
    later(() => {
      // The usage block alone is still worth reporting; a picker that never painted is not an error.
      if (agent === 'qodercli' && captured.length > 0) { finish(true); return; }
      finish(false, 'Hết thời gian chờ lệnh trạng thái; chỉ hiển thị dữ liệu đã đọc được.');
    }, agent === 'agy' ? 20_000 : 15_000);
  });
}
