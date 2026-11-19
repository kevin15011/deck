import {TranscriptWindow} from './transcript-window';
import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {request} from './api';
import {readPreference,savePreference} from './preferences';
import {gsap} from 'gsap';
import {useDisclosureMotion} from './view-motion';
import './git-changes.css';
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
 return <><table className={`diff-table diff-${mode}`} aria-label={mode==='split'?'Side-by-side diff':'Inline diff'}><thead><tr>{mode==='split'?<><th colSpan={2}>Old</th><th colSpan={2}>New</th></>:<><th>Old</th><th>New</th><th>Change</th></>}</tr></thead><tbody>{mode==='split'?split:rows.map((row,i)=><tr key={i}>{row.kind==='hunk'||row.kind==='note'?<td colSpan={3} className={`diff-${row.kind}`}>{row.text}</td>:<><td className="diff-number">{row.old}</td><td className="diff-number">{row.next}</td><td className={`diff-code ${row.kind}`}><span className="diff-sign" aria-hidden="true">{row.kind==='add'?'+':row.kind==='remove'?'-':' '}</span>{row.text}</td></>}</tr>)}</tbody></table></>;
}

type Entry={id:string;section:'staged'|'unstaged'|'untracked';path:string;status:string;message:string};
type Catalog={revision:string;captured_ms:number;files:Entry[];note:string};
type Document={revision:string;file:Entry;kind:'text'|'binary'|'unavailable';patch:string;message:string};
const sections={staged:'Staged · HEAD → index',unstaged:'Unstaged · index → worktree',untracked:'Untracked · new files'};
function catalog(value:unknown):Catalog{
 const v=value as Catalog;
 if(!v||typeof v.revision!=='string'||!Number.isSafeInteger(v.captured_ms)||typeof v.note!=='string'||!Array.isArray(v.files)||v.files.length>256||v.files.some(f=>!f||typeof f.id!=='string'||!Object.hasOwn(sections,f.section)||typeof f.path!=='string'||typeof f.status!=='string'||typeof f.message!=='string'))throw new Error('Invalid Git catalog; refresh with a compatible host.');
 return v;
}
/** The header count and inspector share one validated snapshot, including explicit refresh. */
export function useGitCatalog(session:string,enabled:boolean){
 const [state,setState]=useState<{session:string;files?:Catalog;error:string;loading:boolean}>({session,error:'',loading:false});
 const [revision,refresh]=useState(0);
 useEffect(()=>{
  if(!enabled||!session)return;
  let stopped=false,timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
  const update=async()=>{
   setState(old=>({...old,loading:true}));
   try{const files=catalog(await request('GET',`/api/sessions/${encodeURIComponent(session)}/git`,undefined,controller.signal));if(!stopped)setState({session,files,error:'',loading:false});}
   catch(e){if(!stopped)setState({session,error:String(e),loading:false});}
   if(!stopped)timer=setTimeout(update,10000);
  };
  void update();return()=>{stopped=true;controller.abort();clearTimeout(timer);};
 },[session,enabled,revision]);
 return {...(state.session===session?state:{error:'',loading:enabled,files:undefined}),refresh:()=>refresh(v=>v+1)};
}
export function GitChanges({session,visible,narrow,storageScope,catalog:source}:{session:string;visible:boolean;narrow:boolean;storageScope:string;catalog:ReturnType<typeof useGitCatalog>}){
 const {files,loading}=source;
 const [selected,setSelected]=useState(()=>readPreference(storageScope+'.git-selected')),[doc,setDoc]=useState<Document>(),[error,setError]=useState(''),[mode,setMode]=useState<'inline'|'split'>(()=>readPreference(storageScope+'.git-layout')==='split'?'split':'inline');
 const [limitsOpen,setLimitsOpen]=useState(false),limits=useRef<HTMLDivElement>(null);useDisclosureMotion(limits,limitsOpen);
 const navigator=useRef<HTMLElement>(null);
 const selectedRef=useRef(''),pane=useRef<HTMLDivElement>(null);selectedRef.current=selected;
 useLayoutEffect(()=>{const el=pane.current;if(!el||!visible||!el.getClientRects().length)return;const media=matchMedia('(prefers-reduced-motion: reduce)');const settle=()=>{gsap.killTweensOf(el);gsap.set(el,{clearProps:'opacity'});};if(media.matches)settle();else{if(!el.style.opacity)gsap.set(el,{opacity:.65});gsap.to(el,{opacity:1,duration:.18,ease:'power2.out',overwrite:true,clearProps:'opacity'});}const change=()=>{if(media.matches)settle();};media.addEventListener('change',change);return()=>{media.removeEventListener('change',change);gsap.killTweensOf(el);};},[selected,doc?.revision,doc?.file.id,mode,narrow,visible]);
 useEffect(()=>savePreference(storageScope+'.git-selected',selected),[storageScope,selected]);
 useEffect(()=>savePreference(storageScope+'.git-layout',mode),[storageScope,mode]);
 const endpoint=`/api/sessions/${encodeURIComponent(session)}/git`;
 useEffect(()=>{setSelected(old=>files?.files.some(f=>f.id===old)?old:files?.files.at(-1)?.id||'');setDoc(undefined);setError('');},[files]);
 useEffect(()=>{
  if(!visible||!files||!selected||loading)return;
  let stopped=false;const controller=new AbortController();setDoc(undefined);setError('');
  void request('GET',`${endpoint}/${encodeURIComponent(files.revision)}/${encodeURIComponent(selected)}`,undefined,controller.signal).then(value=>{
   if(stopped)return;const next=value as Document;
   if(next?.revision!==files.revision||next.file?.id!==selected||!['text','binary','unavailable'].includes(next.kind)||typeof next.patch!=='string'||next.patch.length>524288||typeof next.message!=='string')throw new Error('Git comparison identity differs; refresh to retry.');
   setDoc(next);
  }).catch(e=>{if(!stopped)setError(String(e));});
  return()=>{stopped=true;controller.abort();};
 },[endpoint,visible,files,selected,loading]);
 const file=files?.files.find(f=>f.id===selected);
 return <div className="git-view"><div className="git-toolbar"><strong>Review · Changes</strong><div role="group" aria-label="Diff layout"><button className="quiet" aria-pressed={narrow||mode==='inline'} onClick={()=>setMode('inline')}>Inline</button><button className="quiet" hidden={narrow} aria-pressed={!narrow&&mode==='split'} onClick={()=>setMode('split')}>Side by side</button></div><button className="quiet review-refresh" disabled={loading||!visible} onClick={source.refresh}>Refresh</button></div>
 <p className="git-status" role="status">{loading?'Reading working tree…':files?`Live Git snapshot · ${new Date(files.captured_ms).toLocaleTimeString()} · ${files.files.length} entries`:'Working-tree review unavailable'}</p>
 {(error||source.error)&&<p role="alert" className="git-error">{error||source.error}</p>}
 <div className={'git-browser'+(narrow?' git-browser-narrow':'')} aria-busy={loading}>
 <nav ref={navigator} className="git-navigator" aria-label="Changed files"><TranscriptWindow rows={(files?.files??[]).map(f=>({...f,key:f.id}))} viewport={navigator} limit={200} onBrowse={()=>{}} olderLabel="Load older files" newerLabel="Load newer files">{f=><button className="quiet git-file" aria-current={f.id===selected?'true':undefined} title={f.path} onClick={()=>setSelected(f.id)}><span>{f.path}</span><small>{f.section} · {f.status==='A'?'Added':f.status==='D'?'Deleted':f.status==='M'?'Modified':'Unavailable'}</small></button>}</TranscriptWindow></nav>
 <div className="git-document" ref={pane}><div className="git-document-path">{file?.path||'Select a changed file'}{file&&<small>{sections[file.section]}</small>}</div><div className="diff-viewport" tabIndex={0} aria-label="Working-tree diff">{!loading&&!error&&files&&!files.files.length&&<p className="git-status">No changes in this snapshot.</p>}{file&&!doc&&!error&&<p className="git-status">Loading comparison…</p>}{!loading&&doc&&<>{doc.message&&<p className="git-status">{doc.message}</p>}{doc.kind==='text'&&<DiffContent patch={doc.patch} mode={narrow?'inline':mode}/>}</>}</div></div></div>
 {files&&<div className="git-limits"><button className="quiet" aria-expanded={limitsOpen} aria-controls="git-limits-content" onClick={()=>setLimitsOpen(v=>!v)}>Snapshot semantics and support limits</button><div ref={limits} id="git-limits-content" hidden={!limitsOpen}><p>{files.note}</p><p>Refresh explicitly after edits. This view never stages or writes project files. Historical edit comparisons remain attached to their recorded execution.</p></div></div>}</div>;
}
