import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

/**
 * T5 — ToolCard v3. Toàn bộ dữ liệu là tổng hợp (không có tài khoản thật),
 * và `/api/dashboard/check` bị chặn lại nên không có CLI nào được khởi động.
 */
const shotDir = path.join('.tmp', 't5-qa');
mkdirSync(shotDir, { recursive: true });

const checkedAt = Date.parse('2026-11-03T11:40:12Z');

const baseCheck = (over: Record<string, unknown> = {}) => ({
  checkedAt,
  status: 'ready',
  version: '1.0.0',
  account: { state: 'authenticated', label: '***@example.com', source: 'cli status', reason: null },
  quota: { remaining: null, unit: null, resetAt: null, source: 'cli status', reason: 'CLI không expose quota' },
  credits: { remaining: null, unit: null, resetAt: null, source: 'cli status', reason: 'Không đọc được credit từ CLI' },
  probes: [{ command: 'status', ok: true, exitCode: 0, summary: 'ok' }],
  ...over,
});

const offer = (id: string, label: string, multiplier: number | null, extra: Record<string, unknown> = {}) => ({
  id, label, multiplier, source: 'pty', ...extra,
});

const qoderModels = [
  offer('qwen-flash', 'Qwen3.8-Flash', 0, { originalMultiplier: 0.1, promo: 'Đang giảm giá', contextTokens: 1_000_000 }),
  offer('ds-flash', 'DeepSeek-Flash', 0.1),
  offer('glm-flash', 'GLM-5.3-Flash', 0.2, { contextTokens: 200_000 }),
  offer('efficient', 'Efficient', 0.5),
  offer('kimi', 'Kimi-K3.1-Pro', 0.6, { contextTokens: 256_000 }),
  offer('ultimate', 'Ultimate', 3),
  ...['Auto', 'Fast', 'Cantus', 'Sonus', 'Qwen3.8-Max', 'GLM-5.3', 'DeepSeek-V4-Pro', 'Kimi-K2.8-Preview']
    .map((label) => offer(label.toLowerCase(), label, null, { source: 'cli' })),
];

