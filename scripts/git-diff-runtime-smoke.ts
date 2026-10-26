/** Source and compiled runtime probe. Does not install or touch a live session. */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { listGitChanges, readGitDiff } from '../packages/session-host/src/git-diff';
if(process.argv[2]==='internal-git-reader-v1'){
 const {runGitReaderProcess}=await import('../packages/session-host/src/git-diff-process');
 try{await runGitReaderProcess();process.exit(0);}catch{process.exit(1);}
}
const root=mkdtempSync(join(tmpdir(),'deck-git-runtime-'));
try {
 execFileSync('git',['init','-q',root]);
 writeFileSync(join(root,'tracked.txt'),'before\n');
 execFileSync('git',['-C',root,'add','.']);
 execFileSync('git',['-C',root,'-c','user.name=Probe','-c','user.email=probe@example.com','commit','-qm','initial']);
 execFileSync('git',['-C',root,'gc','--quiet']);
 writeFileSync(join(root,'tracked.txt'),'after\n');
 writeFileSync(join(root,'new.txt'),'compiled worker content\n');
 for(let i=0;i<3;i++) {
  const catalog=await listGitChanges(root),doc=await readGitDiff(root,'untracked','new.txt');
  const tracked=await readGitDiff(root,'unstaged','tracked.txt');
  if(!tracked.ok || !(tracked.data as any).patch?.includes('+after'))throw Error(JSON.stringify(tracked));
  if(!catalog.ok || !doc.ok || !(doc.data as any).patch?.includes('+compiled worker content'))throw Error(JSON.stringify({catalog,doc}));
 }
 console.log(JSON.stringify({platform:process.platform,arch:process.arch,bun:Bun.version,compiled:process.execPath,passed:true}));
}finally{rmSync(root,{recursive:true,force:true});}
