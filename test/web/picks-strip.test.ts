import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test, vi } from 'vitest';
import type { DashboardCheck, DashboardTool, ModelOffer, QuotaWindow } from '../../shared/dashboard.js';
import type { Pick } from '../../shared/dashboard-picks.js';
import type { CliWorkspace } from '../../web/src/cli-workspace.js';
import { Dashboard } from '../../web/src/components/Dashboard.js';
import {
  PicksStrip,
  activatePick,
  pickCommand,
  visiblePicks,
} from '../../web/src/components/dashboard/PicksStrip.js';
import { dashboardStrings } from '../../web/src/strings.js';

const S = dashboardStrings.picks;
const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

/** Strips tags and entities so assertions read what a person actually sees. */
function textOf(markup: string): string {
  const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ' };
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#x27|#39);/g, (entity) => entities[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

// ── fixtures (synthetic; no real account data) ──────────────────────────────

const win = (group: string, remainingPct: number | null): QuotaWindow => ({
  group, window: 'week', remainingPct, unit: 'percent', resetAt: null,
});

const offer = (id: string, label: string, multiplier: number | null): ModelOffer => ({
  id, label, multiplier, source: 'pty',
});

const baseCheck = (over: Partial<DashboardCheck> = {}): DashboardCheck => ({
  checkedAt: Date.parse('2026-11-03T11:40:12Z'),
  status: 'ready',
  version: '1.0.0',
  account: { state: 'authenticated', label: '***@example.com', source: 'cli status', reason: null },
  quota: { remaining: null, unit: null, resetAt: null, source: 'cli status', reason: null },
  credits: { remaining: null, unit: null, resetAt: null, source: 'cli status', reason: null },
  probes: [{ command: 'status', ok: true, exitCode: 0, summary: 'ok' }],
  ...over,
});

function tool(agent: DashboardTool['agent'], title: string, lastCheck: DashboardCheck | null): DashboardTool {
  return { agent, title, configuredBin: null, installed: lastCheck !== null, lastCheck, suggestions: [] };
}

const qoderCheck = baseCheck({
  plan: { name: 'Pro Trial', tier: 'trial', source: 'status -o json' },
  models: [offer('qwen-flash', 'Qwen3.8-Flash', 0), offer('ds-flash', 'DeepSeek-Flash', 0.1)],
  quotaWindows: [win('Credit gói', 62)],
});

const agyCheck = baseCheck({
  plan: { name: 'Antigravity Pro', tier: 'pro', source: '/usage' },
  quotaWindows: [win('GEMINI 4 ARGON', 78)],
});

const codexCheck = baseCheck({
  plan: { name: 'ChatGPT Plus', tier: 'plus', source: 'auth.json' },
  quotaWindows: [win('Codex', 22)],
});

const opencodeCheck = baseCheck({
  plan: { name: 'BYOK', tier: 'byok', source: 'opencode.json' },
  quotaWindows: [win('OpenCode', 67)],
});

const richTools = [
  tool('qodercli', 'Qoder', qoderCheck),
  tool('agy', 'Antigravity', agyCheck),
  tool('codex', 'Codex', codexCheck),
  tool('opencode', 'OpenCode', opencodeCheck),
];

const recommendationsIn = (markup: string) => [...markup.matchAll(/data-kind="(model|tool)"/g)].map((match) => match[1]);

function stubCli(over: Partial<CliWorkspace> = {}): CliWorkspace {
  return {
    snapshot: { generatedAt: 0, tools: richTools, terminalSessions: [] },
    checking: null, launching: null, selection: 'workspace', setSelection: () => {},
    activeId: null, message: null, messageKind: 'info', setMessage: () => {},
    check: async () => {}, launch: async () => {}, select: () => {}, close: async () => {},
    checkAll: async () => {}, checkingAll: { active: false, done: 0, total: 0, agent: null },
    ...over,
  } as unknown as CliWorkspace;
}

// ── 3 kịch bản render bắt buộc ──────────────────────────────────────────────

describe('PicksStrip', () => {
  test('kịch bản 1: hiện tối đa 3 gợi ý cộng đúng 1 cảnh báo', () => {
    const markup = html(createElement(PicksStrip, { tools: richTools, cli: stubCli() }));
    const text = textOf(markup);

    expect(text).toContain(S.title);
    expect(recommendationsIn(markup)).toHaveLength(3);
    expect((markup.match(/data-kind="warning"/g) ?? [])).toHaveLength(1);

    // Thứ tự do rankPicks quyết định: model miễn phí, model rẻ, rồi tool còn hạn mức cao nhất.
    expect(text).toContain('Qwen3.8-Flash');
    expect(text).toContain('DeepSeek-Flash');
    expect(text).toContain('Antigravity');
    // Gợi ý thứ 4 (OpenCode 67%) bị cắt, cảnh báo là Codex 22%.
    expect(text).not.toContain('OpenCode');
    expect(text).toContain('Codex');
    expect(text).toContain('22%');
  });

  test('kịch bản 2: mọi tool đều cạn thì chỉ còn cảnh báo, không có gợi ý giả', () => {
    const exhausted = [
      tool('codex', 'Codex', baseCheck({ quotaWindows: [win('Codex', 0)], models: [offer('free', 'Model miễn phí', 0)] })),
      tool('agy', 'Antigravity', baseCheck({ quotaWindows: [win('GEMINI', 0)] })),
    ];
    const markup = html(createElement(PicksStrip, { tools: exhausted, cli: stubCli() }));
    const text = textOf(markup);

    expect(recommendationsIn(markup)).toEqual([]);
    expect((markup.match(/data-kind="warning"/g) ?? [])).toHaveLength(1);
    expect(markup).not.toContain('dash-pick-go');
    expect(text).not.toContain('Model miễn phí');
    expect(text).toContain('0%');
  });

  test('kịch bản 3: chưa kiểm tra thì hướng dẫn, không bịa gợi ý hay lệnh model', () => {
    const unchecked = [
      tool('codex', 'Codex', null),
      tool('qodercli', 'Qoder', null),
    ];
    const markup = html(createElement(PicksStrip, { tools: unchecked, cli: stubCli() }));

    expect(textOf(markup)).toContain(S.empty);
    expect(recommendationsIn(markup)).toEqual([]);
    expect(markup).not.toContain('data-kind="warning"');
    expect(markup).not.toContain('--model');
  });

  test('visiblePicks lọc gợi ý và cảnh báo trước khi cắt', () => {
    const { picks, warning } = visiblePicks(richTools);
    expect(picks).toHaveLength(3);
    expect(picks.every((pick) => pick.kind !== 'warning')).toBe(true);
    expect(warning).toMatchObject({ kind: 'warning', agent: 'codex' });
  });

  test('không lộ token hay giá trị rỗng ra màn hình', () => {
    const markup = html(createElement(PicksStrip, { tools: richTools, cli: stubCli() }));
    expect(markup).not.toMatch(/eyJ|sk-/);
    expect(textOf(markup)).not.toMatch(/undefined|NaN|Infinity|\[object Object\]/);
  });
});

// ── Bấm vào một gợi ý ───────────────────────────────────────────────────────

describe('bấm vào gợi ý', () => {
  const modelPick: Pick = {
    id: 'opencode:model:tokenharbor/deepseek-v4.1-flash-1017',
    agent: 'opencode', kind: 'model', label: 'DeepSeek V4.1 Flash 1017',
    modelId: 'tokenharbor/deepseek-v4.1-flash-1017', remainingPct: null,
    reason: 'OpenCode đang sẵn sàng, hệ số 0.05×.',
  };
  const toolPick: Pick = {
    id: 'agy:quota', agent: 'agy', kind: 'tool', label: 'Antigravity',
    remainingPct: 78, reason: 'Hạn mức thấp nhất còn 78%.',
  };
  const warningPick: Pick = {
    id: 'codex:warning', agent: 'codex', kind: 'warning', label: 'Codex',
    remainingPct: 22, reason: 'Hạn mức thấp nhất còn 22%.',
  };

  test('gợi ý model sao chép đúng lệnh --model và báo thành công', async () => {
    expect(pickCommand(modelPick)).toBe('--model tokenharbor/deepseek-v4.1-flash-1017');
    const copy = vi.fn(async () => true);
    const notify = vi.fn();
    const launch = vi.fn();
    const outcome = await activatePick(modelPick, { copy, launch, notify });

    expect(outcome).toBe('copy');
    expect(copy).toHaveBeenCalledWith('--model tokenharbor/deepseek-v4.1-flash-1017');
    expect(launch).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith(S.copied('--model tokenharbor/deepseek-v4.1-flash-1017'), 'success');
  });

  test('gợi ý tool mở đúng CLI của agent đó', async () => {
    expect(pickCommand(toolPick)).toBeNull();
    const launch = vi.fn(async () => {});
    const copy = vi.fn(async () => true);
    const outcome = await activatePick(toolPick, { copy, launch });

    expect(outcome).toBe('launch');
    expect(launch).toHaveBeenCalledWith('agy');
    expect(copy).not.toHaveBeenCalled();
  });

  test('cảnh báo không kích hoạt hành động nào', async () => {
    const launch = vi.fn();
    const copy = vi.fn();
    const notify = vi.fn();
    expect(pickCommand(warningPick)).toBeNull();
    expect(await activatePick(warningPick, { copy, launch, notify })).toBe('none');
    expect(launch).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  test('sao chép thất bại vẫn cho người dùng thấy lệnh cần dùng', async () => {
    const notify = vi.fn();
    const outcome = await activatePick(modelPick, { copy: async () => { throw new Error('NotAllowedError'); }, launch: vi.fn(), notify });
    expect(outcome).toBe('copy-failed');
    expect(notify).toHaveBeenCalledWith(S.copyFailed('--model tokenharbor/deepseek-v4.1-flash-1017'), 'error');
  });

  test('pick model thiếu modelId không tạo lệnh rỗng', async () => {
    expect(pickCommand({ ...modelPick, modelId: undefined })).toBeNull();
    expect(await activatePick({ ...modelPick, modelId: '' }, { copy: vi.fn(), launch: vi.fn() })).toBe('none');
  });

  test('markup có nhãn hành động rõ cho từng loại gợi ý', () => {
    const markup = html(createElement(PicksStrip, { tools: richTools, cli: stubCli() }));
    expect(markup).toContain(`aria-label="${S.openCli('Antigravity')}"`);
    expect(markup).toContain(`aria-label="${S.copyModel('--model qwen-flash')}"`);
    expect(textOf(markup)).toContain(S.openCliShort);
    expect(textOf(markup)).toContain(S.copyShort);
  });
});

// ── Nối vào Dashboard ───────────────────────────────────────────────────────

describe('Dashboard có dải Nên dùng ngay', () => {
  test('dải nằm trước lưới thẻ và dùng chung dữ liệu snapshot', () => {
    const markup = html(createElement(Dashboard, { plans: [], tasks: [], cli: stubCli() }));
    expect(textOf(markup)).toContain(S.title);
    const stripAt = markup.indexOf('dash-picks');
    const gridAt = markup.indexOf('dash-grid');
    expect(stripAt).toBeGreaterThan(0);
    expect(stripAt).toBeLessThan(gridAt);
    expect(recommendationsIn(markup)).toHaveLength(3);
  });

  test('chưa có snapshot thì không dựng dải rỗng', () => {
    const markup = html(createElement(Dashboard, { plans: [], tasks: [], cli: stubCli({ snapshot: null }) }));
    expect(markup).not.toContain('dash-picks');
  });
});
