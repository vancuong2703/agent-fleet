import type { FleetEvent } from '../../shared/types.js';
import { defaultFinalMessage, rawEvent, type AgentAdapter, type LineParser } from './types.js';
import { asNumber, asRecord, asString, detectCli, parseJsonRecord, usageFrom } from './util.js';

/** agy tool names that write a file to a path in `tool_info.parameters.Path`. */
const WRITE_TOOLS: ReadonlySet<string> = new Set([
  'write_file',
  'write_to_file',
  'replace_file_content',
  'multi_replace_file_content',
  'sed_file',
]);

function parameterPath(parameters: Record<string, unknown> | null): string | undefined {
  if (!parameters) return undefined;
  return (
    asString(parameters.Path) ??
    asString(parameters.path) ??
    asString(parameters.file_path) ??
    asString(parameters.filePath)
  );
}

/**
 * agy (Antigravity) NDJSON. The agent's answer streams as many `text_delta`
 * chunks, so the parser accumulates text per `step_index` and only emits one
 * `message` when that step reaches `DONE` (or when the `result` event flushes
 * anything still pending). Structurally-lost lines stay as `raw`.
 */
function createAgyParser(): LineParser {
  const pendingByStep = new Map<number, string>();
  let emittedMessage = false;

  return (line, stream): FleetEvent[] => {
    const record = parseJsonRecord(line);
    if (!record) return [rawEvent(line, stream)];

    switch (asString(record.event)) {
      case 'init': {
        const id = asString(record.conversation_id);
        return id === undefined ? [rawEvent(line, stream)] : [{ kind: 'session', id }];
      }
      case 'step_update': {
        const step = asRecord(record.step_update);
        if (!step) return [rawEvent(line, stream)];
        const index = asNumber(step.step_index) ?? -1;
        const state = asString(step.state);
        const stepType = asString(step.step_type);

        if (stepType === 'agent_response') {
          const delta = asString(step.text_delta);
          if (delta !== undefined) pendingByStep.set(index, (pendingByStep.get(index) ?? '') + delta);
          if (state !== 'DONE') return [rawEvent(line, stream)];
          const text = pendingByStep.get(index) ?? '';
          pendingByStep.delete(index);
          if (text.length === 0) return [rawEvent(line, stream)];
          emittedMessage = true;
          return [{ kind: 'message', text }];
        }

        if (stepType === 'tool') {
          if (state !== 'DONE') return [rawEvent(line, stream)];
          const toolInfo = asRecord(step.tool_info);
          const toolName =
            asString(step.tool_name) ?? (toolInfo ? asString(toolInfo.name) : undefined) ?? '';
          const parameters = toolInfo ? asRecord(toolInfo.parameters) : null;
          const path = parameterPath(parameters);
          if (path !== undefined && WRITE_TOOLS.has(toolName)) {
            return [{ kind: 'file_edit', path }];
          }
          const detail = path ?? (parameters ? asString(parameters.command) : undefined);
          return detail === undefined
            ? [{ kind: 'tool', name: toolName }]
            : [{ kind: 'tool', name: toolName, detail }];
        }

        return [rawEvent(line, stream)];
      }
      case 'result': {
        const events: FleetEvent[] = [];
        for (const [index, text] of [...pendingByStep.entries()].sort((a, b) => a[0] - b[0])) {
          if (text.length > 0) {
            events.push({ kind: 'message', text });
            emittedMessage = true;
          }
        }
        pendingByStep.clear();

        const result = asRecord(record.result);
        if (result) {
          const usage = asRecord(result.usage);
          if (usage) {
            events.push(usageFrom(usage, { input: 'input_tokens', output: 'output_tokens' }));
          }
          const response = asString(result.response);
          if (!emittedMessage && response !== undefined && response.length > 0) {
            events.push({ kind: 'message', text: response });
            emittedMessage = true;
          }
        }
        return events.length > 0 ? events : [rawEvent(line, stream)];
      }
      default:
        return [rawEvent(line, stream)];
    }
  };
}

/** Adapter for the Antigravity `agy` CLI (`--output-format stream-json`). */
export const agyAdapter: AgentAdapter = {
  id: 'agy',
  headlessSupported: true,

  detect(cfg) {
    return detectCli(cfg.bin);
  },

  headless(i) {
    return {
      cmd: i.bin,
      // `-p` consumes the brief, so nothing may follow it.
      args: [
        '--output-format',
        'stream-json',
        '--mode',
        'accept-edits',
        ...i.extraArgs,
        '-p',
        i.brief,
      ],
    };
  },

  createParser(): LineParser {
    return createAgyParser();
  },

  finalMessage: defaultFinalMessage,

  interactive(i): { cmd: string; args: string[] } {
    return { cmd: i.bin, args: i.sessionId ? ['--conversation', i.sessionId] : [] };
  },
};