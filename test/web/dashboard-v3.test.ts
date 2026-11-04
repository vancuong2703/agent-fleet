import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import type {
  DashboardAgent,
  DashboardCheck,
  DashboardTool,
  KeyPool,
  ModelOffer,
  QuotaWindow,
} from '../../shared/dashboard.js';
import type { Plan, Task } from '../../shared/types.js';
import type { CliWorkspace } from '../../web/src/cli-workspace.js';
import { checkAllAgents } from '../../web/src/cli-workspace.js';
import {
  bottleneck,
  formatGroupName,
  groupQuotaWindows,
  meterTone,
  QuotaMeter,
} from '../../web/src/components/dashboard/QuotaMeter.js';
import {
  DEFAULT_MODEL_ROWS,
  formatContext,
  ModelOfferList,
  sortOffers,
} from '../../web/src/components/dashboard/ModelOfferList.js';
import { KeyPoolGrid, poolReason } from '../../web/src/components/dashboard/KeyPoolGrid.js';
import { CreditPanel } from '../../web/src/components/dashboard/CreditPanel.js';
import { PlanStrip } from '../../web/src/components/dashboard/PlanStrip.js';
import { Block, type BlockState } from '../../web/src/components/dashboard/blocks.js';
import { Dashboard } from '../../web/src/components/Dashboard.js';

const html = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);

