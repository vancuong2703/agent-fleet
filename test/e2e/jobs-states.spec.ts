import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { openJobs } from './jobs-fixture.js';
import { referenceFixture } from './reference-fixture.js';

const size = { width: 1440, height: 800 };
const WORKTREE_FILE = 'C:\\fixture\\layout\\0\\src\\file-0.ts';

function diffPayload(count: number) {
  const files = Array.from({ length: count }, (_, index) => ({ path: `src/file-${index}.ts`, added: 2, removed: 1 }));
  const patch = files.map(file => `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n@@ -1,2 +1,3 @@\n keep\n-old\n+new\n+newer\n`).join('');
  return { files, patch };
}

// ── diff sections ───────────────────────────────────────────────────────────

test('a large diff opens only the first file and keeps every file header scannable', async ({ page }) => {
  await openJobs(page, size, { diffFiles: 8, events: 5 });
  await page.getByRole('tab', { name: /Changes/ }).click();
  await expect(page.locator('.diff-section')).toHaveCount(8);
  await expect(page.locator('.diff-body')).toHaveCount(1);
  const heads = await page.evaluate(() => [...document.querySelectorAll('.diff-section-head')].map(head => { const box = head.getBoundingClientRect(); return box.top >= 0 && box.bottom <= innerHeight; }));
  expect(heads.every(Boolean), JSON.stringify(heads)).toBe(true);
  await page.getByRole('button', { name: 'Expand all' }).click();
  await expect(page.locator('.diff-body')).toHaveCount(8);
  await page.getByRole('button', { name: 'Collapse all' }).click();
  await expect(page.locator('.diff-body')).toHaveCount(0);
  await page.locator('.diff-toggle').nth(3).click();
  await expect(page.locator('.diff-body')).toHaveCount(1);
});

test('a small diff opens every file and the file headers are sticky', async ({ page }) => {
  await openJobs(page, { width: 1440, height: 640 }, { diffFiles: 3, events: 5 });
  await page.getByRole('tab', { name: /Changes/ }).click();
  await expect(page.locator('.diff-body')).toHaveCount(3);
  expect(await page.locator('.diff-section-head').first().evaluate(el => getComputedStyle(el).position)).toBe('sticky');
});

test('open files stay open across polling refreshes, and the Log tab does not poll the diff', async ({ page }) => {
  let diffCalls = 0;
  await openJobs(page, size, { events: 5, setup: async p => {
    await p.route(/\/api\/tasks\/t-lay-\d+\/diff$/, route => { diffCalls += 1; return route.fulfill({ json: diffPayload(6) }); });
  } });
  // The selected job is running: on the Log tab the diff is read once, for the tab count.
  await expect(page.getByRole('tab', { name: 'Changes (6)' })).toBeVisible();
  const afterSelect = diffCalls;
  await page.waitForTimeout(4500);
  expect(diffCalls, 'no polling on the Log tab').toBe(afterSelect);
  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.locator('.diff-toggle').nth(4).click();
  await expect(page.locator('.diff-body')).toHaveCount(2);
  const before = diffCalls;
  await expect.poll(() => diffCalls, { timeout: 9000 }).toBeGreaterThan(before);
  await expect(page.locator('.diff-body')).toHaveCount(2);
});

// ── reveal ──────────────────────────────────────────────────────────────────

test('outside the desktop app the reveal control copies worktree + relative path', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openJobs(page, size, { diffFiles: 1, events: 5 });
  await page.getByRole('tab', { name: /Changes/ }).click();
  const copy = page.getByRole('button', { name: 'Copy file path' });
  await expect(copy).toBeEnabled();
  await copy.click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(WORKTREE_FILE);
});

async function fakeDesktop(page: Page, outcome: { ok: boolean; error?: string }) {
  await page.addInitScript(result => {
    const callbacks = new Set<(event: MessageEvent) => void>();
    (window as unknown as { __FLEET_DESKTOP__: unknown }).__FLEET_DESKTOP__ = { version: '2.5.0', theme: 'light' };
    (window as unknown as { chrome: unknown }).chrome = { webview: {
      postMessage(message: { requestId: string }) { for (const callback of callbacks) callback(new MessageEvent('message', { data: { type: 'fleet:native-result', requestId: message.requestId, ...result } })); },
      addEventListener(_type: string, callback: (event: MessageEvent) => void) { callbacks.add(callback); },
      removeEventListener(_type: string, callback: (event: MessageEvent) => void) { callbacks.delete(callback); },
    } };
  }, outcome);
}

