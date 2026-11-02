#!/usr/bin/env node
const { spawnSync } = require('node:child_process');
const { resolve } = require('node:path');

const result = spawnSync(process.execPath, [
  require.resolve('tsx/cli', { paths: [resolve(__dirname, '..')] }),
  resolve(__dirname, 'fleet.ts'),
  ...process.argv.slice(2),
], { stdio: 'inherit', shell: false, windowsHide: true });

if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
