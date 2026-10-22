/** Additive browser history contract. History cursors identify a row's first event,
 * independently of its completion cursor and of the authoritative live watermark. */
import type { SessionEvent } from './events';
import { redactText } from './redaction';
import { ContextWindowProjection } from './context-window';

/** Exact, bounded identity: never correlate using truncated or sanitized IDs. */
export function compactionIdentity(event: SessionEvent): string | undefined {
    const { itemId, nativeThreadId, nativeTurnId } = event.data;
    if (![itemId, nativeThreadId, nativeTurnId].every(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 256 && redactText(value, 256) === value)) return;
    return JSON.stringify([event.sessionId, event.source.taskId, event.source.memberId, event.source.runnerId, event.source.nativeSessionId, nativeThreadId, nativeTurnId, itemId]);
}
export type HistoryMessage = SessionEvent & {
    historyId: number;
    request?: SessionEvent;
};
export type HistoryPage = {
    messages: HistoryMessage[];
    before?: number;
    after?: number;
    seq: number;
    events: SessionEvent[];
};
export const HISTORY_PAGE_SIZE = 40;
export const HISTORY_WINDOW_SIZE = 120;
/** Compact replay of current UI evidence. Conversation paging never mutates this
 * projection. Cardinality follows tasks, current queue receipts, outstanding
 * controls and a bounded recent activity buffer, rather than ledger size. */
