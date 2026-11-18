// Original Deck decision controls adapted to the Rust host projection.
import React,{useEffect,useId,useLayoutEffect,useRef,useState} from 'react';
import {request} from './api';
import {useDisclosureMotion} from './view-motion';
export type DecisionView={decisionId:string;revision:number;questionRevision:number;question:string;state:string;note?:string;origin:{promptId:string};replies:{stale:boolean}[];queuedReplies:unknown[]};
export type DecisionSelection={sessionId:string;decisionId:string;revision:number;questionRevision:number;question:string};
const unresolvedDecision=(d:DecisionView)=>d.state==='pending'||d.state==='deferred';
function decisionReplyStatus(d:DecisionView){return d.queuedReplies.length?'Reply queued · not yet delivered':d.replies.at(-1)?.stale?'Stale reply delivered · clarification needed':d.replies.length?'Delivered · awaiting Lead resolution':'Awaiting answer';}
export function Decisions({ decisions, connected, busy, error, loading, omittedTerminal = 0, history = false, selection, stale, onReply, onClear, onAction, onOrigin, onRefresh }: {
    decisions: DecisionView[]; connected: boolean; busy: boolean; error?: string; loading?: boolean; omittedTerminal?: number; history?: boolean; selection?: DecisionSelection; stale?: boolean;
    onReply(d: DecisionView): void; onClear(): void; onAction(d: DecisionView, type: 'decision.defer' | 'decision.cancel' | 'decision.reopen'): void; onOrigin(d: DecisionView): void; onRefresh(): void;
}) {
    const panel=useRef<HTMLElement>(null), focusedInside=useRef(false), toggle=useRef<HTMLButtonElement>(null);
    const [expanded,setExpanded]=useState(history), contentId=useId();
    useLayoutEffect(()=>{
        if(focusedInside.current && document.activeElement===document.body){
            (toggle.current ?? panel.current?.querySelector<HTMLButtonElement>('.decisions-heading button') ?? document.getElementById('prompt'))?.focus({preventScroll:true});
        }
    },[decisions,busy,loading,connected,error]);
    const body=useRef<HTMLDivElement>(null),terminalBody=useRef<HTMLDivElement>(null),terminalId=useId();
    const [terminalExpanded,setTerminalExpanded]=useState(true);
    useDisclosureMotion(body,expanded);useDisclosureMotion(terminalBody,terminalExpanded);
    const unresolved = decisions.filter(unresolvedDecision), terminal = decisions.filter(d => !unresolvedDecision(d));
    const hasRecords=history ? decisions.length>0 || omittedTerminal>0 : unresolved.length>0;
    if(!hasRecords && !selection && !error)return null;
    const row = (d: DecisionView) => <li key={d.decisionId} className="decision-row"><div className="decision-question"><p>{d.question}</p><span className="decision-state">{d.state === 'pending' ? 'Pending' : d.state === 'deferred' ? 'Deferred' : d.state === 'answered' ? 'Answered by Lead' : d.state === 'cancelled' ? 'Cancelled' : 'Superseded'}</span></div><p className="decision-progress">{(unresolvedDecision(d) || d.replies.at(-1)?.stale || d.queuedReplies.length > 0) && decisionReplyStatus(d)}</p>{d.note && <p className="decision-note">{d.note}</p>}<div className="decision-actions"><a href="#conversation" onClick={event => {event.preventDefault(); onOrigin(d);}}>View origin<span className="sr-only"> for {d.question}</span></a>{unresolvedDecision(d) && <><button type="button" className="quiet" disabled={!connected || busy} onClick={() => onReply(d)}>Reply<span className="sr-only"> to {d.question}</span></button><button type="button" className="quiet" disabled={!connected || busy} onClick={() => onAction(d, d.state === 'deferred' ? 'decision.reopen' : 'decision.defer')}>{d.state === 'deferred' ? 'Reopen' : 'Defer'}<span className="sr-only"> {d.question}</span></button><button type="button" className="quiet" disabled={!connected || busy} onClick={() => onAction(d, 'decision.cancel')}>Cancel<span className="sr-only"> decision: {d.question}</span></button></>}</div></li>;
    return <section ref={panel} onFocusCapture={()=>{focusedInside.current=true;}} onBlurCapture={event=>{if(event.relatedTarget&&!event.currentTarget.contains(event.relatedTarget as Node))focusedInside.current=false;}} className="decisions-panel" aria-label="Decisions" aria-busy={loading || undefined}>
        <div className="decisions-heading"><h2 className="sr-only">Decisions</h2>{hasRecords && <button ref={toggle} className="quiet decisions-toggle" type="button" aria-label={!history && unresolved.length ? `Decisions: ${unresolved.length} open` : 'Decision history'} aria-expanded={expanded} aria-controls={contentId} onClick={()=>setExpanded(value=>!value)}><span aria-hidden="true">{expanded?'▾':'▸'}</span><span>{!history && unresolved.length?'Decisions':'Decision history'}</span>{!history && unresolved.length>0 && <span className="decisions-count">{unresolved.length} open</span>}</button>}{(expanded||error) && <button className="quiet" type="button" disabled={!connected || busy || loading} onClick={onRefresh}>Refresh<span className="sr-only"> decisions</span></button>}</div>
        {selection && <div id="decision-target-status" className="decision-target" role="status" onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();onClear();}}}><span>{stale ? 'Question changed or closed. Select the current question, or clear this reply target.' : 'Replying to:'} <strong title={selection.question}>{selection.question.length > 128 ? selection.question.slice(0,128)+'…' : selection.question}</strong></span><button type="button" className="quiet" onClick={onClear}>Clear reply target</button></div>}
        {error && <p className="queue-error" role="alert">{error}</p>}
        <div ref={body} id={contentId} className="decisions-scroll" hidden={!expanded} tabIndex={0} aria-label="Decision list"><ul>{!history && unresolved.map(row)}</ul>{history && (terminal.length>0||omittedTerminal>0) && <div><button type="button" className="quiet" aria-expanded={terminalExpanded} aria-controls={terminalId} onClick={()=>setTerminalExpanded(v=>!v)}>Resolved decisions</button><div ref={terminalBody} id={terminalId} hidden={!terminalExpanded} inert={!terminalExpanded}><ul>{terminal.map(row)}</ul>{omittedTerminal > 0 && <p className="decision-note">Earlier decisions remain in session history.</p>}</div></div>}</div>
    </section>;
}


