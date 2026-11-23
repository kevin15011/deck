import React,{useLayoutEffect,useRef,useState} from 'react';
import {API,decision,request,load,save,answersNotAccepted,permissionResponseNotAccepted,boundedAnswers,type Decision,type DecisionResponse,type Resolve} from './api';
import {gsap} from 'gsap';
import {redactText} from './redaction';
import {persistentGrant,sessionGrant,type PermissionOption,type PermissionPolicy} from './presentation';
import {scopeBinding,selectedScope,sameConsent,consentRequest,retainConsent} from './permission-selection';
import {ReceiptDetails} from './motion';
import {useDisclosureMotion} from './view-motion';

/** Display only: exact approval parameters and grant identity stay on the decision. */
export function nativeActionDetails(details:unknown){
 const display=redactText(JSON.stringify(details,null,2)??'Action details unavailable',65536);
 return display.length>4096?display.slice(0,4096)+'\n[Display truncated; full action retained for exact approval]':display;
}
export function observedDiff(before:string,after:string){
 const a=before.split('\n'),b=after.split('\n');let first=0,last=0;
 while(first<a.length&&first<b.length&&a[first]===b[first])first++;
 if(first===a.length&&first===b.length)return 'No file content change observed.';
 while(last<a.length-first&&last<b.length-first&&a[a.length-1-last]===b[b.length-1-last])last++;
 return ['@@ Observed file content @@',...a.slice(first,a.length-last).map(v=>'-'+v),...b.slice(first,b.length-last).map(v=>'+'+v)].join('\n');
}

const fieldNames:Record<string,string>={command:'Command',cwd:'Working directory',tool:'Tool',server:'Server',input:'Input',paths:'Paths',changes:'Changes',grant_root:'Grant root',permissions:'Permissions',operation:'Action',recipient:'Recipient'};
function displayValue(value:unknown){const text=redactText(typeof value==='string'?value:JSON.stringify(value,null,2)??'',65536);return text.length>4096?text.slice(0,4096)+'\n[Display truncated; inspect the full recorded request]':text;}
function actionExcerpt(details:unknown){
 if(!details||typeof details!=='object'||Array.isArray(details))return displayValue(details).slice(0,160);
 const values=details as Record<string,unknown>;
 return displayValue(values.command??values.tool??values.operation??values.paths??values.display??'Recorded action').slice(0,160);
}
function ActionDetails({details}:{details:unknown}){
 const fields=details&&typeof details==='object'&&!Array.isArray(details)?Object.entries(details).filter(([,value])=>value!==null&&value!==undefined):[];
 return fields.length?<dl className="permission-action">{fields.map(([key,value])=><div key={key}><dt>{fieldNames[key]??key.replaceAll('_',' ')}</dt><dd><pre>{/api[_-]?key|access[_-]?key|token|password|passwd|secret|authorization/i.test(key)?'[redacted]':displayValue(value)}</pre></dd></div>)}</dl>:<pre className="permission-fallback">{displayValue(details)||'Action details unavailable. Inspect the recorded request before responding.'}</pre>;
}

