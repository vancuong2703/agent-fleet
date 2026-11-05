import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';
import type { Run, StoredEvent, Task } from '../../shared/types.js';
import { referenceFixture } from './reference-fixture.js';

export const TASK_COUNT = 18;
const EVENT_COUNT = 3000;
const LONG_LINE = 'worker output: '.padEnd(230, 'abcdefghij ');

export interface Options { diffFiles?: number; events?: number; setup?: (page: Page) => Promise<void>; rows?: number; noLog?: boolean }

export async function mockLongJobs(page: Page, options: Options = {}) {
  const now = Date.now();
  const statuses: Task['status'][] = ['running', 'done', 'merged', 'queued', 'failed', 'taken_over'];
  const tasks: Task[] = Array.from({ length: TASK_COUNT }, (_, index) => ({
    id: `t-lay-${100 + index}`, planId: 'p-reference', title: `Layout job ${index}`, agent: (['codex', 'qodercli', 'agy', 'opencode'] as const)[index % 4],
    status: statuses[index % statuses.length], branch: `fleet/layout/${index}`, worktreePath: `C:\\fixture\\layout\\${index}`, checkCmd: null, createdAt: now - index * 60_000, finishedAt: index ? now : null,
  }));
  const runs: Run[] = tasks.map((task, index) => ({
    id: `r-lay-${100 + index}`, taskId: task.id, agent: task.agent, attempt: 1, brief: 'Layout fixture', note: null, status: task.status === 'merged' ? 'done' : task.status as Run['status'], pid: null,
    exitCode: null, startedAt: task.createdAt, endedAt: null, durationMs: null, checkPassed: null, inputTokens: null, outputTokens: null, costUsd: null, finalMessage: null, errorCategory: null, sessionId: null,
  }));
  const events = (runId: string): StoredEvent[] => Array.from({ length: options.events ?? EVENT_COUNT }, (_, index) => ({ runId, seq: index + 1, ts: now + index, event: { kind: 'message', text: `${index} ${LONG_LINE}` } }));
  const fileCount = options.diffFiles ?? 1;
  const files = Array.from({ length: fileCount }, (_, index) => ({ path: `src/file-${index}.ts`, added: 2, removed: 1 }));
  const patch = files.map(file => `diff --git a/${file.path} b/${file.path}\n--- a/${file.path}\n+++ b/${file.path}\n@@ -1,2 +1,3 @@\n keep\n-old\n+new\n+newer\n`).join('');
  await page.route(/\/api\/tasks(?:\?.*)?$/, route => route.fulfill({ json: tasks }));
  await page.route(/\/api\/runs(?:\?.*)?$/, route => route.fulfill({ json: runs }));
  await page.route(/\/api\/tasks\/t-lay-\d+\/runs$/, route => route.fulfill({ json: runs.filter(run => route.request().url().includes(run.taskId)) }));
  await page.route(/\/api\/runs\/r-lay-\d+\/events(?:\?.*)?$/, route => route.fulfill({ json: events(/r-lay-\d+/.exec(route.request().url())![0]) }));
  await page.route(/\/api\/tasks\/t-lay-\d+\/diff$/, route => route.fulfill({ json: { files, patch } }));
  return { tasks, runs };
}

export async function openJobs(page: Page, size: { width: number; height: number }, options: Options = {}) {
  await page.setViewportSize(size);
  await page.addInitScript(() => { localStorage.setItem('fleet.language', 'en'); localStorage.setItem('fleet.theme', 'light'); });
  await referenceFixture(page);
  const mocks = await mockLongJobs(page, options);
  await options.setup?.(page);
  const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await page.getByRole('button', { name: 'Jobs', exact: true }).click();
  await expect(page.locator('.jobs-page .rows tr')).toHaveCount(options.rows ?? TASK_COUNT);
  if (!options.noLog) await expect(page.locator('.log-line').first()).toBeVisible();
  return mocks;
}

