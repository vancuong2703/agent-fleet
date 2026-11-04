import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import type { Plan, Task } from '../../shared/types.js';

test('reconnect recovers missed tasks, terminal status and log without page reload', async ({page,context,request}) => {
  const dataDir = process.env.FLEET_DATA_DIR!;
  const token = (await readFile(path.join(dataDir,'token'),'utf8')).trim();
  const repoPath = (await readFile(path.join(dataDir,'repo-path'),'utf8')).trim();
  const headers = {'x-fleet-token':token};
  await page.addInitScript(() => {
    const Original = window.WebSocket;
    const sockets: WebSocket[] = [];
    Object.assign(window, {fleetTestSockets:sockets});
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {super(url,protocols);sockets.push(this);}
    };
  });
  await page.goto(`/auth?token=${encodeURIComponent(token)}`);
  await expect(page.locator('.connection')).toHaveAttribute('title','Đã kết nối');
  const planResponse = await request.post('/api/plans',{headers,data:{name:'Reconnect regression',repoPath}});
  expect(planResponse.ok()).toBeTruthy();
  const plan = await planResponse.json() as Plan;
  const taskResponse = await request.post('/api/tasks',{headers,data:{planId:plan.id,agent:'fake',title:'Recover interrupted run',brief:'[[hang]]'}});
  expect(taskResponse.ok()).toBeTruthy();
  const task = await taskResponse.json() as Task;
  await page.getByRole('button',{name:'Công việc',exact:true}).click();
  await page.getByRole('button',{name:task.title,exact:false}).click();
  await expect(page.locator('.log-text')).toContainText(['bắt đầu treo']);
  let navigations = 0;
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())navigations++;});
  await context.setOffline(true);
  await page.evaluate(() => {
    const target = window as unknown as {fleetTestSockets:WebSocket[]};
    for(const socket of target.fleetTestSockets) socket.close();
  });
  await expect(page.locator('.connection')).not.toHaveAttribute('title','Đã kết nối');
  const stop = await request.post(`/api/tasks/${task.id}/stop`,{headers,data:{}});
  expect(stop.ok()).toBeTruthy();
  const missedTask = await request.post('/api/tasks',{headers,data:{planId:plan.id,agent:'fake',title:'Created during disconnection',brief:'offline catchup'}});
  expect(missedTask.ok()).toBeTruthy();
  await context.setOffline(false);
  await expect(page.locator('.connection')).toHaveAttribute('title','Đã kết nối');
  await expect(page.getByRole('button',{name:'Created during disconnection',exact:false})).toBeVisible();
  await expect(page.locator('.detail-title .badge')).toHaveText('interrupted');
  await expect(page.locator('.kind-line-status .log-text').last()).toContainText('interrupted');
  expect(navigations).toBe(0);
});
