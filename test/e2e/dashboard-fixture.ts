import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { DashboardCheck, DashboardSnapshot, DashboardTool } from '../../shared/dashboard.js';
import type { ObservabilitySnapshot } from '../../shared/observability.js';
import type { Plan, Run, Task } from '../../shared/types.js';

/** Synthetic saved CLI checks only. No E2E fixture starts an installed agent. */
export const savedChecks = JSON.parse(readFileSync(path.join('test/e2e/fixtures/dashboard-checks.json'), 'utf8')) as { version: number; checks: Record<DashboardTool['agent'], DashboardCheck> };
export function dashboardFixture(): DashboardSnapshot {
  const titles = { codex: 'Codex', qodercli: 'Qoder CLI', agy: 'Antigravity (AGY)', opencode: 'OpenCode' };
  return { generatedAt: Date.now(), terminalSessions: [], tools: (Object.keys(titles) as DashboardTool['agent'][]).map(agent => ({ agent, title: titles[agent], installed: false, configuredBin: null, suggestions: [], lastCheck: structuredClone(savedChecks.checks[agent]) })) };
}
export async function login(page: Page) {
  const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.getByRole('heading', { name: 'Bảng điều khiển', exact: true })).toBeVisible();
}
export async function navigate(page: Page, label: string) {
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: 'Tìm lệnh' }).fill(label);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
}
export const card = (page: Page, agent: DashboardTool['agent']) => page.locator(`.dashboard-page article[data-tool="${agent}"]`);
export async function openTool(page: Page, agent: DashboardTool['agent']) {
  await card(page, agent).getByRole('button', { name: 'Chi tiết', exact: false }).click();
  await expect(page.locator('.tool-page')).toBeVisible();
}
export async function stubDashboard(page: Page, dashboard: DashboardSnapshot = dashboardFixture()) {
  await page.route('**/api/dashboard', route => route.fulfill({ json: dashboard }));
  await page.route('**/api/plans', route => route.fulfill({ json: [] }));
  await page.route(/\/api\/tasks(?:\?.*)?$/, route => route.fulfill({ json: [] }));
  await page.route(/\/api\/stats(?:\?.*)?$/, route => route.fulfill({ json: [] }));
  // A missing test override must fail safely rather than call a real CLI probe.
  await page.route('**/api/dashboard/check', route => route.fulfill({ status: 500, json: { message: 'Unexpected synthetic check' } }));
}
export const USAGE_PLAN: Plan = { id: 'p-usage-fixture', name: 'Usage fixture', slug: 'usage-fixture', repoPath: 'C:\\fixtures\\usage repo', baseBranch: 'main', createdAt: Date.now() - 30 * 86400000 };
export function usageRuns(): { tasks: Task[]; runs: Record<string, Run[]> } {
  const now = Date.now();
  const make = (id: string, agent: Run['agent'], age: number, input: number | null, output: number | null): [Task, Run] => {
    const start = now - age;
    const task: Task = { id: `t-${id}`, planId: USAGE_PLAN.id, title: `Usage ${id}`, agent, status: 'done', branch: `fleet/${id}`, worktreePath: `C:\\fixtures\\${id}`, checkCmd: null, createdAt: start, finishedAt: start + 1000 };
    const run: Run = { id: `r-${id}`, taskId: task.id, attempt: 1, agent, brief: 'Synthetic usage', note: null, status: 'done', pid: null, exitCode: 0, startedAt: start, endedAt: start + 1000, durationMs: 1000, checkPassed: true, inputTokens: input, outputTokens: output, costUsd: null, finalMessage: null, errorCategory: null, sessionId: null };
    return [task, run];
  };
  const records = [make('recent', 'codex', 60000, 1200, 800), make('unknown', 'qodercli', 120000, null, null), make('old', 'opencode', 15 * 86400000, 2400, 1600)];
  return { tasks: records.map(([task]) => task), runs: Object.fromEntries(records.map(([task, run]) => [task.id, [run]])) };
}
export function usageSnapshot(populated = true): ObservabilitySnapshot {
  const now = Date.now();
  const resource = { sampledAt: now, scope: 'server-only' as const, cpuPercent: 5, memoryBytes: 120 * 1024 ** 2, peakMemoryBytes: 140 * 1024 ** 2, cpuTimeMs: 8000, processCount: 2, gpu: null };
  const coverage = { tokenRuns: populated ? 2 : 0, costRuns: 0, creditRuns: 0, totalRuns: populated ? 3 : 0 };
  const metrics = { runCount: 1, inputTokens: 1200, outputTokens: 800, costUsd: null, credits: null, reportedCredits: null, coverage };
  return { sampledAt: now, app: { version: '2.5.0', platform: 'win32', nodeVersion: '24.0.0', uptimeMs: 120000, desktop: false }, resource,
    history: populated ? [resource, { ...resource, sampledAt: now + 5000, cpuPercent: 10, memoryBytes: 130 * 1024 ** 2 }] : [],
    system: { totalMemoryBytes: 32 * 1024 ** 3, usedMemoryBytes: 16 * 1024 ** 3, logicalCpuCount: 16 },
    usage: { planId: null, taskCount: populated ? 3 : 0, runCount: populated ? 3 : 0, completedRuns: populated ? 3 : 0, inputTokens: populated ? 3600 : null, outputTokens: populated ? 2400 : null, costUsd: null, credits: null, reportedCredits: null, coverage, resources: { measuredRuns: populated ? 1 : 0, peakMemoryBytes: populated ? resource.peakMemoryBytes : null, observedCpuTimeMs: populated ? 8000 : null } },
    plans: [], runs: [], activeJobs: [], usageByTool: [],
    usageByModel: populated ? [{ ...metrics, agent: 'codex', model: 'gpt-fixture', provider: 'openai', attribution: 'reported' }, { ...metrics, agent: 'qodercli', model: 'qfmodel', provider: null, attribution: 'configured' }, { ...metrics, agent: 'opencode', model: null, provider: null, attribution: 'unattributed' }] : [], notes: [] };
}
