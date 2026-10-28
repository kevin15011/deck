import { expect, test } from 'bun:test';
import { createCodexSessionDriver } from './driver';
import { harness } from './test-support';
import { ISOLATION_FEATURES } from './launch';
import type { DriverTaskInput } from '@deck/core/session/driver';
for (const role of ['quality','investigate']) for (const bad of ['none','tool','server']) test(`${role} enforces read-only and rejects ${bad} exposure`,async()=>{
  const input:DriverTaskInput={taskId:'review',memberId:role,cwd:'/work',assignment:{runnerId:'codex',modelId:'fake'},rolePrompt:'',prompt:'review',approvals:'runner-default',credentialFile:'/private',disableNativeDelegation:true,mcp:{servers:['context7','deck'],sessionTools:[]},mcpServerSpecs:{context7:{command:'fixture',args:[],env:{}},deck:{command:'fixture',args:[],env:{}}}};
  const h=harness((child,_,m)=>{
    if(m.method==='initialize')child.stdout({id:m.id,result:{}});
    if(m.method==='config/read')child.stdout({id:m.id,result:{config:{features:Object.fromEntries(ISOLATION_FEATURES.map(f=>[f,false])),mcp_servers:{personal:{command:'foreign'}}}}});
    if(m.method==='thread/start')child.stdout({id:m.id,result:{thread:{id:'thread'}}});
    if(m.method==='mcpServerStatus/list')child.stdout({id:m.id,result:{data:[{name:'deck-session-review-context7',runtimeStatus:'connected',tools:{'query-docs':{},...(bad==='tool'?{write:{}}:{})}},...(bad==='server'?[{name:'personal',runtimeStatus:'connected',tools:{write:{}}}]:[])],nextCursor:null}});
    if(m.method==='turn/start') {child.stdout({id:m.id,result:{turn:{id:'turn'}}});}
  });
  const task=await createCodexSessionDriver().startTask(input,h.io);
  if(bad!=='none') {await expect(task.nativeSessionId).rejects.toThrow();expect((await task.done).status).toBe('failed');expect(h.children[0]!.writes.some(m=>m.method==='turn/start')).toBe(false);}
  else {await task.nativeSessionId;await Promise.resolve();const child=h.children[0]!;expect(child.writes.find(m=>m.method==='thread/start')?.params).toMatchObject({sandbox:'read-only',approvalPolicy:'never',config:{mcp_servers:{personal:{enabled:false},'deck-session-review-context7':{enabled_tools:['resolve-library-id','query-docs']}}}});expect((child.writes.find(m=>m.method==='thread/start')?.params as any).config.mcp_servers['deck-session-review-deck']).toBeUndefined();child.stdout({id:900,method:'item/fileChange/requestApproval',params:{threadId:'thread',turnId:'turn'}});await Promise.resolve();expect(child.writes.find(m=>m.id===900)?.result).toEqual({decision:'decline'});child.stdout({method:'turn/completed',params:{threadId:'thread',turn:{id:'turn',status:'completed'}}});await task.done;}
  await task.close();
});
