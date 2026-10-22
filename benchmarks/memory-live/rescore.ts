import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { validateManifestIdentity, harnessHashes, type Manifest } from './manifest';
import { dataset } from './dataset';
import { readCase, scoreArtifact } from './case-artifacts';
import { nativeContext } from './capture-replay/native-output';
import { reportSummary, aggregateCases } from './report';
import { baselineStatistics } from './statistics';
import { privateWrite, fail } from './security';
export function rescore(m: Manifest) {
    validateManifestIdentity(m);
    const original = JSON.parse(readFileSync(join(m.evalRoot, 'results.json'), 'utf8'));
    const savedEvents = JSON.parse(readFileSync(join(m.evalRoot, 'events.json'), 'utf8'));
    const questions = new Map(dataset().questions.map(q => [q.id, q]));
    let rescored = 0, availabilityRescored = 0;
    const validQuality = original.quality?.validity === 'valid' && original.processing?.validity === 'valid';
    const score = (row: any, quality: boolean) => {
        if (!row.artifact) fail('run_has_no_rescorable_case_artifacts');
        const a = readCase(m.evalRoot, row), q = questions.get(row.id);
        if (!q) fail('case_missing_from_scoring_dataset');
        if (a.nativeHookOutput) { const decoded = nativeContext(a.nativeHookOutput); a.injectedText = decoded.text; a.injectedUnits = decoded.units; }
        if (quality) rescored++; else availabilityRescored++;
        const updated = { ...row, ...scoreArtifact(q, a) };
        if (quality && (!validQuality || row.status === 'invalid')) { updated.originalStatus = updated.status; updated.status = 'invalid'; updated.settledEligible = false; }
        return updated;
    };
    const results = original.results.map((suite: any) => ({ ...suite, cases: (suite.cases ?? []).map((row: any) => score(row, true)) }));
    const availabilityCases = original.availability?.cases?.map((row: any) => score(row, false));
    const availability = availabilityCases ? { ...original.availability, cases: availabilityCases, metrics: aggregateCases(availabilityCases.filter((row: any) => row.status === 'scored')) } : original.availability;
    const quality = validQuality ? original.quality : { ...original.quality, validity: 'invalid', reason: original.quality?.reason ?? 'no_document_processing_readiness_evidence' };
    const transport = { events: Array.isArray(savedEvents) ? savedEvents : savedEvents.events, blocked: savedEvents.blocked ?? [], violations: original.summary?.violations ?? [] };
    const path = join(m.evalRoot, 'rescore-' + randomBytes(8).toString('hex') + '.json');
    privateWrite(path, { ...original, quality, availability, results, summary: { ...reportSummary(results, [transport]), publicationValidity: quality.validity, ...(validQuality ? { statistics: baselineStatistics(results) } : {}) }, rescore: { originalDatasetHash: original.inputReceipts?.dataset, scoringDatasetHash: dataset().hash, harnessHashes: harnessHashes(), cases: rescored, availabilityCases: availabilityRescored, networkRequests: 0, originalArtifactsUnchanged: true } });
    return { path, cases: rescored, availabilityCases: availabilityRescored, networkRequests: 0 };
}
