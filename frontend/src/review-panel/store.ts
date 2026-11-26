import {useEffect, useSyncExternalStore} from 'react';
import {accessLost, problemCode, reviewApi, views, type Entry, type ReviewApi, type ReviewDocument, type Stat, type Tree, type View} from './api';

const cacheBytes = 16 * 1024 * 1024;
const cacheDocuments = 24;

export class ReviewCache {
 private entries = new Map<string,{document:ReviewDocument; bytes:number; pathKey:string}>();
 private paths = new Map<string,string>();
 private bytes = 0;

 read(scope:string, view:View, entry:Entry) {
  const key = this.paths.get(JSON.stringify([scope,view,entry.path]));
  if (key === undefined) return;
  const value = this.entries.get(key);
  if (!value) return;
  this.entries.delete(key);
  this.entries.set(key,value);
  return value.document;
 }

 write(scope:string, view:View, document:ReviewDocument) {
  const key = JSON.stringify([scope,view,document.id]);
  const size = (side:ReviewDocument['before']) => side?.kind === 'text' ? 2 * side.text.length : 0;
  const bytes = size(document.before) + size(document.after);
  const pathKey = JSON.stringify([scope,view,document.entry.path]);
  const previous = this.paths.get(pathKey);
  if (previous) this.remove(previous);
  if (bytes > cacheBytes) return;
  this.entries.set(key,{document,bytes,pathKey});
  this.paths.set(pathKey,key);
  this.bytes += bytes;
  while (this.bytes > cacheBytes || this.entries.size > cacheDocuments) this.remove(this.entries.keys().next().value!);
 }

 drop(scope:string) {
  const prefix = JSON.stringify([scope]).slice(0,-1) + ',';
  for (const key of this.entries.keys()) if (key.startsWith(prefix)) this.remove(key);
 }

 private remove(key:string) {
  const value = this.entries.get(key);
  if (value) {
   this.bytes -= value.bytes;
   this.paths.delete(value.pathKey);
  }
  this.entries.delete(key);
 }
}

const documents = new ReviewCache();
export const clearReviewCache = (scope:string) => documents.drop(scope);
const emptyStats:ReadonlyMap<string,Stat> = new Map();
type Failure = {message:string; code?:string};
type Snapshot = {
 view:View; counts:Partial<Record<View,number>>; tree?:Tree; selection?:Entry; document?:ReviewDocument;
 loading:boolean; reading:boolean; error?:Failure; fileError?:Failure; stats:ReadonlyMap<string,Stat>;
};
const failure = (error:unknown):Failure => ({
 message:error instanceof Error ? error.message : String(error), code:problemCode(error),
});
const stale = (error:unknown) => problemCode(error) === 'review_stale' || problemCode(error) === 'review_entry';
const unavailable = (error:unknown) => {
 const code = problemCode(error);
 return code?.startsWith('no_') || code === 'ambiguous_merge_base' || code === 'unsupported_repository';
};

export class ReviewStore {
 private state:Snapshot = {view:'changes',counts:{},loading:false,reading:false,stats:emptyStats};
 private listeners = new Set<() => void>();
 private catalogs = new Map<View,Tree>();
 private paths = new Map<View,string>();
 private lifetime = new AbortController();
 private cycle?:Promise<void>;
 private trailing = false;
 private scheduled?:ReturnType<typeof setTimeout>;
 private connected = false;
 private open = false;
 private denied = false;
 private staleRetry = false;
 private fileRead?:AbortController;
 private speculative?:AbortController;
 private statsRead?:AbortController;
 private searchRead?:AbortController;
 private hover?:ReturnType<typeof setTimeout>;

 constructor(private scope:string, private api:ReviewApi, private cache:ReviewCache = documents) {}

 snapshot = () => this.state;
 subscribe = (listener:() => void) => {
  this.listeners.add(listener);
  return () => {this.listeners.delete(listener);};
 };
 private update(patch:Partial<Snapshot>) {
  if (this.lifetime.signal.aborted) return;
  this.state = {...this.state,...patch};
  for (const listener of this.listeners) listener();
 }

