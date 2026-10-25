import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { QuotaRunner, QuotaState } from '../../../packages/core/src/session/quota';
import { useDismissLayer } from './dismiss-layer';

const empty: QuotaState = { runners: { claude: { refreshAfter: 0, refreshing: false }, codex: { refreshAfter: 0, refreshing: false } } };
const names = { claude: 'Claude', codex: 'Codex' };
const elapsed = (at: number, now: number) => {
    const seconds = Math.max(0, Math.floor((now - at) / 1000));
    return seconds < 60 ? 'just now' : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;
};
export function QuotaContents({ state, now, onRefresh, loading = false }: { state: QuotaState; now: number; onRefresh(runner: QuotaRunner): void; loading?: boolean }) {
    return <div className="quota-runners">{(['claude', 'codex'] as const).map(runner => {
        const view = state.runners[runner], snapshot = view.snapshot;
        const wait = Math.max(0, Math.ceil((view.refreshAfter - now) / 1000));
        return <section key={runner} className={`quota-runner quota-${runner}`} aria-label={`${names[runner]} quota`}>
            <div className="quota-heading"><h3>{names[runner]}</h3><button type="button" className="quiet" aria-label={`Refresh ${names[runner]} quota`} disabled={loading || view.refreshing || wait > 0} onClick={() => onRefresh(runner)}>{view.refreshing ? 'Refreshing…' : wait ? `Refresh in ${wait}s` : 'Refresh'}</button></div>
            {snapshot ? <p className="muted">Updated {elapsed(snapshot.updatedAt, now)}{snapshot.plan ? ` · Plan: ${snapshot.plan}` : ''}</p> : <p className="muted">No quota snapshot yet</p>}
            {snapshot?.windows.length ? snapshot.windows.map(window => {
                const label = window.id === 'five-hour' ? '5-hour' : '7-day';
                return <div key={window.id} className="quota-window">
                    <div className="quota-window-label"><span>{label}</span><span>{window.usedPercent}% used</span></div>
                    <div className="quota-track" role="progressbar" aria-label={`${names[runner]} ${label} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.usedPercent} aria-valuetext={`${window.usedPercent}% used`}><span style={{ width: `${window.usedPercent}%` }}/></div>
                    <p className="muted">{window.resetsAt ? <>Resets <time dateTime={new Date(window.resetsAt).toISOString()}>{new Date(window.resetsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}</time></> : 'Reset time not reported'}</p>
                </div>;
            }) : <p className="quota-empty">{snapshot ? 'No subscription quota data' : 'Refresh to check subscription quota.'}</p>}
            {snapshot?.overageStatus && <p className="muted">Overage: {snapshot.overageStatus}</p>}
            {runner === 'claude' && <p className="quota-note">Refresh uses a tiny amount of Claude quota for one isolated Haiku request.</p>}
        </section>;
    })}</div>;
}

/** Modal is outside the drawer; closing navigation cannot hide it. No runner polling. */
export function QuotaDialog({ api, onClose }: { api(path: string, init?: RequestInit): Promise<any>; onClose(): void }) {
    const dialog = useRef<HTMLDialogElement>(null), contents = useRef<HTMLDivElement>(null), controller = useRef<AbortController | null>(null);
    const [state, setState] = useState<QuotaState>(empty), [loading, setLoading] = useState(true), [message, setMessage] = useState(''), [now, setNow] = useState(Date.now);
    useDismissLayer({ open: true, roots: [contents], onDismiss: onClose });
    useLayoutEffect(() => { const node = dialog.current!; node.showModal(); return () => node.close(); }, []);
    useEffect(() => {
        const abort = new AbortController(); controller.current = abort;
        void api('/api/quota', { signal: abort.signal }).then(data => { if (!abort.signal.aborted) setState(data); }).catch(error => { if (!abort.signal.aborted) setMessage(error.message || 'Could not read quota.'); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => { abort.abort(); clearInterval(timer); };
    }, [api]);
    async function refresh(runner: QuotaRunner) {
        const signal = controller.current?.signal;
        if (!signal || signal.aborted || loading || state.runners[runner].refreshing) return;
        setMessage('');
        setState(previous => ({ runners: { ...previous.runners, [runner]: { ...previous.runners[runner], refreshing: true } } }));
        try {
            const data = await api(`/api/quota/${runner}/refresh`, { method: 'POST', body: '{}', signal });
            if (!signal.aborted) { setState(data.state); setNow(Date.now()); setMessage(`${names[runner]} quota updated.`); }
        } catch (error) {
            if (signal.aborted) return;
            setMessage((error as Error).message || 'Could not refresh quota. Previous snapshot kept.');
            // Read host cooldown after a failed response; this does not call a runner.
            try { const data = await api('/api/quota', { signal }); if (!signal.aborted) setState(data); }
            catch { if (!signal.aborted) setState(previous => ({ runners: { ...previous.runners, [runner]: { ...previous.runners[runner], refreshing: false, refreshAfter: Date.now() + 60_000 } } })); }
        }
    }
    return <dialog ref={dialog} className="workspace-dialog quota-dialog" aria-labelledby="quota-title" onCancel={event => { event.preventDefault(); event.stopPropagation(); onClose(); }}>
        <div ref={contents} className="quota-contents">
            <div className="dialog-heading"><h2 id="quota-title">Quota usage</h2><button autoFocus type="button" className="quiet" aria-label="Close quota usage" onClick={onClose}>✕</button></div>
            <QuotaContents state={state} now={now} loading={loading} onRefresh={runner => void refresh(runner)}/>
            <p className="quota-status muted" role="status" aria-live="polite">{loading ? 'Reading latest quota…' : message}</p>
            <div className="dialog-actions"><button type="button" onClick={onClose}>Done</button></div>
        </div>
    </dialog>;
}
