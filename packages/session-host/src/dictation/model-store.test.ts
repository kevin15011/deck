import {expect,spyOn,test} from 'bun:test';
import * as fs from 'node:fs';
import {dictationFixture} from './testing';
import {DictationService} from './service';
import {encodeWav16} from '../../../../apps/web/src/dictation/audio-pcm';

// Protects explicit integrity decisions when filesystem metadata collides. The
// storage fake freezes stat metadata only; hashing still reads the real changed bytes.
for(const installedBy of ['verify','download'] as const)test(`explicit verification rejects same-metadata corruption after ${installedBy}`,async()=>{
 const f=dictationFixture();let stat:ReturnType<typeof spyOn>|undefined;
 try{
  if(installedBy==='download'){
   f.store.download(f.artifact.id);while(f.store.active())await new Promise<void>(resolve=>setImmediate(resolve));
  }else{
   fs.writeFileSync(f.store.path(f.artifact.id),f.bytes,{mode:0o600});expect(await f.store.verify(f.artifact.id)).toBe(true);
  }
  const path=f.store.path(f.artifact.id),original=fs.lstatSync,metadata=original(path);
  fs.writeFileSync(path,Buffer.alloc(f.bytes.length),{mode:0o600});
  expect(original(path).ino).toBe(metadata.ino);expect(original(path).size).toBe(metadata.size);
  expect(fs.readFileSync(path)).not.toEqual(f.bytes);
  stat=spyOn(fs,'lstatSync').mockImplementation(((target:fs.PathLike,...args:unknown[])=>target===path?metadata:Reflect.apply(original,fs,[target,...args])) as typeof fs.lstatSync);
  expect(await f.store.verify(f.artifact.id)).toBe(false);
  expect(f.store.summary()[0]!.state).toBe('corrupt');
  await expect(f.store.settings(f.artifact.id,undefined)).rejects.toThrow('dictation-model-not-installed');
  expect(f.store.selected).toBeNull();
  await f.store.reconcile();expect(f.store.summary()[0]!.state).toBe('corrupt');
 }finally{stat?.mockRestore();f.clean();}
});

// Protects the production transcription boundary even when status still reflects
// the last verified identity. Oracle: corrupt model bytes must never reach inference.
test('transcription rejects same-metadata corruption after a cached status refresh',async()=>{
 const f=dictationFixture();let stat:ReturnType<typeof spyOn>|undefined,service:DictationService|undefined;
 try{
  fs.writeFileSync(f.store.path(f.artifact.id),f.bytes,{mode:0o600});
  service=new DictationService(f.dir,{store:f.store,runtimePath:f.runtime});
  await service.settings(f.artifact.id,'es');expect((await service.summary()).available).toBe(true);
  const path=f.store.path(f.artifact.id),original=fs.lstatSync,metadata=original(path);
  fs.writeFileSync(path,Buffer.alloc(f.bytes.length),{mode:0o600});
  stat=spyOn(fs,'lstatSync').mockImplementation(((target:fs.PathLike,...args:unknown[])=>target===path?metadata:Reflect.apply(original,fs,[target,...args])) as typeof fs.lstatSync);
  await service.summary();
  await expect(service.transcribe(encodeWav16(new Float32Array(16000)),new AbortController().signal)).rejects.toThrow('dictation-model-not-installed');
  expect(f.store.summary()[0]!.state).toBe('corrupt');expect(fs.readdirSync(f.store.tmpDir)).toEqual([]);
 }finally{stat?.mockRestore();await service?.close();f.clean();}
});