 setConnected(connected:boolean) {
  if (this.connected === connected) return;
  this.connected = connected;
  if (connected) this.invalidate();
  else this.cancelReads();
 }

 setOpen(open:boolean) {
  if (this.open === open) return;
  this.open = open;
  if (open) this.invalidate();
  else this.cancelReads();
 }

 restoreSelection(view:View, path:string) {
  if (!path || this.paths.has(view)) return;
  this.paths.set(view,path);
  const entry = this.state.view === view && this.state.tree?.entries.find(entry=>entry.path === path && entry.kind !== 'directory');
  if (entry) this.select(entry);
 }

 setView(view:View) {
  if (view === this.state.view) return;
  this.cancelReads();
  const tree = this.catalogs.get(view);
  const selection = tree?.entries.find(entry => entry.kind !== 'directory' && entry.path === this.paths.get(view));
  const document = selection && this.cache.read(this.scope,view,selection);
  this.update({view,tree,selection,document,stats:emptyStats,error:undefined,fileError:undefined,reading:false});
  // A cached document can paint while the new catalog is observed.
  this.invalidate();
 }

 select(entry:Entry) {
  if (entry.kind === 'directory' || !this.state.tree || this.denied) return;
  this.paths.set(this.state.view,entry.path);
  this.update({
   selection:entry,
   document:this.cache.read(this.scope,this.state.view,entry) ?? this.state.document,
   fileError:undefined,
  });
  void this.readSelection();
 }

 invalidate() {
  this.staleRetry = false;
  this.schedule();
 }

 private schedule() {
  if (!this.connected || this.lifetime.signal.aborted) return;
  if (this.cycle) {
   this.trailing = true;
   return;
  }
  if (this.scheduled === undefined) {
   this.scheduled = setTimeout(() => {this.scheduled = undefined; void this.runRefresh();},100);
  }
 }

 refresh() {
  this.staleRetry = false;
  clearTimeout(this.scheduled);
  this.scheduled = undefined;
  if (this.cycle) {
   this.trailing = true;
   return this.cycle;
  }
  return this.runRefresh();
 }

 private runRefresh():Promise<void> {
  if (!this.connected || this.lifetime.signal.aborted) return Promise.resolve();
  this.cancelPrefetch();
  const cycle = this.refreshCatalogs().finally(() => {
   this.cycle = undefined;
   if (this.trailing) {
    this.trailing = false;
    this.schedule();
   }
  });
  this.cycle = cycle;
  return cycle;
 }

 private async page(view:View, signal:AbortSignal, generation?:string, q?:string):Promise<Tree> {
  const first = await this.api.tree(view,{generation,q,fresh:generation === undefined},signal);
  if (!first.nextCursor && first.entries.length === first.matched) return first;
  const entries = [...first.entries];
  const ids = new Set(entries.map(entry => entry.id));
  const cursors = new Set<string>();
  let cursor = first.nextCursor;
  while (cursor) {
   signal.throwIfAborted();
   if (cursors.has(cursor)) throw Error('Repeated Review cursor. Refresh to retry.');
   cursors.add(cursor);
   const page = await this.api.tree(view,{generation:first.generation,cursor,q},signal);
   if (page.matched !== first.matched || page.total !== first.total) throw Error('Review catalog changed during pagination.');
   for (const entry of page.entries) {
    if (ids.has(entry.id)) throw Error('Duplicate Review entry during pagination.');
    ids.add(entry.id);
    entries.push(entry);
   }
   if (entries.length > first.matched) throw Error('Invalid Review catalog size.');
   cursor = page.nextCursor;
  }
  if (entries.length !== first.matched) throw Error('Incomplete Review catalog. Refresh to retry.');
  return {...first, entries,nextCursor:null};
 }

 private setCount(view:View, total?:number) {
  if (this.state.counts[view] !== total) this.update({counts:{...this.state.counts,[view]:total}});
 }

