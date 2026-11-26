import {expect, spyOn, test} from 'bun:test';
import {parseFile, parseTree, reviewApi, type Entry, type ReviewApi, type Tree, type ReviewDocument} from './api';
import {ReviewCache, ReviewStore} from './store';
import {buildTree, visibleRows} from './tree';

const entry = (path: string, kind: Entry['kind'] = 'file'): Entry =>
 ({id:path, path, kind, status:kind === 'file' ? 'M' : null, detail:null, oldPath:null});
const a = entry('src/a.ts'), b = entry('src/b.ts');
const catalog: Tree = {view:'changes', generation:'g', head:null, base:{kind:'empty',oid:null}, origin:null,
 total:2, matched:2, nextCursor:null, entries:[a,b]};
const doc = (file: Entry, version = 'v'): ReviewDocument => ({
 kind:'document', id:file.id, entry:file, generation:'g', version, before:{kind:'absent'},
 after:{kind:'text', text:file.path, bytes:file.path.length, mode:'100644'},
});

test('compaction uses complete branches, and filtering leaves expansion intact', () => {
 const tree = buildTree([entry('src/one/a.ts'), entry('src/two/b.ts'), entry('deep/chain/c.ts'),
  entry('empty','directory'), entry('link','symlink')]);
 const expanded = new Set<string>();
 expect(visibleRows(tree, expanded).map(row => row.label)).toEqual(['deep/chain','empty','src','link']);
 expect(visibleRows(tree, expanded, 'ONE/A').map(row => row.label)).toEqual(['src','one','a.ts']);
 expect(visibleRows(tree, expanded).map(row => row.label)).toEqual(['deep/chain','empty','src','link']);
 expect(visibleRows(buildTree([entry('src','file'), a]), expanded).map(row => row.label)).toEqual(['src','src']);
});

test('response validation rejects malformed counts, typed sides and mismatched identities', () => {
 expect(parseTree(catalog, 'changes', 'g')).toEqual(catalog);
 expect(() => parseTree({...catalog, total:-1}, 'changes')).toThrow();
 expect(() => parseTree(catalog, 'diff')).toThrow();
 expect(() => parseFile(doc(a), 'g', b.id)).toThrow();
 expect(() => parseFile({...doc(a), after:{kind:'text',text:'x',bytes:-1,mode:'100644'}}, 'g', a.id)).toThrow();
});

test('cache paints an owned document, preserves it on stale reads and ignores late selections', async () => {
 const cache = new ReviewCache();
 const pending: Array<{id:string;known?:string; resolve:(value:ReviewDocument)=>void; reject:(error:unknown)=>void}> = [];
 const api: ReviewApi = {
  tree: async (view, options) => ({...catalog,view, entries:options.limit === 0 ? [] : catalog.entries}),
  file: (_view, _generation, id, known) => new Promise((resolve,reject) => pending.push({id,known,resolve,reject})),
  stats: async () => ({generation:'g',items:[]}),
 };
 const store = new ReviewStore('scope', api, cache);
 store.setConnected(true);
 store.setOpen(true);
 await store.refresh();
 store.select(a);
 pending[0]!.resolve(doc(a));
 await Promise.resolve();
 store.select(b);
 expect(store.snapshot().document?.id).toBe(a.id);
 store.select(a);
 expect(store.snapshot().document?.id).toBe(a.id);
 expect(pending[2]?.known).toBe('v');
 pending[1]!.resolve(doc(b));
 pending[2]!.reject(Error('temporary failure'));
 await Promise.resolve();
 expect(store.snapshot().document?.id).toBe(a.id);
 store.dispose();
});

test('unchanged revalidation follows a rotated ID and forbidden replies remove cached text', async () => {
 const {HttpError} = await import('../api');
 const cache = new ReviewCache();
 const rotated = {...a,id:'rotated'};
 let generation = 'g';
 let forbidden = false;
 const versions: (string|undefined)[] = [];
 const api: ReviewApi = {
  tree: async (view, options) => ({
   ...catalog,view,generation,total:1,matched:1,
   entries:options.limit === 0 ? [] : [generation === 'g' ? a : rotated],
  }),
  file: async (_view, gen, id, known) => {
   versions.push(known);
   if (forbidden) throw new HttpError(403,'Device access ended',{code:'device-required'});
   return known === 'v' ? {kind:'unchanged',id,generation:gen,version:known} : doc(a);
  },
  stats: async () => ({generation,items:[]}),
 };
 const store = new ReviewStore('scope',api,cache);
 store.setConnected(true);
 store.setOpen(true);
 store.restoreSelection('changes',a.path);
 await store.refresh();
 generation = 'next';
 await store.refresh();
 expect(versions).toEqual([undefined,'v']);
 expect(store.snapshot().document?.entry.id).toBe(rotated.id);
 expect(store.snapshot().document?.after).toEqual(doc(a).after);
 expect(cache.read('scope','changes',rotated)?.generation).toBe('next');
 forbidden = true;
 await store.refresh();
 expect(store.snapshot().document).toBeUndefined();
 expect(store.snapshot().tree).toBeUndefined();
 expect(cache.read('scope','changes',rotated)).toBeUndefined();
 store.dispose();
});

test('LRU eviction respects the document count and the retained text size', () => {
 const cache = new ReviewCache();
 for (let i=0;i<24;i++) cache.write('scope','changes',doc(entry(String(i))));
 expect(cache.read('scope','changes',entry('0'))).toBeDefined();
 cache.write('scope','changes',doc(entry('24')));
 expect(cache.read('scope','changes',entry('1'))).toBeUndefined();
 expect(cache.read('scope','changes',entry('0'))).toBeDefined();
 const side = {kind:'text',text:'x'.repeat(1024*1024),bytes:1024*1024,mode:'100644'} as const;
 for (let i=0;i<5;i++) cache.write('scope','diff',{...doc(entry('large'+i)),before:side,after:side});
 expect(cache.read('scope','diff',entry('large0'))).toBeUndefined();
 expect(cache.read('scope','diff',entry('large4'))).toBeDefined();
 expect(cache.read('scope','changes',entry('0'))).toBeUndefined();
});

test('Review retries one busy response and preserves the session, view, and generation', async () => {
 const fetch = spyOn(globalThis,'fetch');
 fetch.mockResolvedValueOnce(Response.json({code:'review_busy'},{status:429,headers:{'retry-after':'0'}}));
 fetch.mockResolvedValueOnce(Response.json(doc(a)));
 try {
  expect(await reviewApi('fixture session').file('changes','g',a.id)).toEqual(doc(a));
  const url = '/api/sessions/fixture%20session/review/file?view=changes&generation=g&id=src%2Fa.ts';
  expect(fetch.mock.calls.map(([path])=>path)).toEqual([url,url]);
 } finally {
  fetch.mockRestore();
 }
});
