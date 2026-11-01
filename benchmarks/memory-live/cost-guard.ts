import { isDocumentWrite, isMemoryProfile, isMemorySearch } from './request-policy';
import { maximumStatusPolls, measurementBands, validateProcessingPlan } from './processing';
import { initializeRunAuthority } from './run-authority';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { draftManifest, cleanupBudget, type Manifest } from './manifest';
import { dataset, orderedSeeds, isFuture } from './dataset';
import { NamespaceTransport, simulatedWire } from './namespace-transport';
import { lifecycleControls, makeProject, runtimeCapture, recallHost } from './capture-replay/runtime';
import { runtimeSkipProbes } from './capture-replay/probes';
import { fail, privateWrite, sha256 } from './security';

// Frozen planning assumptions, NOT a claim about provider billing or its tokenizer.
// Rates are the existing 2026-10-21 evidence snapshot. Unknown work gets an explicit allowance.
export const COST_POLICY = {
    executionContract: 'current-pi-v5-public-events-v1',
    memoryUsdPerProxyToken: .000005,
    searchUsd: .000005,
    observedSearchUnits: 'Pilot console +171 searches reconciled as 49 v4/search plus 122 profile-with-query; per-unit dollar equivalence remains an assumption.',
    operationUsd: .0001,
    unknownUsdPerAttempt: .0001,
    ingestionAttemptMultiplier: 2,
    tokenEstimate: 'ceil(content UTF-8 bytes / 4) per serialized write; heuristic only',
    tokenUpperProxy: 'one proxy token per content UTF-8 byte; conservative planning proxy, not a tokenizer bound',
    unknownAllowance: 'one $0.0001 operation-equivalent per attempted effect, including writes, setup, profiles, probes, errors and deletion; planning allowance, not a verified upper bound',
    retries: 'two complete serialized ingestion passes reserved; every actual attempt debited before send without refunds, including retries and lost acknowledgements; additional attempts stop at shared token/cost/request budgets',
    unknowns: ['Legacy endpoint equivalence to published v5 prices', 'Legacy profile with and without query meters', 'Extraction/output, changed chunks, metadata/body-overhead billing, provider-internal retries and dreaming work', 'Namespace inspection/configuration/deletion meters', 'Account LLM filtering and actual invoice debit; no account metadata read'],
} as const;
export type CostLimits = { ceilingUsd: number; stopUsd: number; cleanupReserveUsd: number };
export type WriteMeasure = { phase: string; contentUtf8Bytes: number; serializedBodyUtf8Bytes: number; contentHash: string; bodyHash: string };
export type Forecast = {
    method: 'production_r_serialization_offline';
    writes: WriteMeasure[];
    contentUtf8Bytes: number;
    serializedBodyUtf8Bytes: number;
    ingestionTokenEstimate: number;
    conservativeTokenUpperProxy: number;
    measuredWriteCount: number;
    capturesConsidered: number;
    skipProbes: unknown[];
    setupRequests: number; qualityRequests: number; availabilityRequests: number;
};
export type CostGuardPlan = CostLimits & {
    schema: 'deck-estimated-cost-guard-v1';
    policy: typeof COST_POLICY;
    forecast: Forecast;
    ingestionTokenBudget: number;
    maxWriteAttempts: number;
    executionForecast: ReturnType<typeof executionForecast>;
    forecastEvaluationUpperEstimateUsd: number;
    forecastTotalWithProtectedReserveUsd: number;
    cleanupRequestBudget: number;
    evaluationRequestBudget: number;
    frozenPlanHash: string;
    bunVersion: string;
    invoiceCap: false;
};
const usd = (micros: number) => micros / 1e6;
const micros = (amount: number) => Math.round(amount * 1e6);
function validateLimits(l: CostLimits) {
    if (![l.ceilingUsd, l.stopUsd, l.cleanupReserveUsd].every(v => Number.isFinite(v) && v > 0 && Number.isSafeInteger(v * 1e6)) || micros(l.stopUsd) + micros(l.cleanupReserveUsd) > micros(l.ceilingUsd))
        fail('invalid_estimated_cost_limits');
}
function planHash(m: Manifest) {
    // Approval booleans may be set after review. All execution inputs and budgets stay frozen.
    const { liveApproved, cleanupApproved, costGuard, ...inputs } = m;
    const { frozenPlanHash, ...guard } = costGuard!;
    return sha256(JSON.stringify({ inputs, guard }));
}
export async function forecastR(m: Manifest): Promise<Forecast> {
    if (m.mode !== 'pilot' || m.repeats !== 1) fail('cost_forecast_requires_r_pilot_one_repeat');
    const writes: WriteMeasure[] = [];
    const fake = simulatedWire();
    const t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: m.requestBudget, wire: async (url, init) => {
        if (isDocumentWrite(url.pathname)) {
            const serialized = String(init.body), body = JSON.parse(serialized);
            writes.push({ phase: t.phase, contentUtf8Bytes: Buffer.byteLength(body.content, 'utf8'), serializedBodyUtf8Bytes: Buffer.byteLength(serialized, 'utf8'), contentHash: sha256(body.content), bodyHash: sha256(serialized) });
        }
        return fake(url, init);
    } });
    const root = join(m.evalRoot, 'forecast');
    const projects = Object.fromEntries(['A', 'B', 'B-private', 'CONTROL'].map(p => [p, makeProject(root, 'r_runtime_1', p)]));
    const { seeds, poolSeeds, questions } = dataset();
    t.phase = 'corpus_and_pool_controls';
    for (const seed of orderedSeeds([...seeds, ...poolSeeds], 11)) await runtimeCapture(seed, projects[seed.project]!.scope, t);
    t.phase = 'controls';
    await lifecycleControls(root, projects.CONTROL!, t, true);
    t.phase = 'skip_probes';
    const skipProbes = await runtimeSkipProbes(projects.CONTROL!.scope, t);
    if (t.aborted || t.blocked.length) fail('cost_forecast_incomplete');
    const setupRequests = t.used;
    const queryCounts: number[] = [];
    t.frozen = true;
    for (const mode of ['quality', 'availability']) {
        const before = t.used;
        for (const q of questions.filter(q => !isFuture(q))) await recallHost(root, projects[q.project_under_query]!.cwd, q.query, q.role as any, t, 'forecast-' + mode + '-' + q.id);
        queryCounts.push(t.used - before);
    }
    if (t.aborted || t.blocked.length) fail('cost_forecast_incomplete');
    const contentUtf8Bytes = writes.reduce((n, w) => n + w.contentUtf8Bytes, 0);
    return { setupRequests, qualityRequests: queryCounts[0]!, availabilityRequests: queryCounts[1]!, method: 'production_r_serialization_offline', writes, contentUtf8Bytes, serializedBodyUtf8Bytes: writes.reduce((n, w) => n + w.serializedBodyUtf8Bytes, 0), ingestionTokenEstimate: writes.reduce((n, w) => n + Math.ceil(w.contentUtf8Bytes / 4), 0), conservativeTokenUpperProxy: contentUtf8Bytes, measuredWriteCount: writes.length, capturesConsidered: seeds.length + poolSeeds.length, skipProbes };
}
export function executionForecast(m: Manifest, f: Forecast, pollIntervalMs = m.processing!.pollIntervalMs) {
    const maxWriteAttempts = f.measuredWriteCount * 2;
    const maximumPollsPerRevision = maximumStatusPolls(m.processing!, pollIntervalMs);
    // The initial poll and ALL subsequent polls share one finite acceptance-based
    // lifetime, including early captures, waits, controls and final readiness. Fixed starts
    // are at least one interval apart; adaptive slots are consumed at most once.
    const monitoringStatusRequests = maxWriteAttempts * maximumPollsPerRevision;
    const { seeds, poolSeeds, questions } = dataset(), ordered = orderedSeeds([...seeds, ...poolSeeds], 11);
    const anchors = new Set(questions.filter(q => !isFuture(q)).map(q => {
        const refs = (q.seed_documents ?? []).map((d: any) => ordered.findIndex(s => s.id === d.seed_id));
        return refs.length ? Math.max(...refs) : Math.max(0, ordered.findIndex(s => s.project === q.project_under_query));
    }));
    const syntheticAvailabilityWaitUpperMs = anchors.size * m.processing!.nextTurnDelayMs;
    // Existing-but-empty tags require GET + three scoped lists + two legacy probes.
    const preflightRequests = 6 * Object.keys(m.bindings).length;
    const writeVisibilityRequests = 3 * Object.keys(m.bindings).length;
    const retryWrites = f.measuredWriteCount;
    const evaluationRequests = f.setupRequests + retryWrites + f.qualityRequests + f.availabilityRequests + preflightRequests + writeVisibilityRequests + monitoringStatusRequests;
    const evaluationEstimatedUsd = (f.conservativeTokenUpperProxy * 2 * 5 + evaluationRequests * 105) / 1e6;
    return { schedule: m.processing!.schedule, monitoringMode: m.processing!.monitoringMode, statusRetryPolicy: m.processing!.statusRetryPolicy, statusRequestTimeoutMs: m.processing!.requestTimeoutMs, statusConcurrency: m.processing!.statusConcurrency, pollOffsetsMs: m.processing!.pollOffsetsMs, precisionBands: measurementBands(m.processing!), maxWriteAttempts, setupRequests: f.setupRequests, retryWrites, qualityRequests: f.qualityRequests, availabilityRequests: f.availabilityRequests, preflightRequests, writeVisibilityRequests, monitoringStatusRequests, maximumPollsPerRevision, pollIntervalMs: m.processing!.schedule === 'fixed' ? pollIntervalMs : null,
        deadlineAnchor: m.processing!.deadlineAnchor, revisionDeadlineMs: m.processing!.deadlineMs, runDeadlineMs: m.processing!.runDeadlineMs, syntheticAvailabilityWaitUpperMs,
        zeroEffectDurationTimelineUpperMs: syntheticAvailabilityWaitUpperMs + m.processing!.deadlineMs,
        precisionTargetMs: m.processing!.schedule === 'adaptive-v1' ? 3000 : pollIntervalMs + m.processing!.requestTimeoutMs,
        precisionCondition: 'A target, verified from actual request-start/observation gaps including missing observations and queueing during capture/query I/O. Missed resolution or incomplete documents makes latency quantitatively invalid; no completion timestamp is inferred. Slow effects can reach the hard run deadline.',
        evaluationRequests, evaluationEstimatedUsd, fitsRequestBudget: evaluationRequests <= m.requestBudget,
        explanation: 'Two complete write passes; every attempted revision may have a distinct ID and receives the exact frozen adaptive slot count (or ceil(deadline / interval) in fixed mode), including initial/checkpoint polls. Adaptive concurrency changes overlap, not the total; missed slots are skipped without catch-up. This covers the entire capture/availability/control/final timeline, without per-phase renewal. Transient transport or HTTP408/429/500/502/503/504 status failures consume their original slot and remain charged; later existing slots may retry, never adding effects or renewing deadlines. Lost write acknowledgements remain invalid. Six preflight effects per namespace; explicit lifecycle retries are serialized in setup. The R client has no automatic retrieval retry loop. Every effect receives unknown-meter plus search allowance. Runtime budgets never renew. The nominal timeline upper bound assumes zero effect duration; only the separate hard run deadline bounds slow runs.' };

}
export async function prepareGuarded(input: Parameters<typeof draftManifest>[0], limits: CostLimits): Promise<Manifest> {
    validateLimits(limits);
    const m = draftManifest(input);
    if (existsSync(join(m.evalRoot, 'plan.json'))) fail('plan_already_exists');
    const forecast = await forecastR(m);
    const ingestionTokenBudget = forecast.conservativeTokenUpperProxy * COST_POLICY.ingestionAttemptMultiplier;
    // Every evaluation request gets the unknown-work allowance plus one search, even if
    // it will actually be a free inspection. Optional operations are charged at runtime.
    const evaluation = usd(ingestionTokenBudget * 5 + m.requestBudget * 105);
    m.costGuard = { schema: 'deck-estimated-cost-guard-v1', ...limits, policy: COST_POLICY, forecast, ingestionTokenBudget, maxWriteAttempts: forecast.measuredWriteCount * 2, executionForecast: executionForecast(m, forecast), forecastEvaluationUpperEstimateUsd: evaluation, forecastTotalWithProtectedReserveUsd: usd(micros(evaluation) + micros(limits.cleanupReserveUsd)), cleanupRequestBudget: cleanupBudget(m), evaluationRequestBudget: m.requestBudget, frozenPlanHash: '', bunVersion: Bun.version, invoiceCap: false };
    m.costGuard.frozenPlanHash = planHash(m);
    validateLiveCostGuard(m, false);
    initializeRunAuthority(m);
    privateWrite(join(m.evalRoot, 'plan.json'), m);
    return m;
}
export function validateLiveCostGuard(m: Manifest, requireFeasible = true) {
    try {
        const g = m.costGuard;
        // This bounded configuration range admits offline review proposals, not spending.
        // Defaults stay in draftManifest; execute still requires exact-manifest approval.
        if (!g || g.schema !== 'deck-estimated-cost-guard-v1' || g.invoiceCap !== false || g.bunVersion !== Bun.version || m.mode !== 'pilot' || m.repeats !== 1 || JSON.stringify(m.tracks) !== '["R"]' || !Number.isSafeInteger(m.requestBudget) || m.requestBudget < 1 || m.requestBudget > (m.processing?.schedule === 'adaptive-v1' ? 5994 : 3200) || cleanupBudget(m) !== 28 || JSON.stringify(g.policy) !== JSON.stringify(COST_POLICY)) fail('invalid');
        validateProcessingPlan(m.processing!);
        validateLimits(g);
        const f = g.forecast;
        if (f.method !== 'production_r_serialization_offline' || !Array.isArray(f.writes) || !f.writes.length || f.writes.some(w => !Number.isSafeInteger(w.contentUtf8Bytes) || w.contentUtf8Bytes < 0 || !Number.isSafeInteger(w.serializedBodyUtf8Bytes) || w.serializedBodyUtf8Bytes < w.contentUtf8Bytes || !/^[a-f0-9]{64}$/.test(w.contentHash) || !/^[a-f0-9]{64}$/.test(w.bodyHash))) fail('invalid');
        const bytes = f.writes.reduce((n, w) => n + w.contentUtf8Bytes, 0);
        const estimate = f.writes.reduce((n, w) => n + Math.ceil(w.contentUtf8Bytes / 4), 0);
        if (f.contentUtf8Bytes !== bytes || f.conservativeTokenUpperProxy !== bytes || f.ingestionTokenEstimate !== estimate || f.measuredWriteCount !== f.writes.length || f.serializedBodyUtf8Bytes !== f.writes.reduce((n, w) => n + w.serializedBodyUtf8Bytes, 0) || g.ingestionTokenBudget !== bytes * 2 || !Number.isSafeInteger(g.ingestionTokenBudget) || g.ingestionTokenBudget < 1) fail('invalid');
        if (![f.setupRequests, f.qualityRequests, f.availabilityRequests].every(n => Number.isSafeInteger(n) && n >= 0) || g.maxWriteAttempts !== f.measuredWriteCount * 2 || JSON.stringify(g.executionForecast) !== JSON.stringify(executionForecast(m, f))) fail('invalid');
        const evalMicros = g.ingestionTokenBudget * 5 + m.requestBudget * 105;
        if (g.evaluationRequestBudget !== m.requestBudget || g.cleanupRequestBudget !== cleanupBudget(m) || g.forecastEvaluationUpperEstimateUsd !== usd(evalMicros) || g.forecastTotalWithProtectedReserveUsd !== usd(evalMicros + micros(g.cleanupReserveUsd)) || evalMicros >= micros(g.stopUsd) || cleanupBudget(m) * 105 > micros(g.cleanupReserveUsd) || planHash(m) !== g.frozenPlanHash) fail('invalid');
    } catch { fail('live_requires_valid_cost_guard'); }
    if (requireFeasible && (!m.costGuard!.executionForecast.fitsRequestBudget || m.costGuard!.executionForecast.evaluationEstimatedUsd >= m.costGuard!.stopUsd || m.costGuard!.executionForecast.evaluationEstimatedUsd + m.costGuard!.cleanupReserveUsd > m.costGuard!.ceilingUsd)) fail('processing_forecast_exceeds_authorized_budget');
}