const tools = [
  {
    agent: 'codex', title: 'Codex', configuredBin: null, installed: true, suggestions: [],
    lastCheck: baseCheck({
      version: '0.166.0',
      account: { state: 'authenticated', label: '***@gmail.com', source: 'login status', reason: null },
      plan: { name: 'ChatGPT Plus', tier: 'plus', source: 'auth.json' },
      currentModel: { id: 'gpt-test', label: 'GPT-6.1-Sol', effort: 'high' },
      quotaWindows: [
        { group: 'Codex', window: '5h', remainingPct: 22, unit: 'percent', resetAt: '20:30 hôm nay' },
        { group: 'Codex', window: 'week', remainingPct: 34, unit: 'percent', resetAt: '15:17, 04/11' },
      ],
    }),
  },
  {
    agent: 'qodercli', title: 'Qoder', configuredBin: null, installed: true, suggestions: [],
    lastCheck: baseCheck({
      version: '1.1.81',
      plan: { name: 'Pro Trial', tier: 'trial', renewsAt: '2026-11-28T12:00:00Z', source: 'status -o json' },
      currentModel: { id: 'Auto', label: 'Auto', effort: 'medium' },
      credits: { remaining: 1_240, unit: 'credits', resetAt: null, source: '/usage', reason: null },
      quotaWindows: [
        { group: 'Credit gói', window: 'plan', remainingPct: 62, used: 760, limit: 2_000, unit: 'credits', resetAt: '28/11' },
        { group: 'Credit bổ sung', window: 'plan', remainingPct: 69.4, used: 245, limit: 800, unit: 'credits', resetAt: null },
      ],
      models: qoderModels,
      highlights: ['Màn /model công bố 15 model nhưng chỉ đọc được 14 dòng giá.'],
    }),
  },
  {
    agent: 'agy', title: 'Antigravity', configuredBin: null, installed: true, suggestions: [],
    lastCheck: baseCheck({
      version: '1.4.12',
      plan: { name: 'Antigravity Pro', tier: 'pro', source: '/usage' },
      quotaWindows: [
        { group: 'GEMINI 4 ARGON', window: 'week', remainingPct: 78, unit: 'percent', resetAt: 'sau 4 ngày' },
        { group: 'GEMINI 4 ARGON', window: '5h', remainingPct: 91, unit: 'percent', resetAt: 'sau 2 giờ' },
        { group: 'GEMINI MODELS', window: 'week', remainingPct: 95, unit: 'percent', resetAt: null },
        { group: 'GEMINI MODELS', window: '5h', remainingPct: 100, unit: 'percent', resetAt: null },
        { group: 'CLAUDE AND GPT MODELS', window: '5h', remainingPct: 12, unit: 'percent', resetAt: 'sau 3 giờ 10 phút' },
        { group: 'CLAUDE AND GPT MODELS', window: 'week', remainingPct: 40, unit: 'percent', resetAt: null },
      ],
      credits: { remaining: 850, unit: 'credits', resetAt: null, source: '/credits', reason: null },
      models: [offer('gemini-4-argon-medium', 'Gemini 4 Argon (Medium)', null, { source: 'cli' })],
    }),
  },
  {
    agent: 'opencode', title: 'OpenCode', configuredBin: null, installed: true, suggestions: [],
    lastCheck: baseCheck({
      version: '2.2.5',
      account: { state: 'authenticated', label: 'BYOK · 4 provider', source: 'auth list', reason: null },
      plan: { name: 'BYOK', tier: 'byok', source: 'opencode.json' },
      currentModel: { id: 'tokenharbor/deepseek-v4.1-flash-1017', label: 'DeepSeek V4.1 Flash 1017' },
      quota: { remaining: null, unit: null, resetAt: null, source: 'opencode stats', reason: 'OpenCode không công bố hạn mức tổng' },
      models: [offer('tokenharbor/deepseek-v4.1-flash-1017', 'DeepSeek V4.1 Flash 1017', null, { provider: 'tokenharbor', contextTokens: 1_000_000, source: 'config' })],
      keyPools: [
        {
          name: 'harbor', total: 13, ok: 11, exhausted: 1, remainingPct: 74.3,
          limitLabel: 'Hạn 385K output / key / 7 ngày', resetAt: '2026-11-06T00:00:00.000Z',
          keys: [
            { label: '…ALPHA', status: 'ok', pct: 88.1 }, { label: '…BRAVO', status: 'ok', pct: 92 },
            { label: '…CHARLIE', status: 'low', pct: 33 }, { label: '…DELTA', status: 'ok', pct: 81 },
            { label: '…ECHO', status: 'ok', pct: 77 }, { label: '…FOXTROT', status: 'ok', pct: 69 },
            { label: '…GOLF', status: 'ok', pct: 74 }, { label: '…HOTEL', status: 'ok', pct: 70 },
            { label: '…INDIA', status: 'ok', pct: 66 }, { label: '…JULIET', status: 'ok', pct: 79 },
            { label: '…KILO', status: 'ok', pct: 73 }, { label: '…LIMA', status: 'low', pct: 41 },
            { label: '…MIKE', status: 'out', pct: 0 },
          ],
        },
        {
          name: 'routeway', total: 0, ok: 0, exhausted: 0, remainingPct: null,
          limitLabel: '200 request / ngày / key · pool không chạy', keys: [],
        },
      ],
    }),
  },
];

const snapshot = { generatedAt: Date.parse('2026-11-03T11:41:00Z'), tools, terminalSessions: [] };

async function login(page: Page) {
  const token = (await readFile(path.join(process.env.FLEET_DATA_DIR!, 'token'), 'utf8')).trim();
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.getByRole('heading', { name: 'Bảng điều khiển', exact: true })).toBeVisible();
}

/** Chặn mọi dữ liệu động: dashboard không được tự gọi CLI nào trong test. */
async function stubDashboard(page: Page, dashboard: unknown = snapshot) {
  await page.route('**/api/dashboard', (route) => route.fulfill({ json: dashboard as object }));
  await page.route('**/api/plans', (route) => route.fulfill({ json: [] }));
  await page.route('**/api/tasks', (route) => route.fulfill({ json: [] }));
}

const card = (page: Page, title: string) => page.locator('.tool-card', { hasText: title });

