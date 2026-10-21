/** CLI-owned executable provenance and detached restart helper. No PATH lookup, download or installer import. */
import {createHash} from 'node:crypto';
import {spawn,type ChildProcess} from 'node:child_process';
import {chmodSync,constants,copyFileSync,existsSync,lstatSync,readFileSync,readlinkSync,realpathSync} from 'node:fs';
import {basename,dirname,join,isAbsolute} from 'node:path';
import {homedir} from 'node:os';
import {ControlClient,readDaemonInfo,readLockHolder,resolveStatePaths,assertPrivateFile,writePrivateFile,type StatePaths} from '@deck/session-host';
import {readRestartIntent,writeRestartIntent,type RestartIdentity,type RestartIntent,type RestartLauncher,type RestartTarget} from '@deck/session-host';
import type {RestartChannel} from '@deck/core/session/daemon-restart';
import {getBuildInfo} from './runtime/build-info';
const hashFile=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
const uid=()=>process.getuid?.()??0;
const sleep=(ms:number)=>new Promise<void>(r=>setTimeout(r,ms));
const exists=(pid:number)=>{try{process.kill(pid,0);return true;}catch(e){return(e as NodeJS.ErrnoException).code!=='ESRCH';}};
function trustedFile(path:string){const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink()||![0,uid()].includes(s.uid)||(s.mode&0o022)!==0||(s.mode&0o111)===0||s.nlink!==1)throw Error('restart-untrusted-executable');}
/** Root/user-owned stable regular files; canary follows only the canonical same-directory digest alias. */
export function resolveRestartTarget(launcher:string,channel:RestartChannel):{path:string;digest:string}{
 if(!isAbsolute(launcher)||launcher.includes('\0'))throw Error('restart-untrusted-launcher');const dir=dirname(launcher),d=lstatSync(dir);if(realpathSync(dir)!==dir)throw Error('restart-untrusted-directory');if(/\/(?:Cellar|Caskroom)\//.test(launcher))throw Error('restart-unsupported-install');let ancestor=dirname(dir);for(;;){const st=lstatSync(ancestor);if(!st.isDirectory()||st.isSymbolicLink()||![0,uid()].includes(st.uid)||((st.mode&0o022)!==0&&!(st.uid===0&&(st.mode&0o1000)!==0)))throw Error('restart-untrusted-directory');if(ancestor===dirname(ancestor))break;ancestor=dirname(ancestor);}
 const defaultCanary=channel==='canary'&&existsSync(join(homedir(),'.local/bin'))&&dir===realpathSync(join(homedir(),'.local/bin'))&&d.uid===uid()&&d.gid===(process.getgid?.()??0);
 if(!d.isDirectory()||d.isSymbolicLink()||![0,uid()].includes(d.uid)||(d.mode&0o002)||((d.mode&0o020)&&!defaultCanary))throw Error('restart-untrusted-directory');
 let path=launcher;
 if(channel==='stable'){if(basename(launcher)!=='deck')throw Error('restart-unsupported-install');trustedFile(path);}
 else{if(basename(launcher)!=='deck-canary'||!lstatSync(launcher).isSymbolicLink())throw Error('restart-unsupported-install');const link=readlinkSync(launcher);if(!/^\.deck-canary\.payload-[a-f0-9]{64}$/.test(link))throw Error('restart-untrusted-alias');path=join(dir,link);trustedFile(path);if(hashFile(path)!==link.slice('.deck-canary.payload-'.length))throw Error('restart-digest-mismatch');}
 return{path,digest:hashFile(path)};
}
/** Observe the owned helper without treating a signal-only exit as a numeric exit. */
export function trackRestartHelper(child:ChildProcess):{alive():boolean;cancel():void}{
 let failed=false,exited=false;child.on('error',()=>{failed=true;});child.once('exit',()=>{exited=true;});
 const alive=()=>!failed&&!exited&&child.exitCode===null&&child.signalCode===null;
 return{alive,cancel:()=>{if(alive())child.kill('SIGTERM');}};
}
function channelOfBuild():RestartChannel|undefined{return getBuildInfo().channel==='stable'?'stable':getBuildInfo().channel==='dev'?'canary':undefined;}
async function versionOf(path:string,channel:RestartChannel):Promise<string>{
 const p=spawn(path,['--version'],{stdio:['ignore','pipe','pipe'],env:process.env});let text='',bytes=0;
 return await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{p.kill('SIGTERM');reject(Error('restart-target-unresponsive'));},3000);p.stdout.on('data',chunk=>{bytes+=chunk.length;if(bytes>4096){p.kill('SIGTERM');return;}text+=chunk;});p.stderr.on('data',()=>{});p.once('error',()=>{clearTimeout(timer);reject(Error('restart-target-unavailable'));});p.once('close',code=>{clearTimeout(timer);const version=/^deck ([^\s]+)$/m.exec(text)?.[1],buildChannel=/^channel: (stable|dev)$/m.exec(text)?.[1];if(code!==0||bytes>4096||!version||buildChannel!==(channel==='stable'?'stable':'dev'))reject(Error('restart-channel-mismatch'));else resolve(version);});});
}
function intentFile(path:string,paths:StatePaths){if(dirname(path)!==join(paths.daemonDir,'restarts')||!/^[a-f0-9-]{36}\.json$/.test(basename(path)))throw Error('restart-intent-path-invalid');assertPrivateFile(path);return readRestartIntent(path);}
/** Captured at daemon startup; a helper-started daemon retains the original canonical launcher. */
export function captureRestartLauncher(paths:StatePaths):{identity:Omit<RestartIdentity,'pid'|'nonce'>;launcher:RestartLauncher;webPort?:number}|undefined {
 try{
  const recovery=process.env.DECK_DAEMON_RESTART_INTENT,from=recovery?intentFile(recovery,paths):undefined;
  const channel=channelOfBuild();if(!channel)throw Error('restart-unsupported-channel');
  if(from&&(from.state!=='committed'||from.target.digest!==hashFile(process.execPath)||from.target.channel!==channel))throw Error('restart-startup-mismatch');
  const startup=realpathSync(process.execPath);let launcher=from?.target.launcher??startup;
  if(!from&&channel==='canary'&&/^\.deck-canary\.payload-[a-f0-9]{64}$/.test(basename(startup)))launcher=join(dirname(startup),'deck-canary');
  // Validate initial shape. Startup bytes and target may differ after a later legitimate upgrade.
  const initial=resolveRestartTarget(launcher,channel),startupDigest=hashFile(startup);
  if(!from&&initial.digest!==startupDigest)throw Error('restart-startup-mismatch');
  const inspect=async():Promise<RestartTarget>=>{const before=resolveRestartTarget(launcher,channel),version=await versionOf(before.path,channel),after=resolveRestartTarget(launcher,channel);if(before.digest!==after.digest||before.path!==after.path)throw Error('restart-target-changed');return{launcher,digest:before.digest,channel,version};};
  return{...(from?.webPort?{webPort:from.webPort}:{}),identity:{digest:startupDigest,channel,version:getBuildInfo().version},launcher:{inspect,prepare:async(path,intent)=>{
   const selected=resolveRestartTarget(launcher,channel);if(selected.digest!==intent.target.digest)throw Error('restart-target-changed');
   const executable=join(dirname(path),'.payload-'+intent.target.digest);if(!existsSync(executable)){copyFileSync(selected.path,executable,constants.COPYFILE_EXCL);chmodSync(executable,0o700);}trustedFile(executable);if(hashFile(executable)!==intent.target.digest||resolveRestartTarget(launcher,channel).digest!==intent.target.digest)throw Error('restart-target-changed');
   const child=spawn(executable,['internal','daemon-restart-helper',path],{cwd:paths.daemonDir,env:process.env,detached:true,stdio:'ignore'});const lifetime=trackRestartHelper(child);child.unref();
   const cancel=lifetime.cancel;
   try{const deadline=Date.now()+5000;while(Date.now()<deadline){if(!lifetime.alive())throw Error('restart-helper-unavailable');if(existsSync(path+'.ready')){assertPrivateFile(path+'.ready');const ready=JSON.parse(readFileSync(path+'.ready','utf8'));if(ready.pid!==child.pid||ready.requestId!==intent.requestId)throw Error('restart-helper-identity');return{digest:ready.digest,channel:ready.channel,alive:()=>lifetime.alive()&&hashFile(executable)===intent.target.digest,cancel};}await sleep(20);}throw Error('restart-helper-timeout');}catch(e){cancel();throw e;}
  }}};
 }catch{return undefined;}
}
export function restartStartupVerified(p:{spawnedPid:number|undefined;previousNonce:string;digest:string;channel:RestartChannel;port?:number;info:{pid:number;nonce:string};holder?:{pid:number;nonce:string};hello:{t:string;pid?:number;nonce?:string};status?:{pid:number;nonce:string;web?:{port:number};executable?:{digest:string;channel:string}};targetDigest:string}):boolean{
 return Number.isSafeInteger(p.spawnedPid)&&p.spawnedPid!>0&&p.hello.t==='hello'&&p.hello.pid===p.spawnedPid&&p.info.pid===p.spawnedPid&&p.holder?.pid===p.spawnedPid&&p.holder.nonce===p.info.nonce&&p.hello.nonce===p.info.nonce&&p.hello.nonce!==p.previousNonce&&p.status?.pid===p.spawnedPid&&p.status.nonce===p.info.nonce&&p.status.executable?.digest===p.digest&&p.status.executable.channel===p.channel&&p.targetDigest===p.digest&&(p.port===undefined||p.status.web?.port===p.port);
}
/** Only a committed private intent can launch. Pending/aborted intents and uncertain shutdown never replay execution. */
export async function runWebRestartHelper(path:string):Promise<number>{
 const paths=resolveStatePaths();let intent:RestartIntent|undefined;
 try{
  intent=intentFile(path,paths);if(intent.state!=='pending')throw Error('restart-intent-not-pending');
  const executable=join(dirname(path),'.payload-'+intent.target.digest),channel=channelOfBuild();if(realpathSync(process.execPath)!==realpathSync(executable)||!channel||channel!==intent.target.channel||hashFile(executable)!==intent.target.digest)throw Error('restart-helper-mismatch');
  writePrivateFile(path+'.ready',JSON.stringify({requestId:intent.requestId,pid:process.pid,digest:hashFile(executable),channel}));
  const committedBy=Date.now()+10_000;while(Date.now()<committedBy){intent=intentFile(path,paths);if(intent.state==='committed')break;if(intent.state!=='pending')return 1;await sleep(20);}if(intent.state!=='committed')throw Error('restart-not-committed');
  const stopBy=Date.now()+30_000;while(Date.now()<stopBy){const holder=readLockHolder(paths),info=readDaemonInfo(paths);if((holder&&holder.nonce!==intent.previous.nonce)||(info&&info.nonce!==intent.previous.nonce))throw Error('restart-owner-changed');if(!holder&&!info&&!existsSync(paths.socket.path)&&!exists(intent.previous.pid))break;await sleep(40);}
  if(exists(intent.previous.pid)||existsSync(paths.lockFile)||existsSync(paths.daemonInfoFile)||existsSync(paths.socket.path))throw Error('restart-shutdown-unconfirmed');
  if(hashFile(executable)!==intent.target.digest||resolveRestartTarget(intent.target.launcher,intent.target.channel).digest!==intent.target.digest)throw Error('restart-target-changed');
  // Spawn the exact verified snapshot, never a mutable stable path after validation.
  const child=spawn(executable,['internal','session-daemon'],{cwd:paths.daemonDir,env:{...process.env,DECK_DAEMON_RESTART_INTENT:path},detached:true,stdio:'ignore'});let spawnFailed=false;child.on('error',()=>{spawnFailed=true;});child.unref();
  const startBy=Date.now()+15_000;while(Date.now()<startBy){if(spawnFailed||child.exitCode!==null)throw Error('restart-start-failed');const info=readDaemonInfo(paths);if(info){const client=await ControlClient.connect(paths.socket.path,{timeoutMs:500}).catch(()=>undefined);if(client){try{const hello=await client.request({t:'hello',clientVersion:getBuildInfo().version},500),status=await client.request({t:'daemon.status'},500);const value=status.t==='daemon.status'?status.status as {pid:number;nonce:string;web?:{port:number};executable?:{digest:string;channel:string}}:undefined;
    const holder=readLockHolder(paths);if(hello.t!=='hello'||!restartStartupVerified({spawnedPid:child.pid,previousNonce:intent.previous.nonce,digest:intent.target.digest,channel:intent.target.channel,port:intent.webPort,info,holder,hello,status:value,targetDigest:resolveRestartTarget(intent.target.launcher,intent.target.channel).digest}))throw Error('restart-startup-mismatch');
    intent.next={pid:child.pid!,nonce:hello.nonce,digest:intent.target.digest,channel:intent.target.channel,version:hello.daemonVersion};intent.state='restarted';writeRestartIntent(path,intent);return 0;
   }finally{client.close();}}}await sleep(40);}throw Error('restart-start-timeout');
 }catch(error){if(intent?.state==='committed'){intent.state='failed';intent.code=/^restart-[a-z-]+$/.test((error as Error).message)?(error as Error).message:'restart-helper-failed';try{writeRestartIntent(path,intent);}catch{}}return 1;}
}
