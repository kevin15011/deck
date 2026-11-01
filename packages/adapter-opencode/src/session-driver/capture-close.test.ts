import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenCodeSessionDriver } from './driver';
import type { DriverTaskInput, SupervisedChildExit } from '@deck/core/session/driver';

// Protects natural close: the original held plugin disposal must finish before
// its owned process is killed; HTTP return alone is not a capture receipt.
test.each(['receipt','interrupt'])('natural task close handles held disposal: %s', async boundary => {
  const home=mkdtempSync(join(tmpdir(),'deck-capture-close-')); const originalFetch=globalThis.fetch;
  let env:Record<string,string>={}, disposed=false,killed=false,exit!:(v:SupervisedChildExit)=>void, message:any,stopStream=()=>{};
  const exited=new Promise<SupervisedChildExit>(resolve=>exit=resolve);
  globalThis.fetch=(async (url:any, init:any) => {
    const path=new URL(String(url)).pathname;
    if (!String(url).startsWith('http://127.0.0.1:12345/')) throw new Error('external I/O forbidden');
    if(path==='/config')return Response.json(JSON.parse(env.OPENCODE_CONFIG_CONTENT!));
    if(path==='/mcp')return Response.json({});
    if(path==='/experimental/tool/ids')return Response.json(['supermemory']);
    if(path==='/agent')return Response.json([{name:'build',permission:[]}]);
    if(path==='/session')return Response.json({id:'native'});
    if(path==='/session/native/message'){message=JSON.parse(init.body);return Response.json({info:{id:'answer',sessionID:'native'},parts:[{type:'text',text:'violet'}]});}
    if(path==='/event')return new Response(new ReadableStream({start(c){stopStream=()=>{try{c.close();}catch{}};c.enqueue(new TextEncoder().encode('data: {"type":"server.connected","properties":{}}\n\n'));init.signal.addEventListener('abort',()=>{try{c.close();}catch{}},{once:true});}}));
    if(path==='/instance/dispose'){disposed=true;stopStream();return Response.json(true);}
    return Response.json([]);
  }) as any;
  try {
    const input:DriverTaskInput={taskId:'t',memberId:'apply-deep',cwd:home,assignment:{runnerId:'opencode',modelId:'fake/model'},rolePrompt:'role',prompt:'current input',localContext:'historical violet',mcp:{servers:[],sessionTools:[]},mcpServerSpecs:{},approvals:'runner-default',credentialFile:join(home,'credential'),disableNativeDelegation:true,
      nativeMemory:{provider:'supermemory',integration:'runner-plugin',status:'ready',projectScope:'sm_project_v1_fixture',plugin:{root:home,loaderPath:join(home,'loader.mjs')}}};
    const driver=createOpenCodeSessionDriver({baseEnv:{HOME:home,XDG_CONFIG_HOME:home},readinessMs:300});
    const handle=await driver.startTask(input,{emit(){},approval:async()=>({decision:'deny'}),writePrivateFile:(name,content)=>{const path=join(home,name);writeFileSync(path,content,{mode:0o600});return path;},spawn:async(_c,_a,o)=>{
      env=o!.env!;return {ready:Promise.resolve({workerPid:process.pid}),exited,writeStdin(){},endStdin(){},onStdout(fn){queueMicrotask(()=>fn('opencode server listening on http://127.0.0.1:12345'));},onStderr(){},interrupt:()=>true,terminateGroup:async()=>{killed=true;exit({ok:true,code:0,signal:null,drained:true,anchorLost:false});}};
    }});
    expect(await handle.done).toMatchObject({status:'completed'});
    expect(message.parts).toEqual([{type:'text',text:'current input'}]);expect(message.system).toContain('historical violet');
    const closing=handle.close();
    await new Promise(resolve=>setTimeout(resolve,5));
    expect(disposed).toBe(true);expect(killed).toBe(false);
    if(boundary==='interrupt'){await handle.interrupt();await closing;expect(killed).toBe(true);expect(handle.captureOutcome?.()).toMatchObject({lifecycle:'unknown',acceptance:'unknown',reason:'close-interrupted'});return;}
    const ticket=env.DECK_NATIVE_CAPTURE_TICKET!;
    const binding=JSON.parse(readFileSync(ticket,'utf8'));
    writeFileSync(ticket,JSON.stringify({...binding,lifecycle:'completed',nativeSessionIds:['foreign'],acceptance:'unknown'}));
    await new Promise(resolve=>setTimeout(resolve,30));expect(killed).toBe(false);
    writeFileSync(ticket,JSON.stringify({...binding,lifecycle:'completed',nativeSessionIds:['native'],acceptance:'unknown'}));
    await closing;expect(killed).toBe(true);expect(handle.captureOutcome?.()).toMatchObject({lifecycle:'completed',acceptance:'unknown'});
  } finally {globalThis.fetch=originalFetch;rmSync(home,{recursive:true,force:true});}
});