test('thẻ công cụ v3 hiển thị gói, cửa sổ nghẽn, credit, model và key pool', async ({ page }) => {
  await stubDashboard(page);
  await login(page);

  const codex = card(page, 'Codex');
  await expect(codex).toContainText('ChatGPT Plus');
  await expect(codex.locator('.tier-badge', { hasText: 'PLUS' })).toBeVisible();
  // Cửa sổ 5 giờ (22%) thấp hơn cửa sổ tuần (34%) → thanh phải là 22%, cửa sổ kia ghi nhỏ bên cạnh.
  await expect(codex.locator('.dash-meter[data-group="Codex"] .dash-bar')).toHaveAttribute('aria-valuenow', '22');
  await expect(codex.locator('.dash-meter[data-group="Codex"] .dash-meter-val')).toContainText('34%');
  await expect(codex.locator('.dash-meter[data-group="Codex"] .dash-bar')).toHaveClass(/bad/);

  const qoder = card(page, 'Qoder');
  await expect(qoder).toContainText('Pro Trial');
  await expect(qoder.locator('.tier-badge', { hasText: 'TRIAL' })).toBeVisible();
  await expect(qoder.locator('.dash-credit-big')).toContainText('1.240');
  await expect(qoder.locator('.dash-credit-big')).toContainText('2.000');
  await expect(qoder.locator('.dash-meter[data-group="Credit gói"] .dash-bar')).toHaveAttribute('aria-valuenow', '62');

  // Mặc định chỉ 6 dòng; 8 dòng còn lại nằm trong <details> đang đóng.
  await expect(qoder.locator('.dash-model-panel > .dash-models > .dash-model')).toHaveCount(6);
  await expect(qoder.locator('.dash-model').first()).toContainText('Qwen3.8-Flash');
  await expect(qoder.locator('.dash-mult.free')).toHaveCount(1);
  await expect(qoder.locator('.dash-more .dash-model').first()).not.toBeVisible();
  await qoder.locator('.dash-more summary').click();
  await expect(qoder.locator('.dash-more .dash-model').first()).toBeVisible();
  await expect(qoder.locator('.dash-model')).toHaveCount(qoderModels.length);
  // null xếp cuối: các dòng chưa rõ hệ số xuất hiện sau dòng đắt nhất.
  const order = await qoder.locator('.dash-model .dash-mname-text').allInnerTexts();
  expect(order.slice(0, 6)).toEqual(['Qwen3.8-Flash', 'DeepSeek-Flash', 'GLM-5.3-Flash', 'Efficient', 'Kimi-K3.1-Pro', 'Ultimate']);
  expect(order).toHaveLength(qoderModels.length);

  const agy = card(page, 'Antigravity');
  await expect(agy).toContainText('Claude and GPT models');
  await expect(agy.locator('.dash-meter[data-group="CLAUDE AND GPT MODELS"] .dash-bar')).toHaveAttribute('aria-valuenow', '12');
  await expect(agy.locator('.dash-meter[data-group="GEMINI 4 ARGON"] .dash-bar')).toHaveAttribute('aria-valuenow', '78');

  const opencode = card(page, 'OpenCode');
  await expect(opencode.locator('.dash-key')).toHaveCount(13);
  await expect(opencode.locator('.dash-key.is-out')).toHaveCount(1);
  await expect(opencode.locator('.dash-pool').filter({ hasText: 'routeway' })).toContainText('pool không chạy');
  // Pool tắt không phải lỗi: thanh ở trạng thái trống, không phải đỏ.
  await expect(opencode.locator('.dash-pool').filter({ hasText: 'routeway' }).locator('.dash-bar')).toHaveClass(/empty/);
});

