import React,{useLayoutEffect,useRef} from 'react';
import {gsap} from 'gsap';
import {active,type Receipt} from './api';
export function processingState(rows:Receipt[],connected:boolean,sending:boolean,unconfirmed=false){
 if(!connected)return {phase:'connection',label:'Reconnecting to Lead…'};
 const r=rows.find(active)??rows.find(r=>r.phase==='queued');
 if(sending)return {phase:'sending',label:'Sending…'};
 if(!r)return unconfirmed?{phase:'waiting',label:'Checking delivery…'}:{phase:'idle',label:''};
 const decisions=r.decisions.filter(d=>!d.task||d.task==='lead').filter(d=>['pending','responded','dispatching','uncertain'].includes(d.state));
 if(decisions.some(d=>d.questions.length))return {phase:'question',label:'Waiting for your answer'};
 if(decisions.length)return {phase:'approval',label:'Waiting for your approval'};
 if(r.context&&typeof r.context==='object'&&'compacting' in r.context&&r.context.compacting)return {phase:'compacting',label:'Compacting context…'};
 if(r.phase==='queued')return {phase:'waiting',label:'Message queued'};
 if(['accepted','preparing','dispatching'].includes(r.phase))return {phase:'preparing',label:'Starting Lead…'};
 if(r.phase==='cancelling')return {phase:'waiting',label:'Stopping Lead…'};
 if(r.text.trim())return {phase:'responding',label:'Responding…'};
 return {phase:'waiting',label:'Waiting for Lead…'};
}
export function ProcessingProgress({rows,connected,sending,unconfirmed,children}:{rows:Receipt[];connected:boolean;sending:boolean;unconfirmed?:boolean;children:React.ReactNode}){
 const {phase,label}=processingState(rows,connected,sending,unconfirmed),ref=useRef<HTMLSpanElement>(null);
 useLayoutEffect(()=>{const node=ref.current;if(!node||phase==='idle')return;const media=gsap.matchMedia();media.add('(prefers-reduced-motion: no-preference)',()=>{gsap.to(node,{opacity:.35,duration:.8,repeat:-1,yoyo:true,ease:'sine.inOut'});});return()=>{media.revert();};},[phase]);
 return <div className="lead-progress" data-phase={phase}><span className="lead-progress-status" role="status" aria-live="polite" aria-atomic="true"><span ref={ref} className="lead-progress-dot" aria-hidden="true"/><span className="lead-progress-label">{label}</span></span>{children}</div>;
}
