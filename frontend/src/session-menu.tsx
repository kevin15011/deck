import React, {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {gsap} from 'gsap';
import {API, request, load, save, HttpError, type Session} from './api';
import {SessionApprovals, type ApprovalMode} from './session-approvals';
import {listenForDismissal} from './dismiss-layer';
import {useSurfacePresence} from './control-motion';
import {SecondaryInfo} from './secondary-info';
import './session-menu.css';
import {runtimeState as mcpState,type RuntimeState as McpState} from './presentation';

/** The header owns session controls; the composer keeps its draft and keyboard state. */
export function SessionMenu({session, connected, blocked, working, onAssignments, onChanged}: {session:Session; connected:boolean; blocked:boolean; working:boolean; onAssignments:()=>void; onChanged:()=>Promise<void>}) {
    const [open,setOpen]=useState(false), [data,setData]=useState<McpState>(), [loading,setLoading]=useState(false), [error,setError]=useState(''), [pending,setPending]=useState(''), [notice,setNotice]=useState(''), [refresh,setRefresh]=useState(0);
    const root=useRef<HTMLDivElement>(null), trigger=useRef<HTMLButtonElement>(null), panel=useRef<HTMLElement>(null), chevron=useRef<SVGSVGElement>(null), alive=useRef(true), operation=useRef(false);
    const present=useSurfacePresence(panel,open), id=useId();
    const close=(restore=false)=>{setOpen(false);if(restore)trigger.current?.focus({preventScroll:true});};
    useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
    useEffect(()=>listenForDismissal(document, {
        isOpen:()=>open && !root.current?.querySelector('dialog[open]'),
        contains:target=>target instanceof Element && (!!root.current?.contains(target) || !!target.closest('.secondary-info-panel')),
        dismiss:reason=>close(reason==='escape'), node:()=>root.current,
    }),[open]);
    useLayoutEffect(()=>{
        const node=chevron.current;if(!node)return;
        const media=matchMedia('(prefers-reduced-motion: reduce)');
        const paint=()=>{gsap.killTweensOf(node);gsap.to(node,{rotation:open?180:0,duration:media.matches?0:.18,ease:'power2.out',overwrite:true});};
        paint();media.addEventListener('change',paint);return()=>{media.removeEventListener('change',paint);gsap.killTweensOf(node);};
    },[open]);
    useEffect(()=>{
        if(!open || !connected)return;
        const controller=new AbortController();setLoading(true);setError('');
        void request('GET',`/api/sessions/${encodeURIComponent(session.id)}/runtime`,undefined,controller.signal).then(raw=>{const next=mcpState(raw,session.id);if(!controller.signal.aborted)setData(next);}).catch(e=>{if(!controller.signal.aborted){setData(undefined);setError(String(e));}}).finally(()=>{if(!controller.signal.aborted)setLoading(false);});
        return()=>controller.abort();
    },[open,connected,session.id,refresh]);
    async function perform(name:string, action:()=>Promise<unknown>) {
        if(operation.current || !connected)return;
        operation.current=true;setPending(name);setError('');setNotice('');
        try {await action();await onChanged();if(alive.current){setNotice(name==='restart'?'Session restarted. Your conversation and draft are kept.':'Session grants revoked.');setRefresh(v=>v+1);}}
        catch(e){if(alive.current)setError(String(e));}
        finally{operation.current=false;if(alive.current)setPending('');}
    }
    async function restart() {
        if(!data)return;
        const key=`restart.${location.host}.${session.id}`;
        let command:{api:number;command_id:string;expected_epoch:number};
        const retained=load(key);
        if(retained){
            command=JSON.parse(retained);
            if(command.api!==API || typeof command.command_id!=='string' || !Number.isSafeInteger(command.expected_epoch))throw Error('Retained restart identity is invalid. Your draft is kept.');
        }else{
            command={api:API,command_id:crypto.randomUUID(),expected_epoch:data.epoch};
            save(key,JSON.stringify(command));
        }
        try {
            const next=mcpState(await request('POST',`/api/sessions/${encodeURIComponent(session.id)}/restart`,command),session.id);
            if(next.epoch!==command.expected_epoch+1)throw Error('Restart epoch was not confirmed. Retry the retained restart.');
            save(key,'');setData(next);
        }catch(e){
            if(e instanceof HttpError && e.status>=400 && e.status<500){save(key,'');}
            throw e;
        }
    }
    const disabled=!connected || blocked || !!pending;
    return <div className="session-compact session-menu" ref={root} onBlur={event=>{if(event.relatedTarget instanceof Element && !event.currentTarget.contains(event.relatedTarget) && !event.relatedTarget.closest('.secondary-info-panel'))close();}}>
        <button ref={trigger} type="button" className={'quiet session-compact-toggle'+(connected?' ready':'')} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(v=>!v)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);requestAnimationFrame(()=>panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus());}}}><span className="session-compact-dot" aria-hidden="true"/><span>Session</span><svg ref={chevron} className="session-compact-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button>
        {present&&<section ref={panel} id={id} className="session-controls-panel session-menu-panel" aria-label="Session controls" inert={!open} aria-hidden={!open}>
            <div className="session-control-status"><p role="status">{pending==='restart'?'Restarting session…':working?'Working':connected?'Connected':'Disconnected'}</p><small>MCP is checked on each message; native plugins may refresh between messages.</small></div>
            <div className="session-menu-secondary">{data&&<p role="status">{data.capabilities.retained_runtime?`Retained runtime: ${data.resources?.state??'not started'} · ${data.resources?.threads}/${data.resources?.thread_limit} threads · ${data.resources?.processes}/${data.resources?.process_limit} processes`:'Retained runtime unavailable for this session.'}</p>}<SecondaryInfo title="MCP servers" label="MCP servers" resetKey={session.id}>
                {loading?<p role="status">Loading session MCP servers…</p>:data?<><p>{data.catalog_verified?`${data.catalog_scoped?'Last observed Deck session MCP':'Last observed MCP inventory'}${data.catalog_observed_ms ? ' · '+new Date(data.catalog_observed_ms).toLocaleString() : ''}`:'MCP inventory will be verified on the next message'}</p>{data.catalog.length?<ul className="session-mcp-list">{data.catalog.map((server,index)=><li key={`${server.name}:${index}`}><strong>{server.name}</strong>{server.status&&<small>{server.status}</small>}{server.tools?.length? <small>{server.tools.join(' · ')}</small>:null}</li>)}</ul>:<p>No verified MCP servers to display.</p>}<small>{data.capabilities.retained_runtime?data.message:'Current integration does not expose a retained runtime. MCP inventory is an observation, not launch authority.'}</small></>:<p role="status">Session MCP state is unavailable.</p>}
            </SecondaryInfo></div>
            <SessionApprovals mode={session.contract?.approvals==='yolo'?'yolo':'relay'} disabled={disabled} onChange={async (mode:ApprovalMode)=>{await request('POST',`/api/sessions/${encodeURIComponent(session.id)}/approvals`,{api:API,mode});await onChanged();}}/>
            <div className="session-control-actions">
                <button type="button" className="quiet" disabled={disabled} onClick={()=>{close(true);onAssignments();}}>Session assignments</button>
                <button type="button" className="quiet" disabled={disabled} onClick={()=>void perform('revoke',()=>request('POST',`/api/sessions/${encodeURIComponent(session.id)}/grants/revoke`,{}))}>Revoke session grants</button>
                <button type="button" className="quiet" disabled={disabled||working||loading||!data?.capabilities.target_restart} onClick={()=>void perform('restart',restart)}>Restart session</button>
            </div>
            {working&&<small>Wait for current work to settle before restarting.</small>}{data?.state==='restart_required'&&<p role="status">Session restart required.</p>}{notice&&<p role="status">{notice}</p>}{error&&<p className="error" role="alert">{error}<button type="button" className="quiet" disabled={!!pending||!connected} onClick={()=>setRefresh(v=>v+1)}>Reload session state</button></p>}
        </section>}
    </div>;
}
