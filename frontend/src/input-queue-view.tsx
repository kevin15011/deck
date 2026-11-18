import React,{useLayoutEffect,useRef,useState} from 'react';
import {gsap} from 'gsap';
import {type Receipt} from './api';
import {sessionQueue,cancelQueuedInput} from './input-queue';
import {useDisclosureMotion} from './view-motion';
export function InputQueue({receipts,session,connected,paused,onPause,onError,onRefresh}:{receipts:Receipt[];session:string;connected:boolean;paused:boolean;onPause?:((paused:boolean)=>void);onError:(text:string)=>void;onRefresh?:()=>void}){
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
  <ol ref={list}>{rows.map((r,i)=><li key={r.id} data-command-id={r.id}><span className="queue-ordinal" aria-label={`Waiting item ${i+1} in this session`}>{i+1}.</span><span className="queue-prompt" title={r.prompt}>{r.prompt||`${r.attachments.length} attached images`}</span><button type="button" className="quiet" disabled={!connected||cancelling.has(r.id)||!r.attempt} title={!r.attempt?'This historical input has no exact cancellation identity. Inspect Activity.':'Cancel only while undispatched'} aria-label={`Cancel queued message ${i+1}`} onClick={()=>void cancel(r)}>{cancelling.has(r.id)?'Cancelling…':'Cancel'}</button></li>)}</ol>
  {notice&&<p className="activity-meta" role="status">{notice}</p>}
 </section>;
}
