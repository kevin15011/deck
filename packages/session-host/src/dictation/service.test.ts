import {expect,test} from 'bun:test';
import {mkdtempSync,mkdirSync,writeFileSync,readdirSync,readFileSync,rmSync,symlinkSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {ModelStore} from './model-store';
import {DictationService} from './service';
import {DictationRuntime,runEngine} from './runtime';
import {MODEL_CATALOG} from './catalog';
import {encodeWav16} from '../../../../apps/web/src/dictation/audio-pcm';
import {dictationFixture} from './testing';
// Protects installed-model integrity and no implicit acquisition; oracle: exact digest, explicit action, isolated filesystem.
test('models verify content, persist selection, reject symlinks and clear deleted selection',async()=>{
 const f=dictationFixture();try{
  let requests=0;const store=new ModelStore(f.dir,(async()=>{requests++;return new Response(f.bytes);}) as unknown as typeof fetch,[f.artifact]);await store.reconcile();expect(requests).toBe(0);
  store.download(f.artifact.id);await expect(store.settings(f.artifact.id,undefined)).rejects.toThrow('busy');
  while(store.active())await new Promise<void>(resolve=>setImmediate(resolve));expect(store.summary()[0]!.state).toBe('installed');expect(requests).toBe(1);
  await store.settings(f.artifact.id,'en');const reload=new ModelStore(f.dir,fetch,[f.artifact]);await reload.reconcile();expect(reload.selected).toBe(f.artifact.id);expect(reload.language).toBe('en');
  writeFileSync(store.path(f.artifact.id),Buffer.alloc(f.bytes.length),{mode:0o600});expect(await store.verify(f.artifact.id)).toBe(false);expect(store.summary()[0]!.state).toBe('corrupt');
  store.delete(f.artifact.id);expect(store.selected).toBeNull();symlinkSync(f.runtime,store.path(f.artifact.id));expect(await store.verify(f.artifact.id)).toBe(false);store.delete(f.artifact.id);expect(readFileSync(f.runtime,'utf8')).toContain('#!/bin/sh');
 }finally{f.clean();}
});
test('bad or oversized download never installs and removes partials',async()=>{
 const f=dictationFixture();try{for(const bytes of [Buffer.alloc(f.bytes.length),Buffer.alloc(f.bytes.length+1)]){
  const store=new ModelStore(f.dir,(async()=>new Response(bytes)) as unknown as typeof fetch,[f.artifact]);store.download(f.artifact.id);while(store.active())await new Promise<void>(resolve=>setImmediate(resolve));expect(store.summary()[0]!.state).toBe('failed');expect(readdirSync(store.modelsDir)).toEqual([]);
 }}finally{f.clean();}
});
test('cancel aborts download and cleans partials',async()=>{
 const f=dictationFixture();try{const store=new ModelStore(f.dir,(async(_url:RequestInfo|URL,init?:RequestInit)=>new Response(new ReadableStream({start(c){c.enqueue(f.bytes.subarray(0,4));init?.signal?.addEventListener('abort',()=>c.error(Error('abort')));}}))) as unknown as typeof fetch,[f.artifact]);store.download(f.artifact.id);await new Promise<void>(r=>setImmediate(r));await store.cancel(f.artifact.id);expect(store.active()).toBe(false);expect(store.summary()[0]!.state).toBe('absent');expect(readdirSync(store.modelsDir)).toEqual([]);}finally{f.clean();}
});
// Protects actual native adapter composition: fake executable provides effects, not a fake transcriber.
test('native CLI transcribes once, rejects concurrent work, cleans audio and loads nothing when idle',async()=>{
 const f=dictationFixture();let service:DictationService|undefined;try{
  f.store.download(f.artifact.id);while(f.store.active())await new Promise<void>(r=>setImmediate(r));await f.store.settings(f.artifact.id,'es');
  service=new DictationService(f.dir,{store:f.store,runtimePath:f.runtime});expect((await service.summary()).available).toBe(true);expect(service.active()).toBe(false);
  const wav=encodeWav16(new Float32Array(16000).fill(.1)),first=service.transcribe(wav,new AbortController().signal);
  expect(()=>service!.transcribe(wav,new AbortController().signal)).toThrow('busy');await expect(service.delete(f.artifact.id)).rejects.toThrow('in-use');
  // Network cancellation remains available while a different host activity uses a model.
  await expect(service.cancelDownload(f.artifact.id)).resolves.toBeUndefined();
  expect((await first).text).toBe('local fixture transcript');expect(readdirSync(f.store.tmpDir)).toEqual([]);expect(service.active()).toBe(false);
 }finally{await service?.close();f.clean();}
});
test('native cancellation and timeout terminate children',async()=>{
 const f=dictationFixture();try{writeFileSync(f.runtime,'#!/bin/sh\nexec sleep 30\n',{mode:0o700});const controller=new AbortController(),pending=runEngine(f.runtime,[],controller.signal);controller.abort();await expect(pending).rejects.toThrow('cancelled');await expect(runEngine(f.runtime,[],undefined,20)).rejects.toThrow('timeout');}finally{f.clean();}
});

test('selection rechecks authority after verification and shutdown prevents new work',async()=>{
 const f=dictationFixture();try{
  f.store.download(f.artifact.id);while(f.store.active())await new Promise<void>(r=>setImmediate(r));
  await expect(f.store.settings(f.artifact.id,'en',()=>false)).rejects.toThrow('device-required');expect(f.store.selected).toBeNull();expect(f.store.language).toBe('es');
  const service=new DictationService(f.dir,{store:f.store,runtimePath:f.runtime});await service.close();await expect(service.download(f.artifact.id)).rejects.toThrow('daemon-stopping');
 }finally{f.clean();}
});

test('runtime capability cache invalidates and output is bounded',async()=>{
 const f=dictationFixture();try{const runtime=new DictationRuntime(f.runtime);expect(await runtime.resolve()).toBe(realpathSync(f.runtime));writeFileSync(f.runtime,'#!/bin/sh\necho " -m -f "\n',{mode:0o700});expect(await runtime.resolve()).toBeUndefined();
  writeFileSync(f.runtime,'#!/bin/sh\nyes diagnostics\n',{mode:0o700});await expect(runEngine(f.runtime,[])).rejects.toThrow('output-limit');
 }finally{f.clean();}
});
test('cancelling native transcription removes its private audio and JSON files',async()=>{
 const f=dictationFixture();let service:DictationService|undefined;try{
  f.store.download(f.artifact.id);while(f.store.active())await new Promise<void>(r=>setImmediate(r));await f.store.settings(f.artifact.id,'es');
  writeFileSync(f.runtime,'#!/bin/sh\nif [ "$1" = "-h" ]; then echo " -m -f -l -t -nt -np -mc -sns -oj -of "; exit 0; fi\nexec sleep 30\n',{mode:0o700});
  service=new DictationService(f.dir,{store:f.store,runtimePath:f.runtime});await service.summary();const controller=new AbortController(),pending=service.transcribe(encodeWav16(new Float32Array(16000)),controller.signal);
  let observed=0;const timer=setInterval(()=>{observed=readdirSync(f.store.tmpDir).length;if(observed===2)controller.abort();},1);
  try{await expect(pending).rejects.toThrow('cancelled');}finally{clearInterval(timer);}
  expect(observed).toBe(2);expect(readdirSync(f.store.tmpDir)).toEqual([]);expect(service.active()).toBe(false);
 }finally{await service?.close();f.clean();}
});

// Protects audio retention after a host crash inside an atomic private-file write.
test('startup removes interrupted atomic audio writes from its private temporary directory',()=>{
 const f=dictationFixture();try{
  const orphan=join(f.store.tmpDir,'12345678-1234-1234-1234-123456789abc.wav.123.0123456789ab.tmp');writeFileSync(orphan,'private audio',{mode:0o600});
  new ModelStore(f.dir,fetch,[f.artifact]);expect(readdirSync(f.store.tmpDir)).toEqual([]);
 }finally{f.clean();}
});

// Protects the persisted language contract: coercible arrays/objects are invalid,
// and rejecting a combined update must leave both fields and disk unchanged.
test('invalid language types never mutate or persist settings',async()=>{
 const f=dictationFixture();try{
  f.store.download(f.artifact.id);while(f.store.active())await new Promise<void>(r=>setImmediate(r));
  await f.store.settings(f.artifact.id,'en');const before=readFileSync(join(f.dir,'settings.json'),'utf8');
  for(const language of [['es'],{toString:()=> 'es'},null,42]){
   await expect(f.store.settings(null,language)).rejects.toThrow('dictation-language-invalid');
   expect(f.store.selected).toBe(f.artifact.id);expect(f.store.language).toBe('en');expect(readFileSync(join(f.dir,'settings.json'),'utf8')).toBe(before);
  }
 }finally{f.clean();}
});

// Protects retired saved selections: preserve language and files, never select or
// download a replacement. Oracle: single-model scope with explicit acquisition.
test('retired persisted models become unselected without network or file deletion',async()=>{
 const f=dictationFixture();try{
  for(const selected of ['small-q5_1','large-v3-turbo-q8_0']){
   writeFileSync(join(f.dir,'settings.json'),JSON.stringify({selected,language:'en'}),{mode:0o600});
   const retiredPath=join(f.store.modelsDir,`ggml-${selected}.bin`);writeFileSync(retiredPath,'preserve existing weights',{mode:0o600});
   let requests=0;const store=new ModelStore(f.dir,(async()=>{requests++;throw Error('unexpected download');}) as unknown as typeof fetch);
   await store.reconcile();expect(store.selected).toBeNull();expect(store.language).toBe('en');expect(requests).toBe(0);
   expect(readFileSync(retiredPath,'utf8')).toBe('preserve existing weights');
   await expect(store.settings(selected,undefined)).rejects.toThrow('dictation-model-not-installed');
   expect(store.selected).toBeNull();
  }
 }finally{f.clean();}
});
