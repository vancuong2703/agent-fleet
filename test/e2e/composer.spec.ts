import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
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

/** UI-originated plan/task writes only; `page.request` calls bypass this listener. */
function trackWrites(page: Page) {
  const writes = { plans: [] as Array<Record<string, unknown>>, tasks: [] as Array<Record<string, unknown>> };
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    const pathname = new URL(request.url()).pathname;
    if (pathname === '/api/plans') writes.plans.push(request.postDataJSON() as Record<string, unknown>);
    else if (pathname === '/api/tasks') writes.tasks.push(request.postDataJSON() as Record<string, unknown>);
  });
  return writes;
}

function fakeTask(repoPath: string, body: Record<string, unknown>) {
  return {
    id: `task-${body.agent}-${Date.now()}`, planId: body.planId, title: body.title, agent: body.agent,
    status: 'queued', branch: 'fleet/composer', worktreePath: repoPath, checkCmd: null, createdAt: Date.now(), finishedAt: null,
  };
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
    return route.fulfill({ json: fakeTask(repoPath, body) });
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

test('composer remembers the last agent and plan, including when the composer is cancelled', async ({ page }) => {
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

  await page.route('**/api/tasks', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    return route.fulfill({ json: fakeTask(repoPath, route.request().postDataJSON() as Record<string, unknown>) });
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

  // Choosing and then cancelling keeps the newer selection for the next open.
  const cancelled = await createPlan(page, 'Cancelled plan', repoPath);
  await dialog.getByLabel('Dự án / plan', { exact: true }).selectOption(cancelled.id);
  await dialog.getByLabel('Agent', { exact: true }).selectOption('qodercli');
  await dialog.getByRole('button', { name: 'Huỷ', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('fleet.composer')))
    .toBe(JSON.stringify({ agent: 'qodercli', planId: cancelled.id }));

  dialog = await openComposer(page);
  await expect(dialog.getByLabel('Dự án / plan', { exact: true })).toHaveValue(cancelled.id);
  await expect(dialog.getByLabel('Agent', { exact: true })).toHaveValue('qodercli');
});

test('repository validation runs on blur, sends the canonical unquoted root and never creates a plan early', async ({ page }) => {
  await login(page);
  const repoPath = await repoPathFromData();
  const planBodies: Array<Record<string, unknown>> = [];
  const taskBodies: Array<Record<string, unknown>> = [];
  await page.route('**/api/plans', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    planBodies.push(route.request().postDataJSON() as Record<string, unknown>);
    const response = await route.fetch();
    expect(response.ok()).toBeTruthy();
    return route.fulfill({ response });
  });
  await page.route('**/api/tasks', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    const body = route.request().postDataJSON() as Record<string, unknown>;
    taskBodies.push(body);
    return route.fulfill({ json: fakeTask(repoPath, body) });
  });

  const dialog = await openComposer(page);
  await dialog.getByLabel('Dự án / plan', { exact: true }).selectOption('__new__');
  await dialog.getByLabel('Tên plan', { exact: true }).fill('Quoted path plan');
  const field = dialog.getByLabel('Đường dẫn Git repository', { exact: true });

  // Explorer's "Copy as path" adds surrounding quotes. Blur must verify the
  // path against Git (canonical root) without creating a plan.
  await field.fill(`"${repoPath}"`);
  await field.blur();
  await expect(dialog.locator('#composer-repo-status')).toContainText('Git repo hợp lệ');
  await expect(field).not.toHaveAttribute('aria-invalid', 'true');
  expect(planBodies).toHaveLength(0);
  expect(taskBodies).toHaveLength(0);

  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(dialog.locator('.composer-steps [aria-current="step"]')).toHaveText('2. Giao việc');
  await dialog.getByLabel('Tên công việc', { exact: true }).fill('Quoted path task');
  await dialog.getByLabel('Nội dung giao việc', { exact: true }).fill('Quoted path smoke');
  await dialog.getByRole('button', { name: 'Giao việc', exact: true }).click();
  await expect(dialog).toHaveCount(0);

  expect(planBodies).toHaveLength(1);
  expect(planBodies[0]!.repoPath).toBe(repoPath);
  expect(String(planBodies[0]!.repoPath)).not.toContain('"');
  expect(taskBodies).toHaveLength(1);
});

test('invalid, missing and non-Git paths lead to Vietnamese errors, never to a plan or task', async ({ page }) => {
  await login(page);
  const writes = trackWrites(page);
  const nonGit = await mkdtemp(path.join(os.tmpdir(), 'agent-fleet-e2e-nongit-'));
  const missing = path.join(os.tmpdir(), `agent-fleet-e2e-missing-${Date.now()}`);
  try {
    const dialog = await openComposer(page);
    await dialog.getByLabel('Dự án / plan', { exact: true }).selectOption('__new__');
    await dialog.getByLabel('Tên plan', { exact: true }).fill('Never created plan');
    const field = dialog.getByLabel('Đường dẫn Git repository', { exact: true });
    const next = dialog.getByRole('button', { name: 'Tiếp tục', exact: true });
    const status = dialog.locator('#composer-repo-status');
    const step = dialog.locator('.composer-steps [aria-current="step"]');

    const cases: Array<[string, RegExp]> = [
      ['Projects/my-app', /tuyệt đối/],
      [missing, /không phải thư mục làm việc Git/],
      [nonGit, /không phải thư mục làm việc Git/],
    ];
    for (const [value, message] of cases) {
      await field.fill(value);
      await field.blur();
      await expect(status).toContainText(message);
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      await next.click();
      await expect(step).toHaveText('1. Dự án');
      await expect(dialog.getByLabel('Tên công việc', { exact: true })).toHaveCount(0);
    }

    await page.waitForTimeout(300);
    expect(writes.plans).toHaveLength(0);
    expect(writes.tasks).toHaveLength(0);
  } finally {
    await rm(nonGit, { recursive: true, force: true });
  }
});

