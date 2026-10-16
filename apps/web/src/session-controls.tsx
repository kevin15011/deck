import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SessionApprovals, type ApprovalMode, type ApprovalModeSource } from './session-approvals';
import type { Api } from './workspace';
import type { Preparation } from './workspace-types';

export function useSessionPreparation(api: Api, sessionId: string, connected: boolean, generation: number, signal: number) {
    const [preparation, setPreparation] = useState<Preparation>(), [error, setError] = useState('');
    const current = useRef<Preparation | undefined>(undefined), request = useRef(0);
    const update = useCallback((next: Preparation) => { ++request.current; current.current = next; setPreparation(next); setError(''); }, []);
    const refresh = useCallback(async () => {
        if (!sessionId || !connected) return;
        const version = ++request.current;
        try { const reply = await api(`/api/sessions/${encodeURIComponent(sessionId)}/readiness`); if (version === request.current) update(reply.data); }
        catch (cause) { if (version === request.current) setError((cause as Error).message); }
    }, [api, sessionId, connected, generation, update]);
    useEffect(() => {
        current.current = undefined; setPreparation(undefined); setError('');
        void refresh();
        const timer = setInterval(() => { if (current.current?.status === 'preparing' || current.current?.status === 'releasing') void refresh(); }, 1000);
        return () => { ++request.current; clearInterval(timer); };
    }, [refresh]);
    useEffect(() => { if (signal) void refresh(); }, [signal, refresh]);
    return { preparation, error, update, refresh };
}

export function SessionControls({ approvalMode, approvalModeSource, onApprovals, connected, ended, working, busy, closing = false, releaseFailed = false, removing = false, preparation, error, sharedActive, predecessor, showPrimary = true, onReconnect, onPrepare, onCancel, onClose, onAssignments, onPredecessor }: {
    approvalMode?:ApprovalMode; approvalModeSource?:ApprovalModeSource; onApprovals?:(mode:ApprovalMode)=>Promise<unknown>;
    connected: boolean; ended: boolean; working: boolean; busy: boolean; closing?: boolean; releaseFailed?: boolean; removing?: boolean; preparation?: Preparation; error?: string; sharedActive: number; predecessor?: string; showPrimary?: boolean;
    onReconnect: () => void; onPrepare: () => void; onCancel: () => void; onClose: () => void; onAssignments: () => void; onPredecessor: () => void;
}) {
    const ready = preparation?.status === 'ready';
    const releasing = closing || preparation?.status === 'releasing';
    const status = releaseFailed ? removing ? 'Could not remove session' : 'Could not close session' : releasing ? removing ? 'Removing session…' : 'Closing session…' : !connected ? 'Connection unavailable. Your draft is kept.' : preparation?.status === 'preparing' ? 'Preparing session…' : ready ? 'Ready to send' : preparation?.status === 'failed' ? 'Preparation failed' : preparation?.status === 'cancelled' ? 'Preparation cancelled' : 'Prepare this session before sending.';
    return <section className="session-controls" aria-label="Session controls"><div className="session-control-status"><p role="status">{status}</p>{releasing ? <small>Waiting for session resources to stop. History and drafts are kept.</small> : !ready && connected && <small>Preparation checks setup without sending a model prompt.</small>}{preparation?.reasonCode && <small>{preparation.reasonCode}</small>}{sharedActive > 0 && <small className="shared-workspace">Shared directory · {sharedActive} other active {sharedActive === 1 ? 'session' : 'sessions'}</small>}{predecessor && <button type="button" className="quiet predecessor-link" onClick={onPredecessor}>Continued from {predecessor.slice(0, 8)}</button>}</div>
        <div className="session-control-actions">{onApprovals&&<SessionApprovals mode={approvalMode} source={approvalModeSource} disabled={busy||!connected||releasing} onChange={onApprovals}/>}{!connected && showPrimary && <button type="button" disabled={busy} onClick={onReconnect}>Reconnect</button>}
            {(showPrimary || ready) && (releasing ? <button type="button" className="quiet" disabled={!releaseFailed || busy || !connected} onClick={onClose}>{releaseFailed ? removing ? 'Retry removal' : 'Retry close' : removing ? 'Removing session…' : 'Closing session…'}</button> : preparation?.status === 'preparing' ? <button type="button" className="quiet" disabled={busy || !preparation.preparationId} onClick={onCancel}>Cancel preparation</button> : <button type="button" className="quiet" disabled={busy || !connected || (working && !ended && ready)} onClick={onPrepare}>Prepare session</button>)}
            <button type="button" className="quiet" disabled={busy || !connected || releasing} onClick={onAssignments}>Assignments</button>{!ended && <button type="button" className="quiet" disabled={busy || !connected || releasing} onClick={onClose}>Close session</button>}
        </div>{error && <p className="error" role="alert">{error}</p>}</section>;
}
