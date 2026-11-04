import type { ReactNode } from 'react';
import type { DashboardCheck } from '../../../../shared/dashboard.js';
import { Icon } from '../Icon.js';
import { dayLabel } from './blocks.js';

export interface PlanStripProps {
  check: DashboardCheck;
  /** Bỏ qua khối này khi tool không công bố gói lẫn model mặc định. */
  showModel?: boolean;
}

function Cell({ icon, label, title, children }: { icon: 'tasks' | 'system'; label: string; title?: string; children: ReactNode }) {
  return (
    <div className="dash-strip-cell">
      <Icon name={icon} size={16} />
      <div className="dash-strip-body">
        <span className="dash-strip-label">{label}</span>
        <strong className="dash-strip-value" title={title}>{children}</strong>
      </div>
    </div>
  );
}

/** Dải "Gói / Model mặc định" — hai thông tin cần nhìn thấy đầu tiên của mỗi tool. */
export function PlanStrip({ check, showModel = true }: PlanStripProps) {
  const plan = check.plan;
  const renews = plan?.renewsAt ? dayLabel(plan.renewsAt) : null;
  const model = check.currentModel ?? null;
  return (
    <div className="dash-strip">
      <Cell icon="tasks" label="Gói" title={plan ? `${plan.name} · nguồn ${plan.source}` : undefined}>
        {plan ? <span className="dash-truncate">{plan.name}</span> : <span className="dash-unknown">Chưa có dữ liệu</span>}
      </Cell>
      {showModel ? (
        <Cell icon="system" label="Model mặc định" title={model?.id}>
          {model ? (
            <>
              <span className="dash-truncate">{model.label}</span>
              {model.effort ? <span className="dash-effort"> · effort {model.effort}</span> : null}
            </>
          ) : (
            <span className="dash-unknown">Chưa có dữ liệu</span>
          )}
        </Cell>
      ) : null}
      {renews ? <p className="dash-strip-note">Gói gia hạn {renews}</p> : null}
    </div>
  );
}
