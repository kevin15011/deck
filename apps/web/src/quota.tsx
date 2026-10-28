import React, { useEffect, useRef, useState } from 'react';
import type { QuotaRunner, QuotaState } from '../../../packages/core/src/session/quota';
import { NavigationIcon } from './project-navigation';

const empty: QuotaState = { runners: { claude: { refreshAfter: 0, refreshing: false }, codex: { refreshAfter: 0, refreshing: false } } };
const CLAUDE_REFRESH_NOTE = 'Refresh uses a tiny amount of Claude quota for one isolated Haiku request.';
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
            <div className="quota-heading"><h3>{names[runner]}</h3><span className="quota-actions">{runner === 'claude' && <span className="quota-info" tabIndex={0} role="img" aria-label={CLAUDE_REFRESH_NOTE} data-tip={CLAUDE_REFRESH_NOTE}><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.3"/><path d="M8 7.2v4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/><circle cx="8" cy="4.9" r=".85" fill="currentColor"/></svg></span>}<button type="button" className="quiet" aria-label={`Refresh ${names[runner]} quota`} disabled={loading || view.refreshing || wait > 0} onClick={() => onRefresh(runner)}>{view.refreshing ? 'Refreshing…' : wait ? `Refresh in ${wait}s` : 'Refresh'}</button></span></div>
            {snapshot ? <p className="muted">Updated {elapsed(snapshot.updatedAt, now)}{snapshot.plan ? ` · Plan: ${snapshot.plan}` : ''}</p> : <p className="muted">No quota snapshot yet</p>}
            {snapshot?.windows.length ? snapshot.windows.map(window => {
                const label = window.id === 'five-hour' ? '5-hour' : '7-day';
                return <div key={window.id} className="quota-window">
                    <div className="quota-window-label"><span>{label}</span><span>{window.usedPercent}% used</span></div>
                    <div className="quota-track" role="progressbar" aria-label={`${names[runner]} ${label} usage`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={window.usedPercent} aria-valuetext={`${window.usedPercent}% used`}><span style={{ width: `${window.usedPercent}%` }}/></div>
                    <p className="muted">{window.resetsAt ? <>Resets <time dateTime={new Date(window.resetsAt).toISOString()}>{new Date(window.resetsAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })}</time></> : 'Reset time not reported'}</p>
                </div>;
            }) : <p className="quota-empty">{snapshot ? 'No subscription quota data' : 'Refresh to check subscription quota.'}</p>}
            {snapshot?.overageStatus?.startsWith('allowed') && <p className="muted">Extra usage enabled: billed beyond plan limits</p>}
        </section>;
    })}</div>;
}

const COLLAPSED_KEY = 'deck.usage-collapsed';
export const QUOTA_POLL_MS = 15_000;
const readCollapsed = () => { try { return localStorage.getItem(COLLAPSED_KEY) === 'true'; } catch { return false; } };

/** Sidebar/drawer section above the Deck menu. Rereads host state periodically while visible; never polls runners. */
export function QuotaSection({ api }: { api(path: string, init?: RequestInit): Promise<any> }) {
    const controller = useRef<AbortController | null>(null);
    const [collapsed, setCollapsed] = useState(readCollapsed);
    const [state, setState] = useState<QuotaState>(empty), [loading, setLoading] = useState(true), [message, setMessage] = useState(''), [now, setNow] = useState(Date.now);
    useEffect(() => { try { localStorage.setItem(COLLAPSED_KEY, String(collapsed)); } catch { /* Preferences are optional. */ } }, [collapsed]);
    useEffect(() => {
        const abort = new AbortController(); controller.current = abort;
        let reading = false;
        // Host-only read: snapshots update from every runner turn's rate-limit events; never calls a runner.
        const read = (initial = false) => {
            if (reading || abort.signal.aborted || (!initial && document.visibilityState === 'hidden')) return;
            reading = true;
            void api('/api/quota', { signal: abort.signal }).then(data => { if (!abort.signal.aborted) { setState(data); setMessage(previous => previous === 'Could not read quota.' ? '' : previous); } })
                .catch(error => { if (!abort.signal.aborted && initial) setMessage(error.message || 'Could not read quota.'); })
                .finally(() => { reading = false; if (!abort.signal.aborted && initial) setLoading(false); });
        };
        read(true);
        const timer = setInterval(read, QUOTA_POLL_MS);
        const visible = () => { if (document.visibilityState === 'visible') read(); };
        document.addEventListener('visibilitychange', visible);
        return () => { abort.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
    }, [api]);
    useEffect(() => {
        if (collapsed) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [collapsed]);
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
    return <QuotaSectionView collapsed={collapsed} onToggle={() => setCollapsed(value => !value)} state={state} now={now} loading={loading} message={message} onRefresh={runner => void refresh(runner)}/>;
}

export function quotaSummary(state: QuotaState) {
    return (['claude', 'codex'] as const).flatMap(runner => {
        const windows = state.runners[runner].snapshot?.windows ?? [];
        return windows.length ? [`${names[runner]} ${Math.max(...windows.map(window => window.usedPercent))}%`] : [];
    }).join(' · ');
}

export function QuotaSectionView({ collapsed, onToggle, state, now, loading, message, onRefresh }: { collapsed: boolean; onToggle(): void; state: QuotaState; now: number; loading: boolean; message: string; onRefresh(runner: QuotaRunner): void }) {
    const summary = quotaSummary(state);
    return <section className="usage-section" aria-labelledby="usage-section-title">
        <button type="button" className="quiet usage-toggle" aria-expanded={!collapsed} aria-controls="usage-section-body" onClick={onToggle}>
            <NavigationIcon kind="chevron" expanded={!collapsed}/><span id="usage-section-title">Usage</span>{collapsed && summary && <span className="usage-summary">{summary}</span>}
        </button>
        <div id="usage-section-body" className="usage-body" hidden={collapsed}>
            <QuotaContents state={state} now={now} loading={loading} onRefresh={onRefresh}/>
            <p className="quota-status muted" role="status" aria-live="polite">{loading ? 'Reading latest quota…' : message}</p>
        </div>
    </section>;
}
