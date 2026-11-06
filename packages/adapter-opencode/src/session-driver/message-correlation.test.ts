import { expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createOpenCodeSessionDriver } from './driver';
import capturedRetry from './__fixtures__/user-retry.redacted.json';
import type { DriverEvent, DriverTaskInput, SupervisedChildExit } from '@deck/core/session/driver';

// Protects the production SSE/HTTP boundary: user, foreign and old-turn text must
// never become assistant output. Terminal outcomes must settle even without HTTP.
async function fixture(run: (f: { events: DriverEvent[]; emit: (type: string, properties: any) => Promise<void>; handle: Awaited<ReturnType<ReturnType<typeof createOpenCodeSessionDriver>['startTask']>>; requests: any[]; reply: (body: any) => void }) => Promise<void>) {
 const home = mkdtempSync(join(tmpdir(), 'deck-opencode-correlation-')), previous = globalThis.fetch;
 let env: Record<string,string> = {}, controller!: ReadableStreamDefaultController<Uint8Array>, exit!: (v: SupervisedChildExit) => void, reply!: (body: any) => void;
 const exited = new Promise<SupervisedChildExit>(resolve => { exit = resolve; });
 const events: DriverEvent[] = [], requests: any[] = [];
 globalThis.fetch = (async (url: any, init: any) => {
  const path = new URL(String(url)).pathname;
  if (!String(url).startsWith('http://127.0.0.1:12345/')) throw Error('external I/O forbidden');
  if (path === '/config') return Response.json(JSON.parse(env.OPENCODE_CONFIG_CONTENT!));
  if (path === '/mcp') return Response.json({});
  if (path === '/agent') return Response.json([{name:'build',permission:[]}]);
  if (path === '/session') return Response.json({id:'native'});
  if (path === '/event') return new Response(new ReadableStream({start(c) { controller = c; init.signal.addEventListener('abort', () => {try { c.close(); } catch {}}, {once:true}); }}));
  if (path === '/session/native/message') { requests.push(JSON.parse(init.body)); return new Promise<Response>((resolve,reject) => {reply = body => resolve(Response.json(body)); init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});}); }
  return Response.json([]);
 }) as any;
 let handle: Awaited<ReturnType<ReturnType<typeof createOpenCodeSessionDriver>['startTask']>> | undefined;
 try {
  const input: DriverTaskInput = {taskId:'t',memberId:'lead',cwd:home,assignment:{runnerId:'opencode',modelId:'opencode-go/deepseek-v4.1-flash'},rolePrompt:'role',prompt:'Hola',mcp:{servers:[],sessionTools:[]},mcpServerSpecs:{},approvals:'runner-default',credentialFile:join(home,'credential'),disableNativeDelegation:true};
  handle = await createOpenCodeSessionDriver({baseEnv:{HOME:home,XDG_CONFIG_HOME:home},readinessMs:300}).startTask(input, {
   emit:e=>{events.push(e);},approval:async()=>({decision:'deny'}),writePrivateFile:(name,content)=>{const path=join(home,name);writeFileSync(path,content);return path;},
   spawn:async(_c,_a,o)=>{env=o!.env!;return {ready:Promise.resolve({workerPid:process.pid}),exited,writeStdin(){},endStdin(){},onStdout(fn){queueMicrotask(()=>fn('http://127.0.0.1:12345'));},onStderr(){},interrupt:()=>true,terminateGroup:async()=>{exit({ok:true,code:0,signal:null,drained:true,anchorLost:false});}};},
  });
  const emit = async (type: string, properties: any) => {controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({type,properties})}\n\n`)); await Bun.sleep(0);};
  await run({events,emit,handle,requests,reply:body=>reply(body)});
 } finally {await handle?.close(); globalThis.fetch=previous;rmSync(home,{recursive:true,force:true});}
}
const info = (id: string, role: string, parentID?: string) => ({id,role,parentID,sessionID:'native'});
const part = (messageID: string, text: string) => ({sessionID:'native',part:{id:`p-${messageID}`,sessionID:'native',messageID,type:'text',text}});

// OC-CORRELATION-ORDER-01: identity may follow parts. Both text and reasoning
// must stream exactly once after correlation, including when HTTP supplies it.
for (const identity of ['sse', 'http'] as const) test(`parts before ${identity} identity retain text and reasoning`,()=>fixture(async f=>{
 const user=f.requests[0].messageID;
 await f.emit('message.part.updated',part('answer',''));
 await f.emit('message.part.updated',{part:{id:'reason',sessionID:'native',messageID:'answer',type:'reasoning',text:''}});
 await f.emit('message.part.delta',{sessionID:'native',messageID:'answer',partID:'p-answer',field:'text',delta:'Hello'});
 await f.emit('message.part.delta',{sessionID:'native',messageID:'answer',partID:'reason',field:'text',delta:'Thinking'});
 expect(f.events.filter(e=>e.kind.startsWith('message.')||e.kind==='reasoning.delta')).toEqual([]);
 if(identity==='sse') {
  await f.emit('message.updated',{info:info('answer','assistant',user)});
  await f.emit('message.updated',{info:info('answer','assistant',user)});
  await f.emit('message.part.delta',{sessionID:'native',messageID:'answer',partID:'p-answer',field:'text',delta:'!'});
 }
 f.reply({info:info('answer','assistant',user),parts:[part('answer',identity==='sse'?'Hello!':'Hello').part]});
 expect(await f.handle.done).toMatchObject({status:'completed'});
 expect(f.events.filter(e=>e.kind==='message.delta').map(e=>e.data.text)).toEqual(identity==='sse'?['Hello','!']:['Hello']);
 expect(f.events.filter(e=>e.kind==='reasoning.delta').map(e=>e.data.text)).toEqual(['','Thinking']);
 expect(f.events.filter(e=>e.kind==='message.completed').map(e=>e.data.text)).toEqual(['',identity==='sse'?'Hello!':'Hello']);
}));

for(const terminal of ['error','http','interrupt'] as const) test(`pending parts reject unrelated identities and clear after ${terminal}`,()=>fixture(async f=>{
 const user=f.requests[0].messageID;
 for(const id of ['user','old','foreign','pending']) await f.emit('message.part.updated',part(id,'Must not leak'));
 await f.emit('message.updated',{info:info('user','user')});
 await f.emit('message.updated',{info:info('old','assistant','old-request')});
 await f.emit('message.updated',{info:{...info('foreign','assistant',user),sessionID:'foreign'}});
 // Rejected identities cannot later release their buffered text.
 await f.emit('message.updated',{info:info('user','assistant',user)});
 await f.emit('message.updated',{info:info('old','assistant',user)});
 expect(f.events.filter(e=>e.kind.startsWith('message.'))).toEqual([]);
 if(terminal==='error') await f.emit('session.error',{sessionID:'native',error:{name:'UnknownError'}});
 else if(terminal==='http') f.reply({info:info('complete','assistant',user),parts:[]});
 else {await f.handle.interrupt();await f.emit('session.idle',{sessionID:'native'});}
 expect(await f.handle.done).toMatchObject({status:terminal==='error'?'failed':terminal==='http'?'completed':'interrupted'});
 const next=f.handle.send('Next');
 const nextUser=f.requests[1].messageID;
 await f.emit('message.updated',{info:info('pending','assistant',nextUser)});
 await f.emit('message.part.updated',part('answer-next',''));
 await f.emit('message.updated',{info:info('answer-next','assistant',nextUser)});
 await f.emit('message.part.delta',{sessionID:'native',messageID:'answer-next',partID:'p-answer-next',field:'text',delta:'Fresh'});
 f.reply({info:info('answer-next','assistant',nextUser),parts:[]});
 expect(await next).toMatchObject({status:'completed'});
 expect(f.events.filter(e=>e.kind==='message.completed').map(e=>e.data.text)).toEqual(['']);
 expect(f.events.filter(e=>e.kind==='message.delta').map(e=>e.data.text)).toEqual(['Fresh']);
}));

for(const pressure of ['count','bytes'] as const) test(`pending ${pressure} pressure evicts old parts and preserves fresh correlation`,()=>fixture(async f=>{
 const user=f.requests[0].messageID;
 const text=pressure==='bytes'?'x'.repeat(200_000):'Old';
 await f.emit('message.part.updated',part('evicted',text));
 for(let i=0;i<(pressure==='bytes'?8:300);i++) await f.emit('message.part.updated',part(`noise-${i}`,text));
 await f.emit('message.updated',{info:info('evicted','assistant',user)});
 expect(f.events.filter(e=>e.kind.startsWith('message.'))).toEqual([]);
 await f.emit('message.part.updated',part('fresh','Fresh'));
 await f.emit('message.updated',{info:info('fresh','assistant',user)});
 f.reply({info:info('fresh','assistant',user),parts:[]});
 expect(await f.handle.done).toMatchObject({status:'completed'});
 expect(f.events.filter(e=>e.kind==='message.completed').map(e=>e.data.text)).toEqual(['Fresh']);
}));

test('captured user/retry sequence excludes echoes; only current assistant streams and HTTP completes',()=>fixture(async f=>{
 const user = f.requests[0].messageID;
 expect(typeof user).toBe('string');
 // Whitelisted capture from 20261105T070445-1c843a, seq 38/40/43/97.
 // Native IDs are replaced; retry prose/account URL and system prompt omitted.
 for (const raw of capturedRetry) {
  const properties = JSON.parse(JSON.stringify(raw.properties).replaceAll('captured-user',user));
  await f.emit(raw.type,properties);
 }
 expect(f.events.filter(e=>e.kind.startsWith('message.'))).toEqual([]);
 expect(f.events).toContainEqual(expect.objectContaining({kind:'diagnostic',data:expect.objectContaining({code:'opencode-provider-retry',attempt:1})}));
 await f.emit('message.part.updated',part('unknown','Unclassified'));
 await f.emit('message.updated',{info:info('old','assistant','old-user')});
 await f.emit('message.part.updated',part('old','Old reply'));
 await f.emit('message.updated',{info:info('answer','assistant',user)});
 await f.emit('message.part.updated',part('answer',''));
 await f.emit('message.part.delta',{sessionID:'native',messageID:'answer',partID:'p-answer',field:'text',delta:'Hello'});
 expect(f.events.filter(e=>e.kind==='message.delta').map(e=>e.data.text)).toEqual(['Hello']);
 expect(f.events.filter(e=>e.kind==='message.completed').map(e=>e.data.text)).toEqual(['']);
 f.reply({info:info('answer','assistant',user),parts:[{...part('answer','Hello').part},{...part('other','Foreign part').part},{...part('answer','Foreign session').part,sessionID:'foreign'}]});
 expect(await f.handle.done).toMatchObject({status:'completed'});
 expect(f.events.filter(e=>e.kind==='message.completed').map(e=>e.data.text)).toEqual(['','Hello']);
 const before=f.events.length;
 await f.emit('message.part.updated',part('answer','Late reply'));
 expect(f.events.slice(before).filter(e=>e.kind.startsWith('message.'))).toEqual([]);
 const next=f.handle.send('Next prompt');
 await f.emit('message.part.updated',part('answer','Stale across turns'));
 const nextUser=f.requests[1].messageID;
 await f.emit('message.updated',{info:info('answer-next','assistant',nextUser)});
 await f.emit('message.part.updated',part('answer-next','Next reply'));
 f.reply({info:info('answer-next','assistant',nextUser),parts:[]});
 expect(await next).toMatchObject({status:'completed'});
 expect(f.events.filter(e=>e.kind==='message.completed').map(e=>e.data.text)).toEqual(['','Hello','Next reply']);
}));

for (const mode of ['user-http','foreign-http','wrong-parent-http','assistant-error-http','error','idle-interrupt'] as const) test(`terminal lifecycle: ${mode}`,()=>fixture(async f=>{
 const user=f.requests[0].messageID;
 if(mode==='error') {
  let settled=false;void f.handle.done.then(()=>{settled=true;});
  await f.emit('session.error',{error:{name:'UnknownError',data:{message:'foreign'}}});
  await f.emit('session.error',{sessionID:'foreign',error:{name:'UnknownError'}});
  expect(settled).toBe(false);
  await f.emit('session.error',{sessionID:'native',error:{name:'UnknownError',data:{message:'native failure'}}});
 } else if(mode==='idle-interrupt') {
  await f.handle.interrupt();await f.emit('session.status',{sessionID:'native',status:{type:'idle'}});
 } else {
  f.reply({info:{...info('answer',mode==='user-http'?'user':'assistant',mode==='wrong-parent-http'?'old-user':user),sessionID:mode==='foreign-http'?'foreign':'native'},...(mode==='assistant-error-http'?{info:{...info('answer','assistant',user),error:{name:'ProviderAuthError',data:{providerID:'opencode-go',message:'secret upstream prose'}}}}:{}),parts:[part('answer','Do not display').part]});
 }
 expect(await f.handle.done).toMatchObject({status:mode==='idle-interrupt'?'interrupted':'failed'});
 expect(f.events.filter(e=>e.kind.startsWith('message.'))).toEqual([]);
}));
