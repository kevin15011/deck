import {createHash,randomBytes} from 'node:crypto';
import {existsSync,readdirSync,readFileSync,lstatSync,openSync,fsyncSync,closeSync} from 'node:fs';
import {join,dirname,isAbsolute} from 'node:path';
import type {RestartChannel,RestartPreflight,RestartReceipt,RestartRequest} from '@deck/core/session/daemon-restart';
import {assertPrivateFile,ensurePrivateDir,writePrivateFile,type StatePaths} from './paths';
export type RestartIdentity={pid:number;nonce:string;digest:string;channel:RestartChannel;version:string};
export type RestartTarget={launcher:string;digest:string;channel:RestartChannel;version:string};
export type RestartIntent={v:1;requestId:string;deviceId:string;tokenHash:string;previous:RestartIdentity;target:RestartTarget;force:boolean;state:RestartReceipt['state'];createdAt:number;webPort?:number;code?:string;next?:RestartIdentity};
export type RestartLauncher={inspect():Promise<RestartTarget>;prepare(path:string,intent:RestartIntent):Promise<{digest:string;channel:RestartChannel;alive():boolean;cancel():void}>};
export type RestartSnapshot={fingerprint:string;busy:boolean;tasks:number;approvals:number;questions:number};
export type WebRestartOptions={paths:StatePaths;current:RestartIdentity;launcher:RestartLauncher;snapshot():RestartSnapshot;drain(value:boolean):void;stop(reason:string):void;now?:()=>number;webPort?:()=>number|undefined};
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function restartIntentPath(paths:StatePaths,id:string){if(!idPattern.test(id))throw Error('restart-id-invalid');return join(paths.daemonDir,'restarts',id+'.json');}
export function readRestartIntent(path:string):RestartIntent {
 assertPrivateFile(path);if(lstatSync(path).size>8192)throw Error('restart-intent-invalid');const v=JSON.parse(readFileSync(path,'utf8')) as RestartIntent;
 const identity=(i:RestartIdentity|undefined)=>!!i&&Number.isSafeInteger(i.pid)&&i.pid>0&&typeof i.nonce==='string'&&i.nonce.length>0&&i.nonce.length<=128&&/^[a-f0-9]{64}$/.test(i.digest)&&['stable','canary'].includes(i.channel)&&typeof i.version==='string'&&i.version.length<=256;
 if(v.v!==1||!idPattern.test(v.requestId)||typeof v.deviceId!=='string'||v.deviceId.length>128||!/^[a-f0-9]{64}$/.test(v.tokenHash)||!['pending','committed','restarted','failed','aborted'].includes(v.state)||!v.target||!isAbsolute(v.target.launcher)||v.target.launcher.length>4096||v.target.launcher.includes('\0')||!/^[a-f0-9]{64}$/.test(v.target.digest)||!['stable','canary'].includes(v.target.channel)||typeof v.target.version!=='string'||v.target.version.length>256||!identity(v.previous)||v.next!==undefined&&!identity(v.next)||typeof v.force!=='boolean'||!Number.isSafeInteger(v.createdAt)||v.createdAt<0||v.webPort!==undefined&&(!Number.isInteger(v.webPort)||v.webPort<1||v.webPort>65535)||v.code!==undefined&&!/^restart-[a-z-]+$/.test(v.code)&&!['busy','device-required'].includes(v.code))throw Error('restart-intent-invalid');return v;
}
export function writeRestartIntent(path:string,intent:RestartIntent){writePrivateFile(path,JSON.stringify(intent));const fd=openSync(dirname(path),'r');try{fsyncSync(fd);}finally{closeSync(fd);}}
const receipt=(i:RestartIntent):RestartReceipt=>({requestId:i.requestId,state:i.state,force:i.force,version:i.target.version,channel:i.target.channel,...(i.code?{code:i.code}:{})});
/** One device-authenticated restart slot. Preflight reads never acquire admission or create intents. */
export class WebRestart {
 private tokens=new Map<string,{device:string;target:RestartTarget;fingerprint:string;expires:number}>();
 private active=false;
 private readonly now:()=>number;
 constructor(private readonly o:WebRestartOptions){this.now=o.now??Date.now;}
 private same(a:RestartTarget,b:RestartTarget){return a.digest===b.digest&&a.channel===b.channel&&a.launcher===b.launcher&&a.version===b.version;}
 status(device:string,id:string):RestartReceipt|undefined {try{const i=readRestartIntent(restartIntentPath(this.o.paths,id));return i.deviceId===device?receipt(i):undefined;}catch{return undefined;}}
 async preflight(device:string):Promise<RestartPreflight>{
  const base={available:false,current:{version:this.o.current.version,channel:this.o.current.channel},recoveryCommand:this.o.current.channel==='canary'?'deck-canary daemon restart':'deck daemon restart'};
  try{const target=await this.o.launcher.inspect();if(target.channel!==this.o.current.channel)return{...base,code:'restart-channel-mismatch'};
   const snapshot=this.o.snapshot(),token=randomBytes(32).toString('hex');for(const [key,value] of this.tokens)if(value.expires<=this.now()||value.device===device)this.tokens.delete(key);while(this.tokens.size>=64)this.tokens.delete(this.tokens.keys().next().value!);
   this.tokens.set(token,{device,target,fingerprint:snapshot.fingerprint,expires:this.now()+60_000});
   let latest:RestartReceipt|undefined;const dir=join(this.o.paths.daemonDir,'restarts');if(existsSync(dir)){const candidates=readdirSync(dir).filter(f=>/^[0-9a-f-]{36}\.json$/.test(f));if(candidates.length>4096)return{...base,code:'restart-history-unavailable'};if(candidates.length<=4096){let at=0;for(const file of candidates){try{const i=readRestartIntent(join(dir,file));if(i.deviceId===device&&i.createdAt>at){at=i.createdAt;latest=receipt(i);}}catch{}}}}
   return{...base,available:true,token,target:{version:target.version,channel:target.channel,build:target.digest===this.o.current.digest?'same':'different'},work:{tasks:snapshot.tasks,approvals:snapshot.approvals,questions:snapshot.questions,busy:snapshot.busy},...(latest?{latest}:{})};
  }catch{return{...base,code:'restart-unavailable'};}
 }
 async request(device:string,body:RestartRequest,authorized:()=>boolean):Promise<{ok:boolean;code?:string;receipt?:RestartReceipt}>{
  if(!body||typeof body.requestId!=='string'||!idPattern.test(body.requestId)||typeof body.token!=='string'||!/^[a-f0-9]{64}$/.test(body.token)||typeof body.force!=='boolean'||Object.keys(body).some(k=>!['requestId','token','force'].includes(k)))return{ok:false,code:'restart-request-invalid'};
  const path=restartIntentPath(this.o.paths,body.requestId),tokenHash=digest(body.token);
  if(!authorized())return{ok:false,code:'device-required'};
  if(existsSync(path)){try{const i=readRestartIntent(path);if(i.deviceId!==device||i.tokenHash!==tokenHash||i.force!==body.force)return{ok:false,code:'request-id-conflict'};return{ok:true,receipt:receipt(i)};}catch{return{ok:false,code:'restart-storage-unavailable'};}}
  const binding=this.tokens.get(body.token);if(!binding||binding.device!==device||binding.expires<=this.now()||binding.fingerprint!==this.o.snapshot().fingerprint)return{ok:false,code:'restart-stale'};
  if(this.active)return{ok:false,code:'restart-in-progress'};
  if(this.o.snapshot().busy&&!body.force)return{ok:false,code:'busy'};
  this.active=true;let prepared:Awaited<ReturnType<RestartLauncher['prepare']>>|undefined,intent:RestartIntent|undefined,drained=false,committed=false;
  try{
   if(!this.same(binding.target,await this.o.launcher.inspect()))throw Error('restart-stale');
   ensurePrivateDir(join(this.o.paths.daemonDir,'restarts'),{strict:true});
   intent={v:1,requestId:body.requestId,deviceId:device,tokenHash,previous:this.o.current,target:binding.target,force:body.force,state:'pending',createdAt:this.now(),...(this.o.webPort?.()?{webPort:this.o.webPort()}: {})};writeRestartIntent(path,intent);
   prepared=await this.o.launcher.prepare(path,intent);
   if(prepared.digest!==binding.target.digest||prepared.channel!==binding.target.channel||!prepared.alive())throw Error('restart-helper-mismatch');
   if(!this.same(binding.target,await this.o.launcher.inspect()))throw Error('restart-stale');
   if(!authorized())throw Error('device-required');
   const current=this.o.snapshot();if(current.fingerprint!==binding.fingerprint)throw Error('restart-stale');if(current.busy&&!body.force)throw Error('busy');
   // Target inspection awaits a subprocess; readiness can expire while it runs.
   if(!prepared.alive())throw Error('restart-helper-mismatch');
   // No async boundary between final authority/freshness checks, drain and durable commit.
   this.o.drain(true);drained=true;intent.state='committed';writeRestartIntent(path,intent);committed=true;
   setTimeout(()=>this.o.stop(body.force?'web-restart-forced:'+body.requestId:'web-restart:'+body.requestId),0);
   return{ok:true,receipt:receipt(intent)};
  }catch(error){const code=['restart-stale','device-required','busy','restart-helper-mismatch'].includes((error as Error).message)?(error as Error).message:'restart-handoff-failed';
   if(!committed){prepared?.cancel();if(drained)this.o.drain(false);if(intent){intent.state='aborted';intent.code=code;try{writeRestartIntent(path,intent);}catch{}}}return{ok:false,code};
  }finally{if(!committed)this.active=false;}
 }
}
