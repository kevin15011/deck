import { PersonalMcpAvailabilityView } from "./personal-mcp-availability";
import { CODEBASE_UNAVAILABLE_MESSAGE } from "../../../packages/core/src/session/mcp";
import { SessionPermissions, type SessionGrant } from './approvals';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SessionApprovals, type ApprovalMode, type ApprovalModeSource } from './session-approvals';
import { listenForDismissal } from './dismiss-layer';
import type { Api } from './workspace';
import type { Preparation } from './workspace-types';

export function useSessionPreparation(api: Api, sessionId: string, connected: boolean, generation: number, signal: number) {
    const scope = `${sessionId}:${generation}`;
    const [snapshot, setSnapshot] = useState<{scope:string; preparation:Preparation}>(), [error, setError] = useState('');
    const current = useRef<Preparation | undefined>(undefined), request = useRef(0), online = useRef(connected);
    online.current = connected;
    const update = useCallback((next: Preparation) => { ++request.current; current.current = next; setSnapshot({scope,preparation:next}); setError(''); }, [scope]);
    const refresh = useCallback(async () => {
        if (!sessionId || !online.current) return;
        const version = ++request.current;
        try { const reply = await api(`/api/sessions/${encodeURIComponent(sessionId)}/readiness`); if (version === request.current) update(reply.data); }
        catch (cause) { if (version === request.current) setError((cause as Error).message); }
    }, [api, sessionId, generation, update]);
    useEffect(() => {
        current.current = undefined; setSnapshot(undefined); setError('');
        const timer = setInterval(() => { if (current.current?.status === 'preparing' || current.current?.status === 'releasing') void refresh(); }, 1000);
        return () => { ++request.current; clearInterval(timer); };
    }, [refresh]);
    useEffect(() => { if (connected) void refresh(); }, [connected, refresh]);
    useEffect(() => { if (signal) void refresh(); }, [signal, refresh]);
    return { preparation:snapshot?.scope===scope?snapshot.preparation:undefined, error, update, refresh };
}

