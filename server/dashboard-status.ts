import type { DashboardAgent, DashboardBalance, DashboardCheck } from '../shared/dashboard.js';
import type { CommandProbeResult } from './dashboard.js';

const unknown = (source: string, reason: string): DashboardBalance => ({remaining:null,unit:null,resetAt:null,source,reason});
const amount = (value: string) => Number(value.replaceAll(',', ''));
const lastMatch = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].at(-1);

/** Parse the installed CLIs' actual text/JSON formats. Never derive a balance
 * from tokens or cost; Qoder remaining = explicit limit minus explicit used. */
export function parseCliStatus(agent: DashboardAgent, results: CommandProbeResult[], redact: (text: string) => string) {
  const details: NonNullable<DashboardCheck['details']> = [];
  const quotas: NonNullable<DashboardCheck['quotas']> = [];
  const tty = results.find(r => r.command.includes('→'));
  const text = results.map(r => `${r.stdout}\n${r.stderr}`).join('\n');
  const source = tty?.command ?? results.find(r => r.kind === 'status')?.command ?? 'CLI';
  let quota = unknown(source, 'Lệnh trạng thái chưa trả hạn mức còn lại.');
  let credits = unknown(source, 'Lệnh trạng thái chưa trả số credit còn lại.');
  let account: DashboardCheck['account'] | undefined;
  const add = (label: string, value: string) => details.push({label,value:redact(value).slice(0,300)});

  for (const result of results) {
    let json: Record<string, unknown>;
    try { json = JSON.parse(result.stdout); if (!json || typeof json !== 'object' || Array.isArray(json)) continue; } catch { continue; }
    if (agent === 'qodercli' && typeof json.logged_in === 'boolean') {
      account = {state:json.logged_in?'authenticated':'unauthenticated',label:json.logged_in?redact(String(json.username ?? json.email ?? 'Đã đăng nhập')):'Chưa đăng nhập',source:result.command,reason:null};
      if (typeof json.user_type === 'string') add('Gói tài khoản',json.user_type);
    }
    if (agent === 'opencode' && typeof json.sessions === 'number' && json.tokens && typeof json.tokens === 'object') {
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
  if (agent === 'codex') {
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
  if (agent === 'qodercli') {
    let remaining=0, found=false;
    for(const [pattern,label] of [[/Plan\s*Credits\s*Used\s*:\s*([\d,.]+)\s*\/\s*([\d,.]+)/g,'Credit gói'],[/Add-on\s*Credits\s*Used\s*:\s*([\d,.]+)\s*\/\s*([\d,.]+)/g,'Credit bổ sung']] as const){
      const match=lastMatch(text,pattern);if(!match)continue;
      const used=amount(match[1]!),limit=amount(match[2]!);if(!Number.isFinite(used)||!Number.isFinite(limit)||used<0||limit<0)continue;
      const left=Math.max(0,limit-used);remaining+=left;found=true;add(label,`${left} còn lại · đã dùng ${used}/${limit}`);
      if(label==='Credit gói')quota={remaining:left,unit:'credits',resetAt:null,source,reason:null};
    }
    if(found)credits={remaining,unit:'credits',resetAt:null,source,reason:null};
  }
  if (agent === 'agy') {
    const identity=lastMatch(text,/\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,})([^\r\n]*)/g)?.[0];
    if(identity)account={state:'authenticated',label:redact(identity).slice(0,150),source,reason:null};
    const credit=lastMatch(text,/Remaining\s*(?:AI\s*)?Credits\s*:\s*([\d,.]+)/gi);
    if(credit&&Number.isFinite(amount(credit[1]!)))credits={remaining:amount(credit[1]!),unit:'credits',resetAt:null,source,reason:null};
    else if(/AI\s*Credits\s*not\s*enabled/i.test(text))credits=unknown(source,'AI Credits chưa được bật trong tài khoản AGY.');
    const model=lastMatch(text,/((?:Gemini|Claude|GPT|Qwen|DeepSeek)[^\r\n·]{0,65})\s*·\s*(low|medium|high|max)/g);if(model)add('Model CLI',`${model[1]!.trim()} · ${model[2]}`);
    let group = '';
    const lines = text.split(/\r?\n/);
    for (let index=0;index<lines.length;index++) {
      const line=lines[index]!.trim();
      if (/^(?:GEMINI MODELS|CLAUDE AND GPT MODELS|GEMINI 4 ARGON)$/i.test(line)) group=line;
      if (!group) continue;
      const window=/Five\s*Hour\s*Limit\s*Remaining/i.test(line)?'5 giờ':/Weekly\s*Limit(?:\s*Remaining)?/i.test(line)?'Tuần':null;
      if(!window)continue;
      let end=Math.min(index+5,lines.length);
      for(let next=index+1;next<end;next++)if(/Weekly\s*Limit|Five\s*Hour\s*Limit|^(?:GEMINI MODELS|CLAUDE AND GPT MODELS|GEMINI 4 ARGON)$/i.test(lines[next]!.trim())){end=next;break;}
      const portion=lines.slice(index,end).join('\n');
      const percentage=portion.match(/(\d+(?:\.\d+)?)\s*%/);
      if(!percentage)continue;
      const remaining=Number(percentage[1]);if(remaining<0||remaining>100)continue;
      const reset=portion.match(/Refreshes\s+in\s+([^\r\n]+)/i)?.[1]?.trim()??null;
      const row={group,window,remaining,reset:reset?`Làm mới sau ${reset}`:null};
      const existing=quotas.findIndex(item=>item.group===group&&item.window===window);
      if(existing<0)quotas.push(row);else quotas[existing]=row;
    }
    // Preserve all groups separately. The main number represents the selected
    // model's weekly bucket; never sum percentages across unrelated models.
    const selectedGroup=/Argon/i.test(model?.[1]??'')?'GEMINI 4 ARGON':/Claude|GPT/i.test(model?.[1]??'')?'CLAUDE AND GPT MODELS':/Gemini/i.test(model?.[1]??'')?'GEMINI MODELS':null;
    const primary=quotas.find(item=>item.group===selectedGroup&&item.window==='Tuần');
    if(primary)quota={remaining:primary.remaining,unit:'percent',resetAt:primary.reset,source,reason:null};
  }
  if(agent==='opencode'){
    const auth=results.find(r=>/auth list$/.test(r.command)&&r.ok);
    const entries=auth?.stdout.split(/\r?\n/).filter(line=>/\s+(?:stored|environment)\s*$/.test(line));
    if(entries?.length){account={state:'unknown',label:`${entries.length} kết nối đã cấu hình`,source:auth!.command,reason:'Đã đọc thông tin cấu hình; chưa xác thực hiệu lực của từng credential.'};for(const entry of entries)add('Kết nối CLI',entry.trim());}
  }
  return {account,quota,credits,details,quotas};
}
