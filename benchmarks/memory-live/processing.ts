import { sha256, fail } from './security';
import { quantiles } from './score';
import { TransportFailure, type NamespaceTransport } from './namespace-transport';
export const RETENTION_POLICY = 'retain_until_explicit_console_cost_and_namespace_reconciliation_v1';
export type ProcessingPlan = {
    schema: 'deck-processing-plan-v3'; runDeadlineMs: number; deadlineMs: number; pollIntervalMs: number; requestTimeoutMs: number;
    monitoringMode: 'background_during_io_v1'; statusRetryPolicy: 'later_original_slots_v1';
    ordinaryIoTimeoutMs: 5000; // Frozen ordinary I/O allowance; requestTimeoutMs bounds status polls only.
    schedule: 'fixed' | 'adaptive-v1'; statusConcurrency: number; pollOffsetsMs: number[];
    nextTurnDelayMs: number; timingSource: 'synthetic_configured_not_empirical';
    deadlineAnchor: 'each_revision_acceptance'; retention: typeof RETENTION_POLICY;
};
export function processingPlan(overrides: Partial<Pick<ProcessingPlan, 'runDeadlineMs' | 'deadlineMs' | 'pollIntervalMs' | 'requestTimeoutMs' | 'nextTurnDelayMs' | 'schedule'>> = {}): ProcessingPlan {
    const schedule = overrides.schedule ?? 'fixed';
    const p: ProcessingPlan = { schema: 'deck-processing-plan-v3', monitoringMode: 'background_during_io_v1', statusRetryPolicy: 'later_original_slots_v1', schedule, statusConcurrency: schedule === 'adaptive-v1' ? 4 : 1, pollOffsetsMs: schedule === 'adaptive-v1' ? adaptivePollOffsets(overrides.deadlineMs ?? 600000) : [], runDeadlineMs: 3600000, deadlineMs: 600000, pollIntervalMs: 30000, requestTimeoutMs: 5000, ordinaryIoTimeoutMs: 5000, nextTurnDelayMs: 30000, timingSource: 'synthetic_configured_not_empirical', deadlineAnchor: 'each_revision_acceptance', retention: RETENTION_POLICY, ...overrides };
    validateProcessingPlan(p); return p;
}
/** Absolute acceptance-age slots, shared by scheduling and forecast. Boundary/checkpoint
 * slots are deduplicated. No poll at the exclusive processing deadline. */
