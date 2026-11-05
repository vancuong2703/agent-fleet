import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import type { AgentId } from '../shared/types.js';
import { files } from './paths.js';

export interface AgentConfig {
  bin: string | null;
  maxParallel: number;
  extraArgs: string[];
}

export interface FleetConfig {
  port: number;
  agents: Record<Exclude<AgentId, 'fake'>, AgentConfig>;
  maxParallelTotal: number;
  /** networkMin: minutes a started network command may stay silent; 0 disables the watchdog. */
  timeouts: { totalMin: number; idleMin: number; networkMin?: number };
  dashboard?: { opencode: { keyPoolConfig: string } };
}

type ConfigurableAgent = Exclude<AgentId, 'fake'>;

const AGENT_IDS: readonly ConfigurableAgent[] = ['codex', 'qodercli', 'agy', 'opencode'];

const DEFAULT_PORT = 4500;
const DEFAULT_MAX_PARALLEL = 2;
const DEFAULT_MAX_PARALLEL_TOTAL = 4;
const DEFAULT_TOTAL_MIN = 30;
const DEFAULT_IDLE_MIN = 10;
export const DEFAULT_NETWORK_MIN = 5;

interface RawConfig {
  port?: unknown;
  agents?: Record<string, { bin?: unknown; maxParallel?: unknown; extraArgs?: unknown } | undefined>;
  maxParallelTotal?: unknown;
  timeouts?: { totalMin?: unknown; idleMin?: unknown; networkMin?: unknown };
  dashboard?: { opencode?: { keyPoolConfig?: unknown } };
}

/**
 * Load `fleet.config.json`, creating it with detected bins and defaults when
 * missing and filling any absent keys with defaults.
 */
export function loadConfig(): FleetConfig {
  const configPath = files.config();
  if (!existsSync(configPath)) {
    const config = withDefaults({});
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
    return config;
  }
  const raw = JSON.parse(readFileSync(configPath, 'utf8')) as RawConfig;
  return withDefaults(raw);
}

function withDefaults(raw: RawConfig): FleetConfig {
  const agents = {} as Record<ConfigurableAgent, AgentConfig>;
  for (const id of AGENT_IDS) {
    const entry = raw.agents?.[id];
    const hasBin = entry != null && Object.prototype.hasOwnProperty.call(entry, 'bin');
    agents[id] = {
      bin: hasBin ? asStringOrNull(entry!.bin) : detectBin(id),
      maxParallel: asNumber(entry?.maxParallel, DEFAULT_MAX_PARALLEL),
      extraArgs: asStringArray(entry?.extraArgs),
    };
  }
  return {
    port: asNumber(raw.port, DEFAULT_PORT),
    agents,
    maxParallelTotal: asNumber(raw.maxParallelTotal, DEFAULT_MAX_PARALLEL_TOTAL),
    timeouts: {
      totalMin: asNumber(raw.timeouts?.totalMin, DEFAULT_TOTAL_MIN),
      idleMin: asNumber(raw.timeouts?.idleMin, DEFAULT_IDLE_MIN),
      networkMin: asNonNegative(raw.timeouts?.networkMin, DEFAULT_NETWORK_MIN),
    },
    dashboard: {
      opencode: {
        keyPoolConfig: asStringOrNull(raw.dashboard?.opencode?.keyPoolConfig)
          ?? path.win32.join(process.env.USERPROFILE ?? homedir(), '.config', 'opencode', 'key-pool.json'),
      },
    },
  };
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asNonNegative(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

/**
 * Locate an agent executable: `where.exe <name>` first, then known install
 * paths. Returns null when nothing is found.
 */
export function detectBin(agent: AgentId): string | null {
  if (agent === 'fake') return process.execPath;

  const fromWhere = whereExe(agent);
  if (fromWhere) return fromWhere;

  for (const candidate of knownPaths(agent)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function whereExe(name: string): string | null {
  const result = spawnSync('where.exe', [name], {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  const lines = (result.stdout ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  for (const line of lines) {
    if (existsSync(line)) return line;
  }
  return null;
}

function knownPaths(agent: ConfigurableAgent): string[] {
  const localAppData =
    process.env.LOCALAPPDATA ??
    path.win32.join(process.env.USERPROFILE ?? homedir(), 'AppData', 'Local');
  const userProfile = process.env.USERPROFILE ?? homedir();
  switch (agent) {
    case 'codex':
      return [path.win32.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe')];
    case 'qodercli':
      return [
        path.win32.join(userProfile, '.qoder', 'bin', 'qodercli', 'qodercli.exe'),
      ];
    case 'agy':
      return [path.win32.join(localAppData, 'agy', 'bin', 'agy.exe')];
    case 'opencode':
      return [
        path.win32.join(
          localAppData,
          'Programs',
          'ai.opencode.desktop',
          'resources',
          'opencode-cli.exe',
        ),
      ];
  }
}

/** Read the API token, generating and persisting a 32-hex-char token on first use. */
export function readOrCreateToken(): string {
  const tokenPath = files.token();
  if (existsSync(tokenPath)) {
    const existing = readFileSync(tokenPath, 'utf8').trim();
    if (existing.length > 0) return existing;
  }
  const token = randomBytes(16).toString('hex');
  writeFileSync(tokenPath, token, 'utf8');
  return token;
}
