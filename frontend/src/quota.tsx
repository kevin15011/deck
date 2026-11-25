import { useDisclosureMotion } from './view-motion';
import React, { useEffect, useId, useRef, useState } from 'react';
import type { QuotaRunner, QuotaState, QuotaWindow } from './quota-types';
import { NavigationIcon } from './navigation-icon';
import { RunnerMark } from './runner-mark';

const empty: QuotaState = { runners: { claude: { refreshAfter: 0, refreshing: false }, codex: { refreshAfter: 0, refreshing: false }, agy: { refreshAfter: 0, refreshing: false } } };
const names = { claude: 'Claude', codex: 'Codex', agy: 'Antigravity' };
const runners = ['claude', 'codex', 'agy'] as const;
const composerWindows = {
    claude: [{id:'five-hour', label:'5h'}, {id:'seven-day', label:'Week'}],
    codex: [{id:'seven-day', label:'Week'}],
    agy: [{id:'five-hour', label:'5h'}, {id:'seven-day', label:'Week'}],
} as const;
// Quota snapshots store percentages to one decimal place.
const remainingPercent = (usedPercent: number) => (1000 - Math.round(usedPercent * 10)) / 10;
const windowLabels = {
    'five-hour': '5-hour',
    'seven-day': '7-day',
    'seven-day-oauth-apps': '7-day · Claude Code and apps',
    'seven-day-opus': '7-day · Opus',
    'seven-day-sonnet': '7-day · Sonnet',
} as const;
const windowLabel = (id: QuotaWindow['id']) => id in windowLabels
    ? windowLabels[id as keyof typeof windowLabels]
    : `7-day · ${id.slice('model:'.length)}`;
