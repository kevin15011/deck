import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenCodeSessionDriver } from './driver';
import type { DriverTaskInput, SupervisedChildExit } from '@deck/core/session/driver';

// Protects natural close: completion must await owned process termination and stream drain.
test('natural close waits for owned process termination and coalesces repeated closes', async () => {
  const home=mkdtempSync(join(tmpdir(),'deck-process-close-')); const originalFetch=globalThis.fetch;
  let env:Record<string,string>={}, killed=false,exit!:(v:SupervisedChildExit)=>void, message:any,stopStream=()=>{};
  let releaseTermination!: () => void; const termination = new Promise<void>(resolve => { releaseTermination = resolve; });
  const exited=new Promise<SupervisedChildExit>(resolve=>exit=resolve);
  globalThis.fetch=(async (url:any, init:any) => {
    const path=new URL(String(url)).pathname;
    if (!String(url).startsWith('http://127.0.0.1:12345/')) throw new Error('external I/O forbidden');
    if(path==='/config')return Response.json(JSON.parse(env.OPENCODE_CONFIG_CONTENT!));
    if(path==='/mcp')return Response.json({});
    if(path==='/agent')return Response.json([{name:'build',permission:[]}]);
    if(path==='/session')return Response.json({id:'native'});
    if(path==='/session/native/message'){message=JSON.parse(init.body);return Response.json({info:{id:'answer',sessionID:'native'},parts:[{type:'text',text:'violet'}]});}
    if(path==='/event')return new Response(new ReadableStream({start(c){stopStream=()=>{try{c.close();}catch{}};c.enqueue(new TextEncoder().encode('data: {"type":"server.connected","properties":{}}\n\n'));init.signal.addEventListener('abort',()=>{try{c.close();}catch{}},{once:true});}}));
    return Response.json([]);
  }) as any;
  try {
    const input:DriverTaskInput={taskId:'t',memberId:'apply-deep',cwd:home,assignment:{runnerId:'opencode',modelId:'fake/model'},rolePrompt:'role',prompt:'current input',localContext:'historical violet',mcp:{servers:[],sessionTools:[]},mcpServerSpecs:{},approvals:'runner-default',credentialFile:join(home,'credential'),disableNativeDelegation:true};
    const driver=createOpenCodeSessionDriver({baseEnv:{HOME:home,XDG_CONFIG_HOME:home},readinessMs:300});
    const handle=await driver.startTask(input,{emit(){},approval:async()=>({decision:'deny'}),writePrivateFile:(name,content)=>{const path=join(home,name);writeFileSync(path,content,{mode:0o600});return path;},spawn:async(_c,_a,o)=>{
      env=o!.env!;return {ready:Promise.resolve({workerPid:process.pid}),exited,writeStdin(){},endStdin(){},onStdout(fn){queueMicrotask(()=>fn('opencode server listening on http://127.0.0.1:12345'));},onStderr(){},interrupt:()=>true,terminateGroup:async()=>{killed=true;await termination;stopStream();exit({ok:true,code:0,signal:null,drained:true,anchorLost:false});}};
    }});
    expect(await handle.done).toMatchObject({status:'completed'});
    expect(message.parts).toEqual([{type:'text',text:'current input'}]);expect(message.system).toContain('historical violet');
    const closing=handle.close();
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(killed).toBe(true);
    let settled = false; void closing.then(() => { settled = true; });
    expect(handle.close()).toBe(closing);
    await new Promise(resolve => setTimeout(resolve, 5)); expect(settled).toBe(false);
    releaseTermination(); await closing; expect(settled).toBe(true);
  } finally {globalThis.fetch=originalFetch;rmSync(home,{recursive:true,force:true});}
});
