import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import type { Api } from './workspace';
import { ImageReferences, publicImages, type ImageAttachment } from './image-attachments';
import { NavigationIcon } from './project-navigation';
export type QueuedPrompt = { promptId: string; text: string; createdAt?: string; position?: number; attachments?: ImageAttachment[] };
export type PromptInbox = { seq: number; paused: boolean; pauseReason?: string; queued: QueuedPrompt[]; active?: {promptId:string;taskId:string;attempt:number;state:'dispatched'} };
export const emptyInbox = (): PromptInbox => ({seq:0,paused:false,queued:[]});
export function reduceInbox(inbox: PromptInbox, event: SessionEvent): PromptInbox {
    if(event.seq<=inbox.seq) return inbox;
    const next={...inbox,seq:event.seq}, id=String(event.data.promptId??'');
    if(event.kind==='prompt.queued' && id && typeof event.data.text==='string' && !inbox.queued.some(item=>item.promptId===id)) next.queued=[...inbox.queued,{promptId:id,text:event.data.text,createdAt:String(event.data.createdAt??event.ts),position:Number(event.data.position),attachments:publicImages(event.data.attachments)}];
    if(event.kind==='prompt.dispatched') {next.queued=inbox.queued.filter(item=>item.promptId!==id);next.active={promptId:id,taskId:String(event.data.taskId),attempt:Number(event.data.attempt),state:'dispatched'};}
    if(event.kind==='prompt.state'){next.queued=inbox.queued.filter(item=>item.promptId!==id);if(inbox.active?.promptId===id)next.active=undefined;}
    if(event.kind==='prompt.queue'){next.paused=event.data.paused===true;next.pauseReason=typeof event.data.reason==='string'?event.data.reason:undefined;}
    return next;
}
export function failedQueuedPrompts(events: SessionEvent[]) {
    const queued=new Map<string,QueuedPrompt>(),dispatched=new Set<string>(),failed=new Map<string,QueuedPrompt & {reason:string}>();
    for(const event of events){const id=String(event.data.promptId??'');if(!id)continue;
        if(event.kind==='prompt.queued'&&typeof event.data.text==='string')queued.set(id,{promptId:id,text:event.data.text,...(publicImages(event.data.attachments).length?{attachments:publicImages(event.data.attachments)}:{})});
        if(event.kind==='prompt.dispatched'){dispatched.add(id);failed.delete(id);}
        if(event.kind==='prompt.state'&&!dispatched.has(id)&&['failed','ownership-unsettled'].includes(String(event.data.state))){const item=queued.get(id);if(item)failed.set(id,{...item,reason:typeof event.data.reason==='string'?event.data.reason:'The message could not start.'});}
    }
    return [...failed.values()];
}
/** A lagging HTTP summary cannot reintroduce a cancelled/dispatched receipt.
 * CurrentEvents retains the full current queue, so rebase from empty beyond its
 * prompt watermark instead of replaying that projection over obsolete entries. */
export function reconcileInbox(events:SessionEvent[],snapshot:PromptInbox):PromptInbox {
    const latest=events.filter(event=>event.kind.startsWith('prompt.')).at(-1)?.seq??0;
    return events.reduce(reduceInbox,snapshot.seq>=latest?snapshot:emptyInbox());
}
export function usePromptInbox(api: Api, sessionId: string, connected: boolean, events: SessionEvent[]) {
    const [snapshot,setSnapshot]=useState<{sessionId:string;data:PromptInbox}>({sessionId:'',data:emptyInbox()}),[error,setError]=useState<{sessionId:string;message:string}>({sessionId:'',message:''}),[revision,setRevision]=useState(0);
    const request=useRef(0);
    const queueRevision=events.filter(event=>event.kind.startsWith('prompt.')).at(-1)?.seq??0;
    useEffect(()=>{if(!sessionId||!connected)return;const controller=new AbortController(),version=++request.current;
        setError({sessionId,message:''});void api(`/api/sessions/${encodeURIComponent(sessionId)}/prompts`,{signal:controller.signal}).then(reply=>{if(!controller.signal.aborted&&version===request.current)setSnapshot({sessionId,data:reply.data});}).catch(cause=>{if(!controller.signal.aborted&&version===request.current)setError({sessionId,message:(cause as Error).message});});
        return()=>{++request.current;controller.abort();};
    },[api,sessionId,connected,revision,queueRevision]);
    const inbox=useMemo(()=>reconcileInbox(events,snapshot.sessionId===sessionId?snapshot.data:emptyInbox()),[snapshot,sessionId,events]);
    return {inbox,error:error.sessionId===sessionId?error.message:'',failed:useMemo(()=>failedQueuedPrompts(events),[events]),refresh:()=>setRevision(value=>value+1)};
}
export function PromptQueue({ items, paused, pauseReason, connected, busy, sending = false, error, failed = [], onCancel, onResume, onImage = () => {} }: { items: QueuedPrompt[]; paused: boolean; pauseReason?: string; connected: boolean; busy: boolean; sending?: boolean; error?: string; failed?: (QueuedPrompt & {reason:string})[]; onCancel: (promptId: string) => void; onResume: () => void; onImage?: (attachment:ImageAttachment)=>void }) {
    if (!items.length && !paused && !sending && !error && !failed.length) return null;
    return <section className="prompt-queue" aria-label="Queued messages"><div className="queue-heading"><p role="status" aria-live="polite" aria-atomic="true">{paused ? 'Queue paused' : `${items.length} queued ${items.length === 1 ? 'message' : 'messages'}`}{sending ? ' · Adding message…' : ''}</p>{paused && <button type="button" className="quiet queue-resume" disabled={!connected || busy} onClick={onResume}>Resume queue</button>}</div>{paused && <p className="queue-note" title={pauseReason}>Messages wait here until you resume.</p>}{items.length > 0 && <ol>{items.map((item, index) => <li key={item.promptId} data-prompt-id={item.promptId}><span className="queue-order" aria-hidden="true">{index + 1}</span><span className="queue-preview" title={item.text}>{item.text||'Image message'}</span><ImageReferences compact attachments={item.attachments??[]} onPreview={onImage}/><button type="button" className="quiet queue-cancel" disabled={!connected || busy} aria-label={`Remove queued message ${index + 1}`} aria-description={item.text.slice(0,160)} title="Remove before it starts" onClick={() => onCancel(item.promptId)}><NavigationIcon kind="close"/></button></li>)}</ol>}{failed.length>0 && <div className="queue-failures"><p>Could not start</p><ol>{failed.map(item=><li key={item.promptId}><span className="queue-preview" title={`${item.text}\n${item.reason}`}>{item.text||'Image message'}</span><ImageReferences compact attachments={item.attachments??[]} onPreview={onImage}/><span className="queue-failure-reason">{item.reason==='runner-driver-unavailable'?'The selected runner is unavailable.':item.reason==='ownership-unsettled'?'The previous turn has not fully stopped.':item.reason}</span></li>)}</ol></div>}{error && <p className="queue-error" role="alert">{error}</p>}</section>;
}
