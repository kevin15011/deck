/** Bounded Git subprocesses. No shell, index refresh, helpers, model calls, or arbitrary file reads. */
import { spawn } from 'node:child_process';
import { lstatSync, closeSync, mkdtempSync, rmSync, mkdirSync, symlinkSync, writeFileSync, realpathSync, readFileSync, readSync, fstatSync } from 'node:fs';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { SafeTree, TreeLimitError, copyRegular, type CopyBudget } from './git-safe-tree';
import { join, resolve } from 'node:path';
import type { GitCatalog, GitDocument, GitContent, GitFile } from '@deck/core';
import type { CommandOutcome } from './protocol';
const MAX_PATCH = 256 * 1024, MAX_CATALOG = 1024 * 1024, MAX_FILES = 500;
const messages = {
 'git-invalid': 'Invalid Git file selection.', 'git-unavailable': 'Git changes are unavailable. Open a session at a Git worktree root.',
 'git-limit': 'Git read exceeded the viewer limits: 500 changed files, 1 MiB catalog, 256 KiB diff, 5 seconds per command; bounded metadata/worktree reads, 100,000 entries or 10 seconds.',
 'git-unsupported': 'This repository uses unsupported filesystem entries or Git metadata indirection.',
 'git-stale': 'This change is no longer available. Refresh the file list.', 'git-busy': 'Another Git view request is running. Try again.',
};
class GitError extends Error { constructor(readonly code: keyof typeof messages) { super(messages[code]); } }
const failure = (error: unknown): CommandOutcome => { const code = error instanceof GitError ? error.code : 'git-unavailable'; return {ok:false,code,message:messages[code]}; };
const active = new Set<string>();
// Each private view owns the descriptors passed to its Git children. Paths in
// objects/ refer only to these inherited regular-file handles, never live paths.
const objectHandles = new Map<string, number[]>();
export function git(root: string, args: string[], maxBuffer = MAX_CATALOG, diff = false, input?:string|{fd:number,size:number}): Promise<string> {
 const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
 return new Promise((resolve, reject) => {
  const child=spawn('git', ['--no-pager', ...(args[0]==='check-ignore'?[]:['--literal-pathspecs']), '-c', 'core.fsmonitor=false', '-c', 'core.attributesFile=/dev/null', '-c', 'core.excludesFile=/dev/null', '-c', 'core.untrackedCache=false', '-c', 'diff.submodule=short', '-c', 'diff.suppressBlankEmpty=false', ...args], {
   cwd:root, env:{...env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null',GIT_NO_LAZY_FETCH:'1',GIT_ATTR_NOSYSTEM:'1',LC_ALL:'C'},
   stdio:['pipe','pipe','pipe',...(['config','rev-parse','ls-files','check-ignore'].includes(args[0]!)?[]:objectHandles.get(root)??[])],
  });
  let size=0, limited=false; const chunks:Buffer[]=[];
  const timer=setTimeout(()=>{limited=true;child.kill('SIGKILL');},5000);
  child.stdout!.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maxBuffer){limited=true;child.kill('SIGKILL');}else chunks.push(chunk);});
  child.stderr!.on('data',()=>{});
  child.once('error',()=>{clearTimeout(timer);reject(new GitError('git-unavailable'));});
  child.once('close',code=>{clearTimeout(timer);if(limited)reject(new GitError('git-limit'));else if(code!==0 && !(diff && code===1))reject(new GitError('git-unavailable'));else resolve(Buffer.concat(chunks).toString('utf8'));});
  child.stdin!.on('error',()=>{});
  if(typeof input==='object') {
   // Stream only the captured extent, from the already authorized descriptor.
   const source=input;
   const stream=Readable.from((function*(){let offset=0;while(offset<source.size){const buffer=Buffer.alloc(Math.min(65536,source.size-offset));const count=readSync(source.fd,buffer,0,buffer.length,offset);if(!count)throw Error('Content changed');offset+=count;yield buffer.subarray(0,count);}})());
   stream.on('error',()=>child.kill('SIGKILL'));child.once('close',()=>stream.destroy());stream.pipe(child.stdin!);
  }else child.stdin!.end(input);
 });
}
/** Git runs only in this private, disposable request view. No session baseline
 * is stored. Live directories are traversed through openat, not Git/pathnames. */
