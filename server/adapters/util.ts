import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';

import type { FleetEvent } from '../../shared/types.js';

/** `fleet doctor` output for one agent. */
export interface DetectResult {
  ok: boolean;
  version?: string;
  reason?: string;
}

const DETECT_TIMEOUT_MS = 10_000;
const MISSING_REASON = 'chưa cài';

/**
 * Probe an agent executable with `<bin> --version`.
 *
 * A missing or non-existent bin is reported as `chưa cài`; a bin that fails to
 * run (bad permissions, crash, timeout) reports the CLI error text instead.
 */
export function detectCli(bin: string | null | undefined): Promise<DetectResult> {
  if (!bin || !existsSync(bin)) {
    return Promise.resolve({ ok: false, reason: MISSING_REASON });
  }
  return new Promise((resolve) => {
    execFile(
      bin,
      ['--version'],
      { timeout: DETECT_TIMEOUT_MS, shell: false, windowsHide: true, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error) {
          const text = firstLine(stderr) || firstLine(error.message) || 'lỗi không rõ';
          resolve({ ok: false, reason: text });
          return;
        }
        const version = firstLine(stdout);
        resolve(
          version
            ? { ok: true, version }
            : { ok: false, reason: 'không đọc được phiên bản' },
        );
      },
    );
  });
}

function firstLine(text: string | undefined): string {
  for (const line of (text ?? '').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return '';
}

/** Parse one JSONL line, or null when it is not a JSON object. */
export function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    return asRecord(JSON.parse(line));
  } catch {
    return null;
  }
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Build a usage event from a record whose token/cost keys differ per CLI
 * (`input_tokens` vs `input`, `total_cost_usd` vs `cost`, ...).
 */
export function usageFrom(
  record: Record<string, unknown>,
  keys: { input?: string; output?: string; cost?: string },
): Extract<FleetEvent, { kind: 'usage' }> {
  const event: Extract<FleetEvent, { kind: 'usage' }> = { kind: 'usage' };
  const inputTokens = keys.input === undefined ? undefined : asNumber(record[keys.input]);
  const outputTokens = keys.output === undefined ? undefined : asNumber(record[keys.output]);
  const costUsd = keys.cost === undefined ? undefined : asNumber(record[keys.cost]);
  if (inputTokens !== undefined) event.inputTokens = inputTokens;
  if (outputTokens !== undefined) event.outputTokens = outputTokens;
  if (costUsd !== undefined) event.costUsd = costUsd;
  return event;
}