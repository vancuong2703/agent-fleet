import { describe, expect, test, vi } from 'vitest';
import type { DashboardAgent, DashboardCheck, DashboardTool } from '../../shared/dashboard.js';
import { checkAllAgents, classifyCheckOutcome } from '../../web/src/cli-workspace.js';

function createDummyTool(
  agent: DashboardAgent,
  title: string,
  status?: DashboardCheck['status'] | null,
): DashboardTool {
  return {
    agent,
    title,
    configuredBin: `/bin/${agent}`,
    installed: true,
    suggestions: [],
    lastCheck:
      status === null
        ? null
        : {
            checkedAt: Date.now(),
            status: status ?? 'ready',
            version: '1.0.0',
            account: { state: 'authenticated', label: 'test@example.com', source: 'config', reason: null },
            quota: { remaining: 1000, unit: 'tokens', resetAt: null, source: 'cli', reason: null },
            credits: { remaining: 50, unit: 'credits', resetAt: null, source: 'cli', reason: null },
            probes: [],
          },
  };
}

describe('T6: CLI Check Status Feedback & Classification', () => {
  describe('classifyCheckOutcome', () => {
    test('maps ready status to success noticeKind', () => {
      const tool = createDummyTool('codex', 'Codex', 'ready');
      const outcome = classifyCheckOutcome(tool);

      expect(outcome.status).toBe('ready');
      expect(outcome.noticeKind).toBe('success');
      expect(outcome.summaryVi).toBe('Đã kiểm tra Codex: Sẵn sàng.');
      expect(outcome.summaryEn).toBe('Checked Codex: Ready.');
    });

    test('maps needs-login status to info noticeKind (not success, not error)', () => {
      const tool = createDummyTool('qodercli', 'Qoder CLI', 'needs-login');
      const outcome = classifyCheckOutcome(tool);

      expect(outcome.status).toBe('needs-login');
      expect(outcome.noticeKind).toBe('info');
      expect(outcome.summaryVi).toBe('Đã kiểm tra Qoder CLI: Cần đăng nhập.');
      expect(outcome.summaryEn).toBe('Checked Qoder CLI: Sign-in needed.');
    });

    test('maps unavailable status to error noticeKind', () => {
      const tool = createDummyTool('agy', 'AGY', 'unavailable');
      const outcome = classifyCheckOutcome(tool);

      expect(outcome.status).toBe('unavailable');
      expect(outcome.noticeKind).toBe('error');
      expect(outcome.summaryVi).toBe('Đã kiểm tra AGY: Chưa cài đặt hoặc không khả dụng.');
      expect(outcome.summaryEn).toBe('Checked AGY: Unavailable.');
    });

    test('maps error status to error noticeKind', () => {
      const tool = createDummyTool('opencode', 'OpenCode', 'error');
      const outcome = classifyCheckOutcome(tool);

      expect(outcome.status).toBe('error');
      expect(outcome.noticeKind).toBe('error');
      expect(outcome.summaryVi).toBe('Đã kiểm tra OpenCode: Lỗi kiểm tra.');
      expect(outcome.summaryEn).toBe('Checked OpenCode: Check failed.');
    });

    test('maps unknown status to info noticeKind', () => {
      const tool = createDummyTool('codex', 'Codex', 'unknown');
      const outcome = classifyCheckOutcome(tool);

      expect(outcome.status).toBe('unknown');
      expect(outcome.noticeKind).toBe('info');
      expect(outcome.summaryVi).toBe('Đã kiểm tra Codex: Không rõ trạng thái.');
      expect(outcome.summaryEn).toBe('Checked Codex: Status unknown.');
    });

    test('handles null tool and null lastCheck by falling back to unknown and CLI title', () => {
      const nullOutcome = classifyCheckOutcome(null);
      expect(nullOutcome.status).toBe('unknown');
      expect(nullOutcome.noticeKind).toBe('info');
      expect(nullOutcome.summaryVi).toBe('Đã kiểm tra CLI: Không rõ trạng thái.');
      expect(nullOutcome.summaryEn).toBe('Checked CLI: Status unknown.');

      const undefinedOutcome = classifyCheckOutcome(undefined);
      expect(undefinedOutcome.status).toBe('unknown');
      expect(undefinedOutcome.noticeKind).toBe('info');

      const toolWithoutCheck = createDummyTool('codex', 'Codex', null);
      const outcomeWithoutCheck = classifyCheckOutcome(toolWithoutCheck);
      expect(outcomeWithoutCheck.status).toBe('unknown');
      expect(outcomeWithoutCheck.noticeKind).toBe('info');
      expect(outcomeWithoutCheck.summaryVi).toBe('Đã kiểm tra Codex: Không rõ trạng thái.');
    });

    test('falls back to agent name if title is empty', () => {
      const tool = createDummyTool('qodercli', '', 'ready');
      const outcome = classifyCheckOutcome(tool);
      expect(outcome.summaryVi).toBe('Đã kiểm tra qodercli: Sẵn sàng.');
      expect(outcome.summaryEn).toBe('Checked qodercli: Ready.');
    });
  });

  describe('checkAllAgents runner and progress tracking', () => {
    const agents: DashboardAgent[] = ['codex', 'qodercli', 'agy', 'opencode'];

    test('runs sequentially and reports progress at each step', async () => {
      const executionOrder: DashboardAgent[] = [];
      const progressSnapshots: { done: number; total: number; agent: DashboardAgent | null }[] = [];

      const result = await checkAllAgents(
        agents,
        async (agent) => {
          executionOrder.push(agent);
        },
        {
          onProgress: (state) => progressSnapshots.push({ ...state }),
        },
      );

      expect(executionOrder).toEqual(['codex', 'qodercli', 'agy', 'opencode']);
      expect(result.done).toBe(4);
      expect(result.total).toBe(4);
      expect(result.failures).toHaveLength(0);
      expect(result.agent).toBeNull();

      // Initial progress plus one after each agent
      expect(progressSnapshots).toHaveLength(5);
      expect(progressSnapshots[0]).toEqual({ done: 0, total: 4, agent: 'codex' });
      expect(progressSnapshots[4]).toEqual({ done: 4, total: 4, agent: null });
    });

    test('continues after agent failure and records the failure', async () => {
      const attempted: DashboardAgent[] = [];

      const result = await checkAllAgents(
        agents,
        async (agent) => {
          attempted.push(agent);
          if (agent === 'qodercli') {
            throw new Error('Connection refused');
          }
        },
      );

      // All 4 agents were attempted
      expect(attempted).toEqual(['codex', 'qodercli', 'agy', 'opencode']);
      // 3 completed successfully
      expect(result.done).toBe(3);
      expect(result.total).toBe(4);
      expect(result.failures).toEqual([
        { agent: 'qodercli', message: 'Connection refused' },
      ]);
    });

    test('handles empty agents array gracefully', async () => {
      const onProgress = vi.fn();
      const result = await checkAllAgents([], async () => {}, { onProgress });

      expect(result.done).toBe(0);
      expect(result.total).toBe(0);
      expect(result.failures).toHaveLength(0);
      expect(onProgress).toHaveBeenCalledWith({ done: 0, total: 0, agent: null });
    });
  });
});
