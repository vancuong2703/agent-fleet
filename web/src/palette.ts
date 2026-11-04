import type { DashboardAgent } from '../../shared/dashboard.js';
import type { Task } from '../../shared/types.js';
import { statusLabel } from './store.js';

/**
 * Command palette model. Kept free of React so the ranking, the keyboard maths
 * and the action payloads can be tested without a DOM (vitest runs in `node`).
 */

export type PaletteView = 'dashboard' | 'terminal' | 'tasks' | 'compare' | 'usage' | 'guide';
export type PaletteTheme = 'light' | 'dark' | 'system';

export type PaletteAction =
  | { type: 'view'; view: PaletteView }
  | { type: 'task'; taskId: string }
  | { type: 'agent'; agent: DashboardAgent }
  | { type: 'theme'; theme: PaletteTheme }
  | { type: 'create' };

export interface PaletteItem {
  /** Stable DOM id, also the React key. */
  id: string;
  label: string;
  /** Small right-aligned note: a status word, a section name. */
  hint: string;
  group: 'Điều hướng' | 'Công việc' | 'Agent' | 'Giao diện';
  /** Extra words that should match a query without being displayed. */
  keywords: string;
  action: PaletteAction;
}

export const PALETTE_AGENTS: Array<{ id: DashboardAgent; label: string }> = [
  { id: 'codex', label: 'Codex' },
  { id: 'qodercli', label: 'Qoder' },
  { id: 'agy', label: 'Antigravity' },
  { id: 'opencode', label: 'OpenCode' },
];

const VIEWS: Array<{ id: PaletteView; label: string; hint: string }> = [
  { id: 'dashboard', label: 'Bảng điều khiển', hint: 'Màn hình' },
  { id: 'terminal', label: 'Terminal', hint: 'Màn hình' },
  { id: 'tasks', label: 'Công việc', hint: 'Màn hình' },
  { id: 'compare', label: 'So sánh agent', hint: 'Màn hình' },
  { id: 'usage', label: 'Tài nguyên & sử dụng', hint: 'Màn hình' },
  { id: 'guide', label: 'Hướng dẫn leader', hint: 'Kết nối và giao việc' },
];

const THEMES: Array<{ id: PaletteTheme; label: string }> = [
  { id: 'light', label: 'Giao diện sáng' },
  { id: 'dark', label: 'Giao diện tối' },
  { id: 'system', label: 'Theo hệ thống' },
];

const normalize = (value: string): string => value.toLocaleLowerCase().normalize('NFC');

/**
 * Every command the palette can run, in display order: navigation first (the
 * cheapest, always-applicable actions), then the newest tasks, then agents,
 * then the theme. `taskLimit` keeps a long fleet from flooding the list.
 */
export function buildPaletteItems(input: {
  tasks: Task[];
  taskLimit?: number;
  withCreate?: boolean;
}): PaletteItem[] {
  const items: PaletteItem[] = [];
  if (input.withCreate !== false) {
    items.push({ id: 'create', label: 'Tạo công việc mới', hint: 'Hành động', group: 'Công việc', keywords: 'task composer giao việc', action: { type: 'create' } });
  }
  for (const view of VIEWS) {
    items.push({ id: `view:${view.id}`, label: view.label, hint: view.hint, group: 'Điều hướng', keywords: `đi tới màn hình ${view.id}`, action: { type: 'view', view: view.id } });
  }
  const tasks = [...input.tasks].sort((a, b) => b.createdAt - a.createdAt).slice(0, input.taskLimit ?? 40);
  for (const task of tasks) {
    items.push({
      id: `task:${task.id}`,
      label: task.title,
      hint: statusLabel(task.status),
      group: 'Công việc',
      keywords: `${task.id} ${task.agent} ${task.branch}`,
      action: { type: 'task', taskId: task.id },
    });
  }
  for (const agent of PALETTE_AGENTS) {
    items.push({ id: `agent:${agent.id}`, label: `Mở CLI ${agent.label}`, hint: 'Terminal', group: 'Agent', keywords: `terminal cli ${agent.id}`, action: { type: 'agent', agent: agent.id } });
  }
  for (const theme of THEMES) {
    items.push({ id: `theme:${theme.id}`, label: theme.label, hint: 'Giao diện', group: 'Giao diện', keywords: `theme ${theme.id} màu sắc`, action: { type: 'theme', theme: theme.id } });
  }
  return items;
}

/**
 * Substring match on the label first, then on the hidden keywords, so typing a
 * task id still finds it. An empty query keeps the display order.
 */
export function filterPalette(items: PaletteItem[], query: string): PaletteItem[] {
  const needle = normalize(query.trim());
  if (!needle) return items;
  const scored = items
    .map((item) => {
      const label = normalize(item.label);
      if (label.startsWith(needle)) return { item, score: 0 };
      if (label.includes(needle)) return { item, score: 1 };
      if (normalize(`${item.group} ${item.hint} ${item.keywords}`).includes(needle)) return { item, score: 2 };
      return null;
    })
    .filter((entry): entry is { item: PaletteItem; score: number } => entry !== null);
  // Array.prototype.sort is stable, so equal scores keep the original order.
  return scored.sort((a, b) => a.score - b.score).map((entry) => entry.item);
}

/** Arrow-key movement that wraps at both ends; `-1` means "nothing active yet". */
export function stepIndex(current: number, delta: number, length: number): number {
  if (length === 0) return -1;
  if (current < 0) return delta > 0 ? 0 : length - 1;
  return (current + delta + length) % length;
}
