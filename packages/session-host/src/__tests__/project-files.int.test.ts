import {afterEach,expect,test} from 'bun:test';
import {mkdtempSync,writeFileSync,mkdirSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {browseProject} from '../git-diff';
const roots:string[]=[];
afterEach(()=>roots.splice(0).forEach(root=>rmSync(root,{recursive:true,force:true})));
function fixture(){const root=mkdtempSync(join(tmpdir(),'deck-files-'));roots.push(root);return root;}
async function data(root:string,operation:'list'|'read',path='',showIgnored=false){const result=await browseProject(root,{operation,path,showIgnored});expect(result.ok).toBe(true);return (result as any).data;}
test('lazy files work without Git, hide admin and ignored entries, and read complete text',async()=>{
 const root=fixture();mkdirSync(join(root,'docs'));mkdirSync(join(root,'node_modules'));mkdirSync(join(root,'.git'));writeFileSync(join(root,'.gitignore'),'node_modules/\n*.log\n');
 writeFileSync(join(root,'docs','guide.md'),'# Complete\n'+ 'text\n'.repeat(60000));writeFileSync(join(root,'debug.log'),'ignored');
 const listing=await data(root,'list');expect(listing.entries.map((e:any)=>e.name)).toEqual(['.gitignore','docs']);
 expect((await data(root,'list','',true)).entries.map((e:any)=>e.name)).toEqual(['.gitignore','debug.log','docs','node_modules']);
 expect((await data(root,'read','docs/guide.md')).content).toContain('text\n'.repeat(60000));
 expect((await data(root,'list','docs')).entries[0].path).toBe('docs/guide.md');
});
test('rejects traversal, administrative paths, links and special content without external reads',async()=>{
 const root=fixture(),outside=fixture();writeFileSync(join(outside,'secret'),'OUTSIDE');symlinkSync(outside,join(root,'link'));symlinkSync(join(outside,'secret'),join(root,'file'));
 for(const path of ['../secret','/etc/passwd','.git/config','link/secret','file'])expect((await browseProject(root,{operation:'read',path,showIgnored:false})).ok).toBe(false);
 expect((await data(root,'list')).entries.every((e:any)=>e.kind==='unavailable')).toBe(true);
});
test('image signatures and dimensions use separate limits, unsupported and oversized content is explicit',async()=>{
 const root=fixture();const png=Buffer.alloc(300000);Buffer.from('89504e470d0a1a0a0000000d49484452','hex').copy(png);png.writeUInt32BE(640,16);png.writeUInt32BE(480,20);writeFileSync(join(root,'photo.bin'),png);
 expect(await data(root,'read','photo.bin')).toMatchObject({kind:'image',mime:'image/png',width:640,height:480});
 png.writeUInt32BE(100000,16);writeFileSync(join(root,'huge.png'),png);expect((await data(root,'read','huge.png')).kind).toBe('limited');
 writeFileSync(join(root,'active.svg'),'<svg onload="alert(1)"/>');expect((await data(root,'read','active.svg')).kind).toBe('text');
 writeFileSync(join(root,'large.txt'),'x'.repeat(1024*1024+1));expect((await data(root,'read','large.txt')).kind).toBe('limited');
});
test('root and ancestor swaps cannot escape during listing or image/text reads',async()=>{
 const {spyOn}=await import('bun:test');const {SafeTree}=await import('../git-safe-tree');const reader=await import('../project-files-reader');const {renameSync}=await import('node:fs');
 for(const operation of ['list','read'] as const)for(const boundary of ['root','ancestor']){
  const root=fixture(),outside=fixture();mkdirSync(join(root,'folder'));writeFileSync(join(root,'folder','inside'),'INSIDE');writeFileSync(join(outside,'outside'),'OUTSIDE_MARKER');writeFileSync(join(outside,'inside'),'OUTSIDE_MARKER');
  const original=SafeTree.prototype.directory;let swapped=false;
  const hook=spyOn(SafeTree.prototype,'directory').mockImplementation(function(this:import('../git-safe-tree').SafeTree,name:string){const next=original.call(this,name);if(!swapped&&name===(boundary==='root'?root.split('/').at(-1):'folder')){swapped=true;const target=boundary==='root'?root:join(root,'folder');renameSync(target,target+'-saved');roots.push(target+'-saved');symlinkSync(outside,target);}return next;});
  try{const result=await reader.browseProject(root,{operation,path:operation==='list'?'folder':'folder/inside',showIgnored:false});expect(swapped).toBe(true);expect(result.ok).toBe(true);expect(JSON.stringify(result)).not.toContain('OUTSIDE');}finally{hook.mockRestore();}
 }
});
test('tracked ignored files remain listed and per-directory limits are explicit',async()=>{
 const {execFileSync}=await import('node:child_process');const root=fixture();execFileSync('git',['init','-q',root]);writeFileSync(join(root,'tracked.log'),'tracked');execFileSync('git',['-C',root,'add','.']);writeFileSync(join(root,'.gitignore'),'*.log\n');writeFileSync(join(root,'hidden.log'),'ignored');
 expect((await data(root,'list')).entries.map((e:any)=>e.name)).toContain('tracked.log');expect((await data(root,'list')).entries.map((e:any)=>e.name)).not.toContain('hidden.log');
 mkdirSync(join(root,'many'));for(let i=0;i<1001;i++)writeFileSync(join(root,'many',String(i)), '');const listing=await data(root,'list','many');expect(listing.entries).toHaveLength(1000);expect(listing.truncated).toBe(true);
});
test('JPEG, GIF and both WebP layouts are detected from bytes rather than extension',async()=>{
 const {raster}=await import('../project-files-reader');
 const gif=Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b','hex');gif.writeUInt16LE(20,6);gif.writeUInt16LE(10,8);expect(raster(gif)).toEqual({mime:'image/gif',width:20,height:10});
 const jpg=Buffer.from([255,216,255,192,0,11,8,0,10,0,20,1,1,17,0,255,217]);expect(raster(jpg)).toEqual({mime:'image/jpeg',width:20,height:10});
 const webp=Buffer.alloc(26);webp.write('RIFF');webp.writeUInt32LE(18,4);webp.write('WEBP',8);webp.write('VP8L',12);webp.writeUInt32LE(5,16);webp[20]=0x2f;webp.writeUInt32LE(19+(9<<14),21);expect(raster(webp)).toEqual({mime:'image/webp',width:20,height:10});
 const extended=Buffer.concat([webp.subarray(0,12),Buffer.alloc(18),webp.subarray(12)]);extended.writeUInt32LE(extended.length-8,4);extended.write('VP8X',12);extended.writeUInt32LE(10,16);extended.writeUIntLE(19,24,3);extended.writeUIntLE(9,27,3);expect(raster(extended)).toEqual({mime:'image/webp',width:20,height:10});
 extended.writeUIntLE(0,24,3);expect(raster(extended)).toBeUndefined();
 expect(raster(Buffer.from('<svg/>'))).toBeUndefined();expect(raster(jpg.subarray(0,8))).toBeUndefined();
 const root=fixture();writeFileSync(join(root,'not-jpeg.txt'),jpg);expect((await data(root,'read','not-jpeg.txt')).mime).toBe('image/jpeg');
});
test('image transport supports more than the diff response budget and rejects byte overflow',async()=>{
 const root=fixture();const png=Buffer.alloc(4*1024*1024);Buffer.from('89504e470d0a1a0a0000000d49484452','hex').copy(png);png.writeUInt32BE(100,16);png.writeUInt32BE(100,20);writeFileSync(join(root,'image'),png);
 const image=await data(root,'read','image');expect(image.kind).toBe('image');expect(Buffer.from(image.base64,'base64')).toEqual(png);
 writeFileSync(join(root,'oversize'),Buffer.alloc(8*1024*1024+1));expect((await data(root,'read','oversize')).kind).toBe('limited');
});

test('bare administrative directories cannot be browsed or read',async()=>{
 const root=fixture();mkdirSync(join(root,'archive.git'));mkdirSync(join(root,'archive.git','objects'));mkdirSync(join(root,'archive.git','refs'));writeFileSync(join(root,'archive.git','HEAD'),'ref: refs/heads/main');
 for(const [operation,path] of [['list','archive.git'],['read','archive.git/HEAD']] as const)expect((await browseProject(root,{operation,path,showIgnored:true})).ok).toBe(false);
});

test('GIF frame geometry and truncation are bounded before transport',async()=>{
 const root=fixture();
 const gif=Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b','hex');
 for(const [name,mutate] of [
  ['wide',(b:Buffer)=>b.writeUInt16LE(16385,24)],
  ['offset',(b:Buffer)=>b.writeUInt16LE(16384,20)],
  ['truncated',(b:Buffer)=>b[30]=255],
 ] as const){const b=Buffer.from(gif);mutate(b);writeFileSync(join(root,name),b);expect((await data(root,'read',name)).kind).not.toBe('image');}
 writeFileSync(join(root,'valid'),gif);expect((await data(root,'read','valid')).kind).toBe('image');
});
test('all directory pages remain reachable past ten thousand and reject stale continuation',async()=>{
 const root=fixture();for(let i=0;i<10005;i++)writeFileSync(join(root,String(i).padStart(5,'0')),'');
 let cursor:string|undefined;const names:string[]=[];let firstCursor:string|undefined;
 do{const result=await browseProject(root,{operation:'list',path:'',showIgnored:true,cursor} as any);expect(result.ok).toBe(true);const listing=(result as any).data;names.push(...listing.entries.map((e:any)=>e.name));cursor=listing.nextCursor;firstCursor??=cursor;}while(cursor);
 expect(names).toHaveLength(10005);expect(new Set(names).size).toBe(10005);expect(names).toEqual([...names].sort());
 writeFileSync(join(root,'new'),'');expect((await browseProject(root,{operation:'list',path:'',showIgnored:true,cursor:firstCursor} as any)).ok).toBe(false);
});
test('broken Git metadata never blocks content and listing declares unknown ignore status',async()=>{
 const {execFileSync}=await import('node:child_process');
 for(const broken of ['pointer','index']){const root=fixture();writeFileSync(join(root,'plain'),'readable');
 if(broken==='pointer')writeFileSync(join(root,'.git'),'malformed');else{execFileSync('git',['init','-q',root]);writeFileSync(join(root,'.git','index'),'corrupt');}
 for(const showIgnored of [false,true]){expect((await data(root,'read','plain',showIgnored)).content).toBe('readable');const listing=await data(root,'list','',showIgnored);expect(listing.entries.map((e:any)=>e.name)).toContain('plain');if(!showIgnored)expect(listing.ignoreStatus).toBe('unknown');}
 }
});

test('animation frame budgets and analogous APNG/WebP animations cannot reach the decoder',async()=>{
 const {raster}=await import('../project-files-reader');
 const gif=Buffer.from('47494638396101000100800000000000ffffff2c00000000010001000002024401003b','hex');
 const animation=(frames:number)=>Buffer.concat([gif.subarray(0,19),...Array.from({length:frames},()=>gif.subarray(19,34)),gif.subarray(34)]);
 expect(raster(animation(2))?.mime).toBe('image/gif');expect(raster(animation(257))).toBeUndefined();
 const large=animation(3);large.writeUInt16LE(6000,6);large.writeUInt16LE(6000,8);expect(raster(large)).toBeUndefined();
 for(let length=0;length<gif.length;length++)expect(raster(gif.subarray(0,length))).toBeUndefined();
 const png=Buffer.alloc(53);Buffer.from('89504e470d0a1a0a0000000d49484452','hex').copy(png);png.writeUInt32BE(1,16);png.writeUInt32BE(1,20);png.writeUInt32BE(8,33);png.write('acTL',37);expect(raster(png)).toBeUndefined();
 const webp=Buffer.alloc(30);webp.write('RIFF');webp.writeUInt32LE(22,4);webp.write('WEBP',8);webp.write('VP8X',12);webp.writeUInt32LE(10,16);webp[20]=2;expect(raster(webp)).toBeUndefined();
});
test('continuations validate shape and never act as caller-selected paths',async()=>{
 const root=fixture();writeFileSync(join(root,'safe'),'safe');
 for(const cursor of ['',42,'../outside','a'.repeat(8193),Buffer.from(JSON.stringify({path:'',showIgnored:false,after:'../outside',revision:'x'})).toString('base64url')])expect(await browseProject(root,{operation:'list',path:'',showIgnored:false,cursor} as any)).toMatchObject({ok:false,code:'git-invalid'});
 expect(await browseProject(root,{operation:'read',path:'safe',showIgnored:false,cursor:'abc'})).toMatchObject({ok:false,code:'git-invalid'});
});

test('ignored-only pages still have a continuation and ignore-rule edits invalidate it',async()=>{
 const root=fixture();writeFileSync(join(root,'.gitignore'),'*.hide\n');for(let i=0;i<1001;i++)writeFileSync(join(root,String(i).padStart(4,'0')+'.hide'),'');writeFileSync(join(root,'visible'),'yes');
 const first=await data(root,'list');expect(first.nextCursor).toBeDefined();
 const next=await browseProject(root,{operation:'list',path:'',showIgnored:false,cursor:first.nextCursor});expect(next).toMatchObject({ok:true,data:{entries:[{name:'visible'}]}});
 writeFileSync(join(root,'.gitignore'),'');expect((await browseProject(root,{operation:'list',path:'',showIgnored:false,cursor:first.nextCursor})).ok).toBe(false);
});
