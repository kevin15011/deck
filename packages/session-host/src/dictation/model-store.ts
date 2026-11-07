import {createHash,randomUUID} from 'node:crypto';
import {constants,lstatSync,openSync,closeSync,readSync,readFileSync,existsSync,readdirSync,unlinkSync,renameSync,writeSync,fsyncSync,fstatSync} from 'node:fs';
import {join} from 'node:path';
import type {DictationModel,DictationModelId,DictationLanguage} from '@deck/core/session/dictation';
import {isDictationModelId} from '@deck/core/session/dictation';
import {assertPrivateFile,ensurePrivateDir,writePrivateFile} from '../paths';
import {MODEL_CATALOG,type ModelArtifact} from './catalog';
import {DictationError} from './wav';
export class ModelStore {
 private states=new Map<DictationModelId,DictationModel>();
 private identities=new Map<DictationModelId,string>();
 private job?:{id:DictationModelId;controller:AbortController;promise:Promise<void>};
 selected:DictationModelId|null=null;language:DictationLanguage='es';
 readonly modelsDir:string;readonly tmpDir:string;
 constructor(readonly root:string,private fetcher:typeof fetch=fetch,private catalog:readonly ModelArtifact[]=MODEL_CATALOG){
  ensurePrivateDir(root,{strict:true});this.modelsDir=join(root,'models');this.tmpDir=join(root,'tmp');for(const dir of [this.modelsDir,this.tmpDir])ensurePrivateDir(dir,{strict:true});
  for(const file of readdirSync(this.modelsDir))if(/\.partial-[a-f0-9-]+$/.test(file))unlinkSync(join(this.modelsDir,file));
  // This private directory is exclusively transient audio/output, including atomic-write remnants.
  for(const file of readdirSync(this.tmpDir)){const path=join(this.tmpDir,file),stat=lstatSync(path);if(!stat.isFile()&&!stat.isSymbolicLink())throw new DictationError('dictation-unsafe-path');unlinkSync(path);}
  const settings=join(root,'settings.json');if(existsSync(settings)){assertPrivateFile(settings);if(lstatSync(settings).size>4096)throw Error('dictation-settings-invalid');const v=JSON.parse(readFileSync(settings,'utf8'));if(isDictationModelId(v.selected))this.selected=v.selected;if(['es','en','auto'].includes(v.language))this.language=v.language;}
  for(const m of catalog)this.states.set(m.id,{id:m.id,label:m.label,bytes:m.bytes,state:'absent'});
 }
 private artifact(id:DictationModelId){const m=this.catalog.find(m=>m.id===id);if(!m)throw new DictationError('dictation-model-invalid',400);return m;}
 path(id:DictationModelId){return join(this.modelsDir,this.artifact(id).file);}
 private identity(path:string){assertPrivateFile(path);const s=lstatSync(path);return JSON.stringify([s.dev,s.ino,s.size,s.mtimeMs,s.ctimeMs]);}
 /** Rehash on startup and identity changes. Size alone is never trusted. */
 async verify(id:DictationModelId):Promise<boolean>{
  const m=this.artifact(id),path=this.path(id),state=this.states.get(id)!;
  try{
   const identity=this.identity(path);if(this.identities.get(id)===identity)return true;
   if(lstatSync(path).size!==m.bytes)throw Error('size');state.state='verifying';
   const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024);let total=0;
   try{for(;;){const count=readSync(fd,buffer);if(!count)break;total+=count;if(total>m.bytes)throw Error('size');hash.update(buffer.subarray(0,count));await new Promise<void>(resolve=>setImmediate(resolve));}}
   finally{closeSync(fd);}
   if(total!==m.bytes||hash.digest('hex')!==m.sha256||identity!==this.identity(path))throw Error('integrity');
   this.identities.set(id,identity);state.state='installed';return true;
  }catch(error){this.identities.delete(id);state.state=(error as NodeJS.ErrnoException).code==='ENOENT'?'absent':'corrupt';return false;}
 }
 async refresh(){for(const m of this.catalog)if(this.states.get(m.id)?.state==='installed')await this.verify(m.id);}
 async reconcile(){for(const m of this.catalog)if(!this.job||this.job.id!==m.id)await this.verify(m.id);}
 summary(){return this.catalog.map(m=>({...this.states.get(m.id)!}));}
 active(){return !!this.job;}
 async settings(selected:unknown,language:unknown,authorized=()=>true){
  if(this.job)throw new DictationError('dictation-download-busy');
  if(selected!==undefined&&selected!==null&&(!isDictationModelId(selected)||!await this.verify(selected)))throw new DictationError('dictation-model-not-installed');
  if(language!==undefined&&(typeof language!=='string'||!['es','en','auto'].includes(language)))throw new DictationError('dictation-language-invalid',400);
  if(!authorized())throw new DictationError('device-required',401);
  if(selected!==undefined)this.selected=selected as DictationModelId|null;if(language!==undefined)this.language=language as DictationLanguage;
  this.persist();
 }
 private persist(){writePrivateFile(join(this.root,'settings.json'),JSON.stringify({selected:this.selected,language:this.language}));}
 download(id:DictationModelId){
  const m=this.artifact(id);if(this.job)throw new DictationError('dictation-download-busy');if(this.states.get(id)!.state==='installed')throw new DictationError('dictation-model-installed');
  const controller=new AbortController(),state=this.states.get(id)!;state.state='downloading';state.received=0;delete state.error;
  const promise=this.acquire(m,controller.signal).catch(error=>{state.state=controller.signal.aborted?'absent':'failed';state.error=controller.signal.aborted?undefined:(error instanceof DictationError?error.code:'dictation-download-failed');}).finally(()=>{this.job=undefined;});
  this.job={id,controller,promise};
 }
 async cancel(id:DictationModelId){if(this.job?.id===id){this.job.controller.abort();await this.job.promise;}}
 async close(){if(this.job){this.job.controller.abort();await this.job.promise;}}
 delete(id:DictationModelId){if(this.job?.id===id)throw new DictationError('dictation-download-busy');const path=this.path(id);try{const s=lstatSync(path);if(!s.isFile()&&!s.isSymbolicLink())throw new DictationError('dictation-unsafe-path');unlinkSync(path);}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}this.identities.delete(id);this.states.get(id)!.state='absent';if(this.selected===id){this.selected=null;this.persist();}}
 private async acquire(m:ModelArtifact,signal:AbortSignal){
  const partial=join(this.modelsDir,`${m.file}.partial-${randomUUID()}`);let fd:number|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined;
  const timer=setTimeout(()=>this.job?.controller.abort(),30*60_000);
  try{
   if(!m.url.startsWith('https://'))throw Error('url');
   const response=await this.fetcher(m.url,{signal,redirect:'follow'});if(!response.ok||!response.body||response.url&&!response.url.startsWith('https://'))throw Error('download');
   const length=response.headers.get('content-length');if(length&&Number(length)!==m.bytes)throw new DictationError('dictation-download-integrity');
   fd=openSync(partial,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);const hash=createHash('sha256');let size=0;
   reader=response.body.getReader();
   for(;;){signal.throwIfAborted();const chunk=await reader.read();signal.throwIfAborted();if(chunk.done)break;size+=chunk.value.length;if(size>m.bytes)throw new DictationError('dictation-download-integrity');hash.update(chunk.value);for(let offset=0;offset<chunk.value.length;)offset+=writeSync(fd,chunk.value,offset,chunk.value.length-offset);this.states.get(m.id)!.received=size;}
   this.states.get(m.id)!.state='verifying';if(size!==m.bytes||hash.digest('hex')!==m.sha256)throw new DictationError('dictation-download-integrity');
   fsyncSync(fd);closeSync(fd);fd=undefined;signal.throwIfAborted();renameSync(partial,this.path(m.id));this.identities.set(m.id,this.identity(this.path(m.id)));this.states.get(m.id)!.state='installed';
  }catch(error){if((error as NodeJS.ErrnoException).code==='ENOSPC')throw new DictationError('dictation-disk-full');throw error;}
  finally{clearTimeout(timer);await reader?.cancel().catch(()=>{});if(fd!==undefined)closeSync(fd);try{unlinkSync(partial);}catch{}}
 }
}
