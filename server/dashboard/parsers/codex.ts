import type { CommandProbeResult } from '../../dashboard.js';
import { createParseContext, lastMatch, type ParsedCliStatus, type DashboardEnrichment, type DashboardEnrichmentContext } from './common.js';

export function parseCodexStatus(results: CommandProbeResult[], redact: (text: string) => string): ParsedCliStatus {
  const { result, text, source, add } = createParseContext(results, redact);
  const { details } = result;
  let { account, quota, credits } = result;
  {
    const identity = lastMatch(text,/Account:\s*([^\r\n]+)/g)?.[1]?.trim();
    if (identity) account={state:'authenticated',label:redact(identity),source,reason:null};
    for (const match of text.matchAll(/(5h|Weekly)\s*limit:\s*[^\r\n]*?(\d+(?:\.\d+)?)%\s*left(?:\s*\(resets\s*([^\r\n)]+)\))?/gi)) {
      const value=Number(match[2]);if(value<0||value>100)continue;
      const label=match[1]!.toLowerCase()==='5h'?'Hạn mức 5 giờ':'Hạn mức tuần';
      if(details.some(detail=>detail.label===label))continue;
      add(label,`${value}% còn lại${match[3]?` · reset ${match[3]}`:''}`);
      if(match[1]!.toLowerCase()==='5h'||quota.remaining===null)quota={remaining:value,unit:'percent',resetAt:match[3]??null,source,reason:null};
    }
    const model=lastMatch(text,/\bModel:\s*([^\r\n]+)/g)?.[1];if(model)add('Model CLI',model.trim());
  }
  return { ...result, account, quota, credits };
}

/** Read-only enrichment hook populated by the agent data task. */
export async function enrichCodex(_context: DashboardEnrichmentContext): Promise<DashboardEnrichment> {
  return {};
}