export function PermissionScopeChoice({policy,scope,disabled,onChange}:{policy:PermissionPolicy;scope:PermissionOption;disabled:boolean;onChange:(id:string)=>void}){
 const detail=useRef<HTMLDivElement>(null),initial=useRef(true);
 useLayoutEffect(()=>{const node=detail.current;if(!node)return;if(initial.current){initial.current=false;return;}
  const media=matchMedia('(prefers-reduced-motion: reduce)');
  const settle=()=>{gsap.killTweensOf(node);gsap.set(node,{clearProps:'opacity'});};
  if(media.matches)settle();else{gsap.killTweensOf(node);if(!node.style.opacity)gsap.set(node,{opacity:.65});gsap.to(node,{opacity:1,duration:.15,ease:'power2.out',overwrite:true,clearProps:'opacity'});}
  const change=()=>{if(media.matches)settle();};media.addEventListener('change',change);
  return()=>{media.removeEventListener('change',change);gsap.killTweensOf(node);};
 },[scope.id,scope.description]);
 return <div className="permission-scope-choice"><label>Session scope <select aria-label="Session permission scope" value={scope.id} disabled={disabled} onChange={event=>onChange(event.target.value)}>{policy.options.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></label><div ref={detail}><p className="review-scope">For <strong>{scope.actor}</strong> in this session: {scope.description.replace(/ Valid (?:across reconnects and host restart until revoked, assignments change or canonical session authority is replaced|for the matching admitted assignment and revision across reconnects and host restart until revoked or the session authority is replaced)\.$/,'')} Survives restarting the app for work with the same admitted assignment revision. It ends when revoked or the session authority changes. Revoke from session permissions. Other roles need separate permission.</p>{scope.kind==='exact'&&policy.unsupported.map((limit,i)=><p key={i} className="activity-meta">{limit}</p>)}</div></div>;
}

export async function submitReviewResponse(d:Decision,response:DecisionResponse,storageScope='',scopeOptionId?:string){
 if(!boundedAnswers(response))throw new Error('Each answer must contain at most 4096 UTF-8 bytes. Shorten the answer and send again.');
  const key=(storageScope?storageScope+'.':'')+'decision.'+d.id;
  async function send(body:Resolve){
   try {
    const result=decision(await request('POST',`/api/decisions/${encodeURIComponent(d.id)}/responses`,body));
    if(result.id!==d.id||result.session!==d.session||result.command!==d.command||result.resolution?.command_id!==body.command_id)throw new Error('Decision acknowledgment identity mismatch; reconnect before continuing.');
   }catch(e){
    if((answersNotAccepted(e,d.id,body)||permissionResponseNotAccepted(e,d.id,body))&&load(key)===JSON.stringify(body))save(key,'');
    throw e;
   }
  }
   const stored=load(key);
   let body=consentRequest(API,crypto.randomUUID(),d.revision,response,scopeOptionId);
   if(stored){
    const retained=JSON.parse(stored) as Resolve;
    if(sameConsent(retained,body))body=retainConsent(retained,body);
    else {
     // Explicit correction of a legacy oversized answer first asks the host to
     // reject that exact payload. Never replay a locally valid uncertain answer.
     if(!boundedAnswers(retained.response)){
      try{await send(retained);}catch(e){if(!answersNotAccepted(e,d.id,retained))throw e;}
     }
     // Read/reconcile only: never resubmit consent just because the user changed
     // a choice. A lost rejection response can be recovered after reconnect.
     if(retained.response.type==='allow_session'&&retained.scope_option_id){
      try{await request('POST',`/api/decisions/${encodeURIComponent(d.id)}/responses/reconcile`,retained);}
      catch(e){if(permissionResponseNotAccepted(e,d.id,retained)&&load(key)===JSON.stringify(retained))save(key,'');}
     }
     if(load(key))throw new Error('A response identity is retained. Reconnect to inspect its result before changing that response.');
     save(key,JSON.stringify(body));
    }
   }else save(key,JSON.stringify(body));
   await send(body);
}

export function Review({d,onError,connected,storageScope='',conversation=false,onResize}:{conversation?:boolean;onResize?:()=>void;storageScope?:string;d:Decision;onError:(s:string)=>void;connected:boolean}){
 const [selection,setSelection]=useState<{binding:string;id:string}|null>(null);
 const [busy,setBusy]=useState(false),[view,setView]=useState<'proposed'|'observed'>('proposed'),[answers,setAnswers]=useState<Record<string,string>>({}),[choices,setChoices]=useState<Record<string,string[]>>({});
 const responseFocus=useRef(false),focusedInside=useRef(false),section=useRef<HTMLElement>(null);
 const comparisonUnavailable=!!d.file&&(!!d.file.snapshot_error||d.state==='settled'&&d.file.after===null);
 const visible=!conversation||d.state==='pending'||d.state==='uncertain'||d.state==='invalidated'||comparisonUnavailable;
 const resizeCallback=useRef(onResize);resizeCallback.current=onResize;
 useLayoutEffect(()=>{const node=section.current;if(!conversation||!node)return;const observer=new ResizeObserver(()=>resizeCallback.current?.());observer.observe(node);return()=>observer.disconnect();},[conversation]);
 const sending=useRef(false),content=useRef<HTMLDivElement>(null),actions=useRef<HTMLDivElement>(null),initialView=useRef(true);
 const [expanded,setExpanded]=useState(false),reviewBody=useRef<HTMLDivElement>(null),summary=useRef<HTMLButtonElement>(null);
 const pending=d.state==='pending',show=pending||expanded||d.state==='uncertain'||d.state==='invalidated'||comparisonUnavailable;
 useLayoutEffect(()=>{if(!pending){const active=document.activeElement;if(!visible){if(section.current?.contains(active)||(focusedInside.current||responseFocus.current)&&active===document.body)document.getElementById('prompt')?.focus({preventScroll:true});focusedInside.current=false;}else if(reviewBody.current?.contains(active)||responseFocus.current&&active===document.body)summary.current?.focus({preventScroll:true});responseFocus.current=false;}},[pending,visible]);
 // Remember focus across React making the settled section inert.
 useDisclosureMotion(section,visible);
 useDisclosureMotion(reviewBody,show);
 useDisclosureMotion(actions,pending);
 useLayoutEffect(()=>{const node=content.current;if(!node)return;if(initialView.current){initialView.current=false;return;}
  const media=matchMedia('(prefers-reduced-motion: reduce)');gsap.killTweensOf(node);
  const settle=()=>{gsap.killTweensOf(node);gsap.set(node,{clearProps:'opacity'});};
  if(media.matches)settle();else{if(!node.style.opacity)gsap.set(node,{opacity:.5});gsap.to(node,{opacity:1,duration:.16,ease:'power2.out',overwrite:true,clearProps:'opacity'});}
  const change=()=>{if(media.matches)settle();};media.addEventListener('change',change);
  return()=>{media.removeEventListener('change',change);gsap.killTweensOf(node);};
 },[view]);
 async function respond(response:DecisionResponse){if(sending.current||disabled||!allowed(response.type==='deny'&&display?.kind==='question'?'dismiss':response.type))return;
  try{
   responseFocus.current=!!reviewBody.current?.contains(document.activeElement);sending.current=true;setBusy(true);
   await submitReviewResponse(d,response,storageScope,scope?.id);
  }catch(e){onError((e as Error).message);}finally{sending.current=false;setBusy(false);}}

 const display=d.presentation,available=display?.validated===true,grant=persistentGrant(display?.persistent_grant);
 const roleGrant=sessionGrant(display?.session_grant),hasSessionScope=!!display&&Object.hasOwn(display,'session_grant');
 const policy=display?.permission_policy,hasPolicy=!!display&&Object.hasOwn(display,'permission_policy');
 const binding=scopeBinding(d.id,d.revision,policy),scope=selectedScope(policy,binding,selection);
 useLayoutEffect(()=>{setSelection(null);},[binding]);
 const provenance=display?.resolution_provenance??policy?.provenance;
 const persistentConsent=grant?`Persistent command prefix: ${JSON.stringify(grant.prefix)}. This permits commands matching this prefix in future sessions. Deck cannot revoke this grant; manage it outside Deck in the runner's permission settings.`:undefined;
 const permission=available&&!['question','file_edit'].includes(display.kind);
 const allowed=(response:string)=>available&&(response!=='allow_always'||!!grant)&&(response!=='allow_session'||(!hasSessionScope||!!roleGrant)&&(!hasPolicy||!!scope))&&(display.responses?.includes(response as never)??(display.kind==='file_edit'?['allow_once','deny']:display.kind==='question'?['answers','dismiss']:[]).includes(response));
 const disabled=!pending||busy||!connected||!available;
 const title=!available?'Action unavailable':permission?'Permission request':d.file?'Review file change':'Questions from the runner';
 const response=d.resolution?.response.type;
 const outcome=provenance?.kind==='reused_grant'?'Session permission reused':provenance?.kind==='intrinsic'?'Coordination allowed':response?({deny:'Denied',allow_once:'Allowed once',allow_session:'Allowed for this session',allow_always:'Persistent permission allowed',answers:'Answers sent'}[response]):d.state;
 const excerpt=available&&permission?actionExcerpt(display.details):d.file?.path;

 return <section ref={section} hidden={!visible} inert={!visible} aria-hidden={!visible} onFocusCapture={()=>{focusedInside.current=true;}} onBlurCapture={event=>{if(event.relatedTarget&&event.relatedTarget!==document.body&&!event.currentTarget.contains(event.relatedTarget as Node))focusedInside.current=false;}} className={'review task'+(pending?' review--pending':' review--settled')} aria-label={!available?'Action unavailable':permission?'Permission request':d.file?'Review file change':'Answer questions'}>
 <header>{pending?<><strong>{title}</strong><span className="review-state">Needs {display?.kind==='question'?'an answer':'approval'}</span></>:<button ref={summary} type="button" className="quiet review-summary" aria-expanded={show} onClick={()=>setExpanded(v=>!v)}><svg viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.25"><path d={show?'m4 10 4-4 4 4':'m4 6 4 4 4-4'}/></svg><span><strong>{outcome}</strong>{excerpt&&<span className="review-excerpt">{excerpt}</span>}</span><span className="review-state">{d.state}</span></button>}</header>
 <div ref={reviewBody} className="review-body" hidden={!show}>

 {!available?<p role="status">Validated action presentation unavailable. Reconnect to inspect the current decision.</p>:permission?<><ActionDetails details={display.details}/>{pending&&!roleGrant&&!hasPolicy&&<p className="review-scope">Review the action and choose a permission duration.</p>}{roleGrant&&!hasPolicy&&<p className="review-scope">Allow new tasks for <strong>{roleGrant.role}</strong> in this session. Permission survives restarting the app; it ends if the team or session permissions change. Revoke it from session permissions. Other roles and tools need separate permission.</p>}{pending&&allowed('allow_session')&&!hasSessionScope&&!hasPolicy&&<p className="review-scope">Session permission covers this exact action only.</p>}{hasPolicy&&pending&&(policy&&scope?<PermissionScopeChoice policy={policy} scope={scope} disabled={disabled} onChange={id=>setSelection({binding,id})}/>:<p className="activity-meta" role="status">Session scope unavailable or unsupported. Reconnect to inspect the current offer; allow once or deny remain available.</p>)}{hasSessionScope&&!roleGrant&&<p className="activity-meta" role="status">Session scope unavailable or unsupported. Session consent is withheld; inspect the recorded request or reconnect.</p>}{grant&&(!pending||allowed('allow_always'))&&<p className="activity-meta">{persistentConsent}</p>}<div ref={actions} hidden={!pending} className="review-actions">{allowed('deny')&&<button type="button" disabled={disabled||!(allowed('deny')||allowed('dismiss'))} onClick={()=>void respond({type:'deny'})}>Deny</button>}{allowed('allow_once')&&<button type="button" disabled={disabled||!allowed('allow_once')} onClick={()=>void respond({type:'allow_once'})}>Allow once</button>}{allowed('allow_session')&&<button type="button" disabled={disabled} onClick={()=>void respond({type:'allow_session'})}>{roleGrant&&!hasPolicy?'Allow this role for this session':'Allow for this session'}</button>}{allowed('allow_always')&&<button type="button" disabled={disabled} onClick={()=>{if(persistentConsent&&confirm(persistentConsent+'\n\nAllow this persistent grant?'))void respond({type:'allow_always'});}}>Always allow this permission</button>}</div></>:d.file?<><p className="review-path">{d.file.path}</p>{comparisonUnavailable&&<p className="activity-meta" role="status">Comparison unavailable. {d.file.snapshot_error||'No file result was retained. Inspect the target before requesting a fresh proposal.'}</p>}<div className="review-views" role="group" aria-label="File change view"><button type="button" className="quiet" aria-pressed={view==='proposed'} onClick={()=>setView('proposed')}>Proposed change</button><button type="button" className="quiet" aria-pressed={view==='observed'} onClick={()=>setView('observed')}>Observed change</button></div><div ref={content} className="review-diff" tabIndex={0} aria-label={view==='proposed'?'Proposed diff':'Observed diff'}><pre>{view==='proposed'?d.file.diff:d.file.after===null?(d.file.snapshot_error||d.state==='settled'?'Comparison unavailable. '+(d.file.snapshot_error||'No snapshot was retained.')+' Inspect the target and its accessibility manually before requesting a fresh proposal. No change is reapplied or rolled back.':'No file result observed yet. Approval alone does not prove a change.'):observedDiff(d.file.before,d.file.after)}</pre></div>{d.file.native_status&&<p className="activity-meta">Native result: {d.file.native_status}. Observed content may include concurrent changes.</p>}
 <div ref={actions} hidden={!pending} className="review-actions"><button type="button" disabled={disabled||!(allowed('deny')||allowed('dismiss'))} onClick={()=>void respond({type:'deny'})}>Deny</button><button type="button" disabled={disabled||!allowed('allow_once')} onClick={()=>void respond({type:'allow_once'})}>Allow once</button></div></>
 :<form onSubmit={e=>{e.preventDefault();void respond({type:'answers',answers:Object.fromEntries(d.questions.map(q=>[q.id,q.multiple?[...(choices[q.id]??[]),...(answers[q.id]?.trim()?[answers[q.id]]:[])]:[answers[q.id]||'']]))});}}>{d.questions.map(q=><fieldset key={q.id} className="review-question"><legend>{q.question}</legend>{q.multiple&&q.options.map(o=><label key={o.label}><input type="checkbox" checked={(choices[q.id]??[]).includes(o.label)} disabled={disabled} onChange={e=>setChoices(v=>({...v,[q.id]:e.target.checked?[...(v[q.id]??[]),o.label]:(v[q.id]??[]).filter(s=>s!==o.label)}))}/>{o.label} — {o.description}</label>)}{!q.multiple&&q.options.length>0&&<select aria-label={q.header+' options'} value={q.options.some(o=>o.label===answers[q.id])?answers[q.id]:''} onChange={e=>setAnswers(v=>({...v,[q.id]:e.target.value}))} disabled={disabled}><option value="">Choose an answer or enter your own</option>{q.options.map(o=><option key={o.label} value={o.label}>{o.label} — {o.description}</option>)}</select>}<input maxLength={4096} value={answers[q.id]||''} onChange={e=>setAnswers(v=>({...v,[q.id]:e.target.value}))} disabled={disabled} aria-label={q.header+' answer'}/></fieldset>)}<div ref={actions} hidden={!pending} className="review-actions"><button type="button" disabled={disabled||!(allowed('deny')||allowed('dismiss'))} onClick={()=>void respond({type:'deny'})}>Dismiss</button><button disabled={disabled||!allowed('answers')||d.questions.some(q=>!answers[q.id]?.trim()&&!(q.multiple&&choices[q.id]?.length))}>Send answers</button></div><p className="activity-meta">Answers provide information and grant no file permission.</p></form>}
 <ReceiptDetails>{hasPolicy&&<pre aria-label="Recorded permission scopes">{redactText(JSON.stringify(policy??{unavailable:true},null,2),65536)}</pre>}{provenance&&<p className="activity-meta">{provenance.kind==='reused_grant'?`Reused session permission from decision ${provenance.source_decision}. No new user consent.`:provenance.kind==='intrinsic'?'Allowed by authenticated coordination policy; no user consent requested.':'User response recorded.'}</p>}{roleGrant&&<pre aria-label="Recorded session permission scope">{redactText(JSON.stringify(roleGrant,null,2),65536)}</pre>}{permission&&available&&<pre>{nativeActionDetails(display.details)}</pre>}<p className="activity-meta">Decision {d.id}<br/>Attempt {d.attempt}<br/>Revision {d.revision}<br/>State {d.state}<br/>Request {d.request}<br/>Dispatch {d.dispatch_ms??'not observed'}<br/>Delivered {d.delivered_ms??'not observed'}<br/>Grant consumed {String(d.grant_consumed)}</p>{d.resolution&&<pre aria-label="Recorded response">{redactText(JSON.stringify(d.resolution,null,2),65536)}</pre>}<p className="activity-meta" role="status">{d.detail}</p></ReceiptDetails></div></section>;
}
