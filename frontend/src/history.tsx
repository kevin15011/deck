import {MessageCopy} from './message-copy';
import {RunnerMark} from './runner-mark';
import {useDisplayedReplies,DisplayedReply} from './lead-replies';
import React,{useEffect,useLayoutEffect,useRef,useState,type RefObject} from 'react';
import {gsap} from 'gsap';
import {request,load,save} from './api';
import {Markdown} from './markdown';
import {ImagePreview,type Preview} from './images';
import {Subagents} from './subagents';
import {captureTranscriptAnchor,restoreTranscriptAnchor,restoreTranscriptPosition,useTranscriptScroll,type TranscriptDirection} from './transcript-scroll';
import {NavigationIcon} from './navigation-icon';
import {SessionLoading} from './session-loading';
import {type HistoryEvent as Event} from './history-projection';
import {QuestionAnswerMessage,AutoApprovalMessage} from './history-decisions';
import {useActiveIndicator,useDisclosureMotion} from './view-motion';
interface Project {projectId:string;path:string;name:string;available:boolean;hidden?:boolean}
interface Summary {sessionId:string;title:string;members:Record<string,{runnerId:string;modelId:string;thinking?:string}>;issue?:string|null;removed?:boolean;released?:boolean;createdAt:string}
export interface HistorySelection {project:string;session:string}

interface Page {targetSeq?:number;adopted?:boolean;metadata:Record<string,unknown>;summary:Summary;snapshot:string;boundary:number;messages:Event[];before?:number|null;after?:number|null;tasks:string[];issue:string|null}
interface Sessions {sessions:Summary[];nextCursor?:string|null;error?:string}
const enc=encodeURIComponent;
const replyApi=(path:string,init?:RequestInit)=>request(init?.method??'GET',path,init?.body?JSON.parse(String(init.body)):undefined,init?.signal??undefined);
async function initialHistoryPage(session:string,signal:AbortSignal,task='',attempt?:number,snapshot?:string,skipTarget=false):Promise<Page>{
 const base=`/api/history/sessions/${encodeURIComponent(session)}`;
 let page=await request('GET',base+`?limit=40${task?'&taskId='+encodeURIComponent(task):''}${attempt!==undefined?'&attempt='+attempt:''}${snapshot?'&snapshot='+encodeURIComponent(snapshot):''}`,undefined,signal) as Page;
 const target=new URL(location.href).searchParams.get('reply');
 if(!task&&!skipTarget&&target&&/^reply-[1-9][0-9]*-[1-9][0-9]*$/.test(target)&&target.length<=48){try{
  const data=await request('GET',`/api/sessions/${encodeURIComponent(session)}/replies/${encodeURIComponent(target)}`,undefined,signal) as {reply:{messageSeq:number;sessionId:string}};
  const seq=data.reply.messageSeq;
  if(data.reply.sessionId===session&&Number.isSafeInteger(seq)&&seq>0&&seq<=page.boundary){
   if(!page.messages.some(m=>m.seq===seq))page=await request('GET',base+`?snapshot=${encodeURIComponent(page.snapshot)}&before=${seq+1}&limit=40`,undefined,signal) as Page;
   page.targetSeq=seq;
  }
 }catch{/* Missing/retired reply never replaces the current history with a guess. */}}
 return page;
}
const historyKey=(e:Event)=>String(e.historyId??e.seq);

