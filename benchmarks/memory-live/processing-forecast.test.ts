import { test, expect } from 'bun:test';
import { prepareGuarded, executionForecast, validateLiveCostGuard } from './cost-guard';
import { newRunId } from './manifest';
import { testScratch } from './test-support';
const scratch = testScratch();
test('forecast covers the entire acceptance-based monitoring lifetime, both modes, retry attempts and finite precision options', async () => {
    const run = newRunId(), m = await prepareGuarded({ run, evalRoot: scratch.root(run), mode: 'pilot', processing: { pollIntervalMs: 30000 }, accountSharedWithProduction: true }, { ceilingUsd: .25, stopUsd: .20, cleanupReserveUsd: .05 });
    const f = m.costGuard!.forecast;
    expect(f.contentUtf8Bytes).toBe(8239); expect(f.serializedBodyUtf8Bytes).toBe(26879); expect(f.ingestionTokenEstimate).toBe(2084);
    for (const interval of [30000, 60000, 120000, 300000]) {
        const x = executionForecast(m, f, interval);
        expect(x.monitoringStatusRequests).toBe(136 * Math.ceil(600000 / interval));
        expect(x.evaluationRequests).toBe(418 + x.monitoringStatusRequests);
        expect(x.maximumPollsPerRevision).toBe(Math.ceil(600000 / interval));
        expect(x.precisionTargetMs).toBe(interval + 5000);
        expect(x.runDeadlineMs).toBe(3600000);
        expect(x.syntheticAvailabilityWaitUpperMs).toBe(1230000);
        expect(x.deadlineAnchor).toBe('each_revision_acceptance');
    }
    expect(() => validateLiveCostGuard(m)).toThrow('processing_forecast_exceeds_authorized_budget');
    expect(executionForecast(m, f, 60000).fitsRequestBudget).toBe(false);
    expect(m.requestBudget + m.cleanupRequestBudget!).toBe(850);
});
