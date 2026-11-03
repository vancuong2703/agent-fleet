import type { CommandProbeResult } from '../../dashboard.js';
import { createParseContext, type ParsedCliStatus, type DashboardEnrichment, type DashboardEnrichmentContext } from './common.js';

export function parseOpencodeStatus(results: CommandProbeResult[], redact: (text: string) => string): ParsedCliStatus {
  const { result, add } = createParseContext(results, redact);
  let { account, quota, credits } = result;
  for (const result of results) {
    let json: Record<string, unknown>;
    try { json = JSON.parse(result.stdout); if (!json || typeof json !== 'object' || Array.isArray(json)) continue; } catch { continue; }
    if (typeof json.sessions === 'number' && json.tokens && typeof json.tokens === 'object') {
      const tokens=json.tokens as Record<string,unknown>;
      const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value.toLocaleString('vi-VN') : '—';
      add('CLI hôm nay · phiên',count(json.sessions));
      add('CLI hôm nay · token vào / ra',`${count(tokens.input)} / ${count(tokens.output)}`);
      if (typeof json.cost === 'number' && json.cost >= 0) add('CLI hôm nay · USD',String(json.cost));
      if (Array.isArray(json.models)) for (const row of json.models) {
        const model=row?.model;if (typeof model?.id === 'string') add('Model đã dùng hôm nay',`${model.providerID ?? ''} / ${model.id}`);
      }
    }
  }
  {
    const auth=results.find(r=>/auth list$/.test(r.command)&&r.ok);
    const entries=auth?.stdout.split(/\r?\n/).filter(line=>/\s+(?:stored|environment)\s*$/.test(line));
    if(entries?.length){account={state:'unknown',label:`${entries.length} kết nối đã cấu hình`,source:auth!.command,reason:'Đã đọc thông tin cấu hình; chưa xác thực hiệu lực của từng credential.'};for(const entry of entries)add('Kết nối CLI',entry.trim());}
  }
  return { ...result, account, quota, credits };
}

/** Read-only enrichment hook populated by the agent data task. */
export async function enrichOpencode(_context: DashboardEnrichmentContext): Promise<DashboardEnrichment> {
  return {};
}