type View = {root:string, unavailable:Map<string,string>, large:Map<string,{binary:boolean,status?:string}>, dispose:()=>void};
const SPECIAL = 'Special filesystem entries are not rendered.';
function livePath(path:string) {
 // These are OS-owned Darwin aliases, not arbitrary user symlinks.
 return process.platform==='darwin'?resolve(path).replace(/^\/(tmp|var|etc)(?=\/|$)/,'/private/$1'):resolve(path);
}
async function repository(projectRoot: string, selected?:string): Promise<View> {
 const root=realpathSync(mkdtempSync(join(tmpdir(),'deck-git-view-')));
 const handles:number[]=[];objectHandles.set(root,handles);
 const unavailable=new Map<string,string>(),large=new Map<string,{binary:boolean,status?:string}>();
 const dispose=()=>{objectHandles.delete(root);for(const fd of handles)closeSync(fd);rmSync(root,{recursive:true,force:true});};
 const budget:CopyBudget={bytes:64*1024*1024,entries:100_000,deadline:Date.now()+10_000};
 let comparisonBytes=64*1024*1024;
 const tick=()=>{if(--budget.entries<0 || Date.now()>budget.deadline)throw new TreeLimitError('Repository read limit exceeded');};
 const trees:SafeTree[]=[];
 const own=(tree:SafeTree)=>{trees.push(tree);return tree;};
 function readMetadata(entry:{fd:number,size:number},limit=MAX_CATALOG):string {
  try {
   if(entry.size>limit)throw new TreeLimitError('Metadata limit');
   const buffer=Buffer.alloc(entry.size);let offset=0;
   while(offset<buffer.length){const count=readSync(entry.fd,buffer,offset,buffer.length-offset,offset);if(!count)throw Error('Metadata changed');offset+=count;}
   return buffer.toString('utf8');
  }finally{closeSync(entry.fd);}
 }
 function text(tree:SafeTree,name:string):string {
  const entry=tree.entry(name);if(entry.kind!=='file') {if(entry.kind==='directory')entry.tree.close();throw Error('Invalid metadata');}
  return readMetadata(entry);
 }
 function copy(tree:SafeTree,name:string,target:string) {
  const entry=tree.entry(name);if(entry.kind!=='file'){if(entry.kind==='directory')entry.tree.close();throw Error('Invalid metadata');}
  copyRegular(entry,target,budget);
 }
 function copyRefs(tree:SafeTree,target:string) {
  mkdirSync(target,{recursive:true,mode:0o700});
  for(const name of tree.names()) {tick();const entry=tree.entry(name);
   if(entry.kind==='file')copyRegular(entry,join(target,name),budget);
   else if(entry.kind==='directory'){try{copyRefs(entry.tree,join(target,name));}finally{entry.tree.close();}}
   else throw Error('Invalid refs');
  }
 }
 const stores=new Set<string>();
 function objects(tree:SafeTree,path:string,target:string,depth=0) {
  if(depth>8 || stores.size>=16)throw new TreeLimitError('Object store nesting limit');
  if(stores.has(path))return;stores.add(path);mkdirSync(target,{recursive:true,mode:0o700});
  for(const name of tree.names()) {
   tick();
   if(!/^[0-9a-f]{2}$/.test(name) && name!=='pack' && name!=='info')continue;
   const dir=tree.directory(name);
   try {
    if(name==='info') {
     if(dir.names().includes('alternates')) {
      const alternatePaths=text(dir,'alternates').split('\n').filter(Boolean);
      if(alternatePaths.length>16)throw new TreeLimitError('Object store limit');
      for(const alternate of alternatePaths) {
       // Conventional newline-delimited absolute/relative alternate object stores.
       // Authority comes only from captured repository metadata, never API input.
       const location=livePath(resolve(path,alternate));
       const next=SafeTree.root(location);
       try{objects(next,location,target,depth+1);}finally{next.close();}
      }
     }
     continue;
    }
    mkdirSync(join(target,name),{recursive:true,mode:0o700});
    for(const file of dir.names()) {
     tick();
     if(name==='pack'?!/^pack-[0-9a-f]{40,64}\.(pack|idx|rev)$/.test(file):!/^([0-9a-f]{38}|[0-9a-f]{62})$/.test(file))continue;
     const destination=join(target,name,file);
     try{lstatSync(destination);continue;}catch{}
     const entry=dir.entry(file);
     if(entry.kind!=='file'){if(entry.kind==='directory')entry.tree.close();throw Error('Invalid object');}
     // fd 0..2 are pipes. Every other fd is a captured regular object file.
     const childFd=handles.length+3;handles.push(entry.fd);
     symlinkSync(`/dev/fd/${childFd}`,destination);
    }
   }finally{dir.close();}
  }
 }
 try {
  const source=own(SafeTree.root(livePath(projectRoot)));
  if(!source.names().includes('.git'))throw new GitError('git-unavailable');
  const gitEntry=source.entry('.git');let metadata:SafeTree,metadataPath:string;
  if(gitEntry.kind==='directory'){metadata=own(gitEntry.tree);metadataPath=join(livePath(projectRoot),'.git');}
  else if(gitEntry.kind==='file') {
   const pointer=readMetadata(gitEntry,4096).trim();
   if(!pointer.startsWith('gitdir: '))throw Error('Invalid gitdir');
   metadataPath=livePath(resolve(projectRoot,pointer.slice(8)));metadata=own(SafeTree.root(metadataPath));
  }else throw Error('Invalid gitdir');
  let common=metadata,commonPath=metadataPath;
  if(metadata.names().includes('commondir')) {
   commonPath=livePath(resolve(metadataPath,text(metadata,'commondir').trim()));common=own(SafeTree.root(commonPath));
  }
  const gitdir=join(root,'.git');mkdirSync(gitdir,{mode:0o700});
  const commonNames=common.names(),metaNames=metadata.names();
  for(const name of ['HEAD','index',...metaNames.filter(name=>name.startsWith('sharedindex.'))])if(metaNames.includes(name))copy(metadata,name,join(gitdir,name));
  for(const name of ['packed-refs','shallow'])if(commonNames.includes(name))copy(common,name,join(gitdir,name));
  if(commonNames.includes('refs')){const refs=common.directory('refs');try{copyRefs(refs,join(gitdir,'refs'));}finally{refs.close();}}else mkdirSync(join(gitdir,'refs'));
  const store=common.directory('objects');try{objects(store,join(commonPath,'objects'),join(gitdir,'objects'));}finally{store.close();}
  const allowed=new Set(['core.repositoryformatversion','core.filemode','core.ignorecase','core.precomposeunicode','core.autocrlf','core.eol','core.safecrlf','core.symlinks','extensions.objectformat']);
  writeFileSync(join(gitdir,'config'),'');
  let worktreeConfig=false, filemode=true;
  for(const [configTree,configName] of [[common,'config'],[metadata,'config.worktree']] as const) {
   if(configName==='config.worktree' && !worktreeConfig || !configTree.names().includes(configName))continue;
   const input=join(root,'config.input');copy(configTree,configName,input);
   const values=await git(root,['config','--no-includes','--file',input,'--null','--list']);rmSync(input);
   for(const record of values.split('\0').filter(Boolean)) {
    const at=record.indexOf('\n'),key=at<0?record:record.slice(0,at),value=at<0?'true':record.slice(at+1);
    if(key.startsWith('extensions.') && !['extensions.objectformat','extensions.worktreeconfig'].includes(key))throw Error('Unsupported Git extension');
    if(key==='extensions.worktreeconfig')worktreeConfig=['true','yes','on','1'].includes(value.toLowerCase());
    if(key==='core.filemode')filemode=!['false','no','off','0'].includes(value.toLowerCase());
    if(allowed.has(key))await git(root,['config','--file',join(gitdir,'config'),'--',key,value]);
   }
  }
  if(commonNames.includes('info')) {
   const info=common.directory('info');try {mkdirSync(join(gitdir,'info'));
    for(const name of info.names().filter(name=>['exclude','attributes'].includes(name)))copy(info,name,join(gitdir,'info',name));
   }finally{info.close();}
  }
  if((await git(root,['rev-parse','--show-toplevel'])).trim()!==root)throw Error('Not a worktree');
  const indexed=(await git(root,['ls-files','--stage','-z'])).split('\0').filter(Boolean);
  const tracked=new Set<string>(),gitlinks=new Set<string>(),parents=new Set<string>();
  for(const record of indexed) {
   const name=record.slice(record.indexOf('\t')+1);if(!validPath(name))throw Error('Invalid index path');
   tracked.add(name);if(record.startsWith('160000 '))gitlinks.add(name);
   const parts=name.split('/');parts.pop();while(parts.length){parents.add(parts.join('/'));parts.pop();}
  }
  async function copyWorktree(tree:SafeTree,relative='') {
   const names=tree.names().filter(name=>name!=='.git');const destination=join(root,relative);
   // Always capture interpretation files, even on a selected-file read.
   for(const name of ['.gitignore','.gitattributes'])if(names.includes(name)) {
    const entry=tree.entry(name);
    if(entry.kind==='file') {if(entry.size>MAX_CATALOG){closeSync(entry.fd);throw new TreeLimitError('Attribute/ignore limit');}copyRegular(entry,join(destination,name),budget);}
    else if(entry.kind==='directory')entry.tree.close();
   }
   const ignored=new Set<string>(),directories=new Set<string>();
   const relevant=names.filter(name=>{const path=relative?`${relative}/${name}`:name;return !selected || path===selected || selected.startsWith(path+'/') || ['.gitignore','.gitattributes'].includes(name);});
   for(const name of relevant) {
    const entry=tree.entry(name);if(entry.kind==='directory'){directories.add(name);entry.tree.close();}else if(entry.kind==='file')closeSync(entry.fd);
   }
   const candidates=relevant.map(name=>relative?`${relative}/${name}`:name).filter(name=>!tracked.has(name)&&!parents.has(name));
   for(let i=0;i<candidates.length;i+=1000) {
    const batch=candidates.slice(i,i+1000);
    for(const name of (await git(root,['check-ignore','-z','--stdin'],MAX_CATALOG,true,batch.map(name=>'./'+name+(directories.has(name.split('/').at(-1)!)?'/':'')).join('\0')+'\0')).split('\0').filter(Boolean))ignored.add(name.replace(/^\.\//,'').replace(/\/$/,''));
   }
   for(const name of relevant) {
    const path=relative?`${relative}/${name}`:name;if(ignored.has(path))continue;tick();
    if(['.gitignore','.gitattributes'].includes(name)){try{if(lstatSync(join(destination,name)).isFile())continue;}catch{}}
    const entry=tree.entry(name),target=join(destination,name);
    if(entry.kind==='file') {
     if(entry.size>MAX_PATCH){
      try {
       const sample=Buffer.alloc(Math.min(8000,entry.size));
       const count=readSync(entry.fd,sample,0,sample.length,0);
       const info:{binary:boolean,status?:string}={binary:sample.subarray(0,count).includes(0)};
       large.set(path,info);
       if(tracked.has(path)) {
        const record=indexed.find(record=>record.endsWith('\t'+path) && record.split('\t')[0]!.endsWith(' 0'));
        if(record && /^100(644|755) /.test(record)) {
         if(entry.size>comparisonBytes) {
          info.status='?';unavailable.set(path,'Working content exceeded the request read budget; this entry was not compared.');
         }else {
          comparisonBytes-=entry.size;
          const before=fstatSync(entry.fd);
          const oid=(await git(root,['hash-object','--stdin','--path='+path],128,false,entry)).trim();
          const after=fstatSync(entry.fd);
          if(after.size!==entry.size || after.mtimeMs!==before.mtimeMs || after.ctimeMs!==before.ctimeMs)throw Error('Repository changed during read');
          if(!/^[0-9a-f]{40,64}$/.test(oid))throw Error('Invalid blob identity');
          const [mode,indexOid]=record.split(' ');
          info.status=oid!==indexOid || filemode && (mode==='100755')!==Boolean(entry.mode&0o111)?'M':' ';
         }
        }
       }
       writeFileSync(target,'',{mode:entry.mode&0o111?0o700:0o600});
      }finally{closeSync(entry.fd);}
     }
     else if(!tracked.has(path) && selected!==path){closeSync(entry.fd);writeFileSync(target,'');}
     else if(entry.size>budget.bytes){unavailable.set(path,'Working content exceeded the request read budget; this entry was not compared.');closeSync(entry.fd);writeFileSync(target,'');}
     else copyRegular(entry,target,budget);
    }else if(entry.kind==='link')symlinkSync(entry.target,target);
    else if(entry.kind==='special'){unavailable.set(path,SPECIAL);writeFileSync(target,'');}
    else {try{mkdirSync(target,{mode:0o700});if(!gitlinks.has(path)) { if(entry.tree.names().includes('.git') && !parents.has(path)) unavailable.set(path,'Nested repository content is not inspected by this viewer.'); else await copyWorktree(entry.tree,path); }}finally{entry.tree.close();}}
   }
  }
  await copyWorktree(source);
  return {root,unavailable,large,dispose};
 }catch(error){dispose();if(error instanceof TreeLimitError)throw new GitError('git-limit');if(error instanceof GitError)throw error;throw new GitError('git-unsupported');}
 finally{for(const tree of trees.reverse())tree.close();}
}
function validPath(path: unknown): path is string {
 return typeof path === 'string' && path.length > 0 && path.length <= 4096 && !path.includes('\0') && !path.startsWith('/') && path.split('/').every(part => part !== '..' && part !== '.' && part !== '');
}
async function catalog(view: View, selected?:string): Promise<GitCatalog> {
 const {root}=view;
 const raw = await git(root, ['status','--porcelain=v1','-z','--untracked-files=all','--ignore-submodules=dirty']);
 const entries = raw.split('\0'), files: GitFile[] = [];
 for(let i=0;i<entries.length;i++) {
  const entry=entries[i]!; if(!entry) continue;
  let xy=entry.slice(0,2);const path=entry.slice(3);
  const largeStatus=view.large.get(path)?.status;
  if(largeStatus!==undefined && xy[1]!=='A' && !xy.includes('U') && xy!=='AA' && xy!=='DD')xy=xy[0]+largeStatus;
  const previousPath = /[RC]/.test(xy) ? entries[++i] : undefined;
  if(!validPath(path) || previousPath !== undefined && !validPath(previousPath)) throw new GitError('git-invalid');
  if(selected && path!==selected)continue;
  if(xy==='??') files.push({path,section:'untracked',status:'A'});
  else if(xy==='!!') continue;
  else if(xy.includes('U') || xy==='AA' || xy==='DD') files.push({path,section:'unstaged',status:'U'});
  else {
   if(xy[0]!==' ') files.push({path,section:'staged',status:xy[0]!,...(previousPath?{previousPath}:{})});
   if(xy[1]!==' ') files.push({path,section:'unstaged',status:xy[1]!,...(previousPath && /[RC]/.test(xy[1]!)?{previousPath}:{})});
  }
  if(files.length>MAX_FILES) throw new GitError('git-limit');
 }
 // Without executable conversion, equality for filter-managed working files
 // is unknown. Retain them explicitly instead of claiming a clean worktree.
 const indexed=(await git(root,['ls-files','--stage','-z'])).split('\0').filter(Boolean);
 const paths=[...new Set([...indexed.map(record=>record.slice(record.indexOf('\t')+1)),...files.map(file=>file.path)])].filter(path=>!selected || path===selected);
 for(let i=0;i<paths.length;i+=1000) {
  const attributes=(await git(root,['check-attr','-z','--stdin','filter'],MAX_CATALOG,false,paths.slice(i,i+1000).join('\0')+'\0')).split('\0');
  for(let at=0;at+2<attributes.length;at+=3) {
   if(['unspecified','unset'].includes(attributes[at+2]!))continue;
   const path=attributes[at]!;
   const reason='Executable Git conversion filters are not run. Change detection and content for this path are unavailable.';
   const existing=files.filter(file=>file.path===path && file.section!=='staged');
   if(existing.length)for(const file of existing)file.unavailableReason=reason;
   else if(fileState(root,path)!=='missing')files.push({path,section:'unstaged',status:'?',unavailableReason:reason});
  }
 }
 if(files.length>MAX_FILES)throw new GitError('git-limit');
 for(const record of indexed.filter(record=>record.startsWith('160000 ') && (!selected || record.slice(record.indexOf('\t')+1)===selected))) {
  const path=record.slice(record.indexOf('\t')+1);
  if(!files.some(file=>file.path===path && file.section==='unstaged'))files.push({path,section:'unstaged',status:'?',unavailableReason:'Submodule working-tree state is not inspected by this viewer.'});
 }
 if(files.length>MAX_FILES)throw new GitError('git-limit');
 for(const [path,reason] of view.unavailable) {
  const file=files.find(file=>file.path===path && file.section!=='staged');
  if(file)file.unavailableReason=reason;else files.push({path,section:trackedPath(indexed,path)?'unstaged':'untracked',status:'?',unavailableReason:reason});
 }
 // A placeholder may equal an empty index blob even when the real file differs.
 // Only captured content identity can supply this missing working change.
 for(const [path,info] of view.large) {
  if(info.status && info.status!==' ' && !files.some(file=>file.path===path && file.section==='unstaged'))
   files.push({path,section:'unstaged',status:info.status,...(view.unavailable.has(path)?{unavailableReason:view.unavailable.get(path)}:{})});
 }
 if(files.length>MAX_FILES)throw new GitError('git-limit');
 const warnings=indexed.some(record=>record.startsWith('160000 '))?['Submodule working-tree contents are not inspected. Staged gitlink changes are listed.']:[];
 return {files,...(warnings.length?{warnings}:{})};
}
function trackedPath(indexed:string[],path:string){return indexed.some(record=>record.slice(record.indexOf('\t')+1)===path);}
/** Reject traversed links and special files. Git may render a final tracked symlink's literal target safely. */
function fileState(root: string, path: string): 'regular'|'special'|'missing'|'large' {
 let current=root; const parts=path.split('/');
 for(let i=0;i<parts.length;i++) {
  current=join(current,parts[i]!);
  try { const stat=lstatSync(current); const last=i===parts.length-1;
   if(stat.isSymbolicLink() || !stat.isDirectory() && !last || last && !stat.isFile()) return 'special';
   if(last && stat.size>MAX_PATCH) return 'large';
  } catch(error) { if((error as NodeJS.ErrnoException).code==='ENOENT') return 'missing'; throw error; }
 }
 return 'regular';
}
async function bounded(projectRoot: string, action: (view: View) => Promise<GitCatalog|GitDocument|GitContent>, selected?:string): Promise<CommandOutcome> {
 const key=resolve(projectRoot);
 if(active.has(key) || active.size>=4) return failure(new GitError('git-busy'));
 active.add(key);
 let view:Awaited<ReturnType<typeof repository>>|undefined;
 try { view=await repository(projectRoot,selected);return {ok:true,data:await action(view)}; } catch(error) {return failure(error);} finally {try{view?.dispose();}finally{active.delete(key);}}
}
export function listGitChanges(projectRoot: string): Promise<CommandOutcome> { return bounded(projectRoot,catalog); }
export function readGitDiff(projectRoot: string, section: unknown, path: unknown): Promise<CommandOutcome> { return readSelected(projectRoot,section,path,false); }
export function readGitContent(projectRoot: string, section: unknown, path: unknown): Promise<CommandOutcome> { return readSelected(projectRoot,section,path,true); }
function readSelected(projectRoot: string, section: unknown, path: unknown, content: boolean): Promise<CommandOutcome> {
 if(!['staged','unstaged','untracked'].includes(String(section)) || !validPath(path)) return Promise.resolve(failure(new GitError('git-invalid')));
 return bounded(projectRoot,async view => {
  const {root}=view;
  const file=(await catalog(view,path)).files.find(file=>file.section===section && file.path===path);
  if(!file) throw new GitError('git-stale');
  const document = (kind: GitDocument['kind'], message: string): GitDocument|GitContent => content ? {file,kind,content:'',message} : {file,kind,patch:'',message};
  if(file.unavailableReason)return document('unavailable',file.unavailableReason);
  if(section!=='staged' && view.large.has(path))return view.large.get(path)!.binary ? document('binary','Binary file changed. Content is not rendered.') : document('limited','File exceeds the 256 KiB viewer limit.');
  if(file.status==='U') return document('conflict','Unmerged file. Resolve the conflict outside this read-only viewer.');
  const index=await git(root,['ls-files','--stage','-z','--',file.path]);
  if(index.split('\0').some(entry=>entry.startsWith('160000 ')))return document('unavailable','Submodule content is not rendered.');
  const attributes=(await git(root,['check-attr','-z',...(section==='staged'?['--cached']:[]),'filter','--',file.path])).split('\0');
  if(attributes[2] && !['unspecified','unset'].includes(attributes[2]))return document('unavailable','Executable Git conversion filters are not run. This comparison is unavailable.');
  const state=fileState(root,file.path);
  if(section!=='staged' && (state==='special' || file.previousPath && fileState(root,file.previousPath)==='special')) return document('unavailable','Symlinks, submodules and special files are not rendered.');
  if(section!=='staged' && state==='large') return document('limited','File exceeds the 256 KiB viewer limit.');
  if(content) {
   const version: GitContent['version']=section==='staged' ? (file.status==='D'?'HEAD':'index') : file.status==='D'?'index':'working';
   let text:string;
   try {
    if(version==='working') {
     if(state!=='regular')return document('unavailable','Regular file content is no longer available. Refresh the file list.');
     text=readFileSync(join(root,file.path),'utf8'); // Captured private view, never the live pathname.
    } else {
     const record=version==='HEAD' ? await git(root,['ls-tree','-z','HEAD','--',file.path]) : index;
     const match=/^(100644|100755) (?:blob )?([0-9a-f]{40,64})(?: 0)?\t/.exec(record);
     if(!match)return document('unavailable','Only regular file documents can be previewed.');
     const oid=match[2]!;
     const size=Number((await git(root,['cat-file','-s',oid])).trim());
     if(!Number.isSafeInteger(size)||size<0||size>MAX_PATCH)return document('limited','Document exceeds the 256 KiB viewer limit.');
     text=await git(root,['cat-file','blob',oid],MAX_PATCH);
    }
   } catch(error) {if(error instanceof GitError && error.code==='git-limit')return document('limited',messages['git-limit']);throw error;}
   if(text.includes('\0'))return document('binary','Binary file content is not rendered.');
   return {file,kind:'text',content:text,version};
  }
  const args = ['diff','--no-ext-diff','--no-textconv','--no-color','--no-relative','--unified=3','--output-indicator-new=+','--output-indicator-old=-','--output-indicator-context= ','--ignore-submodules=dirty'];
  let patch: string;
  try {
   patch=await git(root,section==='untracked' ? [...args,'--no-index','--','/dev/null',file.path] : [...args,...(section==='staged'?['--cached']:[]),'--',...(file.previousPath?[file.previousPath]:[]),file.path],MAX_PATCH,section==='untracked');
  } catch(error) { if(error instanceof GitError && error.code==='git-limit') return document('limited',messages['git-limit']); throw error; }
  if(Buffer.byteLength(patch)>MAX_PATCH || patch.split('\n').length>6000) return document('limited','Diff exceeds the 256 KiB / 6,000 line viewer limit.');
  if(patch.split('\n').some(line=>line==='GIT binary patch' || /^Binary files .* differ$/.test(line))) return document('binary','Binary file changed. Content is not rendered.');
  return {file,kind:'text',patch,...(!patch?{message:'No textual changes remain. Refresh the file list; metadata-only changes may have no hunks.'}:{})};
 },path);
}