 private async refreshCatalogs() {
  const {view} = this.state;
  const open = this.open;
  const signal = this.lifetime.signal;
  const active = () => this.connected && !signal.aborted && this.open && open && this.state.view === view;
  if (open) this.update({loading:true});
  let count:Tree|undefined;
  try {
   count = await this.api.tree('changes',{limit:0,fresh:true},signal);
   if (signal.aborted || !this.connected) return;
   this.denied = false;
   this.setCount('changes',count.total);
  } catch (error) {
   if (signal.aborted) return;
   if (this.reportAccess(error)) return;
   if (unavailable(error)) {
    this.setCount('changes');
    this.catalogs.delete('changes');
    if (active() && view === 'changes') this.clearCatalog();
   }
   if (active() && view === 'changes') {
    this.update({error:failure(error),loading:false});
    this.retryStale(error);
   }
  }
  if (!active()) return;

  try {
   if (view === 'changes' && !count) return;
   const tree = await this.page(view,signal,view === 'changes' ? count?.generation : undefined);
   if (!active()) return;
   this.denied = false;
   this.catalogs.set(view,tree);
   const selection = tree.entries.find(entry => entry.kind !== 'directory' && entry.path === this.paths.get(view));
   const previous = this.state.document;
   const document = selection && (this.cache.read(this.scope,view,selection) ??
    (previous && tree.entries.some(entry=>entry.kind !== 'directory' && entry.path === previous.entry.path) ? previous : undefined));
   this.statsRead?.abort();
   this.searchRead?.abort();
   this.update({tree,selection,document,error:undefined,fileError:undefined,loading:false,stats:emptyStats});
   this.setCount(view,tree.total);
   await this.readSelection();
  } catch (error) {
   if (signal.aborted || this.reportAccess(error)) return;
   if (active()) {
    if (unavailable(error)) {
     this.catalogs.delete(view);
     this.clearCatalog();
     this.setCount(view);
    }
    this.update({error:failure(error)});
    this.retryStale(error);
   }
  } finally {
   if (active()) this.update({loading:false});
  }

  // Summary catalogs use separate views and run after the selected file.
  for (const other of views) {
   if (!active()) return;
   if (other === view || other === 'changes') continue;
   try {
    const summary = await this.api.tree(other,{limit:0,fresh:true},signal);
    if (active()) this.setCount(other,summary.total);
   } catch (error) {
    if (signal.aborted || this.reportAccess(error)) return;
    if (active() && unavailable(error)) this.setCount(other);
   }
  }
 }

 private clearCatalog() {
  this.cancelReads();
  this.update({tree:undefined,selection:undefined,document:undefined,fileError:undefined,reading:false,stats:emptyStats});
 }

 private reportAccess(error:unknown) {
  if (!accessLost(error) || this.lifetime.signal.aborted) return false;
  this.denied = true;
  this.cache.drop(this.scope);
  this.catalogs.clear();
  this.cancelReads();
  this.update({counts:{},tree:undefined,selection:undefined,document:undefined,stats:emptyStats,
   loading:false,reading:false,error:failure(error),fileError:undefined});
  return true;
 }

 private retryStale(error:unknown) {
  if (!stale(error) || this.staleRetry) return;
  this.staleRetry = true;
  this.schedule();
 }

 private async readSelection() {
  this.fileRead?.abort();
  this.cancelPrefetch();
  const {tree,selection,view,document} = this.state;
  if (!tree || !selection || !this.connected || !this.open || this.denied) {
   this.update({reading:false});
   return;
  }
  const cached = this.cache.read(this.scope,view,selection);
  const previous = cached ?? (document?.entry.path === selection.path ? document : undefined);
  const controller = this.fileRead = new AbortController();
  this.update({reading:true});
  try {
   const result = await this.api.file(view,tree.generation,selection.id,previous?.version,controller.signal);
   if (controller.signal.aborted) return;
   if (result.kind === 'document' && result.entry.path !== selection.path) {
    throw Error('Review file identity changed. Refresh to retry.');
   }
   const next = result.kind === 'document' ? result : previous && {
    ...previous, id:result.id, generation:result.generation, entry:selection,
   };
   if (next) this.cache.write(this.scope,view,next);
   this.update({document:next,fileError:undefined});
  } catch (error) {
   if (controller.signal.aborted || this.reportAccess(error)) return;
   this.update({fileError:failure(error)});
   this.retryStale(error);
  } finally {
   if (this.fileRead === controller) {
    this.fileRead = undefined;
    this.update({reading:false});
   }
  }
 }