export function SessionDecisions({session,connected,busy,revision,selection,onReply,onClear,onError,history=false}:{session:string;connected:boolean;busy:boolean;revision:string;selection?:DecisionSelection;onReply:(d:DecisionSelection)=>void;onClear:()=>void;onError:(s:string)=>void;history?:boolean}){
 const [snapshot,setSnapshot]=useState<{session:string;decisions:DecisionView[];omittedTerminal:number}>(),[refresh,setRefresh]=useState(0);
 useEffect(()=>{if(!session||!connected)return;const abort=new AbortController();void request('GET',`/api/sessions/${encodeURIComponent(session)}/decisions`,undefined,abort.signal).then(v=>{const d=v as {sessionId:string;decisions:DecisionView[];omittedTerminal:number};if(d.sessionId!==session||!Array.isArray(d.decisions))throw Error('Invalid decisions projection');if(!abort.signal.aborted)setSnapshot({session,decisions:d.decisions,omittedTerminal:d.omittedTerminal});}).catch(e=>{if(!abort.signal.aborted)onError((e as Error).message);});return()=>abort.abort();},[session,connected,revision,refresh]);
 const decisions=snapshot?.session===session?snapshot.decisions:[];
 const selected=selection?.sessionId===session?selection:undefined;
 const current=selected&&decisions.find(d=>d.decisionId===selected.decisionId);
 return <Decisions history={history} decisions={decisions} connected={connected} busy={busy} selection={selected} stale={!!selected&&(!current||!unresolvedDecision(current)||current.questionRevision!==selected.questionRevision)} onReply={d=>{onReply({sessionId:session,decisionId:d.decisionId,revision:d.revision,questionRevision:d.questionRevision,question:d.question});document.getElementById('prompt')?.focus({preventScroll:true});}} onClear={onClear} onAction={(d,type)=>{void request('POST',`/api/sessions/${encodeURIComponent(session)}/decisions`,{commandId:crypto.randomUUID(),decisionId:d.decisionId,expectedRevision:d.revision,type,note:type==='decision.cancel'?'Cancelled by user':type==='decision.defer'?'Deferred by user':'Reopened by user'}).then(()=>setRefresh(v=>v+1)).catch(e=>onError((e as Error).message));}} onOrigin={d=>{document.getElementById('exchange-'+d.origin.promptId)?.scrollIntoView({block:'nearest'});}} onRefresh={()=>setRefresh(v=>v+1)}/>;
}
