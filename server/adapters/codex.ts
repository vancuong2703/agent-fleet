import type { FleetEvent } from '../../shared/types.js';
import { defaultFinalMessage, rawEvent, type AgentAdapter, type LineParser } from './types.js';
import { asNumber, asRecord, asString, detectCli, parseJsonRecord, usageFrom } from './util.js';

/**
 * codex 0.166 JSONL:
 *   thread.started{thread_id}                  → session
 *   item.started|item.completed{agent_message} → message
 *   item.started{command_execution}            → command (no exit code yet)
 *   item.completed{command_execution}          → command + exit_code/aggregated_output
 *   turn.completed{usage}                      → usage (tokens only, no cost)
 */
function parseCodexLine(line: string, stream: 'stdout' | 'stderr'): FleetEvent[] {
  const record = parseJsonRecord(line);
  if (!record) return [rawEvent(line, stream)];

  switch (asString(record.type)) {
    case 'thread.started': {
      const id = asString(record.thread_id);
      return id === undefined ? [rawEvent(line, stream)] : [{ kind: 'session', id }];
    }
    case 'item.started':
    case 'item.completed': {
      const item = asRecord(record.item);
      if (!item) return [rawEvent(line, stream)];
      switch (asString(item.type)) {
        case 'agent_message': {
          const text = asString(item.text);
          return text === undefined ? [rawEvent(line, stream)] : [{ kind: 'message', text }];
        }
        case 'command_execution': {
          const cmd = asString(item.command) ?? '';
          if (record.type === 'item.started') {
            return [{ kind: 'command', cmd }];
          }
          const event: Extract<FleetEvent, { kind: 'command' }> = { kind: 'command', cmd };
          const exitCode = asNumber(item.exit_code);
          const output = asString(item.aggregated_output);
          if (exitCode !== undefined) event.exitCode = exitCode;
          if (output !== undefined) event.output = output;
          return [event];
        }
        case 'file_change': {
          const path = asString(item.path);
          return path === undefined ? [rawEvent(line, stream)] : [{ kind: 'file_edit', path }];
        }
        default:
          return [rawEvent(line, stream)];
      }
    }
    case 'turn.completed': {
      const usage = asRecord(record.usage);
      return usage === null
        ? [rawEvent(line, stream)]
        : [usageFrom(usage, { input: 'input_tokens', output: 'output_tokens' })];
    }
    default:
      return [rawEvent(line, stream)];
  }
}

/** Adapter for the OpenAI `codex` CLI (`codex exec --json`). */
export const codexAdapter: AgentAdapter = {
  id: 'codex',
  headlessSupported: true,

  detect(cfg) {
    return detectCli(cfg.bin);
  },

  headless(i) {
    return {
      cmd: i.bin,
      args: [
        'exec',
        '--json',
        '-s',
        'workspace-write',
        '-C',
        i.cwd,
        ...i.extraArgs,
        ...(i.sessionId ? ['resume', i.sessionId] : []),
        '-',
      ],
      stdin: i.brief,
    };
  },

  createParser(): LineParser {
    return parseCodexLine;
  },

  finalMessage: defaultFinalMessage,

  interactive(i): { cmd: string; args: string[] } {
    return { cmd: i.bin, args: i.sessionId ? ['resume', i.sessionId] : [] };
  },
};