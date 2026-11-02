import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { AgentId, FleetEvent } from '../../shared/types.js';
import { getAdapter } from '../../server/adapters/index.js';

const AGENTS: AgentId[] = ['codex', 'qodercli', 'agy', 'opencode'];

function fixtureLines(agent: string): string[] {
  const file = fileURLToPath(
    new URL(
      `../../server/adapters/__fixtures__/${agent}/success.stdout.txt`,
      import.meta.url,
    ),
  );
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((line) => line.length > 0);
}

function parseAll(agent: AgentId): FleetEvent[] {
  const parse = getAdapter(agent).createParser();
  return fixtureLines(agent).flatMap((line) => parse(line, 'stdout'));
}

function ofKind<K extends FleetEvent['kind']>(
  events: FleetEvent[],
  kind: K,
): Extract<FleetEvent, { kind: K }>[] {
  return events.filter((event): event is Extract<FleetEvent, { kind: K }> => event.kind === kind);
}

const cfg = (bin: string | null) => ({ bin, maxParallel: 2, extraArgs: [] });

const headlessInput = {
  bin: 'C:\\bin\\agent.exe',
  brief: 'Sửa "lỗi" ở \'đây\'\nDòng 2 — ✓',
  briefFile: 'C:\\tmp\\brief.md',
  cwd: 'C:\\wt\\repo',
  extraArgs: [] as string[],
};

describe('fixture parsing (recorded real output)', () => {
  for (const agent of AGENTS) {
    test(`${agent}: every fixture line produces at least one event`, () => {
      const parse = getAdapter(agent).createParser();
      for (const line of fixtureLines(agent)) {
        expect(parse(line, 'stdout').length, `lost line: ${line.slice(0, 90)}`).toBeGreaterThanOrEqual(1);
      }
    });

    test(`${agent}: fixture yields a message, an edit/command to hello.txt, usage and a session`, () => {
      const events = parseAll(agent);
      const messages = ofKind(events, 'message').map((event) => event.text);

      expect(messages.length).toBeGreaterThanOrEqual(1);
      expect(messages.some((text) => text.includes('hello.txt'))).toBe(true);
      expect(
        events.some(
          (event) =>
            (event.kind === 'file_edit' && event.path.includes('hello.txt')) ||
            (event.kind === 'command' && event.cmd.includes('hello.txt')),
        ),
      ).toBe(true);
      expect(events.some((event) => event.kind === 'usage')).toBe(true);
      expect(events.some((event) => event.kind === 'session')).toBe(true);
      expect(getAdapter(agent).finalMessage(events)).toBeTruthy();
    });
  }
});

describe('codex parser', () => {
  test('maps thread.started, command_execution and turn.completed', () => {
    const events = parseAll('codex');

    expect(ofKind(events, 'session').map((event) => event.id)).toEqual([
      '01a19c1e-996a-7123-8eea-0129c3ae74be',
    ]);

    const commands = ofKind(events, 'command');
    expect(commands.some((event) => event.cmd.includes('hello.txt'))).toBe(true);
    // item.started carries no exit code, item.completed does.
    expect(commands.some((event) => event.exitCode === undefined)).toBe(true);
    expect(commands.some((event) => event.exitCode === 0)).toBe(true);

    const usage = ofKind(events, 'usage');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ inputTokens: 37828, outputTokens: 158 });
  });

  test('keeps unknown lines as raw', () => {
    const parse = getAdapter('codex').createParser();
    expect(parse('{"type":"turn.started"}', 'stdout')).toEqual([
      { kind: 'raw', stream: 'stdout', text: '{"type":"turn.started"}' },
    ]);
  });
});

