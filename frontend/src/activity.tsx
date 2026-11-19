import React,{memo,useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {API,active,request,type Receipt} from './api';
import {activityPage,frameBatch,stepLabel,type ActivityPage,type Step} from './activity-model';
import {useDisclosureMotion} from './view-motion';
import {redactText} from './redaction';
import {gsap} from 'gsap';
import './activity.css';

export function useActivity(session:string,enabled:boolean){
 const [snapshot,setSnapshot]=useState<{cursor:string;page:ActivityPage;stepsKey:string;liveKey:string;membersKey:string}>();
 const [failure,setFailure]=useState<{session:string;message:string}>();
 const [location,setLocation]=useState<{session:string;cursor:string}>();
 const cursor=location?.session===session?location.cursor:'';
 useEffect(()=>{if(!session||!enabled)return;let stopped=false,timer:ReturnType<typeof setTimeout>;const controller=new AbortController();
  const batch=frameBatch<ActivityPage>(page=>{
   const stepsKey=JSON.stringify(page.steps),liveKey=JSON.stringify(page.live),membersKey=JSON.stringify(page.members??[]);
   setSnapshot(previous=>{
    const samePage=previous?.page.session===session&&previous.cursor===cursor;
    const sameSteps=samePage&&previous.stepsKey===stepsKey;
    if(sameSteps&&previous.liveKey===liveKey&&previous.membersKey===membersKey&&previous.page.older===page.older&&previous.page.newer===page.newer)return previous;
    return {cursor,stepsKey,liveKey,membersKey,page:{...page,steps:sameSteps?previous.page.steps:page.steps,members:samePage&&previous.membersKey===membersKey?previous.page.members:page.members}};
   });
  },requestAnimationFrame,cancelAnimationFrame);
  const poll=async()=>{
   try {
    const next=activityPage(await request('GET',`/api/sessions/${encodeURIComponent(session)}/activity${cursor}`,undefined,controller.signal),session);
    if(stopped)return;
    batch.push(next);
    setFailure(undefined);
   } catch(e){if(!stopped)setFailure({session,message:(e as Error).message});}
   if(!stopped)timer=setTimeout(poll,1000);
  };
  void poll();return()=>{stopped=true;controller.abort();clearTimeout(timer);batch.dispose();};
 },[session,enabled,cursor]);
 const received=snapshot?.page.session===session?snapshot:undefined;
 return {page:received?.page,pageCursor:received?.cursor,error:failure?.session===session?failure.message:'',cursor,browse:(cursor:string)=>setLocation({session,cursor})};
}

function Disclosure({label,children}:{label:string;children:React.ReactNode}){
 const [open,setOpen]=useState(false),ref=useRef<HTMLDivElement>(null);useDisclosureMotion(ref,open);
 return <div className="activity-disclosure"><button className="quiet" aria-expanded={open} onClick={()=>setOpen(v=>!v)}>{label}<span aria-hidden="true">{open?' −':' +'}</span></button><div ref={ref} hidden={!open} inert={!open}>{open&&children}</div></div>;
}
export function LiveActivity({steps,receipts,connected}:{steps:Step[];receipts:Receipt[];connected:boolean}){
 const working=receipts.filter(r=>r.phase==='running').at(-1);
 const owned=working?steps.filter(s=>!s.task&&s.command===working.id&&s.attempt===working.attempt):[];
 const current=owned.find(s=>s.status==='running')??owned[0];
 const label=current?stepLabel(current):undefined;
 const text=working&&connected?(current&&label?`${current.owner==='lead'?'':current.owner+' · '}${label.label}${label.summary?' · '+label.summary:''}`:'Thinking…'):'';
 const ref=useRef<HTMLDivElement>(null),last=useRef('');if(text)last.current=text;useDisclosureMotion(ref,!!text);
 useLayoutEffect(()=>{const node=ref.current;if(!node||!text)return;if(!matchMedia('(prefers-reduced-motion: reduce)').matches)gsap.fromTo(node,{opacity:.65},{opacity:1,duration:.12,overwrite:true,clearProps:'opacity'});return()=>{gsap.killTweensOf(node);};},[text]);
 return <div ref={ref} hidden={!text} className="live-activity" role="status" aria-live="polite"><span aria-hidden="true" className={text&&(!current||current.kind==='reasoning')?'thinking-pulse':undefined}>{label?.mark??'·'}</span><span>{last.current}</span>{current&&<small>{current.runner}</small>}</div>;
}
function StepOutput({step,session}:{step:Step;session:string}){
 const [output,setOutput]=useState<string>(),[error,setError]=useState('');
 useEffect(()=>{setError('');const controller=new AbortController();let stopped=false;void request('GET',`/api/sessions/${encodeURIComponent(session)}/activity/${step.seq}/output`,undefined,controller.signal).then(value=>{const v=value as {session:string;seq:number;output:string};if(v.session!==session||v.seq!==step.seq||typeof v.output!=='string'||v.output.length>65536)throw Error('Step output identity differs.');if(!stopped)setOutput(redactText(v.output,16384));}).catch(e=>{if(!stopped)setError((e as Error).message);});return()=>{stopped=true;controller.abort();};},[session,step.seq,step.status]);
 return error?<p role="alert">{error}</p>:<pre className="activity-output">{output===undefined?'Loading output…':output||'No output excerpt was recorded.'}</pre>;
}
const StepRow=memo(function StepRow({step,session,connected,onError}:{step:Step;session:string;connected:boolean;onError:(e:string)=>void}){
 const label=stepLabel(step),[open,setOpen]=useState(false),[cancelling,setCancelling]=useState(false),body=useRef<HTMLDivElement>(null);useDisclosureMotion(body,open);
 async function cancel(){if(cancelling)return;setCancelling(true);try{await request('POST',`/api/tasks/${encodeURIComponent(step.task)}/attempts/${encodeURIComponent(step.attempt)}/cancel`,{api:API});}catch(e){onError((e as Error).message);setCancelling(false);}}
 return <div className="step-row" data-step={step.seq} data-status={step.status}><div className="step-heading"><span className="step-icon" aria-hidden="true">{label.mark}</span><button type="button" className="quiet step-toggle" aria-expanded={open} onClick={()=>setOpen(v=>!v)}><strong>{label.label}</strong><span className="step-arguments">{label.summary||step.owner}</span></button><span className="step-status">{step.status}</span><time>{step.durationMs===null?'—':step.durationMs<1000?step.durationMs+' ms':(step.durationMs/1000).toFixed(1)+' s'}</time></div>{step.task&&step.status==='running'&&<button type="button" className="quiet step-cancel" disabled={!connected||cancelling} onClick={()=>void cancel()}>{cancelling?'Cancellation requested':'Cancel specialist'}</button>}<div ref={body} hidden={!open} inert={!open}>{open&&<StepOutput step={step} session={session}/>}</div></div>;
});
function TurnCancel({receipt,connected,onCancel}:{receipt:Receipt;connected:boolean;onCancel:(id:string)=>Promise<boolean>}){
 const [requested,setRequested]=useState(false),pending=useRef(false);
 async function cancel(){
  if(pending.current)return;
  pending.current=true;
  setRequested(true);
  if(!await onCancel(receipt.id)){
   pending.current=false;
   setRequested(false);
  }
 }
 const cancelling=requested||receipt.cancel_requested||receipt.phase==='cancelling';
 return <button type="button" className="quiet" disabled={!connected||cancelling} onClick={()=>void cancel()}>{cancelling?'Cancellation requested':'Cancel turn'}</button>;
}
export function ActivityTimeline({activity,receipts,session,connected,visible,onError,onCancel}:{activity:ReturnType<typeof useActivity>;receipts:Receipt[];session:string;connected:boolean;visible:boolean;onError:(e:string)=>void;onCancel:(id:string)=>Promise<boolean>}){
 const viewport=useRef<HTMLDivElement>(null);
 const anchor=useRef<{seq:string;offset:number}|undefined>(undefined);
 const previousTop=useRef(0),follow=useRef(true);
 const pending=activity.cursor!==activity.pageCursor;
 const steps=activity.page?.steps;
 const byTurn=useMemo(()=>{
  const groups=new Map<string,Step[]>();
  for(const step of steps??[]){
   const group=groups.get(step.command);
   if(group)group.push(step);
   else groups.set(step.command,[step]);
  }
  return groups;
 },[steps]);
 const receiptsById=useMemo(()=>new Map(receipts.map(r=>[r.id,r])),[receipts]);
 function remember(node:HTMLDivElement){
  const {top}=node.getBoundingClientRect();
  const first=Array.from(node.querySelectorAll<HTMLElement>('[data-step]')).find(el=>el.getBoundingClientRect().bottom>top);
  anchor.current=first?{seq:first.dataset.step!,offset:first.getBoundingClientRect().top-top}:undefined;
 }
 function move(older:boolean){
  const node=viewport.current;
  if(pending||!node||!steps?.length)return;
  follow.current=false;
  remember(node);
  const overlap=Math.min(66,Math.floor(steps.length/3));
  const index=older?overlap:Math.max(0,steps.length-overlap-1);
  activity.browse(`?${older?'before':'after'}=${steps[index]!.seq}`);
  if(node.contains(document.activeElement))node.focus({preventScroll:true});
 }
 useLayoutEffect(()=>{
  const node=viewport.current;
  if(!node||!visible||pending||!activity.page||!node.getClientRects().length)return;
  if(follow.current)node.scrollTop=node.scrollHeight;
  else if(anchor.current){
   const {seq,offset}=anchor.current;
   const el=node.querySelector<HTMLElement>(`[data-step="${seq}"]`);
   if(el)node.scrollTop+=el.getBoundingClientRect().top-node.getBoundingClientRect().top-offset;
  }
  previousTop.current=node.scrollTop;
  remember(node);
 },[steps,pending,visible]);
 return <div ref={viewport} className="step-timeline" tabIndex={0} aria-label="Turn activity" onScroll={e=>{
  const node=e.currentTarget,up=node.scrollTop<previousTop.current;
  previousTop.current=node.scrollTop;
  if(pending)return;
  follow.current=!activity.cursor&&node.scrollHeight-node.clientHeight-node.scrollTop<20;
  remember(node);
  if(up&&node.scrollTop<20&&activity.page?.older)move(true);
 }}>
 {activity.error&&<p role="alert">{activity.error}</p>}{activity.page?.older&&<button className="quiet history-window-control" disabled={pending} onClick={()=>move(true)}>Load older steps</button>}
 {!byTurn.size&&<p className="empty-note">Recorded tool activity appears here.</p>}
 {[...byTurn].map(([id,group])=>{
  const r=receiptsById.get(id);
  return <section className="activity-turn" key={id} data-turn={id}>
   {r&&active(r)&&<header><TurnCancel receipt={r} connected={connected} onCancel={onCancel}/></header>}
   <div className="turn-steps">{group.map(s=><StepRow key={s.seq} step={s} session={session} connected={connected} onError={onError}/>)}</div>
   {r&&<Disclosure label="Technical details"><dl className="turn-technical"><dt>Receipt</dt><dd>{r.id}</dd><dt>Native status</dt><dd>{redactText(r.detail)}</dd><dt>Delivery</dt><dd>{redactText(r.delivery)}</dd><dt>Policy</dt><dd>{redactText(r.policy)}</dd><dt>Thread / turn</dt><dd>{r.thread} / {r.turn}</dd></dl></Disclosure>}
  </section>;
 })}
 {activity.page?.newer&&<button className="quiet history-window-control" disabled={pending} onClick={()=>move(false)}>Load newer steps</button>}{activity.cursor&&<button className="quiet history-window-control" onClick={()=>{follow.current=true;activity.browse('');}}>Latest activity</button>}
 </div>;
}