test('Kiểm tra tất cả chạy tuần tự, có tiến độ, báo success bằng toast xanh', async ({ page }) => {
  const order: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  await stubDashboard(page);
  await page.route('**/api/dashboard/check', async (route) => {
    const agent = (route.request().postDataJSON() as { agent: string }).agent;
    order.push(agent);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((resolve) => setTimeout(resolve, 150));
    inFlight -= 1;
    const tool = tools.find((item) => item.agent === agent)!;
    route.fulfill({ json: { ...tool, lastCheck: { ...tool.lastCheck, checkedAt: Date.now() } } });
  });
  await login(page);

  await expect(page.locator('.dash-batch')).toHaveCount(0);
  await page.getByRole('button', { name: 'Kiểm tra tất cả' }).click();

  await expect(page.locator('.dash-batch')).toBeVisible();
  await expect(page.locator('.dash-batch-bar')).toHaveAttribute('aria-valuemax', '4');
  await expect(page.locator('.dash-batch-text').first()).toContainText('Codex');
  await expect(page.locator('.dash-check-all')).toBeDisabled();

  await expect.poll(() => order.length).toBe(4);
  // Không bao giờ có hai lệnh kiểm tra chạy đồng thời.
  expect(maxInFlight).toBe(1);
  expect(order).toEqual(['codex', 'qodercli', 'agy', 'opencode']);

  const toast = page.locator('.dash-toast-success');
  await expect(toast).toContainText('Đã kiểm tra 4/4 công cụ.');
  await expect(toast).not.toHaveClass(/banner-error/);
  await expect(page.locator('.dash-batch')).toHaveCount(0);
  // Toast thành công tự ẩn sau 3 giây.
  await expect(toast).toHaveCount(0, { timeout: 8_000 });
});

test('một công cụ lỗi không chặn các công cụ khác và báo bằng toast đỏ', async ({ page }) => {
  const order: string[] = [];
  await stubDashboard(page);
  await page.route('**/api/dashboard/check', (route) => {
    const agent = (route.request().postDataJSON() as { agent: string }).agent;
    order.push(agent);
    if (agent === 'qodercli') return route.fulfill({ status: 500, body: JSON.stringify({ message: 'Không đọc được trạng thái từ CLI.' }) });
    const tool = tools.find((item) => item.agent === agent)!;
    return route.fulfill({ json: tool });
  });
  await login(page);
  await page.getByRole('button', { name: 'Kiểm tra tất cả' }).click();

  await expect.poll(() => order.length).toBe(4);
  expect(order).toEqual(['codex', 'qodercli', 'agy', 'opencode']);
  const toast = page.locator('.dash-toast-error');
  await expect(toast).toContainText('Đã kiểm tra 3/4 công cụ · 1 công cụ lỗi: Qoder.');
  await expect(toast).toHaveAttribute('role', 'alert');
  await expect(toast.getByRole('button', { name: 'Thử lại toàn bộ' })).toBeVisible();
  // Lỗi thì phải còn đó để người dùng bấm thử lại, không tự ẩn.
  await page.waitForTimeout(3_500);
  await expect(toast).toBeVisible();
});

test('lỗi khi kiểm tra một công cụ vẫn hiện nổi bật kèm nút thử lại', async ({ page }) => {
  await stubDashboard(page);
  await page.route('**/api/dashboard/check', (route) => route.fulfill({ status: 500, body: JSON.stringify({ message: 'Không đọc được trạng thái từ CLI.' }) }));
  await login(page);

  await card(page, 'Codex').getByRole('button', { name: 'Kiểm tra Codex' }).click();
  const toast = page.locator('.dash-toast-error');
  await expect(toast).toContainText('Không đọc được trạng thái từ CLI.');
  await expect(toast).toHaveAttribute('role', 'alert');
});

test('thẻ có check lỗi hiển thị nút Thử lại cho từng khối', async ({ page }) => {
  const broken = {
    ...snapshot,
    tools: [{
      ...tools[0], installed: false,
      lastCheck: { ...tools[0].lastCheck, status: 'error', version: null, probes: [{ command: 'status', ok: false, exitCode: null, summary: 'PTY không phản hồi' }] },
    }],
  };
  await stubDashboard(page, broken);
  await login(page);

  const codex = card(page, 'Codex');
  await expect(codex.locator('.dash-panel[data-state="error"]').first()).toContainText('PTY không phản hồi');
  await expect(codex.getByRole('button', { name: 'Kiểm tra lại hạn mức của Codex' })).toBeVisible();
  await expect(codex).toContainText('Chưa tìm thấy CLI');
  expect(await codex.locator('.dash-panel[data-state="error"]').count()).toBeGreaterThanOrEqual(4);
});

