import {expect,test,vi} from 'vitest';
const mock=vi.hoisted(()=>({resize:vi.fn(),kill:vi.fn(),spawn:vi.fn()}));
vi.mock('@lydell/node-pty',()=>({spawn:mock.spawn}));
import {PtyManager} from '../../server/pty.js';
test('unchanged PTY geometry never triggers repeated ConPTY redraws',()=>{
 mock.spawn.mockReturnValue({resize:mock.resize,kill:mock.kill,onData:vi.fn(),onExit:vi.fn()});
 const manager=new PtyManager(()=>({cmd:'cmd.exe',args:[],cwd:'C:\\test'}));
 const session=manager.open('one',100,30);
 for(let i=0;i<20;i++)session.resize(100,30);
 expect(mock.resize).not.toHaveBeenCalled();
 session.resize(110,35);session.resize(110,35);
 expect(mock.resize).toHaveBeenCalledExactlyOnceWith(110,35);
 manager.killAll();
});
