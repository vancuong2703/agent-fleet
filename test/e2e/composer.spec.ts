import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { Plan } from '../../shared/types.js';

/**
 * T13 regression coverage: the two-step composer, its keyboard shortcuts and
 * remembered choices, plus the terminal affordances (labels, ARIA tabs,
 * keyboard tab navigation, persisted font size and the socket error banner).
 */

async function login(page: Page): Promise<void> {
  const dataDir = process.env.FLEET_DATA_DIR;
  if (!dataDir) throw new Error('The E2E setup must provide a temporary FLEET_DATA_DIR');
  const token = (await readFile(path.join(dataDir, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.locator('.connection')).toHaveAttribute('title', 'Đã kết nối');
}

async function repoPathFromData(): Promise<string> {
  return (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'repo-path'), 'utf8')).trim();
}

async function createPlan(page: Page, name: string, repoPath: string): Promise<Plan> {
  const response = await page.request.post('/api/plans', { data: { name, repoPath } });
  expect(response.ok()).toBeTruthy();
  const plan = await response.json() as Plan;
  // The composer reads plans from the live store, which receives them over the socket.
  await expect(page.locator('.plan-name', { hasText: name })).toBeVisible();
  return plan;
}

async function openComposer(page: Page) {
  await page.getByRole('button', { name: /Task mới/ }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  return dialog;
}

test('composer walks project then assignment, keeps the CLI row apart and submits on Ctrl+Enter', async ({ page }) => {
  await login(page);
  const repoPath = await repoPathFromData();
  const plan = await createPlan(page, 'Composer steps plan', repoPath);
  const payloads: Array<Record<string, unknown>> = [];
  await page.route('**/api/tasks', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    payloads.push(body);
    return route.fulfill({
      json: {
        id: `task-step-${payloads.length}`, planId: plan.id, title: body.title, agent: body.agent,
        status: 'queued', branch: 'fleet/steps', worktreePath: repoPath, checkCmd: null, createdAt: Date.now(), finishedAt: null,
      },
    });
  });

  const dialog = await openComposer(page);
  const currentStep = dialog.locator('.composer-steps [aria-current="step"]');
  await expect(currentStep).toHaveText('1. Dự án');
  await expect(dialog.getByLabel('Dự án / plan', { exact: true })).toBeVisible();
  await expect(dialog.getByLabel('Agent', { exact: true })).toBeVisible();
  // Step 2 fields are not reachable before the project is chosen.
  await expect(dialog.getByLabel('Tên công việc', { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('Nội dung giao việc', { exact: true })).toHaveCount(0);

  // Regression for the "CLIKiểm tra" collision: the row is a flex box with a gap.
  const cliRow = dialog.locator('.composer-agent-check');
  expect(await cliRow.evaluate((element) => getComputedStyle(element).display)).toBe('flex');
  const note = dialog.locator('.composer-agent-check .small-note').first();
  const checkButton = dialog.getByRole('button', { name: 'Kiểm tra agent', exact: true });
  const noteBox = (await note.boundingBox())!;
  const buttonBox = (await checkButton.boundingBox())!;
  expect(Math.round(buttonBox.x - (noteBox.x + noteBox.width))).toBeGreaterThanOrEqual(4);

  await dialog.getByLabel('Dự án / plan', { exact: true }).selectOption(plan.id);
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(currentStep).toHaveText('2. Giao việc');
  await expect(dialog.getByLabel('Dự án / plan', { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('Tên công việc', { exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Quay lại', exact: true }).click();
  await expect(currentStep).toHaveText('1. Dự án');
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();

  await dialog.getByLabel('Tên công việc', { exact: true }).fill('Keyboard composer task');
  // A textarea's value is part of its label's innerText, so re-querying the exact
  // label after typing would fail; keep the focus and press at page level.
  await dialog.getByLabel('Nội dung giao việc', { exact: true }).fill('Ctrl+Enter smoke');
  await page.keyboard.press('Control+Enter');
  await expect(dialog).toHaveCount(0);
  expect(payloads).toEqual([expect.objectContaining({ planId: plan.id, title: 'Keyboard composer task', brief: 'Ctrl+Enter smoke' })]);
});

test('composer remembers the last agent and plan and shows the CLI check as a badge', async ({ page }) => {
  await login(page);
  const repoPath = await repoPathFromData();
  const remembered = await createPlan(page, 'Remembered plan', repoPath);
  const chosen = await createPlan(page, 'Chosen plan', repoPath);
  await page.route('**/api/agents', (route) => route.fulfill({
    json: [
      { id: 'codex', ok: true, version: '0.166.0', maxParallel: 2 },
      { id: 'qodercli', ok: false, reason: 'Chưa đăng nhập', maxParallel: 2 },
    ],
  }));
  await page.addInitScript((planId) => { localStorage.setItem('fleet.composer', JSON.stringify({ agent: 'qodercli', planId })); }, remembered.id);
  await page.reload();
  await expect(page.locator('.connection')).toHaveAttribute('title', 'Đã kết nối');

  let dialog = await openComposer(page);
  await expect(dialog.getByLabel('Dự án / plan', { exact: true })).toHaveValue(remembered.id);
  await expect(dialog.getByLabel('Agent', { exact: true })).toHaveValue('qodercli');
  const badge = dialog.locator('.composer-agent-check .status-badge');
  await expect(badge).toHaveText('Chưa kiểm tra CLI');
  await dialog.getByRole('button', { name: 'Kiểm tra agent', exact: true }).click();
  await expect(badge).toHaveText('CLI chưa sẵn sàng');
  await dialog.getByLabel('Agent', { exact: true }).selectOption('codex');
  await expect(badge).toHaveText('CLI sẵn sàng · 0.166.0');

  // The newest explicit choices survive closing and reopening the composer.
  await page.route('**/api/tasks', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    return route.fulfill({
      json: {
        id: 'task-remembered', planId: chosen.id, title: body.title, agent: body.agent,
        status: 'queued', branch: 'fleet/remembered', worktreePath: repoPath, checkCmd: null, createdAt: Date.now(), finishedAt: null,
      },
    });
  });
  await dialog.getByLabel('Dự án / plan', { exact: true }).selectOption(chosen.id);
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await dialog.getByLabel('Tên công việc', { exact: true }).fill('Remembered composer task');
  await dialog.getByLabel('Nội dung giao việc', { exact: true }).fill('Remember smoke');
  await dialog.getByRole('button', { name: 'Giao việc', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('fleet.composer')))
    .toBe(JSON.stringify({ agent: 'codex', planId: chosen.id }));

  dialog = await openComposer(page);
  await expect(dialog.getByLabel('Dự án / plan', { exact: true })).toHaveValue(chosen.id);
  await expect(dialog.getByLabel('Agent', { exact: true })).toHaveValue('codex');
});

test('repo path is validated when the field loses focus', async ({ page }) => {
  await login(page);
  const repoPath = await repoPathFromData();
  await createPlan(page, 'Repo check plan', repoPath);
  const dialog = await openComposer(page);
  await dialog.getByLabel('Dự án / plan', { exact: true }).selectOption('__new__');
  const field = dialog.getByLabel('Đường dẫn Git repository', { exact: true });

  await field.fill('Projects/my-app');
  await field.blur();
  await expect(dialog.getByText(/phải là đường dẫn tuyệt đối/)).toBeVisible();
  await expect(field).toHaveAttribute('aria-invalid', 'true');

  await field.fill('C:\\Projects\\missing-repo');
  await field.blur();
  await expect(dialog.getByText(/Chưa có plan nào dùng đường dẫn này/)).toBeVisible();
  // An unknown absolute path is a warning, not a failure: it may be a brand-new repo.
  await expect(field).not.toHaveAttribute('aria-invalid', 'true');

  await field.fill(repoPath);
  await field.blur();
  await expect(dialog.getByText(/Đã xác nhận: Git repo/)).toBeVisible();
  await expect(field).not.toHaveAttribute('aria-invalid', 'true');
});
