import {TranscriptWindow} from './transcript-window';
import React,{memo,useEffect,useLayoutEffect,useRef,useState} from 'react';
import {request,API,HttpError,type Task,type TaskAttempt,type Decision} from './api';
import {exchangePage,type ExchangeMessage} from './exchanges';
import {OriginalMessages} from './history';
import {useOriginalTasks,mergeTasks,type DisplayTask,type DisplayAttempt} from './original-tasks';
import {Markdown} from './markdown';
import {ContextWindowIndicator,contextReading} from './context-window';
import {useActiveIndicator} from './view-motion';
import {gsap} from 'gsap';
import {redactText} from './redaction';
import {StatusIndicator,VisibleReply,indicatorState} from './status-indicator';
const labels:Record<string,string>={lead:'Lead',investigate:'Investigate','apply-fast':'Apply Fast','apply-deep':'Apply Deep',architect:'Architect',quality:'Quality',setup:'Setup'};
const label=(owner:string)=>labels[owner]??owner;
function Avatar({owner,size=40}:{owner:string;size?:number}){return labels[owner]&&owner!=='setup'?<img className="agent-avatar" src={`/avatars/${owner}.png`} width={size} height={size} alt=""/>:<span aria-hidden="true" className="agent-avatar agent-avatar--fallback">{owner[0]}</span>;}
export const replyKey=(session:string,task:string,a:DisplayAttempt)=>JSON.stringify([session,a.original?.displayId??task,a.id,a.report?.digest??'']);
function read(key:string){try{return localStorage.getItem('deck2.reply.'+key)==='true';}catch{return false;}}
function Result({task,a,visible,preview,ack}:{task:DisplayTask;a:DisplayAttempt;visible:boolean;preview?:boolean;ack:(key:string)=>void}){
 const key=replyKey(task.session,task.executionId??task.id,a);
 if(!a.report)return null;
 return <VisibleReply visible={visible} replyKey={key} seq={1} acknowledge={key=>ack(key)} className={'task-result'+(preview?' task-result--preview':'')}>{!preview&&<h4>Result</h4>}<Markdown text={a.report.text}/>{!preview&&a.treatments.map((t,i)=><p className="muted" key={i}>Lead: {t.disposition.replaceAll('_',' ')} · {t.reason}</p>)}</VisibleReply>;
}

