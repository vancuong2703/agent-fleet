import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture() {
  mkdirSync('.tmp', { recursive: true });
  const root = mkdtempSync(path.resolve('.tmp/desktop packaging '));
  roots.push(root);
  const put = (name: string, content: string) => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), content);
  };
  const pkg = (name: string, extra = {}) => put(`node_modules/${name}/package.json`, JSON.stringify({ name, version: '1.0.0', main: 'index.js', ...extra }));
  put('scripts/package-desktop.mjs', readFileSync('scripts/package-desktop.mjs', 'utf8'));
  put('scripts/package-desktop.ps1', readFileSync('scripts/package-desktop.ps1', 'utf8'));
  put('package.json', JSON.stringify({ version: '9.8.7', type: 'module', dependencies: {
    '@lydell/node-pty': '*', '@xterm/headless': '*', react: '*', 'runtime-helper': '*',
  } }));
  put('server/main.ts', `import { platform } from '@lydell/node-pty';
import helper from 'runtime-helper';
import { answer } from '../shared/value.js';
console.log(JSON.stringify({ platform, answer, helper: helper() }));`);
  put('shared/value.ts', 'export const answer = 42;');
  put('cli/fleet.ts', 'import helper from "cli-helper"; console.log(helper());');
  pkg('cli-helper');
  put('node_modules/cli-helper/index.js', 'module.exports = () => "portable-cli";');
  put('node_modules/cli-helper/LICENSE', 'CLI helper license');
  put('docs/leader-guide.md', '# Leader guide fixture');
  put('docs/agent-cli-guide.md', '# Agent CLI guide fixture');
  // Previous compiler output lets the old packager run and expose payload bugs.
  put('.tmp/desktop-compiled/server/main.js', 'console.log("unbundled");');
  put('.tmp/desktop-compiled/shared/value.js', 'export const answer = 42;');
  put('web/dist/index.html', '<!doctype html><title>Fixture</title>');
  put('test/fixtures/fake-agent.mjs', 'throw new Error("test-only");');
  put('desktop/assets/NODE-LICENSE.txt', 'Node license fixture');
  put('desktop/obj/project.assets.json', '{}');
  put('.tmp/publish/AgentFleet.exe', 'publish fixture');
  pkg('@lydell/node-pty', { optionalDependencies: { '@lydell/node-pty-win32-x64': '*', '@lydell/node-pty-linux-x64': '*' } });
  put('node_modules/@lydell/node-pty/index.js', `exports.platform = undefined; module.exports = require('@lydell/node-pty-' + process.platform + '-' + process.arch);`);
  for (const platform of ['win32-x64', 'linux-x64']) {
    pkg(`@lydell/node-pty-${platform}`);
    put(`node_modules/@lydell/node-pty-${platform}/index.js`, `exports.platform = '${platform}';`);
    put(`node_modules/@lydell/node-pty-${platform}/LICENSE`, 'PTY license fixture');
    put(`node_modules/@lydell/node-pty-${platform}/build/Release/debug.pdb`, 'debug symbols');
    put(`node_modules/@lydell/node-pty-${platform}/test/test.js`, 'test only');
  }
  pkg('runtime-helper', { main: 'lib/index.js' });
  put('node_modules/runtime-helper/lib/package.json', JSON.stringify({ type: 'commonjs' }));
  put('node_modules/runtime-helper/LICENSE', 'Bundled helper license');
  put('node_modules/runtime-helper/lib/index.js', `const path = require('node:path'); module.exports = () => path.basename('bundled');`);
  for (const name of ['react', '@xterm/headless']) {
    pkg(name);
    put(`node_modules/${name}/index.js`, 'module.exports = {};');
  }
  return root;
}

