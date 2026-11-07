import { useEffect, useRef, useState } from 'react';
import type { DashboardAgent, DashboardCheck, DashboardTool, ModelOffer, QuotaWindow } from '../../../shared/dashboard.js';
import type { AgentId, Run } from '../../../shared/types.js';
import { api, type AgentStats } from '../api.js';
export const AGENTS = ['codex', 'qodercli', 'agy', 'opencode'] as const;
export const agentNames: Record<AgentId, string> = { codex: 'Codex', qodercli: 'Qoder', agy: 'Antigravity CLI', opencode: 'OpenCode', fake: 'Test agent' };
export const known = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
export function sortOffers(models: readonly ModelOffer[]): ModelOffer[] {
  return [...models].sort((a, b) => {
    const price = known(a.multiplier) ? a.multiplier : null; const other = known(b.multiplier) ? b.multiplier : null;
    if (price === null && other === null) return a.label.localeCompare(b.label);
    if (price === null) return 1; if (other === null) return -1;
    return price - other || a.label.localeCompare(b.label);
  });
}
export function formatContext(tokens: number | null | undefined): string | null { return !known(tokens) || tokens <= 0 ? null : tokens >= 1e6 ? `${Math.round(tokens / 1e5) / 10}M ctx` : `${Math.round(tokens / 1000)}K ctx`; }
const ACRONYMS = new Set(['GPT', 'API', 'AI', 'CLI', 'IDE', 'SDK', 'URL', 'CTX']);
const STOP_WORDS = new Set(['and', 'or', 'of', 'the', 'for', 'with', 'to', 'in', 'on', 'models']);
export function formatGroupName(name: string): string { if (!/^[A-Z0-9&. ]+$/.test(name.trim())) return name; return name.toLowerCase().split(/\s+/).map((word, index) => index > 0 && (STOP_WORDS.has(word) || !/^[a-z]/.test(word)) ? word : ACRONYMS.has(word.toUpperCase()) ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)).join(' '); }
export function tabIndexForKey(key: string, current: number, count: number): number | null { if (count <= 0) return null; return key === 'ArrowRight' ? (current + 1) % count : key === 'ArrowLeft' ? (current - 1 + count) % count : key === 'Home' ? 0 : key === 'End' ? count - 1 : null; }
export const compact = (value: number | null | undefined) => !known(value) ? '—' : value >= 1e6 ? `${+(value / 1e6).toFixed(1)}M` : value >= 1e3 ? `${+(value / 1e3).toFixed(1)}K` : String(value);
export const rate = (value: number | null | undefined) => known(value) ? `${+(value * 100).toFixed(1)}%` : '—';
export const duration = (value: number | null | undefined) => known(value) ? `${+(value / 1000).toFixed(1)} s` : '—';
export const clock = (value: number | null | undefined) => known(value) ? new Date(value).toLocaleTimeString('en-GB', { hour12: false }) : '—';
export const tone = (pct: number | null | undefined) => !known(pct) ? 'plain' : pct < 25 ? 'bad' : pct < 50 ? 'warn' : 'ok';
export function toolHealth(tool: DashboardTool): 'plain' | 'warn' | 'bad' | 'ok' {
  const check = tool.lastCheck;
  if (!check) return 'plain';
  if (check.status === 'error' || check.status === 'unavailable') return 'bad';
  if (check.status !== 'ready') return 'warn';
  const values = (check.quotaWindows ?? []).map(row => row.remainingPct).filter(known);
  return values.some(value => value < 25) || check.keyPools?.some(pool => pool.exhausted > 0) ? 'warn' : 'ok';
}
export function planLabel(check?: DashboardCheck | null) { return check?.plan?.tier === 'trial' && /pro/i.test(check.plan.name) ? 'PRO TRIAL' : check?.plan?.tier && check.plan.tier !== 'unknown' ? check.plan.tier.toUpperCase() : null; }
export function quotaRows(check?: DashboardCheck | null): QuotaWindow[] {
  return [...(check?.quotaWindows ?? [])].sort((a, b) => (a.window === '5h' ? 0 : a.window === 'week' ? 1 : 2) - (b.window === '5h' ? 0 : b.window === 'week' ? 1 : 2));
}
export function lowestQuota(check?: DashboardCheck | null) { const rows = quotaRows(check).filter(row => known(row.remainingPct)); return rows.length ? rows.reduce((best, row) => row.remainingPct! < best.remainingPct! ? row : best) : null; }
export function creditWindow(check?: DashboardCheck | null) { const rows = (check?.quotaWindows ?? []).filter(row => row.unit === 'credits'); return rows.length === 1 ? rows[0] : null; }
/** Rolling range, matching /api/stats. Keep the first days of a 30-day report. */
export function buildTokenBins(runs: readonly { startedAt: number | null; inputTokens: number | null; outputTokens: number | null }[], days: number, now: number) {
  const count = days === 7 ? 7 : 4;
  const cutoff = now - days * 86400000;
  return Array.from({ length: count }, (_, index) => {
    const start = cutoff + days * 86400000 * index / count;
    const end = cutoff + days * 86400000 * (index + 1) / count;
    const rows = runs.filter(run => known(run.startedAt) && run.startedAt >= start && (run.startedAt < end || index === count - 1 && run.startedAt === end));
    return { start, end, value: rows.reduce((sum, run) => sum + (run.inputTokens ?? 0) + (run.outputTokens ?? 0), 0) };
  });
}

