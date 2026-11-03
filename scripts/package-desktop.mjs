import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('This package targets Windows x64 and must be built with Windows x64 Node.js');
const publish = path.resolve(process.argv[2] ?? path.join(workspace, '.tmp/desktop-publish'));
const output = path.resolve(process.argv[3] ?? path.join(workspace, 'dist/AgentFleet'));
const inside = (child, parent) => child.startsWith(parent + path.sep);
if (!inside(output, path.join(workspace, 'dist')) || !inside(publish, workspace)) throw new Error('Packaging target must stay within workspace');
if (!existsSync(path.join(publish, 'AgentFleet.exe'))) throw new Error('Publish AgentFleet.exe before packaging');
if (!existsSync(path.join(workspace, 'web/dist/index.html'))) throw new Error('Build web first');
// This exact generated target is the only directory replaced by the packager.
if (existsSync(output)) {
  try { rmSync(output, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 }); }
  catch (error) {
    // Windows can retain a directory handle after all package files are gone.
    // Reuse only an empty directory tree; never copy over a locked live EXE or
    // leave stale files in the release. Links are not treated as empty folders.
    const emptyTree = folder => readdirSync(folder, { withFileTypes: true }).every(entry => entry.isDirectory() && !entry.isSymbolicLink() && emptyTree(path.join(folder, entry.name)));
    if (!['EPERM', 'EBUSY'].includes(error.code)) throw error;
    // rmSync may stop at the first locked empty subfolder, before visiting the
    // remaining siblings. Remove those too, retaining only empty directories.
    for (const entry of readdirSync(output, { withFileTypes: true })) {
      const target = path.join(output, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink() && emptyTree(target)) continue;
      try { rmSync(target, { recursive: true, force: true, maxRetries: 4, retryDelay: 150 }); }
      catch (childError) { if (!existsSync(target) || (entry.isDirectory() && !entry.isSymbolicLink() && emptyTree(target))) continue; throw childError; }
    }
    if (!emptyTree(output)) throw error;
  }
}
mkdirSync(output, { recursive: true });
for (const item of readdirSync(publish)) cpSync(path.join(publish, item), path.join(output, item), { recursive: true });
const app = path.join(output, 'app');
mkdirSync(path.join(output, 'runtime'), { recursive: true });
cpSync(process.execPath, path.join(output, 'runtime/node.exe'));
for (const license of ['LICENSE', 'LICENSE.txt']) {
  const source = path.join(path.dirname(process.execPath), license);
  if (existsSync(source)) { cpSync(source, path.join(output, 'runtime/NODE-LICENSE.txt')); break; }
}
if (!existsSync(path.join(output, 'runtime/NODE-LICENSE.txt'))) cpSync(path.join(workspace, 'desktop/assets/NODE-LICENSE.txt'), path.join(output, 'runtime/NODE-LICENSE.txt'));
const dotnetAssets = JSON.parse(readFileSync(path.join(workspace, 'desktop/obj/project.assets.json'), 'utf8'));
for (const [name, library] of Object.entries(dotnetAssets.libraries ?? {})) {
  if (!/^(?:Microsoft\.Web\.WebView2|Microsoft\.NETCore\.App\.Runtime\.win-x64|Microsoft\.WindowsDesktop\.App\.Runtime\.win-x64)\//i.test(name)) continue;
  for (const folder of Object.keys(dotnetAssets.packageFolders ?? {})) {
    const source = path.join(folder, library.path ?? name.toLowerCase());
    if (!existsSync(source)) continue;
    const destination = path.join(output, 'licenses', name.replace('/', '-'));
    mkdirSync(destination, { recursive: true });
    for (const file of readdirSync(source)) if (/^(?:LICENSE|NOTICE|THIRD-PARTY-NOTICES)(?:\.TXT)?$/i.test(file)) cpSync(path.join(source, file), path.join(destination, file));
    break;
  }
}
for (const source of ['server', 'shared']) cpSync(path.join(workspace, '.tmp/desktop-compiled', source), path.join(app, source), { recursive: true });
cpSync(path.join(workspace, 'web/dist'), path.join(app, 'web/dist'), { recursive: true });
mkdirSync(path.join(app, 'test/fixtures'), { recursive: true });
cpSync(path.join(workspace, 'test/fixtures/fake-agent.mjs'), path.join(app, 'test/fixtures/fake-agent.mjs'));
const manifest = JSON.parse(readFileSync(path.join(workspace, 'package.json'), 'utf8'));
writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'agent-fleet-desktop-runtime', version: '2.2.0', private: true, type: 'module' }, null, 2));
const visited = new Set();
const deployed = [];
function resolvePackage(name, from) {
  for (let cursor = from; inside(cursor, workspace) || cursor === workspace; cursor = path.dirname(cursor)) {
    const candidate = path.join(cursor, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
    if (cursor === workspace) break;
  }
  return null;
}
function copyPackage(name, from, optional = false) {
  const source = resolvePackage(name, from);
  if (!source) { if (optional) return; throw new Error(`Missing runtime dependency ${name} from ${from}`); }
  if (visited.has(source)) return;
  visited.add(source);
  if (!inside(source, workspace)) throw new Error(`Dependency outside workspace: ${source}`);
  const relative = path.relative(workspace, source);
  const destination = path.join(app, relative);
  cpSync(source, destination, { recursive: true });
  const pkg = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
  deployed.push({ name: pkg.name, version: pkg.version, path: relative.replaceAll('\\', '/') });
  for (const dependency of Object.keys(pkg.dependencies ?? {})) copyPackage(dependency, source);
  for (const dependency of Object.keys(pkg.optionalDependencies ?? {})) copyPackage(dependency, source, true);
}
for (const dependency of Object.keys(manifest.dependencies ?? {})) copyPackage(dependency, workspace);
const sourceSha256 = {};
function fingerprint(directory, prefix = '') {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const relative = path.join(prefix, entry.name);
    const source = path.join(directory, entry.name);
    if (entry.isDirectory()) { if (!['bin', 'obj', 'tests'].includes(entry.name)) fingerprint(source, relative); }
    else if (/\.(?:ts|tsx|cs|csproj|json|js|css|html|svg|ico)$/.test(entry.name)) sourceSha256[relative.replaceAll('\\', '/')] = createHash('sha256').update(readFileSync(source)).digest('hex');
  }
}
for (const source of ['server', 'shared', 'desktop', 'web/dist']) fingerprint(path.join(workspace, source), source);
writeFileSync(path.join(output, 'runtime-manifest.json'), JSON.stringify({ app: 'Agent Fleet Desktop', version: '2.2.0', sourcePackageVersion: manifest.version, builtAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, sourceSha256, packages: deployed.sort((a, b) => a.name.localeCompare(b.name)) }, null, 2));
writeFileSync(path.join(output, 'README.txt'), `AGENT FLEET DESKTOP 2.2.0\r\n\r\nOpen AgentFleet.exe. Keep the app/ and runtime/ folders next to it.\r\nWindows 11 x64 and Microsoft Edge WebView2 Evergreen Runtime are required.\r\nNode.js and the .NET runtime are included in the default self-contained build.\r\nData: %LOCALAPPDATA%\\AgentFleetDesktop\\\r\nLogs: desktop.log and server.log in the data directory.\r\nThe first build is unsigned; it is a local portable build, not a signed installer.\r\n\r\nTHIRD-PARTY NOTICES\r\nEach Node package includes its license in app/node_modules/.\r\nMicrosoft .NET and WebView2 are redistributed under their respective licenses.\r\n`);
let bytes = 0;
function size(directory) { for (const item of readdirSync(directory)) { const file = path.join(directory, item); const stat = statSync(file); if (stat.isDirectory()) size(file); else bytes += stat.size; } }
size(output);
console.log(JSON.stringify({ output, packages: deployed.length, sizeMiB: Math.round(bytes / 1048576 * 10) / 10 }, null, 2));
