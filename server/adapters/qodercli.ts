import type { FleetEvent } from '../../shared/types.js';
import { defaultFinalMessage, rawEvent, type AgentAdapter, type LineParser } from './types.js';
import { asRecord, asString, detectCli, parseJsonRecord, usageFrom } from './util.js';

function toolDetail(input: Record<string, unknown> | null): string | undefined {
  if (!input) return undefined;
  return (
    asString(input.command) ??
    asString(input.description) ??
    asString(input.file_path) ??
    asString(input.filePath)
  );
}

/**
 * qodercli 1.1 stream-json (Claude-Code-shaped):
 *   system{subtype:init,session_id}             → session
 *   assistant{message.content:[thinking|text|tool_use]}
 *       text                                   → message
 *       tool_use Write/Edit with file_path     → file_edit
 *       other tool_use                         → tool
 *   result{result,total_cost_usd,usage}        → usage
 */
function parseQoderline(line: string, stream: 'stdout' | 'stderr'): FleetEvent[] {
  const record = parseJsonRecord(line);
  if (!record) return [rawEvent(line, stream)];

  switch (asString(record.type)) {
    case 'system': {
      if (asString(record.subtype) !== 'init') return [rawEvent(line, stream)];
      const id = asString(record.session_id);
      return id === undefined ? [rawEvent(line, stream)] : [{ kind: 'session', id }];
    }
    case 'assistant': {
      const message = asRecord(record.message);
      const content = message && Array.isArray(message.content) ? message.content : [];
      const events: FleetEvent[] = [];
      for (const raw of content) {
        const part = asRecord(raw);
        if (!part) continue;
        switch (asString(part.type)) {
          case 'text': {
            const text = asString(part.text);
            if (text !== undefined && text.length > 0) events.push({ kind: 'message', text });
            break;
          }
          case 'tool_use': {
            const name = asString(part.name) ?? '';
            const input = asRecord(part.input);
            const filePath = input
              ? (asString(input.file_path) ?? asString(input.filePath))
              : undefined;
            if (filePath !== undefined && (name === 'Write' || name === 'Edit')) {
              events.push({ kind: 'file_edit', path: filePath });
            } else {
              const detail = toolDetail(input);
              events.push(
                detail === undefined
                  ? { kind: 'tool', name }
                  : { kind: 'tool', name, detail },
              );
            }
            break;
          }
          default:
            // thinking / redacted_thinking carry no user-facing event.
            break;
        }
      }
      return events.length > 0 ? events : [rawEvent(line, stream)];
    }
    case 'result': {
      const usage = asRecord(record.usage);
      const cost = usageFrom(record, { cost: 'total_cost_usd' });
      const tokens =
        usage === null
          ? null
          : usageFrom(usage, { input: 'input_tokens', output: 'output_tokens' });
      const event: Extract<FleetEvent, { kind: 'usage' }> = { kind: 'usage' };
      if (cost.costUsd !== undefined) event.costUsd = cost.costUsd;
      if (tokens?.inputTokens !== undefined) event.inputTokens = tokens.inputTokens;
      if (tokens?.outputTokens !== undefined) event.outputTokens = tokens.outputTokens;
      return [event];
    }
    default:
      return [rawEvent(line, stream)];
  }
}

/** Adapter for the Qoder `qodercli` CLI (`-p -o stream-json`). */
export const qodercliAdapter: AgentAdapter = {
  id: 'qodercli',
  headlessSupported: true,

  detect(cfg) {
    return detectCli(cfg.bin);
  },

  headless(i) {
    return {
      cmd: i.bin,
      args: [
        '-p',
        '-o',
        'stream-json',
        '--permission-mode',
        'auto',
        '-w',
        i.cwd,
        ...i.extraArgs,
        '--',
        i.brief,
      ],
    };
  },

  createParser(): LineParser {
    return parseQoderline;
  },

  finalMessage: defaultFinalMessage,

  interactive(i): { cmd: string; args: string[] } {
    return { cmd: i.bin, args: i.sessionId ? ['-r', i.sessionId] : [] };
  },
};