 prefetch(entry?:Entry) {
  clearTimeout(this.hover);
  if (!entry || this.speculative) return;
  this.hover = setTimeout(() => {
   const {tree,view,selection} = this.state;
   if (!tree || !this.connected || !this.open || this.denied || this.fileRead || this.state.loading ||
    tree !== this.catalogs.get(view) || entry.kind === 'directory' || selection?.id === entry.id ||
    this.cache.read(this.scope,view,entry)) return;
   const controller = this.speculative = new AbortController();
   void this.api.file(view,tree.generation,entry.id,undefined,controller.signal).then(result => {
    if (!controller.signal.aborted && result.kind === 'document' && result.entry.path === entry.path) {
     this.cache.write(this.scope,view,result);
    }
   }).catch(error => {
    if (!controller.signal.aborted) this.reportAccess(error);
   }).finally(() => {
    if (this.speculative === controller) this.speculative = undefined;
   });
  },180);
 }

 async search(query:string, tree:Tree) {
  this.searchRead?.abort();
  if (!query || !this.connected || !this.open || this.denied) return;
  const controller = this.searchRead = new AbortController();
  try {
   const result = await this.page(tree.view,controller.signal,tree.generation,query);
   if (!controller.signal.aborted) return new Set(result.entries.map(entry => entry.id));
  } catch (error) {
   if (!controller.signal.aborted && !this.reportAccess(error)) this.retryStale(error);
  }
 }

 async loadStats(ids:string[], tree:Tree) {
  if (!this.connected || !this.open || this.denied || this.fileRead || this.statsRead || tree !== this.state.tree) return;
  const needed = ids.filter(id => !this.state.stats.has(id)).slice(0,32);
  if (!needed.length) return;
  const controller = this.statsRead = new AbortController();
  try {
   const result = await this.api.stats(tree.view,tree.generation,needed,controller.signal);
   if (!controller.signal.aborted && tree === this.state.tree) {
    const stats = new Map(this.state.stats);
    for (const item of result.items) stats.set(item.id,item.stat);
    this.statsRead = undefined;
    this.update({stats});
   }
  } catch (error) {
   if (!controller.signal.aborted && !this.reportAccess(error)) this.retryStale(error);
  } finally {
   if (this.statsRead === controller) this.statsRead = undefined;
  }
 }

 private cancelPrefetch() {
  clearTimeout(this.hover);
  this.speculative?.abort();
 }
 private cancelReads() {
  this.fileRead?.abort();
  this.fileRead = undefined;
  this.statsRead?.abort();
  this.statsRead = undefined;
  this.searchRead?.abort();
  this.cancelPrefetch();
 }

 dispose() {
  this.lifetime.abort();
  clearTimeout(this.scheduled);
  this.cancelReads();
 }
}

export function useReviewStore(scope:string, store:ReviewStore, connected:boolean, open:boolean, activity:string) {
 const count = useSyncExternalStore(store.subscribe,() => store.snapshot().counts.changes);
 useEffect(() => () => store.dispose(),[store]);
 useEffect(() => {store.setConnected(connected && !!scope);},[scope,store,connected]);
 useEffect(() => {store.setOpen(open);},[store,open]);
 useEffect(() => {store.invalidate();},[store,activity]);
 useEffect(() => {
  const foreground = () => {if (!document.hidden) store.invalidate();};
  window.addEventListener('focus',foreground);
  document.addEventListener('visibilitychange',foreground);
  return () => {
   window.removeEventListener('focus',foreground);
   document.removeEventListener('visibilitychange',foreground);
  };
 },[store]);
 return count;
}

export const createReviewStore = (scope:string, session:string) => new ReviewStore(scope,reviewApi(session));
