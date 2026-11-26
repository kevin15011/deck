import React, {useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import {Markdown} from '../markdown';
import {readPreference,savePreference} from '../preferences';
import {views,type Entry,type Tree,type View} from './api';
import ReviewEditor, {type Layout} from './editor';
import {resolveReviewPresentation} from './presentation';
import type {ReviewStore} from './store';
import {buildTree,visibleRows} from './tree';
import {TreeView} from './tree-view';

const titles = {all:'All',changes:'Changes',diff:'Diff'};
const splitWidth = 520;
const unavailable:Record<string,string> = {
 no_repository:'No Git repository is available for this project.',
 no_origin_default:'No local origin default branch is available.',
 no_head:'This branch has no commits yet.',
 no_merge_base:'There is no available common ancestor between HEAD and the origin default branch.',
 ambiguous_merge_base:'HEAD and the origin default branch have multiple merge bases.',
 unsupported_repository:'This repository layout cannot be reviewed.',
};

export default function ReviewPanel({store,scope,visible}:{store:ReviewStore;scope:string;visible:boolean}) {
 const state = useSyncExternalStore(store.subscribe,store.snapshot);
 const {view,tree,document,selection,error,fileError,counts} = state;
 const [query,setQuery] = useState('');
 const [search,setSearch] = useState<{tree:Tree; query:string; ids:ReadonlySet<string>}>();
 const [expansions,setExpansions] = useState<Partial<Record<View,Set<string>>>>(()=>{
  const initial:Partial<Record<View,Set<string>>> = {};
  for (const candidate of views) {
   const segments = readPreference(scope+'.review-path.'+candidate).split('/');
   initial[candidate] = new Set(segments.slice(0,-1).map((_,i)=>'folder:'+segments.slice(0,i+1).join('/')));
  }
  return initial;
 });
 const [preferred,setPreferred] = useState<Layout>(()=>readPreference(scope+'.review-layout') === 'split' ? 'split' : 'inline');
 const [allPresentation,setAllPresentation] = useState(()=>readPreference(scope+'.review-markdown-all'));
 const [diffPresentation,setDiffPresentation] = useState(()=>readPreference(scope+'.review-markdown-diff'));
 const [width,setWidth] = useState(0);
 const viewer = useRef<HTMLDivElement>(null);
 const bookmarks = useRef<React.ComponentProps<typeof ReviewEditor>['bookmarks']>(new Map());
 const layout = width >= splitWidth ? preferred : 'inline';

 useLayoutEffect(() => {
  for (const candidate of views) store.restoreSelection(candidate,readPreference(scope+'.review-path.'+candidate));
 },[scope,store]);
 useLayoutEffect(() => {
  const element = viewer.current;
  if (!element) return;
  const observer = new ResizeObserver(([entry]) => {
   const next = entry?.contentRect.width;
   if (next) setWidth(next);
  });
  observer.observe(element);
  return () => observer.disconnect();
 },[]);
 useEffect(() => {
  if (!visible || !tree || !query) return;
  let current = true;
  const timer = setTimeout(() => void store.search(query,tree).then(ids=>{
   if (ids && current) setSearch({tree,query,ids});
  }),160);
  return () => {current = false; clearTimeout(timer);};
 },[query,store,tree,visible]);

 const root = useMemo(()=>buildTree(tree?.entries ?? []),[tree]);
 const matching = search && search.tree === tree && search.query === query ? search.ids : undefined;
 const rows = useMemo(()=>visibleRows(root,expansions[view] ?? new Set(),query,matching),
  [root,expansions,view,query,matching]);
 const select = useCallback((entry:Entry) => {
  savePreference(scope+'.review-path.'+view,entry.path);
  store.select(entry);
 },[scope,store,view]);
 const artifactEntries = useMemo(()=>new Map((tree?.entries ?? [])
  .filter(entry=>entry.kind !== 'directory').map(entry=>[entry.path,entry])),[tree]);
 const artifactPaths = useMemo(()=>Array.from(artifactEntries.keys()),[artifactEntries]);
 const selectArtifact = useCallback((path:string) => {
  const entry = artifactEntries.get(path);
  if (!entry) return;
  const segments = path.split('/');
  setExpansions(value=>{
   const next = new Set(value[view]);
   for (let i = 1; i < segments.length; i++) next.add('folder:'+segments.slice(0,i).join('/'));
   return {...value,[view]:next};
  });
  select(entry);
 },[artifactEntries,select,view]);
 const presentation = document && resolveReviewPresentation(document,
  document.before ? diffPresentation : allPresentation);
 const previewing = presentation?.mode === 'preview';
 const choosePresentation = (mode:'code'|'diff'|'preview') => {
  if (document?.before) {
   setDiffPresentation(mode);
   savePreference(scope+'.review-markdown-diff',mode);
  } else {
   setAllPresentation(mode);
   savePreference(scope+'.review-markdown-all',mode);
  }
 };
 const chooseLayout = (layout:Layout) => {
  setPreferred(layout);
  savePreference(scope+'.review-layout',layout);
  if (previewing) choosePresentation('diff');
 };
 const toggle = (key:string) => setExpansions(value=>{
  const next = new Set(value[view]);
  if (!next.delete(key)) next.add(key);
  return {...value,[view]:next};
 });
 const stats = useCallback((ids:string[]) => {
  if (visible && tree && !state.reading) void store.loadStats(ids,tree);
 },[visible,store,tree,state.reading]);
 const report = error && (unavailable[error.code ?? ''] ?? error.message);
 const splitAvailable = width >= splitWidth;

 return <div className="review-panel">
  <div className="review-toolbar">
   <div className="review-views" role="group" aria-label="Review view">
    {views.map(option=><button className="quiet" type="button" key={option} aria-pressed={option===view}
     onClick={()=>store.setView(option)}>{titles[option]} <small>{counts[option] ?? '—'}</small></button>)}
   </div>
   <button className="quiet review-refresh" type="button" onClick={()=>void store.refresh()}>Refresh</button>
  </div>
  {view === 'diff' && tree?.origin && tree.base && <div className="review-comparison">
   <span>{tree.origin.ref}</span><span>Merge base <code>{tree.base.oid}</code></span>
  </div>}
  {report && <p className="review-message" role="alert">{report}</p>}
  <div className="review-browser">
   <div className="review-navigation">
    <div className="review-search">
     <input type="search" aria-label="Filter files" placeholder="Filter files" maxLength={256} value={query}
      onChange={event=>setQuery(event.currentTarget.value)}/>
    </div>
    {tree && <TreeView key={view} rows={rows} selection={selection} stats={state.stats} filtered={!!query}
     onToggle={toggle} onSelect={select} onPrefetch={entry=>store.prefetch(entry)} onVisible={stats}/>}
    {!rows.length && !error && <p className="review-message" role="status">
     {!tree ? state.loading ? 'Reading project files…' : 'Opening Review…' :
      query ? 'No matching files.' : view === 'all' ? 'No project files.' : 'No changes.'}
    </p>}
   </div>
   <div ref={viewer} className="review-viewer">
    {document && <div className="review-file-heading">
     <div className="review-file-path" title={document.entry.path}>
      {document.entry.oldPath && <span className="review-old-path">{document.entry.oldPath} → </span>}
      {document.entry.path}
     </div>
     {(document.before || presentation?.preview) && <div className="review-layouts" role="group"
      aria-label={document.before ? 'Diff layout' : 'Markdown view'}>
      {document.before ? <>
       <button type="button" className="quiet" aria-pressed={!previewing && layout==='inline'}
        onClick={()=>chooseLayout('inline')}>Inline</button>
       <button type="button" className="quiet" aria-pressed={!previewing && layout==='split'} disabled={!splitAvailable}
        title={splitAvailable ? undefined : 'Widen Review to show both sides'}
        onClick={()=>chooseLayout('split')}>Side by side</button>
      </> : <button type="button" className="quiet" aria-pressed={!previewing}
       onClick={()=>choosePresentation('code')}>Code</button>}
      {presentation?.preview && <button type="button" className="quiet" aria-pressed={previewing}
       onClick={()=>choosePresentation('preview')}>Preview</button>}
     </div>}
    </div>}
    {fileError && <p className="review-message" role="status">{selection?.path} · {fileError.message}</p>}
    {state.reading && selection?.path !== document?.entry.path &&
     <p className="review-message" role="status">Opening {selection?.path}…</p>}
    {document && presentation?.mode === 'preview' ? <div key={document.entry.path} className="review-markdown-preview"
     tabIndex={0} role="region" aria-label="Markdown preview">
     {presentation.preview.deleted && <p className="review-markdown-notice">Previewing deleted version</p>}
     <Markdown text={presentation.preview.text} basePath={document.entry.path}
      artifactPaths={artifactPaths} onArtifactLink={selectArtifact}/>
    </div> : document ? <ReviewEditor path={document.entry.path} oldPath={document.entry.oldPath} before={document.before}
     after={document.after} layout={layout} bookmarkKey={JSON.stringify([view,document.entry.path])}
     bookmarks={bookmarks.current}/> : !selection && <p className="review-message">Select a file to review.</p>}
   </div>
  </div>
 </div>;
}
