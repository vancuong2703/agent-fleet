import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * T6 — dải "Nên dùng ngay". Dữ liệu là tổng hợp, `/api/dashboard/check` không
 * được gọi, và clipboard được thay bằng bộ ghi trong trang để test không phụ
 * thuộc quyền của trình duyệt.
 */

const checkedAt = Date.parse('2026-11-03T11:40:12Z');

const baseCheck = (over: Record<string, unknown> = {}) => ({
  checkedAt,
  status: 'ready',
  version: '1.0.0',
  account: { state: 'authenticated', label: '***@example.com', source: 'cli status', reason: null },
  quota: { remaining: null, unit: null, resetAt: null, source: 'cli status', reason: null },
  credits: { remaining: null, unit: null, resetAt: null, source: 'cli status', reason: null },
  probes: [{ command: 'status', ok: true, exitCode: 0, summary: 'ok' }],
  ...over,
});

const win = (group: string, remainingPct: number) => ({ group, window: 'week', remainingPct, unit: 'percent', resetAt: null });
const offer = (id: string, label: string, multiplier: number) => ({ id, label, multiplier, source: 'pty' });

const tools = [
  {
    agent: 'qodercli', title: 'Qoder', configuredBin: null, installed: true, suggestions: [],
    lastCheck: baseCheck({
      plan: { name: 'Pro Trial', tier: 'trial', source: 'status -o json' },
      models: [offer('qwen-flash', 'Qwen3.8-Flash', 0), offer('ds-flash', 'DeepSeek-Flash', 0.1)],
      quotaWindows: [win('Credit gói', 62)],
    }),
  },
  { agent: 'agy', title: 'Antigravity', configuredBin: null, installed: true, suggestions: [], lastCheck: baseCheck({ quotaWindows: [win('GEMINI 4 ARGON', 78)] }) },
  { agent: 'codex', title: 'Codex', configuredBin: null, installed: true, suggestions: [], lastCheck: baseCheck({ quotaWindows: [win('Codex', 22)] }) },
  { agent: 'opencode', title: 'OpenCode', configuredBin: null, installed: true, suggestions: [], lastCheck: baseCheck({ quotaWindows: [win('OpenCode', 67)] }) },
];

const snapshot = { generatedAt: checkedAt, tools, terminalSessions: [] };

async function login(page: Page) {
  const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.getByRole('heading', { name: 'Bảng điều khiển', exact: true })).toBeVisible();
}

async function stubDashboard(page: Page) {
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: snapshot }));
  await page.route('**/api/plans', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/tasks', (route) => route.fulfill({ json: [] }));
}

test('ba gợi ý cộng một cảnh báo; bấm gợi ý model thì sao chép lệnh --model', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async (text: string) => { (window as unknown as { __copied?: string }).__copied = text; } },
    });
  });
  await stubDashboard(page);
  await login(page);

  const strip = page.locator('.dash-picks');
  await expect(strip).toContainText('Nên dùng ngay');
  await expect(strip.locator('button.dash-pick')).toHaveCount(3);
  await expect(strip.locator('.dash-pick.is-warn')).toHaveCount(1);
  // Gợi ý thứ 4 (OpenCode 67%) bị cắt; cảnh báo là Codex 22%.
  await expect(strip).not.toContainText('OpenCode');
  await expect(strip.locator('.dash-pick.is-warn')).toContainText('Codex');
  await expect(strip.locator('.dash-pick.is-warn')).toContainText('22%');
  // Cảnh báo không phải nút: không có hành động ẩn nào để bấm.
  await expect(strip.locator('.dash-pick.is-warn')).not.toHaveAttribute('role', 'button');

  await page.getByRole('button', { name: 'Sao chép lệnh --model qwen-flash' }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { __copied?: string }).__copied)).toBe('--model qwen-flash');
  const toast = page.locator('.dash-toast');
  await expect(toast).toContainText('Đã sao chép --model qwen-flash');
  await expect(toast).toHaveClass(/dash-toast-success/);
  // Sao chép không được điều hướng khỏi dashboard.
  await expect(page.getByRole('heading', { name: 'Bảng điều khiển', exact: true })).toBeVisible();
});

test('bấm gợi ý tool mở CLI đúng agent như nút Mở CLI', async ({ page }) => {
  const launched: unknown[] = [];
  await stubDashboard(page);
  await page.route('**/api/terminal-sessions', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    launched.push(route.request().postDataJSON());
    await route.fulfill({
      json: {
        id: 'session-t6-1', agent: 'agy', title: 'Antigravity · workspace', cwd: 'C:\\workspace',
        source: 'workspace', planId: null, taskId: null, createdAt: Date.now(),
        connected: false, reconnectGraceMs: 300_000,
      },
    });
  });
  await login(page);

  await page.getByRole('button', { name: 'Mở CLI Antigravity' }).click();
  await expect.poll(() => launched.length).toBe(1);
  expect(launched[0]).toEqual({ agent: 'agy' });
  await expect(page.getByRole('heading', { name: 'Terminal', exact: true })).toBeVisible();
});
