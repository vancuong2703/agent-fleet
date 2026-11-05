import { describe, expect, test, vi, afterEach } from 'vitest';
import { leaderGuide, psLiteral } from '../../server/leader-guide.js';

afterEach(() => vi.unstubAllEnvs());
describe('leader handoff', () => {
  test('copies live profile, exact local CLI, documentation, and never credentials', () => {
    vi.stubEnv('FLEET_DATA_DIR', process.cwd());
    vi.stubEnv('OPENAI_API_KEY', 'sk-test-secret-do-not-copy');
    const guide = leaderGuide(49123);
    expect(guide.baseUrl).toBe('http://127.0.0.1:49123');
    expect(guide.dataDir).toBe(process.cwd());
    expect(guide.content).toContain('function fleet');
    expect(guide.content).toContain('fleet plan list --json');
    expect(guide.connect).toContain("$env:FLEET_SERVER_URL = 'http://127.0.0.1:49123'");
    expect(guide.content).toContain('Checklist trước khi merge');
    expect(guide.content).toContain('tokenharbor/deepseek-v4.1-flash-1017');
    expect(guide.content).not.toMatch(/sk-test-secret|eyJ[A-Za-z0-9_-]{10,}|do-not-copy/);
  });
  test('connect block pins the server instance and verifies the connection before listing plans', () => {
    const { connect } = leaderGuide(49126, 'inst-1234');
    expect(connect).toContain("$env:FLEET_SERVER_INSTANCE = 'inst-1234'");
    const lines = connect.split(/\r?\n/);
    expect(lines.indexOf('fleet connection')).toBeGreaterThan(-1);
    expect(lines.indexOf('fleet connection')).toBeLessThan(lines.indexOf('fleet plan list --json'));
    expect(lines.findIndex(l => l.includes('FLEET_SERVER_INSTANCE'))).toBeLessThan(lines.indexOf('fleet connection'));
  });
  test('PowerShell paths preserve apostrophes, spaces and Vietnamese text literally', () => {
    expect(psLiteral("C:\\Dự án O'Brien\\$test`name")).toBe("'C:\\Dự án O''Brien\\$test`name'");
  });
  test('connection reflects a new app port instead of caching it', () => {
    const first = leaderGuide(49124);
    const next = leaderGuide(49125);
    expect(next.connect).toContain('49125');
    expect(next.connect).not.toContain('49124');
    expect(first.connect).toContain('49124');
  });
});