export function adaptivePollOffsets(deadlineMs: number): number[] {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 3600000) fail('invalid_processing_plan');
    const offsets: number[] = [];
    for (let age = 0; age < deadlineMs; age += age < 60000 ? 2500 : age < 120000 ? 10000 : age < 300000 ? 30000 : 60000) offsets.push(age);
    return offsets;
}
export function maximumStatusPolls(p: ProcessingPlan, fixedInterval = p.pollIntervalMs) { return p.schedule === 'adaptive-v1' ? p.pollOffsetsMs.length : Math.ceil(p.deadlineMs / fixedInterval); }
export function measurementBands(p: ProcessingPlan) {
    return p.schedule === 'adaptive-v1' ? [
        { fromMs: 0, toMs: Math.min(60000, p.deadlineMs), nominalIntervalMs: 2500, cadenceTargetMs: 3000, precisionTargetMs: 3000 },
        { fromMs: 60000, toMs: Math.min(120000, p.deadlineMs), nominalIntervalMs: 10000, cadenceTargetMs: 10000, precisionTargetMs: 10000 + p.requestTimeoutMs },
        { fromMs: 120000, toMs: Math.min(300000, p.deadlineMs), nominalIntervalMs: 30000, cadenceTargetMs: 30000, precisionTargetMs: 30000 + p.requestTimeoutMs },
        { fromMs: 300000, toMs: p.deadlineMs, nominalIntervalMs: 60000, cadenceTargetMs: 60000, precisionTargetMs: 60000 + p.requestTimeoutMs },
    ].filter(b => b.toMs > b.fromMs) : [{ fromMs: 0, toMs: p.deadlineMs, nominalIntervalMs: p.pollIntervalMs, cadenceTargetMs: p.pollIntervalMs + p.requestTimeoutMs, precisionTargetMs: p.pollIntervalMs + p.requestTimeoutMs }];
}
export function validateProcessingPlan(p: ProcessingPlan) {
    if (!p || p.monitoringMode !== 'background_during_io_v1' || p.statusRetryPolicy !== 'later_original_slots_v1' || p.ordinaryIoTimeoutMs !== 5000 || !['fixed', 'adaptive-v1'].includes(p.schedule) || p.statusConcurrency !== (p.schedule === 'adaptive-v1' ? 4 : 1) || JSON.stringify(p.pollOffsetsMs) !== JSON.stringify(p.schedule === 'adaptive-v1' ? adaptivePollOffsets(p.deadlineMs) : []) || !Number.isSafeInteger(p.runDeadlineMs) || p.runDeadlineMs < p.deadlineMs || p.runDeadlineMs > 86400000 || p.schema !== 'deck-processing-plan-v3' || p.retention !== RETENTION_POLICY || p.timingSource !== 'synthetic_configured_not_empirical' || p.deadlineAnchor !== 'each_revision_acceptance' || !Number.isSafeInteger(p.deadlineMs) || p.deadlineMs < 1 || p.deadlineMs > 3600000 || !Number.isSafeInteger(p.pollIntervalMs) || p.pollIntervalMs < 1 || p.pollIntervalMs > p.deadlineMs || !Number.isSafeInteger(p.requestTimeoutMs) || p.requestTimeoutMs < 1 || p.requestTimeoutMs > 15000 || !Number.isSafeInteger(p.nextTurnDelayMs) || p.nextTurnDelayMs < 0 || p.nextTurnDelayMs > 600000) fail('invalid_processing_plan');
}
export function parseProcessingArgs(args: string[]) {
    const fields = { '--run-deadline-ms': 'runDeadlineMs', '--processing-deadline-ms': 'deadlineMs', '--poll-interval-ms': 'pollIntervalMs', '--request-timeout-ms': 'requestTimeoutMs', '--next-turn-delay-ms': 'nextTurnDelayMs' } as const;
    const values: Parameters<typeof processingPlan>[0] = {};
    for (const [flag, key] of Object.entries(fields)) {
        const occurrences = args.filter(a => a === flag || a.startsWith(flag + '='));
        if (!occurrences.length) continue;
        const value = args[args.indexOf(flag) + 1];
        if (occurrences.length !== 1 || occurrences[0] !== flag || !value || !/^\d+$/.test(value)) fail('invalid_processing_timing_argument');
        values[key] = Number(value);
    }
    const schedules = args.filter(a => a === '--processing-schedule' || a.startsWith('--processing-schedule='));
    if (schedules.length) {
        const value = args[args.indexOf('--processing-schedule') + 1];
        if (schedules.length !== 1 || schedules[0] !== '--processing-schedule' || !['fixed', 'adaptive-v1'].includes(value!) || value === 'adaptive-v1' && args.some(a => a === '--poll-interval-ms' || a.startsWith('--poll-interval-ms='))) fail('invalid_processing_schedule_argument');
        values.schedule = value as ProcessingPlan['schedule'];
    }
    processingPlan(values); return values;
}
export type Clock = { now(): number; sleep(ms: number): Promise<void>; schedule?(ms: number, callback: () => void): () => void };
export const realClock: Clock = { now: () => Date.now(), sleep: ms => new Promise(resolve => setTimeout(resolve, ms)), schedule: (ms, fn) => { const timer = setTimeout(fn, ms); return () => clearTimeout(timer); } };
export function simulationClock(): Clock {
    let now = Date.now(); const timers = new Set<{ at: number; fn(): void }>();
    return { now: () => now, schedule: (ms, fn) => { const timer = { at: now + ms, fn }; timers.add(timer); return () => { timers.delete(timer); }; }, sleep: async ms => {
        const target = now + ms;
        while (true) {
            const timer = [...timers].sort((a, b) => a.at - b.at)[0];
            if (!timer || timer.at > target) break;
            now = Math.max(now, timer.at); timers.delete(timer); timer.fn();
            await new Promise<void>(resolve => setImmediate(resolve));
        }
        now = Math.max(now, target); await new Promise<void>(resolve => setImmediate(resolve));
    } };
}
export const safeDocumentId = (id: unknown): id is string => typeof id === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,254}$/.test(id);
type Document = { tag: string; id: string; revision: string; latestAttempt: number; attempts: number[]; writeStartedAtMs: number; acceptedAtMs: number | null; status: string; observations: any[]; attemptedSlotsMs: number[]; processingDeadlineAtMs: number; nextPollAtMs: number; monitoringEndedAtMs?: number; indexingObservedAtMs?: number; memoryObservedAtMs?: number; readyObservedAtMs?: number; lastNotDreamedAtMs?: number; lastNotIndexedAtMs?: number; lastNotReadyAtMs?: number; reason?: string };
/** All writes are accounted for. Earlier acknowledged revisions link to the latest one;
 * an uncertain/malformed acknowledgement cannot be repaired by guessing a custom ID. */
