import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {expect,test,type Page} from '@playwright/test';

async function setup(page:Page){
 const tools=['codex','agy'].map(agent=>({agent,title:agent==='codex'?'Codex':'Antigravity (AGY)',installed:true,configuredBin:null,lastCheck:null,suggestions:[{id:`${agent}-status`,label:'Trạng thái',command:'/status',context:'interactive',description:'Đọc trạng thái CLI.'}]}));
 await page.route('**/api/dashboard',route=>route.fulfill({json:{generatedAt:Date.now(),tools,terminalSessions:[]}}));
 await page.route('**/api/terminal-sessions',route=>{const {agent}=route.request().postDataJSON();return route.fulfill({json:{id:`session-${agent}`,agent,title:`${agent} workspace`,cwd:'C:\\workspace',source:'workspace',planId:null,taskId:null,createdAt:Date.now(),connected:true,reconnectGraceMs:300000}});});
 const state={connections:0,messages:[] as Array<{t:string;d?:string}>,output:(_text:string)=>{}};
 await page.routeWebSocket('**/ws/terminal?**',socket=>{
  state.connections++;
  socket.onMessage(message=>state.messages.push(JSON.parse(String(message))));
  state.output=text=>socket.send(JSON.stringify({t:'out',d:text}));
  state.output(Array.from({length:200},(_,index)=>`history-line-${index}`).join('\r\n')+'\r\n');
 });
 const token=(await readFile(path.join(process.env.FLEET_DATA_DIR!,'token'),'utf8')).trim();
 await page.goto(`/auth?token=${encodeURIComponent(token)}`);
 return state;
}

test('wheel scrolls terminal history and TUI pagers without leaking to the page',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'Mở Codex',exact:true}).click();
 await expect(page.getByRole('button',{name:'Terminal',exact:true})).toHaveClass('active');
 const rows=page.locator('.terminal-session:not([hidden]) .xterm-rows');
 await expect(rows).toContainText('history-line-199');
 const outer=page.locator('.terminal-page');
 await page.locator('.terminal-host').hover();
 const initialTop=await outer.evaluate(el=>el.scrollTop);
 await page.mouse.wheel(0,-400);
 await expect(rows).not.toContainText('history-line-199');
 expect(await outer.evaluate(el=>el.scrollTop)).toBe(initialTop);
 // A live normal-buffer pager must receive real keyboard input as AGY does.
 state.output('\x1b[3J\x1b[2J\x1b[HModels & Quota\r\n1–8 of 38 lines\r\n↑/↓ Scroll · pgup/pgdown Page · esc Close');
 await expect(rows).toContainText('Models & Quota');
 const before=state.messages.length;
 await page.mouse.wheel(0,120);
 await expect.poll(()=>state.messages.slice(before).some(m=>m.t==='in'&&m.d?.includes('\x1b[B'))).toBe(true);
 expect(await outer.evaluate(el=>el.scrollTop)).toBe(initialTop);
});

test('alternate-screen wheel and native mouse tracking both reach the PTY',async({page})=>{
 const state=await setup(page);await page.getByRole('button',{name:'Mở Codex',exact:true}).click();
 const rows=page.locator('.terminal-session:not([hidden]) .xterm-rows');
 await expect(rows).toContainText('history-line-199');
 state.output('\x1b[?1049h\x1b[2J\x1b[HALTERNATE READY');await expect(rows).toContainText('ALTERNATE READY');
 await page.locator('.terminal-host').hover();const before=state.messages.length;await page.mouse.wheel(0,120);
 await expect.poll(()=>state.messages.slice(before).some(m=>m.d?.includes('\x1b[B'))).toBe(true);
 state.output('\x1b[?1000h\x1b[?1006hMOUSE READY');await expect(rows).toContainText('MOUSE READY');
 const mouseBefore=state.messages.length;await page.mouse.wheel(0,120);
 await expect.poll(()=>state.messages.slice(mouseBefore).some(m=>m.d?.includes('\x1b[<65;'))).toBe(true);
});

test('CLI tabs and navigation keep the same terminal connections alive',async({page})=>{
 const state=await setup(page);
 await page.getByRole('button',{name:'Mở Codex',exact:true}).click();
 await expect(page.locator('.terminal-connection')).toHaveText('Đã kết nối');
 await page.getByRole('button',{name:'Bảng điều khiển',exact:true}).click();
 await page.getByRole('button',{name:'Mở Antigravity (AGY)',exact:true}).click();
 await expect(page.getByRole('tab')).toHaveCount(2);
 await page.getByRole('tab',{name:'codex workspace'}).click();
 await expect(page.locator('.terminal-session:not([hidden]) .xterm-rows')).toContainText('history-line-199');
 await page.getByRole('button',{name:'Công việc',exact:true}).click();
 await page.getByRole('button',{name:'Terminal',exact:true}).click();
 await page.getByRole('tab',{name:'agy workspace'}).click();
 await page.getByRole('tab',{name:'codex workspace'}).click();
 expect(state.connections).toBe(2);
 await expect(page.locator('.sidebar-brand svg')).toHaveCount(0);
});

test('a tab can be closed after its CLI has already exited on the server',async({page})=>{
 await setup(page);
 await page.route('**/api/terminal-sessions/session-codex',route=>route.fulfill({status:404,json:{message:'Terminal session not found'}}));
 await page.getByRole('button',{name:'Mở Codex',exact:true}).click();
 await page.getByRole('button',{name:'Kết thúc tiến trình codex workspace',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Kết thúc tiến trình',exact:true}).click();
 await expect(page.getByRole('tab')).toHaveCount(0);
 await expect(page.getByRole('heading',{name:'Mở một phiên terminal'})).toBeVisible();
});
