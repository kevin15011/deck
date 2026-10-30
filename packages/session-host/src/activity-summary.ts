import { workerActivity, type ActivitySummary } from '@deck/core/session/activity-summary';
import type { Ledger } from './ledger';
export function summarizeActivity(ledger: Ledger, leadTaskId: string): ActivitySummary {
    const tasks = ledger.tasks().filter(t => t.memberId !== 'lead' || t.taskId === leadTaskId);
    const attention = {approvals:0, questions:0, decisions:0, byLead:0, byWorkers:0, unowned:0};
    const blocked = new Set<string>();
    const add = (kind: 'approvals'|'questions'|'decisions', taskId?:string) => {
        attention[kind]++;
        if (taskId && kind !== 'decisions') blocked.add(taskId);
        if (!taskId) attention.unowned++;
        else if (ledger.task(taskId)?.memberId === 'lead' || /^lead(?:-g[1-9]\d*)?$/.test(taskId)) attention.byLead++;
        else attention.byWorkers++;
    };
    for (const request of ledger.pendingApprovals()) add('approvals',request.taskId);
    for (const request of ledger.pendingQuestions()) add('questions',request.taskId);
    for (const decision of ledger.decisions()) if (decision.state === 'pending' && !(ledger.latest(decision.origin.taskId)?.attempt === decision.origin.attempt && ledger.latest(decision.origin.taskId)?.state === 'running')) add('decisions',decision.origin.taskId);
    return {attention, workers:workerActivity(tasks.map(t=>({taskId:t.taskId,memberId:t.memberId,state:t.attempts.at(-1)!.state})),blocked), errors:tasks.filter(t=>{
        const attempt=t.attempts.at(-1)!;
        // A discard is an explicit disposition of this exact attempt, not proof
        // of success. Integration alone never clears failure or uncertain ownership.
        return attempt.state==='ownership-unsettled' || attempt.state==='failed' && attempt.integration?.state!=='discarded';
    }).length};
}
