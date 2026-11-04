import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

/**
 * T9 — release integration guards.
 *
 * The desktop host, the server fallback and the docs must all agree with the
 * package version. Before the 2.3.0 bump the host still injected `2.2.0`, the
 * observability fallback reported `2.2.0`, and README/START_HERE linked the
 * previous package, so the shipped EXE disagreed with the UI version tag.
 */

const root = path.resolve(import.meta.dirname, '..');
const read = (file: string): string => readFileSync(path.join(root, file), 'utf8');
const RELEASE = '2.5.0';

describe('release version consistency', () => {
  test('package.json, lockfile, csproj, native marker and server fallback share one version', () => {
    const pkg = JSON.parse(read('package.json')) as { version: string };
    const lock = JSON.parse(read('package-lock.json')) as {
      version: string;
      packages: Record<string, { version?: string }>;
    };
    expect(pkg.version).toBe(RELEASE);
    expect(lock.version).toBe(pkg.version);
    expect(lock.packages['']?.version).toBe(pkg.version);

    expect(read('desktop/AgentFleet.csproj')).toContain(`<Version>${pkg.version}</Version>`);
    // The injected marker is what the web UI reads through isDesktop()/native version.
    expect(read('desktop/DesktopWindow.cs')).toContain(`version = "${pkg.version}"`);
    // Used when package.json cannot be read from the packaged runtime.
    expect(read('server/observability.ts')).toContain(`this.version = '${pkg.version}'`);
  });

  test('current docs point at the 2.5.0 build and keep the historical 2.0 section', () => {
    const readme = read('README.md');
    expect(readme).toContain(`dist/AgentFleet-${RELEASE}/AgentFleet.exe`);
    expect(readme).toContain(`dist/AgentFleet-${RELEASE}-win-x64.zip`);
    expect(readme).not.toContain('dist/AgentFleet-2.2.0');
    expect(readme).toContain(`docs/releases/${RELEASE}.md`);
    // T12 renamed UI labels; the walkthrough must not send people to old names.
    expect(readme).toContain('Công việc mới');
    expect(readme).toContain('Nhật ký');
    expect(readme).toContain('Yêu cầu');
    expect(readme).not.toContain('Task mới');

    expect(read('START_HERE.md')).toContain(`dist/AgentFleet-${RELEASE}/AgentFleet.exe`);
    expect(read('START_HERE.md')).toContain(`docs/releases/${RELEASE}.md`);
    expect(read('docs/README.md')).toContain(`releases/${RELEASE}.md`);

    const desktopReadme = read('desktop/README.md');
    expect(desktopReadme).toContain(`AgentFleet-${RELEASE}`);
    expect(desktopReadme).toContain(`version: '${RELEASE}'`);
    // Preserve the historical 2.0 evidence section while updating the current build.
    expect(desktopReadme).toContain('## Historical 2.0 build');

    const notes = read(`docs/releases/${RELEASE}.md`);
    expect(notes).toContain(`# Agent Fleet Desktop ${RELEASE}`);
    // The portable <115 MB target is known to be unmet; the notes must not claim it passed.
    expect(notes).toMatch(/chưa đạt|không đạt|vượt mục tiêu/i);
  });
});

describe('native smoke helpers stay compatible with the shipped UI', () => {
  const desktop = read('desktop/DesktopWindow.cs');

  test('per-CLI smoke selectors still match the dashboard titles in server/dashboard.ts', () => {
    const block = read('server/dashboard.ts').match(/const AGENT_TITLES[^{]*\{([^}]*)\}/s)?.[1];
    expect(block).toBeTruthy();
    const titles = Object.fromEntries([...block!.matchAll(/(\w+):\s*'([^']+)'/g)].map((match) => [match[1], match[2]]));
    expect(titles).toEqual({ codex: 'Codex', qodercli: 'Qoder CLI', agy: 'Antigravity (AGY)', opencode: 'OpenCode' });

    const pairs = [...desktop.matchAll(/\(\s*"([^"]+)",\s*"([^"]+)"\s*\)/g)]
      .filter((match) => match[1] in titles)
      .map((match) => [match[1], match[2]]);
    expect(pairs).toEqual(Object.entries(titles));
    // The rebuilt terminal picker retains the exact API title in its launch label.
    expect(read('web/src/ui/Terminal.tsx')).toContain("t('Open', 'Mở')");
    expect(read('web/src/ui/Terminal.tsx')).toContain('${tool.title}');
    expect(read('web/src/ui/Dashboard.tsx')).toContain("t('Check', 'Kiểm tra')");
  });

  test('Check All has its own opt-in smoke path and still verifies readiness', () => {
    expect(desktop).toContain('FLEET_SMOKE_CHECK_ALL');
    expect(desktop).toContain('RunCheckAllSmokeTestAsync');
    expect(desktop).toContain('Kiểm tra tất cả');
    // Never weaken the existing checks: each tool must still be ready.
    expect(desktop).toMatch(/check\.GetProperty\("status"\)\.GetString\(\) != "ready"/);
    expect(desktop).toContain('desktop-check-all.png');
  });
});