function Heading({task,a,index,unread,open,decisions=[]}:{task:DisplayTask;a:DisplayAttempt;index:number;unread:boolean;open?:()=>void;decisions?:Decision[]}){
 const pending=decisions.filter(d=>d.task===(task.executionId??task.id)&&d.attempt===a.id&&d.state==='pending');
 return <div className={'task-heading'+(a.original?' task-heading--recorded':'')}><Avatar owner={task.owner} size={open?32:40}/><div className="task-identity"><h3>{label(task.owner)}</h3></div><StatusIndicator recorded={!!a.original} state={a.phase} unread={unread} approvals={pending.filter(d=>!d.questions.length).length} questions={pending.filter(d=>d.questions.length).length}/>{open&&<button type="button" className="quiet open-detail" aria-label="Open full view" title={`Open ${label(task.owner)} task`} onClick={open}>Open<svg className="navigation-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.5 2.5h4v4M13.5 2.5 8.5 7.5M6.5 3.5h-3v9h9v-3"/></svg></button>}
 <p className="task-assignment">{a.prompt?redactText(a.prompt,4096):a.original?'Recorded task · open to inspect its conversation':'Task description unavailable'}</p>
 <div className="task-metadata"><span className="runner">{a.provenance.runner||(a.original?'Runner unavailable':'Runner pending')} · {a.observed_model||a.requested_model||(a.original?'Model unavailable':'Model pending')}</span><span>Attempt {a.original?(a.recordedNumber??'unavailable'):(a.number||index+1)}</span>{a.original&&<span>Recorded history</span>}{a.failure_dismissal&&<span>Failure handled</span>}</div>
 {!a.original&&<ContextWindowIndicator owner={label(task.owner)} resetKey={`${task.session}:${task.id}:${index+1}`} observation={contextReading(a.context,a.id,a.native_session,a.native_message)}/>}</div>;
}
function TaskProgress({task,a,visible}:{task:DisplayTask;a:DisplayAttempt;visible:boolean}){
 const [text,setText]=useState(''),current=useRef(visible);current.current=visible;
 useEffect(()=>{if(a.original||!['queued','accepted','preparing','dispatching','running','cancelling'].includes(a.phase))return;
  let stopped=false,cursor=0,timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
  const poll=async()=>{if(stopped)return;if(!current.current){timer=setTimeout(poll,1000);return;}
   try{const page=exchangePage(await request('GET',`/api/sessions/${encodeURIComponent(task.session)}/tasks/${encodeURIComponent(task.executionId??task.id)}/attempts/${encodeURIComponent(a.id)}/exchanges?cursor=${cursor}&limit=32`,undefined,controller.signal),{session:task.session,task:task.executionId??task.id,attempt:a.id},cursor);
    if(stopped)return;cursor=page.nextCursor;const latest=page.messages.filter(m=>m.role===task.owner&&m.text.trim()).at(-1);if(latest)setText(latest.text);
    timer=setTimeout(poll,page.more?0:1500);
   }catch{if(!stopped)timer=setTimeout(poll,3000);}
  };void poll();return()=>{stopped=true;controller.abort();clearTimeout(timer);};
 },[task.session,task.id,task.executionId,a.id,a.phase,task.owner,!!a.original]);
 const preview=text||(['failed','uncertain','cancelling','cancelled'].includes(a.phase)?a.detail:'');
 return preview?<div className="task-progress"><Markdown text={redactText(preview,4096)}/></div>:null;
}
function TaskCard({task,a,decisions,visible,detail=false,children}:{task:DisplayTask;a:DisplayAttempt;decisions:Decision[];visible:boolean;detail?:boolean;children:React.ReactNode}){
 const ref=useRef<HTMLElement>(null);
 const pending=decisions.filter(d=>d.task===(task.executionId??task.id)&&d.attempt===a.id&&d.state==='pending');
 const activity=a.original?'idle':indicatorState(a.phase,pending.filter(d=>!d.questions.length).length,pending.filter(d=>d.questions.length).length);
 useLayoutEffect(()=>{const root=ref.current,trace=root?.querySelector('.task-active-trace rect');if(!root||!trace)return;
  const media=matchMedia('(prefers-reduced-motion: reduce)');let tween:gsap.core.Tween|undefined,onscreen=false;
  const update=()=>{tween?.kill();tween=undefined;gsap.set(trace,{attr:{'stroke-dashoffset':0}});if(visible&&onscreen&&document.visibilityState==='visible'&&!media.matches&&['working','waiting'].includes(activity))tween=gsap.to(trace,{attr:{'stroke-dashoffset':-100},duration:4,repeat:-1,ease:'none',overwrite:true});};
  const observer=new IntersectionObserver(([entry])=>{onscreen=!!entry?.isIntersecting;update();});observer.observe(root);media.addEventListener('change',update);document.addEventListener('visibilitychange',update);update();
  return()=>{observer.disconnect();media.removeEventListener('change',update);document.removeEventListener('visibilitychange',update);tween?.kill();gsap.killTweensOf(trace);};
 },[activity,visible]);
 return <article ref={ref} className={'task-card '+(detail?'detail-card':'task-card--compact')} data-activity={activity} data-phase={a.phase}>
 {['working','waiting'].includes(activity)&&<svg className="task-active-trace" aria-hidden="true"><rect x="1" y="1" pathLength="100"/></svg>}{children}</article>;
}
function Transcript({session,task,attempt,visible,owner,active}:{session:string;task:string;attempt:string;visible:boolean;owner:string;active:boolean}){
 const [messages,setMessages]=useState({prompt:'',text:''}),[error,setError]=useState(''),[behind,setBehind]=useState(false);const ref=useRef<HTMLDivElement>(null),following=useRef(true),lastTop=useRef(0),activeNow=useRef(active);
 // Settlement changes polling cadence, not transcript identity or reader intent.
 useLayoutEffect(()=>{activeNow.current=active;},[active]);
 useEffect(()=>{if(!visible)return;let stopped=false,timer:ReturnType<typeof setTimeout>,offset=0;const controller=new AbortController();
 setMessages({prompt:'',text:''});setError('');following.current=true;lastTop.current=0;
 const poll=async()=>{try{const data=await request('GET',`/api/sessions/${encodeURIComponent(session)}/tasks/${encodeURIComponent(task)}/attempts/${encodeURIComponent(attempt)}/transcript?offset=${offset}`,undefined,controller.signal) as Record<string,unknown>;
 if(stopped)return;
 if(data.session!==session||data.task!==task||data.attempt!==attempt||data.offset!==offset||typeof data.text!=='string'||typeof data.nextOffset!=='number'||data.nextOffset<offset||typeof data.more!=='boolean'||typeof data.settled!=='boolean'||!(data.prompt===null||typeof data.prompt==='string'))throw Error('Transcript identity or cursor mismatch');
 setMessages(m=>({prompt:typeof data.prompt==='string'?data.prompt:m.prompt,text:m.text+data.text}));offset=data.nextOffset;setError('');if(data.more||!data.settled||activeNow.current)timer=setTimeout(poll,data.more?0:1000);
 }catch(e){if(!stopped){setError((e as Error).message);timer=setTimeout(poll,3000);}}};void poll();return()=>{stopped=true;controller.abort();clearTimeout(timer);};},[session,task,attempt,visible]);
 useLayoutEffect(()=>{if(!visible||!ref.current)return;if(following.current){ref.current.scrollTop=ref.current.scrollHeight;lastTop.current=ref.current.scrollTop;}else setBehind(true);},[messages,visible]);
 // Result/header layout can shrink the viewport after the final message commit.
 // Preserve the reader's existing intent when that independent layout arrives.
 useLayoutEffect(()=>{const node=ref.current;if(!visible||!node)return;
 const resize=new ResizeObserver(()=>{if(following.current){node.scrollTop=node.scrollHeight;lastTop.current=node.scrollTop;}});
 resize.observe(node);return()=>resize.disconnect();},[visible]);
 return <div className="transcript-frame"><div ref={ref} className="task-transcript task-transcript--full" tabIndex={0} role="log" aria-live="off" aria-label={`${label(owner)} conversation`} onScroll={e=>{const el=e.currentTarget,atBottom=el.scrollHeight-el.scrollTop-el.clientHeight<24;/* Layout anchoring can move forward before ResizeObserver runs. Only upward movement leaves follow. */if(atBottom||el.scrollTop<lastTop.current)following.current=atBottom;lastTop.current=el.scrollTop;if(following.current)setBehind(false);}}><article><div className="message-meta"><strong>Delegation</strong></div><Markdown text={messages.prompt}/></article><article><div className="message-meta"><strong>{label(owner)}</strong></div><Markdown text={messages.text||(active?'Awaiting native output…':'No native output was recorded for this attempt.')}/></article>{error&&<p role="alert">{error}</p>}</div>{behind&&<button className="transcript-latest" onClick={()=>{following.current=true;setBehind(false);if(ref.current){ref.current.scrollTop=ref.current.scrollHeight;lastTop.current=ref.current.scrollTop;ref.current.focus({preventScroll:true});}}}>New messages ↓</button>}</div>;
}
function Conversation({session,task,attempt,visible,owner,active}:{session:string;task:string;attempt:string;visible:boolean;owner:string;active:boolean}){
 const [messages,setMessages]=useState<ExchangeMessage[]>([]),[recording,setRecording]=useState(''),[error,setError]=useState(''),[behind,setBehind]=useState(false);
 const ref=useRef<HTMLDivElement>(null),following=useRef(true),lastTop=useRef(0),current=useRef({visible,active});
 useLayoutEffect(()=>{current.current={visible,active};},[visible,active]);
 useEffect(()=>{let stopped=false,cursor=0,timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
 const poll=async()=>{if(stopped)return;if(!current.current.visible){timer=setTimeout(poll,300);return;}
 try{const page=exchangePage(await request('GET',`/api/sessions/${encodeURIComponent(session)}/tasks/${encodeURIComponent(task)}/attempts/${encodeURIComponent(attempt)}/exchanges?cursor=${cursor}&limit=32`,undefined,controller.signal),{session,task,attempt},cursor);
 if(stopped)return;cursor=page.nextCursor;setRecording(page.recording);if(page.messages.length)setMessages(m=>[...m,...page.messages]);setError('');
 // Keep checking settled pages: reconnect can expose a final committed chunk.
 timer=setTimeout(poll,page.more?0:1000);
 }catch(e){if(!stopped){setError((e as Error).message);timer=setTimeout(poll,2000);}}};void poll();return()=>{stopped=true;controller.abort();clearTimeout(timer);};},[session,task,attempt]);
 useLayoutEffect(()=>{if(!visible||!ref.current)return;if(following.current){ref.current.scrollTop=ref.current.scrollHeight;lastTop.current=ref.current.scrollTop;}else setBehind(true);},[messages,visible]);
 // Result/header layout can shrink the viewport after the final message commit.
 // Preserve the reader's existing intent when that independent layout arrives.
 useLayoutEffect(()=>{const node=ref.current;if(!visible||!node)return;
 const resize=new ResizeObserver(()=>{if(following.current){node.scrollTop=node.scrollHeight;lastTop.current=node.scrollTop;}});
 resize.observe(node);return()=>resize.disconnect();},[visible]);
 if(recording==='unavailable')return <><p role="status" className="muted">Historical snapshot: public conversation recording is unavailable. Showing the recorded transcript.</p><Transcript session={session} task={task} attempt={attempt} owner={owner} visible={visible} active={active}/></>;
 return <div className="transcript-frame"><div ref={ref} className="task-transcript task-transcript--full" tabIndex={0} role="log" aria-live="off" aria-label={`${label(owner)} conversation`} onScroll={e=>{const el=e.currentTarget,atBottom=el.scrollHeight-el.scrollTop-el.clientHeight<24;/* Layout anchoring can move forward before ResizeObserver runs. Only upward movement leaves follow. */if(atBottom||el.scrollTop<lastTop.current)following.current=atBottom;lastTop.current=el.scrollTop;if(following.current)setBehind(false);}}>{messages.map(m=><article key={m.sequence} data-exchange-sequence={m.sequence}><div className="message-meta"><strong>{m.role==='lead'?'Lead':label(m.role)}</strong><time dateTime={new Date(m.at_ms).toISOString()}>{new Date(m.at_ms).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}</time><span title={`Runner: ${m.provenance.runner} · Integration: ${m.provenance.integration} · Content: ${m.provenance.content}`}>{m.source}</span></div><Markdown text={m.text}/></article>)}{!messages.length&&<p className="muted">{!recording?'Loading recorded conversation…':active?'Awaiting recorded conversation…':'No public messages were recorded for this attempt.'}</p>}{error&&<p role="alert">{error}</p>}</div>{behind&&<button className="transcript-latest" onClick={()=>{following.current=true;setBehind(false);if(ref.current){ref.current.scrollTop=ref.current.scrollHeight;lastTop.current=ref.current.scrollTop;ref.current.focus({preventScroll:true});}}}>New messages ↓</button>}</div>;
}
function FailureControl({task,a,connected,refresh}:{task:DisplayTask;a:DisplayAttempt;connected:boolean;refresh:()=>void}){
 const [busy,setBusy]=useState(false),[error,setError]=useState('');const pending=useRef(false),ref=useRef<HTMLDivElement>(null);
 useLayoutEffect(()=>{const node=ref.current;if(!node)return;gsap.killTweensOf(node);if(!matchMedia('(prefers-reduced-motion: reduce)').matches)gsap.fromTo(node,{opacity:node.style.opacity||.75},{opacity:1,duration:.14,overwrite:true,clearProps:'opacity'});return()=>{gsap.killTweensOf(node);gsap.set(node,{clearProps:'opacity'});};},[a.failure_dismissal?.command_id,error]);
 const key=JSON.stringify([task.session,task.executionId??task.id,a.id,task.revision]);
 useEffect(()=>{if(a.failure_dismissal)setError('');},[a.failure_dismissal]);
 async function dismiss(){if(pending.current||!connected||task.revision===undefined)return;pending.current=true;setBusy(true);setError('');
 try{let command=localStorage.getItem('deck2.dismiss.'+key);if(!command){command=crypto.randomUUID();localStorage.setItem('deck2.dismiss.'+key,command);}
 const result=await request('POST',`/api/sessions/${encodeURIComponent(task.session)}/tasks/${encodeURIComponent(task.executionId??task.id)}/attempts/${encodeURIComponent(a.id)}/dismiss-failure`,{api:API,commandId:command,expectedRevision:task.revision}) as {session:string;task:string;attempt:string;dismissal?:{command_id:string}};
 if(result.session!==task.session||result.task!==(task.executionId??task.id)||result.attempt!==a.id||result.dismissal?.command_id!==command)throw Error('Dismissal receipt mismatch; refresh to inspect the persisted state.');
 refresh();
 }catch(e){setError(String(e));if(e instanceof HttpError&&e.status===409)refresh();}finally{pending.current=false;setBusy(false);}}
 if(a.original||a.phase!=='failed'||task.attempts.at(-1)?.id!==a.id)return null;
 return <div ref={ref}>{a.failure_dismissal?<p role="status" className="muted">Failure handled · <time dateTime={new Date(a.failure_dismissal.at_ms).toISOString()}>{new Date(a.failure_dismissal.at_ms).toLocaleString()}</time></p>:<button type="button" className="quiet" disabled={!connected||busy||task.revision===undefined} onClick={()=>void dismiss()}>{busy?'Dismissing…':'Dismiss'}</button>}{error&&<p role="alert">{error}</p>}</div>;
}
export const Subagents=memo(function Subagents({tasks,session,visible,connected,onError,decisions,historySession=false,unassigned=false,onAssignments,onRefresh=()=>{}}:{onRefresh?:()=>void;unassigned?:boolean;onAssignments?:()=>void;historySession?:boolean;tasks:Task[];session:string;visible:boolean;connected:boolean;onError:(s:string)=>void;decisions:Decision[]}){
 const [open,setOpen]=useState(''),[attempt,setAttempt]=useState(''),[reads,setReads]=useState<Record<string,boolean>>({}),[cancelling,setCancelling]=useState<Record<string,boolean>>({});const cancelPending=useRef(new Set<string>());const ref=useRef<HTMLElement>(null),switches=useRef<HTMLDivElement>(null),back=useRef<HTMLButtonElement>(null);
 const original=useOriginalTasks(session,historySession,visible);
 const models=mergeTasks(original.tasks,tasks,session);
 const detail=models.find(t=>t.id===open),a=detail&&(detail.attempts.find(a=>a.id===attempt)??detail.attempts.at(-1));
 useActiveIndicator(switches,open,'[aria-pressed="true"]',!!detail);
 useLayoutEffect(()=>{const node=ref.current;if(!node||!visible||!node.getClientRects().length)return;gsap.killTweensOf(node);if(!matchMedia('(prefers-reduced-motion: reduce)').matches)gsap.fromTo(node,{opacity:node.style.opacity||.65},{opacity:1,duration:.18,clearProps:'opacity'});return()=>{gsap.killTweensOf(node);};},[open,a?.id,visible]);
 useEffect(()=>{setOpen('');setAttempt('');setReads({});},[session]);
 const unread=(t:DisplayTask,a:DisplayAttempt)=>!!a.report&&!reads[replyKey(t.session,t.executionId??t.id,a)]&&!read(replyKey(t.session,t.executionId??t.id,a));
 const ack=(key:string)=>{try{localStorage.setItem('deck2.reply.'+key,'true');}catch{}setReads(v=>v[key]?v:{...v,[key]:true});};
 const choose=(t:DisplayTask)=>{setOpen(t.id);setAttempt('');requestAnimationFrame(()=>back.current?.focus({preventScroll:true}));};
 const returnToList=()=>{const id=detail?.id;setOpen('');setAttempt('');requestAnimationFrame(()=>{if(id)ref.current?.querySelector(`[data-task="${CSS.escape(id)}"] .open-detail`)?.closest<HTMLButtonElement>('button')?.focus({preventScroll:true});});};
 const cancel=async()=>{if(!detail||!a||a.original||!connected)return;const key=JSON.stringify([detail.executionId??detail.id,a.id]);if(cancelPending.current.has(key))return;cancelPending.current.add(key);setCancelling(v=>({...v,[key]:true}));try{await request('POST',`/api/tasks/${encodeURIComponent(detail.executionId??detail.id)}/attempts/${encodeURIComponent(a.id)}/cancel`,{api:API});}catch(e){cancelPending.current.delete(key);setCancelling(v=>({...v,[key]:false}));onError(String(e));}};

 if(detail&&a)return <section ref={ref} className="subagent-content subagent-detail" onKeyDown={e=>{if(e.key==='Escape'&&!e.defaultPrevented&&!document.querySelector('dialog[open]')&&!(e.target instanceof Element&&e.target.closest('dialog,select,input,textarea'))){e.preventDefault();returnToList();}}}><div className="detail-bar"><button ref={back} type="button" className="quiet detail-back" onClick={returnToList}>← Subagents</button><div ref={switches} className="detail-switch" role="group" aria-label="Switch subagent">{models.slice(-20).map(t=><button type="button" className="quiet detail-pick" key={t.id} aria-pressed={t.id===detail.id} aria-label={`${label(t.owner)} (${t.attempts.at(-1)!.phase})`} onClick={()=>{setOpen(t.id);setAttempt('');}}><Avatar owner={t.owner} size={28}/>{unread(t,t.attempts.at(-1)!)&&<span className="pick-unread" aria-label="Unread reply"/>}</button>)}</div></div><TaskCard task={detail} a={a} decisions={decisions} visible={visible&&connected} detail><Heading decisions={decisions} task={detail} a={a} index={detail.attempts.indexOf(a)} unread={unread(detail,a)}/>{detail.attempts.length>1&&<label>Attempt <select aria-label="Task attempt" value={a.id} onChange={e=>setAttempt(e.target.value)}>{detail.attempts.map((a,i)=><option key={a.id} value={a.id}>{a.original?(a.recordedNumber??'unavailable'):(a.number||i+1)} · {a.phase}</option>)}</select></label>}{!a.original&&['queued','accepted','preparing','dispatching','running','cancelling'].includes(a.phase)&&<button className="quiet" disabled={!connected||a.cancel_requested||!!cancelling[JSON.stringify([detail.executionId??detail.id,a.id])]} onClick={()=>void cancel()}>{a.cancel_requested||cancelling[JSON.stringify([detail.executionId??detail.id,a.id])]?'Cancellation requested':'Cancel specialist'}</button>}<>{detail.historyError&&<p role="alert">{detail.historyError}</p>}</><FailureControl key={`${detail.id}:${a.id}`} task={detail} a={a} connected={connected} refresh={onRefresh}/><Result task={detail} a={a} visible={visible} ack={ack}/>{a.phase==='failed'&&<p role="status" className="muted">{a.detail}</p>}</TaskCard><div className="detail-conversation"><h4>Conversation</h4>{!connected&&!a.original&&<p role="status" className="muted">Connection lost. Showing the last recorded task state; reconnect to update the conversation.</p>}{a.original?<div className="transcript-frame"><OriginalMessages key={`${session}:${detail.id}:${a.id}`} session={session} task={a.original.taskId} attempt={a.recordedNumber??0} snapshot={a.original.snapshot} visible={visible}/></div>:<Conversation key={`${session}:${detail.id}:${a.id}`} session={session} task={detail.executionId??detail.id} owner={detail.owner} attempt={a.id} visible={visible&&connected} active={['queued','accepted','preparing','dispatching','running','cancelling'].includes(a.phase)}/>}</div></section>;
 return <section ref={ref} className="subagent-content"><div className="panel-intro"><h2>Subagents</h2><p>Delegated work, actual assignments and results.</p>{!connected&&<p role="status" className="muted">{historySession?'Recorded history; these tasks are not executing in this host.':'Connection lost. Task states are last known; controls resume after reconnect.'}</p>}</div>{original.error&&<p role="alert">{original.error}<button className="quiet" onClick={original.retry}>Reopen historical tasks</button></p>}{original.busy&&<p role="status">Loading historical tasks…</p>}{original.next&&<button className="quiet" disabled={original.busy} onClick={()=>void original.more()}>More historical tasks</button>}{!original.busy&&!original.error&&!models.length&&<p className="empty-note">No subagents yet. Delegated work will appear here.</p>}{!models.length&&unassigned&&onAssignments&&<div className="empty-note"><p>This session has no subagent model assignments. Assign the roles before asking the Lead to delegate.</p><button type="button" className="quiet" disabled={!connected} onClick={onAssignments}>Assign subagent models</button></div>}<TranscriptWindow rows={models.map(t=>({...t,key:t.id}))} viewport={ref} limit={20} onBrowse={()=>{}} olderLabel="Load older subagents">{t=>{const a=t.attempts.at(-1)!;return <TaskCard key={t.id} task={t} a={a} decisions={decisions} visible={visible&&connected}><div data-task={t.id}><Heading decisions={decisions} task={t} a={a} index={t.attempts.length-1} unread={unread(t,a)} open={()=>choose(t)}/></div>{!a.report&&<TaskProgress key={"progress:"+a.id} task={t} a={a} visible={visible&&connected}/>}<FailureControl key={a.id} task={t} a={a} connected={connected} refresh={onRefresh}/><Result task={t} a={a} visible={visible&&!a.original} ack={ack} preview/></TaskCard>;}}</TranscriptWindow></section>;
});