test('chưa kiểm tra thì mọi khối nói chưa kiểm tra, không có số liệu giả', async ({ page }) => {
  const fresh = { ...snapshot, tools: tools.map((item) => ({ ...item, installed: false, lastCheck: null })) };
  await stubDashboard(page, fresh);
  await login(page);

  const qoder = card(page, 'Qoder');
  await expect(qoder.getByText('Chưa kiểm tra', { exact: true })).toBeVisible();
  expect(await qoder.locator('.dash-panel[data-state="unchecked"]').count()).toBe(4);
  await expect(qoder.locator('.dash-bar')).toHaveCount(0);
  await expect(qoder.locator('.dash-skeleton')).toHaveCount(0);

  // OpenCode luôn có thêm khối key pool nên có 5 khối.
  expect(await card(page, 'OpenCode').locator('.dash-panel[data-state="unchecked"]').count()).toBe(5);
});

test('lần kiểm tra đầu tiên hiển thị skeleton cho mọi khối', async ({ page }) => {
  const fresh = { ...snapshot, tools: [{ ...tools[0], installed: false, lastCheck: null }] };
  await stubDashboard(page, fresh);
  // Giữ lời kiểm tra đang chạy 2 giây để nhìn thấy trạng thái đang tải.
  await page.route('**/api/dashboard/check', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    route.fulfill({ json: tools[0] });
  });
  await login(page);

  const codex = card(page, 'Codex');
  await expect(codex.getByText('Chưa kiểm tra', { exact: true })).toBeVisible();
  await codex.getByRole('button', { name: 'Kiểm tra Codex' }).click();

  await expect(codex.locator('.dash-skeleton').first()).toBeVisible();
  await expect(codex.getByText('Chưa kiểm tra', { exact: true })).toHaveCount(0);
  await expect(codex.getByText('Chưa có dữ liệu')).toHaveCount(0);
  // Xong thì số liệu thật thay chỗ skeleton.
  await expect(codex).toContainText('ChatGPT Plus');
  await expect(codex.locator('.dash-skeleton')).toHaveCount(0);
});

test('Qoder không có cửa sổ hạn mức hiện "chưa có dữ liệu", không phải thẻ hỏng', async ({ page }) => {
  // CLI không expose quota: khối hạn mức phải nói chưa có dữ liệu chứ không
  // được vẽ thanh 0% hay trông như một lỗi.
  const sparse = {
    ...snapshot,
    tools: [{ ...tools[1], lastCheck: baseCheck({ version: '1.1.81', plan: { name: 'Pro Trial', tier: 'trial', source: 'status -o json' } }) }],
  };
  await stubDashboard(page, sparse);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);

  const qoder = card(page, 'Qoder');
  const quota = qoder.locator('.dash-panel').filter({ hasText: 'Hạn mức còn lại' });
  await expect(quota).toHaveAttribute('data-state', 'empty');
  await expect(quota).toContainText('Chưa có dữ liệu · CLI không expose quota');
  await expect(quota.locator('.dash-bar')).toHaveCount(0);
  await expect(qoder.locator('.dash-bar')).toHaveCount(0);
  await expect(qoder.locator('[aria-valuenow]')).toHaveCount(0);
  await expect(qoder.locator('.dash-panel[data-state="error"]')).toHaveCount(0);
  expect(await qoder.innerText()).not.toMatch(/\b0%/);
  // Khối credit vẫn giữ nhãn "chưa có dữ liệu" cho số dư.
  await expect(qoder.locator('.dash-panel').filter({ hasText: 'Tài khoản & credit' })).toContainText('Không đọc được credit từ CLI');

  await page.screenshot({ path: path.join(shotDir, 'dashboard-v3-1440-qoder-noquota.png'), animations: 'disabled' });
});

