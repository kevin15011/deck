import type { SessionGrant, AutoApprovalDetail } from './approvals';
import type { ApprovalSummary } from './session-approvals';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { isLeadEvent } from './event-source';
export type ViewState = ApprovalSummary & {
    grants?:SessionGrant[];
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
    const mode=event.kind==='session.created'?event.data.approvals:event.kind==='session.approvals'?event.data.mode:undefined;
    if(event.kind==='session.created'&&mode===undefined){next.approvalMode='relay';next.approvalModeSource='default';}
    if(mode==='relay'||mode==='yolo'){next.approvalMode=mode;next.approvalModeSource='session';}
    if (event.kind === 'session.state')
        next.state = String(event.data.state);
    if(event.kind==='session.grant'){
        const grantId=String(event.data.grantId), grants=(state.grants??[]).filter(grant=>grant.grantId!==grantId);
        if(event.data.action==='added')grants.push({grantId,kind:event.data.kind as SessionGrant['kind'],toolKey:String(event.data.toolKey),...(typeof event.data.exactKey==='string'?{exactKey:event.data.exactKey}:{}),risk:event.data.risk as SessionGrant['risk'],createdAt:event.ts});
        next.grants=grants;
    }
    if (event.kind === 'session.ended'){next.state = 'ended';next.grants=[];}
    if(event.kind==='session.removed'&&event.data.phase==='removed')next.grants=[];
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
export type QuestionAnswerRow = { id:string; header?:string; prompt?:string; secret:boolean; values:string[] };
export type QuestionResolution = { outcome:string; rows:QuestionAnswerRow[] };
export type ConversationEvent = SessionEvent & { questionResolution?:QuestionResolution; autoApproval?:AutoApprovalDetail };
export function joinQuestionResolution(event:SessionEvent, request?:SessionEvent):QuestionResolution {
    const outcome=String(event.data.outcome), answers=event.data.answers;
    const entries=answers&&typeof answers==='object'&&!Array.isArray(answers)?Object.entries(answers):[];
    const publicAnswers=new Map(entries.map(([id,values])=>[id,Array.isArray(values)?values.filter((value):value is string=>typeof value==='string'):[]]));
    const questions=Array.isArray(request?.data.questions)?request.data.questions:[];
    const rows:QuestionAnswerRow[]=questions.filter(q=>q&&typeof q==='object'&&typeof q.id==='string').map(q=>({id:q.id,header:typeof q.header==='string'?q.header:undefined,prompt:typeof q.prompt==='string'?q.prompt:undefined,secret:q.secret===true,values:q.secret===true?[]:publicAnswers.get(q.id)??[]}));
    return {outcome,rows:outcome!=='answered'?[]:rows.length?rows:[...publicAnswers].map(([id,values])=>({id,secret:false,values}))};
}
/** Native runners stream deltas then a completed message. Render one message per stream. */
export function conversationEvents(events: SessionEvent[], taskId = 'lead'): ConversationEvent[] {
    const messages: ConversationEvent[] = [], pending = new Map<string, number>(), requests=new Map<string,SessionEvent>(), approvalRequests=new Map<string,SessionEvent>();
    for (const raw of events) {
        const requestKey=JSON.stringify([raw.sessionId,raw.data.questionId]);
        if(raw.kind==='question.requested'&&!raw.data.internal)requests.set(requestKey,raw);
        const request=requests.get(requestKey);
        const approvalKey=JSON.stringify([raw.sessionId,raw.data.approvalId]);
        if(raw.kind==='approval.requested')approvalRequests.set(approvalKey,raw);
        const approval=approvalRequests.get(approvalKey);
        const auto=raw.kind==='approval.resolved'&&raw.data.auto===true&&String(raw.data.by).startsWith('session-grant:');
        const e:ConversationEvent=raw.kind==='question.resolved'?{...raw,source:{...request?.source,...raw.source},questionResolution:joinQuestionResolution(raw,request)}:auto?{...raw,source:{...approval?.source,...raw.source},autoApproval:{tool:String(approval?.data.tool??approval?.data.toolKey??raw.data.tool??'Tool request'),...(typeof approval?.data.exactKey==='string'?{exactKey:approval.data.exactKey}:{})}}:raw;
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
        else if(e.autoApproval)messages.push(e);
        else if(e.kind==='question.resolved'){pending.delete(task+':message');messages.push(e);}
        else if (e.kind === 'turn.completed' && e.data.status === 'failed')
            messages.push(e);
    }
    return messages;
}

export { activityEvents } from './activity';
