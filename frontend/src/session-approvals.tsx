import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import {gsap} from 'gsap';
export type ApprovalMode = 'relay' | 'yolo';
export type ApprovalModeSource = 'session' | 'default';
export type ApprovalSummary = { approvalMode?: ApprovalMode; approvalModeSource?: ApprovalModeSource };
export function ApprovalChip({ mode='relay' }: { mode?:ApprovalMode; source?:ApprovalModeSource }) {
    return <span className={`approval-mode-chip${mode==='yolo'?' is-yolo':''}`} title={mode==='yolo'?'Agents act without asking. Enabled for this session.':'Agents ask for your approval before acting'}>{mode==='yolo'?'YOLO':'Ask first'}</span>;
}
function YoloWarnings({ acknowledged, onAcknowledged, disabled=false }: { acknowledged:boolean; onAcknowledged:(value:boolean)=>void; disabled?:boolean }) {
    const panel=useRef<HTMLDivElement>(null);
    useLayoutEffect(()=>{const node=panel.current;if(!node)return;if(!matchMedia('(prefers-reduced-motion: reduce)').matches)gsap.fromTo(node,{opacity:.5,y:4},{opacity:1,y:0,duration:.18,ease:'power2.out',clearProps:'opacity,transform'});return ()=>{gsap.killTweensOf(node);};},[]);
    return <div ref={panel} className="yolo-warning"><ul>
        <li>Agents can run shell commands, edit or delete files and use the network without asking you first.</li>
        <li>Codex: approvals off with a full-access sandbox. Read-only review roles and narrower configured role policies remain restricted.</li>
        <li>Native execution for Claude and Pi is not yet supported in this build. OpenCode preserves native permission rules; explicit native deny rules still apply.</li>
        <li>Deck does not sandbox YOLO sessions — use it only in projects you trust.</li>
        <li>You can switch it off at any time. The change applies from your next message.</li>
    </ul><label className="approval-checkbox"><input type="checkbox" required checked={acknowledged} disabled={disabled} onChange={event=>onAcknowledged(event.target.checked)}/>I understand the risks</label></div>;
}
export function YoloFields({ enabled, acknowledged, onEnabled, onAcknowledged, disabled=false }: { enabled:boolean; acknowledged:boolean; onEnabled:(value:boolean)=>void; onAcknowledged:(value:boolean)=>void; disabled?:boolean }) {
    return <div className="yolo-fields"><p className="muted">YOLO is off by default and applies only to this session. You can enable it later from the session controls.</p><label className="approval-checkbox"><input type="checkbox" checked={enabled} disabled={disabled} onChange={event=>{onEnabled(event.target.checked);onAcknowledged(false);}}/>YOLO mode — agents run without asking for permission</label>{enabled&&<YoloWarnings acknowledged={acknowledged} onAcknowledged={onAcknowledged} disabled={disabled}/>}</div>;
}
export function SessionCreateButton({ yolo, acknowledged, disabled=false, pending=false }: { yolo:boolean; acknowledged:boolean; disabled?:boolean; pending?:boolean }) {
    return <button disabled={disabled||pending||(yolo&&!acknowledged)}>{pending?'Saving…':'Create session'}</button>;
}
export function ApprovalConfirmation({ acknowledged, onAcknowledged, onCancel, onSubmit, pending=false, error='' }: { acknowledged:boolean; onAcknowledged:(value:boolean)=>void; onCancel:()=>void; onSubmit:()=>void; pending?:boolean; error?:string }) {
    return <form onSubmit={event=>{event.preventDefault();if(acknowledged&&!pending)onSubmit();}}><h2>Enable YOLO</h2><YoloWarnings acknowledged={acknowledged} onAcknowledged={onAcknowledged} disabled={pending}/>{error&&<p className="error" role="alert">{error}</p>}<div className="dialog-actions"><button type="button" className="quiet" disabled={pending} onClick={onCancel}>Cancel</button><button disabled={pending||!acknowledged}>{pending?'Saving…':'Enable YOLO'}</button></div></form>;
}
export function SessionApprovals({ mode='relay', source='default', disabled=false, onChange }: { mode?:ApprovalMode; source?:ApprovalModeSource; disabled?:boolean; onChange:(mode:ApprovalMode)=>Promise<unknown> }) {
    const dialog=useRef<HTMLDialogElement>(null), trigger=useRef<HTMLButtonElement>(null), id=useId();
    const [open,setOpen]=useState(false), [ack,setAck]=useState(false), [pending,setPending]=useState(false), [error,setError]=useState(''), [changed,setChanged]=useState(false);
    useLayoutEffect(()=>{const node=dialog.current;if(!node)return;gsap.killTweensOf(node);if(open){node.showModal();if(!matchMedia('(prefers-reduced-motion: reduce)').matches)gsap.fromTo(node,{opacity:.5,y:6},{opacity:1,y:0,duration:.18,ease:'power2.out',clearProps:'opacity,transform'});}else if(node.open){node.close();trigger.current?.focus();}return()=>{gsap.killTweensOf(node);};},[open]);
    function close(){setOpen(false);setAck(false);}
    async function change(next:ApprovalMode){if(pending||disabled||(next==='yolo'&&!ack))return;setPending(true);setError('');try{await onChange(next);setChanged(true);close();}catch(cause){setError((cause as Error).message);}finally{setPending(false);}}
    return <div className="session-approval-controls"><ApprovalChip mode={mode} source={source}/><button ref={trigger} type="button" className="quiet" disabled={disabled||pending} onClick={()=>{setError('');if(mode==='yolo')void change('relay');else{setAck(false);setOpen(true);}}}>{mode==='yolo'?'Disable YOLO':'Enable YOLO'}</button>{changed&&<small role="status">Applies from your next message</small>}{error&&!open&&<p className="error" role="alert">{error}</p>}<dialog ref={dialog} className="workspace-dialog" aria-label="Enable YOLO" id={id} onCancel={event=>{event.preventDefault();if(!pending)close();}}>{open&&<ApprovalConfirmation acknowledged={ack} onAcknowledged={setAck} onCancel={close} onSubmit={()=>void change('yolo')} pending={pending} error={error}/>}</dialog></div>;
}
