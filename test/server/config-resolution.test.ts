import path from 'node:path';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, test, vi } from 'vitest';
import { detectBin } from '../../server/config.js';

vi.mock('node:fs', async () => ({ ...await vi.importActual<typeof import('node:fs')>('node:fs'), existsSync: vi.fn() }));
vi.mock('node:child_process', async () => ({ ...await vi.importActual<typeof import('node:child_process')>('node:child_process'), spawnSync: vi.fn() }));
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });

test('resolves the OpenCode desktop executable when opencode is absent from PATH', () => {
  vi.stubEnv('LOCALAPPDATA', 'C:\\Agent Data');
  const desktop = path.win32.join('C:\\Agent Data', 'Programs', 'ai.opencode.desktop', 'resources', 'opencode-cli.exe');
  vi.mocked(spawnSync).mockReturnValue({ status: 1 } as ReturnType<typeof spawnSync>);
  vi.mocked(existsSync).mockImplementation(candidate => candidate === desktop);
  expect(detectBin('opencode')).toBe(desktop);
  expect(spawnSync).toHaveBeenCalledWith('where.exe', ['opencode'], expect.objectContaining({ shell: false, windowsHide: true }));
});

test('prefers an existing PATH executable before the desktop fallback', () => {
  vi.mocked(spawnSync).mockReturnValue({ status: 0, stdout: 'C:\\Tools\\opencode.exe\r\n' } as ReturnType<typeof spawnSync>);
  vi.mocked(existsSync).mockImplementation(candidate => candidate === 'C:\\Tools\\opencode.exe');
  expect(detectBin('opencode')).toBe('C:\\Tools\\opencode.exe');
});
