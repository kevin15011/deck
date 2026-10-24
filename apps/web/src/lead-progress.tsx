import React, { useMemo } from 'react';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { redactText } from '../../../packages/core/src/session/redaction';
import { isLeadEvent } from './event-source';
import { compactionIdentity } from '../../../packages/core/src/session/chat-history';
import { ContextWindowIndicator, contextIndexForEvents, type ContextWindowIndex } from './context-window';

export type PendingPrompt = { commandId: string; afterSeq: number; phase: 'sending' | 'accepted'; background?: boolean };
export type LeadProgressState = { phase: 'sending' | 'waiting' | 'preparing' | 'compacting' | 'reasoning' | 'tool' | 'responding' | 'approval' | 'question' | 'connection'; label: string };
const waiting: LeadProgressState = { phase: 'waiting', label: 'Waiting for Lead…' };
const text = (value: unknown) => typeof value === 'string' && value.trim() ? value : undefined;
const preparation: Record<string, string> = { 'checking-runner': 'Checking runner…', 'preparing-tools': 'Preparing tools…', 'starting-runner': 'Starting Lead…', 'turn-started': 'Waiting for Lead…' };

/** Current evidence, never inferred thoughts or file edits. The prompt receipt fences prior turns. */
export function leadProgress(events: SessionEvent[], { sessionId, pending, connection = 'Connected' }: { sessionId: string; pending?: PendingPrompt; connection?: string }): LeadProgressState | undefined {
    if (!sessionId) return;
    // A queued submission has its own receipt; it must not replace the active turn.
    if (pending?.background) pending = undefined;
    if (connection !== 'Connected') return { phase: 'connection', label: connection === 'Connecting' ? 'Connecting to Lead…' : 'Reconnecting to Lead…' };
    let progress: LeadProgressState | undefined = pending ? pending.phase === 'sending' ? { phase: 'sending', label: 'Sending…' } : waiting : undefined;
    const questions = new Set<string>(), approvals = new Set<string>(), tools = new Map<string, string>();
    let received = !pending, ended = false;
    let compaction: string | undefined;
    for (const event of events) {
        if (event.sessionId !== sessionId) continue;
        if (event.kind === 'session.ended') { compaction = undefined; progress = undefined; approvals.clear(); questions.clear(); tools.clear(); ended = true; continue; }
        if (pending && event.seq <= pending.afterSeq) continue;
        if (pending && event.kind === 'command.accepted' && event.data.commandId === pending.commandId && event.data.type === 'prompt.send') {
            received = true;
            progress = (event.data.outcome as { ok?: boolean } | undefined)?.ok === true ? waiting : undefined;
            ended = !progress;
            continue;
        }
        if (pending && event.kind === 'prompt.state' && event.data.promptId === pending.commandId) { compaction=undefined; progress=undefined; tools.clear(); approvals.clear(); questions.clear(); ended=true; received=true; continue; }
        if (!received || event.data.internal === true || event.data.role === 'system' || !isLeadEvent(event)) continue;
        if (event.kind === 'turn.completed' || (event.kind === 'task.state' && ['completed', 'failed', 'interrupted', 'cancelled', 'ownership-unsettled'].includes(String(event.data.state)))) {
            compaction = undefined; progress = undefined; tools.clear(); approvals.clear(); questions.clear(); ended = true; continue;
        }
        if (event.kind === 'turn.started' || event.kind === 'task.continued') { compaction = undefined; progress = waiting; tools.clear(); approvals.clear(); questions.clear(); ended = false; continue; }
        if (event.kind === 'task.state' && ['queued', 'running'].includes(String(event.data.state))) {
            if (event.data.state === 'queued' && event.data.reason === 'global-lead-capacity') progress = { phase: 'waiting', label: 'Waiting for runner capacity…' };
            else if (!progress || progress.label === 'Waiting for runner capacity…') progress = waiting;
            ended = false; continue;
        }
        if (event.kind === 'diagnostic' && event.data.code === 'turn.preparation') {
            const label = preparation[String(event.data.phase)];
            if (typeof label === 'string' && !ended) progress = event.data.phase === 'turn-started' ? waiting : { phase: 'preparing', label };
            continue;
        }
        if (ended) continue;
        if (event.kind === 'diagnostic' && event.data.code === 'context.compaction') {
            const { state } = event.data;
            const key = compactionIdentity(event);
            if (!key) continue;
            if (state === 'started') {
                compaction = key;
                progress = { phase: 'compacting', label: 'Compacting context…' };
            } else if (state === 'completed' && compaction === key) {
                compaction = undefined;
                // Later response/tool evidence remains authoritative.
                if (progress?.phase === 'compacting') {
                    const name = [...tools.values()].at(-1);
                    progress = name ? { phase: 'tool', label: `Using ${name}…` } : waiting;
                }
            }
            continue;
        }
        if (event.kind === 'question.requested') { questions.add(String(event.data.questionId)); progress ??= waiting; continue; }
        if (event.kind === 'question.resolved') { questions.delete(String(event.data.questionId)); continue; }
        if (event.kind === 'approval.requested' && text(event.data.approvalId)) { approvals.add(String(event.data.approvalId)); progress ??= waiting; continue; }
        if (event.kind === 'approval.resolved') { approvals.delete(String(event.data.approvalId)); if (progress?.phase !== 'compacting') progress = progress ? waiting : undefined; continue; }
        if (event.kind === 'reasoning.delta' && text(event.data.text)) { progress = { phase: 'reasoning', label: 'Reasoning…' }; continue; }
        if (event.kind === 'message.delta' && text(event.data.text ?? event.data.delta)) { progress = { phase: 'responding', label: 'Responding…' }; continue; }
        if (event.kind === 'message.completed' && event.data.role !== 'user' && text(event.data.text)) { progress = { phase: 'responding', label: 'Responding…' }; continue; }
        if (event.kind === 'tool.started' || event.kind === 'tool.completed') {
            const id = text(event.data.toolUseId) ?? text(event.data.toolCallId);
            const key = JSON.stringify([event.source.taskId ?? 'lead', event.source.runnerId, event.source.nativeSessionId, id ?? event.seq]);
            if (event.kind === 'tool.started') {
                const name = text(event.data.toolName) ?? text(event.data.name) ?? text(event.data.tool) ?? 'tool';
                tools.set(key, redactText(name, 100));
            } else if (id) tools.delete(key);
            const name = [...tools.values()].at(-1);
            progress = name ? { phase: 'tool', label: `Using ${name}…` } : waiting;
        }
    }
    return questions.size ? { phase: 'question', label: 'Waiting for your answer' } : approvals.size ? { phase: 'approval', label: 'Waiting for your approval' } : progress;
}

export function LeadProgress({ progress, mobile = false, events, sessionId = '', contexts }: { progress?: LeadProgressState; mobile?: boolean; events?: SessionEvent[]; sessionId?: string; contexts?: ContextWindowIndex }) {
    const index = useMemo(() => events && sessionId ? contextIndexForEvents(events, sessionId, contexts) : undefined, [events, sessionId, contexts]);
    return <div className={`lead-progress${mobile ? ' mobile-progress' : ''}`} data-phase={progress?.phase ?? 'idle'}><span className="lead-progress-status" role="status" aria-live="polite" aria-atomic="true"><span className="lead-progress-dot" aria-hidden="true"/><span className="lead-progress-label">{progress?.label ?? ''}</span></span>{index && <ContextWindowIndicator observation={index.get()} owner="Lead"/>}</div>;
}
