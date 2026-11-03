import { describe, expect, test } from 'vitest';
import type { Plan } from '../../shared/types.js';
import {
  checkRepoPath,
  cleanRepoPath,
  readComposerPrefs,
  repoValidationFromResponse,
  saveComposerPrefs,
  COMPOSER_PREFS_KEY,
} from '../../web/src/components/TaskComposer.js';
import { tabIndexForKey } from '../../web/src/components/TerminalPage.js';
import {
  clampTerminalFontSize,
  readTerminalFontSize,
  TERMINAL_FONT_KEY,
} from '../../web/src/components/TerminalPanel.js';

function plan(id: string, name: string, repoPath: string): Plan {
  return { id, name, slug: id, repoPath, baseBranch: 'main', createdAt: 0 };
}

/** Minimal `Storage` stub; `fail` mimics a browser that blocks localStorage (private mode, sandbox). */
function storage(options: { value?: string | null; failGet?: boolean; failSet?: boolean } = {}): Storage {
  const value = options.value ?? null;
  return {
    length: value === null ? 0 : 1,
    clear: () => undefined,
    key: () => null,
    getItem: () => {
      if (options.failGet) throw new Error('SecurityError: localStorage is disabled');
      return value;
    },
    setItem: () => {
      if (options.failSet) throw new Error('QuotaExceededError');
    },
    removeItem: () => undefined,
  } as Storage;
}

const plans = [
  plan('p-one', 'Agent Fleet', 'C:\\Projects\\Agent Fleet'),
  plan('p-two', 'Other app', 'D:\\Work\\other-app'),
];

describe('checkRepoPath', () => {
  test('stays quiet while the field is empty', () => {
    expect(checkRepoPath('   ', plans).status).toBe('idle');
  });

  test('rejects a relative path', () => {
    const result = checkRepoPath('Projects/my-app', plans);
    expect(result.status).toBe('error');
    expect(result.message).toContain('tuyệt đối');
  });

  test('rejects a POSIX-only path on Windows', () => {
    expect(checkRepoPath('/usr/local/src/app', plans).status).toBe('error');
  });

  test('matches an existing plan but never claims the repo is verified Git', () => {
    const result = checkRepoPath('c:/projects/agent fleet/', plans);
    expect(result.status).toBe('ok');
    expect(result.message).toContain('Agent Fleet');
    expect(result.message).toContain('kiểm tra Git');
  });

  test('strips the quotes Explorer copies around a path', () => {
    expect(checkRepoPath('"D:\\Work\\other-app"', plans).status).toBe('ok');
  });

  test('marks an absolute path with no plan as unconfirmed, never as a hard failure', () => {
    const result = checkRepoPath('E:\\Not\\used\\yet', plans);
    expect(result.status).toBe('unknown');
    expect(result.message).toContain('kiểm tra Git');
  });

  test('accepts a UNC share', () => {
    expect(checkRepoPath('\\\\server\\share\\repo', plans).status).toBe('unknown');
  });
});

describe('repoValidationFromResponse', () => {
  test('keeps only the canonical Git root for a valid repository', () => {
    const result = repoValidationFromResponse(
      { valid: true, repoPath: 'C:\\canonical\\root', branch: 'main', message: 'Kho Git hợp lệ.' },
      'C:\\typed\\path',
    );
    expect(result).toEqual({ status: 'valid', message: 'Git repo hợp lệ · nhánh main.', root: 'C:\\canonical\\root', input: 'C:\\typed\\path' });
  });

  test('reports a non-repository path as invalid without a canonical root', () => {
    const result = repoValidationFromResponse(
      { valid: false, repoPath: null, branch: null, message: 'Đường dẫn không phải thư mục làm việc Git hoặc không tồn tại.' },
      'C:\\missing',
    );
    expect(result.status).toBe('invalid');
    expect(result.root).toBeNull();
    expect(result.message).toContain('Git');
  });

  test('treats the server Git timeout as retryable, never as a verified repository', () => {
    const result = repoValidationFromResponse(
      { valid: false, repoPath: null, branch: null, message: 'Kiểm tra Git quá thời gian; hãy thử lại.' },
      'C:\\slow',
    );
    expect(result.status).toBe('failed');
    expect(result.root).toBeNull();
    expect(result.message).toContain('thử lại');
  });
});