function usePagedTranscript({session,task,attempt,snapshot,replyTarget,revision,viewport,content,embedded,onBrowse,onHistoryTarget,visible=true,jump=0}:{
 session:string;task:string;attempt?:number;snapshot?:string;replyTarget:string;revision:number;jump?:number;
 viewport:RefObject<HTMLElement|null>;content:RefObject<HTMLElement|null>;embedded?:boolean;onBrowse?:()=>void;onHistoryTarget?:()=>void;visible?:boolean;
}){
 const [page,setPage]=useState<Page>(),[error,setError]=useState(''),[busy,setBusy]=useState(true);
 const [failedDirection,setFailedDirection]=useState<TranscriptDirection>();
 const controller=useRef<AbortController|undefined>(undefined);
 const pending=useRef(true);
 const positioned=useRef(false);
 const anchor=useRef<ReturnType<typeof captureTranscriptAnchor>>(undefined);
 const jumped=useRef(jump),pendingJump=useRef(false);
 useEffect(()=>{
  const c=new AbortController();
  const toLatest=jump!==jumped.current&&!!embedded;
  jumped.current=jump;pendingJump.current=toLatest;
  controller.current=c;positioned.current=false;pending.current=true;anchor.current=undefined;
  // A jump keeps the current rows until the newest page replaces them in one commit.
  if(!toLatest)setPage(undefined);
  setError('');setFailedDirection(undefined);setBusy(true);
  void initialHistoryPage(session,c.signal,task,attempt,snapshot,toLatest).then(value=>{
   if(!c.signal.aborted){setPage(value);setBusy(false);}
  }).catch(err=>{
   if(!c.signal.aborted){pending.current=false;setError(String(err));setBusy(false);}
  });
  return()=>c.abort();
 },[session,task,attempt,snapshot,replyTarget,revision,jump]);

 async function more(direction:TranscriptDirection){
  const signal=controller.current?.signal;
  const newer=direction==='newer';
  const cursor=newer?page?.after:page?.before;
  if(!page||!cursor||pending.current||!signal||signal.aborted)return;
  onBrowse?.();pending.current=true;setBusy(true);
  try{
   const query=new URLSearchParams({snapshot:page.snapshot,[newer?'after':'before']:String(cursor),limit:'40'});
   if(task)query.set('taskId',task);
   if(attempt!==undefined)query.set('attempt',String(attempt));
   const next=await request('GET',`/api/history/sessions/${enc(session)}?${query}`,undefined,signal) as Page;
   if(signal.aborted)return;
   const messages=newer?[...page.messages,...next.messages]:[...next.messages,...page.messages];
   const trimmed=messages.length>120,retained=newer?messages.slice(-120):messages.slice(0,120);
   const node=viewport.current,root=content.current;
   if(node&&root){
    const reading=captureTranscriptAnchor(node,root,new Set(page.messages.map(historyKey)));
    const evicted=trimmed&&captureTranscriptAnchor(node,root,new Set(
     (newer?messages.slice(0,-120):messages.slice(120)).map(historyKey)));
    const inLive=embedded&&!reading&&root.getBoundingClientRect().bottom<node.getBoundingClientRect().top;
    // The reader may have reversed direction while the request was in flight.
    if(evicted||inLive){pending.current=false;setBusy(false);return;}
    anchor.current=reading;
   }
   setFailedDirection(undefined);setError('');
   setPage({...next,messages:retained,
    before:newer?(trimmed?retained[0]?.historyId:page.before):next.before,
    after:newer?next.after:(trimmed?retained.at(-1)?.historyId:page.after)});
   setBusy(false);
  }catch(err){
   if(!signal.aborted){pending.current=false;setError(String(err));setFailedDirection(direction);setBusy(false);}
  }
 }

 useTranscriptScroll(viewport,(direction,node,threshold)=>{
  const root=content.current;
  if(!visible||!root?.getClientRects().length||pending.current||error||!(direction==='older'?page?.before:page?.after))return false;
  const distance=direction==='older'?node.scrollTop:node.scrollHeight-node.scrollTop-node.clientHeight;
  if(distance>threshold)return false;
  void more(direction);
  return true;
 });
 useLayoutEffect(()=>{
  if(!page)return;
  pending.current=false;
  const node=viewport.current,root=content.current;
  if(!visible||!node?.clientHeight||!root)return;
  if(!positioned.current){
   positioned.current=true;
   const target=page.targetSeq?root.querySelector<HTMLElement>(`[data-history-seq="${page.targetSeq}"]`):null;
   if(target){
    onBrowse?.();onHistoryTarget?.();
    restoreTranscriptPosition(node,node.scrollTop+target.getBoundingClientRect().top-node.getBoundingClientRect().top-(node.clientHeight-target.offsetHeight)/2);
   }else if(!embedded)restoreTranscriptPosition(node,node.scrollHeight);
   else if(pendingJump.current){pendingJump.current=false;restoreTranscriptPosition(node,node.scrollHeight-node.clientHeight);}
  }else restoreTranscriptAnchor(node,root,anchor.current);
  anchor.current=undefined;
 },[page,visible]);
 return {page,busy,error,setError,failedDirection,retryPage:()=>{if(failedDirection)void more(failedDirection);}};
}

