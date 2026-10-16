import React from 'react';
import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { leadProgress, LeadProgress, type PendingPrompt } from './lead-progress';
const event = (seq: number, kind: SessionEvent['kind'], data: Record<string, unknown> = {}, taskId = 'lead'): SessionEvent => ({ v: 1, sessionId: 's', seq, kind, data, source: { taskId, runnerId: 'codex' }, ts: '2026-10-14T12:00:00Z' });
const pending: PendingPrompt = { commandId: 'prompt', afterSeq: 5, phase: 'sending' };
const receipt = (seq = 6) => event(seq, 'command.accepted', { commandId: 'prompt', type: 'prompt.send', outcome: { ok: true } });
test('sending starts before runner events, acceptance waits honestly, and first evidence changes phase', () => {
    expect(leadProgress([], { sessionId: 's', pending })).toMatchObject({ phase: 'sending', label: 'Sending…' });
    expect(leadProgress([], { sessionId: 's', pending: { ...pending, phase: 'accepted' } })).toMatchObject({ phase: 'waiting', label: 'Waiting for Lead…' });
    expect(leadProgress([receipt(), event(7, 'turn.started')], { sessionId: 's', pending })).toMatchObject({ phase: 'waiting' });
    expect(leadProgress([receipt(), event(7, 'reasoning.delta', { text: 'Reported reasoning' })], { sessionId: 's', pending })).toMatchObject({ phase: 'reasoning', label: 'Reasoning…' });
    expect(leadProgress([receipt(), event(7, 'message.delta', { text: 'Answer' })], { sessionId: 's', pending })).toMatchObject({ phase: 'responding', label: 'Responding…' });
});
test('only real Lead work changes status and matched tool completion settles to waiting', () => {
    const events = [event(1, 'turn.started'), event(2, 'tool.started', { toolCallId: 'tool', toolName: 'search_graph' })];
    expect(leadProgress(events, { sessionId: 's' })).toMatchObject({ phase: 'tool', label: 'Using search_graph…' });
    expect(leadProgress([...events, event(3, 'reasoning.delta', { text: 'Child thinks' }, 'child'), event(4, 'tool.started', { name: 'Child write' }, 'child')], { sessionId: 's' })).toMatchObject({ phase: 'tool', label: 'Using search_graph…' });
    expect(leadProgress([...events, event(3, 'tool.completed', { toolCallId: 'other' })], { sessionId: 's' })).toMatchObject({ phase: 'tool' });
    expect(leadProgress([...events, event(3, 'tool.completed', { toolCallId: 'tool' })], { sessionId: 's' })).toMatchObject({ phase: 'waiting' });
    expect(leadProgress([event(1, 'diagnostic', { code: 'notice' }), event(2, 'reasoning.delta', { text: '' })], { sessionId: 's' })).toBeUndefined();
});
test('preparation labels require explicit known runner stages and child preparation is ignored', () => {
    const stages = { 'checking-runner': 'Checking runner…', 'preparing-tools': 'Preparing tools…', 'starting-runner': 'Starting Lead…', 'turn-started': 'Waiting for Lead…' };
    for (const [phase, label] of Object.entries(stages)) expect(leadProgress([event(1, 'diagnostic', { code: 'turn.preparation', phase })], { sessionId: 's' })?.label).toBe(label);
    expect(leadProgress([event(1, 'diagnostic', { code: 'turn.preparation', phase: 'preparing-tools' }, 'child')], { sessionId: 's' })).toBeUndefined();
    for (const phase of ['unknown', '__proto__', 'toString']) expect(leadProgress([event(1, 'diagnostic', { code: 'turn.preparation', phase })], { sessionId: 's' })).toBeUndefined();
});
test('Lead approval overrides working status; child approvals do not impersonate the Lead', () => {
    const events = [event(1, 'turn.started'), event(2, 'approval.requested', { approvalId: 'a' })];
    expect(leadProgress(events, { sessionId: 's' })).toMatchObject({ phase: 'approval', label: 'Waiting for your approval' });
    expect(leadProgress([...events, event(3, 'approval.resolved', { approvalId: 'a' })], { sessionId: 's' })).toMatchObject({ phase: 'waiting' });
    expect(leadProgress([event(1, 'turn.started'), event(2, 'approval.requested', { approvalId: 'child' }, 'child')], { sessionId: 's' })).toMatchObject({ phase: 'waiting' });
});
test('terminal replay and failed sends clear local pending progress, including terminals before HTTP returns', () => {
    for (const status of ['completed', 'failed', 'interrupted']) {
        expect(leadProgress([receipt(), event(7, 'turn.completed', { status })], { sessionId: 's', pending })).toBeUndefined();
        expect(leadProgress([receipt(), event(7, 'turn.completed', { status })], { sessionId: 's', pending: { ...pending, phase: 'accepted' } })).toBeUndefined();
    }
    expect(leadProgress([event(1, 'turn.started'), event(2, 'session.ended')], { sessionId: 's' })).toBeUndefined();
    expect(leadProgress([], { sessionId: 's' })).toBeUndefined();
});
test('session/receipt scope and reconnect never reuse stale tool status or prior turn terminals', () => {
    expect(leadProgress([event(6, 'turn.completed', { status: 'completed' })], { sessionId: 's', pending })).toMatchObject({ phase: 'sending' });
    expect(leadProgress([event(1, 'tool.started', { name: 'Write' })], { sessionId: 'another' })).toBeUndefined();
    const events = [event(1, 'tool.started', { name: 'Write' })];
    expect(leadProgress(events, { sessionId: 's', connection: 'Reconnecting' })).toMatchObject({ phase: 'connection', label: 'Reconnecting to Lead…' });
    expect(leadProgress([...events, event(2, 'turn.completed', { status: 'completed' })], { sessionId: 's', connection: 'Connected' })).toBeUndefined();
});
test('status is stable across tokens, sanitized, accessible, and does not claim file modifications', () => {
    const first = [event(1, 'message.delta', { text: 'First token' })];
    expect(leadProgress(first, { sessionId: 's' })).toEqual(leadProgress([...first, event(2, 'message.delta', { text: 'Second token' })], { sessionId: 's' }));
    const progress = leadProgress([event(1, 'tool.started', { name: 'TOKEN=private-key <img src=x>' })], { sessionId: 's' });
    const html = renderToStaticMarkup(<LeadProgress progress={progress}/>);
    expect(html).toContain('role="status"'); expect(html).toContain('aria-atomic="true"'); expect(html).not.toContain('private-key'); expect(html).not.toContain('<img'); expect(html).not.toContain('Modifying');
});
test('new Lead generation reports live status by member identity and settles its terminal', () => {
    const source = { taskId: 'lead-g2', memberId: 'lead', runnerId: 'codex' };
    const started = { ...event(1, 'tool.started', { toolCallId: 'new-tool', toolName: 'Read' }), source };
    expect(leadProgress([started], { sessionId: 's' })).toMatchObject({ label: 'Using Read…' });
    expect(leadProgress([started, { ...event(2, 'turn.completed', { status: 'completed' }), source }], { sessionId: 's' })).toBeUndefined();
});
test('global Lead queueing is distinct from startup and clears on admission', () => {
    const queued = event(1, 'task.state', { state: 'queued', reason: 'global-lead-capacity' });
    expect(leadProgress([queued], { sessionId: 's' })).toMatchObject({ label: 'Waiting for runner capacity…' });
    expect(leadProgress([queued, event(2, 'task.state', { state: 'running' })], { sessionId: 's' })).toMatchObject({ label: 'Waiting for Lead…' });
});
test('background queue acceptance preserves ongoing Lead evidence and terminal precedence',()=>{
 const active=[event(1,'turn.started'),event(2,'tool.started',{toolCallId:'active',toolName:'Read'})];
 const queued={...pending,afterSeq:2,background:true};
 expect(leadProgress(active,{sessionId:'s',pending:queued})).toMatchObject({phase:'tool',label:'Using Read…'});
 expect(leadProgress([...active,receipt(3)],{sessionId:'s',pending:{...queued,phase:'accepted'}})).toMatchObject({phase:'tool'});
 expect(leadProgress([...active,receipt(3),event(4,'turn.completed',{status:'completed'})],{sessionId:'s',pending:queued})).toBeUndefined();
});
test('exact prompt terminal settles accepted pending progress before a delayed HTTP acknowledgement',()=>{
 const failed=event(7,'prompt.state',{promptId:'prompt',state:'failed',reason:'runner-driver-unavailable'});
 expect(leadProgress([receipt(),failed],{sessionId:'s',pending})).toBeUndefined();
 expect(leadProgress([receipt(),{...failed,data:{...failed.data,promptId:'other'}}],{sessionId:'s',pending})).toMatchObject({phase:'waiting'});
 const active=[event(1,'turn.started'),event(2,'tool.started',{toolCallId:'live',toolName:'Read'}),failed];
 expect(leadProgress(active,{sessionId:'s',pending:{...pending,background:true}})).toMatchObject({phase:'tool'});
});
test('pending question takes precedence and resolves back to work',()=>{
 const events=[event(1,'turn.started'),event(2,'question.requested',{questionId:'q'}),event(3,'message.delta',{text:'Still running'})];
 expect(leadProgress(events,{sessionId:'s'})).toEqual({phase:'question',label:'Waiting for your answer'});
 expect(leadProgress([...events,event(4,'question.resolved',{questionId:'q'})],{sessionId:'s'})?.phase).toBe('responding');
});
test('session auto-approval does not leave the Lead waiting for permission',()=>{
 const events=[event(1,'turn.started'),event(2,'approval.requested',{approvalId:'a'}),event(3,'approval.resolved',{approvalId:'a',auto:true,by:'session-grant:g'})];
 expect(leadProgress(events,{sessionId:'s'})?.phase).not.toBe('approval');
});