export class ProcessingGate {
    readonly documents = new Map<string, Document>();
    readonly superseded: Document[] = [];
    readonly errors: { attempt: number; reason: string }[] = [];
    gateStartedAtMs?: number;
    deadlineAtMs?: number;
    private background = false;
    private stopped = false;
    private pumping = false;
    private runDeadline = Infinity;
    private cancelWake?: () => void;
    private readonly inFlight = new Map<Document, { controller: AbortController; task: Promise<void> }>();
    constructor(private t: NamespaceTransport, readonly plan: ProcessingPlan, private clock: Clock) {}
    /** The same due-slot scheduler runs through ordinary capture/query I/O. Legacy
     * injected clocks without timers retain explicit cooperative offline sampling. */
    startMonitoring(runDeadlineAtMs: number) {
        if (!this.clock.schedule) return false;
        this.background = true; this.runDeadline = runDeadlineAtMs; this.notify(); return true;
    }
    notify() {
        if (!this.background || this.stopped || this.pumping) return;
        this.pumping = true;
        try {
            this.cancelWake?.(); this.cancelWake = undefined;
            this.refresh(); this.expire(this.runDeadline);
            if (this.unhealthy()) return;
            const due = [...this.documents.values()].filter(d => d.status === 'pending' && !this.inFlight.has(d) && !this.writeInFlight(d)).sort((a,b) => a.nextPollAtMs - b.nextPollAtMs || a.latestAttempt - b.latestAttempt);
            for (const d of due) {
                if (this.inFlight.size >= this.plan.statusConcurrency || d.nextPollAtMs > this.clock.now() || this.unhealthy()) break;
                void this.launch(d, Infinity, this.runDeadline);
            }
            const pending = [...this.documents.values()].filter(d => d.status === 'pending');
            const next = Math.min(this.runDeadline, ...pending.map(d => d.processingDeadlineAtMs), ...pending.filter(d => !this.inFlight.has(d) && !this.writeInFlight(d) && this.inFlight.size < this.plan.statusConcurrency).map(d => d.nextPollAtMs));
            if (pending.length && Number.isFinite(next)) this.cancelWake = this.clock.schedule!(Math.max(1, next - this.clock.now()), () => this.notify());
        } finally { this.pumping = false; }
    }
    async stopMonitoring() {
        this.stopped = true; this.background = false; this.cancelWake?.(); this.cancelWake = undefined;
        for (const flight of this.inFlight.values()) flight.controller.abort();
        await Promise.all([...this.inFlight.values()].map(f => f.task));
        for (const d of this.documents.values()) d.monitoringEndedAtMs ??= this.clock.now();
    }
    private writeInFlight(d: Document) {
        const hash = this.t.events[d.latestAttempt]?.customIdHash;
        return !!hash && this.t.events.slice(d.latestAttempt + 1).some(e => e.endpoint === '/v3/documents' && e.tag === d.tag && e.customIdHash === hash && e.completed === false && e.acceptedAtMs === undefined);
    }
    private launch(d: Document, horizon: number, deadline: number) {
        if (this.inFlight.has(d) || this.stopped) return this.inFlight.get(d)?.task ?? Promise.resolve();
        const entry = { controller: new AbortController(), task: Promise.resolve() };
        this.inFlight.set(d, entry);
        entry.task = this.poll(d, horizon, deadline, entry.controller).finally(() => { this.inFlight.delete(d); this.notify(); });
        return entry.task;
    }
    refresh() {
        // Recheck mutable receipts on every refresh, without allocating a copy of
        // the full event log (most events are reads).
        for (let i = 0, length = this.t.events.length; i < length; i++) {
            const e = this.t.events[i]!;
            if (e.endpoint !== '/v3/documents') continue;
            if (e.completed === false && e.acceptedAtMs === undefined) continue; // In-flight writes are not lost acknowledgements.
            if (!safeDocumentId(e.documentId) || !e.contentHash || e.writeStartedAtMs === undefined || e.acceptedAtMs === undefined || e.status === undefined || e.status < 200 || e.status >= 300 || e.error) {
                if (!this.errors.some(x => x.attempt === i)) this.errors.push({ attempt: i, reason: 'write_or_revision_unresolvable' });
                continue;
            }
            const key = e.tag + '/' + e.documentId, prev = this.documents.get(key);
            if (prev?.attempts.includes(i)) continue;
            const attempts = [...(prev?.attempts ?? []), i];
            if (prev) { prev.monitoringEndedAtMs ??= e.acceptedAtMs; this.superseded.push(prev); this.inFlight.get(prev)?.controller.abort(); }
            this.documents.set(key, { tag: e.tag, id: e.documentId, revision: e.contentHash, latestAttempt: i, attempts, writeStartedAtMs: e.writeStartedAtMs, acceptedAtMs: e.acceptedAtMs, status: 'pending', observations: [], attemptedSlotsMs: [], processingDeadlineAtMs: e.acceptedAtMs + this.plan.deadlineMs, nextPollAtMs: e.acceptedAtMs });
        }
    }
    private expire(deadline = Infinity) {
        for (const d of this.documents.values()) if (d.status === 'pending' && this.clock.now() >= Math.min(deadline, d.processingDeadlineAtMs)) {
            d.status = 'timed_out'; d.reason = 'processing_deadline'; d.monitoringEndedAtMs = this.clock.now();
        }
    }
    hasInvalidProcessing() {
        if (this.errors.length) return true;
        for (const d of this.documents.values()) if (d.status !== 'pending' && d.status !== 'done') return true;
        return false;
    }
    private unhealthy() { return this.t.aborted || this.hasInvalidProcessing(); }
    /** Explicit sampling is retained for isolated/offline clocks. With background
     * monitoring active, this only notifies the same scheduler, never creates a second consumer. Pass report=false when only progress is needed. */
    async sample(_afterAttempt?: number, horizon?: number, runDeadlineAtMs?: number): Promise<ReturnType<ProcessingGate['snapshot']>>;
    async sample(_afterAttempt: number, horizon: number, runDeadlineAtMs: number, report: false): Promise<void>;
    async sample(_afterAttempt = -1, horizon = Infinity, runDeadlineAtMs = Infinity, report = true): Promise<ReturnType<ProcessingGate['snapshot']> | void> {
        if (this.background) { this.notify(); return report ? this.snapshot() : undefined; }
        this.refresh();
        this.expire(runDeadlineAtMs);
        if (this.unhealthy()) return report ? this.snapshot() : undefined;
        const due = [...this.documents.values()].filter(d => d.status === 'pending' && d.nextPollAtMs <= this.clock.now()).sort((a, b) => a.nextPollAtMs - b.nextPollAtMs || a.latestAttempt - b.latestAttempt);
        // Cooperative callers share the same in-flight slots and immutable lifetime.
        for (let at = 0; at < due.length; at += this.plan.statusConcurrency) {
            this.expire(runDeadlineAtMs);
            if (this.unhealthy() || this.clock.now() + this.plan.requestTimeoutMs > horizon) break;
            await Promise.all(due.slice(at, at + this.plan.statusConcurrency).map(d => this.launch(d, horizon, runDeadlineAtMs)));
        }
        return report ? this.snapshot() : undefined;
    }
    private async poll(d: Document, horizon: number, runDeadlineAtMs: number, controller: AbortController) {
            if (d.status !== 'pending' || this.unhealthy() || this.clock.now() + this.plan.requestTimeoutMs > horizon) return;
            const deadline = Math.min(d.processingDeadlineAtMs, runDeadlineAtMs);
            const remaining = deadline - this.clock.now();
            if (remaining <= 0) return;
            const startedAtMs = this.clock.now(), scheduledAtMs = d.nextPollAtMs;
            d.attemptedSlotsMs.push(scheduledAtMs);
            if (this.plan.schedule === 'fixed') d.nextPollAtMs = startedAtMs + this.plan.pollIntervalMs;
            const arm = this.clock.schedule ?? realClock.schedule!;
            const cancelTimeout = arm(Math.min(remaining, this.plan.requestTimeoutMs), () => controller.abort(new DOMException('Status timeout', 'TimeoutError')));
            const superseded = () => this.documents.get(d.tag + '/' + d.id) !== d;
            try {
                const response = await this.t.fetch(`https://api.supermemory.ai/ns/${d.tag}/document/${encodeURIComponent(d.id)}`, { method: 'GET', signal: controller.signal });
                if ([408, 429, 500, 502, 503, 504].includes(response.status)) { d.observations.push({ startedAtMs, scheduledAtMs, observedAtMs: this.clock.now(), missing: true, error: 'status_http_transient', httpStatus: response.status }); return; }
                const body = await response.json();
                this.refresh();
                const observedAtMs = this.clock.now(), s = body?.system;
                if (superseded() || this.stopped || this.writeInFlight(d)) { d.observations.push({ startedAtMs, scheduledAtMs, observedAtMs, missing: true, discarded: superseded() ? 'superseded_revision' : this.stopped ? 'monitor_stopped' : 'write_in_flight' }); return; }
                if (observedAtMs >= deadline) { d.status = 'timed_out'; d.reason = 'processing_deadline'; d.observations.push({ startedAtMs, scheduledAtMs, driftMs: startedAtMs - scheduledAtMs, observedAtMs, error: d.reason }); d.monitoringEndedAtMs = observedAtMs; return; }
                // V5 can return the submitted custom ID for a GET by the v3 ACK ID.
                // Only the latest acknowledged write supplies this alias witness; the GET path never changes.
                const responseIdHash = safeDocumentId(body?.id) ? sha256(body.id) : undefined;
                const identityKind = body?.id === d.id ? 'acknowledged_id' : responseIdHash && responseIdHash === this.t.events[d.latestAttempt]?.customIdHash ? 'submitted_custom_id_sha256' : undefined;
                if (!response.ok || !identityKind || !s || !['unknown', 'queued', 'extracting', 'chunking', 'embedding', 'indexing', 'done', 'failed'].includes(s.status) || !['dreaming', 'done'].includes(s.dreamingStatus) || ![s.createdAt, s.updatedAt].every(x => typeof x === 'string' && /Z$/.test(x) && Number.isFinite(Date.parse(x)))) throw new Error('malformed_or_unresolvable_document_status');
                const revisionMatches = typeof body.content === 'string' && sha256(body.content) === d.revision;
                d.observations.push({ startedAtMs, scheduledAtMs, driftMs: startedAtMs - scheduledAtMs, observedAtMs, status: s.status, dreamingStatus: s.dreamingStatus, providerUpdatedAt: s.updatedAt, revisionMatches, identityWitness: { kind: identityKind, writeAttempt: d.latestAttempt, responseIdHash } });
                if (s.status === 'unknown' || s.status === 'failed') { d.status = s.status; d.reason = 'document_' + s.status; return; }
                if ((s.status === 'done' || s.dreamingStatus === 'done') && !revisionMatches) { d.status = 'invalid'; d.reason = 'latest_revision_unresolved'; return; }
                if (s.status === 'done') d.indexingObservedAtMs ??= observedAtMs;
                else if (d.indexingObservedAtMs === undefined && revisionMatches) d.lastNotIndexedAtMs = startedAtMs;
                if (s.dreamingStatus === 'done') d.memoryObservedAtMs ??= observedAtMs;
                else if (d.memoryObservedAtMs === undefined && revisionMatches) d.lastNotDreamedAtMs = startedAtMs;
                if (s.status === 'done' && s.dreamingStatus === 'done' && revisionMatches) { d.readyObservedAtMs = observedAtMs; d.status = 'done'; }
                else if (revisionMatches) d.lastNotReadyAtMs = startedAtMs;
            } catch (error) {
                this.refresh();
                const missing = error instanceof TransportFailure && !this.t.aborted;
                const discarded = superseded() ? 'superseded_revision' : this.stopped ? 'monitor_stopped' : undefined;
                const reason = this.t.aborted ? 'budget_stop' : error instanceof Error && error.message === 'malformed_or_unresolvable_document_status' ? error.message : 'status_request_failed_or_timed_out';
                if (!missing && !discarded) { d.status = 'invalid'; d.reason = reason; }
                d.observations.push({ startedAtMs, scheduledAtMs, driftMs: startedAtMs - scheduledAtMs, observedAtMs: this.clock.now(), error: reason, missing, ...(error instanceof TransportFailure ? { transportFailure: error.kind } : {}), ...(discarded ? { discarded } : {}) });
            } finally {
                cancelTimeout();
                if (d.status !== 'pending') d.monitoringEndedAtMs = this.clock.now();
                if (this.plan.schedule === 'adaptive-v1') {
                    // Consume every elapsed slot, never replay a missed attempt or renew a phase.
                    // At least two seconds between starts allows small queue drift within the
                    // requested 2–3s early cadence without replaying elapsed slots.
                    const next = this.plan.pollOffsetsMs.find(age => d.acceptedAtMs! + age > this.clock.now() && d.acceptedAtMs! + age >= startedAtMs + 2000);
                    d.nextPollAtMs = next === undefined ? Infinity : d.acceptedAtMs! + next;
                }
            }
    }
    /** Fill idle time with due polls, returning at the query horizon even if not ready.
     * Status-only waves are bounded; transport waits include headers and body.
     * Suppressing a report skips only pure snapshot construction, not polling or expiry. */
    async monitorUntil(targetAtMs: number, runDeadlineAtMs?: number, stopWhenReady?: boolean): Promise<ReturnType<ProcessingGate['snapshot']>>;
    async monitorUntil(targetAtMs: number, runDeadlineAtMs: number, stopWhenReady: boolean, report: false): Promise<void>;
    async monitorUntil(targetAtMs: number, runDeadlineAtMs = Infinity, stopWhenReady = false, report = true): Promise<ReturnType<ProcessingGate['snapshot']> | void> {
        const horizon = Math.min(targetAtMs, runDeadlineAtMs);
        if (this.background) {
            while (this.clock.now() < horizon) {
                this.notify();
                if (this.unhealthy() || stopWhenReady && [...this.documents.values()].every(d => d.status === 'done')) break;
                await this.clock.sleep(Math.min(250, horizon - this.clock.now()));
            }
            this.expire(runDeadlineAtMs); return report ? this.snapshot() : undefined;
        }
        while (this.clock.now() < horizon) {
            await this.sample(-1, stopWhenReady ? Infinity : horizon, runDeadlineAtMs, false);
            if (this.unhealthy()) break;
            const pending = [...this.documents.values()].filter(d => d.status === 'pending');
            if (stopWhenReady && !pending.length) break;
            const now = this.clock.now();
            const nextDue = Math.min(...pending.map(d => d.nextPollAtMs));
            const expires = Math.min(...pending.map(d => d.processingDeadlineAtMs));
            // A slow round may leave earlier revisions overdue. Keep servicing them
            // while there is room; never sleep an entire remaining timeline window.
            if (nextDue <= now && (stopWhenReady || now + this.plan.requestTimeoutMs <= horizon)) continue;
            // An overdue poll with insufficient space is deferred until after the query.
            const wake = Math.min(horizon, expires, nextDue > now ? nextDue : horizon);
            if (wake > now) await this.clock.sleep(wake - now);
        }
        this.expire(runDeadlineAtMs);
        return report ? this.snapshot() : undefined;
    }
    async waitForAll(runDeadlineAtMs = Infinity) {
        this.refresh(); this.gateStartedAtMs = this.clock.now();
        this.deadlineAtMs = Math.min(runDeadlineAtMs, Math.max(this.gateStartedAtMs, ...[...this.documents.values()].map(d => d.processingDeadlineAtMs)));
        await this.monitorUntil(this.deadlineAtMs, runDeadlineAtMs, true, false);
        this.expire(runDeadlineAtMs);
        for (const d of this.documents.values()) if (d.status === 'pending') { d.status = 'invalid'; d.reason = 'invalid_peer'; d.monitoringEndedAtMs = this.clock.now(); }
        return this.snapshot();
    }
    snapshot() {
        const definitions = measurementBands(this.plan), resolutionMs = definitions[0]!.precisionTargetMs;
        const measured = (d: Document) => {
            let previous = d.acceptedAtMs!, maximumObservationGapMs = 0;
            for (const o of d.observations) { maximumObservationGapMs = Math.max(maximumObservationGapMs, o.observedAtMs - previous); if (!o.error && !o.missing) previous = o.startedAtMs; }
            // Include unobserved tails, failures and superseded pending revisions.
            if (d.status !== 'done') maximumObservationGapMs = Math.max(maximumObservationGapMs, (d.monitoringEndedAtMs ?? this.clock.now()) - previous);
            const end = d.monitoringEndedAtMs ?? this.clock.now(), origin = d.acceptedAtMs!;
            const bands = definitions.map(b => {
                let previousStart = origin, previousObservedStart = origin, maximumPollStartGapMs = 0, maximumObservationGapMs = 0;
                // Attribute the whole uncertainty interval to every band it intersects.
                // Clipping at a boundary would hide a slow response crossing 60 seconds.
                const overlap = (a: number, z: number) => Math.min(z - origin, b.toMs) > Math.max(a - origin, b.fromMs) ? z - a : 0;
                for (const o of d.observations) {
                    maximumPollStartGapMs = Math.max(maximumPollStartGapMs, overlap(previousStart, o.startedAtMs));
                    maximumObservationGapMs = Math.max(maximumObservationGapMs, overlap(previousObservedStart, o.observedAtMs)); previousStart = o.startedAtMs; if (!o.error && !o.missing) previousObservedStart = o.startedAtMs;
                }
                if (d.status !== 'done') {
                    maximumPollStartGapMs = Math.max(maximumPollStartGapMs, overlap(previousStart, end));
                    maximumObservationGapMs = Math.max(maximumObservationGapMs, overlap(previousObservedStart, end));
                }
                return { ...b, eligible: end - origin >= b.fromMs, maximumPollStartGapMs, maximumObservationGapMs,
                    cadenceValidity: maximumPollStartGapMs <= b.cadenceTargetMs ? 'valid' : 'invalid', precisionValidity: maximumObservationGapMs <= b.precisionTargetMs ? 'valid' : 'invalid' };
            });
            return { ...d, bands, monitoring: { requestedSchedule: this.plan.schedule, requestedIntervalMs: this.plan.schedule === 'fixed' ? this.plan.pollIntervalMs : null, resolutionMs, maximumObservationGapMs, resolutionMet: bands.every(b => b.precisionValidity === 'valid'), pollCount: d.observations.length, missingObservations: d.observations.filter(o => o.missing).length, missedScheduledSlotsMs: this.plan.pollOffsetsMs.filter(age => origin + age < Math.min(end, d.nextPollAtMs) && !d.attemptedSlotsMs.includes(origin + age)),
                indexingCompletionIntervalMs: d.indexingObservedAtMs === undefined ? null : { lower: (d.lastNotIndexedAtMs ?? d.acceptedAtMs!) - d.acceptedAtMs!, upper: d.indexingObservedAtMs - d.acceptedAtMs! },
                memoryCompletionIntervalMs: d.memoryObservedAtMs === undefined ? null : { lower: (d.lastNotDreamedAtMs ?? d.acceptedAtMs!) - d.acceptedAtMs!, upper: d.memoryObservedAtMs - d.acceptedAtMs! } } };
        };
        const docs = [...this.documents.values()].map(measured), superseded = this.superseded.map(measured), completed = docs.filter(d => d.status === 'done');
        const monitored = [...docs, ...superseded], resolutionMisses = monitored.filter(d => !d.monitoring.resolutionMet).length;
        const metric = (field: 'indexingObservedAtMs' | 'memoryObservedAtMs' | 'readyObservedAtMs', origin: 'writeStartedAtMs' | 'acceptedAtMs') => {
            const values = docs.filter(d => d[field] !== undefined && d[origin] !== null).map(d => d[field]! - d[origin]!);
            return { ...quantiles(values), observed: values.length, denominator: docs.length + this.errors.length, censoredOrFailed: docs.length + this.errors.length - values.length };
        };
        const bandSummary = definitions.map((b, i) => {
            const eligible = monitored.map(d => d.bands[i]!).filter(b => b.eligible);
            return { ...b, denominator: eligible.length, maximumPollStartGapMs: Math.max(0, ...eligible.map(b => b.maximumPollStartGapMs)), maximumObservationGapMs: Math.max(0, ...eligible.map(b => b.maximumObservationGapMs)),
                cadenceValidity: !eligible.length ? 'not_applicable' : eligible.every(b => b.cadenceValidity === 'valid') ? 'valid' : 'invalid',
                precisionValidity: !eligible.length ? 'not_applicable' : eligible.every(b => b.precisionValidity === 'valid') ? 'valid' : 'invalid' };
        });
        const horizons = [5000, 15000, 30000, 60000, 120000, 300000];
        const curves = (origin: 'acceptedAtMs' | 'writeStartedAtMs') => horizons.map(horizonMs => {
            const counts = (field: 'indexingObservedAtMs' | 'memoryObservedAtMs' | 'readyObservedAtMs', lower: 'lastNotIndexedAtMs' | 'lastNotDreamedAtMs' | 'lastNotReadyAtMs') => {
                let ready = 0, notReady = 0;
                for (const d of docs) {
                    if (d[field] !== undefined && d[field]! - d[origin]! <= horizonMs) ready++;
                    else if (d[lower] !== undefined && d[lower]! - d[origin]! >= horizonMs) notReady++;
                }
                const denominator = docs.length + this.errors.length, uncertain = denominator - ready - notReady;
                return { ready, notReady, uncertain, denominator, readyFractionLower: denominator ? ready / denominator : null, readyFractionUpper: denominator ? (ready + uncertain) / denominator : null };
            };
            return { horizonMs, fragments: counts('indexingObservedAtMs', 'lastNotIndexedAtMs'), memories: counts('memoryObservedAtMs', 'lastNotDreamedAtMs'), bothStates: counts('readyObservedAtMs', 'lastNotReadyAtMs') };
        });
        const fromWrite = curves('writeStartedAtMs');
        const statusAvailability = { measurement: 'document_status_completion_not_retrieval', origin: 'writeStartedAtMs', resolvedLatestRevisions: docs.length, unresolvedWriteObligations: this.errors.length, supersededCensored: superseded.filter(d => d.status !== 'done').length,
            curves: fromWrite, curvesFromAcceptance: curves('acceptedAtMs'),
            scenarios: { handoff5s: fromWrite[0]!, human30s: fromWrite[2]!, human60to300s: fromWrite.slice(3), nextSession: { measurement: 'actual_quality_after_all_ready', artifact: 'results[0].cases', caseMeasurement: 'quality_after_readiness', criterion: 'both_latest_states_done' } },
            caveat: 'Readiness bounds from first-observed document states, not retrieval/recall. Intervals straddling a horizon and censored/unresolved observations are uncertain; no interpolation. Primary denominator is latest resolved revisions plus unresolved write obligations (not deduplicable IDs). Superseded histories remain separate. Done observations are client upper bounds; lower bounds use non-done request starts.' };
        return { statusAvailability, validity: !this.errors.length && docs.length > 0 && completed.length === docs.length ? 'valid' : 'invalid', gateStartedAtMs: this.gateStartedAtMs ?? null, deadlineAtMs: this.deadlineAtMs ?? null, requiredLatestDocuments: docs.length, completed: completed.length, writesAccountedFor: docs.reduce((n, d) => n + d.attempts.length, 0) + this.errors.length, writeAttempts: this.t.events.flatMap((e, attempt) => e.endpoint === '/v3/documents' ? [{ attempt, tag: e.tag, documentId: e.documentId ?? null, revision: e.contentHash ?? null, writeStartedAtMs: e.writeStartedAtMs ?? null, acceptedAtMs: e.acceptedAtMs ?? null, httpStatus: e.status ?? null, error: e.error ?? null }] : []), invalidWrites: this.errors, supersededRevisions: superseded, documents: docs,
            latency: { bands: bandSummary, acknowledgement: { ...quantiles(docs.map(d => d.acceptedAtMs! - d.writeStartedAtMs)), observed: docs.length, denominator: docs.length + this.errors.length }, bothStatesFromAcceptance: metric('readyObservedAtMs', 'acceptedAtMs'), quantitativeValidity: !this.errors.length && docs.length > 0 && completed.length === docs.length && !resolutionMisses ? 'valid' : 'invalid', quantitativeInvalidReason: resolutionMisses ? 'sampling_resolution_not_achieved' : completed.length !== docs.length || this.errors.length || !docs.length ? 'incomplete_or_invalid_documents' : null, requestedSchedule: this.plan.schedule, requestedIntervalMs: this.plan.schedule === 'fixed' ? this.plan.pollIntervalMs : null, resolutionMs, resolutionMisses, maximumObservationGapMs: Math.max(0, ...monitored.map(d => d.monitoring.maximumObservationGapMs)), monitoredRevisions: monitored.length, supersededCensored: superseded.filter(d => d.status !== 'done').length, indexingFromWriteStart: metric('indexingObservedAtMs', 'writeStartedAtMs'), indexingFromAcceptance: metric('indexingObservedAtMs', 'acceptedAtMs'), memoryFromWriteStart: metric('memoryObservedAtMs', 'writeStartedAtMs'), memoryFromAcceptance: metric('memoryObservedAtMs', 'acceptedAtMs'), failed: docs.filter(d => d.status === 'failed').length, timedOut: docs.filter(d => d.status === 'timed_out').length, invalid: docs.filter(d => ['invalid', 'unknown'].includes(d.status)).length, caveat: 'Quantiles are quantitatively usable only when quantitativeValidity is valid (offline clocks remain simulation only). Client-observed upper bounds, interval-censored by recorded polls; each band reports actual start cadence and observation gaps separately; adaptive early precision targets 3 seconds even if request waits are longer. No provider latency guarantee. Missing responses, slow effects or scheduler contention can invalidate precision without invalidating readiness; latest acknowledged content hash is the revision witness. No provider completion timestamp or tokenizer claim. Failed/timeouts are not zero-duration completions; superseded revisions are listed separately.' } };
    }
}
