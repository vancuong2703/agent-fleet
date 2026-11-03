import {describe, expect, test} from 'vitest';
import {buildDashboardCheck, type CommandProbeResult} from '../../server/dashboard.js';

const result=(command:string,stdout='',stderr='',ok=true):CommandProbeResult=>({command,stdout,stderr,ok,exitCode:ok?0:1,kind:'status'});
const tty=(command:string,text:string)=>result(`agent.exe → ${command}`,text);
describe('actual CLI status formats',()=>{
 test('Codex reads login status from stderr',()=>{
  const check=buildDashboardCheck('codex',true,[result('codex login status','','Logged in using ChatGPT')],1);
  expect(check.account.state).toBe('authenticated');
 });
 test('Codex nonzero logged-out status requires login',()=>{
  const check=buildDashboardCheck('codex',true,[result('codex login status','','Not logged in',false)],1);
  expect(check.status).toBe('needs-login');
 });
 test('Codex parses both windows including zero remaining and reset text',()=>{
  const check=buildDashboardCheck('codex',true,[tty('/status','Model: GPT-6.1-Sol (reasoning high)\nAccount: test@example.com (Plus)\n5h limit: [████░]0%left (resets 8:30 PM)\nWeekly limit: [██░]39% left (resets 3:17 PM on 4 Nov)')],1);
  expect(check.quota).toMatchObject({remaining:0,unit:'percent',resetAt:'8:30 PM'});
  expect(check.account).toMatchObject({state:'authenticated',label:'***@example.com (Plus)'});
  expect(check.details).toContainEqual({label:'Hạn mức tuần',value:'39% còn lại · reset 3:17 PM on 4 Nov'});
 });
 test('Codex refreshing or invalid percentage never becomes a fabricated balance',()=>{
  for(const text of ['Limits: refresh requested; run /status again shortly.','5h limit: [] 125% left'])expect(buildDashboardCheck('codex',true,[tty('/status',text)],1).quota.remaining).toBeNull();
 });
 test('Qoder JSON determines account and usage parses compact ConPTY output',()=>{
  const check=buildDashboardCheck('qodercli',true,[result('qodercli status -o json',JSON.stringify({logged_in:true,username:'Tester',user_type:'pro_trial'})),tty('/usage','QoderPlan:ProTrialPlanCreditsUsed:300/300Add-onCreditsUsed:245/800OrgResourcePackage:N/A')],1);
  expect(check.account).toMatchObject({state:'authenticated',label:'Tester'});
  expect(check.quota.remaining).toBe(0);
  expect(check.credits).toMatchObject({remaining:555,unit:'credits'});
 });
 test('Qoder zero total is retained and malformed JSON does not imply login',()=>{
  expect(buildDashboardCheck('qodercli',true,[tty('/usage','Plan Credits Used: 300/300 Add-on Credits Used: 800/800')],1).credits.remaining).toBe(0);
  expect(buildDashboardCheck('qodercli',true,[result('qodercli status -o json','{broken')],1).account.state).toBe('unknown');
  expect(buildDashboardCheck('qodercli',true,[result('qodercli status -o json','{"logged_in":false}')],1).status).toBe('needs-login');
 });
 test('AGY final account supersedes transient sign-in screen; disabled credits is not zero',()=>{
  const check=buildDashboardCheck('agy',true,[tty('/help → /credits','You are currently not signed in. Signing in...\nVersion 1.4.12\ntest@example.com (Google AI Pro)\nRemaining AI Credits: AI Credits not enabled (enable in /settings)')],1);
  expect(check.account.state).toBe('authenticated');
  expect(check.credits.remaining).toBeNull();
  expect(check.credits.reason).toContain('chưa được bật');
 });
 test('AGY parses an explicitly reported numerical credit balance',()=>{
  expect(buildDashboardCheck('agy',true,[tty('/credits','Remaining AI Credits: 1,250')],1).credits.remaining).toBe(1250);
 });
 test('AGY keeps distinct model buckets and selects the active model quota without summing percentages',()=>{
  const screen='Models & Quota\nGEMINI MODELS\nWeekly Limit Remaining\n[██░] 96.85%\nRefreshes in 74h 28m\nFive Hour Limit Remaining\n[███] 100.00%\nQuota available\nCLAUDE AND GPT MODELS\nWeekly Limit Remaining\n[██░] 99.00%\nRefreshes in 66h 1m\nFive Hour Limit Remaining\n[███] 100.00%\nGEMINI 4 ARGON\nGemini 4 Argon Weekly Limit\n[█░░] 6.16%\nRefreshes in 67h 30m\nGemini 4 Argon · medium';
  const check=buildDashboardCheck('agy',true,[tty('/help → /usage → /credits',screen+'\n'+screen)],1);
  expect(check.quotas).toHaveLength(5);
  expect(check.quotas).toContainEqual({group:'GEMINI MODELS',window:'5 giờ',remaining:100,reset:null});
  expect(check.quota).toMatchObject({remaining:6.16,unit:'percent',resetAt:'Làm mới sau 67h 30m'});
  expect(buildDashboardCheck('agy',true,[tty('/usage',screen.replace('Gemini 4 Argon · medium','Claude Sonnet · high'))],1).quota.remaining).toBe(99);
  expect(buildDashboardCheck('agy',true,[tty('/usage','GEMINI MODELS\nWeekly Limit Remaining\nUnavailable\nFive Hour Limit Remaining\n[███] 100.00%')],1).quotas?.some(row=>row.window==='Tuần')).toBe(false);
 });
 test('OpenCode credentials and daily token statistics stay separate from remaining quota',()=>{
  const check=buildDashboardCheck('opencode',true,[result('opencode auth list','Groq  Personal  stored\nTinyFish  TINYFISH_API_KEY  environment'),result('opencode stats --json --days 0',JSON.stringify({sessions:4,tokens:{input:1234,output:567},cost:0,models:[{model:{id:'flash:free',providerID:'pool'}}]}))],1);
  expect(check.account).toMatchObject({state:'unknown',label:'2 kết nối đã cấu hình'});
  expect(check.quota.remaining).toBeNull();expect(check.credits.remaining).toBeNull();
  expect(check.details).toContainEqual({label:'CLI hôm nay · USD',value:'0'});
  expect(check.details).toContainEqual({label:'Model đã dùng hôm nay',value:'pool / flash:free'});
 });
});