/** Strips tags so assertions can talk about what a sighted user actually reads. */
function textOf(markup: string): string {
  const entities: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#39;': "'", '&nbsp;': ' ' };
  return markup
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(?:amp|lt|gt|quot|nbsp|#x27|#39);/g, (entity) => entities[entity] ?? entity)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Phần thân của một thẻ công cụ, để các assert về trạng thái không dính chữ ở đầu trang. */
function cardOf(markup: string, agent: string): string {
  const start = markup.indexOf(`data-tool="${agent}"`);
  if (start < 0) return '';
  const next = markup.indexOf('data-tool="', start + 1);
  return textOf(markup.slice(start, next < 0 ? markup.length : next));
}

const skeletonCount = (markup: string) => (markup.match(/dash-skeleton/g) ?? []).length;

// ── fixtures (synthetic; no real account data) ──────────────────────────────

const win = (group: string, slot: QuotaWindow['window'], remainingPct: number | null, extra: Partial<QuotaWindow> = {}): QuotaWindow => ({
  group, window: slot, remainingPct, unit: 'percent', resetAt: null, ...extra,
});

const codexWindows: QuotaWindow[] = [
  win('Codex', '5h', 22, { resetAt: '20:30 hôm nay' }),
  win('Codex', 'week', 34, { resetAt: '15:17, 04/11' }),
];

const agyWindows: QuotaWindow[] = [
  win('GEMINI 4 ARGON', 'week', 78, { resetAt: 'sau 4 ngày' }),
  win('GEMINI 4 ARGON', '5h', 91, { resetAt: 'sau 2 giờ' }),
  win('CLAUDE AND GPT MODELS', '5h', 12, { resetAt: 'sau 3 giờ 10 phút' }),
  win('CLAUDE AND GPT MODELS', 'week', 40),
  win('GEMINI MODELS', 'week', null),
];

// remainingPct luôn khớp used/limit để một fixture không tự mâu thuẫn.
const qoderCreditWindows: QuotaWindow[] = [
  win('Credit gói', 'plan', 62, { unit: 'credits', used: 760, limit: 2_000, resetAt: '28/11' }),
  win('Credit bổ sung', 'plan', 69.4, { unit: 'credits', used: 245, limit: 800 }),
];

const offers: ModelOffer[] = [
  { id: 'ultimate', label: 'Ultimate', multiplier: 3, source: 'pty' },
  { id: 'kimi', label: 'Kimi-K3.1-Pro', multiplier: 0.6, contextTokens: 256_000, source: 'pty' },
  { id: 'efficient', label: 'Efficient', multiplier: 0.5, source: 'pty' },
  { id: 'glm-flash', label: 'GLM-5.3-Flash', multiplier: 0.2, contextTokens: 200_000, source: 'pty' },
  { id: 'ds-flash', label: 'DeepSeek-Flash', multiplier: 0.1, source: 'catalog' },
  { id: 'qwen-flash', label: 'Qwen3.8-Flash', multiplier: 0, originalMultiplier: 0.1, promo: 'Đang giảm giá', contextTokens: 1_000_000, source: 'pty' },
  { id: 'auto', label: 'Auto', multiplier: null, source: 'cli' },
  { id: 'fast', label: 'Fast', multiplier: null, source: 'cli' },
  { id: 'cantus', label: 'Cantus', multiplier: null, source: 'cli' },
  { id: 'sonus', label: 'Sonus', multiplier: null, source: 'cli' },
];

const baseCheck = (over: Partial<DashboardCheck> = {}): DashboardCheck => ({
  checkedAt: Date.parse('2026-11-03T11:40:12Z'),
  status: 'ready',
  version: '1.1.81',
  account: { state: 'authenticated', label: '***@example.com', source: 'status -o json', reason: null },
  quota: { remaining: null, unit: null, resetAt: null, source: '/usage', reason: 'CLI không expose quota' },
  credits: { remaining: null, unit: null, resetAt: null, source: '/usage', reason: 'Không đọc được credit từ CLI' },
  probes: [{ command: 'status -o json', ok: true, exitCode: 0, summary: 'user_type' }],
  ...over,
});

/** Cùng hình dạng với `readyCheck` trong test/e2e/upgrade.spec.ts: chỉ có trường cũ. */
const legacyCheck = baseCheck({
  version: '1.2.3',
  account: { state: 'authenticated', label: 'user@example.com', source: 'cli status', reason: null },
  probes: [{ command: 'version', ok: true, exitCode: 0, summary: '1.2.3' }],
});

function tool(agent: DashboardAgent, title: string, lastCheck: DashboardCheck | null): DashboardTool {
  return { agent, title, configuredBin: null, installed: lastCheck !== null, lastCheck, suggestions: [] };
}

const qoderCheck = baseCheck({
  plan: { name: 'Pro Trial', tier: 'trial', renewsAt: '2026-11-28T12:00:00Z', source: 'status -o json' },
  currentModel: { id: 'Auto', label: 'Auto', effort: 'medium' },
  models: offers,
  quotaWindows: qoderCreditWindows,
  credits: { remaining: 1_240, unit: 'credits', resetAt: null, source: '/usage', reason: null },
  highlights: ['Chưa có hệ số giá cho 4 model.'],
});

const harborPool: KeyPool = {
  name: 'harbor', total: 5, ok: 3, exhausted: 1, remainingPct: 67.2,
  limitLabel: 'Hạn 385K output / key / 7 ngày', resetAt: '2026-11-06T00:00:00.000Z',
  keys: [
    { label: '…ALPHA', status: 'ok', pct: 88.1 },
    { label: '…BRAVO', status: 'low', pct: 33 },
    { label: '…CHARLIE', status: 'ok', pct: 90 },
    { label: '…DELTA', status: 'out', pct: 0 },
    { label: '…ECHO', status: 'ok', pct: 55 },
  ],
};

const downPool: KeyPool = {
  name: 'routeway', total: 0, ok: 0, exhausted: 0, remainingPct: null,
  limitLabel: '200 request / ngày / key · pool không chạy', keys: [],
};

function stubCli(over: Partial<CliWorkspace> = {}): CliWorkspace {
  const snapshot = {
    generatedAt: Date.parse('2026-11-03T11:41:00Z'),
    tools: [
      tool('codex', 'Codex', baseCheck({
        version: '0.166.0',
        plan: { name: 'ChatGPT Plus', tier: 'plus', source: 'auth.json' },
        currentModel: { id: 'gpt-test', label: 'gpt-test', effort: 'high' },
        quotaWindows: codexWindows,
        credits: { remaining: null, unit: null, resetAt: null, source: 'cli status', reason: 'Không áp dụng cho gói ChatGPT' },
      })),
      tool('qodercli', 'Qoder', qoderCheck),
      tool('agy', 'Antigravity', baseCheck({
        version: '1.4.12',
        plan: { name: 'Antigravity Pro', tier: 'pro', source: '/usage' },
        quotaWindows: agyWindows,
        models: [{ id: 'gemini-4-argon-medium', label: 'Gemini 4 Argon (Medium)', multiplier: null, source: 'cli' }],
      })),
      tool('opencode', 'OpenCode', baseCheck({
        version: '2.2.5',
        plan: { name: 'BYOK', tier: 'byok', source: 'opencode.json' },
        keyPools: [harborPool, downPool],
      })),
    ],
    terminalSessions: [],
  };
  return {
    snapshot, checking: null, launching: null, selection: 'workspace', setSelection: () => {},
    activeId: null, message: null, messageKind: 'info', setMessage: () => {},
    check: async () => {}, launch: async () => {}, select: () => {}, close: async () => {},
    checkAll: async () => {}, checkingAll: { active: false, done: 0, total: 0, agent: null },
    ...over,
  } as unknown as CliWorkspace;
}

const renderDashboard = (over: Partial<CliWorkspace> = {}) => html(createElement(Dashboard, {
  plans: [] as Plan[], tasks: [] as Task[], cli: stubCli(over),
}));

// ── QuotaMeter: thanh luôn là cửa sổ thấp hơn ───────────────────────────────

describe('QuotaMeter', () => {
  const meter = (windows: QuotaWindow[]) => html(createElement(QuotaMeter, { name: windows[0]?.group ?? '—', windows }));

  test('thanh thể hiện cửa sổ thấp hơn, không phụ thứ tự dữ liệu', () => {
    expect(bottleneck(codexWindows).lowest?.window).toBe('5h');
    expect(bottleneck([...codexWindows].reverse()).lowest?.window).toBe('5h');
    const out = meter(codexWindows);
    expect(out).toContain('width:22%');
    expect(out).not.toContain('width:34%');
    expect(out).toContain('aria-valuenow="22"');
    // Cửa sổ không nghẽn vẫn được ghi nhỏ bên cạnh.
    expect(out).toContain('34%');
  });

  test.each([[100, 'ok'], [62, 'ok'], [50, 'ok'], [49.9, 'warn'], [34, 'warn'], [25, 'warn'], [24.9, 'bad'], [0, 'bad']] as const)(
    'màu thanh đúng ngưỡng cho %s%%', (pct, tone) => {
      expect(meterTone(pct)).toBe(tone);
      expect(meter([win('Codex', '5h', pct)])).toMatch(new RegExp(`class="dash-bar ${tone}"`));
    },
  );

  test('null là chưa có dữ liệu, không bao giờ thành 0%', () => {
    expect(meterTone(null)).toBe('empty');
    const out = meter([win('Codex', '5h', null)]);
    expect(out).not.toContain('width:');
    expect(out).not.toContain('aria-valuenow');
    expect(textOf(out)).toContain('Chưa có dữ liệu');
    expect(textOf(out)).not.toContain(' 0%');
  });

  test('0% vẫn là một giá trị thật, khác với thiếu dữ liệu', () => {
    const out = meter([win('Credit gói', 'plan', 0, { unit: 'credits', used: 300, limit: 300 })]);
    expect(out).toContain('width:0%');
    expect(textOf(out)).toContain('0%');
    expect(textOf(out)).not.toContain('Chưa có dữ liệu');
    expect(meterTone(0)).toBe('bad');
  });

  test('gộp cửa sổ theo nhóm: một nhóm chỉ có một thanh', () => {
    const groups = groupQuotaWindows(agyWindows);
    expect(groups.map((group) => group.name)).toEqual(['GEMINI 4 ARGON', 'CLAUDE AND GPT MODELS', 'GEMINI MODELS']);
    expect(groups[1].windows).toHaveLength(2);
    expect(groups[2].windows[0].remainingPct).toBeNull();
  });

  test('nhãn nhóm viết hoa toàn bộ được chuẩn hoá cho dễ đọc', () => {
    expect(formatGroupName('GEMINI MODELS')).toBe('Gemini models');
    expect(formatGroupName('CLAUDE AND GPT MODELS')).toBe('Claude and GPT models');
    expect(formatGroupName('GEMINI 4 ARGON')).toBe('Gemini 4 Argon');
    expect(formatGroupName('Credit gói')).toBe('Credit gói');
  });

  test('đơn vị credit hiện kèm hạn mức, cửa sổ ghi bằng tiếng Việt', () => {
    const out = textOf(meter(qoderCreditWindows.slice(0, 1)));
    expect(out).toContain('62%');
    expect(out).toContain('760');
    expect(out).toContain('2.000');
    expect(out).toContain('28/11');
    expect(textOf(meter([win('Codex', 'week', 34)]))).toContain('tuần');
    expect(textOf(meter([win('Codex', '5h', 34)]))).toContain('5 giờ');
  });

  test('nhóm chưa có số liệu nào thì thanh ở trạng thái trống', () => {
    const out = textOf(meter(agyWindows.filter((row) => row.group === 'GEMINI MODELS')));
    expect(out).toContain('Chưa có dữ liệu');
  });
});

// ── ModelOfferList: 6 dòng mặc định, hệ số tăng dần, null cuối ───────────────

describe('ModelOfferList', () => {
  const markup = (models: ModelOffer[]) => html(createElement(ModelOfferList, { models }));
  const idsIn = (part: string) => [...part.matchAll(/data-model="([^"]+)"/g)].map((match) => match[1]);

  test('sắp theo multiplier tăng dần, null xếp cuối theo tên', () => {
    expect(sortOffers(offers).map((offer) => offer.id)).toEqual([
      'qwen-flash', 'ds-flash', 'glm-flash', 'efficient', 'kimi', 'ultimate', 'auto', 'cantus', 'fast', 'sonus',
    ]);
  });

  test('mặc định hiện 6 dòng, phần còn lại mở bằng details', () => {
    const out = markup(offers);
    expect(DEFAULT_MODEL_ROWS).toBe(6);
    const detailsAt = out.indexOf('<details');
    expect(detailsAt).toBeGreaterThan(0);
    expect(idsIn(out.slice(0, detailsAt))).toEqual(['qwen-flash', 'ds-flash', 'glm-flash', 'efficient', 'kimi', 'ultimate']);
    expect(idsIn(out.slice(detailsAt))).toEqual(['auto', 'cantus', 'fast', 'sonus']);
    expect(textOf(out)).toContain('Xem tất cả 10 model');
  });

  test('từ 6 model trở xuống thì không có nút mở rộng', () => {
    expect(markup(offers.slice(0, 6))).not.toContain('<details');
  });

  test('hệ số 0 là Miễn phí, kèm giá cũ gạch ngang khi đang giảm', () => {
    const out = markup([offers[5]]);
    expect(textOf(out)).toContain('Miễn phí');
    expect(out).toContain('<s>x0.1</s>');
    expect(out).toMatch(/class="dash-mult free"/);
    expect(textOf(out)).toContain('Đang giảm giá');
    expect(textOf(out)).toContain('1M ctx');
  });

  test('model chưa có hệ số hiện Chưa rõ, không hiện 0', () => {
    const out = markup([{ id: 'auto', label: 'Auto', multiplier: null, source: 'cli' }]);
    expect(textOf(out)).toContain('Chưa rõ');
    expect(out).toMatch(/class="dash-mult unknown"/);
    expect(textOf(out)).not.toContain('x0');
  });

  test('model lấy từ catalog được ghi rõ nguồn', () => {
    expect(textOf(markup([offers[4]]))).toContain('theo catalog');
  });

  test.each([[1_000_000, '1M ctx'], [256_000, '256K ctx'], [200_000, '200K ctx'], [null, null], [0, null]] as const)(
    'độ dài ngữ cảnh %s', (tokens, label) => expect(formatContext(tokens)).toBe(label),
  );

  test('danh sách rỗng hiện trạng thái trống', () => {
    expect(textOf(markup([]))).toContain('Chưa có dữ liệu');
  });
});

// ── KeyPoolGrid ─────────────────────────────────────────────────────────────

describe('KeyPoolGrid', () => {
  const markup = (pools: KeyPool[]) => html(createElement(KeyPoolGrid, { pools }));

  test('một ô cho mỗi key theo trạng thái, nhãn đã mask', () => {
    const out = markup([harborPool]);
    expect(out.match(/class="dash-key /g)).toHaveLength(harborPool.keys.length);
    expect(out).toContain('dash-key is-out');
    expect(out).toContain('dash-key is-low');
    expect(textOf(out)).toContain('…ALPHA');
    expect(textOf(out)).toContain('1 key cạn');
    expect(textOf(out)).toContain('67.2%');
  });

  test('pool không chạy là trạng thái trung tính, không phải lỗi', () => {
    expect(poolReason(downPool)).toBe('pool không chạy');
    expect(poolReason(harborPool)).toBeNull();
    const out = markup([downPool]);
    expect(textOf(out)).toContain('pool không chạy');
    expect(textOf(out)).toContain('Chưa có dữ liệu');
    expect(out).not.toMatch(/is-error|banner-error/);
    expect(out).not.toContain('width:');
  });

  test('mã nguồn không chứa khoá hay token', () => {
    expect(markup([harborPool, downPool])).not.toMatch(/eyJ|sk-/);
  });

  test('không có pool nào thì hiện trạng thái trống', () => {
    expect(textOf(markup([]))).toContain('Chưa có dữ liệu');
  });
});

// ── CreditPanel / PlanStrip ────────────────────────────────────────────────

describe('CreditPanel', () => {
  const credit = (over: Partial<DashboardCheck> = {}) => html(createElement(CreditPanel, { check: baseCheck(over) }));

  test('số dư kèm hạn mức gói hiện cả hai vế', () => {
    const out = textOf(credit({
      credits: { remaining: 1_240, unit: 'credits', resetAt: null, source: '/usage', reason: null },
      quotaWindows: qoderCreditWindows,
    }));
    expect(out).toContain('1.240');
    expect(out).toContain('2.000');
  });

  test('thiếu dữ liệu hiện lý do, không hiện 0', () => {
    const out = textOf(credit());
    expect(out).toContain('Không đọc được credit từ CLI');
    expect(out).not.toContain(' 0 ');
  });

  test('số dư bằng 0 vẫn là con số thật', () => {
    const out = textOf(credit({ credits: { remaining: 0, unit: 'credits', resetAt: null, source: '/usage', reason: null } }));
    expect(out).toMatch(/\b0\b/);
    expect(out).not.toContain('Không đọc được credit từ CLI');
  });
});

describe('PlanStrip', () => {
  test('hiện gói và model mặc định (badge tier thuộc về đầu thẻ, không lặp lại ở đây)', () => {
    const out = textOf(html(createElement(PlanStrip, { check: qoderCheck })));
    expect(out).toContain('Pro Trial');
    expect(out).toContain('Auto');
    expect(out).toContain('medium');
    expect(out).toContain('28/11');
    expect(out).not.toContain('TRIAL');
  });

  test('thiếu model mặc định thì ghi chưa có dữ liệu', () => {
    const out = textOf(html(createElement(PlanStrip, { check: baseCheck({ plan: { name: 'BYOK', tier: 'byok', source: 'opencode.json' } }) })));
    expect(out).toContain('BYOK');
    expect(out).toContain('Chưa có dữ liệu');
  });

  test('chưa có gói thì ghi chưa có dữ liệu, không bịa tên gói', () => {
    const out = textOf(html(createElement(PlanStrip, { check: baseCheck() })));
    expect(out).toContain('Chưa có dữ liệu');
    expect(out).not.toMatch(/PLUS|PRO|TRIAL/);
  });
});

// ── Block: mọi khối phải đủ bốn trạng thái ──────────────────────────────────

describe('Block', () => {
  const block = (state: BlockState, over: Record<string, unknown> = {}) => html(createElement(Block, { title: 'Hạn mức', state, ...over }));

  test('loading hiện skeleton, không hiện chữ của trạng thái rỗng', () => {
    const out = block('loading');
    expect(skeletonCount(out)).toBeGreaterThan(0);
    expect(textOf(out)).toContain('Đang tải');
    expect(textOf(out)).not.toContain('Chưa có dữ liệu');
    expect(textOf(out)).not.toContain('Chưa kiểm tra');
  });

  test('chưa kiểm tra hướng dẫn người dùng bấm Kiểm tra', () => {
    const out = block('unchecked');
    expect(textOf(out)).toContain('Chưa kiểm tra');
    expect(skeletonCount(out)).toBe(0);
  });

  test('lỗi hiện nguyên nhân kèm nút Thử lại', () => {
    const out = block('error', { detail: 'PTY không phản hồi', onRetry: () => {}, retryLabel: 'Kiểm tra lại hạn mức' });
    expect(textOf(out)).toContain('PTY không phản hồi');
    expect(textOf(out)).toContain('Thử lại');
    expect(out).toContain('aria-label="Kiểm tra lại hạn mức"');
  });

  test('null hiện trạng thái trống, có dữ liệu hiện nội dung', () => {
    expect(textOf(block('empty'))).toContain('Chưa có dữ liệu');
    expect(skeletonCount(block('empty'))).toBe(0);
    const filled = block('data', { children: 'Còn 22%' });
    expect(textOf(filled)).toContain('Còn 22%');
    expect(skeletonCount(filled)).toBe(0);
  });
});

// ── Dashboard v3 ────────────────────────────────────────────────────────────

describe('Dashboard v3', () => {
  test('có nút Kiểm tra tất cả và báo tiến độ khi đang chạy', () => {
    const idle = renderDashboard();
    expect(textOf(idle)).toContain('Kiểm tra tất cả');
    expect(idle).not.toContain('aria-valuemax="4"');
    const running = renderDashboard({ checking: 'qodercli', checkingAll: { active: true, done: 2, total: 4, agent: 'qodercli' } });
    expect(textOf(running)).toContain('2/4');
    expect(running).toContain('aria-valuemax="4"');
    expect(textOf(running)).toContain('Qoder');
  });

  test('kiểm tra lần đầu thì mọi khối hiện skeleton', () => {
    const out = renderDashboard({
      snapshot: { generatedAt: 0, terminalSessions: [], tools: [tool('codex', 'Codex', null)] },
      checking: 'codex',
    });
    expect(skeletonCount(out)).toBeGreaterThanOrEqual(4);
    const card = cardOf(out, 'codex');
    expect(card).toContain('Đang tải');
    expect(card).not.toContain('Chưa kiểm tra');
    expect(card).not.toContain('Chưa có dữ liệu');
  });

  test('chưa kiểm tra thì nói rõ chưa kiểm tra, không vẽ số liệu giả', () => {
    const out = renderDashboard({
      snapshot: { generatedAt: 0, terminalSessions: [], tools: [tool('codex', 'Codex', null)] },
    });
    expect(textOf(out)).toContain('Chưa kiểm tra');
    expect(skeletonCount(out)).toBe(0);
    expect(out).not.toContain('aria-valuenow');
  });

  test('đang kiểm tra lại vẫn giữ số liệu cũ, thêm nhãn đang cập nhật', () => {
    const out = renderDashboard({ checking: 'codex' });
    expect(textOf(out)).toContain('ChatGPT Plus');
    expect(textOf(out)).toContain('Đang kiểm tra lại');
    expect(skeletonCount(out)).toBe(0);
  });

  test('check lỗi thì khối liên quan có nút Thử lại', () => {
    const broken = tool('codex', 'Codex', baseCheck({ status: 'error', version: null }));
    const out = renderDashboard({
      snapshot: { generatedAt: 0, terminalSessions: [], tools: [{ ...broken, installed: false }] },
    });
    expect(textOf(out)).toContain('Thử lại');
    expect(out).toContain('aria-label="Kiểm tra Codex"');
    expect(textOf(out)).toContain('Chưa tìm thấy CLI');
  });

  test('dữ liệu v3 hiển thị được: gói, tier, hạn mức, credit, model, key pool', () => {
    const out = textOf(renderDashboard());
    for (const expected of [
      'ChatGPT Plus', 'PLUS', 'Pro Trial', 'TRIAL', 'Antigravity Pro', 'BYOK',
      '1.240', '2.000', 'Claude and GPT models', 'Qwen3.8-Flash', 'Hạn 385K output / key / 7 ngày',
    ]) {
      expect(out).toContain(expected);
    }
    // Mỗi thẻ chỉ gắn một badge tier (ở tiêu đề), không lặp lại trong dải gói.
    const markup = renderDashboard();
    expect((markup.match(/class="tier-badge/g) ?? []).length).toBe(4);
  });

  test('thanh hạn mức hiện cửa sổ nghẽn của từng tool', () => {
    const out = textOf(renderDashboard());
    expect(out).toContain('22%'); // Codex 5h
    expect(out).toContain('12%'); // AGY Claude & GPT
    expect(out).toContain('78%'); // AGY Gemini 4 Argon
    expect(out).toContain('62%'); // Qoder credit gói
    expect(out).toContain('67.2%'); // OpenCode harbor
  });

  test('check kiểu cũ không có trường v3 vẫn hiển thị đúng như 2.2', () => {
    const out = textOf(renderDashboard({
      snapshot: { generatedAt: 0, terminalSessions: [], tools: [tool('agy', 'Antigravity', legacyCheck)] },
    }));
    for (const expected of ['1.2.3', 'Sẵn sàng', 'CLI không expose quota', 'Không đọc được credit từ CLI', 'Hạn mức còn lại', 'Tài khoản & credit']) {
      expect(out).toContain(expected);
    }
    expect(out).toContain('user@example.com');
  });

  test('không để lọt giá trị rỗng ra màn hình', () => {
    const out = renderDashboard();
    expect(out).not.toMatch(/undefined|NaN|Infinity|\[object Object\]/);
  });

  test('thiếu cửa sổ hạn mức thì nói chưa có dữ liệu, không vẽ thanh và không bao giờ ra 0%', () => {
    const markup = renderDashboard({
      snapshot: {
        generatedAt: 0,
        terminalSessions: [],
        tools: [tool('qodercli', 'Qoder', baseCheck({
          plan: { name: 'Pro Trial', tier: 'trial', source: 'status -o json' },
        }))],
      },
    });
    const card = cardOf(markup, 'qodercli');
    // `quota.remaining === null` là "chưa đọc được", không phải hạn mức cạn.
    expect(card).toContain('Chưa có dữ liệu · CLI không expose quota');
    expect(card).not.toContain(' 0%');
    expect(markup).not.toContain('aria-valuenow');
    expect(markup).not.toContain('dash-bar');
    expect(markup).not.toContain('width:0%');
    // Khối thiếu dữ liệu không phải khối lỗi: không có nút Thử lại cho từng khối.
    expect(markup).not.toContain('data-state="error"');
  });

  test('danh sách model mỗi thẻ không vượt quá 6 dòng đóng', () => {
    const out = renderDashboard();
    const qoderCard = out.slice(out.indexOf('data-tool="qodercli"'), out.indexOf('data-tool="agy"'));
    const closed = qoderCard.slice(0, qoderCard.indexOf('<details'));
    expect([...closed.matchAll(/data-model="/g)].length).toBeLessThanOrEqual(DEFAULT_MODEL_ROWS);
  });
});

// ── Thông báo: thành công phải là toast xanh ────────────────────────────────

describe('thông báo của dashboard', () => {
  test('thành công dùng toast xanh, không dùng class banner-error', () => {
    const out = renderDashboard({ message: 'Đã kiểm tra 4/4 công cụ.', messageKind: 'success' });
    expect(out).toContain('dash-toast');
    expect(out).toContain('dash-toast-success');
    expect(out).not.toContain('banner-error');
    expect(out).toContain('role="status"');
  });

  test('lỗi vẫn nổi bật và có nút thử lại', () => {
    const out = renderDashboard({ message: 'Không kiểm tra được Codex: timeout.', messageKind: 'error' });
    expect(out).toContain('dash-toast-error');
    expect(out).toContain('role="alert"');
    expect(textOf(out)).toContain('Thử lại');
  });

  test('thông tin không bị coi là lỗi', () => {
    const out = renderDashboard({ message: 'Đang kiểm tra lần lượt 4 công cụ…', messageKind: 'info' });
    expect(out).toContain('dash-toast-info');
    expect(out).not.toContain('banner-error');
  });
});

// ── checkAllAgents: tuần tự, có tiến độ, không dừng vì một lỗi ──────────────

describe('checkAllAgents', () => {
  const agents: DashboardAgent[] = ['codex', 'qodercli', 'agy', 'opencode'];

  test('chạy tuần tự, hết agent này mới tới agent khác', async () => {
    const events: string[] = [];
    const result = await checkAllAgents(agents, async (agent) => {
      events.push(`start:${agent}`);
      await new Promise((resolve) => setTimeout(resolve, 1));
      events.push(`end:${agent}`);
    });
    expect(events).toEqual(['start:codex', 'end:codex', 'start:qodercli', 'end:qodercli', 'start:agy', 'end:agy', 'start:opencode', 'end:opencode']);
    expect(result).toMatchObject({ done: 4, total: 4, failures: [] });
  });

  test('báo tiến độ sau mỗi agent', async () => {
    const progress: Array<{ done: number; total: number; agent: DashboardAgent | null }> = [];
    await checkAllAgents(agents, async () => {}, { onProgress: (state) => progress.push(state) });
    expect(progress.map((state) => state.done)).toEqual([0, 1, 2, 3, 4]);
    expect(progress.every((state) => state.total === 4)).toBe(true);
    expect(progress.at(-1)?.agent).toBeNull();
  });

  test('một agent lỗi không chặn các agent còn lại', async () => {
    const visited: DashboardAgent[] = [];
    const result = await checkAllAgents(agents, async (agent) => {
      visited.push(agent);
      if (agent === 'qodercli') throw new Error('CLI không phản hồi');
    });
    expect(visited).toEqual(agents);
    expect(result.done).toBe(3);
    expect(result.failures).toEqual([{ agent: 'qodercli', message: 'CLI không phản hồi' }]);
  });

  test('lỗi không phải Error vẫn được ghi lại', async () => {
    const result = await checkAllAgents(['codex'], async () => { throw 'boom'; });
    expect(result.failures).toEqual([{ agent: 'codex', message: 'boom' }]);
  });

  test('danh sách rỗng không gọi lệnh nào', async () => {
    let calls = 0;
    const result = await checkAllAgents([], async () => { calls += 1; });
    expect(calls).toBe(0);
    expect(result).toMatchObject({ done: 0, total: 0 });
  });
});