export function useOriginalHistory(connected:boolean,onError:(s:string)=>void){
 const [adopted,setAdopted]=useState(false),[sourceId,setSourceId]=useState('');
 const [projects,setProjects]=useState<Project[]>([]),[issues,setIssues]=useState<string[]>([]),[expanded,setExpanded]=useState<string[]>([]),[pages,setPages]=useState<Record<string,Sessions>>({}),[busy,setBusy]=useState('');
 const [selection,setSelection]=useState<HistorySelection>();
 const source=useRef('');
 const epoch=useRef(0),pageRef=useRef(pages);pageRef.current=pages;
 useEffect(()=>{if(!connected)return;const c=new AbortController();void request('GET','/api/history/projects',undefined,c.signal).then(v=>{if(c.signal.aborted)return;const value=v as {source?:string;adopted?:boolean;adoptionIssue?:string;projects:Project[];issues:{message:string}[]};source.current=value.source||'';setSourceId(source.current);setAdopted(value.adopted===true);let retained:HistorySelection|undefined;try{const v=JSON.parse(load('original-history-selection.'+source.current)||'null');if(v&&typeof v.project==='string'&&typeof v.session==='string'&&value.projects.some(p=>p.projectId===v.project))retained=v;}catch{}setSelection(retained);setProjects(value.projects);setIssues(value.issues.map(i=>i.message));setExpanded(old=>old.length?old:[retained?.project||value.projects.find(p=>!p.hidden)?.projectId||'']);}).catch(e=>{if(!c.signal.aborted)onError(String(e));});return()=>c.abort();},[connected]);
 async function sessions(id:string,more=false){const generation=++epoch.current;setBusy(id);try{const old=pageRef.current[id],p=await request('GET',`/api/history/projects/${enc(id)}/sessions?limit=30${more&&old?.nextCursor?'&cursor='+enc(old.nextCursor):''}`) as Sessions;if(generation!==epoch.current)return;setPages(v=>({...v,[id]:{...p,sessions:more?[...(v[id]?.sessions??[]),...p.sessions]:p.sessions}}));}catch(e){if(generation===epoch.current){onError(String(e));setPages(v=>({...v,[id]:{sessions:v[id]?.sessions??[],error:String(e)}}));}}finally{if(generation===epoch.current)setBusy('');}}
 useEffect(()=>{const id=expanded.find(id=>id&&!pages[id]);if(id&&connected&&!busy)void sessions(id);},[expanded,pages,connected,busy]);
 function select(value:HistorySelection|undefined){setSelection(value);if(source.current)save('original-history-selection.'+source.current,value?JSON.stringify(value):'');}
 function rename(project:string,id:string,title:string){setPages(v=>{let changed=false;const next=Object.fromEntries(Object.entries(v).map(([key,page])=>[key,{...page,sessions:page.sessions.map(s=>{if(key!==project||s.sessionId!==id||s.title===title)return s;changed=true;return {...s,title};})}]));return changed?next:v;});}
 return {source:sourceId,adopted,projects,issues,expanded,pages,busy,selection,select,sessions,rename,toggle:(id:string)=>setExpanded(v=>v.includes(id)?v.filter(p=>p!==id):[...v,id])};
}
export function OriginalProjects({history,onSelect,currentPath,selected,children,onNew,canCreate}:{history:ReturnType<typeof useOriginalHistory>;onSelect:(value:HistorySelection)=>void;currentPath?:string;selected?:string;children?:(projectId:string)=>React.ReactNode;onNew:(projectId:string)=>void;canCreate:(projectId:string)=>boolean}){
 return <>{history.projects.filter(p=>!p.hidden||history.selection?.project===p.projectId||p.path===currentPath).map(p=><OriginalProject key={p.projectId} p={p} history={history} onSelect={onSelect} selected={selected} onNew={onNew} canCreate={canCreate}>{children?.(p.projectId)}</OriginalProject>)}{history.issues.map((s,i)=><li className="activity-meta" key={i} role="status">{s}</li>)}</>;
}
function OriginalProject({p,history:h,onSelect,selected,children,onNew,canCreate}:{p:Project;history:ReturnType<typeof useOriginalHistory>;onSelect:(v:HistorySelection)=>void;selected?:string;children?:React.ReactNode;onNew:(projectId:string)=>void;canCreate:(projectId:string)=>boolean}){
 const open=h.expanded.includes(p.projectId),ref=useRef<HTMLDivElement>(null),body=useRef<HTMLDivElement>(null),page=h.pages[p.projectId];useDisclosureMotion(body,open);useActiveIndicator(ref,h.selection?.session??selected,'[aria-current="page"]',!!page);
 return <li className="project-group"><div className="project-row"><button className="project-toggle quiet" aria-expanded={open} onClick={()=>h.toggle(p.projectId)}><NavigationIcon kind="chevron" expanded={open}/><span className="project-name"><strong>{p.name}</strong><small>{p.available?p.path:'Unavailable · '+p.path}</small></span></button><button type="button" className="quiet project-new" aria-label={"New conversation in "+p.name} title="New conversation" disabled={!canCreate(p.projectId)} onClick={()=>onNew(p.projectId)}><NavigationIcon kind="plus"/></button></div><div ref={body} hidden={!open} inert={!open}><div ref={ref} className="project-sessions">{page?.sessions.filter(s=>!s.removed).map(s=><button key={s.sessionId} className={'session quiet'+((h.selection?.session??selected)===s.sessionId?' selected':'')} aria-current={(h.selection?.session??selected)===s.sessionId?'page':undefined} onClick={()=>onSelect({project:p.projectId,session:s.sessionId})}><span className="session-label"><strong>{s.title}</strong><small>{s.members?.lead?.runnerId||'Original binding'} · {h.adopted?'Saved history':'Historical'}{ s.issue?' · Check history':''}</small></span></button>)}</div>{children}{h.busy===p.projectId&&<p className="activity-meta" role="status">Loading history…</p>}{page?.error&&<button className="quiet" disabled={!!h.busy} onClick={()=>void h.sessions(p.projectId)}>Retry conversations</button>}{page?.nextCursor&&<button className="quiet" disabled={!!h.busy} onClick={()=>void h.sessions(p.projectId,true)}>More conversations</button>}</div></li>;
}
export function OriginalConversation({selection,name,navigationOpener,navigationOpen,continuationIssue,attentionBubbles}:{selection:HistorySelection;name?:string;navigationOpener:React.ReactNode;navigationOpen:boolean;continuationIssue?:string;attentionBubbles?:React.ReactNode}){
 const [preview,setPreview]=useState<Preview>(),[retry,setRetry]=useState(0),[task,setTask]=useState(''),[tasks,setTasks]=useState<string[]>([]);
 const [panel,setPanel]=useState('conversation');
 const panelTabs=useRef<HTMLDivElement>(null);useActiveIndicator(panelTabs,panel,'[aria-selected="true"]');
 const replyTarget=new URL(location.href).searchParams.get('reply')||'';
 const ref=useRef<HTMLDivElement>(null),viewport=useRef<HTMLElement>(null),content=useRef<HTMLDivElement>(null);
 const {page,busy,error,setError,failedDirection,retryPage}=usePagedTranscript({session:selection.session,task,replyTarget,revision:retry,viewport,content,visible:panel==='conversation'});
 const rows=page?.messages??[];
 const displayReplies=useDisplayedReplies(replyApi,!navigationOpen&&panel==='conversation',selection.session,rows.filter(e=>e.data.role==='assistant').map(e=>e.seq),page?.boundary??0);
 useEffect(()=>{if(page)setTasks(page.tasks);},[page]);
 useEffect(()=>{setPreview(undefined);},[selection.session,task,retry,replyTarget]);
 useLayoutEffect(()=>{const node=ref.current;if(!node)return;gsap.killTweensOf(node);if(!matchMedia('(prefers-reduced-motion: reduce)').matches)gsap.fromTo(node,{opacity:node.style.opacity||.65},{opacity:1,duration:.18,ease:'power2.out',clearProps:'opacity'});return()=>{gsap.killTweensOf(node);};},[selection.session,retry,task,replyTarget,panel]);
 return <div className="app-body history-view" ref={ref}><header className="app-header">{navigationOpener}<div className="session-identity"><div className="session-identity-text"><h1>{name||page?.summary.title||'Original session history'}</h1><p className="lead-identity">{page?.summary.members?.lead?.runnerId||'Original binding'} <span>{page?.summary.members?.lead?.modelId}</span>{page?.summary.members?.lead?.thinking&&<small className="lead-reasoning">· {page.summary.members.lead.thinking}</small>}</p></div></div><div className="connection" role="status">Historical access</div></header>{attentionBubbles}<div ref={panelTabs} className="workspace-tabs" role="tablist" aria-label="Session workspace">{['conversation','subagents'].map(p=><button key={p} type="button" role="tab" id={"original-tab-"+p} aria-controls={"original-panel-"+p} tabIndex={panel===p?0:-1} aria-selected={panel===p} onKeyDown={e=>{if(["ArrowLeft","ArrowRight","Home","End"].includes(e.key)){e.preventDefault();const next=e.key==="Home"?"conversation":e.key==="End"?"subagents":p==="conversation"?"subagents":"conversation";setPanel(next);panelTabs.current?.querySelector<HTMLButtonElement>("#original-tab-"+next)?.focus();}}} onClick={()=>setPanel(p)}>{p==='conversation'?'Conversation':'Subagents'}</button>)}</div><main id="original-panel-conversation" role="tabpanel" aria-labelledby="original-tab-conversation" hidden={panel!=='conversation'} className="chat-pane history-opening-pane">{busy&&!page&&!error&&<SessionLoading name={name||selection.session} onRetry={()=>setRetry(v=>v+1)}/>}<p className="activity-meta">{continuationIssue||(page?.adopted?'History preserved in SQLite. Continuation is unavailable for this binding or project in this host.':'Original session history. Execution and changes remain with its original host.')}</p>{error&&<div className="error" role="alert">{error}<button className="quiet" onClick={failedDirection?retryPage:()=>setRetry(v=>v+1)}>{failedDirection?'Retry history':'Reopen history'}</button></div>}{page?.issue&&<p className="activity-meta" role="status">{page.issue}</p>}{tasks.some(t=>t!=='lead')&&<label className="activity-meta">Conversation <select aria-label="Conversation" value={task} onChange={e=>setTask(e.target.value)}><option value="">Lead</option>{tasks.filter(t=>t!=='lead').map(t=><option key={t} value={t}>{t}</option>)}</select></label>}<section ref={viewport} id="conversation" className="conversation" tabIndex={0} aria-label="Recorded messages"><div ref={content} className="history-content" aria-busy={busy}>{page&&rows.map(e=><div key={historyKey(e)} data-timeline-key={historyKey(e)}><HistoricalEvent displayReplies={displayReplies} e={e} session={selection.session} snapshot={page.snapshot} onPreview={setPreview}/></div>)}</div></section></main><section id="original-panel-subagents" role="tabpanel" aria-labelledby="original-tab-subagents" hidden={panel!=='subagents'} className="workspace-panel"><Subagents key={selection.project+selection.session} session={selection.session} tasks={[]} decisions={[]} historySession visible={panel==='subagents'&&!navigationOpen} connected={false} onError={setError}/></section><ImagePreview image={preview} onClose={()=>setPreview(undefined)}/></div>;
}
function HistoricalEvent({displayReplies,e,session,snapshot,onPreview}:{displayReplies:ReturnType<typeof useDisplayedReplies>;e:Event;session:string;snapshot:string;onPreview:(v:Preview)=>void}){
 const replyRoot=useRef<HTMLElement|null>(null),holder=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{replyRoot.current=holder.current?.closest<HTMLElement>('.conversation')??null;});
 const d=e.data,member=e.source.memberId||'lead',who=d.role==='user'?'You':member==='lead'?'Lead':String(member),text=typeof d.text==='string'?d.text:typeof d.delta==='string'?d.delta:'';
 const recordedRunner=typeof e.source.runnerId==='string'?e.source.runnerId.trim():'';
 const image=(a:Record<string,unknown>)=>`/api/history/sessions/${enc(session)}/images/${enc(String(a.attachmentId))}?snapshot=${enc(snapshot)}`;
 if(e.kind==='question.resolved')return <QuestionAnswerMessage e={e}/>;
 if(e.kind==='approval.resolved')return <AutoApprovalMessage e={e}/>;
 if(e.kind==='turn.completed')return <article className="message failed-message" role="alert"><p className="message-meta">Turn failed</p><p>{String(d.error||'The runner could not complete this turn. Try again.')}</p></article>;
 if(e.kind==='message.completed'||e.kind==='message.delta'||e.kind==='reasoning.delta')return <article className={'message '+(d.role==='user'?'user user-message':'lead assistant-message')}><div className="message-meta"><strong className="message-author">{who==='Lead'&&recordedRunner&&<RunnerMark runner={recordedRunner}/>}<span>{who}</span></strong><span>{recordedRunner}</span><time dateTime={e.ts}>{new Date(e.ts).toLocaleString()}</time><small>#{e.seq}{e.kind!=='message.completed'?' · '+e.kind:''}</small><MessageCopy text={text}/></div><div ref={holder} data-history-seq={e.seq}><DisplayedReply reply={displayReplies.visibleReplies.find(r=>r.displayMessageSeq===e.seq)} visible root={replyRoot} onDisplayed={displayReplies.displayed}><Markdown text={text}/></DisplayedReply></div>{d.role==='user'&&d.steering===true&&d.historical===true&&<p className="decision-note" role="status">Accepted by {String(d.steeringRunnerId||'the runner')} for its original turn.</p>}{d.role==='user'&&(d.decisionReply as {stale?:boolean}|undefined)?.stale&&<p className="decision-note" role="status">Reply to a changed or closed question. The text was delivered for clarification.</p>}<div className="image-references">{Array.isArray(d.attachments)&&d.attachments.map((v,i)=>{if(!v||typeof v!=='object')return null;const a=v as Record<string,unknown>;return typeof a.attachmentId==='string'?<button key={i} className="quiet image-reference" aria-label={'View '+String(a.name)} onClick={()=>onPreview({src:image(a),name:String(a.name)})}><img src={image(a)} alt="" width="56" height="56" loading="lazy"/>{String(a.name)}</button>:null;})}</div></article>;
 return null;
}