const isStale = (window: QuotaWindow, now: number) => window.resetsAt != null && window.resetsAt <= now;
const quotaTone = (remaining: number) => remaining <= 5 ? 'critical' : remaining <= 10 ? 'warning' : undefined;
const resetDuration = (remainingMs: number) => {
    const totalMinutes = Math.floor(remainingMs / 60_000);
    if (totalMinutes < 1) return 'less than 1 minute';
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor(totalMinutes / 60) % 24;
    const minutes = totalMinutes % 60;
    return [days && `${days}d`, hours && `${hours}h`, minutes && `${minutes}m`].filter(Boolean).join(' ');
};
const elapsed = (at: number, now: number) => {
    const seconds = Math.max(0, Math.floor((now - at) / 1000));
    return seconds < 60 ? 'just now' : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago` : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;
};
export function QuotaContents({ state, now, onRefresh, loading = false }: { state: QuotaState; now: number; onRefresh(runner: QuotaRunner): void; loading?: boolean }) {
    return <div className="quota-runners">{runners.map(runner => {
        const view = state.runners[runner], snapshot = view.snapshot;
        const wait = Math.max(0, Math.ceil((view.refreshAfter - now) / 1000));
        return <section key={runner} className={`quota-runner quota-${runner}`} aria-label={`${names[runner]} quota`}>
            <div className="quota-heading"><h3>{names[runner]}</h3><span className="quota-actions"><button type="button" className="quiet" aria-label={`Refresh ${names[runner]} quota`} disabled={view.supported===false || loading || view.refreshing || wait > 0} onClick={() => onRefresh(runner)}>{view.refreshing ? 'Refreshing…' : wait ? `Refresh in ${wait}s` : 'Refresh'}</button></span></div>
            {view.supported===false ? <p className="muted">Quota refresh is not yet available for this runner.</p> : snapshot ? <p className="muted">Updated {elapsed(snapshot.updatedAt, now)}{snapshot.plan ? ` · Plan: ${snapshot.plan}` : ''}</p> : <p className="muted">No quota snapshot yet</p>}
            {view.supported===false ? null : snapshot?.windows.length ? snapshot.windows.map(window => {
                const label = windowLabel(window.id);
                const remaining = remainingPercent(window.usedPercent);
                const valueText = `${remaining}% remaining`;
                const resetAt = window.resetsAt;
                const resetDate = resetAt == null ? null : new Date(resetAt);
                const resetIn = resetDate && Number.isFinite(resetDate.getTime()) ? resetDate.getTime() - now : null;
                return <div key={window.id} className="quota-window" data-quota-tone={quotaTone(remaining)}>
                    <div className="quota-window-label"><span>{label}</span><span className="quota-value">{valueText}</span></div>
                    <div className="quota-track" role="progressbar" aria-label={`${names[runner]} ${label} subscription quota`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={remaining} aria-valuetext={valueText}><span style={{ width: `${remaining}%` }}/></div>
                    <p className="muted">{resetDate && resetIn !== null ? <>
                        {resetIn > 0 && 'Resets in '}
                        <time dateTime={resetDate.toISOString()} title={resetDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'long' })}>
                            {resetIn > 0 ? resetDuration(resetIn) : 'Scheduled reset time passed'}
                        </time>
                    </> : 'Reset time not reported'}</p>
                </div>;
            }) : <p className="quota-empty">{snapshot ? 'No subscription quota data' : 'Refresh to check subscription quota.'}</p>}
            {view.error && <p className="quota-note">{view.error}{snapshot ? ' Showing the last reported quota.' : ''}</p>}
            {snapshot?.overageStatus?.startsWith('allowed') && <p className="muted">Extra usage enabled: billed beyond plan limits</p>}
        </section>;
    })}</div>;
}

export const QUOTA_POLL_MS = 15_000;

type QuotaModel = {
    state: QuotaState;
    loading: boolean;
    message: string;
    onRefresh(runner: QuotaRunner): void;
};

/** A single host snapshot feed for the sidebar and composer. Only explicit refresh invokes a runner. */
export function useQuota(api: (path: string, init?: RequestInit) => Promise<any>, connected: boolean): QuotaModel {
    const controller = useRef<AbortController | null>(null);
    const pending = useRef(new Set<QuotaRunner>());
    const revision = useRef(0);
    const [state, setState] = useState<QuotaState>(empty);
    const [loading, setLoading] = useState(true);
    const [readError, setReadError] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (!connected) return;
        const abort = new AbortController();
        controller.current = abort;
        let reading = false;
        const read = () => {
            if (reading || abort.signal.aborted || document.visibilityState === 'hidden') return;
            const requestedRevision = revision.current;
            reading = true;
            void api('/api/quota', { signal: abort.signal }).then((data: QuotaState) => {
                if (abort.signal.aborted) return;
                if (requestedRevision === revision.current) {
                    setState(previous => ({
                        runners: {
                            claude: pending.current.has('claude') ? previous.runners.claude : data.runners.claude,
                            codex: pending.current.has('codex') ? previous.runners.codex : data.runners.codex,
                            agy: pending.current.has('agy') ? previous.runners.agy : (data.runners.agy ?? previous.runners.agy),
                        },
                    }));
                }
                setReadError('');
            }).catch(() => {
                if (!abort.signal.aborted) setReadError('Could not read the latest quota.');
            }).finally(() => {
                reading = false;
                if (!abort.signal.aborted) setLoading(false);
            });
        };
        read();
        const timer = setInterval(read, QUOTA_POLL_MS);
        document.addEventListener('visibilitychange', read);
        return () => {
            abort.abort();
            pending.current.clear();
            clearInterval(timer);
            document.removeEventListener('visibilitychange', read);
        };
    }, [api, connected]);

    function updateRunner(runner: QuotaRunner, view: QuotaState['runners'][QuotaRunner]) {
        setState(previous => ({runners: {...previous.runners, [runner]: view}}));
    }

    async function refresh(runner: QuotaRunner) {
        const signal = controller.current?.signal;
        const view = state.runners[runner];
        if (!connected || !signal || signal.aborted || loading || view.refreshing || pending.current.has(runner)) return;
        pending.current.add(runner);
        revision.current++;
        setMessage('');
        updateRunner(runner, {...view, error: undefined, refreshing: true});
        try {
            const data: {state: QuotaState} = await api(`/api/quota/${runner}/refresh`, {method: 'POST', body: '{}', signal});
            if (!signal.aborted) {
                updateRunner(runner, data.state.runners[runner]);
                setMessage(`${names[runner]} quota updated.`);
            }
        } catch (error) {
            if (!signal.aborted) {
                updateRunner(runner, view);
                setMessage(`${names[runner]} · ${(error as Error).message || 'Could not refresh quota.'}`);
            }
        } finally {
            if (!signal.aborted) {
                pending.current.delete(runner);
                revision.current++;
            }
        }
    }

    return {
        state,
        loading: connected && loading,
        message: connected ? readError || message : 'Offline · showing the last reported quota.',
        onRefresh: runner => void refresh(runner),
    };
}

function useQuotaClock(visible: boolean) {
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        if (!visible) return;
        setNow(Date.now());
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [visible]);
    return now;
}

export function ComposerQuota({quota, connected}: {quota: QuotaModel; connected: boolean}) {
    const id = useId();
    const [open, setOpen] = useState(false);
    const now = useQuotaClock(open);
    const summaryTime = open ? now : Date.now();
    return <>
        <button type="button" className="quiet composer-quota" popoverTarget={id} aria-expanded={open}>
            <span className="sr-only">Subscription usage, remaining quota.</span>
            {runners.map(runner => {
                const {snapshot, error} = quota.state.runners[runner];
                const windows = composerWindows[runner].map(({id, label}) => {
                    const window = snapshot?.windows.find(candidate => candidate.id === id);
                    return {id, label, window, remaining:window ? remainingPercent(window.usedPercent) : null};
                });
                const values = windows.flatMap(({remaining}) => remaining == null ? [] : [remaining]);
                const lowest = values.length ? Math.min(...values) : null;
                const stale = !connected || !!error || windows.some(({window}) => window && isStale(window, summaryTime));
                return <span key={runner} className="composer-quota-runner">
                    <RunnerMark runner={runner} decorative/>
                    <span className="composer-quota-name">{names[runner]}</span>
                    <span className="composer-quota-windows">
                        {windows.map(({id, label, remaining}) =>
                            <span key={id}><span className="composer-quota-window-label">{label} </span><b className="quota-value" data-quota-tone={remaining == null ? undefined : quotaTone(remaining)}>{remaining == null ? '—' : `${remaining}%`}</b></span>
                        )}
                    </span>
                    {runner === 'claude' && <span className="composer-quota-low quota-value" data-quota-tone={lowest == null ? undefined : quotaTone(lowest)}><span className="sr-only">Lowest remaining: </span>{lowest == null ? '—' : `${lowest}%`}</span>}
                    {stale && <span className="composer-quota-stale" title="Last reported quota" aria-hidden="true">*</span>}
                </span>;
            })}
        </button>
        <section id={id} popover="auto" className="composer-quota-panel" aria-labelledby={`${id}-title`}
            onToggle={event => setOpen(event.currentTarget.matches(':popover-open'))}>
            <div className="composer-quota-title"><h2 id={`${id}-title`}>Subscription usage</h2><button type="button" className="quiet" popoverTarget={id} popoverTargetAction="hide" aria-label="Close subscription usage"><NavigationIcon kind="close"/></button></div>
            <QuotaContents state={quota.state} now={now} loading={!connected || quota.loading} onRefresh={quota.onRefresh}/>
            <p className="quota-status muted" role="status">{quota.loading ? 'Reading latest quota…' : quota.message}</p>
        </section>
    </>;
}

function quotaSummary(state: QuotaState) {
    return runners.flatMap(runner => {
        const { supported, snapshot } = state.runners[runner];
        if (supported === false || !snapshot?.windows.length) return [];
        const remaining = Math.min(...snapshot.windows.map(window => remainingPercent(window.usedPercent)));
        return [{ runner, remaining }];
    });
}

export function QuotaSectionView({ collapsed, onToggle, state, now, loading, message, onRefresh }: { collapsed: boolean; onToggle(): void; state: QuotaState; now: number; loading: boolean; message: string; onRefresh(runner: QuotaRunner): void }) {
    const summary = quotaSummary(state), body = useRef<HTMLDivElement>(null);
    useDisclosureMotion(body, !collapsed);
    return <section className="usage-section" aria-labelledby="usage-section-title">
        <button type="button" className="quiet usage-toggle" aria-expanded={!collapsed} aria-controls="usage-section-body" onClick={onToggle}>
            <NavigationIcon kind="chevron" expanded={!collapsed}/><span id="usage-section-title">Usage</span>
            {collapsed && summary.length > 0 && <span className="usage-summary">{summary.map(({ runner, remaining }) =>
                <span key={runner} className="quota-value" data-quota-tone={quotaTone(remaining)}>{names[runner]} {remaining}% remaining</span>
            )}</span>}
        </button>
        <div ref={body} id="usage-section-body" className="usage-body" hidden={collapsed} inert={collapsed} aria-hidden={collapsed}>
            <QuotaContents state={state} now={now} loading={loading} onRefresh={onRefresh}/>
            <p className="quota-status muted" role="status" aria-live="polite">{loading ? 'Reading latest quota…' : message}</p>
        </div>
    </section>;
}
