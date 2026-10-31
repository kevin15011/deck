/** Read-only latency probe plus a disposable large-untracked fixture. */
import { mkdtempSync, rmSync, writeFileSync, openSync, ftruncateSync, closeSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { listGitChanges, readGitDiff } from '../packages/session-host/src/git-diff';
import type { CommandOutcome } from '../packages/session-host/src/protocol';
import type { GitCatalog } from '../packages/core/src/session/git-diff';
async function measure(label:string, action:()=>Promise<CommandOutcome>) {
 let last=performance.now(),maxTimerGapMs=0,ticks=0;
 const timer=setInterval(()=>{const now=performance.now();maxTimerGapMs=Math.max(maxTimerGapMs,now-last);last=now;ticks++;},5);
 const start=performance.now();
 try {
  const result=await action();
  console.log(JSON.stringify({label,elapsedMs:performance.now()-start,maxTimerGapMs,ticks,ok:result.ok,...(!result.ok?{error:result}:{})}));
  if(!result.ok)throw Error(`Probe failed: ${label}`);
  return result;
 }finally{clearInterval(timer);}
}
const checkout=resolve(process.argv[2]??join(import.meta.dir,'..'));
const catalog=await measure('checkout catalog',()=>listGitChanges(checkout));
const selected=(catalog.data as GitCatalog).files.find(file=>!file.unavailableReason);
if(selected)await measure('checkout selected',()=>readGitDiff(checkout,selected.section,selected.path));
const fixture=mkdtempSync(join(tmpdir(),'deck-git-large-probe-'));
try {
 execFileSync('git',['init','-q',fixture]);
 writeFileSync(join(fixture,'small.txt'),'before\n');
 execFileSync('git',['-C',fixture,'add','.']);
 execFileSync('git',['-C',fixture,'-c','user.name=Probe','-c','user.email=probe@example.com','commit','-qm','initial']);
 writeFileSync(join(fixture,'small.txt'),'after\n');
 const fd=openSync(join(fixture,'unrelated-large'),'w');try{ftruncateSync(fd,513*1024*1024);}finally{closeSync(fd);}
 await measure('513 MiB untracked catalog',()=>listGitChanges(fixture));
 await measure('513 MiB untracked small selection',()=>readGitDiff(fixture,'unstaged','small.txt'));
 const count=()=>process.platform==='linux'?readdirSync('/proc/self/fd').length:undefined;
 const before=count();for(let i=0;i<20;i++)await readGitDiff(fixture,'unstaged','small.txt');
 console.log(JSON.stringify({label:'20 repeated requests',descriptorsBefore:before,descriptorsAfter:count()}));
}finally{rmSync(fixture,{recursive:true,force:true});}