// Render adopted history above the normal composer and current Rust receipts.
// Paging remains independent from workspace updates; old raw events never enter it.
export function OriginalMessages({session,task='',attempt,snapshot,visible=true,name,onReady,onBrowse,onHistoryTarget,viewport,jumpToken=0,onGap}:{
 viewport?:RefObject<HTMLElement|null>;onBrowse?:()=>void;onHistoryTarget?:()=>void;jumpToken?:number;onGap?:(gap:boolean)=>void;
 session:string;task?:string;attempt?:number;snapshot?:string;visible?:boolean;
 name?:string;onReady?:(ready:boolean)=>void;
}) {
 const replyTarget=new URL(location.href).searchParams.get('reply')||'';
 const [preview,setPreview]=useState<Preview>(),[retry,setRetry]=useState(0);
 const ownViewport=useRef<HTMLDivElement>(null),content=useRef<HTMLDivElement>(null);
 const {page,busy,error,failedDirection,retryPage}=usePagedTranscript({session,task,attempt,snapshot,replyTarget,revision:retry,
  viewport:viewport??ownViewport,content,embedded:!!viewport,onBrowse,onHistoryTarget,visible,jump:jumpToken});
 const gap=useRef(onGap);gap.current=onGap;
 useLayoutEffect(()=>{gap.current?.(!!page?.after);},[page?.after]);
 useLayoutEffect(()=>()=>gap.current?.(false),[session]);
 const displayReplies=useDisplayedReplies(replyApi,visible&&!task,session,(page?.messages??[]).filter(e=>e.data.role==='assistant').map(e=>e.seq),page?.boundary??0);
 const ready=useRef(onReady);ready.current=onReady;
 useLayoutEffect(()=>{ready.current?.(false);return()=>ready.current?.(false);},[session]);
 useLayoutEffect(()=>{if(page||error)ready.current?.(true);},[page,error]);

 return <div ref={ownViewport} data-adopted-history={viewport?true:undefined} data-history-gap={viewport&&page?.after?true:undefined} data-history-focus={viewport&&page?.targetSeq?true:undefined} className={task?"history-content task-transcript task-transcript--full progressive-transcript":"history-content"} tabIndex={task?0:undefined} role={task?"log":undefined} aria-label={task?"Recorded subagent conversation":undefined}>
  {error&&<p className="error" role="alert">{error}<button className="quiet" onClick={failedDirection?retryPage:()=>setRetry(value=>value+1)}>{failedDirection?'Retry history':'Reopen history'}</button></p>}
  <div ref={content} aria-busy={busy}>{page?.messages.map(e=><div key={historyKey(e)} data-timeline-key={historyKey(e)}><HistoricalEvent displayReplies={displayReplies} e={e} session={session} snapshot={page.snapshot} onPreview={setPreview}/></div>)}</div>
  {busy&&!page&&!task&&!error&&<SessionLoading name={name||session} onRetry={()=>setRetry(value=>value+1)}/>}
  <ImagePreview image={preview} onClose={()=>setPreview(undefined)}/>
 </div>;
}
