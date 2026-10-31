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

const compaction = (seq: number, state = 'started', itemId = 'c', taskId = 'lead', nativeTurnId = 'turn') => event(seq, 'diagnostic', { code: 'context.compaction', state, itemId, nativeThreadId: 'thread', nativeTurnId }, taskId);
test('canonical compaction replays into shared accessible mobile and desktop status; missing start is unknown', () => {
 const history = [event(1, 'turn.started'), compaction(2)];
 const progress = leadProgress(history, { sessionId: 's' });
 expect(progress).toEqual({ phase: 'compacting', label: 'Compacting context…' });
 for (const mobile of [false, true]) {
   const html = renderToStaticMarkup(<LeadProgress progress={progress} mobile={mobile}/>);
   expect(html).toContain('data-phase="compacting"'); expect(html).toContain('Compacting context…'); expect(html).toContain('role="status"');
 }
 expect(leadProgress(history, { sessionId: 's', connection: 'Reconnecting' })?.phase).toBe('connection');
 expect(leadProgress([...history], { sessionId: 's', connection: 'Connected' })).toEqual(progress);
 expect(leadProgress([compaction(3, 'completed')], { sessionId: 's' })).toBeUndefined();
 expect(leadProgress([...history, compaction(3, 'completed')], { sessionId: 's' })?.phase).toBe('waiting');
});
test('completion matches newest compaction identity and source and cannot erase later real progress', () => {
 const active = [compaction(1, 'started', 'old'), compaction(2, 'started', 'new')];
 for (const completion of [compaction(3, 'completed', 'old'), compaction(3, 'completed', 'new', 'child'), compaction(3, 'completed', 'new', 'lead', 'old-turn'), { ...compaction(3, 'completed', 'new'), source: { taskId: 'lead', runnerId: 'other' } }, { ...compaction(3, 'completed', 'new'), source: { taskId: 'other-lead-generation', memberId: 'lead', runnerId: 'codex' } }]) {
  expect(leadProgress([...active, completion], { sessionId: 's' })?.phase).toBe('compacting');
 }
 for (const evidence of [event(3, 'message.delta', { text: 'answer' }), event(3, 'tool.started', { toolCallId: 'tool', name: 'Read' }), event(3, 'reasoning.delta', { text: 'reason' })]) {
  const progress = leadProgress([...active, evidence], { sessionId: 's' });
  expect(leadProgress([...active, evidence, compaction(4, 'completed', 'new')], { sessionId: 's' })).toEqual(progress);
 }
});
test('compaction respects questions, approvals, receipt, session and lifecycle fences', () => {
 for (const [kind, data, phase] of [['question.requested', { questionId: 'q' }, 'question'], ['approval.requested', { approvalId: 'a' }, 'approval']] as const) {
  expect(leadProgress([compaction(1), event(2, kind, data)], { sessionId: 's' })?.phase).toBe(phase);
 }
 for (const boundary of [event(2, 'turn.completed'), event(2, 'session.ended'), event(2, 'task.state', { state: 'failed' })]) {
  expect(leadProgress([compaction(1), boundary, compaction(3)], { sessionId: 's' })).toBeUndefined();
 }
 for (const boundary of [event(2, 'turn.started'), event(2, 'task.continued')]) {
  expect(leadProgress([compaction(1), boundary, compaction(3, 'completed')], { sessionId: 's' })?.phase).toBe('waiting');
 }
 expect(leadProgress([compaction(1)], { sessionId: 'other' })).toBeUndefined();
 expect(leadProgress([compaction(7)], { sessionId: 's', pending })?.phase).toBe('sending');
 expect(leadProgress([compaction(4), receipt()], { sessionId: 's', pending })?.phase).toBe('waiting');
 expect(leadProgress([receipt(), compaction(7)], { sessionId: 's', pending })?.phase).toBe('compacting');
 expect(leadProgress([receipt(), compaction(7), event(8, 'prompt.state', { promptId: 'prompt', state: 'completed' })], { sessionId: 's', pending })).toBeUndefined();
 expect(leadProgress([event(1, 'runner.unmapped', { nativeType: 'item/started', raw: { type: 'contextCompaction' } })], { sessionId: 's' })).toBeUndefined();
});

