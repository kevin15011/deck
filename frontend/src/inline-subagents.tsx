import React,{useRef,useState} from 'react';
import type {Phase,Task,TaskAttempt} from './api';
import {memberStepLabel,type Step} from './activity-model';
import {AttemptElapsed} from './attempt-elapsed';
import {Markdown} from './markdown';
import {useDisclosureMotion} from './view-motion';
import {RunnerMark} from './runner-mark';

const names:Record<string,string>={investigate:'Investigate','apply-fast':'Apply Fast','apply-deep':'Apply Deep',architect:'Architect',quality:'Quality',setup:'Setup'};
const statuses:Record<Phase,string>={queued:'waiting to start',accepted:'waiting to start',preparing:'preparing',dispatching:'starting',running:'working',completed:'completed',failed:'failed',cancelled:'cancelled',cancelling:'stopping',uncertain:'needs attention'};
const working=(attempt:TaskAttempt)=>attempt.settled_ms==null&&['accepted','preparing','dispatching','running'].includes(attempt.phase);

function WorkingMark(){
 return <svg className="inline-agent-working" viewBox="0 0 12 12" fill="none" aria-hidden="true">
  <circle cx="6" cy="6" r="4.5" stroke="currentColor" opacity=".25"/>
  <path d="M6 1.5a4.5 4.5 0 0 1 4.5 4.5" stroke="currentColor" strokeLinecap="round"/>
 </svg>;
}

export function InlineSubagent({task,attempt:a,step,connected}:{task:Task;attempt:TaskAttempt;step?:Step;connected:boolean}){
 const [open,setOpen]=useState(false),[technical,setTechnical]=useState(false);
 const detail=useRef<HTMLDivElement>(null),technicalBody=useRef<HTMLDivElement>(null);
 useDisclosureMotion(detail,open);useDisclosureMotion(technicalBody,technical);
 const active=connected&&working(a);
 const activity=active&&a.phase==='running'?memberStepLabel(step,{task:task.id,attempt:a.id}):undefined;
 const status=activity??statuses[a.phase];
 return <div className="inline-agents" aria-label="Subagent progress"><div className="inline-agent">
  <button type="button" className="quiet inline-agent-button" aria-expanded={open} aria-controls={`inline-${a.id}`} onClick={()=>setOpen(v=>!v)}><RunnerMark runner={a.provenance.runner}/><strong>{names[task.owner]??task.owner}</strong><span className="inline-agent-status">{active&&!activity&&<WorkingMark/>}<span className="inline-agent-label" title={activity}>{status}</span></span><AttemptElapsed className="inline-agent-elapsed" attempt={a}/><span aria-hidden="true">{open?'−':'+'}</span></button>
  <div id={`inline-${a.id}`} ref={detail} hidden={!open} className="inline-agent-detail">
   {a.report?.text?<Markdown text={a.report.text}/>:<p>{a.detail||status}</p>}
   <button type="button" className="quiet inline-agent-technical" aria-expanded={technical} aria-controls={`inline-technical-${a.id}`} onClick={()=>setTechnical(v=>!v)}>Technical details</button>
   <div id={`inline-technical-${a.id}`} ref={technicalBody} hidden={!technical}>
    <p>Runner: {a.provenance.runner||'Unavailable'} · Model: {a.observed_model||a.requested_model||'Unavailable'} · Attempt {a.number??'unavailable'}</p>
    <p>Tokens / context: {a.context==null?'Not reported':null}</p>{a.context!=null&&<pre>{JSON.stringify(a.context,null,2)}</pre>}
   </div>
  </div>
 </div></div>;
}
