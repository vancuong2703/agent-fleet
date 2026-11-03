import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

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
// Keep this path aligned with FleetRuntime.cs. ESM preserves import.meta.url
// for web/dist and app/package.json; createRequire supports bundled CommonJS.
const bundle = await build({
  absWorkingDir: workspace,
  entryPoints: ['server/main.ts'],
  outfile: path.join(app, 'server/main.js'),
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  external: ['@lydell/node-pty'],
  banner: { js: "import { createRequire as __fleetCreateRequire } from 'node:module'; const require = __fleetCreateRequire(import.meta.url);" },
  minify: true,
  metafile: true,
});
cpSync(path.join(workspace, 'web/dist'), path.join(app, 'web/dist'), { recursive: true });
const manifest = JSON.parse(readFileSync(path.join(workspace, 'package.json'), 'utf8'));
writeFileSync(path.join(app, 'package.json'), JSON.stringify({ name: 'agent-fleet-desktop-runtime', version: manifest.version, private: true, type: 'module' }, null, 2));
const deployed = [];
const requireFromWorkspace = createRequire(path.join(workspace, 'package.json'));
function resolvePackage(name) {
  // Node resolution supports dependencies in an ancestor repository without
  // copying any ancestor-relative paths into the release.
  for (const modules of requireFromWorkspace.resolve.paths(name) ?? []) {
    const candidate = path.join(modules, name);
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
  }
  throw new Error('Missing runtime dependency ' + name);
}
for (const name of ['@lydell/node-pty', '@lydell/node-pty-win32-x64']) {
  const source = resolvePackage(name);
  const relative = path.join('node_modules', name);
  cpSync(source, path.join(app, relative), {
    recursive: true,
    filter: file => !['test', 'tests', 'src', 'node_modules'].includes(path.basename(file)) && !/\.(?:pdb|map|ts)$/i.test(file),
  });
  const pkg = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
  deployed.push({ name: pkg.name, version: pkg.version, path: relative.replaceAll('\\', '/'), bundled: false });
}
// Preserve notices for JS dependencies now embedded in main.js, including the
// server's headless terminal parser. No frontend dependency tree is deployed.
const bundledPackages = new Set();
for (const input of Object.keys(bundle.metafile.inputs)) {
  if (!input.replaceAll('\\', '/').includes('node_modules/')) continue;
  let directory = path.dirname(path.resolve(workspace, input));
  while (directory !== path.dirname(directory)) {
    const manifestPath = path.join(directory, 'package.json');
    if (existsSync(manifestPath) && JSON.parse(readFileSync(manifestPath, 'utf8')).name) { bundledPackages.add(directory); break; }
    directory = path.dirname(directory);
  }
}
for (const source of bundledPackages) {
  const pkg = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
  const relative = path.join('licenses', pkg.name.replaceAll('/', '-') + '-' + pkg.version);
  const destination = path.join(output, relative);
  mkdirSync(destination, { recursive: true });
  for (const file of readdirSync(source)) {
    if (/^(?:LICEN[CS]E|NOTICE|COPYING|THIRD[-_]PARTY[-_]NOTICES)(?:[.-].*)?$/i.test(file) && statSync(path.join(source, file)).isFile()) cpSync(path.join(source, file), path.join(destination, file));
  }
  deployed.push({ name: pkg.name, version: pkg.version, path: relative.replaceAll('\\', '/'), bundled: true });
}
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
writeFileSync(path.join(output, 'runtime-manifest.json'), JSON.stringify({ app: 'Agent Fleet Desktop', version: manifest.version, sourcePackageVersion: manifest.version, builtAt: new Date().toISOString(), node: process.version, platform: process.platform, arch: process.arch, sourceSha256, packages: deployed.sort((a, b) => a.name.localeCompare(b.name)) }, null, 2));
writeFileSync(path.join(output, 'README.txt'), `AGENT FLEET DESKTOP ${manifest.version}\r\n\r\nOpen AgentFleet.exe. Keep the app/ and runtime/ folders next to it.\r\nWindows 11 x64 and Microsoft Edge WebView2 Evergreen Runtime are required.\r\nNode.js and the .NET runtime are included in the default self-contained build.\r\nData: %LOCALAPPDATA%\\AgentFleetDesktop\\\r\nLogs: desktop.log and server.log in the data directory.\r\nThe first build is unsigned; it is a local portable build, not a signed installer.\r\n\r\nTHIRD-PARTY NOTICES\r\nBundled Node package licenses are in licenses/. External PTY licenses are in app/node_modules/.\r\nMicrosoft .NET and WebView2 are redistributed under their respective licenses.\r\n`);
function size(directory) {
  return readdirSync(directory).reduce((bytes, item) => {
    const file = path.join(directory, item);
    const stat = statSync(file);
    return bytes + (stat.isDirectory() ? size(file) : stat.size);
  }, 0);
}
console.log(JSON.stringify({ output, packages: deployed.length, appMiB: +(size(app) / 1048576).toFixed(3), sizeMiB: +(size(output) / 1048576).toFixed(3) }, null, 2));
