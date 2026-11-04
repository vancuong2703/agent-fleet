import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { BriefView } from '../../web/src/components/BriefView.js';
import { diffBadgeLabel } from '../../web/src/store.js';
import { appStrings, eventKindLabel } from '../../web/src/strings.js';
import viteConfig from '../../web/vite.config.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const componentsDir = path.join(root, 'web/src/components');

/**
 * The words the glossary pass removes from every user-facing literal. The last
 * four are generic English display phrases found by the T12 review; agent/model
 * names and API identifiers are intentionally not listed.
 */
const BANNED = ['Task mới', 'Copy', 'Paste', 'Log', 'Brief', 'Tasks', 'AGENT WORKSPACE', 'WORKSPACE ANALYTICS', 'Web workspace', 'Desktop workspace'];

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

/**
 * Collect only text a person can read: string literals and JSX text nodes.
 * Identifiers, import paths, class names and type names are not user-facing and
 * must not be flagged (leader scope note for T12).
 */
function userFacingText(source: string): string[] {
  let text = source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/^\s*\/\/.*$/gm, ' ')
    .replace(/^import\b[\s\S]*?;\s*$/gm, ' ')
    .replace(/^export\b[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, ' ');

  const found: string[] = [];
  const stringLiteral = /(['"`])((?:\\.|(?!\1)[^\\])*)\1/gs;
  for (const match of text.matchAll(stringLiteral)) {
    const value = (match[2] ?? '').replace(/\$\{[\s\S]*?\}/g, ' ');
    found.push(value);
  }
  for (const match of text.matchAll(/>([^<>{}]+)</g)) found.push(match[1] ?? '');
  return found.filter((value) => value.trim().length > 0);
}

function bannedHits(source: string): string[] {
  const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}_])(?:${BANNED.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=$|[^\\p{L}\\p{N}_])`, 'u');
  return userFacingText(source).filter((value) => pattern.test(value));
}

describe('glossary scan', () => {
  const files = [...walk(componentsDir), path.join(root, 'web/src/App.tsx')];

  test('no component or App.tsx renders a banned word', () => {
    const failures = files.flatMap((file) => bannedHits(readFileSync(file, 'utf8')).map((hit) => `${path.relative(root, file)}: ${hit}`));
    expect(failures).toEqual([]);
  });

  test('the scan itself catches a literal and ignores identifiers/imports', () => {
    expect(bannedHits(`import { LogView } from './LogView.js';\nconst Copy = 1;\nexport const label = 'Task mới';`)).toEqual(['Task mới']);
    expect(bannedHits(`<p>Brief</p>`)).toEqual(['Brief']);
    expect(bannedHits(`const className = 'log-view'; const Tasks = 2;`)).toEqual([]);
  });
});

describe('shared glossary strings', () => {
  test('tabs and page names use the agreed Vietnamese words', () => {
    expect(appStrings.tabs).toEqual({ log: 'Nhật ký', diff: 'Thay đổi', brief: 'Yêu cầu' });
    expect(appStrings.newTask).toBe('Công việc mới');
    expect(appStrings.localWorkspace).toBe('Máy cục bộ');
    expect(appStrings.live).toBe('Trực tiếp');
    expect(appStrings.usageTitle).toBe('Tài nguyên & sử dụng');
    expect(appStrings.sidebar.emptySearch).toContain('công việc');
  });

  test('generic eyebrow and host labels are Vietnamese, not English chrome', () => {
    expect(appStrings.eyebrows.workspace).toBe('KHÔNG GIAN LÀM VIỆC AI');
    expect(appStrings.eyebrows.usage).toBe('PHÂN TÍCH SỬ DỤNG');
    expect(appStrings.webWorkspace).toBe('Giao diện web');
    expect(appStrings.desktopWorkspace).toBe('Ứng dụng máy tính');
  });

  test('diff badge only shows a count after the patch was read', () => {
    expect(diffBadgeLabel(false, 3)).toBe('Thay đổi');
    expect(diffBadgeLabel(true, 0)).toBe('Thay đổi (0)');
    expect(diffBadgeLabel(true, 2)).toBe('Thay đổi (2)');
  });

  test('raw event kinds are displayed in Vietnamese', () => {
    expect(eventKindLabel('file_edit')).toBe('Sửa tệp');
    expect(eventKindLabel('command')).toBe('Lệnh');
    expect(eventKindLabel('raw')).toBe('Dữ liệu thô');
    // A kind the UI has never seen still renders readably instead of blank.
    expect(eventKindLabel('mystery')).toBe('mystery');
  });

  test('the brief screen uses Yêu cầu, not Brief', () => {
    const empty = renderToStaticMarkup(createElement(BriefView, { runs: [] }));
    expect(empty).toContain('Chưa có yêu cầu.');
    expect(empty).not.toContain('Brief');
  });
});

describe('app version', () => {
  test('Vite injects the version from package.json', () => {
    const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
    expect((viteConfig as { define?: Record<string, string> }).define?.__APP_VERSION__).toBe(JSON.stringify(pkg.version));
  });
});
