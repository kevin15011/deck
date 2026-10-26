import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { GitCatalog, GitDocument, GitContent, GitFile } from '../../../packages/core/src/session/git-diff';
import { ProjectFiles } from './project-files';
import { Markdown } from './markdown';
import { NavigationIcon } from './project-navigation';
import type { Api } from './workspace';
/** Aborting browser fetch does not cancel an admitted isolated reader process.
 * Retry only admission contention, within one deadline, for the current selection. */
export async function requestGit(api:Api,path:string,signal:AbortSignal) {
 const deadline=Date.now()+30000;
 for(;;) {
  signal.throwIfAborted();
  try{return await api(path,{signal});}
  catch(error) {
   signal.throwIfAborted();
   if((error as {code?:string}).code!=='git-busy'||Date.now()>=deadline)throw error;
   await new Promise<void>((resolve,reject)=>{
    const cancel=()=>{clearTimeout(timer);reject(signal.reason);};
    const timer=setTimeout(()=>{signal.removeEventListener('abort',cancel);resolve();},200);
    signal.addEventListener('abort',cancel,{once:true});
   });
  }
 }
}
type Row = { kind: 'context'|'add'|'remove'|'hunk'|'note'; text: string; old?: number; next?: number };
/** Git owns comparison semantics; this parser only numbers its bounded unified hunks. */
export function parseGitPatch(patch: string): Row[] {
 let old=0, next=0, inHunk=false;
 return patch.split('\n').flatMap((line): Row[] => {
  const hunk=/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
  if(hunk) { old=Number(hunk[1]); next=Number(hunk[2]); inHunk=true; return [{kind:'hunk',text:line}]; }
  if(!inHunk) return [];
  if(line.startsWith(' ')) return [{kind:'context',text:line.slice(1),old:old++,next:next++}];
  if(line.startsWith('-')) return [{kind:'remove',text:line.slice(1),old:old++}];
  if(line.startsWith('+')) return [{kind:'add',text:line.slice(1),next:next++}];
  if(line.startsWith('\\')) return [{kind:'note',text:line}];
  return [];
 });
}
function cell(row: Row | undefined, side: 'old'|'next') {
 return <><td className="diff-number">{row?.[side]}</td><td className={`diff-code ${row?.kind??'blank'}`}><span aria-hidden="true" className="diff-sign">{row?.kind==='remove'?'-':row?.kind==='add'?'+':' '}</span>{row?.text}</td></>;
}
export function DiffContent({patch,mode}:{patch:string;mode:'inline'|'split'}) {
 const rows=useMemo(()=>parseGitPatch(patch),[patch]);
 const metadata=patch.split('\n@@')[0];
 if(!rows.length) return <pre className="diff-metadata">{patch || 'No textual hunks.'}</pre>;
 const split: React.ReactNode[]=[];
 if(mode==='split') for(let i=0;i<rows.length;) {
  const row=rows[i]!;
  if(row.kind==='remove'||row.kind==='add') {
   const removed:Row[]=[],added:Row[]=[];
   while(i<rows.length && (rows[i]!.kind==='remove'||rows[i]!.kind==='add')) { const r=rows[i++]!; (r.kind==='remove'?removed:added).push(r); }
   for(let at=0;at<Math.max(removed.length,added.length);at++) split.push(<tr key={`${i}:${at}`}>{cell(removed[at],'old')}{cell(added[at],'next')}</tr>);
  } else { split.push(row.kind==='context'?<tr key={i}>{cell(row,'old')}{cell(row,'next')}</tr>:<tr key={i}><td colSpan={4} className={`diff-${row.kind}`}>{row.text}</td></tr>); i++; }
 }
 return <><details className="diff-headers"><summary>File metadata</summary><pre>{metadata}</pre></details><table className={`diff-table diff-${mode}`} aria-label={mode==='split'?'Side-by-side diff':'Inline diff'}><thead><tr>{mode==='split'?<><th colSpan={2}>Old</th><th colSpan={2}>New</th></>:<><th>Old</th><th>New</th><th>Change</th></>}</tr></thead><tbody>{mode==='split'?split:rows.map((row,i)=><tr key={i}>{row.kind==='hunk'||row.kind==='note'?<td colSpan={3} className={`diff-${row.kind}`}>{row.text}</td>:<><td className="diff-number">{row.old}</td><td className="diff-number">{row.next}</td><td className={`diff-code ${row.kind}`}><span className="diff-sign" aria-hidden="true">{row.kind==='add'?'+':row.kind==='remove'?'-':' '}</span>{row.text}</td></>}</tr>)}</tbody></table></>;
}
const fileKey=(file:GitFile)=>`${file.section}:${file.path}`;
const sectionNames={staged:'Staged · HEAD → index',unstaged:'Unstaged · index → worktree',untracked:'Untracked · new files'};
type FileNode = { name: string; path: string; children: Map<string, FileNode>; file?: GitFile };
export function gitStatus(file: GitFile) {
 if(file.status==='U' || ['AA','DD','AU','UA','DU','UD','UU'].includes(file.status)) return {kind:'conflict',label:'Conflict'};
 if(file.section==='untracked' || file.status==='A') return {kind:'new',label:'New'};
 if(file.status.startsWith('R')) return {kind:'renamed',label:'Renamed'};
 if(file.status==='D') return {kind:'deleted',label:'Deleted'};
 if(file.status==='M') return {kind:'modified',label:'Modified'};
 if(file.status==='T') return {kind:'modified',label:'Type changed'};
 if(file.status.startsWith('C')) return {kind:'renamed',label:'Copied'};
 return {kind:'unknown',label:'Unknown status'};
}
/** Aggregate descendant changes without requiring folders to be expanded or loaded. */
export function folderGitStatuses(files: GitFile[]) {
 const folders=new Map<string,ReturnType<typeof gitStatus>>();
 for(const file of files) {
  const status=gitStatus(file);
  const paths=file.status.startsWith('R')&&file.previousPath?[file.path,file.previousPath]:[file.path];
  for(const changedPath of paths) {
  const parts=changedPath.replace(/\/$/,'').split('/');
  for(let end=1;end<parts.length;end++) {
   const path=parts.slice(0,end).join('/'),previous=folders.get(path);
   const kind=!previous||previous.kind===status.kind?status.kind:previous.kind==='conflict'||status.kind==='conflict'?'conflict':'modified';
   folders.set(path,{kind,label:kind==='conflict'?'Contains conflicts':kind==='new'?'Contains new files':kind==='deleted'?'Contains deleted files':kind==='renamed'?'Contains renamed or copied files':kind==='unknown'?'Contains files with unknown status':'Contains changes'});
  }
  }
 }
 return folders;
}
function fileHierarchy(files: GitFile[]) {
 const root: FileNode={name:'',path:'',children:new Map()};
 for(const file of files) {
  const parts=file.path.replace(/\/$/,'').split('/'); let parent=root;
  parts.forEach((name,index)=>{
   let node=parent.children.get(name);
   if(!node) {node={name,path:parts.slice(0,index+1).join('/'),children:new Map()};parent.children.set(name,node);}
   if(index===parts.length-1) node.file=file;
   parent=node;
  });
 }
 return root;
}
/** Native disclosures and buttons use ordinary Tab / Enter / Space navigation. */
export function GitFileNavigator({files,selected,onSelect,onPreview,visible=true}:{files:GitFile[];selected:string;onSelect:(file:GitFile)=>void;onPreview?:(file:GitFile)=>void;visible?:boolean}) {
 const [collapsed,setCollapsed]=useState<Set<string>>(()=>new Set());
 const tree=useRef<HTMLElement>(null),selectedRow=useRef<HTMLButtonElement>(null);
 const wasVisible=useRef(false),revealPending=useRef(false);
 useLayoutEffect(()=>{
  if(visible&&!wasVisible.current)revealPending.current=true;
  wasVisible.current=visible;
  if(!visible||!revealPending.current)return;
  const file=files.find(file=>fileKey(file)===selected);
  if(!file)return;
  const parts=file.path.replace(/\/$/,'').split('/');
  const ancestors=[file.section,...parts.slice(0,-1).map((_,index)=>`${file.section}:${parts.slice(0,index+1).join('/')}`)];
  if(ancestors.some(key=>collapsed.has(key))) {
   setCollapsed(previous=>{const next=new Set(previous);ancestors.forEach(key=>next.delete(key));return next;});
   return;
  }
  const row=selectedRow.current,pane=tree.current?.closest<HTMLElement>('.git-navigator');
  if(!row||!pane)return;
  revealPending.current=false;
  // scrollIntoView also scrolls outer ancestors. Move only the navigator,
  // allowing for its sticky mobile toggle, and leave focus in place.
  const bounds=pane.getBoundingClientRect(),item=row.getBoundingClientRect();
  const toggle=pane.querySelector<HTMLElement>('.git-navigator-toggle');
  const top=bounds.top+pane.clientTop+(toggle?.offsetHeight??0);
  const bottom=bounds.top+pane.clientTop+pane.clientHeight;
  if(item.top<top||item.bottom>bottom)pane.scrollTop+=item.top-top-(bottom-top-item.height)/2;
 },[visible,selected,files,collapsed]);

 const groups=useMemo(()=>(['staged','unstaged','untracked'] as const).map(section=>({section,files:files.filter(file=>file.section===section)})),[files]);
 const folderStatuses=useMemo(()=>new Map<string,ReturnType<typeof gitStatus>>(groups.flatMap(group=>[...folderGitStatuses(group.files)].map(([path,status])=>[`${group.section}:${path}`,status] as const))),[groups]);
 function disclosure(key:string,label:React.ReactNode,children:React.ReactNode,className?:string) {
  const open=!collapsed.has(key),folderStatus=className==='git-folder'?folderStatuses.get(key):undefined;
  return <details key={key} className={className} open={open}><summary className={folderStatus?`git-status-${folderStatus.kind}`:undefined} title={folderStatus?.label} onClick={event=>{event.preventDefault();setCollapsed(previous=>{const next=new Set(previous);if(next.has(key))next.delete(key);else next.add(key);return next;});}}><NavigationIcon kind="chevron" expanded={open}/>{label}</summary>{children}</details>;
 }
 function nodes(parent:FileNode,section:string):React.ReactNode {
  return <ul>{[...parent.children.values()].sort((a,b)=>Number(!!b.children.size)-Number(!!a.children.size)||a.name.localeCompare(b.name)).map(node=>{
   const file=node.file;
   return <li key={node.path}>{file&&(()=>{const status=gitStatus(file);const label=`${section}: ${file.path} · ${status.label}${file.previousPath?` from ${file.previousPath}`:''}${file.unavailableReason?` · ${file.unavailableReason}`:''}`;
    return <div className="git-file-row"><button type="button" className={`git-file git-status-${status.kind}`} data-file-key={fileKey(file)} ref={selected===fileKey(file)?selectedRow:undefined} aria-current={selected===fileKey(file)?'true':undefined} aria-label={label} title={label} onClick={()=>onSelect(file)}>
     {file.path.endsWith('/')?<NavigationIcon kind="folder"/>:<svg className="navigation-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true"><path d="M4 2h5l3 3v9H4Z M9 2v4h3"/></svg>}
     <span className="git-file-name">{node.name}{file.path.endsWith('/')?'/':''}{file.previousPath&&<small>← {file.previousPath}</small>}</span><span className="git-file-badge" aria-hidden="true">{file.unavailableReason?'!':file.status}</span>
    </button>{/\.md$/i.test(file.path)&&onPreview&&<MarkdownPreviewButton file={file} onClick={()=>onPreview(file)}/>}</div>;})()}{node.children.size>0&&disclosure(`${section}:${node.path}`,<><NavigationIcon kind="folder"/><span className="git-folder-name" title={node.path}>{node.name}{file?'/':''}</span></>,nodes(node,section),'git-folder')}</li>;
  })}</ul>;
 }
 return <nav ref={tree} className="git-file-tree" aria-label="Changed files">{groups.map(group=>group.files.length?disclosure(group.section,<><span>{group.section==='staged'?'Staged':group.section==='unstaged'?'Unstaged':'Untracked'}</span><span className="git-file-count">{group.files.length}</span></>,nodes(fileHierarchy(group.files),group.section),'git-file-group'):null)}{!files.length&&<p className="empty-note">No changed files</p>}</nav>;
}
export function MarkdownPreviewButton({file,onClick}:{file:GitFile;onClick:()=>void}) {
 return <button type="button" className="quiet git-preview-button" aria-label={`Preview Markdown: ${file.section}: ${file.path}`} title="Preview Markdown" onClick={onClick}><svg className="navigation-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true" focusable="false"><path d="M1 3h14v10H1Z M3 10V6l2 2 2-2v4 M11 5v6m-2-2 2 2 2-2"/></svg></button>;
}
export function GitDocumentHeader({file,preview,onPreview}:{file:GitFile;preview:boolean;onPreview:()=>void}) {
 return <div className="git-document-header"><div className="git-document-path" title={file.path}>{file.path}<span className={`git-status-${gitStatus(file).kind}`}>{gitStatus(file).label}</span></div>{!preview&&/\.md$/i.test(file.path)&&<MarkdownPreviewButton file={file} onClick={onPreview}/>}</div>;
}
function GitChanges({api,sessionId,visible,narrow}:{api:Api;sessionId:string;visible:boolean;narrow:boolean}) {
 const [catalog,setCatalog]=useState<GitCatalog>(),[selected,setSelected]=useState(''),[document,setDocument]=useState<GitDocument>();
 const [error,setError]=useState(''),[loading,setLoading]=useState(false),[refresh,setRefresh]=useState(0);
 const [preview,setPreview]=useState(false),[content,setContent]=useState<GitContent>();
 const [navigatorOpen,setNavigatorOpen]=useState(false);
 const navigatorToggle=useRef<HTMLButtonElement>(null);
 const [mode,setMode]=useState<'inline'|'split'>(()=>narrow?'inline':'split');
 const viewport=useRef<HTMLDivElement>(null),positions=useRef(new Map<string,{top:number;left:number}>());
 const loaded=useRef(-1),request=useRef(0);
 const effectiveMode=narrow?'inline':mode,positionKey=`${selected}:${preview?'preview':'diff'}`;
 const shown=useRef(positionKey);
 function remember() { const el=viewport.current; if(el)positions.current.set(shown.current,{top:el.scrollTop,left:el.scrollLeft}); }
 useLayoutEffect(()=>{ if(!visible)return; shown.current=positionKey; const saved=positions.current.get(positionKey); if(viewport.current){viewport.current.scrollTop=saved?.top??0;viewport.current.scrollLeft=saved?.left??0;} },[positionKey,effectiveMode,document,content,visible]);
 useEffect(()=>{
  if(!visible||!sessionId||loaded.current===refresh)return;
  const controller=new AbortController(); const id=++request.current; setLoading(true);setError('');
  requestGit(api,`/api/sessions/${encodeURIComponent(sessionId)}/git`,controller.signal).then(reply=>{
   if(id!==request.current||controller.signal.aborted)return;
   setCatalog(reply.data); loaded.current=refresh;
   setSelected(previous=>reply.data.files.some((file:GitFile)=>fileKey(file)===previous)?previous:reply.data.files[0]?fileKey(reply.data.files[0]):'');
  }).catch(err=>{if(!controller.signal.aborted)setError(err.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[visible,sessionId,refresh,api]);
 useEffect(()=>{
  if(!visible||!selected||!catalog || loaded.current!==refresh)return;
  const file=catalog.files.find(file=>fileKey(file)===selected);if(!file)return;
  const controller=new AbortController(); setLoading(true);setError('');
  setContent(undefined);
  requestGit(api,`/api/sessions/${encodeURIComponent(sessionId)}/git/${preview?'content':'diff'}?${new URLSearchParams({section:file.section,path:file.path})}`,controller.signal).then(reply=>{
   if(!controller.signal.aborted){if(preview)setContent(reply.data);else setDocument(reply.data);}
  }).catch(err=>{if(!controller.signal.aborted)setError(err.message);}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
  return()=>controller.abort();
 },[visible,selected,catalog,refresh,sessionId,api,preview]);
 const file=catalog?.files.find(file=>fileKey(file)===selected);
 function select(next:GitFile,render:boolean) {remember();setSelected(fileKey(next));setPreview(render);if(narrow){setNavigatorOpen(false);navigatorToggle.current?.focus();}}
 const currentContent=content&&fileKey(content.file)===selected?content:undefined;
 const current=document && fileKey(document.file)===selected ? document : undefined;
 return <section className="git-view" aria-label="Git changes" aria-busy={loading}>
  <div className="git-toolbar"><strong>Changes</strong><button type="button" className="quiet" onClick={()=>{remember();setRefresh(value=>value+1);}} disabled={loading||!sessionId}>Refresh</button><div role="group" aria-label="Diff rendering">{(['inline','split'] as const).map(value=><button type="button" key={value} className="quiet" aria-pressed={effectiveMode===value} disabled={narrow&&value==='split'} onClick={()=>{remember();setMode(value);}}>{value==='inline'?'Inline':'Side-by-side'}</button>)}</div></div>
  {!sessionId?<p className="empty-note">Choose a session to view Git changes.</p>:<>
  <div className="git-status" role="status">{loading?'Loading Git changes…':error||(!catalog?'Open or refresh to load changes.':!catalog.files.length?(catalog.warnings?.length?'No supported working changes.':'No working changes.'):`${catalog.files.length} files · ${file?sectionNames[file.section]:''}`)}</div>
  {catalog?.warnings?.map(warning=><p key={warning} className="empty-note">{warning}</p>)}
  <div className={`git-browser${narrow?' git-browser-narrow':''}`}>
   <aside className="git-navigator">
    {narrow&&<button ref={navigatorToggle} type="button" className="git-navigator-toggle quiet" aria-expanded={navigatorOpen} aria-controls="git-file-navigation" onClick={()=>setNavigatorOpen(value=>!value)}><NavigationIcon kind="chevron" expanded={navigatorOpen}/><span>Changed files · {catalog?.files.length??0}</span><span className="git-selected-name">{file?.path}</span></button>}
    <div id="git-file-navigation" hidden={narrow&&!navigatorOpen}><GitFileNavigator visible={visible&&(!narrow||navigatorOpen)} files={catalog?.files??[]} selected={selected} onSelect={next=>select(next,false)} onPreview={next=>select(next,true)}/></div>
   </aside>
   <div className="git-document">
    {file&&<GitDocumentHeader file={file} preview={preview} onPreview={()=>{remember();setPreview(true);requestAnimationFrame(()=>viewport.current?.focus({preventScroll:true}));}}/>}
  {preview&&<div className="git-preview-toolbar"><strong>Markdown preview</strong><span>{currentContent?.version==='HEAD'?'HEAD · before deletion':currentContent?.version==='index'?(file?.status==='D'?'Index · before deletion':'Index · staged version'):currentContent?.version==='working'?'Working version':''}</span><button type="button" className="quiet" onClick={()=>{remember();setPreview(false);requestAnimationFrame(()=>viewport.current?.focus({preventScroll:true}));}}>Return to diff</button></div>}
  <div ref={viewport} className="diff-viewport" aria-label={preview?"Markdown preview":"File diff"} tabIndex={0} onScroll={remember}>
   {error?<p className="empty-note">Content unavailable. Use Refresh to try again.</p>:preview?(currentContent?<>{currentContent.message&&<p className="empty-note">{currentContent.message}</p>}{currentContent.kind==='text'&&<article className="document-reading"><Markdown text={currentContent.content}/></article>}</>:<p className="empty-note">Loading document…</p>):current?<>{current.message&&<p className="empty-note">{current.message}</p>}{current.kind==='text'&&<DiffContent patch={current.patch} mode={effectiveMode}/>}</>:selected?<p className="empty-note">{loading?'Loading selected file…':'Select or refresh a file to read its diff.'}</p>:null}
  </div></div></div></>}
 </section>;
}

export function GitDiff(props:{api:Api;sessionId:string;visible:boolean;narrow:boolean}) {
 const [view,setView]=useState<'files'|'changes'>('files');
 return <div className="review-view"><div className="git-toolbar" role="group" aria-label="Review mode"><strong>Review</strong>{(['files','changes'] as const).map(mode=><button key={mode} className="quiet" aria-pressed={view===mode} onClick={()=>setView(mode)}>{mode==='files'?'Files':'Changes'}</button>)}</div><div className="review-panel" hidden={view!=='files'}><ProjectFiles {...props} visible={props.visible&&view==='files'}/></div><div className="review-panel" hidden={view!=='changes'}><GitChanges {...props} visible={props.visible&&view==='changes'}/></div></div>;
}
