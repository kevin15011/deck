import { CurrentEvents, HISTORY_PAGE_SIZE, type HistoryMessage, type HistoryPage } from '@deck/core/session/chat-history';
import type { SessionEvent } from '@deck/core/session/events';
import type { EventLog } from './event-log';
type Row = {
    taskId: string;
    lead: boolean;
    id: number;
    seqs: number[];
    text?: string;
    request?: number;
    steering?: { prompt: number; fence: number; receipt: number };
};
const lead = (e: SessionEvent) => e.source.memberId !== undefined ? e.source.memberId === 'lead' : (e.source.taskId ?? 'lead') === 'lead';
/** Derived, disposable index: only seq references survive a completed message.
 * Built once per opened log, then advanced by the same ordered append stream. */
export class ChatHistory {
    readonly current = new CurrentEvents();
    private rows: Row[] = [];
    private taskRows = new Map<string, Row[]>();
    private pending = new Map<string, Row>();
    private requests = new Map<string, number>();
    private seq = 0;
    private bySeq = new Map<number, Row>();
    private queued = new Map<string, number>();
    private steered = new Map<string, Row>();
    constructor(private log: EventLog) {
        for (const event of log.readAfter(0))
            this.apply(event);
    }
    apply(event: SessionEvent): void {
        if (event.seq <= this.seq)
            return;
        this.seq = event.seq;
        this.current.apply(event);
        const promptId = String(event.data.promptId ?? '');
        if (event.kind === 'prompt.queued') this.queued.set(promptId, event.seq);
        if (event.kind === 'prompt.dispatched' || event.kind === 'prompt.state') this.queued.delete(promptId);
        if (event.kind === 'prompt.steered' && event.data.state === 'accepted' && !event.source.runnerId && !this.steered.has(promptId)) {
            const fence = this.log.readEvent(Number(event.data.steeringSeq));
            const prompt = this.queued.get(promptId);
            if (fence?.kind === 'prompt.steering' && !fence.source.runnerId && fence.data.promptId === promptId && prompt) {
                const row: Row = { taskId: String(fence.data.taskId), lead: true, id: fence.seq, seqs: [event.seq], steering: { prompt, fence: fence.seq, receipt: event.seq } };
                this.addRow(row);
                this.steered.set(promptId, row);
                this.bySeq.set(event.seq, row);
                this.queued.delete(promptId);
            }
            return;
        }
        const key = event.kind.startsWith('question.') ? `q:${event.data.questionId}` : `a:${event.data.approvalId}`;
        if (event.kind === 'question.requested' || event.kind === 'approval.requested')
            this.requests.set(key, event.seq);
        const request = this.requests.get(key);
        if (event.kind === 'question.resolved' || event.kind === 'approval.resolved')
            this.requests.delete(key);
        const origin = request ? this.log.readEvent(request) : undefined;
        if (origin)
            event = { ...event, source: { ...origin.source, ...event.source }, data: { ...event.data, ...(origin.data.internal === true ? { internal: true } : {}) } };
        if (event.kind === 'session.ended') {
            for (const row of this.pending.values())
                delete row.text;
            this.pending.clear();
        }
        if (event.data.internal === true || event.data.role === 'system')
            return;
        const task = event.source.taskId ?? 'lead';
        if (['turn.started', 'turn.completed', 'task.continued', 'question.resolved'].includes(event.kind)) {
            const prior = this.pending.get(task);
            if (prior)
                delete prior.text;
            this.pending.delete(task);
        }
        let row: Row | undefined;
        if (event.kind === 'message.delta') {
            row = this.pending.get(task);
            if (row) {
                row.seqs.push(event.seq);
                row.text = (row.text ?? '') + String(event.data.text ?? event.data.delta ?? '');
            }
            else {
                row = { taskId: task, lead: lead(event), id: event.seq, seqs: [event.seq], text: String(event.data.text ?? event.data.delta ?? '') };
                this.addRow(row);
                this.pending.set(task, row);
            }
        }
        else if (event.kind === 'message.completed') {
            const accepted = this.steered.get(promptId);
            if (accepted && event.data.role === 'user' && event.data.steering === true && !event.source.runnerId && event.data.steeringSeq === accepted.id) {
                accepted.seqs = [event.seq];
                this.bySeq.set(event.seq, accepted);
                return;
            }
            row = event.data.role === 'user' ? undefined : this.pending.get(task);
            if (row) {
                row.seqs = [event.seq];
                delete row.text;
                this.pending.delete(task);
            }
            else {
                row = { taskId: task, lead: lead(event), id: event.seq, seqs: [event.seq] };
                this.addRow(row);
            }
        }
        else if (event.kind === 'question.resolved' || event.kind === 'approval.resolved' && event.data.auto === true && String(event.data.by).startsWith('session-grant:') || event.kind === 'turn.completed' && event.data.status === 'failed') {
            row = { taskId: task, lead: lead(event), id: event.seq, seqs: [event.seq], request };
            this.addRow(row);
        }
        if (row)
            this.bySeq.set(event.seq, row);
        return undefined;
    }
    private addRow(row: Row) {
        const insert = (rows: Row[]) => {
            if (!rows.length || rows.at(-1)!.id < row.id) { rows.push(row); return; }
            let lo = 0, hi = rows.length;
            while (lo < hi) { const mid = (lo + hi) >>> 1; if (rows[mid]!.id < row.id) lo = mid + 1; else hi = mid; }
            rows.splice(lo, 0, row);
        };
        if (row.lead)
            insert(this.rows);
        let rows = this.taskRows.get(row.taskId);
        if (!rows) {
            rows = [];
            this.taskRows.set(row.taskId, rows);
        }
        insert(rows);
    }
    private materialize(row: Row): HistoryMessage {
        const first = this.log.readEvent(row.seqs[0]!)!;
        if (row.steering) {
            const prompt = this.log.readEvent(row.steering.prompt)!;
            const fence = this.log.readEvent(row.steering.fence)!;
            const receipt = this.log.readEvent(row.steering.receipt)!;
            return { ...first, kind: 'message.completed', source: { taskId: row.taskId, memberId: 'lead' }, ts: fence.ts, historyId: row.id, data: { role: 'user', text: prompt.data.text, promptId: prompt.data.promptId, steering: true, steeringSeq: fence.seq,steeringRunnerId:fence.data.runnerId, historical: receipt.data.eligible !== true, ...(receipt.data.stale ? { decisionReply: { stale: true } } : {}) } };
        }
        const request = row.request ? this.log.readEvent(row.request) : undefined;
        const data = { ...first.data };
        if (first.kind === 'message.delta')
            data.text = row.text ?? row.seqs.map(seq => { const event = this.log.readEvent(seq)!; return String(event.data.text ?? event.data.delta ?? ''); }).join('');
        if (first.kind === 'question.resolved') {
            // Missing request metadata is fail-closed; secret values never cross
            // this new transport even if an old ledger contains legacy answers.
            const questions = Array.isArray(request?.data.questions) ? request.data.questions : [];
            const allowed = new Set(questions.filter(q => q && typeof q === 'object' && q.secret !== true).map(q => q.id));
            if (data.answers && typeof data.answers === 'object')
                data.answers = Object.fromEntries(Object.entries(data.answers).filter(([id]) => allowed.has(id)));
        }
        return { ...first, seq: row.seqs.at(-1)!, historyId: row.id, data, ...(request ? { request } : {}) };
    }
    messageAt(event: SessionEvent, taskId?: string) {
        const row = this.bySeq.get(event.seq);
        if (!row || (taskId ? row.taskId !== taskId : !row.lead))
            return;
        // Live deltas stay deltas on the wire; snapshots alone carry joined text.
        return !row.steering && (event.kind === 'message.delta' || event.kind === 'message.completed') ? { ...event, historyId: row.id } : this.materialize(row);
    }
    page({ before, after, around, taskId, limit = HISTORY_PAGE_SIZE }: {
        taskId?: string;
        before?: number;
        around?: number;
        after?: number;
        limit?: number;
    } = {}): HistoryPage {
        const entries = taskId ? this.taskRows.get(taskId) ?? [] : this.rows;
        // Stable first-event cursors survive live completion of a streamed row.
        const lower = (id: number) => {
            let lo = 0, hi = entries.length;
            while (lo < hi) {
                const mid = (lo + hi) >>> 1;
                if (entries[mid]!.id < id)
                    lo = mid + 1;
                else
                    hi = mid;
            }
            return lo;
        };
        const target=around===undefined?undefined:this.bySeq.get(around);
        if(around!==undefined&&(!target||(taskId?target.taskId!==taskId:!target.lead)))throw Error('history-message-unavailable');

        const end = target ? Math.min(entries.length,lower(target.id)+Math.ceil(limit/2)) : before === undefined ? after === undefined ? entries.length : Math.min(entries.length, lower(after + 1) + limit) : lower(before);
        const start = target ? Math.max(0,end-limit) : after === undefined ? Math.max(0, end - limit) : lower(after + 1);
        const rows = entries.slice(start, end);
        return { messages: rows.map(row => this.materialize(row)), ...(start > 0 && rows.length ? { before: rows[0]!.id } : {}), ...(end < entries.length && rows.length ? { after: rows.at(-1)!.id } : {}), seq: this.seq, events: around === undefined && before === undefined && after === undefined ? this.current.values() : [] };
    }
}