test('resolving an approval reveals current compaction evidence', () => {
 const events = [compaction(1), event(2, 'approval.requested', { approvalId: 'a' }), event(3, 'approval.resolved', { approvalId: 'a' })];
 expect(leadProgress(events, { sessionId: 's' })?.phase).toBe('compacting');
});

test('production bounded current evidence retains compaction through snapshot and live reduction', async () => {
 const { CurrentEvents } = await import('../../../packages/core/src/session/chat-history');
 const { snapshotView } = await import('./chat-history');
 const current = new CurrentEvents();
 current.apply(event(1, 'turn.started')); current.apply(compaction(2));
 expect(leadProgress(snapshotView(current.values(), 2).events, { sessionId: 's' })?.phase).toBe('compacting');
 current.apply(compaction(3, 'started', 'new')); current.apply(compaction(4, 'completed', 'c'));
 expect(leadProgress(current.values(), { sessionId: 's' })?.phase).toBe('compacting');
 current.apply(event(5, 'message.delta', { text: 'answer' })); current.apply(compaction(6, 'completed', 'new'));
 expect(leadProgress(current.values(), { sessionId: 's' })?.phase).toBe('responding');
 current.apply(event(7, 'turn.completed'));
 expect(leadProgress(current.values(), { sessionId: 's' })).toBeUndefined();
});

test('bounded compaction projection rejects unmatched and malformed records without displacing newer evidence', async () => {
 const { CurrentEvents } = await import('../../../packages/core/src/session/chat-history');
 const current = new CurrentEvents();
 current.apply(compaction(1));
 const newer = compaction(2, 'started', 'new'); current.apply(newer);
 const mismatches = [compaction(3, 'completed'), { ...compaction(4, 'completed', 'new'), data: { ...newer.data, state: 'completed', nativeThreadId: 'other' } }, compaction(5, 'completed', 'new', 'lead', 'other'), { ...compaction(6, 'completed', 'new'), source: { taskId: 'lead', runnerId: 'other' } }, { ...compaction(7, 'completed', 'new'), source: { taskId: 'lead', runnerId: 'codex', nativeSessionId: 'other' } }];
 for (const mismatch of mismatches) current.apply(mismatch);
 for (const [index, itemId] of ['', undefined, 42, 'x'.repeat(257), '\u001b[31m', 'token=private'].entries()) current.apply({ ...compaction(8 + index), data: { ...newer.data, itemId } });
 expect(current.values().filter(e => e.data.code === 'context.compaction')).toEqual([newer]);
 expect(leadProgress(current.values(), { sessionId: 's' })?.phase).toBe('compacting');
 current.apply(compaction(20, 'completed', 'new'));
 expect(leadProgress(current.values(), { sessionId: 's' })?.phase).toBe('waiting');
 for (let seq = 21; seq < 521; seq++) current.apply(compaction(seq, 'started', `c-${seq}`));
 expect(current.values().filter(e => e.data.code === 'context.compaction')).toHaveLength(1);
 expect(current.values().length).toBeLessThanOrEqual(2);
});

