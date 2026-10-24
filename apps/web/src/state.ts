import type { SessionGrant, AutoApprovalDetail } from './approvals';
import type { ApprovalSummary } from './session-approvals';
import type { SessionEvent } from '../../../packages/core/src/session/events';
import { isLeadEvent } from './event-source';
export type ViewState = ApprovalSummary & {
    grants?:SessionGrant[];
    grantsSeq?:number;
    seq: number;
    events: SessionEvent[];
    approvals: Record<string, SessionEvent>;
    questions: Record<string, SessionEvent>;
    tasks: Record<string, Record<string, unknown>>;
    state: string;
};
export const emptyState = (): ViewState => ({ seq: 0, events: [], approvals: {}, questions: {}, tasks: {}, state: 'idle' });
export function reduceEvent(state:ViewState,event:SessionEvent):ViewState {
    return reduceCurrentEvent(state,event);
}
export function reduceCurrentEvent(state: ViewState, event: SessionEvent, evidence?:SessionEvent[]): ViewState {
    if (event.seq <= state.seq)
        return state;
    const next = { ...state, seq: event.seq, events: evidence??[...state.events, event], approvals: event.kind.startsWith('approval.')?{ ...state.approvals }:state.approvals, questions: event.kind.startsWith('question.')?{ ...state.questions }:state.questions, tasks: event.kind.startsWith('task.')?{ ...state.tasks }:state.tasks };
    const id = String(event.data.taskId ?? event.source.taskId ?? 'lead');
    if (event.kind === 'approval.requested')
        next.approvals[String(event.data.approvalId)] = event;
    if (event.kind === 'approval.resolved')
        delete next.approvals[String(event.data.approvalId)];
    if (event.kind === 'question.requested') next.questions[String(event.data.questionId)] = event;
    if (event.kind === 'question.resolved') delete next.questions[String(event.data.questionId)];
    // Outcome accounting may refer to an older attempt; only lifecycle records
    // own the current execution state, attempt and assignment shown by the UI.
    if (event.kind === 'task.created' || event.kind === 'task.continued' || event.kind === 'task.state')
        next.tasks[id] = { ...next.tasks[id], ...event.source, ...event.data };
    const mode=event.kind==='session.created'?event.data.approvals:event.kind==='session.approvals'?event.data.mode:undefined;
    if(event.kind==='session.created'&&mode===undefined){next.approvalMode='relay';next.approvalModeSource='default';}
    if(mode==='relay'||mode==='yolo'){next.approvalMode=mode;next.approvalModeSource='session';}
    if (event.kind === 'session.state')
        next.state = String(event.data.state);
    if(['session.grant','session.released','session.ended','session.removed'].includes(event.kind))next.grantsSeq=event.seq;
    if(event.kind==='session.grant'){
        const grantId=String(event.data.grantId), grants=(state.grants??[]).filter(grant=>grant.grantId!==grantId);
        if(event.data.action==='added')grants.push({grantId,kind:event.data.kind as SessionGrant['kind'],toolKey:String(event.data.toolKey),...(typeof event.data.exactKey==='string'?{exactKey:event.data.exactKey}:{}),risk:event.data.risk as SessionGrant['risk'],createdAt:event.ts});
        next.grants=grants;
    }
    if (event.kind === 'session.ended'){next.state = 'ended';next.grants=[];}
    if(event.kind==='session.released'||event.kind==='session.removed')next.grants=[];
    if (event.kind === 'session.reopened')
        next.state = String(event.data.state ?? 'idle');
    return next;
}
/** A summary may supersede replay, but never a grant event newer than its cursor. */
export function sessionGrants(state:Pick<ViewState,'events'|'grants'|'grantsSeq'>, summary?:{grants?:SessionGrant[];lastSeq?:number}):SessionGrant[] {
    const changedAt=state.grantsSeq??state.events.reduce((seq,event)=>['session.grant','session.released','session.ended','session.removed'].includes(event.kind)?event.seq:seq,0);
    return summary?.grants!==undefined&&(state.grants===undefined||summary.lastSeq!==undefined&&summary.lastSeq>=changedAt)?summary.grants:state.grants??summary?.grants??[];
}
export function pairingToken(location: {
    hash: string;
    pathname: string;
    search: string;
}, history: {
    replaceState: (data: unknown, unused: string, url: string) => void;
}): string {
    const token = new URLSearchParams(location.hash.slice(1)).get('pair') ?? new URLSearchParams(location.hash.slice(1)).get('token') ?? '';
    if (location.hash) {
        // Bootstrap canonicalizes the URL after authorization if History is blocked.
        try { history.replaceState(null, '', location.pathname + location.search); } catch {}
    }
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
        const e:ConversationEvent=raw.kind==='question.resolved'?{...raw,source:{...request?.source,...raw.source},questionResolution:joinQuestionResolution(raw,request)}:auto?{...raw,source:{...approval?.source,...raw.source},autoApproval:{tool:String(approval?.data.tool??approval?.data.toolKey??raw.data.tool??'Tool request'),...(typeof approval?.data.exactKey==='string'?{exactKey:approval.data.exactKey}:{}),...(approval?.data.exactKeyTruncated===true?{exactKeyTruncated:true,input:approval.data.input}:{})}}:raw;
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
    // A durable acceptance can survive a JSONL prefix without its optional chat mirror.
    // Reconstruct from original records and sort by the immutable pre-write fence, not receipt time.
    const fences=new Map(events.filter(e=>e.kind==='prompt.steering').map(e=>[e.seq,e]));
    const queued=new Map(events.filter(e=>e.kind==='prompt.queued').map(e=>[String(e.data.promptId),e]));
    const seen=new Set(messages.filter(e=>e.data.role==='user').map(e=>e.data.promptId));
    for(const accepted of events){
        if(accepted.kind!=='prompt.steered'||accepted.data.state!=='accepted')continue;
        const fence=fences.get(Number(accepted.data.steeringSeq)),promptId=accepted.data.promptId,original=queued.get(String(promptId));
        if(!fence||fence.data.promptId!==promptId||!original||typeof original.data.text!=='string'||seen.has(promptId)||(taskId!=='lead'&&fence.data.taskId!==taskId))continue;
        seen.add(promptId);messages.push({...accepted,kind:'message.completed',source:{taskId:String(fence.data.taskId),memberId:'lead'},ts:fence.ts,data:{role:'user',text:original.data.text,promptId,steering:true,steeringSeq:fence.seq,steeringRunnerId:fence.data.runnerId,historical:accepted.data.eligible!==true,...(accepted.data.stale?{decisionReply:{stale:true}}:{})}});
    }
    const order=(event:SessionEvent)=>event.data.role==='user'&&event.data.steering===true&&!event.source.runnerId&&Number.isSafeInteger(event.data.steeringSeq)&&Number(event.data.steeringSeq)>0&&Number(event.data.steeringSeq)<=event.seq?Number(event.data.steeringSeq):event.seq;
    if(messages.some(e=>e.data.steering===true&&!e.source.runnerId))return projectPromptDelivery(messages.map(e=>{
        const fence=fences.get(order(e));return e.data.role==='user'&&e.data.steering===true&&!e.source.runnerId&&fence&&fence.data.promptId===e.data.promptId?{...e,ts:fence.ts}:e;
    }).sort((a,b)=>order(a)-order(b)), events);
    return projectPromptDelivery(messages, events);
}

