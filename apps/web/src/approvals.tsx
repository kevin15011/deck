import { useDetailsDismiss } from './dismiss-layer';
import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { animateIn, useAppear } from './motion';
import type { ApprovalScope, SessionGrant, SessionGrantKind } from '../../../packages/core/src/session/approval';
export type { ApprovalScope, SessionGrant, SessionGrantKind } from '../../../packages/core/src/session/approval';
export type AutoApprovalDetail = {tool:string;exactKey?:string;exactKeyTruncated?:boolean;input?:unknown};
export type ApprovalView = AutoApprovalDetail & {approvalId:string;toolKey?:string;summary:string;allowedScopes:ApprovalScope[];grantKinds:SessionGrantKind[];risk:'normal'|'high';alwaysNote?:string;input?:unknown};
export type ApprovalChoice = {scope:'session';grant:'tool'}|{scope:'always'};
export function approvalView(event:SessionEvent):ApprovalView {
    const d=event.data, string=(value:unknown)=>typeof value==='string'?value:undefined, modern=Array.isArray(d.allowedScopes)&&Array.isArray(d.grantKinds);
    return {approvalId:String(d.approvalId),tool:String(d.tool??d.toolName??d.title??'Tool request'),toolKey:string(d.toolKey),exactKey:string(d.exactKey),exactKeyTruncated:d.exactKeyTruncated===true||(string(d.exactKey)?.length??0)>=512,summary:String(d.summary??d.description??d.reason??d.command??'Review this action before allowing it.'),risk:d.risk==='normal'?'normal':'high',allowedScopes:modern?(d.allowedScopes as unknown[]).filter((s):s is ApprovalScope=>typeof s==='string'&&['once','session','always'].includes(s)):['once'],grantKinds:modern?(d.grantKinds as unknown[]).filter((kind):kind is SessionGrantKind=>kind==='exact'||kind==='tool'):[],alwaysNote:string(d.alwaysNote),input:d.input};
}
function ActionPattern({request, full=false}:{request:AutoApprovalDetail;full?:boolean}) {
    const shortened=request.exactKeyTruncated||(request.exactKey?.length??0)>=512;
    return <div className={`approval-pattern${full?' approval-pattern--full':''}`}><strong>{request.tool}</strong>{request.exactKey!==undefined&&<code title={request.exactKey}>{request.exactKey}</code>}{shortened&&<><span className="approval-shortened">Shortened — the full action is not displayed</span>{request.input!==undefined?<details className="approval-full-request"><summary>Show full request</summary><pre tabIndex={0} aria-label="Full redacted request">{typeof request.input==='string'?request.input:JSON.stringify(request.input,null,2)}</pre></details>:<p className="muted">Full request details are unavailable.</p>}</>}</div>;
}
export function ApprovalConfirmation({request,choice,acknowledged,onAcknowledged,onCancel,onConfirm,pending=false,error=''}:{request:ApprovalView;choice:ApprovalChoice;acknowledged:boolean;onAcknowledged:(value:boolean)=>void;onCancel:()=>void;onConfirm:()=>void;pending?:boolean;error?:string}) {
    const node=useRef<HTMLFormElement>(null);useAppear(node,'pop');
    const always=choice.scope==='always';
    return <form ref={node} onSubmit={event=>{event.preventDefault();if(acknowledged&&!pending)onConfirm();}}><h2>{always?'Always allow':'Allow any use for this session'}</h2><ActionPattern request={request} full/>{always?<blockquote className="approval-persistence">{request.alwaysNote??'Persistence details unavailable.'}</blockquote>:<p className="approval-risk">High risk: this permits every action using {request.tool} in this session, including shell, file or network actions supported by that tool.</p>}<label className="approval-checkbox"><input type="checkbox" required checked={acknowledged} disabled={pending} onChange={event=>onAcknowledged(event.target.checked)}/>I understand {always?'that this permission persists outside this session':'the risks of allowing any use of this tool'}</label>{error&&<p role="alert" className="error">{error}</p>}<div className="dialog-actions"><button type="button" className="quiet" disabled={pending} onClick={onCancel}>Cancel</button><button disabled={pending||!acknowledged||(always&&!request.alwaysNote)}>{pending?'Saving…':always?'Always allow':'Allow for this session'}</button></div></form>;
}
/** The scope choices use the top layer so the bounded approvals scroller cannot clip them. */
function useScopePopover(menu: React.RefObject<HTMLDetailsElement | null>, choices: React.RefObject<HTMLDivElement | null>) {
    useLayoutEffect(() => {
        const details=menu.current,panel=choices.current;
        if(!details||!panel||typeof panel.showPopover!=='function')return;
        const toggle=()=>{
            if(!details.open){if(panel.matches(':popover-open'))panel.hidePopover();return;}
            if(!panel.matches(':popover-open'))panel.showPopover();
            const anchor=details.querySelector('summary')!.getBoundingClientRect(),size=panel.getBoundingClientRect();
            panel.style.position='fixed';panel.style.left=`${Math.max(8,Math.min(anchor.right-size.width,innerWidth-size.width-8))}px`;
            panel.style.top=`${Math.max(8,anchor.bottom+size.height+4<innerHeight?anchor.bottom+4:anchor.top-size.height-4)}px`;
        };
        const close=(event:Event)=>{if(!(event.target instanceof Node)||!panel.contains(event.target))details.open=false;};
        details.addEventListener('toggle',toggle);window.addEventListener('resize',close);document.addEventListener('scroll',close,true);
        return()=>{details.removeEventListener('toggle',toggle);window.removeEventListener('resize',close);document.removeEventListener('scroll',close,true);if(panel.matches(':popover-open'))panel.hidePopover();};
    }, []);
}
export function ApprovalCard({event,onRespond,busy=false}:{event:SessionEvent;onRespond:(body:Record<string,unknown>)=>Promise<unknown>;busy?:boolean}) {
    const request=approvalView(event), dialog=useRef<HTMLDialogElement>(null),menu=useRef<HTMLDetailsElement>(null),choices=useRef<HTMLDivElement>(null),trigger=useRef<HTMLElement|null>(null);
    useDetailsDismiss(menu);
    useScopePopover(menu,choices);
    const [choice,setChoice]=useState<ApprovalChoice>(),[ack,setAck]=useState(false),[pending,setPending]=useState(false),[error,setError]=useState('');
    const disabled=busy||pending, session=request.allowedScopes.includes('session')&&request.grantKinds.length>0, exact=request.grantKinds.includes('exact')&&!request.exactKeyTruncated, tool=request.grantKinds.includes('tool'), always=request.allowedScopes.includes('always')&&!request.exactKeyTruncated;
    useEffect(()=>{if(choice)dialog.current?.showModal();else if(dialog.current?.open){dialog.current.close();trigger.current?.focus();}},[choice]);
    function confirm(next:ApprovalChoice){trigger.current=next.scope==='session'?menu.current?.querySelector('summary')??null:document.activeElement as HTMLElement;setAck(false);setError('');setChoice(next);if(menu.current)menu.current.open=false;}
    async function respond(decision:'allow'|'deny',scope:ApprovalScope='once',grant?:'exact'|'tool',confirmed?:boolean){
        if(disabled)return;setPending(true);setError('');
        try{await onRespond({type:'approval.respond',approvalId:request.approvalId,decision,...(decision==='allow'?{scope,...(grant?{grant}:{}),...(confirmed?{confirmed:true}:{})}:{})});setChoice(undefined);}
        catch(cause){setError((cause as Error).message);}
        finally{setPending(false);}
    }
    return <article className="approval" aria-label={`Approval for ${request.tool}`}><div><h2>{request.tool}</h2><ActionPattern request={request}/><p>{request.summary}</p><details><summary>Request details</summary><pre>{JSON.stringify(event.data,null,2)}</pre></details></div><div className="approval-actions"><button type="button" disabled={disabled} onClick={()=>void respond('allow')}>Allow once</button>{session&&(exact||tool)&&<details ref={menu} className="approval-scope-menu" onToggle={event=>{const choices=event.currentTarget.querySelector<HTMLElement>('.approval-scope-choices');if(event.currentTarget.open&&choices)animateIn(choices,'fade');}}><summary aria-disabled={disabled} onClick={event=>{if(disabled)event.preventDefault();}}>Allow for this session ▾</summary><div ref={choices} popover="manual" className="approval-scope-choices">{exact&&<button type="button" className="quiet" disabled={disabled} onClick={()=>{if(menu.current)menu.current.open=false;void respond('allow','session','exact');}}>This exact action</button>}{tool&&<button type="button" className="quiet" disabled={disabled} onClick={()=>{if(request.risk==='high')confirm({scope:'session',grant:'tool'});else{if(menu.current)menu.current.open=false;void respond('allow','session','tool');}}}>Any use of {request.tool}</button>}{tool&&request.risk==='high'&&<small className="approval-risk">High risk: permits every action using this tool. Confirmation required.</small>}</div></details>}{always&&<button type="button" className="quiet" disabled={disabled||!request.alwaysNote} onClick={()=>confirm({scope:'always'})}>Always allow…</button>}<button type="button" className="quiet" disabled={disabled} onClick={()=>void respond('deny')}>Deny</button></div>{error&&!choice&&<p className="error approval-error" role="alert">{error}</p>}<dialog ref={dialog} className="workspace-dialog" aria-label={choice?.scope==='always'?'Always allow':'Allow any use for this session'} onCancel={event=>{event.preventDefault();if(!pending)setChoice(undefined);}}>{choice&&<ApprovalConfirmation request={request} choice={choice} acknowledged={ack} onAcknowledged={setAck} onCancel={()=>setChoice(undefined)} onConfirm={()=>void respond('allow',choice.scope,choice.scope==='session'?'tool':undefined,true)} pending={pending} error={error}/>}</dialog></article>;
}
export function Approvals({events,onRespond,busy=false}:{events:SessionEvent[];onRespond:(body:Record<string,unknown>)=>Promise<unknown>;busy?:boolean}) {
    const [selected,setSelected]=useState<string>(),node=useRef<HTMLElement>(null);
    const index=Math.max(0,events.findIndex(event=>event.data.approvalId===selected)),event=events[index];
    useLayoutEffect(()=>{
        // Announce without taking the user's caret or interrupting another dialog.
        const active=document.activeElement;
        if(event&&!document.querySelector('dialog[open]')&&(!active||active===document.body||active.id==='conversation'))node.current?.focus({preventScroll:true});
    },[event?.data.approvalId]);
    return <section ref={node} tabIndex={-1} className={`approvals${events.length?' pending':''}`} aria-label="Approvals"><div className="approval-heading"><strong role="status" aria-live="polite" aria-atomic="true">{event?`Approval needed · ${index+1} of ${events.length}`:'No pending approvals'}</strong>{events.length>1&&<div className="approval-pagination"><button type="button" className="quiet" aria-label="Previous request" disabled={busy} onClick={()=>setSelected(String(events[(index-1+events.length)%events.length]!.data.approvalId))}>←</button><button type="button" className="quiet" aria-label="Next request" disabled={busy} onClick={()=>setSelected(String(events[(index+1)%events.length]!.data.approvalId))}>→</button></div>}</div>{event&&<div className="approval-requests"><ApprovalCard key={String(event.data.approvalId)} event={event} onRespond={onRespond} busy={busy}/></div>}</section>;
}
export function AutoApprovalMessage({detail,label}:{detail:AutoApprovalDetail;label?:string}) {
    return <article className="message auto-approval muted" aria-label="Auto-approved by a session permission"><p>Auto-approved by a session permission{label?` · ${label}`:''}</p><ActionPattern request={detail}/></article>;
}
export function SessionPermissions({grants,onRevoke,busy=false}:{grants:SessionGrant[];onRevoke:(id:string)=>Promise<unknown>;busy?:boolean}) {
    const menu=useRef<HTMLDetailsElement>(null);
    useDetailsDismiss(menu);
    const [pending,setPending]=useState(''),[error,setError]=useState('');
    if(!grants.length)return null;
    return <details ref={menu} className="session-permissions"><summary>Session permissions ({grants.length})</summary><div className="session-permissions-panel" role="group" aria-label="Session permissions"><ul>{grants.map(grant=><li key={grant.grantId}><div><strong>{grant.toolKey}</strong><span>{grant.kind==='exact'?<>exact: <code title={grant.exactKey}>{grant.exactKey}</code></>:'any use'}</span>{grant.risk==='high'&&<small className="approval-risk">High risk</small>}</div><button type="button" className="quiet" disabled={busy||!!pending} onClick={async()=>{setPending(grant.grantId);setError('');try{await onRevoke(grant.grantId);}catch(cause){setError((cause as Error).message);}finally{setPending('');}}}>{pending===grant.grantId?'Revoking…':'Revoke'}</button></li>)}</ul>{error&&<p className="error" role="alert">{error}</p>}</div></details>;
}
