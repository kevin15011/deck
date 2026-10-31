import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import type {ProjectContent,ProjectListing} from '../../../packages/core/src/session/project-files';
import type {GitFile} from '../../../packages/core/src/session/git-diff';
import type {Api} from './workspace';
import {requestGit,gitStatus,folderGitStatuses,MarkdownPreviewButton} from './git-diff';
import {NavigationIcon} from './project-navigation';
import {Markdown} from './markdown';
function RasterImage({document}:{document:Extract<ProjectContent,{kind:'image'}>}){
 const [failed,setFailed]=useState(false);
 useEffect(()=>setFailed(false),[document]);
 return failed?<p className="empty-note">Image could not be decoded. The file may be malformed or unsupported.</p>:<figure className="project-image"><img src={`data:${document.mime};base64,${document.base64}`} alt={document.path} width={document.width} height={document.height} onError={()=>setFailed(true)}/><figcaption>{document.width} × {document.height} · {(document.size/1024).toFixed(0)} KiB</figcaption></figure>;
}
export function FileContent({document,markdown}:{document:ProjectContent;markdown:boolean}){
 if(document.kind==='image')return <RasterImage document={document}/>;
 if(document.kind==='text')return markdown?<article className="document-reading"><Markdown text={document.content}/></article>:<pre className="project-text">{document.content}</pre>;
 return <p className="empty-note">{document.message}</p>;
}
export function ProjectFiles({api,sessionId,visible,narrow}:{api:Api;sessionId:string;visible:boolean;narrow:boolean}){
 const [directories,setDirectories]=useState<Record<string,ProjectListing>>({}),[expanded,setExpanded]=useState(()=>new Set(['']));
 const [selected,setSelected]=useState(''),[content,setContent]=useState<ProjectContent>(),[markdown,setMarkdown]=useState(false);
 const [showIgnored,setShowIgnored]=useState(false),[refresh,setRefresh]=useState(0),[error,setError]=useState(''),[listingErrors,setListingErrors]=useState<Record<string,string>>({});
 const [pages,setPages]=useState<Record<string,string>>({});
 const [changes,setChanges]=useState<GitFile[]>(),[gitMessage,setGitMessage]=useState(''),[busy,setBusy]=useState(false),[open,setOpen]=useState(false);
 const [revealRun,setRevealRun]=useState<{path:string;base:string}|undefined>(),[revealMessage,setRevealMessage]=useState('');
 const directorySnapshot=useRef(directories);directorySnapshot.current=directories;
 function startReveal(){reveal.current=true;setRevealMessage('');setRevealRun(selected?{path:selected,base}:undefined);}
 const pageFocus=useRef<string|undefined>(undefined);
 const navigator=useRef<HTMLElement>(null),row=useRef<HTMLButtonElement>(null),viewport=useRef<HTMLDivElement>(null),toggle=useRef<HTMLButtonElement>(null);
 const positions=useRef(new Map<string,number>()),wasVisible=useRef(false),reveal=useRef(false);
 const key=`${selected}:${markdown}`,shown=useRef(key),base=`/api/sessions/${encodeURIComponent(sessionId)}`;
 const treeVisible=visible&&(!narrow||open);
 function remember(){if(viewport.current)positions.current.set(shown.current,viewport.current.scrollTop);}
 useLayoutEffect(()=>{if(!visible)return;shown.current=key;if(viewport.current)viewport.current.scrollTop=positions.current.get(key)??0;},[key,content,visible]);
 useEffect(()=>{setSelected('');setContent(undefined);setBusy(false);setError('');setMarkdown(false);positions.current.clear();reveal.current=false;setRevealRun(undefined);setRevealMessage('');},[sessionId]);
 useEffect(()=>{setDirectories({});setListingErrors({});setPages({});pageFocus.current=undefined;if(treeVisible)startReveal();},[sessionId,showIgnored,refresh]);
 useEffect(()=>{
  if(!visible||!sessionId||revealRun)return;
  // Only request reachable expansions. A removed folder cannot block siblings.
  const reachable=(path:string)=>{let parent='';for(const name of path.split('/').filter(Boolean)){const child=parent?parent+'/'+name:name;if(!expanded.has(parent)||!directories[parent]?.entries.some(entry=>entry.path===child&&entry.kind==='directory'))return false;parent=child;}return true;};
  const missing=[...expanded].find(path=>reachable(path)&&!listingErrors[path]&&(!directories[path]||pages[path]));if(missing===undefined)return;
  const cursor=pages[missing],controller=new AbortController();
  const query=new URLSearchParams({path:missing,showIgnored:String(showIgnored)});if(cursor)query.set('cursor',cursor);
  requestGit(api,`${base}/files?${query}`,controller.signal).then(reply=>{if(controller.signal.aborted)return;
   const listing=reply.data as ProjectListing;
   if(cursor&&listing.entries[0])pageFocus.current=listing.entries[0].path;
   setDirectories(previous=>({...previous,[missing]:{...listing,entries:cursor?[...(previous[missing]?.entries??[]),...listing.entries]:listing.entries}}));
   setPages(previous=>{const next={...previous};delete next[missing];return next;});
  }).catch(err=>{if(!controller.signal.aborted){setListingErrors(previous=>({...previous,[missing]:err.message}));setPages(previous=>{const next={...previous};delete next[missing];return next;});}});
  return()=>controller.abort();
 },[api,base,visible,sessionId,expanded,directories,showIgnored,listingErrors,pages,revealRun]);
 useLayoutEffect(()=>{
  if(!pageFocus.current||!navigator.current)return;
  const entry=[...navigator.current.querySelectorAll<HTMLElement>('[data-project-entry]')].find(element=>element.getAttribute('data-project-entry')===pageFocus.current);
  const control=entry?.querySelector<HTMLElement>('summary,button:not(:disabled)');if(control){control.focus({preventScroll:true});const bounds=navigator.current.getBoundingClientRect(),item=control.getBoundingClientRect();if(item.bottom>bounds.bottom)navigator.current.scrollTop+=item.bottom-bounds.bottom;if(item.top<bounds.top)navigator.current.scrollTop+=item.top-bounds.top;pageFocus.current=undefined;}
 },[directories]);
 // Reconcile removed expansions only when the parent has been fully listed.
 useEffect(()=>{setExpanded(previous=>{const next=new Set([...previous].filter(path=>{
  if(!path)return true;const parent=path.slice(0,Math.max(0,path.lastIndexOf('/'))),listing=directories[parent];
  return !listing||!!listing.nextCursor||listing.entries.some(entry=>entry.path===path&&entry.kind==='directory');
 }));return next.size===previous.size?previous:next;});},[directories]);
 useEffect(()=>{
  if(!visible||!sessionId)return;const controller=new AbortController();setGitMessage('Checking Git status…');setChanges(undefined);
  requestGit(api,`${base}/git`,controller.signal).then(reply=>{if(!controller.signal.aborted){setChanges(reply.data.files);setGitMessage(reply.data.warnings?.join(' ')??'');}}).catch(err=>{if(!controller.signal.aborted)setGitMessage(`Git status unavailable. Project files remain readable. ${err.message}`);});
  return()=>controller.abort();
 },[api,base,sessionId,visible,refresh]);
 useEffect(()=>{
  if(!visible||!selected)return;const controller=new AbortController();setBusy(true);setError('');setContent(undefined);
  requestGit(api,`${base}/files/content?${new URLSearchParams({path:selected})}`,controller.signal).then(reply=>{if(!controller.signal.aborted)setContent(reply.data);}).catch(err=>{if(!controller.signal.aborted)setError(err.message);}).finally(()=>{if(!controller.signal.aborted)setBusy(false);});
  return()=>controller.abort();
 },[api,base,visible,selected,refresh]);
 // A reveal is an explicit operation, never a consequence of ordinary tree browsing.
 useLayoutEffect(()=>{
  if(treeVisible&&!wasVisible.current)startReveal();
  if(!treeVisible){reveal.current=false;setRevealRun(undefined);}
  wasVisible.current=treeVisible;
 },[treeVisible]);
 useEffect(()=>{
  if(!revealRun)return;
  if(!treeVisible||revealRun.path!==selected||revealRun.base!==base){setRevealRun(undefined);return;}
  const controller=new AbortController(),cache={...directorySnapshot.current};
  const seen=new Set<string>();let requests=0;
  const timer=setTimeout(()=>{controller.abort();reveal.current=false;setRevealMessage('Automatic reveal timed out. Use Load more to continue browsing.');setRevealRun(undefined);},15000);
  async function locate(){
   let parent='';const parts=selected.split('/');
   for(let i=0;i<parts.length;i++){
    const target=parts.slice(0,i+1).join('/');
    const directory=parent;setExpanded(previous=>new Set([...previous,directory]));
    for(;;){
     controller.signal.throwIfAborted();
     const listing=cache[parent],entry=listing?.entries.find(entry=>entry.path===target);
     if(entry){if(i<parts.length-1&&entry.kind!=='directory')throw new Error('Selected file is no longer reachable.');break;}
     if(listing&&!listing.nextCursor)throw new Error('Selected file is absent from the current listing.');
     const cursor=listing?.nextCursor,identity=JSON.stringify([parent,cursor]);
     if(seen.has(identity)||requests>=64)throw new Error('Automatic reveal reached its page limit. Use Load more to continue browsing.');
     seen.add(identity);requests++;
     const query=new URLSearchParams({path:parent,showIgnored:String(showIgnored)});if(cursor)query.set('cursor',cursor);
     let page:ProjectListing;
     try{page=(await requestGit(api,`${base}/files?${query}`,controller.signal)).data as ProjectListing;}
     catch(error){if(!controller.signal.aborted){const path=parent;setListingErrors(previous=>({...previous,[path]:(error as Error).message}));}throw error;}
     controller.signal.throwIfAborted();
     const path=parent;
     cache[path]={...page,entries:cursor?[...listing.entries,...page.entries]:page.entries};
     setDirectories(previous=>({...previous,[path]:cache[path]}));
    }
    parent=target;
   }
  }
  locate().catch(error=>{if(!controller.signal.aborted){reveal.current=false;setRevealMessage(error.message);}}).finally(()=>{
   clearTimeout(timer);if(!controller.signal.aborted)setRevealRun(undefined);
  });
  return()=>{clearTimeout(timer);controller.abort();};
 },[revealRun,treeVisible,selected,api,base,sessionId,showIgnored]);
 useLayoutEffect(()=>{
  if(!treeVisible||!reveal.current||!selected)return;
  if(row.current&&navigator.current){const pane=navigator.current,bounds=pane.getBoundingClientRect(),item=row.current.getBoundingClientRect(),top=bounds.top+(toggle.current?.offsetHeight??0);if(item.top<top||item.bottom>bounds.bottom)pane.scrollTop+=item.top-top-(bounds.bottom-top-item.height)/2;reveal.current=false;}
 },[treeVisible,selected,expanded,directories]);
 function select(path:string,preview=false){reveal.current=false;setRevealRun(undefined);setRevealMessage('');remember();setSelected(path);setMarkdown(preview);if(narrow){setOpen(false);toggle.current?.focus({preventScroll:true});}}
 const folderStatuses=useMemo(()=>folderGitStatuses(changes??[]),[changes]);
 function tree(path:string):React.ReactNode{
  const listing=directories[path],failure=listingErrors[path];
  const retry=()=>{setListingErrors(previous=>{const next={...previous};delete next[path];return next;});setDirectories(previous=>{const next={...previous};delete next[path];return next;});if(treeVisible&&(!path||selected.startsWith(path+'/')))startReveal();};
  const failureView=failure&&<p className="empty-note" role="alert">{failure} <button className="quiet" onClick={retry} aria-label={`Reload ${path||'project root'}`}>Reload folder</button></p>;
  if(!listing)return failureView||<p className="empty-note">Loading folder…</p>;
  return <>{failureView}{listing.warning&&<p className="empty-note" role="status">{listing.warning}</p>}<ul>{listing.entries.map(entry=>{
   const statusFile=changes?.find(file=>file.path===entry.path&&file.section==='unstaged')??changes?.find(file=>file.path===entry.path),status=statusFile?gitStatus(statusFile):undefined;
   if(entry.kind==='directory')return <li key={entry.path} data-project-entry={entry.path}><details className="git-folder" open={expanded.has(entry.path)}><summary className={folderStatuses.has(entry.path)?`git-status-${folderStatuses.get(entry.path)!.kind}`:undefined} title={folderStatuses.get(entry.path)?.label} aria-label={folderStatuses.has(entry.path)?`${entry.name} · ${folderStatuses.get(entry.path)!.label}`:undefined} onClick={event=>{event.preventDefault();reveal.current=false;setRevealRun(undefined);setExpanded(previous=>{const next=new Set(previous);if(next.has(entry.path))next.delete(entry.path);else next.add(entry.path);return next;});}}><NavigationIcon kind="chevron" expanded={expanded.has(entry.path)}/><NavigationIcon kind="folder"/><span className="git-folder-name">{entry.name}</span></summary>{expanded.has(entry.path)&&tree(entry.path)}</details></li>;
   const label=`${entry.path} · ${entry.kind==='unavailable'?'Unavailable: symlink or special entry':status?.label??(changes?'Unchanged':'Git status unavailable')}`;
   return <li key={entry.path} data-project-entry={entry.path}><div className="git-file-row"><button type="button" ref={selected===entry.path?row:undefined} data-project-path={entry.path} className={`git-file${status?' git-status-'+status.kind:''}`} disabled={entry.kind==='unavailable'} aria-label={label} title={label} aria-current={selected===entry.path?'true':undefined} onClick={()=>select(entry.path)}><svg className="navigation-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><path d="M4 2h5l3 3v9H4Z M9 2v4h3"/></svg><span className="git-file-name">{entry.name}</span><span className="git-file-badge" aria-hidden="true">{entry.kind==='unavailable'?'!':statusFile?.status??''}</span></button>{entry.kind==='file'&&/\.md$/i.test(entry.path)&&<MarkdownPreviewButton file={{path:entry.path,section:'unstaged',status:''}} onClick={()=>select(entry.path,true)}/>}</div></li>;
  })}</ul>{!listing.entries.length&&<p className="empty-note">{listing.nextCursor?'No visible files on this page. Continue to load more.':'Empty folder'}</p>}{listing.nextCursor&&<button className="quiet" aria-label={`Load more in ${path||'project root'}`} disabled={!!pages[path]||!!failure} onClick={()=>{reveal.current=false;setRevealRun(undefined);setPages(previous=>({...previous,[path]:listing.nextCursor!}));}}>{pages[path]?'Loading…':'Load more files'}</button>}</>;
 }
 return <section className="git-view" aria-label="Project files" aria-busy={busy}>
  <div className="git-toolbar"><strong>Files</strong><label><input type="checkbox" checked={showIgnored} onChange={event=>setShowIgnored(event.target.checked)}/> Show ignored</label><button className="quiet" onClick={()=>{remember();setRefresh(v=>v+1);}} disabled={!sessionId}>Refresh</button></div>
  {gitMessage&&<p className="empty-note" role="status">{gitMessage}</p>}
  {!sessionId?<p className="empty-note">Choose a session to browse project files.</p>:<div className={`git-browser${narrow?' git-browser-narrow':''}`}>
   <aside ref={navigator} className="git-navigator">{narrow&&<button ref={toggle} className="git-navigator-toggle quiet" aria-expanded={open} aria-controls="project-file-navigation" onClick={()=>setOpen(value=>!value)}><NavigationIcon kind="chevron" expanded={open}/><span>Files</span><span className="git-selected-name">{selected}</span></button>}<nav id="project-file-navigation" className="git-file-tree" aria-label="Project files" hidden={narrow&&!open}>{revealMessage&&<p className="empty-note" role="status">{revealMessage}</p>}{tree('')}</nav></aside>
   <div className="git-document">{selected&&<div className="git-document-header"><div className="git-document-path" title={selected}>{selected}<span>Working file</span></div>{/\.md$/i.test(selected)&&!markdown&&<MarkdownPreviewButton file={{path:selected,section:'unstaged',status:''}} onClick={()=>{remember();setMarkdown(true);viewport.current?.focus({preventScroll:true});}}/>}</div>}
   {markdown&&<div className="git-preview-toolbar"><strong>Markdown preview</strong><button className="quiet" onClick={()=>{remember();setMarkdown(false);viewport.current?.focus({preventScroll:true});}}>Return to text</button></div>}
   <div ref={viewport} className="diff-viewport" tabIndex={0} aria-label={markdown?'Markdown preview':'File content'} onScroll={remember}>{error?<p className="empty-note" role="alert">{error}</p>:content&&content.path===selected?<FileContent document={content} markdown={markdown}/>:<p className="empty-note">{busy?'Loading file…':'Select a file to read or preview.'}</p>}</div></div>
  </div>}
 </section>;
}
