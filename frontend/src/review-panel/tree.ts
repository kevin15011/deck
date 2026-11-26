import type {Entry} from './api';

type Folder = {
 path:string; folders:Map<string,Folder>; files:Entry[]; changes:number;
};
export type TreeRow = {
 key:string; parent:string|null; label:string; title:string; depth:number;
 position:number; siblings:number; entry?:Entry; expanded?:boolean; changes:number;
};

const folder = (path:string):Folder => ({path, folders:new Map(), files:[], changes:0});
const basename = (path:string) => path.slice(path.lastIndexOf('/') + 1);
const naturalOrder = new Intl.Collator(undefined,{numeric:true,sensitivity:'base'}).compare;

export function buildTree(entries:readonly Entry[]) {
 const root = folder('');
 for (const entry of entries) {
  const parts = entry.path.split('/');
  if (entry.kind !== 'directory') parts.pop();
  let parent = root;
  for (const part of parts) {
   let child = parent.folders.get(part);
   if (!child) {
    child = folder(parent.path ? parent.path + '/' + part : part);
    parent.folders.set(part,child);
   }
   parent = child;
   if (entry.status) parent.changes++;
  }
  if (entry.kind !== 'directory') parent.files.push(entry);
 }
 const order = [root];
 for (const node of order) {
  node.folders = new Map([...node.folders].sort(([a],[b]) => naturalOrder(a,b)));
  node.files.sort((a,b) => naturalOrder(a.path,b.path));
  for (const child of node.folders.values()) order.push(child);
 }
 return root;
}

export function visibleRows(root:Folder, expansion:ReadonlySet<string>, query='', matches?:ReadonlySet<string>) {
 const rows:TreeRow[] = [];
 const needle = query.toLowerCase();
 const matching = new Set<string>();
 if (needle) {
  const visit = (node:Folder):boolean => {
   let found = node.path.toLowerCase().includes(needle);
   for (const child of node.folders.values()) if (visit(child)) found = true;
   if (node.files.some(file => matches ? matches.has(file.id) : file.path.toLowerCase().includes(needle))) found = true;
   if (found) matching.add(node.path);
   return found;
  };
  visit(root);
 }
 const flatten = (node:Folder,parent:string|null,depth:number) => {
  const folders = [...node.folders.values()].filter(child => !needle || matching.has(child.path));
  const files = needle ? node.files.filter(file => matches ? matches.has(file.id) : file.path.toLowerCase().includes(needle)) : node.files;
  const siblings = folders.length + files.length;
  let position = 0;
  for (const child of folders) {
   let end = child;
   while (!end.files.length && end.folders.size === 1) end = end.folders.values().next().value!;
   const key = 'folder:' + end.path;
   const hasChildren = end.files.length > 0 || end.folders.size > 0;
   const open = !!needle || expansion.has(key);
   rows.push({key,parent,depth,position:++position,siblings, title:end.path,
    label:end.path.slice(node.path ? node.path.length + 1 : 0),
    expanded:hasChildren ? open : undefined, changes:end.changes});
   if (open) flatten(end,key,depth+1);
  }
  for (const entry of files) rows.push({key:'file:' + entry.path,parent,depth,position:++position,siblings,
   title:entry.path,label:basename(entry.path),entry,changes:0});
 };
 flatten(root,null,1);
 return rows;
}
