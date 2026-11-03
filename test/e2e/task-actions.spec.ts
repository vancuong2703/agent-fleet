import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { setTheme } from './nav-helpers.js';
import type { Plan, Task, TaskResult } from '../../shared/types.js';

let repoPath: string;
test.beforeEach(async ({ page }) => {
  const directory = process.env.FLEET_DATA_DIR!;
  const token = (await readFile(path.join(directory, 'token'), 'utf8')).trim();
  repoPath = (await readFile(path.join(directory, 'repo-path'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.locator('.connection')).toHaveAttribute('title', 'Đã kết nối');
});

async function selectedTask(page: Page, title: string, brief = 'Task action regression', wait = true): Promise<Task> {
  const planResponse = await page.request.post('/api/plans', { data: { name: title, repoPath } });
  const plan = await planResponse.json() as Plan;
  const taskResponse = await page.request.post('/api/tasks', { data: { planId: plan.id, agent: 'fake', title, brief, checkCmd: 'exit 0' } });
  expect(taskResponse.ok()).toBeTruthy();
  const task = await taskResponse.json() as Task;
  if (wait) {
    const response = await page.request.post('/api/wait', { data: { ids: [task.id], timeoutMs: 10_000 } });
    expect((await response.json() as TaskResult[])[0]?.task.status).toBe('done');
  }
  await page.getByRole('button', { name: 'Công việc', exact: true }).click();
  await page.getByRole('button', { name: title, exact: false }).click();
  return task;
}

test('confirmation starts on cancel, traps Tab in both directions, closes with Escape and restores its opener', async ({ page }) => {
  await selectedTask(page, 'Accessible confirmation');
  const opener = page.getByRole('button', { name: 'Merge', exact: true });
  await expect(opener).toBeEnabled();
  await opener.click();
  const dialog = page.getByRole('dialog');
  const cancel = dialog.getByRole('button', { name: 'Huỷ bỏ', exact: true });
  const confirm = dialog.getByRole('button', { name: 'Merge', exact: true });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test('destructive action lives in an accessible overflow menu and backdrop cannot dismiss it', async ({ page }) => {
  await selectedTask(page, 'Destructive confirmation');
  const overflow = page.getByRole('button', { name: 'Thao tác khác', exact: true });
  await overflow.focus();
  await page.keyboard.press('ArrowDown');
  const discard = page.getByRole('menuitem', { name: 'Huỷ công việc…', exact: true });
  await expect(discard).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(overflow).toBeFocused();
  await overflow.click();
  await discard.click();
  const dialog = page.getByRole('dialog', { name: 'Xoá công việc này?' });
  await expect(dialog.getByRole('button', { name: 'Xoá worktree và thay đổi', exact: true })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Huỷ bỏ', exact: true })).toBeFocused();
  await page.locator('.modal-overlay').click({ position: { x: 3, y: 3 } });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(overflow).toBeFocused();
});

test('focus containment recalculates when dialog controls become disabled', async ({ page }) => {
  await selectedTask(page, 'Dynamic confirmation focus');
  await page.getByRole('button', { name: 'Merge', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('button').evaluateAll(buttons => buttons.forEach(button => { (button as HTMLButtonElement).disabled = true; }));
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog).toBeFocused();
  await page.getByRole('button', { name: 'Công việc', exact: true }).evaluate(element => (element as HTMLButtonElement).focus());
  await expect(dialog).toBeFocused();
  await dialog.locator('button').evaluateAll(buttons => buttons.forEach(button => { (button as HTMLButtonElement).disabled = false; }));
  await expect(dialog.getByRole('button', { name: 'Huỷ bỏ', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
});

test('an empty completed worktree disables Merge with a visible keyboard-accessible explanation', async ({ page }) => {
  await selectedTask(page, 'No changes to merge', '[[slow]]');
  const merge = page.getByRole('button', { name: 'Merge', exact: true });
  await expect(merge).toBeDisabled();
  await expect(merge).toHaveAttribute('title', 'Không có thay đổi để Merge.');
  await expect(page.getByRole('tooltip')).toHaveText('Không có thay đổi để Merge.');
  await page.locator('.merge-control').focus();
  await expect(page.locator('.merge-control')).toBeFocused();
});

test('a pending confirmation keeps focus contained and restores the re-enabled opener after completion', async ({ page }) => {
  await selectedTask(page, 'Pending confirmation focus');
  let release!: () => void;
  const responseReady = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/tasks/*/merge', async route => {
    await responseReady;
    await route.fulfill({ json: { ok: false, reason: 'dirty' } });
  });
  const opener = page.getByRole('button', { name: 'Merge', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  try {
    await dialog.getByRole('button', { name: 'Merge', exact: true }).click();
    await expect(dialog).toHaveAttribute('aria-busy', 'true');
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
  } finally { release(); }
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.getByRole('alert')).toContainText('Repo gốc còn thay đổi chưa commit');
});

test('a failed diff read explains why Merge is disabled and can be retried', async ({ page }) => {
  let failed = true;
  await page.route('**/api/tasks/*/diff', route => failed
    ? route.fulfill({ status: 503, json: { error: 'temporary' } })
    : route.fulfill({ json: { files: [{ path: 'fake.txt', added: 1, removed: 0 }], patch: '' } }));
  await selectedTask(page, 'Merge diff retry');
  const merge = page.getByRole('button', { name: 'Merge', exact: true });
  await expect(merge).toBeDisabled();
  await expect(merge).toHaveAttribute('title', 'Không đọc được thay đổi, chưa thể Merge.');
  failed = false;
  await page.getByRole('button', { name: 'Tải lại thay đổi', exact: true }).click();
  await expect(merge).toBeEnabled();
});

test('running terminal takeover explains that the agent stops and can be cancelled', async ({ page }) => {
  const task = await selectedTask(page, 'Running takeover confirmation', '[[hang]]', false);
  try {
    const opener = page.getByRole('button', { name: 'Tiếp quản terminal', exact: true });
    await expect(opener).toBeVisible();
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Tiếp quản terminal?' });
    await expect(dialog).toContainText('Agent đang chạy sẽ bị dừng');
    await expect(dialog.getByRole('button', { name: 'Huỷ bỏ', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    const result = await (await page.request.get(`/api/tasks/${task.id}`)).json() as TaskResult;
    expect(result.task.status).toBe('running');
  } finally {
    await page.request.post(`/api/tasks/${task.id}/stop`, { data: {} });
  }
});

test('actions and confirmation fit three widths in both themes', async ({ page }) => {
  test.setTimeout(60_000);
  await selectedTask(page, 'Action layout matrix');
  // The inspector's narrow-screen default belongs to T11; hide it using the existing control.
  await page.getByRole('button', { name: 'Ẩn hoặc hiện thông tin workspace', exact: true }).click();
  for (const width of [375, 768, 1440]) for (const theme of ['light', 'dark'] as const) {
    await page.setViewportSize({ width, height: 900 });
    await setTheme(page, theme);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Thao tác khác', exact: true }).click();
    const menuBox = (await page.getByRole('menu').boundingBox())!;
    expect(menuBox.x).toBeGreaterThanOrEqual(0);
    expect(menuBox.x + menuBox.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `.tmp/ui-qa/t10/actions-${width}-${theme}.png`, fullPage: true });
    await page.getByRole('menuitem', { name: 'Huỷ công việc…', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    await page.screenshot({ path: `.tmp/ui-qa/t10/confirm-${width}-${theme}.png`, fullPage: true });
    await page.keyboard.press('Escape');
  }
});
