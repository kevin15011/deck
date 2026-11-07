import {test,expect} from 'bun:test';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {listGitChanges,readGitDiff,readGitContent} from '../git-diff';

// Protects PR semantics through the default isolated process, without network or live project effects.
test('branch comparison uses merge base and committed blobs, rejects stale selections and arbitrary revisions',async()=>{
 const root=mkdtempSync(join(tmpdir(),'deck-branch-test-'));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 try {
  git('init','-q','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
  writeFileSync(join(root,'a.md'),'# Base\n');writeFileSync(join(root,'deleted.md'),'# Deleted\n');git('add','.');git('commit','-qm','base');
  const base=git('rev-parse','HEAD');git('update-ref','refs/remotes/origin/main',base);git('symbolic-ref','refs/remotes/origin/HEAD','refs/remotes/origin/main');git('checkout','-qb','feature');
  git('mv','a.md','renamed.md');writeFileSync(join(root,'added.txt'),'committed\n');git('rm','-q','deleted.md');writeFileSync(join(root,'binary.bin'),Buffer.from([0,1,2]));git('add','.');git('commit','-qm','feature');
  // Remote advances independently. Its added file must not appear as deleted in the PR.
  git('checkout','-q','main');writeFileSync(join(root,'remote-only'),'remote\n');git('add','remote-only');git('commit','-qm','remote');git('update-ref','refs/remotes/origin/main','HEAD');git('checkout','-q','feature');
  writeFileSync(join(root,'added.txt'),'dirty\n');git('add','added.txt');writeFileSync(join(root,'added.txt'),'dirty-worktree\n');writeFileSync(join(root,'untracked'),'not committed');
  const index=readFileSync(join(root,'.git','index')),config=readFileSync(join(root,'.git','config'));
  const reply=await listGitChanges(root,'branch');expect(reply.ok).toBe(true);const data=(reply as any).data;
  expect(data.currentBranch).toBe('feature');expect(data.comparison.base).toBe(base);expect(data.comparison.baseRef).toBe('origin/main');
  expect(data.files.map((f:any)=>f.path).sort()).toEqual(['added.txt','binary.bin','deleted.md','renamed.md']);
  expect(data.files.find((f:any)=>f.path==='added.txt')).toMatchObject({additions:1,deletions:0});
  expect(data.files.find((f:any)=>f.path==='renamed.md')).toMatchObject({previousPath:'a.md'});
  expect(data.files.find((f:any)=>f.path==='binary.bin').binary).toBe(true);
  const revision=data.comparison.revision;
  const diff=await readGitDiff(root,'branch','added.txt',revision);expect((diff as any).data.patch).toContain('+committed');expect((diff as any).data.patch).not.toContain('+dirty');
  const deleted=await readGitContent(root,'branch','deleted.md',revision);expect((deleted as any).data.content).toBe('# Deleted\n');
  expect((await readGitDiff(root,'branch','../outside',revision)).ok).toBe(false);
  expect((await readGitDiff(root,'branch','added.txt','--output=/tmp/unsafe')).ok).toBe(false);
  expect(readFileSync(join(root,'.git','index')).equals(index)).toBe(true);expect(readFileSync(join(root,'.git','config')).equals(config)).toBe(true);
  git('add','added.txt');git('commit','-qm','advance');expect(await readGitDiff(root,'branch','added.txt',revision)).toMatchObject({ok:false,code:'git-stale'});
  git('checkout','-q','--detach','HEAD');const detached=(await listGitChanges(root,'branch') as any).data;expect(detached.currentBranch).toBeUndefined();expect(detached.comparison.headRef).toContain('HEAD (detached');
  const tree=git('rev-parse','HEAD^{tree}'),unrelated=git('commit-tree',tree,'-m','unrelated');git('update-ref','refs/remotes/origin/main',unrelated);
  const unavailable=(await listGitChanges(root,'branch') as any).data;expect(unavailable.files).toEqual([]);expect(unavailable.warnings[0]).toContain('No merge base');
 }finally{rmSync(root,{recursive:true,force:true});}
},30000);

test('missing remote default is explicit while current branch remains available',async()=>{
 const root=mkdtempSync(join(tmpdir(),'deck-branch-missing-'));
 try{execFileSync('git',['init','-q','-b','main'],{cwd:root});const result=await listGitChanges(root,'branch');expect(result.ok).toBe(true);expect((result as any).data).toMatchObject({currentBranch:'main',files:[]});expect((result as any).data.warnings.length).toBeGreaterThan(0);}
 finally{rmSync(root,{recursive:true,force:true});}
});

// Protects bounded progressive committed catalogs and identity independent of index/catalog failure.
// Oracle: all 601 committed additions remain reachable, counts are exact, large documents fail locally.
test('large branch catalogs page without losing files and ignore oversized working index metadata',async()=>{
 const root=mkdtempSync(join(tmpdir(),'deck-branch-large-'));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 try{
  git('init','-q','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');
  git('commit','--allow-empty','-qm','base');git('update-ref','refs/remotes/origin/main','HEAD');git('symbolic-ref','refs/remotes/origin/HEAD','refs/remotes/origin/main');git('checkout','-qb','feature/large');
  for(let i=0;i<600;i++)writeFileSync(join(root,`file-${String(i).padStart(4,'0')}`),'addition\n');
  writeFileSync(join(root,'large.txt'),'large\n'.repeat(60000));git('add','.');git('commit','-qm','many files');
  const first:any=await listGitChanges(root,'branch');expect(first.ok).toBe(true);
  expect(first.data.totalFiles).toBe(601);expect(first.data.files.length).toBeLessThan(501);expect(first.data.nextCursor).toBeDefined();
  const all=[...first.data.files];let cursor=first.data.nextCursor;
  while(cursor){const next:any=await (listGitChanges as any)(root,'branch',cursor);expect(next.ok).toBe(true);all.push(...next.data.files);cursor=next.data.nextCursor;}
  expect(new Set(all.map(f=>f.path)).size).toBe(601);expect(all.reduce((n,f)=>n+f.additions,0)).toBe(60600);
  const revision=first.data.comparison.revision;
  expect((await readGitDiff(root,'branch','large.txt',revision) as any).data.kind).toBe('limited');
  expect((await readGitDiff(root,'branch','file-0599',revision) as any).data.patch).toContain('+addition');
  expect(await (listGitChanges as any)(root,'branch','--output=unsafe')).toMatchObject({ok:false,code:'git-invalid'});
  // An unavailable continuation must fail instead of erasing a previously loaded catalog.
  const head=git('rev-parse','HEAD'),base=git('rev-parse','refs/remotes/origin/main');
  git('symbolic-ref','--delete','refs/remotes/origin/HEAD');
  expect(await listGitChanges(root,'branch',first.data.nextCursor)).toMatchObject({ok:false,code:'git-stale'});
  git('symbolic-ref','refs/remotes/origin/HEAD','refs/remotes/origin/main');
  git('symbolic-ref','HEAD','refs/heads/unborn');
  expect(await listGitChanges(root,'branch',first.data.nextCursor)).toMatchObject({ok:false,code:'git-stale'});
  git('symbolic-ref','HEAD','refs/heads/feature/large');
  const unrelated=git('commit-tree',git('rev-parse','HEAD^{tree}'),'-m','unrelated');
  git('update-ref','refs/remotes/origin/main',unrelated);
  expect(await listGitChanges(root,'branch',first.data.nextCursor)).toMatchObject({ok:false,code:'git-stale'});
  const missing:any=await listGitChanges(root,'branch');expect(missing.ok).toBe(true);expect(missing.data.warnings[0]).toContain('No merge base');
  git('update-ref','refs/remotes/origin/main',base);expect(git('rev-parse','HEAD')).toBe(head);
  git('commit','--allow-empty','-qm','advance');expect(await (listGitChanges as any)(root,'branch',first.data.nextCursor)).toMatchObject({ok:false,code:'git-stale'});
  writeFileSync(join(root,'.git','packed-refs'),Buffer.alloc(65*1024*1024));
  const failedCatalog=await listGitChanges(root,'branch');expect(failedCatalog).toMatchObject({ok:false,code:'git-limit'});
  expect((failedCatalog as any).message).toContain('commit metadata');expect((failedCatalog as any).message).toContain('64 MiB');
  expect(await listGitChanges(root,'identity')).toMatchObject({ok:true,data:{currentBranch:'feature/large'}});
  rmSync(join(root,'.git','packed-refs'));
  // A corrupt/oversized index must not be consulted for a committed comparison or branch identity.
  writeFileSync(join(root,'.git','index'),Buffer.alloc(65*1024*1024));
  expect(await listGitChanges(root,'identity')).toMatchObject({ok:true,data:{currentBranch:'feature/large'}});
  expect((await listGitChanges(root,'branch')).ok).toBe(true);
  const working=await listGitChanges(root);expect(working).toMatchObject({ok:false,code:'git-limit'});
  expect((working as any).message).toContain('snapshot');
 }finally{rmSync(root,{recursive:true,force:true});}
},30000);

// Protects precise command-limit diagnostics at revision resolution; oracle: limits
// remain failures, whereas genuinely missing history remains an initial warning.
test('revision command deadline and output limits survive missing-history fallbacks',async()=>{
 const root=mkdtempSync(join(tmpdir(),'deck-branch-fault-'));
 const git=(...args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 try{
  git('init','-q','-b','main');git('config','user.name','Test');git('config','user.email','test@example.invalid');git('commit','--allow-empty','-qm','base');
  git('update-ref','refs/remotes/origin/main','HEAD');git('symbolic-ref','refs/remotes/origin/HEAD','refs/remotes/origin/main');
  // A fresh runtime keeps the external-process fake out of all other tests.
  const outcomes=JSON.parse(execFileSync(process.execPath,['--eval',`
   const {mock}=await import('bun:test');
   const actual=await import('node:child_process');const realSpawn=actual.spawn;
   const {EventEmitter}=await import('node:events');
   const {PassThrough}=await import('node:stream');
   const nativeTimeout=globalThis.setTimeout;
   let command='',fault='',accelerate=false;
   mock.module('node:child_process',()=>({...actual,spawn:(executable,args,options)=>{
    if(!args.includes(command)||(command==='rev-parse'&&!args.includes('--verify')))return realSpawn(executable,args,options);
    const child=new EventEmitter();child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
    child.kill=()=>{queueMicrotask(()=>child.emit('close',null));return true;};
    if(fault==='deadline')accelerate=true;
    else queueMicrotask(()=>child.stdout.write(Buffer.alloc(1024*1024+1)));
    return child;
   }}));
   globalThis.setTimeout=(fn,ms,...args)=>{
    if(accelerate&&ms===5000){accelerate=false;return nativeTimeout(fn,0,...args);}
    return nativeTimeout(fn,ms,...args);
   };
   const reader=await import(${JSON.stringify(join(import.meta.dir,'../git-diff-reader.ts'))});
   const outcomes=[];
   for(command of ['rev-parse','merge-base'])for(fault of ['deadline','output']){
    outcomes.push({command,fault,reply:await reader.listGitChanges(${JSON.stringify(root)},'branch')});
   }
   console.log(JSON.stringify(outcomes));
  `],{encoding:'utf8'}));
  for(const {command,fault,reply} of outcomes){
   expect(reply).toMatchObject({ok:false,code:'git-limit'});
   expect(reply.message).toContain(command);expect(reply.message).toContain(fault==='deadline'?'5 second command deadline':'1048576 bytes');
  }
  git('symbolic-ref','HEAD','refs/heads/unborn');
  const missing:any=await listGitChanges(root,'branch');expect(missing.ok).toBe(true);expect(missing.data.warnings[0]).toContain('HEAD has no available commit');
 }finally{rmSync(root,{recursive:true,force:true});}
},30000);
