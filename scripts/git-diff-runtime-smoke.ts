/** Source and compiled runtime probe. Does not install or touch a live session. */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { listGitChanges, readGitDiff, browseProject } from '../packages/session-host/src/git-diff';
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
 const listing=await browseProject(root,{operation:'list',path:'',showIgnored:false});
 const content=await browseProject(root,{operation:'read',path:'new.txt',showIgnored:false});
 if(!listing.ok||!content.ok||(content.data as any).content!=='compiled worker content\n')throw Error('Compiled project browser failed');
 mkdirSync(join(root,'pages'));for(let i=0;i<1001;i++)writeFileSync(join(root,'pages',String(i).padStart(4,'0')),'');
 const first=await browseProject(root,{operation:'list',path:'pages',showIgnored:true});
 if(!first.ok||!(first.data as any).nextCursor)throw Error('Compiled pagination first page failed');
 const last=await browseProject(root,{operation:'list',path:'pages',showIgnored:true,cursor:(first.data as any).nextCursor});
 if(!last.ok||(last.data as any).entries[0]?.name!=='1000'||(last.data as any).nextCursor)throw Error('Compiled continuation failed');
 writeFileSync(join(root,'.git','index'),'corrupt');
 const fallback=await browseProject(root,{operation:'list',path:'',showIgnored:false});
 const plain=await browseProject(root,{operation:'read',path:'new.txt',showIgnored:false});
 if(!fallback.ok||(fallback.data as any).ignoreStatus!=='unknown'||!plain.ok||(plain.data as any).kind!=='text')throw Error('Compiled broken metadata fallback failed');
 const gif=Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b','hex');gif.writeUInt16LE(16385,24);writeFileSync(join(root,'oversized.gif'),gif);
 const unsafe=await browseProject(root,{operation:'read',path:'oversized.gif',showIgnored:false});if(!unsafe.ok||(unsafe.data as any).kind==='image')throw Error('Compiled GIF bounds failed');
 console.log(JSON.stringify({platform:process.platform,arch:process.arch,bun:Bun.version,compiled:process.execPath,passed:true}));
}finally{rmSync(root,{recursive:true,force:true});}
