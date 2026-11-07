import {randomUUID} from 'node:crypto';
import {availableParallelism} from 'node:os';
import {join} from 'node:path';
import {lstatSync,readFileSync,unlinkSync} from 'node:fs';
import type {DictationModelId,DictationResult,DictationSummary} from '@deck/core/session/dictation';
import {assertPrivateFile,writePrivateFile} from '../paths';
import {ModelStore} from './model-store';
import {DictationRuntime,runEngine} from './runtime';
import {DictationError,parseWav} from './wav';
export class DictationService {
 readonly store:ModelStore;
 private runtime:DictationRuntime;
 private ready:Promise<void>;
 private initializing=true;private closed=false;private changing=false;
 private transcription?:{controller:AbortController;promise:Promise<DictationResult>};
 private runtimeAbort=new AbortController();private probes=0;
 private lastRun?:DictationSummary['lastRun'];
 constructor(root:string,options:{runtimePath?:string;store?:ModelStore}={}){
  this.store=options.store??new ModelStore(root);this.runtime=new DictationRuntime(options.runtimePath);
  this.ready=this.store.reconcile().finally(()=>{this.initializing=false;});
 }
 active(){return this.probes>0||this.initializing||this.changing||!!this.transcription||this.store.active();}
 async summary():Promise<DictationSummary>{this.probes++;try{await this.ready;this.checkClosed();await this.store.refresh();const path=await this.runtime.resolve(this.runtimeAbort.signal);return{available:!!path&&!!this.store.selected&&this.store.summary().some(m=>m.id===this.store.selected&&m.state==='installed'),runtime:path?{state:'ready',path}:{state:'missing'},models:this.store.summary(),selected:this.store.selected,language:this.store.language,active:this.changing||!!this.transcription||this.store.active(),lastRun:this.lastRun};}finally{this.probes--;}}
 private check(){if(this.closed)throw new DictationError('daemon-stopping',503);if(this.changing)throw new DictationError('dictation-busy',429);}
 async change(effect:()=>void|Promise<void>,authorized=()=>true){this.check();if(this.transcription)throw new DictationError('dictation-model-in-use');this.changing=true;try{await this.ready;this.checkClosed();if(!authorized())throw new DictationError('device-required',401);await effect();}finally{this.changing=false;}}
 private checkClosed(){if(this.closed)throw new DictationError('daemon-stopping',503);}
 download(id:DictationModelId,authorized?:()=>boolean){return this.change(()=>this.store.download(id),authorized);}
 async cancelDownload(id:DictationModelId,authorized=()=>true){this.check();await this.ready;this.checkClosed();if(!authorized())throw new DictationError('device-required',401);await this.store.cancel(id);}
 delete(id:DictationModelId,authorized?:()=>boolean){return this.change(()=>this.store.delete(id),authorized);}
 settings(selected:unknown,language:unknown,authorized?:()=>boolean){return this.change(()=>this.store.settings(selected,language,authorized),authorized);}
 transcribe(bytes:Uint8Array,signal:AbortSignal):Promise<DictationResult>{
  this.check();if(this.transcription)throw new DictationError('dictation-busy',429);
  const {audioMs}=parseWav(bytes),controller=new AbortController(),abort=()=>controller.abort();signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  const promise=this.perform(bytes,audioMs,controller).finally(()=>{signal.removeEventListener('abort',abort);this.transcription=undefined;});this.transcription={controller,promise};return promise;
 }
 private async perform(bytes:Uint8Array,audioMs:number,controller:AbortController):Promise<DictationResult>{
  const started=performance.now(),signal=controller.signal;await this.ready;this.checkClosed();signal.throwIfAborted();
  const id=this.store.selected,language=this.store.language;if(!id||!await this.store.verify(id))throw new DictationError('dictation-model-not-installed');
  const engine=await this.runtime.resolve(signal);if(!engine)throw new DictationError('dictation-engine-missing');signal.throwIfAborted();
  const base=join(this.store.tmpDir,randomUUID()),wav=`${base}.wav`,json=`${base}.json`;let monitor:ReturnType<typeof setInterval>|undefined,oversize=false;
  try{
   writePrivateFile(wav,bytes);writePrivateFile(json,'');
   monitor=setInterval(()=>{try{if(lstatSync(json).size>1024*1024){oversize=true;controller.abort();}}catch{}},25);
   await runEngine(engine,['-m',this.store.path(id),'-f',wav,'-l',language,'-t',String(Math.min(8,Math.max(1,availableParallelism()-1))),'-nt','-np','-mc','0','-sns','-oj','-of',base],signal,Math.max(60000,Math.min(600000,audioMs*6)));
   signal.throwIfAborted();assertPrivateFile(json);if(lstatSync(json).size>1024*1024)throw new DictationError('dictation-engine-output-limit',502);
   let value:unknown;try{value=JSON.parse(readFileSync(json,'utf8'));}catch{throw new DictationError('dictation-engine-invalid-output',502);}
   const segments=(value as {transcription?:unknown})?.transcription;
   if(!Array.isArray(segments)||segments.length>10000||!segments.every(s=>s&&typeof s.text==='string'))throw new DictationError('dictation-engine-invalid-output',502);
   const text=segments.map(s=>s.text).join('').trim();if(text.length>100000)throw new DictationError('dictation-engine-output-limit',502);
   this.lastRun={modelId:id,audioMs,elapsedMs:Math.round(performance.now()-started)};return{ok:true,text,...this.lastRun};
  }catch(error){if(oversize)throw new DictationError('dictation-engine-output-limit',502);throw error;}
  finally{if(monitor)clearInterval(monitor);for(const path of [wav,json])try{unlinkSync(path);}catch{}}
 }
 async close(){this.closed=true;this.runtimeAbort.abort();this.transcription?.controller.abort();await Promise.allSettled([this.ready,this.transcription?.promise,this.store.close()]);}
}
