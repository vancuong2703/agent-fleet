import type { CommandProbeResult } from '../../dashboard.js';
import { createParseContext, amount, lastMatch, type ParsedCliStatus, type DashboardEnrichment, type DashboardEnrichmentContext } from './common.js';

export function parseQoderStatus(results: CommandProbeResult[], redact: (text: string) => string): ParsedCliStatus {
  const { result, text, source, add } = createParseContext(results, redact);
  let { account, quota, credits } = result;
  for (const result of results) {
    let json: Record<string, unknown>;
    try { json = JSON.parse(result.stdout); if (!json || typeof json !== 'object' || Array.isArray(json)) continue; } catch { continue; }
    if (typeof json.logged_in === 'boolean') {
      account = {state:json.logged_in?'authenticated':'unauthenticated',label:json.logged_in?redact(String(json.username ?? json.email ?? 'Đã đăng nhập')):'Chưa đăng nhập',source:result.command,reason:null};
      if (typeof json.user_type === 'string') add('Gói tài khoản',json.user_type);
    }
  }
  {
    let remaining=0, found=false;
    for(const [pattern,label] of [[/Plan\s*Credits\s*Used\s*:\s*([\d,.]+)\s*\/\s*([\d,.]+)/g,'Credit gói'],[/Add-on\s*Credits\s*Used\s*:\s*([\d,.]+)\s*\/\s*([\d,.]+)/g,'Credit bổ sung']] as const){
      const match=lastMatch(text,pattern);if(!match)continue;
      const used=amount(match[1]!),limit=amount(match[2]!);if(!Number.isFinite(used)||!Number.isFinite(limit)||used<0||limit<0)continue;
      const left=Math.max(0,limit-used);remaining+=left;found=true;add(label,`${left} còn lại · đã dùng ${used}/${limit}`);
      if(label==='Credit gói')quota={remaining:left,unit:'credits',resetAt:null,source,reason:null};
    }
    if(found)credits={remaining,unit:'credits',resetAt:null,source,reason:null};
  }
  return { ...result, account, quota, credits };
}

/** Read-only enrichment hook populated by the agent data task. */
export async function enrichQoder(_context: DashboardEnrichmentContext): Promise<DashboardEnrichment> {
  return {};
}
