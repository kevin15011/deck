import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDaemon } from '../daemon';
import { resolveStatePaths } from '../paths';
import type { SessionEvent } from '@deck/core/session/events';

test('default daemon composition seeds quota, observes live events and exposes only authenticated safe snapshots',async()=>{
 const root=mkdtempSync(join(tmpdir(),'quota-daemon-'));
 const paths=resolveStatePaths({env:{XDG_STATE_HOME:root},tmpdir:root});
 const eventsDir=join(paths.sessionsDir,'s','events');mkdirSync(eventsDir,{recursive:true});
 const event=(runner:string,used:number,ts:number)=>({v:1,sessionId:'s',seq:1,kind:'rate-limit',source:{runnerId:runner},ts:new Date(ts).toISOString(),data:runner==='claude'?{unifiedWindows:{five_hour:{utilization:used/100}},overageStatus:'allowed'}:{primary:{windowDurationMins:300,usedPercent:used},accountId:'PRIVATE',credits:{balance:'PRIVATE'}}}) as SessionEvent;
 writeFileSync(join(eventsDir,'000001.jsonl'),JSON.stringify(event('codex',5,100))+'\n');
 const listeners=new Set<(event:SessionEvent)=>void>();let calls=0;
 const started=await startDaemon({paths,version:'test',recoverOnStart:false,anchorCommand:['unused'],idleMs:600000,web:{config:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false}},quotaRefresh:async runner=>{calls++;return event(runner,42,Date.now()).data;},createService:()=>({hasRunningWork:()=>false,openLog:()=>undefined,execute:async()=>({ok:true}),subscribeEvents:fn=>{listeners.add(fn);return()=>{listeners.delete(fn);};}})});
 if(!started.ok)throw Error('daemon failed');
 try{
 // Use the control transport to discover the dynamically selected Web port.
 const {ControlClient}=await import('../control-client');const client=await ControlClient.connect(paths.socket.path);
 let url:string;
 try{const reply=await client.request({t:'daemon.status'});url=(reply as any).status.web.url;}finally{client.close();}
 const local=await fetch(url!+'/api/local-access',{method:'POST',headers:{Origin:url!,'Content-Type':'application/json'},body:'{}'});
 const cookie=local.headers.get('set-cookie')!.split(';')[0]!,headers={Cookie:cookie,Origin:url!,'Content-Type':'application/json'};
 const read=async()=>await(await fetch(url!+'/api/quota',{headers})).json();
 expect((await read()).runners.codex.snapshot.windows[0].usedPercent).toBe(5);
 for(const listener of listeners)listener(event('claude',30,200));expect((await read()).runners.claude.snapshot.windows[0].usedPercent).toBe(30);
 const refresh=await fetch(url!+'/api/quota/codex/refresh',{method:'POST',headers,body:'{}'});expect(refresh.status).toBe(200);
 const body=await refresh.json();expect(body.state.runners.codex.snapshot.windows[0].usedPercent).toBe(42);expect(JSON.stringify(body)).not.toContain('PRIVATE');expect(calls).toBe(1);
 expect((await fetch(url!+'/api/quota/codex/refresh',{method:'POST',headers,body:'{}'})).status).toBe(429);
 }finally{await started.daemon.stop('test');rmSync(root,{recursive:true,force:true});}
 expect(listeners.size).toBe(0);
});
