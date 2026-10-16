import type { SessionEvent } from '../../../packages/core/src/session/events';
import { isLeadEvent } from './event-source';
export type ViewState = {
    seq: number;
    events: SessionEvent[];
    approvals: Record<string, SessionEvent>;
    questions: Record<string, SessionEvent>;
    tasks: Record<string, Record<string, unknown>>;
    state: string;
};
export const emptyState = (): ViewState => ({ seq: 0, events: [], approvals: {}, questions: {}, tasks: {}, state: 'idle' });
export function reduceEvent(state: ViewState, event: SessionEvent): ViewState {
    if (event.seq <= state.seq)
        return state;
    const next = { ...state, seq: event.seq, events: [...state.events, event], approvals: { ...state.approvals }, questions: { ...state.questions }, tasks: { ...state.tasks } };
    const id = String(event.data.taskId ?? event.source.taskId ?? 'lead');
    if (event.kind === 'approval.requested')
        next.approvals[String(event.data.approvalId)] = event;
    if (event.kind === 'approval.resolved')
        delete next.approvals[String(event.data.approvalId)];
    if (event.kind === 'question.requested') next.questions[String(event.data.questionId)] = event;
    if (event.kind === 'question.resolved') delete next.questions[String(event.data.questionId)];
    if (event.kind.startsWith('task.'))
        next.tasks[id] = { ...next.tasks[id], ...event.source, ...event.data };
    if (event.kind === 'session.state')
        next.state = String(event.data.state);
    if (event.kind === 'session.ended')
        next.state = 'ended';
    if (event.kind === 'session.reopened')
        next.state = String(event.data.state ?? 'idle');
    return next;
}
export function pairingToken(location: {
    hash: string;
    pathname: string;
    search: string;
}, history: {
    replaceState: (data: unknown, unused: string, url: string) => void;
}): string {
    const token = new URLSearchParams(location.hash.slice(1)).get('pair') ?? new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
    if (location.hash)
        history.replaceState(null, '', location.pathname + location.search);
    return token;
}
/** Native runners stream deltas then a completed message. Render one message per stream. */
export function conversationEvents(events: SessionEvent[], taskId = 'lead'): SessionEvent[] {
    const messages: SessionEvent[] = [], pending = new Map<string, number>();
    for (const e of events) {
        if (e.data.internal === true || !(taskId === 'lead' ? isLeadEvent(e) : (e.source.taskId ?? 'lead') === taskId) || e.data.role === 'system')
            continue;
        const task = e.source.taskId ?? 'lead';
        if (e.kind === 'turn.completed' || e.kind === 'turn.started' || e.kind === 'task.continued')
            pending.delete(task + ':message');
        if (e.kind === 'message.delta') {
            const key = task + ':message', at = pending.get(key), text = String(e.data.text ?? e.data.delta ?? '');
            if (at === undefined) {
                pending.set(key, messages.length);
                messages.push({ ...e, data: { ...e.data, text } });
            }
            else
                messages[at] = { ...messages[at]!, data: { ...messages[at]!.data, text: String(messages[at]!.data.text ?? '') + text } };
        }
        else if (e.kind === 'message.completed') {
            const key = task + ':message', at = pending.get(key);
            if (e.data.role === 'user' || at === undefined)
                messages.push(e);
            else {
                messages[at] = e;
                pending.delete(key);
            }
        }
        else if (e.kind === 'turn.completed' && e.data.status === 'failed')
            messages.push(e);
    }
    return messages;
}

export { activityEvents } from './activity';