export { activityEvents } from './activity';


/** Join durable delivery receipts independently of conversation paging/order. */
export function projectPromptDelivery<T extends SessionEvent>(messages: T[], events: SessionEvent[]): T[] {
    const controls = new Map<string, SessionEvent[]>();
    for (const event of events) if (['prompt.dispatched','prompt.handoff','prompt.requeued','prompt.state'].includes(event.kind)) {
        const id = String(event.data.promptId ?? '');
        controls.set(id, [...(controls.get(id) ?? []), event]);
    }
    return messages.flatMap(message => {
        if (message.data.role !== 'user' || !message.data.promptId) return [message];
        const receipts = (controls.get(String(message.data.promptId)) ?? []).sort((a,b)=>a.seq-b.seq);
        const dispatch = receipts.filter(e=>e.kind==='prompt.dispatched').at(-1);
        const gated = message.data.handoff !== undefined || dispatch?.data.handoff === 'gated';
        if (!gated) return [message];
        const bubbleDispatch = receipts.filter(e=>e.kind==='prompt.dispatched' && e.data.reseeded!==true).at(-1);
        if (bubbleDispatch && bubbleDispatch.seq > message.seq) return [];
        const latest = receipts.filter(e=>e.seq > (dispatch?.seq ?? 0)).at(-1);
        if (latest?.kind === 'prompt.requeued' || latest?.kind === 'prompt.state' && latest.data.state === 'cancelled') return [];
        const handoff = receipts.filter(e=>e.kind==='prompt.handoff' && e.seq > (dispatch?.seq??0)).at(-1)?.data.state ?? message.data.handoff ?? 'pending';
        return [{...message,data:{...message.data,handoff}}];
    });
}