for (const theme of ['light', 'dark'] as const) {
  for (const width of [375, 768, 1440]) {
    test(`${theme} dashboard v3 chụp ở ${width}px và không cuộn ngang`, async ({ page }, testInfo) => {
      await stubDashboard(page);
      await page.setViewportSize({ width, height: 1000 });
      await login(page);
      await page.getByRole('button', { name: theme === 'light' ? 'Giao diện sáng' : 'Giao diện tối', exact: true }).click();
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

      const metrics = await page.evaluate(() => {
        const host = document.querySelector('.dashboard-host')!;
        const grid = document.querySelector('.dash-grid')!;
        const limit = host.clientWidth;
        const right = host.getBoundingClientRect().right;
        // Khi vỡ layout ở bản hẹp, nói rõ phần tử nào tràn để sửa được ngay.
        const label = (element: Element) => {
          const box = element.getBoundingClientRect();
          const name = `${element.tagName.toLowerCase()}${element.getAttribute('class') ? `.${element.getAttribute('class')!.trim().split(/\s+/).join('.')}` : ''}`;
          return `${name}:${Math.round(box.width)}px>${(element.textContent ?? '').trim().slice(0, 26)}`;
        };
        const offenders = [...document.querySelectorAll('.dashboard-page *')]
          .filter((element) => element.getBoundingClientRect().width > limit + 1 || element.getBoundingClientRect().right > right + 1)
          .slice(0, 6)
          .map(label);
        // Bộ kiểm tra này từng bỏ sót chữ tràn sang thẻ bên cạnh: phần tử phải
        // nằm gọn trong thẻ của nó, không chỉ trong toàn trang.
        const spills = [...document.querySelectorAll('.dash-card *')]
          .filter((element) => {
            const owner = element.closest('.dash-card')!;
            return element.getBoundingClientRect().right > owner.getBoundingClientRect().right + 1;
          })
          .slice(0, 6)
          .map(label);
        // Chân thẻ từng là chỗ vỡ đầu tiên: nhãn nút xuống hàng và nút tràn ra
        // ngoài thẻ. Mỗi nút phải nằm gọn trong thẻ của nó và chỉ một dòng.
        const footWrap: string[] = [];
        for (const owner of document.querySelectorAll('.dash-card')) {
          const box = owner.getBoundingClientRect();
          for (const btn of owner.querySelectorAll('.dash-card-foot .action-btn')) {
            const b = btn.getBoundingClientRect();
            const name = btn.getAttribute('aria-label') ?? 'nút';
            if (b.right > box.right + 1 || b.bottom > box.bottom + 1 || b.left < box.left - 1) {
              footWrap.push(`tràn-thẻ:${name}:${Math.round(b.width)}x${Math.round(b.height)}`);
            }
            if (b.height > 46) footWrap.push(`xuống-hàng:${name}:${Math.round(b.height)}`);
            if (btn.scrollWidth > btn.clientWidth + 1) footWrap.push(`cắt-chữ:${name}`);
          }
        }
        // Badge tier từng bị viên nhãn trạng thái che đè ở bản hẹp: hai ô này
        // không được chồng nhau trong bất kỳ độ rộng nào.
        const overlaps: string[] = [];
        for (const owner of document.querySelectorAll('.dash-card')) {
          const title = owner.querySelector('.dash-card-title h2');
          const status = owner.querySelector('.dash-status');
          if (!title || !status) continue;
          const a = title.getBoundingClientRect();
          const b = status.getBoundingClientRect();
          if (a.right > b.left + 1 && b.right > a.left + 1 && a.bottom > b.top + 1 && b.bottom > a.top + 1) {
            overlaps.push(`tiêu đề/chồng nhãn trạng thái:${Math.round(a.right)}>${Math.round(b.left)}`);
          }
        }
        return {
          page: document.documentElement.scrollWidth,
          viewport: window.innerWidth,
          hostFits: host.scrollWidth <= host.clientWidth,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
          hostWidth: limit,
          offenders,
          spills,
          footWrap,
          overlaps,
        };
      });
      expect(metrics.page, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.viewport);
      expect(metrics.hostFits, JSON.stringify(metrics)).toBe(true);
      expect(metrics.spills, JSON.stringify(metrics)).toEqual([]);
      expect(metrics.footWrap, JSON.stringify(metrics)).toEqual([]);
      expect(metrics.overlaps, JSON.stringify(metrics)).toEqual([]);
      // 375 px: một cột; 1440 px: hai cột như mockup.
      if (width === 375) expect(metrics.columns, JSON.stringify(metrics)).toBe(1);
      if (width === 1440) expect(metrics.columns, JSON.stringify(metrics)).toBe(2);

      await page.screenshot({ path: path.join(shotDir, `dashboard-v3-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
      await page.screenshot({ path: testInfo.outputPath(`dashboard-v3-${width}-${theme}.png`), fullPage: true, animations: 'disabled' });
    });
  }
}
