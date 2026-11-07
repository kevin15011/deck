import {spawn} from 'node:child_process';
import {accessSync,constants,realpathSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {DictationError} from './wav';
/** Bounded child execution. No shell, model download, or inherited audio/text logging. */
export function runEngine(path:string,args:string[],signal?:AbortSignal,timeout=5000,mergeStderr=false,limit=1024*1024):Promise<string>{
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(new DictationError('dictation-cancelled',408));
  const child=spawn(path,args,{stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
  let output='',size=0,failure:Error|undefined;
  const kill=()=>{try{if(child.pid&&process.platform!=='win32')process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}};
  const abort=()=>{failure=new DictationError('dictation-cancelled',408);kill();};
  const timer=setTimeout(()=>{failure=new DictationError('dictation-engine-timeout',504);kill();},timeout);
  const consume=(chunk:Buffer,stdout:boolean)=>{size+=chunk.length;if(size>limit){failure=new DictationError('dictation-engine-output-limit',502);kill();}else if(stdout||mergeStderr)output+=chunk.toString();};
  child.stdout.on('data',chunk=>consume(chunk,true));child.stderr.on('data',chunk=>consume(chunk,false));
  signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
  const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
  child.once('error',()=>{cleanup();reject(new DictationError('dictation-engine-unavailable',503));});
  child.once('close',code=>{cleanup();if(failure)reject(failure);else if(code!==0)reject(new DictationError('dictation-engine-failed',502));else resolve(output);});
 });
}
export class DictationRuntime {
 private resolving?:Promise<string|undefined>;
 private cached?:{identity:string;path:string};
 constructor(private override:string|undefined=process.env.DECK_WHISPER_CLI){}
 resolve(signal?:AbortSignal):Promise<string|undefined>{
  if(!this.resolving)this.resolving=this.find(signal).finally(()=>{this.resolving=undefined;});return this.resolving;
 }
 private async find(signal?:AbortSignal):Promise<string|undefined>{
  const candidates=this.override?[this.override]:(process.env.PATH??'').split(':').filter(Boolean).map(dir=>join(dir,'whisper-cli')).concat(['/opt/homebrew/bin/whisper-cli','/usr/local/bin/whisper-cli']);
  for(const candidate of candidates)try{
   accessSync(candidate,constants.X_OK);const path=realpathSync(candidate),stat=statSync(path);if(!stat.isFile())continue;
   const identity=JSON.stringify([path,stat.dev,stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs]);if(this.cached?.identity===identity)return path;
   // whisper.cpp prints CLI help to stderr, so use the bounded runner's merged probe mode.
   const help=await probe(path,signal);if(!['-m','-f','-l','-t','-nt','-np','-mc','-sns','-oj','-of'].every(flag=>new RegExp(`(^|\\s)${flag}(?=[,\\s])`,'m').test(help)))continue;
   this.cached={identity,path};return path;
  }catch{if(signal?.aborted)throw new DictationError('dictation-cancelled',408);}
  this.cached=undefined;return;
 }
}
function probe(path:string,signal?:AbortSignal){return runEngine(path,['-h'],signal,5000,true,65536);}
