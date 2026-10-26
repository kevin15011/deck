import { afterEach, expect, test } from 'bun:test';
import { mkdtempSync, writeFileSync, rmSync, renameSync, symlinkSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { listGitChanges, readGitDiff, readGitContent } from '../git-diff';
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture(commit = true) {
 const root = mkdtempSync(join(tmpdir(), 'deck-git-')); roots.push(root);
 const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
 git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test');
 const write = (path: string, text: string | Buffer) => writeFileSync(join(root, path), text);
 write('tracked.txt', 'context\nold\ntail\n'); write('deleted.txt', 'removed\n'); write('rename.txt', 'rename me\n');
 if(commit) { git('add', '.'); git('commit', '-qm', 'initial'); }
 return { root, git, write };
}
async function data(result: ReturnType<typeof listGitChanges> | ReturnType<typeof readGitDiff>) { const out = await result; expect(out.ok).toBe(true); if(!out.ok) throw Error(out.code); return out.data as any; }
test('conventional staged, unstaged, untracked, rename, deletion and binary comparisons are read only', async () => {
 const f = fixture(); f.write('tracked.txt', 'context\nstaged\ntail\n'); f.git('add', 'tracked.txt'); f.write('tracked.txt', 'context\nworking\ntail\n');
 rmSync(join(f.root,'deleted.txt')); renameSync(join(f.root,'rename.txt'),join(f.root,'renamed.txt')); f.git('add','-A');
 f.write('tracked.txt', 'context\nworking again\ntail\n'); f.write('new [x].txt', '<script>alert(1)</script>\n'); f.write('binary', Buffer.from([0,1,2]));
 const before = f.git('status','--porcelain=v1','-z'), index = f.git('write-tree'), head = f.git('rev-parse','HEAD');
 const indexBytes=readFileSync(join(f.root,'.git','index'));
 const catalog = await data(listGitChanges(f.root));
 expect(catalog.files).toContainEqual(expect.objectContaining({path:'tracked.txt', section:'staged'}));
 expect(catalog.files).toContainEqual(expect.objectContaining({path:'tracked.txt', section:'unstaged'}));
 const staged = await data(readGitDiff(f.root,'staged','tracked.txt'));
 expect(staged.patch).toContain('-old'); expect(staged.patch).toContain('+working');
 const working = await data(readGitDiff(f.root,'unstaged','tracked.txt')); expect(working.patch).toContain('-working'); expect(working.patch).toContain('+working again');
 expect((await data(readGitDiff(f.root,'untracked','new [x].txt'))).patch).toContain('+<script>');
 expect((await data(readGitDiff(f.root,'untracked','binary'))).kind).toBe('binary');
 expect((await data(readGitDiff(f.root,'staged','renamed.txt'))).patch).toContain('rename from rename.txt');
 expect((await data(readGitDiff(f.root,'staged','deleted.txt'))).patch).toContain('-removed');
 expect(readFileSync(join(f.root,'.git','index'))).toEqual(indexBytes);
 expect(f.git('status','--porcelain=v1','-z')).toBe(before); expect(f.git('write-tree')).toBe(index); expect(f.git('rev-parse','HEAD')).toBe(head);
});
test('unborn HEAD, absent repo, traversal, literal paths, symlinks and bounded content', async () => {
 const f = fixture(false); f.git('add','tracked.txt');
 expect((await data(readGitDiff(f.root,'staged','tracked.txt'))).patch).toContain('+old');
 expect(await readGitDiff(f.root,'untracked','../secret')).toMatchObject({ok:false});
 expect(await readGitDiff(f.root,'untracked','missing')).toMatchObject({ok:false});
 symlinkSync('/etc/passwd', join(f.root,'linked')); expect((await data(readGitDiff(f.root,'untracked','linked'))).kind).toBe('unavailable');
 f.write('huge', 'x'.repeat(300_000)); expect((await data(readGitDiff(f.root,'untracked','huge'))).kind).toBe('limited');
 mkdirSync(join(f.root,'nested')); expect(await listGitChanges(join(f.root,'nested'))).toMatchObject({ok:false});
 const other=mkdtempSync(join(tmpdir(),'deck-no-git-')); roots.push(other); expect(await listGitChanges(other)).toMatchObject({ok:false,code:'git-unavailable'});
});
test('literal magic/newline paths, ignored files and configured helpers stay inert', async () => {
 const f=fixture();
 f.write(':(glob)*', 'literal magic\n'); f.write('line\nbreak', 'newline name\n');f.write('.gitignore','ignored\n');f.write('ignored','secret\n');
 f.write('helper.sh', '#!/bin/sh\ntouch helper-ran\necho external\n');
 f.git('config','diff.outputIndicatorNew','>'); f.git('config','diff.outputIndicatorOld','<'); f.git('config','diff.outputIndicatorContext','.');
 f.git('config','diff.evil.command','sh helper.sh'); f.git('config','diff.evil.textconv','sh helper.sh');f.git('config','core.fsmonitor','sh helper.sh');
 f.write('.gitattributes','*.txt diff=evil\n');f.write('tracked.txt','changed\n');
 expect((await data(readGitDiff(f.root,'unstaged','tracked.txt'))).patch).toContain('+changed');
 expect((await data(readGitDiff(f.root,'untracked',':(glob)*'))).patch).toContain('+literal magic');
 expect((await data(readGitDiff(f.root,'untracked','line\nbreak'))).patch).toContain('+newline name');
 const catalog=await data(listGitChanges(f.root));expect(catalog.files.some((file:any)=>file.path==='ignored'||file.path==='helper-ran')).toBe(false);
 expect(await readGitDiff(f.root,'untracked','ignored')).toMatchObject({ok:false,code:'git-stale'});
 expect(await readGitDiff(f.root,'HEAD','tracked.txt')).toMatchObject({ok:false,code:'git-invalid'});
});
test('unmerged entries and oversized patch/catalog outputs are explicit', async () => {
 const f=fixture();
 const blob=f.git('hash-object','-w','tracked.txt').trim();
 execFileSync('git',['update-index','--index-info'],{cwd:f.root,input:`0 ${'0'.repeat(40)}\ttracked.txt\n100644 ${blob} 1\ttracked.txt\n100644 ${blob} 2\ttracked.txt\n100644 ${blob} 3\ttracked.txt\n`});
 expect((await data(readGitDiff(f.root,'unstaged','tracked.txt'))).kind).toBe('conflict');
 const large=fixture(); large.write('tracked.txt','x\n'.repeat(9000));
 expect((await data(readGitDiff(large.root,'unstaged','tracked.txt'))).kind).toBe('limited');
 const buffered=fixture();buffered.write('tracked.txt',('o'.repeat(100)+'\n').repeat(2000));buffered.git('add','tracked.txt');buffered.git('commit','-qm','large old text');buffered.write('tracked.txt',('n'.repeat(100)+'\n').repeat(2000));
 expect((await data(readGitDiff(buffered.root,'unstaged','tracked.txt'))).kind).toBe('limited');
 for(let i=0;i<501;i++)large.write(`file-${i}`,'new');
 expect(await listGitChanges(large.root)).toMatchObject({ok:false,code:'git-limit'});
});

test('clean and process filter executables remain inert in catalog and patch operations', async () => {
 for (const driver of ['clean','process']) {
  const f=fixture(); const marker=join(f.root,'FILTER_EXECUTED');
  f.write('helper.sh',`#!/bin/sh\ntouch '${marker}'\ncat\n`);
  f.write('.gitattributes','*.txt filter=probe\n');
  f.git('config',`filter.probe.${driver}`,'sh helper.sh');
  f.write('tracked.txt','changed\n');
  await listGitChanges(f.root);
  expect(() => readFileSync(marker)).toThrow();
  const doc=await data(readGitDiff(f.root,'unstaged','tracked.txt'));
  expect(doc.kind).toBe('unavailable');
  expect((await data(readGitContent(f.root,'unstaged','tracked.txt'))).kind).toBe('unavailable');
  expect(() => readFileSync(marker)).toThrow();
 }
});
test('staged gitlink changes remain visible and explicitly unsupported', async () => {
 const f=fixture(); const first=f.git('rev-parse','HEAD').trim();
 f.git('update-index','--add','--cacheinfo',`160000,${first},sub`); f.git('commit','-qm','gitlink');
 mkdirSync(join(f.root,'sub'));
 const second=f.git('rev-parse','HEAD').trim();
 f.git('update-index','--cacheinfo',`160000,${second},sub`);
 const catalog=await data(listGitChanges(f.root));
 expect(catalog.files).toContainEqual(expect.objectContaining({path:'sub',section:'staged'}));
 expect((await data(readGitDiff(f.root,'staged','sub'))).kind).toBe('unavailable');
 expect(catalog.files).toContainEqual(expect.objectContaining({path:'sub',section:'unstaged',status:'?',unavailableReason:expect.any(String)}));
});
test('blank context is normalized despite diff.suppressBlankEmpty', async () => {
 const f=fixture(); f.write('tracked.txt','start\n\nold\ntail\n');f.git('add','.');f.git('commit','-qm','blank');
 f.git('config','diff.suppressBlankEmpty','true');f.write('tracked.txt','start\n\nnew\ntail\n');
 const doc=await data(readGitDiff(f.root,'unstaged','tracked.txt'));
 expect(doc.patch).toContain(' start\n \n-old\n+new\n tail');
});

test('catalog and patch reads remain contained under root and ancestor swaps', async () => {
 const {spyOn}=await import('bun:test');
 const {SafeTree}=await import('../git-safe-tree');
 const {listGitChanges,readGitDiff,readGitContent}=await import('../git-diff-reader');
 for(const operation of ['catalog','patch','content'] as const) for(const boundary of ['root','ancestor'] as const) {
  const f=fixture(), outside=fixture();
  mkdirSync(join(f.root,'dir'));f.write('dir/new','INSIDE_CONTENT\n');
  mkdirSync(join(outside.root,'dir'));outside.write('dir/new','SYNTHETIC_OUTSIDE_REPOSITORY_DATA\n');outside.write('new','SYNTHETIC_OUTSIDE_REPOSITORY_DATA\n');outside.write('OUTSIDE_ONLY','secret');
  let swapped=false;
  const original=SafeTree.prototype.entry;
  const hook=spyOn(SafeTree.prototype,'entry').mockImplementation(function(this:import('../git-safe-tree').SafeTree,name:string) {
   const entry=original.call(this,name);
   // Swap after opening the directory identity, before its children are read.
   if(!swapped && ((boundary==='root' && name==='config') || (boundary==='ancestor' && name==='dir' && entry.kind==='directory'))) {
    swapped=true;
    const target=boundary==='root'?f.root:join(f.root,'dir');
    const moved=target+'-saved';renameSync(target,moved);roots.push(moved);
    symlinkSync(outside.root,target);
   }
   return entry;
  });
  try {
   const result=operation==='catalog'?await listGitChanges(f.root):await (operation==='content'?readGitContent:readGitDiff)(f.root,'untracked','dir/new');
   expect(swapped).toBe(true);
   expect(JSON.stringify(result)).not.toContain('SYNTHETIC_OUTSIDE_REPOSITORY_DATA');
   expect(JSON.stringify(result)).not.toContain('OUTSIDE_ONLY');
   if(result.ok && operation==='content')expect((result.data as any).content).toContain('INSIDE_CONTENT');
   if(result.ok && operation==='patch') expect((result.data as any).patch).toContain('INSIDE_CONTENT');
  } finally {hook.mockRestore();}
 }
});
test('ignored directories are pruned while tracked ignored files retain Git semantics', async () => {
 const f=fixture();mkdirSync(join(f.root,'ignored'));f.write('ignored/tracked','old\n');f.git('add','.');f.git('commit','-qm','tracked ignored');
 f.write('.gitignore','ignored/\n');f.write('ignored/tracked','new\n');f.write('ignored/secret','hidden\n');
 expect((await data(readGitDiff(f.root,'unstaged','ignored/tracked'))).patch).toContain('+new');
 expect((await data(listGitChanges(f.root))).files.some((file:any)=>file.path==='ignored/secret')).toBe(false);
});

test('filter uncertainty is visible even when raw worktree bytes match the index', async () => {
 const f=fixture();f.write('.gitattributes','tracked.txt filter=probe\n');
 f.git('config','filter.probe.clean','sed s/old/transformed/');
 const catalog=await data(listGitChanges(f.root));
 expect(catalog.files).toContainEqual(expect.objectContaining({path:'tracked.txt',section:'unstaged',status:'?',unavailableReason:expect.any(String)}));
 expect((await data(readGitDiff(f.root,'unstaged','tracked.txt'))).kind).toBe('unavailable');
});
test('root symlinks fail while metadata-authorized alternates remain bounded', async () => {
 const f=fixture(),outside=fixture();
 symlinkSync(outside.root,join(f.root,'alias'));
 expect(await listGitChanges(join(f.root,'alias'))).toMatchObject({ok:false,code:'git-unsupported'});
 mkdirSync(join(f.root,'.git','objects','info'),{recursive:true});
 f.write('.git/objects/info/alternates',join(outside.root,'.git','objects'));
 expect((await data(listGitChanges(f.root))).files).toEqual([{path:'alias',section:'untracked',status:'A'}]);
});
test('a swap after a child directory is pinned cannot redirect its regular-file reads', async () => {
 const {spyOn}=await import('bun:test');const {SafeTree}=await import('../git-safe-tree');
 const {listGitChanges,readGitDiff,readGitContent}=await import('../git-diff-reader');
 const f=fixture(),outside=fixture();mkdirSync(join(f.root,'dir'));f.write('dir/new','INSIDE_CONTENT\n');outside.write('new','SYNTHETIC_OUTSIDE_REPOSITORY_DATA\n');
 let opens=0;const original=SafeTree.prototype.entry;
 const hook=spyOn(SafeTree.prototype,'entry').mockImplementation(function(this:import('../git-safe-tree').SafeTree,name:string) {
  const entry=original.call(this,name);
  if(name==='dir' && entry.kind==='directory' && ++opens===2) {
   renameSync(join(f.root,'dir'),join(f.root,'saved'));symlinkSync(outside.root,join(f.root,'dir'));
  }
  return entry;
 });
 try {
  const doc=await data(readGitDiff(f.root,'untracked','dir/new'));
  expect(opens).toBe(2);expect(doc.patch).toContain('INSIDE_CONTENT');expect(doc.patch).not.toContain('SYNTHETIC_OUTSIDE_REPOSITORY_DATA');
 }finally{hook.mockRestore();}
});

test('binary patch words in ordinary text remain textual', async () => {
 const f=fixture();f.write('tracked.txt','Documentation: GIT binary patch is a patch format.\n');
 const doc=await data(readGitDiff(f.root,'unstaged','tracked.txt'));
 expect(doc.kind).toBe('text');expect(doc.patch).toContain('+Documentation: GIT binary patch');
});
test('core.symlinks=false preserves clean literal symlink files', async () => {
 const f=fixture();symlinkSync('target',join(f.root,'link'));f.git('add','link');f.git('commit','-qm','link');
 f.git('config','core.symlinks','false');rmSync(join(f.root,'link'));f.write('link','target');
 expect((await data(listGitChanges(f.root))).files).toEqual([]);
});
test('symlinked TMPDIR is independent of live repository identity', async () => {
 const f=fixture();const temp=mkdtempSync('/tmp/deck-temp-');roots.push(temp);symlinkSync(temp,join(temp,'alias'));
 const previous=process.env.TMPDIR;process.env.TMPDIR=join(temp,'alias');
 try {expect((await data(listGitChanges(f.root))).files).toEqual([]);}finally{if(previous===undefined)delete process.env.TMPDIR;else process.env.TMPDIR=previous;}
});
test('large unrelated untracked content and ignored FIFO do not prevent small reads', async () => {
 const f=fixture();const {openSync,closeSync,ftruncateSync}=await import('node:fs');
 const fd=openSync(join(f.root,'huge'),'w');ftruncateSync(fd,513*1024*1024);closeSync(fd);
 f.write('.gitignore','ignored-pipe\n');execFileSync('mkfifo',[join(f.root,'ignored-pipe')]);execFileSync('mkfifo',[join(f.root,'visible-pipe')]);
 f.write('tracked.txt','small change\n');const catalog=await data(listGitChanges(f.root));
 expect(catalog.files.some((file:any)=>file.path==='ignored-pipe')).toBe(false);
 expect(catalog.files).toContainEqual(expect.objectContaining({path:'visible-pipe',unavailableReason:expect.any(String)}));
 expect((await data(readGitDiff(f.root,'unstaged','tracked.txt'))).patch).toContain('+small change');
 expect((await data(readGitDiff(f.root,'untracked','huge'))).kind).toBe('binary');
});
test('conventional linked worktrees and shared object clones support reads', async () => {
 const f=fixture();const worktree=join(f.root,'linked');f.git('worktree','add','--detach',worktree);
 writeFileSync(join(worktree,'tracked.txt'),'linked change\n');expect((await data(readGitDiff(worktree,'unstaged','tracked.txt'))).patch).toContain('+linked change');
 const clone=join(f.root,'shared');f.git('clone','--shared',f.root,clone);
 writeFileSync(join(clone,'tracked.txt'),'shared change\n');expect((await data(readGitDiff(clone,'unstaged','tracked.txt'))).patch).toContain('+shared change');
});

test('packed history is borrowed without copying its bytes, and selected reads skip unrelated contents', async () => {
 const f=fixture();const {randomBytes}=await import('node:crypto');
 // Historical blob is intentionally much larger than the working content limit.
 f.write('historical',randomBytes(2*1024*1024));f.git('add','.');f.git('commit','-qm','history');
 rmSync(join(f.root,'historical'));f.git('add','-u');f.git('commit','-qm','remove history');f.git('gc','--quiet');
 f.write('tracked.txt','selected\n');
 const {spyOn}=await import('bun:test'),{SafeTree}=await import('../git-safe-tree');
 const reader=await import('../git-diff-reader');const opened:string[]=[];const original=SafeTree.prototype.entry;
 const hook=spyOn(SafeTree.prototype,'entry').mockImplementation(function(this:import('../git-safe-tree').SafeTree,name:string){opened.push(name);return original.call(this,name);});
 try{expect((await data(reader.readGitDiff(f.root,'unstaged','tracked.txt'))).patch).toContain('+selected');expect(opened).not.toContain('deleted.txt');expect(opened).not.toContain('rename.txt');}
 finally{hook.mockRestore();}
 // Exercise the same packed-object descriptor transfer through the production worker.
 expect((await data(readGitDiff(f.root,'unstaged','tracked.txt'))).patch).toContain('+selected');
});

test('ignored FIFO is never opened and a pinned object cannot be redirected to an outside symlink', async () => {
 const f=fixture(),outside=fixture();f.write('.gitignore','pipe\n');execFileSync('mkfifo',[join(f.root,'pipe')]);
 f.write('tracked.txt','inside\n');outside.write('secret','OUTSIDE_OBJECT_MARKER\n');
 const {spyOn}=await import('bun:test'),{SafeTree}=await import('../git-safe-tree');const reader=await import('../git-diff-reader');
 const openHook=spyOn(SafeTree.prototype as any,'open');
 try{await data(reader.listGitChanges(f.root));expect(openHook.mock.calls.some(call=>call[0]==='pipe')).toBe(false);}finally{openHook.mockRestore();}
 const original=SafeTree.prototype.entry;let swapped=false;
 const blob=f.git('rev-parse','HEAD:tracked.txt').trim(),name=blob.slice(2),path=join(f.root,'.git','objects',blob.slice(0,2),name);
 const hook=spyOn(SafeTree.prototype,'entry').mockImplementation(function(this:import('../git-safe-tree').SafeTree,child:string){
  const entry=original.call(this,child);
  if(!swapped && child===name && entry.kind==='file'){swapped=true;renameSync(path,path+'-saved');symlinkSync(join(outside.root,'secret'),path);}
  return entry;
 });
 try{const result=await reader.readGitDiff(f.root,'unstaged','tracked.txt');expect(swapped).toBe(true);expect(JSON.stringify(result)).not.toContain('OUTSIDE_OBJECT_MARKER');expect(result).toMatchObject({ok:true,data:{patch:expect.stringContaining('+inside')}});}
 finally{hook.mockRestore();}
});

test('bounded processes support concurrent projects, reject duplicate work, and release capacity', async () => {
 const fixtures=Array.from({length:5},()=>fixture());
 for(const f of fixtures)f.write('tracked.txt','pool\n');
 const first=fixtures.slice(0,4).map(f=>listGitChanges(f.root));
 expect(await listGitChanges(fixtures[0]!.root)).toMatchObject({ok:false,code:'git-busy'});
 expect(await listGitChanges(fixtures[4]!.root)).toMatchObject({ok:false,code:'git-busy'});
 for(const result of await Promise.all(first))expect(result.ok).toBe(true);
 for(let i=0;i<8;i++)expect((await data(readGitDiff(fixtures[i%5]!.root,'unstaged','tracked.txt'))).patch).toContain('+pool');
});
test('nested repositories retain a single unavailable boundary even with 501 files', async () => {
 const f=fixture(); f.write('tracked.txt','changed\n');
 const nested=join(f.root,'nested');mkdirSync(nested);execFileSync('git',['init','-q',nested]);
 for(let i=0;i<501;i++)writeFileSync(join(nested,String(i)),'nested content');
 const result=await data(listGitChanges(f.root));
 expect(result.files).toHaveLength(2);
 expect(result.files).toContainEqual(expect.objectContaining({path:'nested',section:'untracked',unavailableReason:expect.any(String)}));
 expect((await data(readGitDiff(f.root,'untracked','nested'))).kind).toBe('unavailable');
 expect((await data(readGitDiff(f.root,'unstaged','tracked.txt'))).patch).toContain('+changed');
});
test('staged comparison is independent of oversized working counterpart', async () => {
 const f=fixture();f.write('tracked.txt','staged small\n');f.git('add','tracked.txt');f.write('tracked.txt','x'.repeat(300000));
 expect((await data(readGitDiff(f.root,'staged','tracked.txt'))).patch).toContain('+staged small');
 expect((await data(readGitDiff(f.root,'unstaged','tracked.txt'))).kind).toBe('limited');
});

test('Markdown content selects full index, working and deleted prior versions with safe bounds', async () => {
 const {readGitContent}=await import('../git-diff');
 const f=fixture();
 f.write('doc.md','# Original\n'+ 'unchanged\n'.repeat(30));f.git('add','doc.md');f.git('commit','-qm','document');
 f.write('doc.md','# Index\n'+ 'unchanged\n'.repeat(30));f.git('add','doc.md');
 f.write('doc.md','# Working\n<script>bad()</script>\n[unsafe](javascript:bad)\n');
 expect(await data(readGitContent(f.root,'staged','doc.md'))).toMatchObject({version:'index',content:'# Index\n'+'unchanged\n'.repeat(30)});
 expect(await data(readGitContent(f.root,'unstaged','doc.md'))).toMatchObject({version:'working',content:'# Working\n<script>bad()</script>\n[unsafe](javascript:bad)\n'});
 rmSync(join(f.root,'doc.md'));
 expect(await data(readGitContent(f.root,'unstaged','doc.md'))).toMatchObject({version:'index',content:'# Index\n'+'unchanged\n'.repeat(30)});
 f.git('add','doc.md');
 expect(await data(readGitContent(f.root,'staged','doc.md'))).toMatchObject({version:'HEAD',content:'# Original\n'+'unchanged\n'.repeat(30)});
 f.write('new.md','# New\n');expect(await data(readGitContent(f.root,'untracked','new.md'))).toMatchObject({version:'working',content:'# New\n'});
 f.write('huge.md','x'.repeat(300000));expect((await data(readGitContent(f.root,'untracked','huge.md'))).kind).toBe('limited');
 f.git('add','huge.md');expect((await data(readGitContent(f.root,'staged','huge.md'))).kind).toBe('limited');
 f.git('add','new.md');f.write('new.md','x'.repeat(300000));expect(await data(readGitContent(f.root,'staged','new.md'))).toMatchObject({kind:'text',content:'# New\n'});
 f.write('binary.md',Buffer.from([0,1,2]));expect((await data(readGitContent(f.root,'untracked','binary.md'))).kind).toBe('binary');
 symlinkSync('/etc/passwd',join(f.root,'link.md'));expect((await data(readGitContent(f.root,'untracked','link.md'))).kind).toBe('unavailable');
 f.git('add','link.md');expect((await data(readGitContent(f.root,'staged','link.md'))).kind).toBe('unavailable');
 expect(await readGitContent(f.root,'untracked','../outside.md')).toMatchObject({ok:false,code:'git-invalid'});
 expect(await readGitContent(f.root,'untracked','missing.md')).toMatchObject({ok:false,code:'git-stale'});
});

test('viewer limits do not invent large changes and retain real large text and binary changes', async () => {
 const f=fixture();
 const text='line of text\n'.repeat(25000), binary=Buffer.alloc(300_000,1);binary[10]=0;
 f.write('large.txt',text);f.write('photo.jpg',binary);f.git('add','.');f.git('commit','-qm','large files');
 const index=readFileSync(join(f.root,'.git','index'));
 expect(f.git('status','--porcelain')).toBe('');
 expect((await data(listGitChanges(f.root))).files).toEqual([]);
 f.write('large.txt','X'+text.slice(1));binary[20]=2;f.write('photo.jpg',binary);
 const changed=await data(listGitChanges(f.root));
 for(const path of ['large.txt','photo.jpg'])expect(changed.files).toContainEqual({path,section:'unstaged',status:'M'});
 expect((await data(readGitDiff(f.root,'unstaged','large.txt'))).kind).toBe('limited');
 expect((await data(readGitDiff(f.root,'unstaged','photo.jpg'))).kind).toBe('binary');
 f.write('new.jpg',binary);f.write('new.txt',text);
 expect((await data(listGitChanges(f.root))).files).toContainEqual({path:'new.jpg',section:'untracked',status:'A'});
 expect((await data(readGitDiff(f.root,'untracked','new.jpg'))).kind).toBe('binary');
 expect((await data(readGitDiff(f.root,'untracked','new.txt'))).kind).toBe('limited');
 rmSync(join(f.root,'photo.jpg'));rmSync(join(f.root,'large.txt'));
 const deleted=await data(listGitChanges(f.root));
 for(const path of ['large.txt','photo.jpg'])expect(deleted.files).toContainEqual({path,section:'unstaged',status:'D'});
 expect((await data(readGitDiff(f.root,'unstaged','photo.jpg'))).kind).toBe('binary');
 expect((await data(readGitDiff(f.root,'unstaged','large.txt'))).kind).toBe('limited');
 expect(readFileSync(join(f.root,'.git','index'))).toEqual(index);
});
test('large-file hashing cannot exhaust the small-file capture budget',async()=>{
 const f=fixture();f.write('a-large.bin',Buffer.alloc(60*1024*1024));
 for(let i=0;i<40;i++)f.write(`small-${i}.txt`,'x'.repeat(200000));f.git('add','.');f.git('commit','-qm','budget fixture');
 expect((await data(listGitChanges(f.root))).files).toEqual([]);
 f.write('tracked.txt','small actual change\n');expect((await data(listGitChanges(f.root))).files).toEqual([{path:'tracked.txt',section:'unstaged',status:'M'}]);
},15000);

test('large intent-to-add keeps unstaged addition status',async()=>{
 const f=fixture();f.write('new-large','x'.repeat(300000));f.git('add','-N','new-large');
 expect(f.git('status','--porcelain')).toContain(' A new-large');
 expect((await data(listGitChanges(f.root))).files).toContainEqual({path:'new-large',section:'unstaged',status:'A'});
});
