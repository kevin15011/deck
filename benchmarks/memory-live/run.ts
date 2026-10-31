import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dataset, isFuture, orderedSeeds, shuffle } from './dataset';
import { NamespaceTransport, simulatedWire, type Wire, type Event, type TransportTiming } from './namespace-transport';
import { privateWrite, sha256, readEvalKey, fail } from './security';
import { prepare, validateManifest, assertLiveRoot, assertAccountDeclaration, parseAccountDeclaration, cleanupBudget, type Manifest } from './manifest';
export { prepare, validateManifest, validateManifestIdentity } from './manifest';
export type { Manifest } from './manifest';
import { makeProject, runtimeCapture, recallHost, envelopeUnits, rawUnits, lifecycleControls } from './capture-replay/runtime';
import { runtimeSkipProbes } from './capture-replay/probes';
import type { SupermemoryRuntimeRole } from '../../packages/adapter-supermemory/src/runtime';
import { persistCase, type CaseArtifact } from './case-artifacts';
import { futureProbe, type Question } from './score';
import { baselineStatistics } from './statistics';
import { reportSummary, aggregateCases, planningBudget } from './report';
import { RunAuthority, publicAuthorityError } from './run-authority';
import { prepareGuarded, validateLiveCostGuard, CostLedger } from './cost-guard';
import { ProcessingGate, realClock, simulationClock, parseProcessingArgs, type Clock } from './processing';
export type ExecuteOptions = { live?: boolean; wire?: Wire; includeNative?: boolean; clock?: Clock; transportTiming?: TransportTiming };
export async function execute(m: Manifest, options: ExecuteOptions = {}) {
    validateManifest(m);
    // Native payload/timing/status correspondence needs its own forecast and contract.
    if (m.mode !== 'pilot' || m.repeats !== 1) fail('full_baseline_processing_plan_not_supported');
    if (options.live && (m.liveApproved !== true || options.wire || options.clock || options.transportTiming)) fail('live_requires_explicit_approved_manifest');
    if (options.live) { assertAccountDeclaration(m); validateLiveCostGuard(m); assertLiveRoot(m); }
    if (m.costGuard) validateLiveCostGuard(m, options.live === true);
    const authority = RunAuthority.acquire(m, 'evaluation');
    try { authority.startEvaluation(); return await executeOwned(m, options, authority); }
    finally { authority.close(); }
}
async function executeOwned(m: Manifest, options: ExecuteOptions, authority: RunAuthority) {
    const offline = !options.live, clock = options.clock ?? (offline ? simulationClock() : realClock);
    const plan = m.processing!, runStartedAtMs = clock.now(), runDeadlineAtMs = runStartedAtMs + plan.runDeadlineMs;
    let key = options.live ? readEvalKey() : undefined, notified = false;
    const retained = { status: 'awaiting_reconciliation', policy: plan.retention, namespaces: Object.values(m.bindings), cleanupReserveUsd: m.costGuard?.cleanupReserveUsd ?? null, message: 'No automatic deletion or TTL. User must confirm console COST and every namespace breakdown, then explicitly authorize cleanup. Stopping requests does not cancel deferred processing; unmetered charges may still accrue.' };
    const ledger = m.costGuard ? new CostLedger(m.costGuard, progress => {
        privateWrite(join(m.evalRoot, 'cost-progress.json'), { run: m.run, ...progress });
        if (progress.stopped && !notified) { notified = true; console.error(JSON.stringify({ event: 'estimated_cost_guard_stop', run: m.run, stopReason: progress.stopReason, evaluationUsedUsd: progress.evaluationUsedUsd, nextEffectProjection: progress.nextEffectProjection, retention: retained })); }
    }) : undefined;
    const preflight: any[] = [], results: any[] = [];
    const availability: any = { mode: 'capture_relative_next_turn', evidenceBoundary: 'Actual recall at the configured delay; separate processing.statusAvailability curves describe status completion only at multiple horizons.', timingSource: plan.timingSource, requestedDelayMs: plan.nextTurnDelayMs, clock: offline ? 'offline_virtual_not_latency_evidence' : 'client_wall_clock', timeline: [], cases: [], capturedPrefixOnly: true };
    let status = 'running', evaluationStatus = 'running', failure: string | undefined, quality: any = { validity: 'invalid', reason: 'not_yet_ready' };
    let t: NamespaceTransport, gate: ProcessingGate | undefined, savedObservationCount = 0;
    const processingResponseReceipts: NonNullable<Event['processingResponse']>[] = [];
    const saveProcessingResponses = () => {
        // The transport invokes changed after recording a scrubbed response, before
        // returning it to ProcessingGate. Never wait for a case or successful status.
        for (; savedObservationCount < t.observations.length; savedObservationCount++) {
            const observation = t.observations[savedObservationCount]!;
            if (observation.eventIndex === undefined || observation.bodyJsonParsed === undefined) fail('processing_response_provenance_missing');
            const event = t.events[observation.eventIndex]!;
            if (event.method !== 'GET' || !/^\/ns\/[^/]+\/document\/[^/]+$/.test(event.endpoint)) continue;
            const artifact = `processing-responses/${String(observation.eventIndex).padStart(6, '0')}.json`;
            const encoded = t.sanitize(JSON.stringify({ schema: 'deck-processing-response-v1', run: m.run, bindingsHash: sha256(JSON.stringify(m.bindings)), eventIndex: observation.eventIndex, endpoint: event.endpoint, method: event.method, tag: event.tag, phase: event.phase, httpStatus: event.status, requestHash: event.requestHash, responseHash: event.responseHash, receivedAtMs: clock.now(), bodyJsonParsed: observation.bodyJsonParsed, body: observation.body }, null, 2) + '\n');
            privateWrite(join(m.evalRoot, artifact), encoded);
            event.processingResponse = { eventIndex: observation.eventIndex, artifact, artifactSha256: sha256(encoded) };
            processingResponseReceipts.push(event.processingResponse);
        }
    };
    const saveOwnership = () => { if (t) saveProcessingResponses(); if (t) privateWrite(join(m.evalRoot, 'ownership.json'), { schema: 'deck-memory-live-ownership-v1', run: m.run, bindingsHash: sha256(JSON.stringify(m.bindings)), owned: t.owned, attemptedNamespaces: [...t.writeIntents], unresolvedNamespaces: [...new Set(t.events.filter(e => e.endpoint === '/v3/documents' && (!e.documentId || e.error)).map(e => e.tag))], unownedNamespaces: preflight.filter(p => p.status === 'failed').map(p => p.tag), preflight, namespaceVisibility: t.namespaceVisibility }); gate?.notify(); };
    t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: m.requestBudget, wire: options.wire ?? simulatedWire(), ...(key ? { key: () => key! } : {}), ...(options.live ? { wire: (u, i) => fetch(u, i) } : {}), costLedger: ledger, authority, changed: saveOwnership, now: () => clock.now(), deadlineAtMs: runDeadlineAtMs, requestTimeoutMs: plan.ordinaryIoTimeoutMs, timing: options.transportTiming, verifyWriteVisibility: true, ...(offline ? { visibilityWait: async () => {} } : {}) });
    const processingGate = gate = new ProcessingGate(t, plan, clock);
    const automaticCleanup = { performed: false, disabledByPolicy: true, status: retained.status, requests: 0, retainedNamespaces: Object.values(m.bindings).map(namespace => ({ namespace, reason: retained.status })) };
    const save = () => {
        processingGate.refresh();
        saveOwnership();
        privateWrite(join(m.evalRoot, 'events.json'), { events: t.events, blocked: t.blocked });
        privateWrite(join(m.evalRoot, 'results.json'), { schema: 'deck-memory-live-results-v3', run: m.run, status, evaluationStatus, exitCode: evaluationStatus === 'completed' ? 0 : 1, failure, quality, processing: processingGate.snapshot(), processingResponseReceipts, processingPlan: plan, retention: retained, automaticCleanup, availability: { ...availability, expectedCases: questions.filter(q => !isFuture(q)).length, observedCases: availability.cases.length, unobservedCaseIds: questions.filter(q => !isFuture(q) && !availability.cases.some((c: any) => c.id === q.id)).map(q => q.id), metrics: aggregateCases(availability.cases.filter((c: any) => c.status === 'scored')) }, runStartedAtMs, runDeadlineAtMs, mode: offline ? 'offline_simulation_not_quality_evidence' : 'live', results, preflight, costGuard: m.costGuard ?? null, costProgress: ledger?.snapshot() ?? null, durableReservations: authority.receipt(), ownership: t.owned, namespaceVisibility: t.namespaceVisibility, accountSharedWithProduction: m.accountSharedWithProduction ?? null, accountSettingsCaveat: { code: 'account_settings_may_affect_ingestion', settingsRead: false, settingsChanged: false }, summary: { ...reportSummary(results, [t]), publicationValidity: quality.validity, ...(quality.validity === 'valid' ? { statistics: baselineStatistics(results) } : {}) }, budget: { limit: m.requestBudget, evaluationUsed: t.used, cleanupLimit: cleanupBudget(m), cleanupUsed: 0, totalLimit: m.requestBudget + cleanupBudget(m), cloudUsed: t.used, used: t.used, aborted: t.aborted }, inputReceipts: { dataset: m.datasetHash, source: m.sourceHashes, sourceCommit: m.sourceCommit, harness: m.harnessHashes }, limitations: [retained.message, 'Document content hash witnesses the latest revision; absent legacy-to-v5 correspondence invalidates quality.', 'Availability delays are configured synthetic timing, not measured Deck sessions.', 'Observed processing latencies are polling upper bounds; no answer utility is measured.'] });
    };
    const checkDeadline = () => { if (clock.now() >= runDeadlineAtMs) fail('evaluation_deadline'); if (t.aborted) fail('request_budget_exhausted'); };
    const { seeds, poolSeeds, questions } = dataset(), ordered = orderedSeeds([...seeds, ...poolSeeds], 11);
    const r: any = { track: 'R', repeat: 1, measurement: 'quality_after_readiness', captures: [], poolControls: [], cases: [] }; results.push(r);
    const record = (q: Question, measurement: string, text: string, observations: any[], durationMs: number, extra: any = {}) => persistCase(m.evalRoot, q, { schema: 'deck-eval-case-v1', id: q.id, track: 'R', repeat: 1, measurement, project: q.project_under_query, role: q.role, durationMs, settledEligible: measurement === 'quality_after_readiness', settledReason: measurement === 'quality_after_readiness' ? 'all_latest_document_revisions_indexed_and_memory_done' : 'capture_relative_no_readiness_requirement', injectedText: text, injectedUnits: envelopeUnits(text), rawReturnedUnits: rawUnits(observations), rawResponses: observations, ...extra } as CaseArtifact, t);
    try {
        t.activateRepeat(1); t.phase = 'preflight_1';
        for (const tag of Object.values(m.bindings)) {
            try { preflight.push(await t.preflightNamespace(tag)); }
            catch (e) { preflight.push({ tag, status: 'failed' }); throw e; }
            finally { save(); }
        }
        const projects = Object.fromEntries(['A', 'B', 'B-private', 'CONTROL'].map(p => [p, makeProject(m.evalRoot, 'r_runtime_1', p)]));
        // Anchor each query to its last required capture in the frozen ordering. No later
        // capture runs until that next-turn query finishes, so future facts cannot leak.
        const anchors = new Map(questions.filter(q => !isFuture(q)).map(q => {
            const refs = (q.seed_documents ?? []).map((d: any) => ordered.findIndex(s => s.id === d.seed_id));
            if (refs.some((i: number) => i < 0)) fail('availability_anchor_unresolved');
            return [q.id, refs.length ? Math.max(...refs) : Math.max(0, ordered.findIndex(s => s.project === q.project_under_query))];
        }));
        const assertProcessing = () => {
            if (processingGate.hasInvalidProcessing()) fail('processing_invalid');
        };
        const checkpoint = async () => { checkDeadline(); await processingGate.sample(-1, Infinity, runDeadlineAtMs, false); assertProcessing(); };
        processingGate.startMonitoring(runDeadlineAtMs);
        const captured: string[] = [];
        for (const [index, seed] of ordered.entries()) {
            checkDeadline(); t.phase = 'r_1_capture';
            const startedAtMs = clock.now();
            const capture = await runtimeCapture(seed, projects[seed.project]!.scope, t);
            captured.push(seed.id);
            (seed.id.startsWith('pool-') ? r.poolControls : r.captures).push({ id: seed.id, ok: capture.ok, metric: capture.metrics, startedAtMs, returnedAtMs: clock.now() });
            if (t.visibilityUnknown) fail('namespace_visibility_unknown');
            for (const q of questions.filter(q => anchors.get(q.id) === index)) {
                const targetAtMs = startedAtMs + plan.nextTurnDelayMs;
                t.phase = 'processing_monitor';
                await processingGate.monitorUntil(targetAtMs, runDeadlineAtMs, false, false); checkDeadline();
                assertProcessing();
                t.phase = 'availability_' + q.id; t.frozen = true;
                const actualAtMs = clock.now(), before = t.observations.length, beforeEffects = t.events.length, begin = performance.now();
                const host = await recallHost(m.evalRoot, projects[q.project_under_query]!.cwd, q.query, q.role as SupermemoryRuntimeRole, t, 'availability-' + q.id);
                checkDeadline();
                const readFailed = t.events.slice(beforeEffects).filter(e => e.phase === t.phase).some(e => e.error || e.status === undefined || e.status < 200 || e.status >= 300);
                const timeline = { question: q.id, anchorSeed: seed.id, captureStartedAtMs: startedAtMs, requestedDelayMs: plan.nextTurnDelayMs, targetAtMs, actualAtMs, completedAtMs: clock.now(), actualDelayMs: actualAtMs - startedAtMs, driftMs: actualAtMs - targetAtMs, capturedSeedIds: [...captured] };
                availability.timeline.push(timeline); availability.cases.push(record(q, 'next_turn_availability', host.advisoryText ?? '', t.observations.slice(before).filter(o => o.phase === t.phase), performance.now() - begin, { timeline, ...(readFailed ? { availability: 'unavailable', reason: 'recall_request_failed' } : {}) }));
                t.frozen = false;
            }
            await checkpoint();
            save();
        }
        checkDeadline(); t.phase = 'r_1_controls';
        r.lifecycle = await lifecycleControls(m.evalRoot, projects.CONTROL!, t, offline, checkpoint);
        r.skipProbes = await runtimeSkipProbes(projects.CONTROL!.scope, t);
        t.frozen = true; t.phase = 'processing_quality_gate';
        const readiness = await processingGate.waitForAll(runDeadlineAtMs);
        quality = { validity: readiness.validity, requiredLatestDocuments: readiness.requiredLatestDocuments, completed: readiness.completed, expectedCases: questions.length, criterion: 'all_latest_content_revisions_status_done_and_dreaming_done' };
        if (quality.validity !== 'valid') fail('processing_invalid');
        for (const q of shuffle(questions, 11)) {
            if (isFuture(q)) { r.cases.push({ ...record(q, 'quality_after_readiness', '', [], 0, { availability: 'unsupported' }), ...futureProbe(q) }); continue; }
            checkDeadline(); t.phase = 'quality_' + q.id;
            const before = t.observations.length, beforeEffects = t.events.length, begin = performance.now();
            const host = await recallHost(m.evalRoot, projects[q.project_under_query]!.cwd, q.query, q.role as SupermemoryRuntimeRole, t, 'quality-' + q.id);
            checkDeadline();
            if (t.events.slice(beforeEffects).filter(e => e.phase === t.phase).some(e => e.error || e.status === undefined || e.status < 200 || e.status >= 300)) fail('quality_recall_failed');
            r.cases.push(record(q, 'quality_after_readiness', host.advisoryText ?? '', t.observations.slice(before).filter(o => o.phase === t.phase), performance.now() - begin)); save();
        }
        if (ledger?.snapshot().stopped) fail('estimated_cost_guard_stopped');
        evaluationStatus = 'completed'; status = 'awaiting_reconciliation';
    } catch (e) {
        failure = ledger?.snapshot().stopped ? 'estimated_cost_guard_stopped' : e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'evaluation_incomplete';
        quality = { ...quality, validity: 'invalid', reason: failure, expectedCases: questions.length, partialCasesNotQualityEvidence: r.cases.length };
        // Preserve any partial artifacts but exclude all quality metrics on invalid runs.
        for (const row of r.cases) { row.originalStatus = row.status; row.status = 'invalid'; }
        evaluationStatus = 'invalid'; status = 'invalid_awaiting_reconciliation';
    } finally {
        await processingGate.stopMonitoring(); await t.drain(); authority.finishEvaluation();
        try { save(); console.error(JSON.stringify({ event: 'awaiting_cost_reconciliation', run: m.run, evaluationStatus, retention: retained })); }
        finally { key = undefined; }
    }
    return { status, evaluationStatus, exitCode: evaluationStatus === 'completed' ? 0 : 1, root: m.evalRoot, results, quality, retention: retained, automaticCleanup, costProgress: ledger?.snapshot() ?? null, summary: reportSummary(results, [t]) };
}
async function main() {
    const args = process.argv.slice(2), value = (flag: string) => { const i = args.indexOf(flag); return i < 0 ? undefined : args[i + 1]; }, command = args[0] ?? 'dry-run';
    if (command === 'prepare') {
        const mode = value('--mode') ?? 'pilot';
        if (!['pilot', 'full'].includes(mode))
            fail('invalid_mode');
        const processing = parseProcessingArgs(args);
        const input = { processing, mode: mode as 'pilot' | 'full', run: value('--run'), evalRoot: value('--eval-root'), repeats: value('--repeats') ? Number(value('--repeats')) : undefined, accountSharedWithProduction: parseAccountDeclaration(args), budget: value('--budget') ? Number(value('--budget')) : undefined };
        const costFlags = ['--estimated-cost-ceiling-usd', '--estimated-cost-stop-usd', '--cleanup-reserve-usd'];
        const wantsGuard = args.some(a => costFlags.some(f => a === f || a.startsWith(f + '=')));
        if (wantsGuard && (args.some(a => costFlags.some(f => a.startsWith(f + '='))) || costFlags.some(f => args.filter(a => a === f).length !== 1 || !value(f) || value(f)!.startsWith('--'))))
            fail('explicit_complete_cost_limits_required');
        const m = wantsGuard ? await prepareGuarded(input, { ceilingUsd: Number(value(costFlags[0]!)), stopUsd: Number(value(costFlags[1]!)), cleanupReserveUsd: Number(value(costFlags[2]!)) }) : prepare(input);
        console.log(args.includes('--manifest-path-only') ? join(m.evalRoot, 'plan.json') : JSON.stringify({ run: m.run, manifest: join(m.evalRoot, 'plan.json'), liveApproved: false, accountSharedWithProduction: m.accountSharedWithProduction ?? null, cleanupRequestBudget: cleanupBudget(m), budget: planningBudget(m) }));
        return;
    }
    const path = value('--manifest');
    if (!path)
        fail('explicit_run_manifest_required');
    const m = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
    if (command === 'rescore') {
        if (args.includes('--live'))
            fail('rescore_is_offline_only');
        const { rescore } = await import('./rescore');
        console.log(JSON.stringify(rescore(m)));
        return;
    }
    if (!['dry-run', 'run'].includes(command))
        fail('unknown_command');
    if (command === 'run' && !args.includes('--live'))
        fail('run_requires_live_flag');
    if (command === 'dry-run' && args.includes('--live'))
        fail('dry_run_cannot_be_live');
    const r = await execute(m, { live: args.includes('--live') });
    console.log(JSON.stringify({ status: r.status, results: join(r.root, 'results.json'), requests: r.summary.requests, cloudRequests: r.summary.cloudRequests, blockedRequests: r.summary.blockedRequests, cost: r.summary.cost, costProgress: r.costProgress, automaticCleanup: r.automaticCleanup }));
    process.exitCode = r.exitCode;
}
if (import.meta.main)
    main().catch(error => { console.error('memory_live_command_failed: ' + (publicAuthorityError(error) ?? 'inspect frozen inputs, manifest, permissions and receipts')); process.exitCode = 1; });
