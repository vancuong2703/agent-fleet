// Static validator for the web demo. No dependencies.
// Usage: node web-demo/check.mjs [file.html ...]   (no args = all pages)
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const all = ['index.html', 'dashboard.html', 'tool.html', 'terminal.html', 'jobs.html', 'compare.html', 'resources.html'];
const targets = process.argv.slice(2).length ? process.argv.slice(2) : all;

let bad = 0;
for (const f of targets) {
  const p = join(here, f);
  if (!existsSync(p)) { console.error('MISSING ' + f); bad++; continue; }
  const html = readFileSync(p, 'utf8');
  if (f.endsWith('.md')) {
    if (html.length < 200) { console.error('TINY ' + f); bad++; continue; }
    console.log('OK ' + f + ' (' + html.length + ' bytes)');
    continue;
  }
  const need = ['assets/app.css', 'assets/app.js', 'class="app"'];
  const miss = need.filter((s) => !html.includes(s));
  if (miss.length) { console.error('INVALID ' + f + ' -> thiếu: ' + miss.join(', ')); bad++; continue; }
  if (html.length < 800) { console.error('TINY ' + f); bad++; continue; }
  console.log('OK ' + f + ' (' + html.length + ' bytes)');
}
// Guard: no app files touched.
for (const f of ['web/src', 'server', 'shared', 'desktop']) {
  if (targets.some((t) => t.startsWith(f))) { console.error('Refuse to validate app path: ' + f); bad++; }
}
process.exit(bad ? 1 : 0);
