import type { FleetEvent } from '../../shared/types.js';
import { defaultFinalMessage, rawEvent, type AgentAdapter, type LineParser } from './types.js';
import { asNumber, asRecord, asString, detectCli, parseJsonRecord } from './util.js';

/** opencode tool names that write a file to `state.input.path`. */
const WRITE_TOOLS: ReadonlySet<string> = new Set(['write', 'edit']);

/**
 * opencode `run --format json` JSONL. Every line carries `sessionID`; the
 * parser emits it once per run so the UI can resume the session in a terminal.
 *   text{part.text}                              → message
 *   tool_use{part.tool,part.state.input.path}    → file_edit (write/edit) or tool
 *   step_finish{part.cost,part.tokens}           → usage
 */
function createOpencodeParser(): LineParser {
  const seenSessions = new Set<string>();

  return (line, stream): FleetEvent[] => {
    const record = parseJsonRecord(line);
    if (!record) return [rawEvent(line, stream)];

    const events: FleetEvent[] = [];
    const sessionID = asString(record.sessionID);
    if (sessionID !== undefined && !seenSessions.has(sessionID)) {
      seenSessions.add(sessionID);
      events.push({ kind: 'session', id: sessionID });
    }

    switch (asString(record.type)) {
      case 'text': {
        const part = asRecord(record.part);
        const text = part ? asString(part.text) : undefined;
        if (text !== undefined) events.push({ kind: 'message', text });
        break;
      }
      case 'tool_use': {
        const part = asRecord(record.part);
        const tool = part ? asString(part.tool) : undefined;
        if (tool !== undefined) {
          const state = part ? asRecord(part.state) : null;
          const input = state ? asRecord(state.input) : null;
          const path = input
            ? (asString(input.path) ?? asString(input.filePath))
            : undefined;
          if (path !== undefined && WRITE_TOOLS.has(tool)) {
            events.push({ kind: 'file_edit', path });
          } else {
            const detail =
              (state ? asString(state.title) : undefined) ??
              (input ? asString(input.command) : undefined) ??
              path;
            events.push(
              detail === undefined
                ? { kind: 'tool', name: tool }
                : { kind: 'tool', name: tool, detail },
            );
          }
        }
        break;
      }
      case 'step_finish': {
        const part = asRecord(record.part);
        if (part) {
          const event: Extract<FleetEvent, { kind: 'usage' }> = { kind: 'usage' };
          const costUsd = asNumber(part.cost);
          const tokens = asRecord(part.tokens);
          const inputTokens = tokens ? asNumber(tokens.input) : undefined;
          const outputTokens = tokens ? asNumber(tokens.output) : undefined;
          if (inputTokens !== undefined) event.inputTokens = inputTokens;
          if (outputTokens !== undefined) event.outputTokens = outputTokens;
          if (costUsd !== undefined) event.costUsd = costUsd;
          events.push(event);
        }
        break;
      }
      default:
        // step_start and unknown types have no event of their own.
        break;
    }

    return events.length > 0 ? events : [rawEvent(line, stream)];
  };
}

/** Adapter for the `opencode` CLI (`run --format json`). */
export const opencodeAdapter: AgentAdapter = {
  id: 'opencode',
  headlessSupported: true,

  detect(cfg) {
    return detectCli(cfg.bin);
  },

  headless(i) {
    return {
      cmd: i.bin,
      args: ['run', '--standalone', '--format', 'json', '--auto', ...(i.sessionId ? ['--session', i.sessionId] : []), ...i.extraArgs, '--', i.brief],
    };
  },

  createParser(): LineParser {
    return createOpencodeParser();
  },

  finalMessage: defaultFinalMessage,

  interactive(i): { cmd: string; args: string[] } {
    return { cmd: i.bin, args: i.sessionId ? ['--session', i.sessionId] : [] };
  },
};
