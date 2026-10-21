import {afterEach,expect,test} from 'bun:test';
import {chmodSync,copyFileSync,mkdtempSync,readFileSync,realpathSync,rmSync,symlinkSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
import {resolveRestartTarget,restartStartupVerified,trackRestartHelper} from './web-daemon-restart';
const roots:string[]=[];afterEach(()=>{for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
function fixture(){const dir=realpathSync(mkdtempSync(join(tmpdir(),'deck-restart-launcher-')));roots.push(dir);const deck=join(dir,'deck');writeFileSync(deck,'fixture',{mode:0o755});return{dir,deck};}
test('canonical stable regular default/custom prefix needs no manifest; rejects writable and symlink shapes',()=>{const f=fixture();expect(resolveRestartTarget(f.deck,'stable').path).toBe(f.deck);chmodSync(f.deck,0o777);expect(()=>resolveRestartTarget(f.deck,'stable')).toThrow();chmodSync(f.deck,0o755);symlinkSync('deck',join(f.dir,'alias'));expect(()=>resolveRestartTarget(join(f.dir,'alias'),'stable')).toThrow();chmodSync(f.dir,0o777);expect(()=>resolveRestartTarget(f.deck,'stable')).toThrow();});
test('canary uses only the same-directory digest-named payload; wrong digest and cross-channel alias fail',()=>{const f=fixture(),digest=createHash('sha256').update(readFileSync(f.deck)).digest('hex'),payload='.deck-canary.payload-'+digest;copyFileSync(f.deck,join(f.dir,payload));symlinkSync(payload,join(f.dir,'deck-canary'));expect(resolveRestartTarget(join(f.dir,'deck-canary'),'canary').digest).toBe(digest);expect(()=>resolveRestartTarget(join(f.dir,'deck-canary'),'stable')).toThrow();writeFileSync(join(f.dir,payload),'changed');expect(()=>resolveRestartTarget(join(f.dir,'deck-canary'),'canary')).toThrow();});
test('world-writable parent, path components and payload symlinks cannot choose a launch target',()=>{const f=fixture();const dir=join(f.dir,'nested');mkdirSync(dir);symlinkSync(dir,join(f.dir,'linked'));copyFileSync(f.deck,join(dir,'deck'));expect(()=>resolveRestartTarget(join(f.dir,'linked/deck'),'stable')).toThrow();symlinkSync('../deck',join(f.dir,'deck-canary'));expect(()=>resolveRestartTarget(join(f.dir,'deck-canary'),'canary')).toThrow();});

test('startup success requires spawned PID, lock, new nonce, exact executable digest/channel and retained port together',()=>{const p={spawnedPid:123,previousNonce:'old',digest:'a'.repeat(64),channel:'stable' as const,port:7421,info:{pid:123,nonce:'new'},holder:{pid:123,nonce:'new'},hello:{t:'hello',pid:123,nonce:'new'},status:{pid:123,nonce:'new',web:{port:7421},executable:{digest:'a'.repeat(64),channel:'stable'}},targetDigest:'a'.repeat(64)};expect(restartStartupVerified(p)).toBe(true);for(const changed of [{status:{...p.status,executable:{...p.status.executable,digest:'b'.repeat(64)}}},{status:{...p.status,executable:{...p.status.executable,channel:'canary'}}},{spawnedPid:999},{previousNonce:'new'},{holder:{pid:999,nonce:'new'}},{targetDigest:'b'.repeat(64)},{status:{...p.status,web:{port:9999}}}])expect(restartStartupVerified({...p,...changed})).toBe(false);});

test('force restart is not added to CLI or the session/MCP mutation contract',async()=>{const {parseArgs}=await import('./cli-args');const {validateSessionCommand}=await import('@deck/core/session/commands');expect(parseArgs(['daemon','restart','--force']).command).toBe('error');expect(validateSessionCommand({v:1,commandId:crypto.randomUUID(),type:'daemon.restart',force:true}).ok).toBe(false);});


test('SIGTERM helper exit during final inspection refuses without commit, shutdown or retained admission',async()=>{
 const {spawn}=await import('node:child_process'),{once}=await import('node:events');
 const {WebRestart,resolveStatePaths,ensureStateLayout}=await import('@deck/session-host');
 const f=fixture(),paths=resolveStatePaths({env:{HOME:f.dir}});ensureStateLayout(paths);
 const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}),lifetime=trackRestartHelper(child);
 try{
  await once(child,'spawn');let inspections=0,stops=0,draining=false;
  const target={launcher:f.deck,digest:'a'.repeat(64),channel:'stable' as const,version:'0.13.0'};
  const r=new WebRestart({paths,current:{pid:process.pid,nonce:'old',...target},snapshot:()=>({fingerprint:'idle',busy:false,tasks:0,approvals:0,questions:0}),drain:v=>{draining=v;},stop:()=>{stops++;},launcher:{inspect:async()=>{if(++inspections===3){const exited=once(child,'exit');child.kill('SIGTERM');await exited;expect(child.exitCode).toBeNull();expect(child.signalCode).toBe('SIGTERM');}return target;},prepare:async()=>({...target,...lifetime})}});
  const p=await r.preflight('device'),id=crypto.randomUUID();const result=await r.request('device',{requestId:id,token:p.token!,force:false},()=>true);
  await new Promise<void>(resolve=>setImmediate(resolve));
  expect(lifetime.alive()).toBe(false);expect(result.ok).toBe(false);expect(result.code).toBe('restart-helper-mismatch');expect(r.status('device',id)?.state).toBe('aborted');expect(stops).toBe(0);expect(draining).toBe(false);
  const next=await r.preflight('device');expect((await r.request('device',{requestId:crypto.randomUUID(),token:next.token!,force:false},()=>true)).code).toBe('restart-helper-mismatch');
 }finally{lifetime.cancel();if(child.exitCode===null&&child.signalCode===null)await once(child,'exit');}
});
