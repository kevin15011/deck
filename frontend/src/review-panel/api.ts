import {HttpError, request} from '../api';

export const views = ['all', 'changes', 'diff'] as const;
export type View = typeof views[number];
export type Entry = {
 id:string; path:string; oldPath:string|null;
 kind:'file'|'directory'|'symlink'|'gitlink'|'special';
 status:'M'|'A'|'D'|'U'|'R'|null;
 detail:'untracked'|'conflict'|'mode'|'type'|null;
};
export type Tree = {
 view:View; generation:string; head:string|null; total:number; matched:number;
 base:{kind:'head'|'empty'|'mergeBase'; oid:string|null}|null;
 origin:{ref:string; oid:string; source:'symbolic'|'fallback'}|null;
 nextCursor:string|null; entries:Entry[];
};
const opaqueSides = ['binary','encoding','tooLarge','symlink','gitlink','special','unavailable'] as const;
export type Side =
 | {kind:'absent'}
 | {kind:'text'; text:string; bytes:number; mode:string}
 | {kind:typeof opaqueSides[number]; bytes:number|null; mode:string|null};
export type ReviewDocument = {
 kind:'document'; id:string; generation:string; version:string; entry:Entry; before:Side|null; after:Side;
};
type FileReply = ReviewDocument | {kind:'unchanged'; id:string; generation:string; version:string};
export type Stat = {kind:'lines'; added:number; deleted:number} |
 {kind:'unavailable'; reason:'binary'|'encoding'|'tooLarge'|'special'|'conflict'|'budget'};
type Stats = {generation:string; items:{id:string; stat:Stat}[]};
type TreeQuery = {limit?:number; generation?:string; cursor?:string; q?:string; fresh?:boolean};
export interface ReviewApi {
 tree(view:View, options:TreeQuery, signal?:AbortSignal):Promise<Tree>;
 file(view:View, generation:string, id:string, known?:string, signal?:AbortSignal):Promise<FileReply>;
 stats(view:View, generation:string, ids:string[], signal?:AbortSignal):Promise<Stats>;
}

const record = (v:unknown): v is Record<string,unknown> =>
 typeof v === 'object' && v !== null && !Array.isArray(v);