test('bounded compaction replay clears terminals, new turns and active prompt fences', async () => {
 const { CurrentEvents } = await import('../../../packages/core/src/session/chat-history');
 for (const boundary of [event(3, 'turn.completed'), event(3, 'session.ended'), event(3, 'task.state', { state: 'failed' }), event(3, 'turn.started'), event(3, 'task.continued')]) {
  const current = new CurrentEvents(); current.apply(event(1, 'turn.started')); current.apply(compaction(2)); current.apply(boundary);
  current.apply(compaction(4, 'completed'));
  expect(current.values().some(e => e.data.code === 'context.compaction')).toBe(false);
  if (['turn.completed', 'session.ended', 'task.state'].includes(boundary.kind)) {
   current.apply(compaction(5));
   expect(leadProgress(current.values(), { sessionId: 's' })).toBeUndefined();
  }
 }
 const current = new CurrentEvents();
 current.apply(event(1, 'turn.started')); current.apply(event(2, 'prompt.dispatched', { promptId: 'p', taskId: 'lead' })); current.apply(compaction(3));
 current.apply(event(4, 'prompt.state', { promptId: 'other', state: 'failed' }));
 expect(leadProgress(current.values(), { sessionId: 's' })?.phase).toBe('compacting');
 current.apply(event(5, 'prompt.state', { promptId: 'p', state: 'failed' }));
 current.apply(compaction(6));
 expect(current.values().some(e => e.data.code === 'context.compaction')).toBe(false);
 current.apply(event(7, 'turn.started')); current.apply(compaction(8));
 expect(leadProgress(current.values(), { sessionId: 's' })?.phase).toBe('compacting');
});

test('snapshot-to-live reduction keeps canonical compaction bounded without raw or malformed recovery', async () => {
 const { CurrentEvents } = await import('../../../packages/core/src/session/chat-history');
 const { snapshotView } = await import('./chat-history');
 const { reduceCurrentEvent } = await import('./state');
 const server = new CurrentEvents();
 const started = { ...compaction(2), raw: { runnerId: 'codex', protocol: 'codex-app-server', payload: { transcript: 'PRIVATE_COMPACTION_TRANSCRIPT' }, truncated: false } };
 server.apply(event(1, 'turn.started')); server.apply(started);
 for (let seq = 3; seq < 303; seq++) server.apply(event(seq, 'tool.completed', { toolCallId: 'other' }));
 const page = server.values();
 expect(page.filter(e => e.kind === 'tool.completed')).toHaveLength(200);
 expect(JSON.stringify(page)).not.toContain('PRIVATE_COMPACTION_TRANSCRIPT');
 expect(page.find(e => e.data.code === 'context.compaction')?.raw).toBeUndefined();
 const live = new CurrentEvents(); for (const e of page) live.apply(e);
 let view = snapshotView(page, 302);
 const next = compaction(303, 'started', 'next');
 live.apply(next); view = reduceCurrentEvent(view, next, live.values());
 expect(leadProgress(view.events, { sessionId: 's' })?.phase).toBe('compacting');
 const done = compaction(304, 'completed', 'c');
 live.apply(done); view = reduceCurrentEvent(view, done, live.values());
 expect(leadProgress(view.events, { sessionId: 's' })?.phase).toBe('compacting');
 const terminal = event(305, 'turn.completed');
 live.apply(terminal); view = reduceCurrentEvent(view, terminal, live.values());
 expect(leadProgress(view.events, { sessionId: 's' })).toBeUndefined();
 const missing = new CurrentEvents(); missing.apply(compaction(1, 'completed'));
 expect(missing.values()).toEqual([]);
 for (const data of [{ itemId: undefined }, { nativeThreadId: [] }, { nativeTurnId: 'x'.repeat(257) }, { state: 'unknown' }]) missing.apply({ ...compaction(2), data: { ...compaction(2).data, ...data } });
 expect(missing.values()).toEqual([]);
});

test('explicit task admission reopens compaction evidence after a settled turn without inventing a start', async () => {
 const { CurrentEvents } = await import('../../../packages/core/src/session/chat-history');
 const current = new CurrentEvents();
 current.apply(event(1, 'turn.completed'));
 current.apply(event(2, 'task.state', { state: 'running' }));
 expect(leadProgress(current.values(), { sessionId: 's' })?.phase).toBe('waiting');
 current.apply(compaction(3));
 expect(leadProgress(current.values(), { sessionId: 's' })?.phase).toBe('compacting');
});