test('a failed reveal shows the bare message and offers the copy path action', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fakeDesktop(page, { ok: false, error: 'Explorer is not responding' });
  await openJobs(page, size, { diffFiles: 1, events: 5 });
  await page.getByRole('tab', { name: /Changes/ }).click();
  await page.getByRole('button', { name: 'Reveal file in Explorer' }).click();
  const alert = page.locator('.diff-file-error');
  await expect(alert).toContainText('Explorer is not responding');
  await expect(alert).not.toContainText('Error:');
  await alert.getByRole('button', { name: 'Copy path' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(WORKTREE_FILE);
});

// ── load failures ───────────────────────────────────────────────────────────

test('a failing history keeps the job list, flags that task, and retry fixes only it', async ({ page }) => {
  let broken = true;
  await openJobs(page, size, { events: 5, noLog: true, setup: async p => {
    await p.route(/\/api\/runs(?:\?.*)?$/, route => route.fulfill({ status: 404, body: 'not found' }));
    await p.route(/\/api\/tasks\/t-lay-\d+\/runs$/, route => {
      const id = /t-lay-\d+/.exec(route.request().url())![0];
      if (id === 't-lay-100') return broken ? route.fulfill({ status: 500, body: 'history down' }) : route.fulfill({ json: [{ id: 'r-lay-100', taskId: id, agent: 'codex', attempt: 1, brief: 'x', note: null, status: 'running', pid: null, exitCode: null, startedAt: Date.now(), endedAt: null, durationMs: null, checkPassed: null, inputTokens: null, outputTokens: null, costUsd: null, finalMessage: null, errorCategory: null, sessionId: null }] });
      return route.fulfill({ json: [] });
    });
  } });
  await expect(page.locator('.jobs-page .count')).toContainText('18 / 18');
  await expect(page.locator('.jobs-page .rows tr .row-flag.bad')).toHaveCount(1);
  const warning = page.locator('.run-history-warning');
  await expect(warning).toContainText('history down');
  broken = false;
  await warning.getByRole('button', { name: 'Retry' }).click();
  await expect(warning).toHaveCount(0);
  await expect(page.locator('.jobs-page .rows tr .row-flag.bad')).toHaveCount(0);
});

test('one GET /api/runs supplies the history and no per-task request is made', async ({ page }) => {
  let perTask = 0;
  await openJobs(page, size, { events: 5, setup: async p => {
    await p.route(/\/api\/tasks\/t-lay-\d+\/runs$/, route => { perTask += 1; return route.fulfill({ json: [] }); });
  } });
  await expect(page.locator('.progress-line')).toBeVisible();
  expect(perTask).toBe(0);
});

test('when the task list fails the count is a dash, and db_corrupt shows its message with the check command', async ({ page }) => {
  await page.setViewportSize(size);
  await page.addInitScript(() => { localStorage.setItem('fleet.language', 'en'); localStorage.setItem('fleet.theme', 'light'); });
  await referenceFixture(page);
  await page.route(/\/api\/tasks(?:\?.*)?$/, route => route.fulfill({ status: 503, json: { error: 'db_corrupt', message: 'Database file is damaged' } }));
  const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await page.getByRole('button', { name: 'Jobs', exact: true }).click();
  const alert = page.locator('.jobs-page [role="alert"]');
  await expect(alert).toContainText('Database file is damaged');
  await expect(alert).toContainText('fleet db check');
  await expect(page.locator('.jobs-page .count')).toContainText('— / —');
});

// ── stuck runs ──────────────────────────────────────────────────────────────

function observation(rows: Array<{ runId: string; taskId: string; silentForMs: number | null; currentActivity: string }>) {
  const resource = { sampledAt: Date.now(), scope: 'server-only', cpuPercent: 1, memoryBytes: 1e8, peakMemoryBytes: 1e8, cpuTimeMs: 1, processCount: 1, gpu: null };
  const usage = { planId: null, taskCount: 0, runCount: 0, completedRuns: 0, inputTokens: null, outputTokens: null, costUsd: null, credits: null, reportedCredits: null, coverage: { tokenRuns: 0, costRuns: 0, creditRuns: 0, totalRuns: 0 }, resources: { measuredRuns: 0, peakMemoryBytes: null, observedCpuTimeMs: null } };
  return { sampledAt: Date.now(), app: { version: 'x', platform: 'win32', nodeVersion: 'x', uptimeMs: 1, desktop: false }, resource, history: [], system: { totalMemoryBytes: 8e9, usedMemoryBytes: 4e9, logicalCpuCount: 8 }, usage, plans: [], runs: rows.map(row => ({ ...row, agent: 'codex', status: 'running', model: null, modelSource: 'unknown', models: [], lastEventAt: null, inputTokens: null, outputTokens: null, costUsd: null, credits: null, reportedCredits: null, usageByModel: [], resources: null })), activeJobs: [], usageByTool: [], usageByModel: [], notes: [] };
}

test('a running job quiet for over two minutes turns to warning on the row and in the detail', async ({ page }) => {
  await openJobs(page, size, { events: 5, setup: async p => { await p.route('**/api/observability**', route => route.fulfill({ json: observation([{ runId: 'r-lay-100', taskId: 't-lay-100', silentForMs: 5 * 60_000 + 3000, currentActivity: 'Running vitest' }]) })); } });
  const line = page.locator('.progress-line');
  await expect(line).toContainText('Running vitest');
  await expect(line).toContainText('Last progress 5 min ago');
  await expect(line).toHaveClass(/stalled/);
  await expect(page.locator('.jobs-page .rows tr .row-flag.warn')).toHaveCount(1);
});

test('a fresh run is not flagged, and a missing measurement reads "No data yet" instead of 0', async ({ page }) => {
  await openJobs(page, size, { events: 5, setup: async p => { await p.route('**/api/observability**', route => route.fulfill({ json: observation([{ runId: 'r-lay-100', taskId: 't-lay-100', silentForMs: null, currentActivity: '' }]) })); } });
  const line = page.locator('.progress-line');
  await expect(line).toContainText('No data yet');
  await expect(line).not.toContainText('0 min');
  await expect(line).not.toHaveClass(/stalled/);
  await expect(page.locator('.jobs-page .rows tr .row-flag.warn')).toHaveCount(0);
});
