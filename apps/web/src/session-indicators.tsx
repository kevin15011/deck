import React from 'react';
import type { ProjectActivity } from '../../../packages/core/src/session/activity-summary';
import type { WorkspaceSession } from './workspace-types';
import { StatusIndicator } from './status-indicator';
export type ProjectStatus = {summary?:ProjectActivity; checkedAt?:number; stale?:boolean};
export const statusFresh = (status: {checkedAt?:number; stale?:boolean} | undefined, now=Date.now()) => !!status?.checkedAt && !status.stale && now-status.checkedAt < 10000;
export function sessionIndicatorDescription(session:WorkspaceSession, fresh:boolean) {
    const a=session.activity, attention=a?.attention;
    const connected=session.preparationStatus==='ready'&&!session.releasing&&!session.removing&&session.state!=='ended';
    const lead=!fresh?'Status stale':session.removing?'Removing':session.releasing?'Closing':session.preparationStatus==='preparing'?'Lead starting':session.preparationStatus==='failed'?'Preparation failed':!connected?'Disconnected':session.leadActivity?.pendingQuestions?'Lead waiting for your answer':session.leadActivity?.pendingApprovals?'Lead waiting for approval':session.leadActivity?.state==='running'?'Lead working':['queued','created','preparing'].includes(session.leadActivity?.state??'')?'Lead starting':['idle','completed'].includes(session.leadActivity?.state??'')?'Lead available':'Lead unavailable';
    return [lead,a&&`${a.workers.active} active subagents; ${a.workers.queued} queued; ${a.workers.blocked} human-blocked; ${a.workers.unsettled} unsettled`,attention&&`${attention.approvals} approvals, ${attention.questions} questions, ${attention.decisions} decisions; Lead ${attention.byLead}, workers ${attention.byWorkers}, unowned ${attention.unowned}`,a?.errors?`${a.errors} unresolved errors`:undefined].filter(Boolean).join(' · ');
}
export function SessionIndicators({session,unread,fresh}:{session:WorkspaceSession;unread:boolean;fresh:boolean}) {
    const a=session.activity, count=a? a.attention.approvals+a.attention.questions+a.attention.decisions:0;
    const connected=session.preparationStatus==='ready'&&!session.releasing&&!session.removing&&session.state!=='ended';
    const description=sessionIndicatorDescription(session,fresh);
    return <span className="session-indicators" role="img" aria-label={description+(unread?' · Unread reply':'')} title={description} data-stale={!fresh||undefined}>
        <span aria-hidden="true"><StatusIndicator state={fresh&&session.preparationStatus==='preparing'?'preparing':fresh&&connected?session.leadActivity?.state??'unknown':fresh?'interrupted':'unknown'} unread={unread} approvals={fresh&&connected?session.leadActivity?.pendingApprovals:0} questions={fresh&&connected?session.leadActivity?.pendingQuestions:0}/></span>
        {!!a?.workers.active&&<span className="indicator-workers" aria-hidden="true"><IndicatorIcon kind="workers"/>{a.workers.active}</span>}
        {!!count&&<span className="indicator-attention" aria-hidden="true"><IndicatorIcon kind="attention"/>{count}</span>}
        {(!!a?.errors || session.preparationStatus==='failed')&&<span className="indicator-error" aria-hidden="true"><IndicatorIcon kind="error"/></span>}
        {!fresh&&<span aria-hidden="true"><IndicatorIcon kind="stale"/></span>}
    </span>;
}
export function projectIndicatorDescription(status?:ProjectStatus) {
    const row=status?.summary, fresh=statusFresh(status);
    if (!row) return 'Project status unknown';
    return `${fresh?'Connected sessions':'Stale connected-session status'}: ${row.connected}; ${row.leadsRunning} Leads working; ${row.leadsStarting} starting; ${row.workers.active} active subagents; ${row.workers.queued} queued; ${row.workers.blocked} human-blocked; ${row.attentionSessions} sessions need you (${row.attention.approvals} approvals, ${row.attention.questions} questions, ${row.attention.decisions} decisions; Lead ${row.attention.byLead}, workers ${row.attention.byWorkers}); ${row.errors} unresolved errors`;
}
export function ProjectIndicators({status}:{status?:ProjectStatus}) {
    const row=status?.summary, fresh=statusFresh(status);
    if (!row) return <span className="project-indicators" role="img" aria-label="Project status unknown" title="Project status unknown"><IndicatorIcon kind="stale"/></span>;
    const description=projectIndicatorDescription(status);
    return <span className="project-indicators" role="img" aria-label={description} title={description} data-stale={!fresh||undefined}>
        {!!row.leadsRunning&&<span aria-hidden="true"><IndicatorIcon kind="lead"/>{row.leadsRunning}</span>}{!!row.leadsStarting&&<span aria-hidden="true"><IndicatorIcon kind="starting"/>{row.leadsStarting}</span>}
        {!!row.workers.active&&<span className="indicator-workers" aria-hidden="true"><IndicatorIcon kind="workers"/>{row.workers.active}</span>}
        {!!row.attentionSessions&&<span className="indicator-attention" aria-hidden="true"><IndicatorIcon kind="attention"/>{row.attentionSessions}</span>}
        {!!row.errors&&<span className="indicator-error" aria-hidden="true"><IndicatorIcon kind="error"/></span>}{!fresh&&<span aria-hidden="true"><IndicatorIcon kind="stale"/></span>}
    </span>;
}

/** Shared stroke, size and vocabulary for independent status dimensions. */
function IndicatorIcon({kind}:{kind:'workers'|'attention'|'error'|'stale'|'lead'|'starting'}) {
    const paths={workers:'M6 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM2 13v-1a4 4 0 0 1 8 0v1M11 4a2 2 0 0 1 0 4m1 2a3 3 0 0 1 2 3',attention:'M3 2h10v9H8l-4 3v-3H3ZM8 5v2m0 2h.01',error:'m8 2 6 11H2ZM8 6v3m0 2h.01',stale:'M8 2a6 6 0 1 1-6 6M2 2v4h4M8 5v3l2 1',lead:'m6 3 7 5-7 5Z',starting:'M8 2a6 6 0 1 1 0 12A6 6 0 0 1 8 2ZM8 4v4l3 2'};
    return <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[kind]}/></svg>;
}
