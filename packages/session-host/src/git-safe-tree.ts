/** Descriptor-relative reads for Linux and macOS. Never resolve a child through
 * a previously checked pathname. All directories stay open until their children
 * have been read; O_NOFOLLOW applies at every step, including the root walk.
 */
import { dlopen, FFIType, ptr, CString, toArrayBuffer, type Pointer } from 'bun:ffi';
import { constants, closeSync, fstatSync, readSync, writeSync, openSync, mkdirSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';

// Linux x64/arm64 use dirent.d_name offset 19. Darwin's 64-bit inode
// layout uses offset 21; Intel exports the INODE64 alias, arm64 only that ABI.
// ABI reference: apple-oss-distributions/xnu bsd/sys/dirent.h and
// apple-oss-distributions/Libc include/dirent.h.
let native: ReturnType<typeof load> | undefined;
function load() {
 if(process.platform !== 'linux' && process.platform !== 'darwin') throw Error('Unsupported descriptor-relative filesystem');
 const library=dlopen(process.platform === 'darwin' ? '/usr/lib/libSystem.B.dylib' : 'libc.so.6', {
  openat: {args:[FFIType.i32,FFIType.ptr,FFIType.i32], returns:FFIType.i32},
  [process.platform==='darwin' && process.arch==='x64'?'fdopendir$INODE64':'fdopendir']: {args:[FFIType.i32],returns:FFIType.ptr},
  [process.platform==='darwin' && process.arch==='x64'?'rewinddir$INODE64':'rewinddir']: {args:[FFIType.ptr],returns:FFIType.void},
  [process.platform==='darwin' && process.arch==='x64'?'readdir$INODE64':'readdir']: {args:[FFIType.ptr],returns:FFIType.ptr},
  [process.platform==='darwin'?'__error':'__errno_location']: {args:[],returns:FFIType.ptr},
  closedir: {args:[FFIType.ptr],returns:FFIType.i32},
  dup: {args:[FFIType.i32],returns:FFIType.i32},
  readlinkat: {args:[FFIType.i32,FFIType.ptr,FFIType.ptr,FFIType.u64],returns:FFIType.i64},
 });
 return {library,symbols:{...library.symbols,
  fdopendir:library.symbols[process.platform==='darwin' && process.arch==='x64'?'fdopendir$INODE64':'fdopendir']! as (fd:number)=>Pointer|null,
  rewinddir:library.symbols[process.platform==='darwin' && process.arch==='x64'?'rewinddir$INODE64':'rewinddir']! as (dir:Pointer)=>void,
  readdir:library.symbols[process.platform==='darwin' && process.arch==='x64'?'readdir$INODE64':'readdir']!,
  errno:library.symbols[process.platform==='darwin'?'__error':'__errno_location']!,
 }};
}
const cstr = (value:string) => Buffer.from(value+'\0');
export class SafeTree {
 private constructor(readonly fd:number) {}
 private entryTypes=new Map<string,number>();
 static root(path:string): SafeTree {
  let tree=new SafeTree(openSync('/',constants.O_RDONLY|constants.O_DIRECTORY));
  try {
   for(const name of resolve(path).split('/').filter(Boolean)) {
    const next=tree.directory(name); tree.close(); tree=next;
   }
   return tree;
  } catch(error) {tree.close();throw error;}
 }
 private open(name:string, directory=false) {
  if(!name || name==='.' || name==='..' || name.includes('/') || name.includes('\0')) throw Error('Invalid child');
  native ??= load();
  const fd=native.symbols.openat(this.fd,ptr(cstr(name)),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK|(process.platform==='darwin'?0x1000000:0x80000)|(directory?constants.O_DIRECTORY:0));
  if(fd<0) throw Error('Repository changed or contains an unsupported filesystem entry');
  return fd;
 }
 directory(name:string) {return new SafeTree(this.open(name,true));}
 names(limit=100_000):string[] {
  native ??= load();
  const duplicate=native.symbols.dup(this.fd);
  if(duplicate<0) throw Error('Cannot duplicate directory');
  const dir=native.symbols.fdopendir(duplicate);
  if(!dir) {closeSync(duplicate);throw Error('Cannot enumerate directory');}
  native.symbols.rewinddir(dir);
  const names:string[]=[];this.entryTypes.clear();
  try {
   const errno=new Int32Array(toArrayBuffer(native.symbols.errno()! as Pointer,0,4));
   while(true) {
    errno[0]=0;const entry=native.symbols.readdir(dir);
    if(!entry){if(errno[0]!==0)throw Error('Cannot read directory');break;}
    const name=new CString(entry as Pointer,process.platform==='darwin'?21:19).toString();
    if(name!=='.' && name!=='..') {names.push(name);this.entryTypes.set(name,new Uint8Array(toArrayBuffer(entry as Pointer,process.platform==='darwin'?20:18,1))[0]!);}
    if(names.length>limit) throw new TreeLimitError('Repository directory limit exceeded');
   }
   return names;
  } finally {native.symbols.closedir(dir);}
 }
 /** A lexical continuation scans directory records with bounded memory. Cursor
  * names are comparison keys only; they are never opened or resolved. */
 page(after='', limit=1000) {
  native ??= load();
  const before=fstatSync(this.fd,{bigint:true});
  const revision=[before.dev,before.ino,before.mtimeNs,before.ctimeNs].join(':');
  const duplicate=native.symbols.dup(this.fd);
  if(duplicate<0)throw Error('Cannot duplicate directory');
  const dir=native.symbols.fdopendir(duplicate);
  if(!dir){closeSync(duplicate);throw Error('Cannot enumerate directory');}
  native.symbols.rewinddir(dir);
  const heap:string[]=[],present=new Set<string>();const deadline=Date.now()+20000;
  const swap=(a:number,b:number)=>{[heap[a],heap[b]]=[heap[b]!,heap[a]!];};
  try {
   const errno=new Int32Array(toArrayBuffer(native.symbols.errno()! as Pointer,0,4));
   while(true){
    if(Date.now()>deadline)throw new TreeLimitError('Directory scan deadline exceeded');
    errno[0]=0;const entry=native.symbols.readdir(dir);
    if(!entry){if(errno[0]!==0)throw Error('Cannot read directory');break;}
    const name=new CString(entry as Pointer,process.platform==='darwin'?21:19).toString();
    if(['HEAD','objects','refs','.git','.gitignore'].includes(name))present.add(name);
    if(name==='.'||name==='..'||name<=after)continue;
    if(heap.length<limit+1){heap.push(name);let i=heap.length-1;while(i>0){const parent=(i-1)>>1;if(heap[parent]!>=heap[i]!)break;swap(parent,i);i=parent;}}
    else if(name<heap[0]!){heap[0]=name;let i=0;while(i*2+1<heap.length){let child=i*2+1;if(child+1<heap.length&&heap[child+1]!>heap[child]!)child++;if(heap[i]!>=heap[child]!)break;swap(i,child);i=child;}}
   }
   const final=fstatSync(this.fd,{bigint:true});
   if(revision!==[final.dev,final.ino,final.mtimeNs,final.ctimeNs].join(':'))throw Error('Directory changed; reload it');
   heap.sort();return {names:heap.slice(0,limit),more:heap.length>limit,revision,present};
  }finally{native.symbols.closedir(dir);}
 }
 /** lstat-equivalent classification via a no-follow open; links are read only
  * as literal targets and are never opened or followed. */
 entry(name:string): {kind:'directory',tree:SafeTree}|{kind:'link',target:string}|{kind:'special'}|{kind:'file',fd:number,size:number,mode:number} {
  if(!name || name==='.' || name==='..' || name.includes('/') || name.includes('\0'))throw Error('Invalid child');
  // d_type is supplied by the same readdir record already used for d_name.
  // Known special entries need no open at all (including ignored FIFOs).
  const type=this.entryTypes.get(name);
  if(type!==undefined && ![0,4,8,10].includes(type))return {kind:'special'};
  native ??= load();
  const buffer=Buffer.alloc(4097);
  const length=Number(native.symbols.readlinkat(this.fd,ptr(cstr(name)),ptr(buffer),buffer.length));
  if(length>=0) {
   if(length>=buffer.length) throw Error('Symlink too long');
   return {kind:'link',target:buffer.subarray(0,length).toString()};
  }
  const fd=this.open(name);
  try {
   const stat=fstatSync(fd);
   if(stat.isDirectory()) return {kind:'directory',tree:new SafeTree(fd)};
   if(!stat.isFile()) {closeSync(fd);return {kind:'special'};}
   return {kind:'file',fd,size:stat.size,mode:stat.mode};
  } catch(error) {closeSync(fd);throw error;}
 }
 close() {closeSync(this.fd);}
}
export class TreeLimitError extends Error {}
export type CopyBudget={bytes:number,entries:number,deadline:number};
export function copyRegular(entry:{fd:number,size:number,mode:number}, target:string, budget:CopyBudget) {
 let out:number|undefined;
 try {
  budget.bytes-=entry.size;
  if(budget.bytes<0 || Date.now()>budget.deadline) throw new TreeLimitError('Repository copy limit exceeded');
  out=openSync(target,'wx',0o600);
  const buffer=Buffer.alloc(64*1024);let position=0;
  while(position<entry.size) {
   if(Date.now()>budget.deadline)throw new TreeLimitError('Repository copy limit exceeded');
   const count=readSync(entry.fd,buffer,0,Math.min(buffer.length,entry.size-position),position);
   if(!count) throw Error('Repository changed during read');
   let written=0;while(written<count) written+=writeSync(out,buffer,written,count-written);
   position+=count;
  }
  const after=fstatSync(entry.fd);
  if(after.size!==entry.size) throw Error('Repository changed during read');
  chmodSync(target,entry.mode&0o111?0o700:0o600);
 } finally {closeSync(entry.fd);if(out!==undefined)closeSync(out);}
}
