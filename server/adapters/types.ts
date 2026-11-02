import type { AgentId, FleetEvent } from '../../shared/types.js';
import type { AgentConfig } from '../config.js';

/** Parses one line of agent output into zero or more fleet events. */
export type LineParser = (line: string, stream: 'stdout' | 'stderr') => FleetEvent[];

/** The concrete command an adapter wants the runner to spawn. */
export interface HeadlessSpec {
  cmd: string;
  args: string[];
  env?: Record<string, string>;
  stdin?: string;
}

/**
 * Contract every agent CLI adapter implements. Adapters are pure and cheap to
 * test: they only build commands and parse output, they never spawn anything.
 */
export interface AgentAdapter {
  id: AgentId;
  /** false when the CLI has no stable non-interactive mode (terminal only). */
  headlessSupported: boolean;
  /** Used by `fleet doctor` and before scheduling a task. */
  detect(cfg: AgentConfig): Promise<{ ok: boolean; version?: string; reason?: string }>;
  headless(i: {
    bin: string;
    brief: string;
    briefFile: string;
    cwd: string;
    extraArgs: string[];
  }): HeadlessSpec;
  /** A fresh, stateful parser per run. Lines it cannot understand become `raw`. */
  createParser(): LineParser;
  /** Text of the agent's final answer, or null. Default: last `message` text. */
  finalMessage(events: FleetEvent[]): string | null;
  interactive(i: {
    bin: string;
    cwd: string;
    sessionId: string | null;
  }): { cmd: string; args: string[] };
}

/** Default `finalMessage`: the text of the last `message` event, if any. */
export function defaultFinalMessage(events: FleetEvent[]): string | null {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i]!;
    if (event.kind === 'message') return event.text;
  }
  return null;
}

/** A raw event for a line an adapter does not understand. */
export function rawEvent(line: string, stream: 'stdout' | 'stderr'): FleetEvent {
  return { kind: 'raw', stream, text: line };
}
