import {expect,test} from 'bun:test';
import {join} from 'node:path';
import {WebService} from '../web-service';
import {UnavailableSessionService} from '../service';
import {resolveStatePaths,ensureStateLayout} from '../paths';
import {DictationService} from './service';
import {dictationFixture} from './testing';
import {encodeWav16} from '../../../../apps/web/src/dictation/audio-pcm';
// Protects authenticated audio admission, origin boundary, settings validation and drain fencing.
// Oracle: no unauthenticated/revoked/malformed request may invoke host effects.
test('dictation HTTP requires device/origin, validates audio/settings and rejects draining',async()=>{
 const f=dictationFixture(),paths=resolveStatePaths({env:{XDG_STATE_HOME:join(f.root,'state')}});ensureStateLayout(paths);let draining=false;
 const dictation=new DictationService(f.dir,{store:f.store,runtimePath:f.runtime}),host=new WebService({paths,service:new UnavailableSessionService(),config:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false},dictation,dictationAdmit:()=>!draining});host.enable();
 const base=new URL(host.pair().url).origin;
 try{
  expect((await fetch(base+'/api/dictation')).status).toBe(401);
  const pair=host.pair(),token=new URL(pair.url).hash.slice(1).replace(/^pair=/,'');
  const response=await fetch(base+'/pair',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token,name:'dictation-test'})});
  expect(response.status).toBe(200);const cookie=response.headers.get('set-cookie')!.split(';')[0]!;
  const request=(path:string,method='GET',body?:BodyInit,headers:Record<string,string>={})=>fetch(base+'/api/dictation'+path,{method,headers:{Cookie:cookie,Origin:base,...headers},body});
  const summary=await request('');expect(summary.status).toBe(200);expect(summary.headers.get('Permissions-Policy')).toContain('microphone=(self)');expect((await summary.json()).models[0].state).toBe('absent');
  expect((await fetch(base+'/api/dictation/settings',{method:'PUT',headers:{Cookie:cookie,Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status).toBe(403);
  expect((await request('/settings','PUT',JSON.stringify({path:'/tmp/evil'}),{'Content-Type':'application/json'})).status).toBe(400);
  expect((await request('/settings','PUT',JSON.stringify({selected:'large-v3-turbo-q5_0'}),{'Content-Type':'application/json'})).status).toBe(409);
  expect((await request('/transcriptions','POST',new Uint8Array(50),{'Content-Type':'audio/mp3'})).status).toBe(415);
  expect((await request('/transcriptions','POST',new Uint8Array(50),{'Content-Type':'audio/wav'})).status).toBe(415);
  expect((await request('/transcriptions','POST',encodeWav16(new Float32Array(100)) as BodyInit,{'Content-Type':'audio/wav'})).status).toBe(422);
  expect((await request('/transcriptions','POST',encodeWav16(new Float32Array(16000)) as BodyInit,{'Content-Type':'audio/wav'})).status).toBe(409);
  draining=true;expect((await request('/models/large-v3-turbo-q5_0/download','POST')).status).toBe(503);draining=false;
  host.revoke(host.devices()[0]!.id);expect((await request('/models/large-v3-turbo-q5_0/download','POST')).status).toBe(401);
 }finally{await host.close();await dictation.close();f.clean();}
});

test('revoking a device while audio streams prevents transcription after the asynchronous read',async()=>{
 const f=dictationFixture(),paths=resolveStatePaths({env:{XDG_STATE_HOME:join(f.root,'state')}});ensureStateLayout(paths);
 const dictation=new DictationService(f.dir,{store:f.store,runtimePath:f.runtime}),host=new WebService({paths,service:new UnavailableSessionService(),config:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false},dictation});host.enable();
 const base=host.status().url!;
 try{
  const pair=host.pair();const response=await fetch(base+'/pair',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({code:pair.code,name:'revocation-test'})});const cookie=response.headers.get('set-cookie')!.split(';')[0]!;
  let body!:ReadableStreamDefaultController<Uint8Array>;
  const stream=new ReadableStream<Uint8Array>({start(c){body=c;c.enqueue(new Uint8Array([82,73,70,70]));}});
  const pending=fetch(base+'/api/dictation/transcriptions',{method:'POST',headers:{Origin:base,Cookie:cookie,'Content-Type':'audio/wav'},body:stream});
  for(let i=0;i<100&&!host.dictationUploading;i++)await new Promise<void>(r=>setTimeout(r,1));expect(host.dictationUploading).toBe(true);
  host.revoke(host.devices()[0]!.id);body.close();expect((await pending).status).toBe(401);expect(dictation.active()).toBe(false);
 }finally{await host.close();await dictation.close();f.clean();}
});

// Protects production listener composition, not just direct fetch dispatch:
// valid >6MiB WAVs reach native processing; audio/JSON limits stay enforced.
test('production listener accepts a 220-second WAV and rejects oversized bodies',async()=>{
 const f=dictationFixture(),paths=resolveStatePaths({env:{XDG_STATE_HOME:join(f.root,'state')}});ensureStateLayout(paths);
 f.store.download(f.artifact.id);while(f.store.active())await new Promise<void>(r=>setImmediate(r));await f.store.settings(f.artifact.id,'en');
 const dictation=new DictationService(f.dir,{store:f.store,runtimePath:f.runtime}),host=new WebService({paths,service:new UnavailableSessionService(),config:{port:0,trustedProxy:null,allowedOrigins:[],allowFunnel:false},dictation});host.enable();
 const base=host.status().url!;
 try{
  const response=await fetch(base+'/pair',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({code:host.pair().code,name:'long-audio-test'})});const cookie=response.headers.get('set-cookie')!.split(';')[0]!;
  const request=(path:string,body:Uint8Array,type='audio/wav',method='POST')=>fetch(base+path,{method,headers:{Origin:base,Cookie:cookie,'Content-Type':type},body:body as BodyInit});
  const wav=encodeWav16(new Float32Array(16000*220).fill(.1));expect(wav.length).toBe(7040044);
  const result=await request('/api/dictation/transcriptions',wav);expect(result.status).toBe(200);expect((await result.json()).text).toBe('local fixture transcript');
  expect((await request('/api/dictation/transcriptions',new Uint8Array(10*1024*1024+1))).status).toBe(413);
  expect((await request('/api/dictation/settings',new Uint8Array(4097),'application/json','PUT')).status).toBe(400);
  expect((await request('/api/commands',new Uint8Array(1024*1024+1),'application/json')).status).toBe(400);
  expect((await request('/api/sessions/fixture/attachments',new Uint8Array(5*1024*1024+1),'image/png')).status).toBe(413);
 }finally{await host.close();await dictation.close();f.clean();}
});