describe.skipIf(process.platform !== 'win32' || process.arch !== 'x64')('desktop runtime packaging', () => {
  it('bundles runnable server/CLI entries with only Windows x64 runtime files and package-version metadata', () => {
    const root = fixture();
    const output = path.join(root, 'dist/AgentFleet');
    execFileSync(process.execPath, [path.join(root, 'scripts/package-desktop.mjs'), path.join(root, '.tmp/publish'), output], { windowsHide: true });
    const app = path.join(output, 'app');
    expect(readdirSync(path.join(app, 'server'))).toEqual(['main.js']);
    expect(existsSync(path.join(app, 'shared'))).toBe(false);
    expect(execFileSync(process.execPath, [path.join(app, 'cli/fleet.js')], { encoding: 'utf8', windowsHide: true }).trim()).toBe('portable-cli');
    expect(readFileSync(path.join(app, 'docs/leader-guide.md'), 'utf8')).toContain('Leader guide fixture');
    expect(readFileSync(path.join(root, 'dist/AgentFleet/licenses/cli-helper-1.0.0/LICENSE'), 'utf8')).toBe('CLI helper license');
    const manifest = JSON.parse(readFileSync(path.join(root, 'dist/AgentFleet/runtime-manifest.json'), 'utf8'));
    expect(manifest.packages).toContainEqual(expect.objectContaining({ name: 'cli-helper', bundled: true }));
    expect(JSON.parse(execFileSync(process.execPath, [path.join(app, 'server/main.js')], { encoding: 'utf8', windowsHide: true }))).toEqual({ platform: 'win32-x64', answer: 42, helper: 'bundled' });
    expect(existsSync(path.join(app, 'test'))).toBe(false);
    expect(readdirSync(path.join(app, 'node_modules'))).toEqual(['@lydell']);
    expect(readdirSync(path.join(app, 'node_modules/@lydell'))).toEqual(['node-pty', 'node-pty-win32-x64']);
    const native = path.join(app, 'node_modules/@lydell/node-pty-win32-x64');
    expect(existsSync(path.join(native, 'test'))).toBe(false);
    expect(existsSync(path.join(native, 'build/Release/debug.pdb'))).toBe(false);
    expect(existsSync(path.join(native, 'LICENSE'))).toBe(true);
    expect(JSON.parse(readFileSync(path.join(app, 'package.json'), 'utf8')).version).toBe('9.8.7');
    expect(JSON.parse(readFileSync(path.join(output, 'runtime-manifest.json'), 'utf8')).version).toBe('9.8.7');
    expect(readFileSync(path.join(output, 'README.txt'), 'utf8')).toContain('DESKTOP 9.8.7');
    expect(readFileSync(path.join(output, 'licenses/runtime-helper-1.0.0/LICENSE'), 'utf8')).toBe('Bundled helper license');
  });
  it('resolves shared ancestor dependencies into portable app-relative paths', () => {
    const parent = fixture();
    const root = path.join(parent, 'worktree');
    mkdirSync(root);
    for (const entry of readdirSync(parent)) {
      if (!['worktree', 'node_modules'].includes(entry)) cpSync(path.join(parent, entry), path.join(root, entry), { recursive: true });
    }
    execFileSync(process.execPath, [path.join(root, 'scripts/package-desktop.mjs'), path.join(root, '.tmp/publish'), path.join(root, 'dist/AgentFleet')], { windowsHide: true });
    const app = path.join(root, 'dist/AgentFleet/app');
    expect(JSON.parse(execFileSync(process.execPath, [path.join(app, 'server/main.js')], { encoding: 'utf8', windowsHide: true }))).toEqual({ platform: 'win32-x64', answer: 42, helper: 'bundled' });
    expect(readdirSync(path.join(app, 'node_modules/@lydell'))).toEqual(['node-pty', 'node-pty-win32-x64']);
  });

  it('refuses to recursively clean an unsafe or overlapping release target', () => {
    const root = fixture();
    const script = path.join(root, 'scripts/package-desktop.mjs');
    const publish = path.join(root, '.tmp/publish');
    const release = path.join(root, 'dist/AgentFleet');
    mkdirSync(path.join(root, 'dist'), { recursive: true });
    const marker = path.join(root, 'dist', 'keep.txt');
    writeFileSync(marker, 'keep');

    // `dist/` is the parent of every release and must never be the deletion target.
    expect(() => execFileSync(process.execPath, [script, publish, path.join(root, 'dist')], { windowsHide: true })).toThrow();
    // Absolute paths outside the workspace are rejected before any cleanup.
    expect(() => execFileSync(process.execPath, [script, publish, path.resolve(root, '..', 'AgentFleet-escaped')], { windowsHide: true })).toThrow();
    // A source directory that contains the release would copy the output into itself.
    expect(() => execFileSync(process.execPath, [script, path.join(root, 'dist'), release], { windowsHide: true })).toThrow(/overlap/i);
    expect(readFileSync(marker, 'utf8')).toBe('keep');
  });

  it('uses the package version for the archive even with a different output folder name', () => {
    const root = fixture();
    // Stub publishing/archiving, but run real PowerShell orchestration and the
    // Node packager to check argument/path handling without requiring .NET.
    const script = String.raw`
      function global:dotnet {
        $target = $args[[Array]::IndexOf($args, '-o') + 1]
        New-Item -ItemType Directory -Force $target | Out-Null
        Set-Content -LiteralPath (Join-Path $target 'AgentFleet.exe') -Value 'publish fixture'
        $global:LASTEXITCODE = 0
      }
      function global:Compress-Archive {
        param($LiteralPath, $DestinationPath, [switch]$Force)
        if (!(Test-Path -LiteralPath $LiteralPath)) { throw 'Missing package' }
        Set-Content -LiteralPath $DestinationPath -Value 'archive fixture'
      }
      & './scripts/package-desktop.ps1' -SkipWebBuild -OutputName AgentFleet-1.0.0
    `;
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { cwd: root, windowsHide: true });
    expect(existsSync(path.join(root, 'dist/AgentFleet-9.8.7-win-x64.zip'))).toBe(true);
    expect(existsSync(path.join(root, 'dist/AgentFleet-1.0.0/app/server/main.js'))).toBe(true);
  });
});