describe('qodercli parser', () => {
  test('maps init session, Write tool to file_edit and result usage', () => {
    const events = parseAll('qodercli');

    expect(ofKind(events, 'session').map((event) => event.id)).toEqual([
      '2d64b2da-b792-46ee-a31d-260f8a1c9612',
    ]);

    const edits = ofKind(events, 'file_edit');
    expect(edits).toHaveLength(1);
    expect(edits[0].path).toContain('hello.txt');

    const usage = ofKind(events, 'usage');
    expect(usage).toHaveLength(1);
    expect(usage[0].costUsd).toBe(0);
  });

  test('maps a non-file tool_use to a tool event', () => {
    const parse = getAdapter('qodercli').createParser();
    const line = JSON.stringify({
      type: 'assistant',
      message: {
        content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }],
      },
    });
    expect(parse(line, 'stdout')).toEqual([{ kind: 'tool', name: 'Bash', detail: 'npm test' }]);
  });
});

describe('agy parser', () => {
  test('accumulates text deltas into one message and still keeps every chunk', () => {
    const events = parseAll('agy');

    const messages = ofKind(events, 'message');
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toContain('hello.txt');
    expect(messages[0].text).toContain('xin chào');

    expect(ofKind(events, 'file_edit').map((event) => event.path)).toEqual([
      expect.stringContaining('hello.txt'),
    ]);
    expect(ofKind(events, 'session').map((event) => event.id)).toEqual([
      '3db1ffa4-e9f8-42de-83c8-c0143265ffe3',
    ]);

    const usage = ofKind(events, 'usage');
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ inputTokens: 12857, outputTokens: 304 });
  });
});

describe('opencode parser', () => {
  test('emits the session once, maps write tool and sums step_finish tokens', () => {
    const events = parseAll('opencode');

    expect(ofKind(events, 'session').map((event) => event.id)).toEqual([
      'ses_e63e04c94ffeQVQI4p1bC8qFkA',
    ]);

    expect(ofKind(events, 'file_edit').map((event) => event.path)).toEqual(['hello.txt']);

    const usage = ofKind(events, 'usage');
    expect(usage).toHaveLength(2);
    expect(usage.reduce((sum, event) => sum + (event.inputTokens ?? 0), 0)).toBe(13226);
    expect(usage.every((event) => event.costUsd === 0)).toBe(true);
  });

  test('maps a non-write tool_use to a tool event', () => {
    const parse = getAdapter('opencode').createParser();
    const line = JSON.stringify({
      type: 'tool_use',
      sessionID: 'ses_x',
      part: { tool: 'bash', state: { title: 'npm test', input: { command: 'npm test' } } },
    });
    // First line declares the session, the tool event follows it.
    expect(parse(line, 'stdout')).toEqual([
      { kind: 'session', id: 'ses_x' },
      { kind: 'tool', name: 'bash', detail: 'npm test' },
    ]);
  });
});

describe('headless command lines', () => {
  test('codex sends the brief on stdin and reads it with -', () => {
    expect(getAdapter('codex').headless(headlessInput)).toEqual({
      cmd: 'C:\\bin\\agent.exe',
      args: ['exec', '--json', '-s', 'workspace-write', '-C', 'C:\\wt\\repo', '-'],
      stdin: headlessInput.brief,
    });
  });

  test('codex inserts extraArgs before the final -', () => {
    const spec = getAdapter('codex').headless({ ...headlessInput, extraArgs: ['--foo'] });
    expect(spec.args).toEqual([
      'exec',
      '--json',
      '-s',
      'workspace-write',
      '-C',
      'C:\\wt\\repo',
      '--foo',
      '-',
    ]);
  });

  test('qodercli passes the brief as the last positional argument', () => {
    expect(getAdapter('qodercli').headless(headlessInput)).toEqual({
      cmd: 'C:\\bin\\agent.exe',
      args: [
        '-p',
        '-o',
        'stream-json',
        '--permission-mode',
        'accept_edits',
        '-w',
        'C:\\wt\\repo',
        headlessInput.brief,
      ],
    });
  });

  test('agy gives the brief to -p with nothing after it', () => {
    const spec = getAdapter('agy').headless({ ...headlessInput, extraArgs: ['--verbose'] });
    expect(spec).toEqual({
      cmd: 'C:\\bin\\agent.exe',
      args: [
        '--output-format',
        'stream-json',
        '--mode',
        'accept-edits',
        '--verbose',
        '-p',
        headlessInput.brief,
      ],
    });
    expect(spec.args[spec.args.length - 1]).toBe(headlessInput.brief);
  });

  test('opencode puts extraArgs before the brief', () => {
    const spec = getAdapter('opencode').headless({
      ...headlessInput,
      extraArgs: ['-m', 'harbor-pool/deepseek-v4.1-flash:free'],
    });
    expect(spec).toEqual({
      cmd: 'C:\\bin\\agent.exe',
      args: [
        'run',
        '--format',
        'json',
        '--auto',
        '-m',
        'harbor-pool/deepseek-v4.1-flash:free',
        headlessInput.brief,
      ],
    });
  });

  test('all real adapters support headless mode', () => {
    for (const agent of AGENTS) {
      expect(getAdapter(agent).headlessSupported, agent).toBe(true);
    }
  });
});

