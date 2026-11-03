import { execFile } from 'node:child_process';
import path from 'node:path';
import type { RepositoryValidation } from '../shared/repository.js';

const TIMEOUT_MS = 3_000;
interface GitExecutionOptions {
  timeout: number;
  shell: false;
  windowsHide: true;
  maxBuffer: number;
  env: Record<string, string>;
}
/** Injectable process boundary keeps timeout/path tests independent of the user's Git. */
export type RepositoryGitExecutor = (file: string, args: readonly string[], options: GitExecutionOptions) => Promise<string>;

const executeGit: RepositoryGitExecutor = (file, args, options) => new Promise((resolve, reject) => {
  execFile(file, [...args], { ...options, env: { ...process.env, ...options.env }, encoding: 'utf8' }, (error, stdout) => {
    if (error) reject(error);
    else resolve(stdout);
  });
});

function invalid(message: string): RepositoryValidation {
  return { valid: false, repoPath: null, branch: null, message };
}

function timedOut(error: unknown): boolean {
  const failure = error as { killed?: boolean; code?: unknown } | null;
  return failure?.killed === true || failure?.code === 'ETIMEDOUT';
}

/** Check Git metadata only. No plan creation, authentication changes or Git writes. */
export async function validateRepository(input: string, options: { execute?: RepositoryGitExecutor } = {}): Promise<RepositoryValidation> {
  if (typeof input !== 'string' || /[\u0000-\u001f\u007f]/.test(input)) {
    return invalid('Nhập đường dẫn tuyệt đối đến thư mục Git.');
  }
  let candidate = input.trim();
  if (candidate.startsWith('"') && candidate.endsWith('"')) candidate = candidate.slice(1, -1).trim();
  // isAbsolute alone also accepts drive-relative roots such as \folder on Windows.
  if (!/^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+(?:[\\/]|$))/.test(candidate)) {
    return invalid('Nhập đường dẫn tuyệt đối đến thư mục Git.');
  }
  const directory = path.win32.normalize(candidate);
  const execute = options.execute ?? executeGit;
  const deadline = Date.now() + TIMEOUT_MS;
  const command = (args: string[]) => execute('git', ['-C', directory, ...args], {
    timeout: Math.max(1, deadline - Date.now()), shell: false, windowsHide: true, maxBuffer: 64 * 1024,
    env: { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' },
  });
  try {
    const output = await command(['rev-parse', '--is-inside-work-tree', '--show-toplevel']);
    const [inside, root] = output.trim().split(/\r?\n/);
    if (inside !== 'true' || !root || !path.win32.isAbsolute(root)) {
      return invalid('Đường dẫn không phải thư mục làm việc Git hoặc không tồn tại.');
    }
    let branch: string | null = null;
    try {
      branch = (await command(['symbolic-ref', '--quiet', '--short', 'HEAD'])).trim() || null;
    } catch (error) {
      // symbolic-ref exits 1 for detached HEAD; the working tree itself is still valid.
      if ((error as { code?: unknown })?.code !== 1) throw error;
    }
    return { valid: true, repoPath: path.win32.normalize(root), branch, message: 'Kho Git hợp lệ.' };
  } catch (error) {
    return invalid(timedOut(error)
      ? 'Kiểm tra Git quá thời gian; hãy thử lại.'
      : 'Đường dẫn không phải thư mục làm việc Git hoặc không tồn tại.');
  }
}
