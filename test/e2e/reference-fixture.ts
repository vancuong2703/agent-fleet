import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import type { DashboardCheck, DashboardSnapshot } from '../../shared/dashboard.js';
import type { AgentStats } from '../../web/src/api.js';
import type { Task, Run } from '../../shared/types.js';

/** Synthetic values from the OpenCode reference, used only for visual comparisons. */
export async function referenceFixture(page: Page) {
  const cache = JSON.parse(readFileSync('test/e2e/fixtures/dashboard-checks.json', 'utf8')) as { checks: Record<string, DashboardCheck> };
  const checks = structuredClone(cache.checks);
  const time = Date.parse('2026-11-04T11:41:50Z');
  checks.codex.currentModel = { id: 'gpt-6.1-sol', label: 'gpt-6.1-sol', effort: 'high' };
  checks.codex.checkedAt = time;
  checks.codex.quotaWindows = [
    { group: 'Codex', window: '5h', remainingPct: 22, unit: 'percent', resetAt: '1h 49m' },
    { group: 'Codex', window: 'week', remainingPct: 34, unit: 'percent', resetAt: '6 days' },
  ];
  checks.qodercli.currentModel = { id: 'qwen3.8-flash', label: 'Qwen3.8-Flash' };
  checks.qodercli.quotaWindows = [{ group: 'Plan credits', window: 'plan', unit: 'credits', remainingPct: 62, used: 760, limit: 2000, resetAt: 'renews 28/11' }];
  checks.agy.currentModel = { id: 'gemini-4-argon', label: 'Gemini 4 Argon' };
  checks.agy.quotaWindows = checks.agy.quotaWindows?.filter(row => row.group.includes('ARGON')).map(row => ({ ...row, remainingPct: row.window === '5h' ? 91 : 78, resetAt: row.window === '5h' ? '2h' : '4 days' }));
  checks.opencode.currentModel = { id: 'harbor-pool/deepseek-v4.1-flash:free', label: 'harbor-pool/…flash:free' };
  checks.opencode.quotaWindows = [{ group: 'Token allowance', window: 'plan', unit: 'tokens', remainingPct: 54, used: 1560000, limit: 3400000, resetAt: '3 days' }];
  const tools: DashboardSnapshot['tools'] = (['codex', 'qodercli', 'agy', 'opencode'] as const).map(agent => ({ agent, title: { codex: 'Codex', qodercli: 'Qoder CLI', agy: 'Antigravity (AGY)', opencode: 'OpenCode' }[agent], installed: true, configuredBin: null, lastCheck: checks[agent], suggestions: [{ id: 'status', command: '/status', label: 'Status', context: 'interactive', description: 'Read CLI status' }] }));
  const stats: AgentStats[] = [
    { agent: 'codex', runs: 128, avgDurationMs: 39800, successRate: .964, retryRate: .02, mergeRate: .9, costUsd: null },
    { agent: 'qodercli', runs: 74, avgDurationMs: 46500, successRate: .918, retryRate: .05, mergeRate: .88, costUsd: null },
    { agent: 'agy', runs: 96, avgDurationMs: 36200, successRate: .942, retryRate: .01, mergeRate: .86, costUsd: null },
    { agent: 'opencode', runs: 203, avgDurationMs: 54300, successRate: .885, retryRate: .05, mergeRate: .9, costUsd: null },
  ];
  const titles = ['Add jobs page', 'Refactor quota parser', 'Fix context overflow', 'Write e2e tests', 'Migrate auth store', 'Docs: web demo'];
  const agents: Task['agent'][] = ['codex', 'qodercli', 'agy', 'opencode', 'codex', 'qodercli'];
  const statuses: Task['status'][] = ['running', 'done', 'merged', 'queued', 'failed', 'taken_over'];
  const tasks: Task[] = titles.map((title, index) => ({ id: `t-ref-${4821 - index}`, planId: 'p-reference', title, agent: agents[index], status: statuses[index], branch: `fleet/reference/${index}`, worktreePath: `C:\\fixture\\worktrees\\${index}`, checkCmd: 'node check.cjs', createdAt: Date.now() - index * 300000, finishedAt: index ? Date.now() : null }));
  const runs: Run[] = tasks.map((task, index) => ({ id: `r-ref-${index}`, taskId: task.id, agent: task.agent, attempt: 1, brief: `Build ${task.title}. Keep the scope small and run the check.`, note: null, status: task.status === 'merged' ? 'done' : task.status as Run['status'], pid: null, exitCode: index ? 0 : null, startedAt: task.createdAt, endedAt: task.finishedAt, durationMs: index ? 42000 : null, checkPassed: index ? true : null, inputTokens: 120000 + index * 1000, outputTokens: 3000, costUsd: null, finalMessage: null, errorCategory: null, sessionId: null }));
  await page.route('**/api/dashboard', route => route.fulfill({ json: { generatedAt: time, tools, terminalSessions: [] } }));
  await page.route('**/api/stats**', route => route.fulfill({ json: stats }));
  await page.route('**/api/plans', route => route.fulfill({ json: [{ id: 'p-reference', name: 'agent-fleet', slug: 'agent-fleet', repoPath: 'C:\\fixture', baseBranch: 'main', createdAt: time }] }));
  await page.route(/\/api\/tasks(?:\?.*)?$/, route => route.fulfill({ json: tasks }));
  await page.route(/\/api\/tasks\/t-ref-\d+\/runs$/, route => route.fulfill({ json: runs.filter(run => route.request().url().includes(run.taskId)) }));
  await page.route(/\/api\/runs\/r-ref-\d+\/events(?:\?.*)?$/, route => { const id = /r-ref-\d+/.exec(route.request().url())![0]; return route.fulfill({ json: [{ runId: id, seq: 1, ts: time, event: { kind: 'message', text: 'plan: 1 step · 2 files\nread source and inspect the reference\ncheck: npx tsc --noEmit → OK\nreview: 0 blockers, 2 nits' } }] }); });
  await page.route(/\/api\/tasks\/t-ref-\d+\/diff$/, route => route.fulfill({ json: { files: [{ path: 'web/src/ui/Jobs.tsx', added: 46, removed: 0 }], patch: 'diff --git a/web/src/ui/Jobs.tsx b/web/src/ui/Jobs.tsx\n--- a/web/src/ui/Jobs.tsx\n+++ b/web/src/ui/Jobs.tsx\n@@ -0,0 +1 @@\n+export const reference = true;\n' } }));
  return { tools, stats, tasks };
}
