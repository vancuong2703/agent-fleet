// Deterministic fake agent used by integration tests. Plain Node ESM, no deps.
//
// Usage: node fake-agent.mjs <scenario>
// The brief is read from stdin; the scenario is chosen by the adapter from a
// `[[name]]` prefix on the brief (default `success`).
//
// Scenarios: success | fail | hang | spawn-child-hang | quota | slow

import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const scenario = process.argv[2] || 'success';

function emit(event) {
  process.stdout.write(JSON.stringify(event) + '\n');
}

async function readBrief() {
  let brief = '';
  process.stdin.setEncoding('utf8');
  for await (const chunk of process.stdin) brief += chunk;
  return brief;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hangForever() {
  setInterval(() => {}, 1 << 30);
}

switch (scenario) {
  case 'success': {
    const brief = await readBrief();
    emit({ type: 'message', text: brief });
    writeFileSync('fake.txt', 'fake agent completed\n', 'utf8');
    process.exit(0);
  }

  case 'fail': {
    process.exit(3);
  }

  case 'hang': {
    emit({ type: 'message', text: 'bắt đầu treo' });
    hangForever();
    break;
  }

  case 'spawn-child-hang': {
    emit({ type: 'message', text: 'sinh tiến trình con rồi treo' });
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      stdio: 'ignore',
      windowsHide: true,
    });
    writeFileSync('child.pid', String(child.pid), 'utf8');
    hangForever();
    break;
  }

  case 'quota': {
    emit({ type: 'error', text: 'rate limit exceeded' });
    process.exit(1);
  }

  case 'slow': {
    for (let i = 1; i <= 5; i += 1) {
      emit({ type: 'message', text: `slow ${i}` });
      await sleep(200);
    }
    process.exit(0);
  }

  default: {
    process.stderr.write(`unknown scenario: ${scenario}\n`);
    process.exit(2);
  }
}
