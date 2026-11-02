import { fileURLToPath } from 'node:url';

import type { ErrorCategory, FleetEvent } from '../../shared/types.js';
import {
  defaultFinalMessage,
  rawEvent,
  type AgentAdapter,
  type HeadlessSpec,
  type LineParser,
} from './types.js';

/**
 * The fake agent lives in the test tree: it exists so integration tests can run
 * a deterministic, dependency-free "agent" through the real runner.
 */
export const FAKE_AGENT_PATH = fileURLToPath(
  new URL('../../test/fixtures/fake-agent.mjs', import.meta.url),
);

const SCENARIO_PREFIX = /^\[\[([^\]\r\n]+)\]\]/;

const ERROR_CATEGORIES: ReadonlySet<string> = new Set<ErrorCategory>([
  'quota',
  'auth',
  'agent',
  'system',
]);

/** Scenario named by a `[[name]]` prefix on the brief, defaulting to `success`. */
export function fakeScenario(brief: string): string {
  return SCENARIO_PREFIX.exec(brief)?.[1] ?? 'success';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function parseFakeLine(line: string, stream: 'stdout' | 'stderr'): FleetEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return [rawEvent(line, stream)];
  }

  const record = asRecord(parsed);
  if (!record) return [rawEvent(line, stream)];

  switch (asString(record.type)) {
    case 'message': {
      const text = asString(record.text);
      return text === undefined ? [rawEvent(line, stream)] : [{ kind: 'message', text }];
    }
    case 'command': {
      const cmd = asString(record.cmd);
      if (cmd === undefined) return [rawEvent(line, stream)];
      const event: Extract<FleetEvent, { kind: 'command' }> = { kind: 'command', cmd };
      const exitCode = asNumber(record.exitCode);
      const output = asString(record.output);
      if (exitCode !== undefined) event.exitCode = exitCode;
      if (output !== undefined) event.output = output;
      return [event];
    }
    case 'edit': {
      const filePath = asString(record.path);
      if (filePath === undefined) return [rawEvent(line, stream)];
      const event: Extract<FleetEvent, { kind: 'file_edit' }> = {
        kind: 'file_edit',
        path: filePath,
      };
      const added = asNumber(record.added);
      const removed = asNumber(record.removed);
      if (added !== undefined) event.added = added;
      if (removed !== undefined) event.removed = removed;
      return [event];
    }
    case 'usage': {
      const event: Extract<FleetEvent, { kind: 'usage' }> = { kind: 'usage' };
      const inputTokens = asNumber(record.inputTokens);
      const outputTokens = asNumber(record.outputTokens);
      const costUsd = asNumber(record.costUsd);
      if (inputTokens !== undefined) event.inputTokens = inputTokens;
      if (outputTokens !== undefined) event.outputTokens = outputTokens;
      if (costUsd !== undefined) event.costUsd = costUsd;
      return [event];
    }
    case 'session': {
      const id = asString(record.id);
      return id === undefined ? [rawEvent(line, stream)] : [{ kind: 'session', id }];
    }
    case 'error': {
      const text = asString(record.text);
      if (text === undefined) return [rawEvent(line, stream)];
      const event: Extract<FleetEvent, { kind: 'error' }> = { kind: 'error', text };
      const explicit = asString(record.category);
      if (explicit !== undefined && ERROR_CATEGORIES.has(explicit)) {
        event.category = explicit as ErrorCategory;
      } else if (/rate limit/i.test(text)) {
        event.category = 'quota';
      }
      return [event];
    }
    default:
      return [rawEvent(line, stream)];
  }
}

/** Adapter for the deterministic test agent (`test/fixtures/fake-agent.mjs`). */
export const fakeAdapter: AgentAdapter = {
  id: 'fake',
  headlessSupported: true,

  async detect(): Promise<{ ok: boolean }> {
    return { ok: true };
  },

  headless(i): HeadlessSpec {
    return {
      cmd: process.execPath,
      args: [FAKE_AGENT_PATH, fakeScenario(i.brief)],
      stdin: i.brief,
    };
  },

  createParser(): LineParser {
    return parseFakeLine;
  },

  finalMessage: defaultFinalMessage,

  interactive(i): { cmd: string; args: string[] } {
    return { cmd: i.bin || process.execPath, args: [] };
  },
};
