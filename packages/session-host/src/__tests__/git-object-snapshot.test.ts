import { test, expect } from 'bun:test';
import { closeSync, mkdtempSync, openSync, readSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SafeTree, snapshotObject, TreeLimitError } from '../git-safe-tree';

test('object snapshot uses pinned identity and independent offsets on every reopen', () => {
 const root=mkdtempSync(join(tmpdir(),'deck-object-'));
 const tree=SafeTree.root(root);
 try {
  writeFileSync(join(root,'pack'),'PACK-pinned-content');
  writeFileSync(join(root,'outside'),'OUTSIDE');
  const entry=tree.entry('pack');if(entry.kind!=='file')throw Error('fixture');
  // Model Darwin's consumed shared open-file description before capture.
  readSync(entry.fd,Buffer.alloc(12),0,12,null);
  renameSync(join(root,'pack'),join(root,'saved'));
  symlinkSync(join(root,'outside'),join(root,'pack'));
  // Native CI's temporary volume must exercise COW, not hide a clone failure
  // behind byte copying. Linux exercises the bounded positional-copy fallback.
  const budget={bytes:process.platform==='darwin'?0:1024,entries:10,deadline:Date.now()+1000};
  snapshotObject(entry,join(root,'snapshot'),budget);
  for(let i=0;i<3;i++) {
   const fd=openSync(join(root,'snapshot'),'r');
   try {const header=Buffer.alloc(4);readSync(fd,header,0,4,null);expect(header.toString()).toBe('PACK');}
   finally{closeSync(fd);}
  }
  expect(readFileSync(join(root,'snapshot'),'utf8')).toBe('PACK-pinned-content');
 }finally{tree.close();rmSync(root,{recursive:true,force:true});}
});

test('object snapshot never falls back to an unbounded copy', () => {
 const root=mkdtempSync(join(tmpdir(),'deck-object-budget-')),tree=SafeTree.root(root);
 try {
  writeFileSync(join(root,'pack'),'PACK');
  const entry=tree.entry('pack');if(entry.kind!=='file')throw Error('fixture');
  // An existing target deterministically prevents native cloning. A failed
  // clone must still enforce the byte budget before attempting a copy.
  writeFileSync(join(root,'snapshot'),'existing');
  expect(()=>snapshotObject(entry,join(root,'snapshot'),{bytes:0,entries:1,deadline:Date.now()+1000})).toThrow(TreeLimitError);
  expect(readFileSync(join(root,'snapshot'),'utf8')).toBe('existing');
  const expired=tree.entry('pack');if(expired.kind!=='file')throw Error('fixture');
  expect(()=>snapshotObject(expired,join(root,'expired'),{bytes:1024,entries:1,deadline:0})).toThrow(TreeLimitError);
 }finally{tree.close();rmSync(root,{recursive:true,force:true});}
});
