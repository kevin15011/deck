import React,{useLayoutEffect,useRef,useState} from 'react';
import {gsap} from 'gsap';
import {type Receipt} from './api';
import {sessionQueue,cancelQueuedInput} from './input-queue';
import {useDisclosureMotion} from './view-motion';
type InputQueueProps = {
 receipts:Receipt[];
 session:string;
 connected:boolean;
 paused:boolean;
 steerable?:string[];
 sendingLive?:string;
 onSendNow?:(input:Receipt)=>void;
 onPause?:(paused:boolean)=>void;
 onError:(text:string)=>void;
 onRefresh?:()=>void;
};

export function InputQueue({receipts,session,connected,paused,steerable,sendingLive,onSendNow,onPause,onError,onRefresh}:InputQueueProps){
 const rows=sessionQueue(receipts,session),root=useRef<HTMLElement>(null),list=useRef<HTMLOListElement>(null);
 const locks=useRef(new Set<string>()),[cancelling,setCancelling]=useState(new Set<string>()),[notice,setNotice]=useState('');
 const open=rows.length>0,focused=useRef<string|undefined>(undefined);
 useLayoutEffect(()=>{if(focused.current&&!rows.some(r=>r.id===focused.current)){if(document.activeElement===document.body||root.current?.contains(document.activeElement))document.getElementById('prompt')?.focus({preventScroll:true});focused.current=undefined;}},[rows.map(r=>r.id).join(':')]);
 useDisclosureMotion(root,open);
 const signature=rows.map(r=>r.id).join(':');
 useLayoutEffect(()=>{
  const node=list.current;if(!node)return;const media=matchMedia('(prefers-reduced-motion: reduce)');
  const settle=()=>{gsap.killTweensOf(node);gsap.set(node,{clearProps:'opacity'});};
  if(media.matches)settle();else{if(!node.style.opacity)gsap.set(node,{opacity:.7});gsap.to(node,{opacity:1,duration:.16,ease:'power2.out',overwrite:true,clearProps:'opacity'});}
  const changed=()=>{if(media.matches)settle();};media.addEventListener('change',changed);return()=>{media.removeEventListener('change',changed);gsap.killTweensOf(node);};
 },[signature]);
 async function cancel(input:Receipt){
  if(!connected||locks.current.has(input.id))return;locks.current.add(input.id);setCancelling(new Set(locks.current));setNotice('');
  try{await cancelQueuedInput(input);setNotice('Cancellation confirmed. Waiting for queue refresh.');onRefresh?.();}
  catch(e){onError(String(e));onRefresh?.();}
  finally{locks.current.delete(input.id);setCancelling(new Set(locks.current));}
 }
 return <section ref={root} className="composer-queue" hidden={!open} inert={!open} aria-label="Queued messages" onFocusCapture={e=>{focused.current=(e.target as Element).closest<HTMLElement>('[data-command-id]')?.dataset.commandId;}} onBlurCapture={e=>{if(e.relatedTarget&&e.relatedTarget!==document.body&&!e.currentTarget.contains(e.relatedTarget as Node))focused.current=undefined;}}>
  <div className="composer-queue-heading"><strong role="status">{rows.length} queued{!connected?' · last known':paused?' · paused':''}</strong>{onPause&&<button type="button" className="quiet" disabled={!connected} onClick={()=>onPause(!paused)}>{paused?'Resume queue':'Pause queue'}</button>}</div>
  <p className="sr-only">Order shown is acceptance order within this session. The host scheduler controls dispatch.</p>
  <ol ref={list}>{rows.map((input,i)=>{
   const number=i+1;
   const isCancelling=cancelling.has(input.id);
   return <li key={input.id} data-command-id={input.id}>
    <span className="queue-ordinal" aria-label={`Waiting item ${number} in this session`}>{number}.</span>
    <span className="queue-prompt" title={input.prompt}>{input.prompt||`${input.attachments.length} attached images`}</span>
    {onSendNow&&(steerable?.includes(input.id)||sendingLive===input.id)&&
     <button type="button" className="quiet" disabled={!connected||!!sendingLive||isCancelling}
      aria-label={`Send now, queued message ${number}`} onClick={()=>onSendNow(input)}>Send now</button>}
    <button type="button" className="quiet" disabled={!connected||isCancelling||sendingLive===input.id||!input.attempt}
     title={!input.attempt?'This historical input has no exact cancellation identity. Inspect Activity.':'Cancel only while undispatched'}
     aria-label={`Cancel queued message ${number}`} onClick={()=>void cancel(input)}>{isCancelling?'Cancelling…':'Cancel'}</button>
   </li>;
  })}</ol>
  {notice&&<p className="activity-meta" role="status">{notice}</p>}
 </section>;
}