describe('detect', () => {
  for (const agent of AGENTS) {
    test(`${agent} reports "chưa cài" without a usable bin`, async () => {
      await expect(getAdapter(agent).detect(cfg(null))).resolves.toEqual({
        ok: false,
        reason: 'chưa cài',
      });
      await expect(getAdapter(agent).detect(cfg('C:\\nope\\missing.exe'))).resolves.toEqual({
        ok: false,
        reason: 'chưa cài',
      });
    });
  }

  test('returns the first --version line when the bin runs', async () => {
    for (const agent of AGENTS) {
      const result = await getAdapter(agent).detect(cfg(process.execPath));
      expect(result.ok, agent).toBe(true);
      expect(result.version, agent).toMatch(/^v\d/);
    }
  });
});

describe('interactive resume commands', () => {
  test('codex', () => {
    expect(
      getAdapter('codex').interactive({ bin: 'C:\\codex.exe', cwd: 'C:\\wt', sessionId: 's1' }),
    ).toEqual({ cmd: 'C:\\codex.exe', args: ['resume', 's1'] });
    expect(
      getAdapter('codex').interactive({ bin: 'C:\\codex.exe', cwd: 'C:\\wt', sessionId: null }),
    ).toEqual({ cmd: 'C:\\codex.exe', args: [] });
  });

  test('qodercli', () => {
    expect(
      getAdapter('qodercli').interactive({ bin: 'C:\\q.exe', cwd: 'C:\\wt', sessionId: 's1' }),
    ).toEqual({ cmd: 'C:\\q.exe', args: ['-r', 's1'] });
    expect(
      getAdapter('qodercli').interactive({ bin: 'C:\\q.exe', cwd: 'C:\\wt', sessionId: null }),
    ).toEqual({ cmd: 'C:\\q.exe', args: [] });
  });

  test('agy', () => {
    expect(
      getAdapter('agy').interactive({ bin: 'C:\\a.exe', cwd: 'C:\\wt', sessionId: 's1' }),
    ).toEqual({ cmd: 'C:\\a.exe', args: ['--conversation', 's1'] });
    expect(
      getAdapter('agy').interactive({ bin: 'C:\\a.exe', cwd: 'C:\\wt', sessionId: null }),
    ).toEqual({ cmd: 'C:\\a.exe', args: [] });
  });

  test('opencode', () => {
    expect(
      getAdapter('opencode').interactive({ bin: 'C:\\o.exe', cwd: 'C:\\wt', sessionId: 's1' }),
    ).toEqual({ cmd: 'C:\\o.exe', args: ['--session', 's1'] });
    expect(
      getAdapter('opencode').interactive({ bin: 'C:\\o.exe', cwd: 'C:\\wt', sessionId: null }),
    ).toEqual({ cmd: 'C:\\o.exe', args: [] });
  });
});