test('reusing a path from an existing plan still requires a live Git verdict before step 2', async ({ page }) => {
  await login(page);
  const repoPath = await repoPathFromData();
  // The plan exists, so the local hint recognises the path; the API still decides.
  await createPlan(page, 'Known repo plan', repoPath);
  const writes = trackWrites(page);
  await page.route('**/api/repositories/validate', (route) => route.fulfill({
    json: { valid: false, repoPath: null, branch: null, message: 'Đường dẫn không phải thư mục làm việc Git hoặc không tồn tại.' },
  }));

  const dialog = await openComposer(page);
  await dialog.getByLabel('Dự án / plan', { exact: true }).selectOption('__new__');
  await dialog.getByLabel('Tên plan', { exact: true }).fill('Plan lookup is not a verdict');
  const field = dialog.getByLabel('Đường dẫn Git repository', { exact: true });
  await field.fill(repoPath);
  await field.blur();

  await expect(dialog.locator('#composer-repo-status')).toContainText('không phải thư mục làm việc Git');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(dialog.locator('.composer-steps [aria-current="step"]')).toHaveText('1. Dự án');
  expect(writes.plans).toHaveLength(0);
  expect(writes.tasks).toHaveLength(0);
});

test('a delayed validation for an old path cannot certify the current path or allow Next', async ({ page }) => {
  await login(page);
  const repoPath = await repoPathFromData();
  const plan = await createPlan(page, 'Slow validation plan', repoPath);
  const writes = trackWrites(page);
  let releaseSlow: (() => void) | null = null;
  await page.route('**/api/repositories/validate', async (route) => {
    const body = route.request().postDataJSON() as { repoPath: string };
    if (/slow-a/i.test(body.repoPath)) {
      await new Promise<void>((resolve) => { releaseSlow = resolve; });
      return route.fulfill({ json: { valid: true, repoPath: 'C:\\e2e\\slow-a', branch: 'main', message: 'Kho Git hợp lệ.' } });
    }
    return route.fulfill({ json: { valid: false, repoPath: null, branch: null, message: 'Đường dẫn không phải thư mục làm việc Git hoặc không tồn tại.' } });
  });

  const dialog = await openComposer(page);
  await dialog.getByLabel('Dự án / plan', { exact: true }).selectOption(plan.id);
  await dialog.getByLabel('Dự án / plan', { exact: true }).selectOption('__new__');
  await dialog.getByLabel('Tên plan', { exact: true }).fill('Race plan');
  const field = dialog.getByLabel('Đường dẫn Git repository', { exact: true });
  const status = dialog.locator('#composer-repo-status');

  await field.fill('C:\\e2e\\slow-a');
  await field.blur();
  await expect(status).toContainText('Đang kiểm tra Git repo');
  await expect.poll(() => releaseSlow !== null).toBe(true);

  await field.fill('C:\\e2e\\fast-b');
  await field.blur();
  await expect(status).toContainText('không phải thư mục làm việc Git');
  await expect(field).toHaveAttribute('aria-invalid', 'true');

  // The stale request resolves valid after the newer path did; it must be ignored.
  releaseSlow!();
  await page.waitForTimeout(500);
  await expect(status).toContainText('không phải thư mục làm việc Git');
  await expect(status).not.toContainText('hợp lệ');
  await expect(field).toHaveAttribute('aria-invalid', 'true');

  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(dialog.locator('.composer-steps [aria-current="step"]')).toHaveText('1. Dự án');
  expect(writes.plans).toHaveLength(0);
  expect(writes.tasks).toHaveLength(0);
});

test('a failed validation offers a retry and never certifies the repository', async ({ page }) => {
  await login(page);
  const repoPath = await repoPathFromData();
  const plan = await createPlan(page, 'Retry validation plan', repoPath);
  const writes = trackWrites(page);
  let attempts = 0;
  await page.route('**/api/repositories/validate', (route) => {
    attempts += 1;
    // First blur and the blur caused by clicking Next both fail; only the
    // explicit "Thử lại" click may succeed.
    if (attempts <= 2) return route.fulfill({ status: 500, body: 'server unavailable' });
    return route.fulfill({ json: { valid: true, repoPath: 'C:\\e2e\\retry-repo', branch: 'main', message: 'Kho Git hợp lệ.' } });
  });

  const dialog = await openComposer(page);
  await dialog.getByLabel('Dự án / plan', { exact: true }).selectOption(plan.id);
  await dialog.getByLabel('Dự án / plan', { exact: true }).selectOption('__new__');
  await dialog.getByLabel('Tên plan', { exact: true }).fill('Retry plan');
  const field = dialog.getByLabel('Đường dẫn Git repository', { exact: true });
  const status = dialog.locator('#composer-repo-status');

  await field.fill('C:\\e2e\\retry-repo');
  await field.blur();
  await expect(status).toContainText('Không kiểm tra được Git repo');
  await expect(status).not.toContainText('hợp lệ');
  await expect(dialog.getByRole('button', { name: 'Thử lại', exact: true })).toBeVisible();
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(dialog.locator('.composer-steps [aria-current="step"]')).toHaveText('1. Dự án');
  expect(writes.plans).toHaveLength(0);

  await dialog.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(status).toContainText('Git repo hợp lệ');
  await dialog.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await expect(dialog.locator('.composer-steps [aria-current="step"]')).toHaveText('2. Giao việc');
  expect(attempts).toBeGreaterThanOrEqual(2);
  expect(writes.plans).toHaveLength(0);
  expect(writes.tasks).toHaveLength(0);
});
