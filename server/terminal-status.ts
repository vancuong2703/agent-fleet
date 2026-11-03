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

/** Fixed local slash commands, never a user prompt. The private empty directory
 * keeps status inspection separate from the user's running CLI/worktree. */
export async function terminalStatus(agent: DashboardAgent, bin: string, directory: string): Promise<CommandProbeResult> {
  const command = agent === 'codex' ? '/status' : agent === 'qodercli' ? '/usage' : '/help';
  const cwd = path.join(directory, 'status-workspaces', agent);
  mkdirSync(cwd, { recursive: true });
  const label = `${path.basename(bin)} → ${command}${agent === 'agy' ? ' → /usage → /credits' : ''}`;
  return new Promise((resolve) => {
    let terminal: ReturnType<typeof spawn>;
    try { terminal = spawn(bin, [], { cwd, cols: 160, rows: 60, name: 'xterm-256color', env: { ...process.env, PWD: cwd, TERM: 'xterm-256color', COLORTERM: 'truecolor' } }); }
    catch (error) { resolve({ command: label, kind: 'status', ok: false, exitCode: null, stdout: '', stderr: String(error) }); return; }
    const screen = new headless.Terminal({cols:160,rows:60,scrollback:300,allowProposedApi:true});
    const replies = screen.onData(text => { if (!finished) terminal.write(text); });
    const captured: string[] = [];
    let lastScreen = '';
    let raw = '', sent = false, trusted = false, finished = false, creditsSent = false, usageSent = false, usageRead = false, refreshing = false, refreshes = 0;
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
      const complete = agent === 'codex' ? /Weekly\s*limit:/ : agent === 'qodercli' ? /Add-on\s*Credits\s*Used\s*:/ : /Remaining\s*(?:AI\s*)?Credits\s*:/i;
      if (complete.test(text)) later(() => finish(true), 900);
    };
    const data = terminal.onData(chunk => {
      raw = (raw + chunk).slice(-250_000);
      screen.write(chunk, () => { if (!finished) analyse(snapshotTerminal(screen)); });
    });
    const exit = terminal.onExit(({exitCode}) => finish(false, `CLI kết thúc trước khi trả trạng thái (mã ${exitCode}).`));
    later(() => finish(false, 'Hết thời gian chờ lệnh trạng thái; chỉ hiển thị dữ liệu đã đọc được.'), agent === 'agy' ? 20_000 : 15_000);
  });
}
