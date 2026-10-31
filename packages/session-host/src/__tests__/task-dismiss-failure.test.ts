import {expect,test} from 'bun:test';
import {randomUUID} from 'node:crypto';
import {SessionManager} from '../session-manager';
import {Ledger} from '../ledger';
import {summarizeActivity} from '../activity-summary';
import type {EventDraft} from '../event-log';

// Protects user authority, exact-attempt targeting, and durable idempotency at command dispatch.
function fixture(){
 const state=Ledger.empty('s').toState();
 state.tasks.worker={taskId:'worker',memberId:'review',attempts:[{attempt:1,runnerId:'fake',modelId:'fake',startedSeq:1,state:'failed'}]};
 const ledger=Ledger.fromState(state);
 const live={ledger,log:{appendMany(drafts:EventDraft[]){return drafts.map(d=>{const e={...d,v:1 as const,sessionId:'s',seq:ledger.seq+1,ts:new Date().toISOString(),source:d.source??{},data:d.data??{}};ledger.apply(e);return e;});},flush(){}}};
 const manager=Object.assign(Object.create(SessionManager.prototype),{executing:new Map(),load:()=>live}) as SessionManager;
 const command={v:1 as const,commandId:randomUUID(),type:'task.dismiss-failure' as const,taskId:'worker',attempt:1};
 return {ledger,command,send:(patch={},clientId='web:test')=>manager.execute({sessionId:'s',clientId,command:{...command,...patch}})};
}
test('user dismissal persists a discarded integration and replay does not duplicate it',async()=>{
 const f=fixture();expect(summarizeActivity(f.ledger,'lead').errors).toBe(1);
 expect((await f.send()).ok).toBe(true);
 expect(f.ledger.latest('worker')?.integration?.state).toBe('discarded');
 expect(summarizeActivity(f.ledger,'lead').errors).toBe(0);
 expect(await f.send()).toMatchObject({ok:true,duplicate:true});
 expect(f.ledger.latest('worker')?.integrations).toHaveLength(1);
 expect(await f.send({attempt:2})).toMatchObject({ok:false,code:'command-id-reused'});
});
test('non-user callers, stale attempts and unsettled ownership cannot dismiss a failure',async()=>{
 const f=fixture();
 expect(await f.send({},'mcp:lead')).toMatchObject({ok:false,code:'task-dismiss-user-required'});
 expect(await f.send({attempt:2})).toMatchObject({ok:false,code:'task-not-dismissible'});
 f.ledger.latest('worker')!.state='ownership-unsettled';
 expect(await f.send()).toMatchObject({ok:false,code:'task-not-dismissible'});
 expect(summarizeActivity(f.ledger,'lead').errors).toBe(1);
 expect(f.ledger.latest('worker')?.integration).toBeUndefined();
});