const string = (v:unknown): v is string => typeof v === 'string';
const identity = (v:unknown): v is string => string(v) && v.length > 0;
const nullableString = (v:unknown) => v === null || string(v);
const count = (v:unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const oneOf = (v:unknown, values:readonly unknown[]) => values.includes(v);
const validPath = (v:unknown) => identity(v) && v.split('/').every(part => part && part !== '.' && part !== '..');
function isEntry(v:unknown): v is Entry {
 return record(v) && identity(v.id) && validPath(v.path) && (v.oldPath === null || validPath(v.oldPath)) &&
  oneOf(v.kind,['file','directory','symlink','gitlink','special']) &&
  oneOf(v.status,[null,'M','A','D','U','R']) && oneOf(v.detail,[null,'untracked','conflict','mode','type']) &&
  (v.status !== 'R' || v.oldPath !== null) &&
  (v.status !== 'U' || v.detail === 'untracked' || v.detail === 'conflict');
}
function isSide(v:unknown): v is Side {
 if (!record(v)) return false;
 if (v.kind === 'absent') return true;
 if (v.kind === 'text') return string(v.text) && v.text.length <= 1048576 && count(v.bytes) &&
  v.bytes <= 1048576 && identity(v.mode);
 return oneOf(v.kind,opaqueSides) && (v.bytes === null || count(v.bytes)) && nullableString(v.mode);
}
function invalid(): never { throw Error('Invalid Review response. Refresh to retry.'); }

export function parseTree(v:unknown, view:View, generation?:string, limit=1000):Tree {
 if (!record(v) || v.view !== view || !identity(v.generation) ||
  (generation !== undefined && v.generation !== generation) || !nullableString(v.head) ||
  !count(v.total) || !count(v.matched) || v.matched > v.total ||
  !(v.nextCursor === null || identity(v.nextCursor)) ||
  !Array.isArray(v.entries) || v.entries.length > Math.min(v.matched,limit) ||
  !v.entries.every(isEntry) || new Set(v.entries.map(e => e.id)).size !== v.entries.length ||
  (v.nextCursor !== null && !v.entries.length) ||
  !(v.base === null || (record(v.base) && oneOf(v.base.kind,['head','empty','mergeBase']) &&
   (v.base.kind === 'empty' ? v.base.oid === null : identity(v.base.oid)))) ||
  !(v.origin === null || (record(v.origin) && identity(v.origin.ref) && identity(v.origin.oid) &&
   oneOf(v.origin.source,['symbolic','fallback']))) ||
  (view === 'diff' && (!record(v.base) || v.base.kind !== 'mergeBase' || v.origin === null))) invalid();
 return v as Tree;
}

export function parseFile(v:unknown, generation:string, id:string, known?:string, view?:View):FileReply {
 if (!record(v) || v.id !== id || v.generation !== generation || !identity(v.version)) invalid();
 if (v.kind === 'unchanged' && v.version === known) return v as FileReply;
 if (v.kind !== 'document' || !isEntry(v.entry) || v.entry.id !== id || v.entry.kind === 'directory' ||
  !(v.before === null || isSide(v.before)) || !isSide(v.after) ||
  (view !== undefined && (view === 'all') !== (v.before === null))) invalid();
 return v as FileReply;
}

function parseStats(v:unknown, generation:string, ids:string[]):Stats {
 const remaining = new Set(ids);
 if (!record(v) || v.generation !== generation || !Array.isArray(v.items) ||
  v.items.length !== remaining.size || !v.items.every(item => {
   if (!record(item) || !string(item.id) || !remaining.delete(item.id) || !record(item.stat)) return false;
   const s = item.stat;
   return s.kind === 'lines' ? count(s.added) && count(s.deleted) : s.kind === 'unavailable' &&
    oneOf(s.reason,['binary','encoding','tooLarge','special','conflict','budget']);
  })) invalid();
 return v as Stats;
}

export function reviewApi(session:string):ReviewApi {
 const endpoint = '/api/sessions/' + encodeURIComponent(session) + '/review/';
 const get = async (route:string, query:URLSearchParams, signal?:AbortSignal) => {
  const path = endpoint + route + '?' + query;
  let retryAfter:string|null = null;
  try {
   return await request('GET',path,undefined,signal,'project',response=>{
    retryAfter = response.headers.get('retry-after');
   });
  } catch (error) {
   if (problemCode(error) !== 'review_busy') throw error;
   const seconds = Number(retryAfter ?? 1);
   await new Promise<void>((resolve,reject) => {
    signal?.throwIfAborted();
    const delay = Number.isFinite(seconds) ? Math.max(0,Math.min(seconds,2)) : 1;
    const timer = setTimeout(() => {
     signal?.removeEventListener('abort',cancel);
     resolve();
    },delay*1000);
    function cancel() {
     clearTimeout(timer);
     reject(signal?.reason);
    }
    signal?.addEventListener('abort',cancel,{once:true});
   });
   return request('GET',path,undefined,signal);
  }
 };
 return {
  async tree(view, {limit=1000,generation,cursor,q,fresh}, signal) {
   const query = new URLSearchParams({view,limit:String(limit)});
   if (generation) query.set('generation',generation);
   if (cursor) query.set('cursor',cursor);
   if (q) query.set('q',q);
   if (fresh) query.set('fresh','1');
   return parseTree(await get('tree',query,signal),view,generation,limit);
  },
  async file(view,generation,id,known,signal) {
   const query = new URLSearchParams({view,generation,id});
   if (known) query.set('knownVersion',known);
   return parseFile(await get('file',query,signal),generation,id,known,view);
  },
  async stats(view,generation,ids,signal) {
   const query = new URLSearchParams({view,generation});
   for (const id of ids) query.append('id',id);
   return parseStats(await get('stats',query,signal),generation,ids);
  },
 };
}

export function problemCode(error:unknown) {
 return error instanceof HttpError && record(error.problem) && string(error.problem.code) ? error.problem.code : undefined;
}
export function accessLost(error:unknown) {
 return error instanceof HttpError && ([401,403].includes(error.status) ||
  oneOf(problemCode(error),['session','project']));
}
