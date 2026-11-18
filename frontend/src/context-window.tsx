import React from 'react';
import type {Session,Receipt} from './api';
import {SecondaryInfo} from './secondary-info';
export interface ContextReading {basis:'codex-last-total';tokens:number|null;capacity:number|null;native_thread_id:string;native_turn_id:string;attempt:string;model_id:string|null;observed_ms:number}
const count=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=0;
export function contextReading(value:unknown,attempt?:string,thread?:string|null,turn?:string|null):ContextReading|undefined {
 if(!value||typeof value!=='object'||!('observation' in value)||('compacted' in value&&value.compacted))return;
 const c=value.observation as ContextReading|undefined;
 if(!c||c.basis!=='codex-last-total'||!attempt||c.attempt!==attempt||!thread||c.native_thread_id!==thread||!turn||c.native_turn_id!==turn||!count(c.observed_ms)||c.observed_ms>8.64e15||!(c.tokens===null||count(c.tokens))||!(c.capacity===null||count(c.capacity)&&c.capacity>0)||!(c.model_id===null||typeof c.model_id==='string'&&c.model_id.length<=256))return;
 return c;
}
// Current Lead selection; receipt history remains intact.
export function leadContextReceipt(session:Session|undefined,receipts:readonly Receipt[]):Receipt|undefined {
 const native=session?.native;
 if(!native)return;
 return receipts.filter(r=>r.session===session.id&&r.phase!=='queued'
  &&r.thread===native.thread&&r.mode===native.mode
  &&(!session.contract||(r.configuration?.session_contract?.generation===session.contract.generation
   &&r.configuration.session_contract.leadTask===session.contract.leadTask))).at(-1);
}
export function contextEstimate(c?:ContextReading){
 const used=c?.tokens??null,max=c?.capacity??null;
 const percent=used===null||max===null?null:max<=12000?100:100-Math.round(Math.min(100,Math.max(0,max-12000-Math.max(used-12000,0))/(max-12000)*100));
 return {used,max,percent};
}
const number=(v:number)=>v.toLocaleString('en-US');
const compact=(v:number)=>new Intl.NumberFormat('en-US',{notation:'compact',maximumSignificantDigits:3}).format(v).toLowerCase();
export function ContextWindowIndicator({observation:c,owner='Agent',resetKey=''}:{observation?:ContextReading;owner?:string;resetKey?:string}){
 const {used,max,percent}=contextEstimate(c),summary=percent!==null&&used!==null&&max!==null?`≈${percent}% · ${compact(used)} / ${compact(max)}`:used!==null?`${compact(used)} used`:max!==null?`${compact(max)} max`:'Context unavailable';
 return <SecondaryInfo title={`${owner} context`} label={summary} accessibleLabel={`${owner} context details: ${summary}`} className="context-window" resetKey={resetKey}><p className="secondary-info-kicker">Context window</p><p className="secondary-info-primary">{percent!==null?<>≈{percent}%<span> used</span></>:used!==null?<>{number(used)}<span> tokens used</span></>:max!==null?<>{number(max)}<span> token maximum</span></>:'Not reported yet'}</p>{percent!==null&&used!==null&&max!==null&&<p className="secondary-info-caption context-window-counts">{number(used)} <span>/ {number(max)} tokens</span></p>}{c?<><p className="secondary-info-note">Codex estimate: the percentage reserves a 12,000-token baseline; counts show the full window.</p><dl className="secondary-info-facts">{c.model_id&&<div><dt>Model</dt><dd>{c.model_id}</dd></div>}</dl><p className="secondary-info-note">Last observed <time dateTime={new Date(c.observed_ms).toISOString()}>{new Date(c.observed_ms).toLocaleTimeString()}</time> · Attempt {resetKey.split(':').at(-1)||'1'}</p></>:<p className="secondary-info-note">Updates when the runner reports context usage.</p>}</SecondaryInfo>;
}
