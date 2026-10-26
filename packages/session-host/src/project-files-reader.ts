/** Loaded only in the isolated reader process. All live access is descriptor-relative. */
import {closeSync,fstatSync,readSync,mkdtempSync,realpathSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {SafeTree,TreeLimitError} from './git-safe-tree';
import {git} from './git-diff-reader';
import type {ProjectBrowse,ProjectContent,ProjectEntry,ProjectListing} from '../../core/src/session/project-files';
import type {CommandOutcome} from './protocol';
const TEXT_LIMIT=1024*1024, IMAGE_LIMIT=8*1024*1024;
const admin=(name:string)=>['.git','.svn','.hg'].includes(name.toLowerCase());
function valid(path:unknown):path is string{return typeof path==='string'&&path.length<=4096&&!path.includes('\0')&&!path.startsWith('/')&&(path===''||path.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!admin(part)));}
function bytes(entry:{fd:number;size:number},limit:number){
 try{if(entry.size>limit)throw new TreeLimitError('File size limit');const before=fstatSync(entry.fd);if(before.size!==entry.size)throw Error('File changed');const out=Buffer.alloc(entry.size);let offset=0;
 while(offset<out.length){const n=readSync(entry.fd,out,offset,out.length-offset,offset);if(!n)throw Error('File changed');offset+=n;}
 const after=fstatSync(entry.fd);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs)throw Error('File changed');return out;
 }finally{closeSync(entry.fd);}
}
/** Only raster signatures determine MIME. No SVG or HTML is rendered as media. */
export function raster(b:Buffer):{mime:'image/png'|'image/jpeg'|'image/gif'|'image/webp';width:number;height:number}|undefined{
 if(b.length>=24&&b.subarray(0,16).equals(Buffer.from('89504e470d0a1a0a0000000d49484452','hex'))){
  for(let at=8;at+12<=b.length;){const length=b.readUInt32BE(at),type=b.toString('ascii',at+4,at+8);if(['acTL','fcTL','fdAT'].includes(type))return;if(length>b.length-at-12)return;at+=length+12;}
  return {mime:'image/png',width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
 }
 if(b.length>=13&&['GIF87a','GIF89a'].includes(b.toString('ascii',0,6))){
  const width=b.readUInt16LE(6),height=b.readUInt16LE(8);let at=13,frames=0,pixels=0;
  if(!width||!height||width>16384||height>16384||width*height>40000000)return;
  if(b[10]!&128)at+=3*(1<<((b[10]!&7)+1));
  function blocks(){while(at<b.length){const size=b[at++]!;if(!size)return true;if(at+size>b.length)return false;at+=size;}return false;}
  while(at<b.length){
   const tag=b[at++]!;
   if(tag===0x3b)return frames>0&&at===b.length?{mime:'image/gif',width,height}:undefined;
   if(tag===0x21){if(at>=b.length)return;at++;if(!blocks())return;continue;}
   if(tag!==0x2c||at+9>b.length)return;
   const x=b.readUInt16LE(at),y=b.readUInt16LE(at+2),w=b.readUInt16LE(at+4),h=b.readUInt16LE(at+6),packed=b[at+8]!;at+=9;
   // Browsers may grow the decoded image beyond the logical screen.
   if(!w||!h||x+w>width||y+h>height||++frames>256||(pixels+=width*height)>80000000)return;
   if(packed&128)at+=3*(1<<((packed&7)+1));
   if(at>=b.length||b[at]!<2||b[at]!>8)return;at++;
   if(!blocks())return;
  }
  return;
 }
 if(b.length>=20&&b.toString('ascii',0,4)==='RIFF'&&b.toString('ascii',8,12)==='WEBP'&&b.readUInt32LE(4)+8===b.length){
  let canvas:{width:number;height:number}|undefined,frame:typeof canvas,at=12;
  while(at+8<=b.length){
   const size=b.readUInt32LE(at+4),chunk=b.toString('ascii',at,at+4),data=at+8;
   if(size>b.length-data||chunk==='ANIM'||chunk==='ANMF')return;
   if(chunk==='VP8X'){
    if(at!==12||size!==10||b[data]!&2)return;
    canvas={width:1+b.readUIntLE(data+4,3),height:1+b.readUIntLE(data+7,3)};
   }else if(chunk==='VP8 '||chunk==='VP8L'){
    if(frame)return;
    if(chunk==='VP8 '){if(size<10||!b.subarray(data+3,data+6).equals(Buffer.from([0x9d,1,0x2a])))return;frame={width:b.readUInt16LE(data+6)&0x3fff,height:b.readUInt16LE(data+8)&0x3fff};}
    else{if(size<5||b[data]!==0x2f)return;const dimensions=b.readUInt32LE(data+1);frame={width:1+(dimensions&0x3fff),height:1+((dimensions>>>14)&0x3fff)};}
   }
   at=data+size+(size&1);
  }
  if(at!==b.length||!frame||canvas&&(frame.width!==canvas.width||frame.height!==canvas.height))return;
  return {mime:'image/webp',...(canvas??frame)};
 }
 if(b.length>=4&&b[0]===0xff&&b[1]===0xd8){
  let at=2;while(at+4<=b.length){if(b[at++]!==0xff)return;while(b[at]===0xff)at++;const marker=b[at++];if(marker===0xda||marker===0xd9)return;if(marker===1||marker!==undefined&&marker>=0xd0&&marker<=0xd7)continue;
   if(at+2>b.length)return;const length=b.readUInt16BE(at);if(length<2||at+length>b.length)return;
   if(marker!==undefined&&[0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker)&&length>=8)return {mime:'image/jpeg',height:b.readUInt16BE(at+3),width:b.readUInt16BE(at+5)};at+=length;
  }
 }
}
export async function browseProject(projectRoot:string,request:ProjectBrowse):Promise<CommandOutcome>{
 if(!request||!['list','read'].includes(request.operation)||!valid(request.path)||typeof request.showIgnored!=='boolean'||request.cursor!==undefined&&(request.operation!=='list'||typeof request.cursor!=='string'||request.cursor.length>8192||!/^[A-Za-z0-9_-]+$/.test(request.cursor))||request.operation==='read'&&!request.path)return {ok:false,code:'git-invalid',message:'Invalid project file selection.'};
 const metadataHash=createHash('sha256');
 const trees:SafeTree[]=[];let scratch:string|undefined,metadataBudget=8*1024*1024;
 function metadata(entry:{fd:number;size:number}){metadataBudget-=entry.size;if(metadataBudget<0){closeSync(entry.fd);throw new TreeLimitError('Metadata budget');}const value=bytes(entry,TEXT_LIMIT*4);metadataHash.update(String(value.length)+':');metadataHash.update(value);return value;}
 try{
  const source=SafeTree.root(process.platform==='darwin'?projectRoot.replace(/^\/(tmp|var|etc)(\/|$)/,'/private/$1$2'):projectRoot);trees.push(source);
  const knownNames=new Map<SafeTree,Set<string>>();
  function has(tree:SafeTree,name:string){return knownNames.get(tree)?.has(name)??false;}
  function checkAdmin(tree:SafeTree){const names=tree.page('',0).present;knownNames.set(tree,names);if(['HEAD','objects','refs'].every(name=>names.has(name)))throw Error('Administrative repository directory');}
  let tree=source,relative='';checkAdmin(source);
  const ancestry:{tree:SafeTree;relative:string}[]=[{tree:source,relative:''}];
  const parts=request.path.split('/').filter(Boolean),parents=request.operation==='list'?parts:parts.slice(0,-1);
  if(parents.length>128)throw new TreeLimitError('Directory depth limit');
  for(const name of parents){tree=tree.directory(name);trees.push(tree);relative=relative?relative+'/'+name:name;checkAdmin(tree);ancestry.push({tree,relative});}
  if(request.operation==='read'){
   const entry=tree.entry(parts.at(-1)!);if(entry.kind!=='file'){if(entry.kind==='directory')entry.tree.close();throw Error('Only regular files can be opened');}
   const base={path:request.path,size:entry.size};
   if(entry.size>IMAGE_LIMIT){closeSync(entry.fd);return {ok:true,data:{...base,kind:'limited',message:'File exceeds the 8 MiB image / 1 MiB text limit.'} satisfies ProjectContent};}
   const buffer=bytes(entry,IMAGE_LIMIT),image=raster(buffer);
   let data:ProjectContent;
   if(image){data=image.width>0&&image.height>0&&image.width<=16384&&image.height<=16384&&image.width*image.height<=40000000?{...base,...image,kind:'image',base64:buffer.toString('base64')}:{...base,kind:'limited',message:'Image exceeds the 16,384-pixel edge or 40-megapixel limit.'};}
   else if(buffer.length>TEXT_LIMIT)data={...base,kind:'limited',message:'Text exceeds the 1 MiB preview limit; unsupported images cannot be previewed.'};
   else {try{if(buffer.includes(0))throw Error();const content=new TextDecoder('utf-8',{fatal:true}).decode(buffer);data={...base,kind:'text',content};}catch{data={...base,kind:'unsupported',message:'Unsupported or malformed image/binary. GIF preview allows 256 frames and 80 million cumulative canvas pixels; animated PNG/WebP is not previewed. Static PNG, JPEG, WebP and UTF-8 text are supported.'};}}
   return {ok:true,data};
  }
  let ignoreStatus:ProjectListing['ignoreStatus']=request.showIgnored?'shown':'known';
  if(!request.showIgnored)try{
  // A minimal disposable Git view interprets ignore rules only. No live paths,
  // repository config, attributes, filters, hooks or object stores reach Git.
  scratch=realpathSync(mkdtempSync(join(tmpdir(),'deck-project-view-')));
  mkdirSync(join(scratch,'.git','objects'),{recursive:true});mkdirSync(join(scratch,'.git','refs'));writeFileSync(join(scratch,'.git','HEAD'),'ref: refs/heads/main\n');writeFileSync(join(scratch,'.git','config'),'[core]\nrepositoryformatversion = 0\n');
  // Copy only index/ignore metadata to preserve tracked-file exceptions. Metadata
  // pointers are repository-owned authority, never caller-selected roots.
  if(has(source,'.git')){
   const entry=source.entry('.git');let meta:SafeTree|undefined,metaPath=join(projectRoot,'.git');
   if(entry.kind==='directory')meta=entry.tree;
   else if(entry.kind==='file'){const pointer=metadata(entry).toString().trim();if(!pointer.startsWith('gitdir: '))throw Error('Invalid metadata');metaPath=resolve(projectRoot,pointer.slice(8));meta=SafeTree.root(metaPath);}
   if(!meta)throw Error('Metadata unavailable');
   if(meta){trees.push(meta);const names=meta.names().sort();for(const name of names.filter(name=>name==='index'||/^sharedindex\.[0-9a-f]+$/.test(name))){const item=meta.entry(name);if(item.kind==='file')writeFileSync(join(scratch,'.git',name),metadata(item));else {if(item.kind==='directory')item.tree.close();throw Error('Invalid index');}}
    let common=meta;if(names.includes('commondir')){const item=meta.entry('commondir');if(item.kind!=='file'){if(item.kind==='directory')item.tree.close();throw Error('Invalid metadata');}const relativeCommon=metadata(item).toString().trim();
     common=SafeTree.root(resolve(metaPath,relativeCommon));trees.push(common);
    }
    if(common.names().includes('info')){const info=common.directory('info');trees.push(info);if(info.names().includes('exclude')){const item=info.entry('exclude');if(item.kind==='file'){mkdirSync(join(scratch,'.git','info'));writeFileSync(join(scratch,'.git','info','exclude'),metadata(item));}else if(item.kind==='directory')item.tree.close();}}
   }
  }
   for(const ancestor of ancestry){
    mkdirSync(join(scratch!,ancestor.relative),{recursive:true});
    if(has(ancestor.tree,'.gitignore')){const entry=ancestor.tree.entry('.gitignore');if(entry.kind==='file')writeFileSync(join(scratch!,ancestor.relative,'.gitignore'),metadata(entry));else{if(entry.kind==='directory')entry.tree.close();throw Error('Ignore file unavailable');}}
   }
  }catch{ignoreStatus='unknown';}
  let after='',expectedRevision:string|undefined;
  if(request.cursor){try{const cursor=JSON.parse(Buffer.from(request.cursor,'base64url').toString());
   if(cursor.path!==request.path||cursor.showIgnored!==request.showIgnored||typeof cursor.after!=='string'||!cursor.after||cursor.after.includes('/')||cursor.after.includes('\0')||typeof cursor.revision!=='string')throw Error();
   after=cursor.after;expectedRevision=cursor.revision;
  }catch{return {ok:false,code:'git-invalid',message:'Invalid directory continuation.'};}}
  const page=tree.page(after);page.revision+=':'+metadataHash.digest('hex');
  if(expectedRevision&&page.revision!==expectedRevision)return {ok:false,code:'git-unavailable',message:'Directory changed. Reload this folder to continue.'};
  const names=page.names.filter(name=>!admin(name));
  const entries:ProjectEntry[]=[];
  // Bounded inspection of this directory only; never descend into children.
  for(const name of names){const path=relative?relative+'/'+name:name;let kind:ProjectEntry['kind']='unavailable',size:number|undefined;
   try{const entry=tree.entry(name);if(entry.kind==='file'){kind='file';size=entry.size;closeSync(entry.fd);}else if(entry.kind==='directory'){kind='directory';entry.tree.close();}}catch{}
   entries.push({name,path,kind,...(size!==undefined?{size}:{})});
  }
  let visible=entries;
  if(ignoreStatus==='known'&&entries.length)try{const input=entries.map(e=>'./'+e.path+(e.kind==='directory'?'/':'')).join('\0')+'\0';const ignored=new Set((await git(scratch!,['check-ignore','-z','--stdin'],1024*1024,true,input)).split('\0').map(p=>p.replace(/^\.\//,'').replace(/\/$/,'')));visible=entries.filter(e=>!ignored.has(e.path));}catch{ignoreStatus='unknown';}
  return {ok:true,data:{path:request.path,entries:visible,truncated:page.more,ignoreStatus,...(ignoreStatus==='unknown'?{warning:'Ignore status unavailable. Files may include ignored entries; Git metadata could not be read.'}:{}),...(page.more?{nextCursor:Buffer.from(JSON.stringify({path:request.path,showIgnored:request.showIgnored,after:page.names.at(-1),revision:page.revision})).toString('base64url')}:{})} satisfies ProjectListing};
 }catch(error){return {ok:false,code:error instanceof TreeLimitError?'git-limit':'git-unavailable',message:error instanceof TreeLimitError?'Directory scan or metadata limit exceeded (20 seconds, 128 levels, 8 MiB metadata).':'Project file unavailable: it changed, is unreadable, or traverses a symlink.'};}
 finally{for(const tree of trees.reverse())tree.close();if(scratch)rmSync(scratch,{recursive:true,force:true});}
}