export class CurrentEvents {
    private context = new ContextWindowProjection();
    private activity: SessionEvent[] = [];
    private entries = new Map<string, SessionEvent>();
    private compactionClosed = new Set<string>();
    private compactionSessionEnded = false;
    private clearCompaction(task: string) {
        this.entries.delete(`progress:${task}:compaction:start`);
        this.entries.delete(`progress:${task}:compaction:end`);
    }
    apply(event: SessionEvent) {
        this.context.apply(event);
        if (event.kind === 'question.resolved')
            event = { ...event, data: { questionId: event.data.questionId, outcome: event.data.outcome, by: event.data.by } };
        const { kind, data, source } = event, task = String(source.taskId ?? data.taskId ?? 'lead');
        if (/^(tool|hook|reasoning)\./.test(kind) && !data.internal) {
            this.activity.push(event);
            if (this.activity.length > 200)
                this.activity.shift();
        }
        const put = (key: string) => this.entries.set(key, event);
        if (kind.startsWith('session.') && kind !== 'session.grant')
            put(kind);
        if (kind.startsWith('decision.')) put('decision');
        if (kind === 'session.grant') {
            const key = `grant:${data.grantId}`;
            if (data.action === 'added')
                put(key);
            else
                this.entries.delete(key);
        }
        if (['session.ended', 'session.released', 'session.removed'].includes(kind))
            for (const key of this.entries.keys())
                if (key.startsWith('grant:'))
                    this.entries.delete(key);
        if (kind.startsWith('task.'))
            put(`${task}:${kind}`);
        if (kind === 'approval.requested' || kind === 'question.requested')
            put(`${kind.split('.')[0]}:${data.approvalId ?? data.questionId}`);
        if (kind === 'approval.resolved' || kind === 'question.resolved')
            this.entries.delete(`${kind.split('.')[0]}:${data.approvalId ?? data.questionId}`);
        const terminal = kind === 'turn.completed' || kind === 'task.continued' || kind === 'turn.started' || kind === 'task.state' && ['completed', 'failed', 'interrupted', 'cancelled', 'ownership-unsettled'].includes(String(data.state));
        if (terminal)
            for (const key of this.entries.keys())
                if (key.startsWith(`progress:${task}:`))
                    this.entries.delete(key);
        if (terminal) {
            if (kind === 'turn.started' || kind === 'task.continued') {
                this.compactionClosed.delete(task);
                this.compactionSessionEnded = false;
            } else this.compactionClosed.add(task);
        }
        if (kind === 'task.state' && ['queued', 'running'].includes(String(data.state))) {
            this.compactionClosed.delete(task);
            this.compactionSessionEnded = false;
        }
        if (kind === 'diagnostic' && data.code === 'context.compaction' && !data.internal && data.role !== 'system'
            && !this.compactionSessionEnded && !this.compactionClosed.has(task)) {
            const identity = compactionIdentity(event), startKey = `progress:${task}:compaction:start`, endKey = `progress:${task}:compaction:end`;
            const start = this.entries.get(startKey);
            if (identity && (data.state === 'started' || data.state === 'completed' && start && compactionIdentity(start) === identity)) {
                // Keep only canonical evidence, never a native transcript, in this projection.
                const { raw: _raw, ...canonical } = event;
                const evidence = { ...canonical, data: { code: 'context.compaction', state: data.state, itemId: data.itemId, nativeThreadId: data.nativeThreadId, nativeTurnId: data.nativeTurnId } };
                if (data.state === 'started') {
                    this.entries.set(startKey, evidence);
                    this.entries.delete(endKey);
                } else this.entries.set(endKey, evidence);
            }
        }
        if (kind === 'turn.started' || kind === 'turn.completed')
            put(`${task}:turn`);
        if (kind === 'task.continued')
            this.entries.delete(`${task}:reply`);
        if (kind === 'message.completed' && data.role !== 'user' && data.role !== 'system' && !data.internal)
            put(`${task}:reply`);
        if (kind === 'message.delta' && !data.internal && data.role !== 'system') {
            const key = `progress:${task}:stream`, previous = this.entries.get(key);
            event = { ...event, data: { ...data, text: String(previous?.data.text ?? '') + String(data.text ?? data.delta ?? '') } };
            this.entries.set(key, event);
        }
        if (kind === 'message.completed'&&data.role!=='user'&&data.role!=='system'&&!data.internal)
            this.entries.delete(`progress:${task}:stream`);
        if (kind === 'tool.started')
            put(`progress:${task}:tool:${data.toolUseId ?? data.toolCallId ?? event.seq}`);
        if (kind === 'tool.completed')
            this.entries.delete(`progress:${task}:tool:${data.toolUseId ?? data.toolCallId}`);
        if (['tool.started', 'tool.completed', 'message.delta', 'message.completed', 'reasoning.delta', 'approval.resolved', 'question.resolved'].includes(kind) && data.role !== 'user' && data.role!=='system' && !data.internal)
            put(`progress:${task}:phase`);
        if (kind === 'diagnostic' && ['turn.preparation', 'session.preparation', 'prompt.steering-capability'].includes(String(data.code)))
            put(`diagnostic:${data.code}:${task}`);
        if (kind === 'diagnostic' && data.code === 'context.invalidated') {
            const { raw: _raw, ...canonical } = event;
            this.entries.set(`progress:${task}:context-invalidated`, { ...canonical, data: { code: data.code, nativeThreadId: data.nativeThreadId, nativeTurnId: data.nativeTurnId, attempt: data.attempt } });
        }
        // Keep current queued/failed receipts, so failure notices survive paging.
        // Dispatched and cancelled content is removed rather than becoming history.
        const promptKey = `queued:${data.promptId}`, failureKey = `failed:${data.promptId}`;
        if (kind === 'prompt.queued')
            put(promptKey);
        if (kind === 'prompt.steering') {
            const queued = this.entries.get(promptKey);
            if (queued) this.entries.set(`steering-queued:${data.promptId}`, queued);
            this.entries.delete(promptKey);
            put(`steering-fence:${data.promptId}`);
        }
        if (kind === 'prompt.steered') {
            put(`steering-result:${data.promptId}`);
            const results = [...this.entries.keys()].filter(key => key.startsWith('steering-result:'));
            for (const key of results.slice(0, -16)) {
                const id = key.slice('steering-result:'.length);
                for (const part of ['queued', 'fence', 'result']) this.entries.delete(`steering-${part}:${id}`);
            }
        }
        if (kind === 'prompt.dispatched') {
            put('prompt:active');
            this.entries.delete(promptKey);
            this.entries.delete(failureKey);
        }
        if (kind === 'prompt.state') {
            const activePrompt = this.entries.get('prompt:active');
            if (activePrompt && activePrompt.data.promptId === data.promptId) {
                const activeTask = String(activePrompt.data.taskId ?? activePrompt.source.taskId ?? 'lead');
                this.clearCompaction(activeTask);
                this.compactionClosed.add(activeTask);
                this.entries.delete('prompt:active');
            }
            if (['failed', 'ownership-unsettled'].includes(String(data.state)) && this.entries.has(promptKey))
                put(failureKey);
            else {
                this.entries.delete(promptKey);
                this.entries.delete(failureKey);
            }
        }
        if(kind==='prompt.queue')put('prompt:queue');
        // Keep the complete current queue projection as well as a refresh cursor.
        if (kind.startsWith('prompt.'))
            put('prompt');
        if (kind === 'session.ended') this.compactionSessionEnded = true;
        if (kind === 'session.ended')
            for (const key of this.entries.keys())
                if (key.startsWith('progress:'))
                    this.entries.delete(key);
    }
    values(): SessionEvent[] { return [...new Map([...this.context.attributionEvents(), ...this.activity, ...this.entries.values(), ...this.context.values()].map(event => [event.seq, event])).values()].sort((a, b) => a.seq - b.seq); }
}
