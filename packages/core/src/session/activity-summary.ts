/** Active means executing a latest worker attempt with no pending human request.
 * Queued/created and human-blocked workers are reported separately everywhere. */
export function workerActivity(tasks: Iterable<{taskId:string; memberId?:string; state:string}>, blocked: ReadonlySet<string>) {
    const counts = {active:0, queued:0, blocked:0, unsettled:0};
    for (const task of tasks) {
        if (task.memberId === 'lead' || /^lead(?:-g[1-9]\d*)?$/.test(task.taskId)) continue;
        if (task.state === 'ownership-unsettled') counts.unsettled++;
        else if (['created','queued','running'].includes(task.state)) {
            if (blocked.has(task.taskId)) counts.blocked++;
            else if (task.state === 'running') counts.active++;
            else counts.queued++;
        }
    }
    return counts;
}
export type ActivitySummary = {
    workers: ReturnType<typeof workerActivity>;
    attention: {approvals:number; questions:number; decisions:number; byLead:number; byWorkers:number; unowned:number};
    errors: number;
};
export type ProjectActivity = {projectId:string; connected:number; leadsRunning:number; leadsStarting:number; workers:ActivitySummary['workers']; attentionSessions:number; attention:ActivitySummary['attention']; errors:number};

/** Validate the complete requested batch before publishing any transport data. */
export function validProjectActivities(value: unknown, requestedIds: readonly string[]): value is ProjectActivity[] {
    const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
    const counts = (v: unknown, keys: string[]) => record(v) && keys.every(key => Number.isSafeInteger(v[key]) && (v[key] as number) >= 0);
    const remaining = new Set(requestedIds);
    if (!Array.isArray(value) || value.length !== remaining.size) return false;
    for (const row of value) {
        if (!record(row) || typeof row.projectId !== 'string' || !remaining.delete(row.projectId)
            || !counts(row, ['connected','leadsRunning','leadsStarting','attentionSessions','errors'])
            || !counts(row.workers, ['active','queued','blocked','unsettled'])
            || !counts(row.attention, ['approvals','questions','decisions','byLead','byWorkers','unowned'])) return false;
    }
    return remaining.size === 0;
}
