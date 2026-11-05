import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { classifyStartupError, clearStartupReport, redact, writeStartupReport } from '../../server/startup-report.js';

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'fleet-sr-')); vi.stubEnv('FLEET_DATA_DIR', dir); });
afterEach(() => { vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

describe('redact', () => {
  test('masks fleet tokens, sk- keys, JWTs and long hex runs', () => {
    const hex = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
    const text = [
      `x-fleet-token: ${hex}`, 'x-fleet-token="tok-plain"', 'key sk-ABCDEF1234567890abcdef',
      'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.c2lnbmF0dXJl', `hash ${hex}${hex}`,
    ].join('\n');
    const out = redact(text);
    for (const secret of [hex, 'tok-plain', 'sk-ABCDEF', 'eyJhbGci', 'eyJzdWIi']) expect(out).not.toContain(secret);
    expect(out).toContain('x-fleet-token');
  });
  test('leaves ordinary text alone', () => {
    expect(redact('listen EADDRINUSE 127.0.0.1:4500')).toBe('listen EADDRINUSE 127.0.0.1:4500');
  });
});

describe('classifyStartupError', () => {
  test.each([
    [Object.assign(new Error('listen EADDRINUSE: address already in use 127.0.0.1:4500'), { code: 'EADDRINUSE' }), 'port_in_use'],
    [new Error('database disk image is malformed'), 'db_corrupt'],
    [Object.assign(new Error('x'), { code: 'SQLITE_CORRUPT' }), 'db_corrupt'],
    [new Error('boom'), 'unknown'],
    ['a string', 'unknown'],
  ])('%s -> %s', (error, code) => {
    const result = classifyStartupError(error);
    expect(result.code).toBe(code);
    expect(result.hint.length).toBeGreaterThan(10);
  });
  test('corruption hint mentions the recovery command', () => {
    expect(classifyStartupError(new Error('malformed')).hint).toContain('--repair-db');
  });
});

describe('startup-error.json', () => {
  test('is written redacted and removed on a clean start', () => {
    const error = Object.assign(new Error('listen EADDRINUSE x-fleet-token: 0123456789abcdef0123456789abcdef'), { code: 'EADDRINUSE' });
    writeStartupReport(error, ['line sk-SECRETSECRET123456']);
    const file = path.join(dir, 'startup-error.json');
    const report = JSON.parse(readFileSync(file, 'utf8'));
    expect(report).toMatchObject({ code: 'port_in_use', at: expect.any(String) });
    expect(typeof report.hint).toBe('string');
    expect(JSON.stringify(report)).not.toContain('0123456789abcdef0123456789abcdef');
    expect(JSON.stringify(report)).not.toContain('sk-SECRET');
    expect(report.logTail).toHaveLength(1);
    clearStartupReport();
    expect(existsSync(file)).toBe(false);
  });
});
