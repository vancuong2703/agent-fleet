import headless from '@xterm/headless';
import {expect,test} from 'vitest';
import {snapshotTerminal} from '../../server/terminal-status.js';

test('CLI screen reconstruction replaces stale balances rather than joining ANSI fragments',async()=>{
 const screen=new headless.Terminal({cols:80,rows:5,allowProposedApi:true});
 try{
  await new Promise<void>(resolve=>screen.write('Remaining AI Credits: 9999',resolve));
  await new Promise<void>(resolve=>screen.write('\r\x1b[2KRemaining AI Credits: 0',resolve));
  expect(snapshotTerminal(screen)).toBe('Remaining AI Credits: 0');
 }finally{screen.dispose();}
});
test('cursor spacing split across PTY chunks preserves status columns',async()=>{
 const screen=new headless.Terminal({cols:80,rows:5,allowProposedApi:true});
 try{
  await new Promise<void>(resolve=>screen.write('Account:\x1b[',resolve));
  await new Promise<void>(resolve=>screen.write('3Ctest@example.com\r\nWeekly limit: 39% left',resolve));
  expect(snapshotTerminal(screen)).toContain('Account:   test@example.com');
  expect(snapshotTerminal(screen)).toContain('Weekly limit: 39% left');
 }finally{screen.dispose();}
});