/** A synchronous reservation shared by evaluation and its independent cleanup transport.
 * No response can refund it: a timed out write or error may still have incurred provider work.
 */
type LedgerPlan = Pick<CostGuardPlan, 'ceilingUsd' | 'stopUsd' | 'cleanupReserveUsd' | 'ingestionTokenBudget' | 'maxWriteAttempts' | 'policy'>;
export class CostLedger {
    readonly #plan: LedgerPlan;
    #evaluationMicros = 0;
    #cleanupMicros = 0;
    #tokens = 0;
    #writes = 0;
    #estimatedTokens = 0;
    #evaluationRequests = 0;
    #cleanupRequests = 0;
    #reason: string | null = null;
    #projected: { evaluationUsd: number; totalUsd: number; ingestionTokens: number } | null = null;
    #stopProjection: { evaluationUsd: number; totalUsd: number; ingestionTokens: number } | null = null;
    constructor(plan: LedgerPlan, private readonly changed?: (snapshot: ReturnType<CostLedger['snapshot']>) => void, priorCleanupUsd = 0, priorCleanupRequests = 0) {
        this.#plan = structuredClone(plan);
        if (!Number.isFinite(priorCleanupUsd) || priorCleanupUsd < 0 || !Number.isSafeInteger(Math.round(priorCleanupUsd * 1e6))) fail('invalid_prior_cleanup_estimate');
        if (!Number.isSafeInteger(priorCleanupRequests) || priorCleanupRequests < 0) fail('invalid_prior_cleanup_requests');
        this.#cleanupMicros = micros(priorCleanupUsd);
        this.#cleanupRequests = priorCleanupRequests;
    }
    snapshot() {
        return { writeAttemptsUsed: this.#writes, maxWriteAttempts: this.#plan.maxWriteAttempts, schema: 'deck-estimated-cost-progress-v1', invoiceCap: false, estimated: true, ceilingUsd: this.#plan.ceilingUsd, stopUsd: this.#plan.stopUsd, cleanupReserveUsd: this.#plan.cleanupReserveUsd, ingestionTokenBudget: this.#plan.ingestionTokenBudget, ingestionTokensUsed: this.#tokens, ingestionTokenEstimateUsed: this.#estimatedTokens, evaluationUsedUsd: usd(this.#evaluationMicros), cleanupUsedUsd: usd(this.#cleanupMicros), totalUsedUsd: usd(this.#evaluationMicros + this.#cleanupMicros), projectedWithCleanupReserveUsd: usd(this.#evaluationMicros + micros(this.#plan.cleanupReserveUsd)), remainingToStopUsd: usd(Math.max(0, micros(this.#plan.stopUsd) - this.#evaluationMicros)), evaluationRequestsUsed: this.#evaluationRequests, cleanupRequestsUsed: this.#cleanupRequests, stopped: this.#reason !== null, stopReason: this.#reason, nextEffectProjection: this.#projected, stoppedEffectProjection: this.#stopProjection, unknowns: this.#plan.policy.unknowns };
    }
    reserve(endpoint: string, body: any, cleanup: boolean, commit?: () => void) {
        if (!cleanup && this.#reason) fail('estimated_cost_guard_stopped');
        const bytes = isDocumentWrite(endpoint) ? Buffer.byteLength(String(body.content ?? ''), 'utf8') : 0;
        const operations = Number(body.dreaming === 'instant') + Number(body.rerank === true || body.rerank === 'order' || body.rerank === 'aggregate') + Number(body.rewriteQuery === true) + Number(body.aggregate === true);
        const charge = bytes * 5 + Number(isMemorySearch(endpoint) || isMemoryProfile(endpoint) && !!body.q) * 5 + operations * 100 + 100;
        const projectedEval = this.#evaluationMicros + (cleanup ? 0 : charge);
        const projectedCleanup = this.#cleanupMicros + (cleanup ? charge : 0);
        this.#projected = { evaluationUsd: usd(projectedEval), totalUsd: usd(projectedEval + (cleanup ? projectedCleanup : micros(this.#plan.cleanupReserveUsd))), ingestionTokens: this.#tokens + bytes };
        const reason = isDocumentWrite(endpoint) && this.#writes + 1 > this.#plan.maxWriteAttempts ? 'write_attempt_budget' : !cleanup && this.#tokens + bytes > this.#plan.ingestionTokenBudget ? 'ingestion_token_budget'
            : !cleanup && projectedEval >= micros(this.#plan.stopUsd) ? 'estimated_stop_threshold'
            : cleanup && projectedCleanup > micros(this.#plan.cleanupReserveUsd) ? 'cleanup_estimated_reserve'
            : projectedEval + (cleanup ? projectedCleanup : micros(this.#plan.cleanupReserveUsd)) > micros(this.#plan.ceilingUsd) ? 'estimated_total_ceiling' : null;
        if (reason) {
            this.#reason ??= reason;
            this.#stopProjection ??= this.#projected;
            this.changed?.(this.snapshot());
            fail('estimated_cost_guard_stopped');
        }
        commit?.();
        if (isDocumentWrite(endpoint)) this.#writes++;
        this.#tokens += bytes;
        this.#estimatedTokens += Math.ceil(bytes / 4);
        if (cleanup) { this.#cleanupMicros = projectedCleanup; this.#cleanupRequests++; }
        else { this.#evaluationMicros = projectedEval; this.#evaluationRequests++; }
        this.changed?.(this.snapshot());
    }
}

/** Recovery does not need matching source hashes, a current Bun version or an ingestion
 * forecast. Its explicit ceiling covers cumulative cleanup only, never unknown old ingestion.
 */
export function cleanupCostLedger(ceiling: number | undefined, priorUsd: number, changed?: (snapshot: ReturnType<CostLedger['snapshot']>) => void, priorRequests = 0) {
    if (typeof ceiling !== 'number' || !Number.isFinite(ceiling) || ceiling <= 0 || !Number.isSafeInteger(ceiling * 1e6) || priorUsd > ceiling)
        fail('explicit_cleanup_cost_guard_required');
    return new CostLedger({ ceilingUsd: ceiling, stopUsd: 0, cleanupReserveUsd: ceiling, ingestionTokenBudget: 0, maxWriteAttempts: 0, policy: COST_POLICY }, changed, priorUsd, priorRequests);
}
