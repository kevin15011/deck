import { afterEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const roots:string[]=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixtureEnv(){const home=mkdtempSync(join(tmpdir(),'native-smoke-'));roots.push(home);return{HOME:home,XDG_CONFIG_HOME:join(home,'config'),XDG_DATA_HOME:join(home,'data'),XDG_CACHE_HOME:join(home,'cache'),PATH:'/usr/bin:/bin'};}
const digest=(value:unknown):string=>createHash('sha256').update(JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item)).digest('hex');

test.each(['thread/start','thread/resume'])('Codex smoke fixture consumes %s MCP stdin additively without logging literal secrets',async method=>{
 const env=fixtureEnv(),log=join(env.HOME,'codex.log'),secret='synthetic-stdin-secret-must-not-be-logged';
 const native={enabled:true,command:'native-personal',args:[],env:{}},deck={enabled:true,command:'deck-fixture',args:['internal','session-mcp'],env:{SYNTHETIC_SECRET:secret,DECK_SESSION_CREDENTIAL_FILE:join(env.HOME,'credential')}};
 const threadId=method==='thread/resume'?'resumed-smoke-thread':'fake-thread';
 const requests=[
  {id:1,method:'config/read',params:{}},
  {id:2,method,params:{...(method==='thread/resume'?{threadId}:{}),config:{mcp_servers:{'deck-session-t-deck':deck}},approvalPolicy:'on-request',approvalsReviewer:'user',sandbox:'read-only'}},
  {id:3,method:'mcpServerStatus/list',params:{threadId}},
  {id:4,method:'config/read',params:{}},
  {id:5,method:'thread/start',params:{config:{mcp_servers:{personal:{enabled:false}}}}},
  {id:6,method:'mcpServerStatus/list',params:{threadId:'fake-thread'}},
 ];
 const child=Bun.spawn([process.execPath,resolve(import.meta.dir,'fake-codex.mjs'),'app-server','--stdio','-c','mcp_servers='+JSON.stringify({personal:native})],{env:{...env,FAKE_CODEX_LOG:log},stdin:new Blob([requests.map(value=>JSON.stringify(value)).join('\n')+'\n']),stdout:'pipe',stderr:'pipe'});
 try{
  const [stdout,stderr,exit]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);expect(exit).toBe(0);expect(stderr).toBe('');
  const replies=stdout.trim().split('\n').map(line=>JSON.parse(line));
  expect(replies.find(reply=>reply.id===2).result.thread.id).toBe(threadId);
  expect(replies.find(reply=>reply.id===3).result.data.map((server:any)=>server.name).sort()).toEqual(['deck-session-t-deck','personal']);
  expect(replies.find(reply=>reply.id===4).result.config.mcp_servers).toEqual({personal:native});
  expect(replies.find(reply=>reply.id===6).result.data).toEqual([]);
  const recorded=readFileSync(log,'utf8');expect(recorded).not.toContain(secret);
  expect(recorded.trim().split('\n').map(line=>JSON.parse(line)).find(value=>value.event==='thread-config')).toMatchObject({method,approvalPolicy:'on-request',sandbox:'read-only',mcpServerDigests:{'deck-session-t-deck':digest(deck)}});
 }finally{if(child.exitCode===null)child.kill();await child.exited;}
});

test('OpenCode smoke fixture exposes effective native additions, exact Deck config and compiled permissions over authenticated HTTP',async()=>{
 const env=fixtureEnv(),password='synthetic-password-for-loopback-fixture',log=join(env.HOME,'opencode.log');
 const config={mcp:{personal:{type:'remote',url:'https://personal.invalid/mcp',enabled:true},deck:{type:'local',command:['deck-fixture','internal','session-mcp'],environment:{DECK_SESSION_CREDENTIAL_FILE:join(env.HOME,'credential')},enabled:true}},plugin:['file:///synthetic/native-plugin.mjs'],skills:{paths:['/synthetic/native-skills']},permission:{read:'deny',bash:{ls:'allow'}}};
 const child=Bun.spawn([process.execPath,resolve(import.meta.dir,'fake-opencode.mjs'),'serve','--hostname','127.0.0.1','--port','0'],{env:{...env,OPENCODE_CONFIG_CONTENT:JSON.stringify(config),OPENCODE_SERVER_PASSWORD:password,FAKE_OPENCODE_LOG:log},stdin:'ignore',stdout:'pipe',stderr:'pipe'});
 const reader=child.stdout.getReader();
 try{
  const {value}=await reader.read(),endpoint=new TextDecoder().decode(value).match(/http:\/\/127\.0\.0\.1:\d+/)![0];
  const headers={authorization:'Basic '+Buffer.from('opencode:'+password).toString('base64')};
  expect((await fetch(endpoint+'/config')).status).toBe(401);
  expect(await (await fetch(endpoint+'/config',{headers})).json()).toEqual(config);
  expect(await (await fetch(endpoint+'/agent',{headers})).json()).toEqual([{name:'build',permission:[{permission:'read',pattern:'*',action:'deny'},{permission:'bash',pattern:'ls',action:'allow'}]}]);
  expect(await (await fetch(endpoint+'/mcp',{headers})).json()).toEqual({personal:{status:'connected'},deck:{status:'connected'}});
  expect(readFileSync(log,'utf8')).not.toContain(password);
 }finally{await reader.cancel();if(child.exitCode===null)child.kill();await child.exited;}
});