describe('cleanRepoPath', () => {
  test('trims and strips only a matching pair of Explorer quotes', () => {
    expect(cleanRepoPath('  "C:\\Projects\\my app"  ')).toBe('C:\\Projects\\my app');
    expect(cleanRepoPath('"C:\\Projects\\my app')).toBe('"C:\\Projects\\my app');
    expect(cleanRepoPath('C:\\Projects\\my app"')).toBe('C:\\Projects\\my app"');
    expect(cleanRepoPath('""')).toBe('');
  });

  test('keeps quotes in the middle of a legitimate path and normalises nothing else', () => {
    expect(cleanRepoPath('C:\\work\\"odd"\\app')).toBe('C:\\work\\"odd"\\app');
    expect(cleanRepoPath('C:/Projects/app/')).toBe('C:/Projects/app/');
  });
});

describe('composer preferences', () => {
  test('restores the remembered agent and plan', () => {
    const prefs = readComposerPrefs(storage({ value: JSON.stringify({ agent: 'agy', planId: 'p-two' }) }));
    expect(prefs).toEqual({ agent: 'agy', planId: 'p-two' });
  });

  test('ignores an unknown agent, a transient new plan and broken JSON', () => {
    expect(readComposerPrefs(storage({ value: JSON.stringify({ agent: 'nope', planId: 'p-one' }) }))).toEqual({ planId: 'p-one' });
    expect(readComposerPrefs(storage({ value: JSON.stringify({ agent: 'codex', planId: '__new__' }) }))).toEqual({ agent: 'codex' });
    expect(readComposerPrefs(storage({ value: '{not json' }))).toEqual({});
    expect(readComposerPrefs(storage({ value: 'null' }))).toEqual({});
  });

  test('survives storage that throws on read', () => {
    expect(readComposerPrefs(storage({ failGet: true }))).toEqual({});
    expect(readComposerPrefs(null)).toEqual({});
  });

  test('survives storage that throws on write', () => {
    expect(() => saveComposerPrefs({ agent: 'opencode', planId: 'p-one' }, storage({ failSet: true }))).not.toThrow();
    expect(() => saveComposerPrefs({ agent: 'opencode', planId: 'p-one' }, null)).not.toThrow();
  });

  test('writes under a versioned key', () => {
    const written: string[] = [];
    const target = { ...storage(), setItem: (key: string, value: string) => { written.push(`${key}=${value}`); } } as Storage;
    saveComposerPrefs({ agent: 'qodercli', planId: 'p-one' }, target);
    expect(written).toEqual([`${COMPOSER_PREFS_KEY}=${JSON.stringify({ agent: 'qodercli', planId: 'p-one' })}`]);
  });

  test('remembers an agent while a transient new plan has no id', () => {
    const written: string[] = [];
    const target = { ...storage(), setItem: (key: string, value: string) => { written.push(`${key}=${value}`); } } as Storage;
    saveComposerPrefs({ agent: 'opencode' }, target);
    expect(written).toEqual([`${COMPOSER_PREFS_KEY}=${JSON.stringify({ agent: 'opencode' })}`]);
    expect(readComposerPrefs(storage({ value: written[0]!.slice(COMPOSER_PREFS_KEY.length + 1) }))).toEqual({ agent: 'opencode' });
  });
});

describe('terminal preferences and tab keyboard model', () => {
  test('clamps the font size to the toolbar range', () => {
    expect(clampTerminalFontSize(9)).toBe(10);
    expect(clampTerminalFontSize(23)).toBe(22);
    expect(clampTerminalFontSize(16.4)).toBe(16);
    expect(clampTerminalFontSize(Number.NaN)).toBe(15);
  });

  test('returns the default when nothing usable is stored', () => {
    expect(readTerminalFontSize(storage())).toBe(15);
    expect(readTerminalFontSize(storage({ value: 'huge' }))).toBe(15);
    expect(readTerminalFontSize(storage({ value: '18' }))).toBe(18);
    expect(readTerminalFontSize(storage({ value: '99' }))).toBe(22);
    expect(readTerminalFontSize(storage({ failGet: true }))).toBe(15);
    expect(TERMINAL_FONT_KEY).toBe('fleet.terminal.fontSize');
  });

  test('moves between tabs with arrows, Home and End', () => {
    expect(tabIndexForKey('ArrowRight', 0, 3)).toBe(1);
    expect(tabIndexForKey('ArrowRight', 2, 3)).toBe(0);
    expect(tabIndexForKey('ArrowLeft', 0, 3)).toBe(2);
    expect(tabIndexForKey('ArrowLeft', 2, 3)).toBe(1);
    expect(tabIndexForKey('Home', 2, 3)).toBe(0);
    expect(tabIndexForKey('End', 0, 3)).toBe(2);
    expect(tabIndexForKey('Enter', 1, 3)).toBeNull();
    expect(tabIndexForKey('ArrowRight', 0, 0)).toBeNull();
  });
});