export interface DailyTokenBin {
  dateKey: string;            // Local calendar key: YYYY-MM-DD
  key: string;                // Alias matching dateKey for compatibility
  start: number;              // 00:00:00.000 local time
  end: number;                // 00:00:00.000 local time of next day
  totalTokens: number | null; // null when reportedRuns === 0
  reportedTotal: number | null; // Alias matching totalTokens
  inputTokens: number;
  input: number | null;       // null if no reported input tokens
  outputTokens: number;
  output: number | null;      // null if no reported output tokens
  reportedRuns: number;       // Runs that reported at least one valid token field
  unreportedRuns: number;     // Runs in that day with both inputTokens & outputTokens null/invalid
  runs: number;               // reportedRuns + unreportedRuns
  coverage: 'none' | 'partial' | 'complete';
  byAgent: Partial<Record<DashboardAgent, number>>;
  isToday: boolean;
}

export function validToken(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0;
}

export function buildDailyTokenSeries(
  runs: readonly (Pick<Run, 'startedAt' | 'inputTokens' | 'outputTokens'> & Partial<Pick<Run, 'id' | 'agent'>>)[],
  days = 7,
  now = Date.now(),
): DailyTokenBin[] {
  const nowDate = new Date(now);
  const y = nowDate.getFullYear();
  const m = nowDate.getMonth();
  const d = nowDate.getDate();

  const bins: DailyTokenBin[] = Array.from({ length: days }, (_, i) => {
    const offset = -(days - 1) + i;
    const start = new Date(y, m, d + offset, 0, 0, 0, 0).getTime();
    const end = new Date(y, m, d + offset + 1, 0, 0, 0, 0).getTime();
    const binDate = new Date(start);
    const dateKey = `${binDate.getFullYear()}-${String(binDate.getMonth() + 1).padStart(2, '0')}-${String(binDate.getDate()).padStart(2, '0')}`;
    return {
      dateKey,
      key: dateKey,
      start,
      end,
      totalTokens: null,
      reportedTotal: null,
      inputTokens: 0,
      input: null,
      outputTokens: 0,
      output: null,
      reportedRuns: 0,
      unreportedRuns: 0,
      runs: 0,
      coverage: 'none' as const,
      byAgent: {},
      isToday: offset === 0,
    };
  });

  if (bins.length === 0) return bins;

  const firstStart = bins[0]!.start;

  // Deduplicate by run.id (latest entry wins)
  const deduped: (typeof runs)[number][] = [];
  const seenIds = new Set<string>();
  for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]!;
    if (run.id) {
      if (seenIds.has(run.id)) continue;
      seenIds.add(run.id);
    }
    deduped.unshift(run);
  }

  const binStats = bins.map(() => ({
    hasValidInput: false,
    hasValidOutput: false,
    allReportedComplete: true,
  }));

  for (const run of deduped) {
    if (!known(run.startedAt) || run.startedAt < firstStart || run.startedAt > now) {
      continue;
    }

    const binIndex = bins.findIndex((bin) => run.startedAt! >= bin.start && run.startedAt! < bin.end);
    if (binIndex === -1) continue;

    const bin = bins[binIndex]!;
    const stats = binStats[binIndex]!;

    const hasInput = validToken(run.inputTokens);
    const hasOutput = validToken(run.outputTokens);

    if (!hasInput && !hasOutput) {
      bin.unreportedRuns += 1;
    } else {
      bin.reportedRuns += 1;
      const inTok = hasInput ? run.inputTokens! : 0;
      const outTok = hasOutput ? run.outputTokens! : 0;

      bin.inputTokens += inTok;
      bin.outputTokens += outTok;

      if (hasInput) stats.hasValidInput = true;
      if (hasOutput) stats.hasValidOutput = true;
      if (!hasInput || !hasOutput) {
        stats.allReportedComplete = false;
      }

      if (run.agent && (run.agent === 'codex' || run.agent === 'qodercli' || run.agent === 'agy' || run.agent === 'opencode')) {
        const currentAgentTotal = bin.byAgent[run.agent] ?? 0;
        bin.byAgent[run.agent] = currentAgentTotal + inTok + outTok;
      }
    }
  }

  for (let i = 0; i < bins.length; i++) {
    const bin = bins[i]!;
    const stats = binStats[i]!;

    bin.runs = bin.reportedRuns + bin.unreportedRuns;

    if (bin.reportedRuns === 0) {
      bin.totalTokens = null;
      bin.reportedTotal = null;
      bin.input = null;
      bin.output = null;
      bin.coverage = 'none';
    } else {
      bin.totalTokens = bin.inputTokens + bin.outputTokens;
      bin.reportedTotal = bin.totalTokens;
      bin.input = stats.hasValidInput ? bin.inputTokens : null;
      bin.output = stats.hasValidOutput ? bin.outputTokens : null;

      if (bin.unreportedRuns === 0 && stats.allReportedComplete) {
        bin.coverage = 'complete';
      } else {
        bin.coverage = 'partial';
      }
    }
  }

  return bins;
}
/** `enabled=false` pauses polling (a mounted-but-hidden page); it refreshes at once when enabled again. */
export function useStats(days = 7, repo = '', enabled = true) {
  const [rows, setRows] = useState<AgentStats[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const loadedKey = useRef('');
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false; let timer: number | undefined;
    // Coming back to a hidden page keeps its numbers; only a new window or repo is a fresh load.
    if (loadedKey.current !== `${days}|${repo}|${attempt}`) { loadedKey.current = `${days}|${repo}|${attempt}`; setLoaded(false); }
    const refresh = async () => {
      try { const result = await api.stats({ sinceDays: days || undefined, repo: repo || undefined }); if (!cancelled) { setRows(result); setError(null); setLoaded(true); } }
      catch (cause) { if (!cancelled) { setError(String(cause)); setLoaded(true); } }
      finally { if (!cancelled) timer = window.setTimeout(refresh, document.hidden ? 15000 : 5000); }
    };
    void refresh(); return () => { cancelled = true; window.clearTimeout(timer); };
  }, [days, repo, attempt, enabled]);
  return { rows, loaded, error, retry: () => setAttempt(value => value + 1) };
}
export function download(name: string, content: string, type: string) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 5000); }
