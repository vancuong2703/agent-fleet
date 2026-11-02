import type { AgentId, FleetEvent } from '../../shared/types.js';
import type { AgentConfig, FleetConfig } from '../config.js';
import { fakeAdapter } from './fake.js';
import { defaultFinalMessage, rawEvent, type AgentAdapter, type LineParser } from './types.js';

/**
 * Registry of known adapters. Task 11 registers the real CLI adapters here; the
 * placeholder below keeps `getAdapter` total before they exist.
 */
const registry: Partial<Record<AgentId, AgentAdapter>> = {
  fake: fakeAdapter,
};

/** Register (or replace) an adapter, e.g. from a real adapter module. */
export function registerAdapter(adapter: AgentAdapter): void {
  registry[adapter.id] = adapter;
}

/**
 * Adapter for an agent. Agents without a registered adapter report as
 * unavailable instead of throwing, so callers can degrade gracefully.
 */
export function getAdapter(id: AgentId): AgentAdapter {
  return registry[id] ?? placeholderAdapter(id);
}

/**
 * Config for an agent. `fake` has no `fleet.config.json` entry: its bin is
 * always the running Node executable.
 */
export function getAdapterConfig(id: AgentId, cfg: FleetConfig): AgentConfig {
  if (id === 'fake') {
    return { bin: process.execPath, maxParallel: 2, extraArgs: [] };
  }
  return cfg.agents[id];
}

function placeholderAdapter(id: AgentId): AgentAdapter {
  return {
    id,
    headlessSupported: false,
    async detect(cfg) {
      return cfg.bin
        ? { ok: false, reason: 'chưa hỗ trợ' }
        : { ok: false, reason: 'chưa cài' };
    },
    headless() {
      throw new Error(`Chưa có adapter cho agent "${id}"`);
    },
    createParser(): LineParser {
      return (line, stream): FleetEvent[] => [rawEvent(line, stream)];
    },
    finalMessage: defaultFinalMessage,
    interactive(i) {
      return { cmd: i.bin, args: [] };
    },
  };
}
