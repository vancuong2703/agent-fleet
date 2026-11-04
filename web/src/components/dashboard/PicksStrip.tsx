import type { DashboardTool } from '../../../../shared/dashboard.js';
import type { Pick } from '../../../../shared/dashboard-picks.js';
import { rankPicks } from '../../../../shared/dashboard-picks.js';
import type { CliWorkspace, NoticeKind } from '../../cli-workspace.js';
import { copyText } from '../../desktop.js';
import { dashboardStrings } from '../../strings.js';
import { Icon } from '../Icon.js';

const S = dashboardStrings.picks;

/** Mockup: tối đa 3 gợi ý và 1 cảnh báo. */
export const MAX_PICKS = 3;
export const MAX_WARNINGS = 1;

export interface PicksView {
  picks: Pick[];
  warning: Pick | null;
}

/**
 * `rankPicks` trộn gợi ý và cảnh báo trong cùng một mảng. Phải lọc theo loại
 * trước khi cắt, nếu không một cảnh báo có thể chiếm mất chỗ của gợi ý (hoặc
 * ngược lại) và dải sẽ hiện ít hơn số lượng người dùng cần thấy.
 */
export function visiblePicks(tools: readonly DashboardTool[]): PicksView {
  const ranked = rankPicks(tools);
  return {
    picks: ranked.filter((pick) => pick.kind !== 'warning').slice(0, MAX_PICKS),
    warning: ranked.filter((pick) => pick.kind === 'warning').slice(0, MAX_WARNINGS)[0] ?? null,
  };
}

/** Lệnh dán vào CLI cho gợi ý model; `null` với tool/cảnh báo hoặc model thiếu id. */
export function pickCommand(pick: Pick): string | null {
  return pick.kind === 'model' && pick.modelId ? `--model ${pick.modelId}` : null;
}

export interface PickActions {
  launch: (agent: Pick['agent']) => Promise<unknown> | unknown;
  copy: (text: string) => Promise<boolean> | boolean;
  notify?: (text: string, kind: NoticeKind) => void;
}

export type PickOutcome = 'launch' | 'copy' | 'copy-failed' | 'none';

/**
 * Hành vi khi bấm một gợi ý. Tách khỏi component để test được mà không cần DOM.
 * Tool thì mở đúng CLI như nút "Mở CLI"; model thì sao chép lệnh `--model`.
 */
export async function activatePick(pick: Pick, actions: PickActions): Promise<PickOutcome> {
  if (pick.kind === 'tool') {
    await actions.launch(pick.agent);
    return 'launch';
  }
  const command = pickCommand(pick);
  if (!command) return 'none';
  let copied = false;
  try {
    copied = await actions.copy(command);
  } catch {
    // Trình duyệt chặn clipboard (không phải HTTPS, thiếu quyền): báo để người dùng tự gõ.
    copied = false;
  }
  actions.notify?.(copied ? S.copied(command) : S.copyFailed(command), copied ? 'success' : 'error');
  return copied ? 'copy' : 'copy-failed';
}

/** Clipboard của trình duyệt; trả `false` thay vì ném lỗi khi không có quyền. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await copyText(text);
    return true;
  } catch {
    return false;
  }
}

export interface PicksStripProps {
  tools: readonly DashboardTool[];
  cli: CliWorkspace;
}

export function PicksStrip({ tools, cli }: PicksStripProps) {
  const { picks, warning } = visiblePicks(tools);
  const titleOf = (agent: Pick['agent']) => tools.find((item) => item.agent === agent)?.title ?? agent;
  const actions: PickActions = {
    launch: cli.launch,
    copy: copyToClipboard,
    notify: (text, kind) => cli.setMessage(text, kind),
  };

  return (
    <section className="dash-picks" aria-label={S.ariaLabel}>
      <div className="dash-section-h">
        <span>{S.title}</span>
        {picks.length ? <span className="dash-section-hint">{S.hint}</span> : null}
      </div>

      {!picks.length && !warning ? (
        <p className="dash-picks-empty">
          <Icon name="info" size={15} />
          <span>{S.empty}</span>
        </p>
      ) : null}

      <div className="dash-picks-list">
        {picks.map((pick, index) => {
          const command = pickCommand(pick);
          const model = pick.kind === 'model';
          return (
            <button
              type="button"
              className="dash-pick"
              data-kind={pick.kind}
              key={pick.id}
              aria-label={command ? S.copyModel(command) : S.openCli(pick.label)}
              onClick={() => void activatePick(pick, actions)}
            >
              <span className="dash-pick-rank" aria-hidden="true">{index + 1}</span>
              <span className="dash-pick-body">
                <b>{model ? `${titleOf(pick.agent)} · ${pick.label}` : pick.label}</b>
                <small>{pick.reason}</small>
                <span className="dash-pick-go" aria-hidden="true">
                  <Icon name={model ? 'copy' : 'terminal'} size={15} />
                  {model ? S.copyShort : S.openCliShort}
                </span>
              </span>
            </button>
          );
        })}

        {warning ? (
          <div className="dash-pick is-warn" data-kind="warning" role="note" aria-label={S.warning}>
            <span className="dash-pick-rank" aria-hidden="true">!</span>
            <span className="dash-pick-body">
              <b>{warning.label}</b>
              <small>{warning.reason}</small>
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
}
