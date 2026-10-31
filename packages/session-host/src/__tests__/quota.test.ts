import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QuotaStore, quotaSnapshot } from '../quota';

const codex = {primary:{usedPercent:24,windowDurationMins:300,resetsAt:1900000000},secondary:{usedPercent:51,windowDurationMins:10080,resetsAt:1900010000},planType:'pro',credits:{balance:123},accountId:'private'};
test('normalizes reported windows only and excludes private and unknown fields',()=>{
 expect(quotaSnapshot('codex',codex,1000)).toEqual({runnerId:'codex',updatedAt:1000,windows:[{id:'five-hour',usedPercent:24,resetsAt:1900000000000},{id:'seven-day',usedPercent:51,resetsAt:1900010000000}],plan:'pro'});
 expect(quotaSnapshot('claude',{unifiedWindows:{five_hour:{utilization:.32,resetsAt:1900000000}},overageStatus:'allowed',overageUtilization:.2,accountId:'private'},1000)).toEqual({runnerId:'claude',updatedAt:1000,windows:[{id:'five-hour',usedPercent:32,resetsAt:1900000000000}],overageStatus:'allowed'});
 expect(quotaSnapshot('codex',{primary:{usedPercent:NaN,windowDurationMins:300},planType:'api'},1)?.windows).toEqual([]);
 expect(quotaSnapshot('claude',{unifiedWindows:{seven_day:{utilization:2}}},1)?.windows).toEqual([]);
});
test('refresh serializes effects, imposes cooldown across clients and keeps previous snapshot on no event or failure',async()=>{
 let now=1000,calls=0,resolve!:(value:unknown)=>void;
 const store=new QuotaStore({now:()=>now,refresh:async()=>{calls++;return new Promise(r=>resolve=r);}});
 store.observe({kind:'rate-limit',source:{runnerId:'codex'},data:codex,ts:new Date(100).toISOString()} as any);
 const first=store.refresh('codex');expect((await store.refresh('codex')).code).toBe('quota-cooldown');
 resolve(undefined);expect((await first).code).toBe('quota-no-data');expect(store.read().runners.codex.snapshot?.updatedAt).toBe(100);expect(calls).toBe(1);
 now+=60001;const next=store.refresh('codex');resolve({primary:codex.primary});expect((await next).ok).toBe(true);expect(store.read().runners.codex.snapshot?.windows).toHaveLength(1);
 const failed=new QuotaStore({refresh:async()=>{throw Error('secret payload');}});expect(JSON.stringify(await failed.refresh('claude'))).not.toContain('secret payload');
});
test('seeds latest per runner from ledgers, ignores malformed tails and old live events',async()=>{
 const root=mkdtempSync(join(tmpdir(),'quota-seed-'));
 try{
 const dir=join(root,'s','events');mkdirSync(dir,{recursive:true});
 const event=(ts:number,data:any)=>({kind:'rate-limit',source:{runnerId:'codex'},data,ts:new Date(ts).toISOString()});
 writeFileSync(join(dir,'000001.jsonl'),[event(200,codex),event(100,{primary:codex.primary})].map(value=>JSON.stringify(value)).join('\n')+'\n{"truncated":');
 const store=new QuotaStore({refresh:async()=>undefined});await store.seed(root);
 store.observe(event(50,{} ) as any);expect(store.read().runners.codex.snapshot?.updatedAt).toBe(200);
 const web=JSON.stringify(store.read());expect(web).not.toContain('private');expect(web).not.toContain('credits');expect(web).not.toContain('accountId');
 }finally{rmSync(root,{recursive:true,force:true});}
});

test('historical Claude raw windows seed both bars and read snapshots cannot mutate store state',()=>{
 const store=new QuotaStore({});
 store.observe({kind:'rate-limit',ts:new Date(200).toISOString(),source:{runnerId:'claude'},data:{utilization:.4,rateLimitType:'seven_day'},raw:{runnerId:'claude',protocol:'claude-stream-json',truncated:false,payload:{rate_limit_info:{unifiedWindows:{five_hour:{utilization:.2},seven_day:{utilization:.4}},overageStatus:'allowed',credits:'PRIVATE'}}}} as any);
 const first=store.read();expect(first.runners.claude.snapshot?.windows.map(w=>w.usedPercent)).toEqual([20,40]);expect(first.runners.claude.snapshot?.overageStatus).toBe('allowed');
 first.runners.claude.snapshot!.windows.length=0;expect(store.read().runners.claude.snapshot?.windows).toHaveLength(2);
 expect(JSON.stringify(store.read())).not.toContain('PRIVATE');
});