export function SessionControls({ grants=[], onRevokeGrant, approvalMode, approvalModeSource, onApprovals, connected, ended, working, busy, closing = false, releaseFailed = false, removing = false, preparation, error, sharedActive, predecessor, showPrimary = true, compact = false, onReconnect, onPrepare, onCancel, onClose, onAssignments, onPredecessor }: {
    grants?:SessionGrant[]; onRevokeGrant?:(id:string)=>Promise<unknown>;
    approvalMode?:ApprovalMode; approvalModeSource?:ApprovalModeSource; onApprovals?:(mode:ApprovalMode)=>Promise<unknown>;
    connected: boolean; ended: boolean; working: boolean; busy: boolean; closing?: boolean; releaseFailed?: boolean; removing?: boolean; preparation?: Preparation; error?: string; sharedActive: number; predecessor?: string; showPrimary?: boolean; compact?: boolean;
    onReconnect: () => void; onPrepare: () => void; onCancel: () => void; onClose: () => void; onAssignments: () => void; onPredecessor: () => void;
}) {
    const ready = preparation?.status === 'ready';
    const releasing = closing || preparation?.status === 'releasing';
    const status = releaseFailed ? removing ? 'Could not remove session' : 'Could not close session' : releasing ? removing ? 'Removing session…' : 'Closing session…' : !connected && !preparation ? 'Loading session…' : preparation?.status === 'preparing' ? 'Preparing session…' : ready ? connected ? 'Ready to send' : 'Session prepared' : preparation?.status === 'failed' ? 'Preparation failed' : preparation?.status === 'cancelled' ? 'Preparation cancelled' : 'Prepare this session before sending.';
    const [open, setOpen] = useState(false);
    const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), notes = useRef<HTMLDivElement>(null);
    const [notesTitle, setNotesTitle] = useState<string>();
    // One-line notes ellipsize; the full text stays available as a tooltip.
    useEffect(() => { setNotesTitle(notes.current?.textContent || undefined); });
    useEffect(() => {
        if (!compact) return;
        // MCP details render in a top-layer popover outside this subtree; interacting with it keeps the panel open.
        return listenForDismissal(document, {
            isOpen: () => open,
            contains: target => target instanceof Element && (!!root.current?.contains(target) || !!target.closest('.secondary-info-panel')),
            dismiss: reason => { setOpen(false); if (reason === 'escape') trigger.current?.focus({ preventScroll: true }); },
            node: () => root.current,
        });
    }, [compact, open]);
    const section = <section id={compact ? 'session-controls-panel' : undefined} className={`session-controls${compact ? ' session-controls-panel' : ''}`} aria-label="Session controls"><div className="session-control-status"><p role="status">{status}</p><div className="session-control-notes" ref={notes} title={notesTitle}>{releasing ? <small>Waiting for session resources to stop. History and drafts are kept.</small> : !ready && connected && <small>Preparation checks setup without sending a model prompt.</small>}{preparation?.reasonCode && <small>{["codebase-memory-unsupported", "codebase-memory-unavailable"].includes(preparation.reasonCode) && ready ? CODEBASE_UNAVAILABLE_MESSAGE : ({"personal-mcp-managed-exclusive":"Your managed Claude MCP policy requires a native configuration that Deck cannot safely replace.","personal-mcp-remote-config-isolation-unavailable":"This OpenCode account supplies remote configuration. Deck cannot isolate it without executing that configuration.","personal-mcp-auth-config-unavailable":"OpenCode account configuration could not be checked safely.","personal-mcp-reserved-config-conflict":"A personal MCP conflicts with a Deck server. Review the server details below."} as Record<string,string>)[preparation.reasonCode] ?? preparation.reasonCode}</small>}{sharedActive > 0 && <small className="shared-workspace">Shared directory · {sharedActive} other active {sharedActive === 1 ? 'session' : 'sessions'}</small>}{predecessor && <button type="button" className="quiet predecessor-link" onClick={onPredecessor}>Continued from {predecessor.slice(0, 8)}</button>}</div>{error && <p className="error" role="alert" title={error}>{error}</p>}</div>
        <div className="session-secondary-actions"><div><PersonalMcpAvailabilityView entries={preparation?.personalMcpAvailability} runnerId={preparation?.personalMcpRunnerId} members={preparation?.memberMcpAvailability}/></div><div>{onRevokeGrant&&<SessionPermissions grants={grants} onRevoke={onRevokeGrant} busy={busy||!connected||releasing}/>}</div></div><div className="session-control-actions">{onApprovals&&<SessionApprovals mode={approvalMode} source={approvalModeSource} disabled={busy||!connected||releasing} onChange={onApprovals}/>}
            <span className={`session-primary-action${showPrimary || ready ? '' : ' control-placeholder'}`}>{releasing ? <button type="button" className="quiet" disabled={!releaseFailed || busy || !connected} onClick={onClose}>{releaseFailed ? removing ? 'Retry removal' : 'Retry close' : removing ? 'Removing session…' : 'Closing session…'}</button> : preparation?.status === 'preparing' ? <button type="button" className="quiet" disabled={busy || !preparation.preparationId} onClick={onCancel}>Cancel preparation</button> : <button type="button" className="quiet" disabled={busy || !connected || (working && !ended && ready)} onClick={onPrepare}>Prepare session</button>}</span>
            <button type="button" className="quiet" disabled={busy || !connected || releasing} onClick={onAssignments}>Assignments</button><button type="button" className={`quiet${ended?' control-placeholder':''}`} disabled={ended || busy || !connected || releasing} onClick={onClose}>Close session</button>
        </div></section>;
    if (!compact) return section;
    const label = releasing ? 'Closing' : preparation?.status === 'preparing' ? 'Preparing' : preparation?.status === 'failed' ? 'Failed' : ready ? connected ? 'Ready' : 'Prepared' : !connected && !preparation ? 'Loading' : 'Prepare';
    const tone = error || releaseFailed || preparation?.status === 'failed' ? ' failed' : ready && connected ? ' ready' : !releasing && preparation?.status !== 'preparing' && preparation ? ' action' : '';
    return <div className="session-compact" ref={root}><button ref={trigger} type="button" className={`quiet session-compact-toggle${tone}`} aria-label={`Session: ${status}`} title={status} aria-expanded={open} aria-controls="session-controls-panel" onClick={() => setOpen(value => !value)}><span className="session-compact-dot" aria-hidden="true"/><span>{label}</span><svg className="session-compact-chevron" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></button>{open && section}</div>;
}
