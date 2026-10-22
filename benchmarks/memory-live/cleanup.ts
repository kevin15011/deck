import { readCleanupConfirmation } from './cleanup-authorization';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateManifestIdentity, assertLiveRoot, assertAccountDeclaration, cleanupBudget, type Manifest } from './manifest';
import { NamespaceTransport, type Wire } from './namespace-transport';
import { estimateCost } from './score';
import { RunAuthority, publicAuthorityError } from './run-authority';
import { cleanupCostLedger } from './cost-guard';
import { readEvalKey, privateWrite, sha256, fail } from './security';
export async function cleanup(m: Manifest, options: {
    live?: boolean;
    wire?: Wire;
    estimatedCleanupCeilingUsd?: number;
} = {}) {
    validateManifestIdentity(m);
    if (!options.live && !options.wire)
        fail('cleanup_requires_explicit_transport');
    if (options.live) assertAccountDeclaration(m);
    const guarded = options.live || options.estimatedCleanupCeilingUsd !== undefined;
    if (guarded) {
        cleanupCostLedger(options.estimatedCleanupCeilingUsd, 0);
        if (m.costGuard && (options.estimatedCleanupCeilingUsd ?? Infinity) > m.costGuard.cleanupReserveUsd)
            fail('cleanup_ceiling_exceeds_original_reserve');
    }
    if (options.live) {
        assertLiveRoot(m);
        if (m.liveApproved !== true || options.wire) fail('cleanup_requires_live_approved_manifest');
    }
    const authority = RunAuthority.acquire(m, 'cleanup');
    try {
        authority.configureCleanup(options.estimatedCleanupCeilingUsd);
        const prior = authority.totals();
        const costLedger = guarded ? cleanupCostLedger(options.estimatedCleanupCeilingUsd, prior.cleanupMicros / 1e6, progress => {
            privateWrite(join(m.evalRoot, 'cleanup-cost-progress.json'), { run: m.run, scope: 'cumulative_cleanup_only', ...progress });
            if (progress.stopped) console.error(JSON.stringify({ event: 'estimated_cleanup_guard_stop', run: m.run, stopReason: progress.stopReason, cleanupUsedUsd: progress.cleanupUsedUsd }));
        }, prior.cleanupRequests) : undefined;
        let key = options.live ? readEvalKey() : undefined;
        try {
            const t = new NamespaceTransport({ run: m.run, bindings: m.bindings, budget: cleanupBudget(m), wire: options.wire ?? ((u, i) => fetch(u, i)), ...(key ? { key: () => key! } : {}), cleanup: true, authorizeNamespaceDelete: true, costLedger, authority });
            return await cleanupWithTransport(m, t, { live: options.live === true, automatic: false });
        }
        finally {
            key = undefined;
        }
    } finally { authority.close(); }
}
/** Only the explicitly reconciled standalone path can obtain a cleanup authority. */
export async function cleanupWithTransport(m: Manifest, t: NamespaceTransport, options: {
    live: boolean;
    automatic: boolean;
}) {
    validateManifestIdentity(m);
    if (options.automatic) fail('automatic_cleanup_disabled_awaiting_reconciliation');
    if (options.live) {
        assertAccountDeclaration(m);
        assertLiveRoot(m);
        if (m.liveApproved !== true)
            fail('cleanup_requires_live_approved_manifest');
    }
    t.assertRunAuthority(m);
    t.phase = 'cleanup';
    const ownershipPath = join(m.evalRoot, 'ownership.json'), hasOwnership = existsSync(ownershipPath);
    const ownership = hasOwnership ? JSON.parse(readFileSync(ownershipPath, 'utf8')) : { run: m.run, bindingsHash: sha256(JSON.stringify(m.bindings)), owned: {} };
    const tags = Object.values(m.bindings);
    if (ownership.run !== m.run || ownership.bindingsHash !== sha256(JSON.stringify(m.bindings)) || [...Object.keys(ownership.owned ?? {}), ...(ownership.unresolvedNamespaces ?? []), ...(ownership.attemptedNamespaces ?? []), ...(ownership.unownedNamespaces ?? [])].some(tag => !tags.includes(tag)))
        fail('cleanup_ownership_manifest_mismatch');
    const path = join(m.evalRoot, 'cleanup.json');
    const previous = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).journal ?? [] : [];
    // Old journals accepted v5 404 alone. Only receipts with the current proof version can be reused.
    const journal = tags.map(tag => {
        const prior = previous.find((e: any) => e.tag === tag && e.visibilityProofVersion === 2);
        const recordedWrites = Array.isArray(ownership.owned?.[tag]) && ownership.owned[tag].length > 0 || Array.isArray(ownership.attemptedNamespaces) && ownership.attemptedNamespaces.includes(tag) || Array.isArray(ownership.unresolvedNamespaces) && ownership.unresolvedNamespaces.includes(tag);
        const preflightProvedAbsent = Array.isArray(ownership.preflight) && ownership.preflight.some((p: any) => p.tag === tag && p.status === 'v5_absent_legacy_empty' && p.empty === true && p.v5Status === 404 && p.legacy?.empty === true && p.legacy.profileStatus === 200 && p.legacy.searchStatus === 200 && p.legacy.profileEmpty === true && p.legacy.searchEmpty === true);
        const mayHaveWrites = !hasOwnership || recordedWrites;
        return { ...prior, tag, mayHaveWrites, recordedWrites, preflightProvedAbsent, deleteAuthorized: recordedWrites || preflightProvedAbsent, ownedDocumentIds: ownership.owned?.[tag] ?? [], hadUnconfirmedWrites: ownership.unresolvedNamespaces?.includes(tag) ?? false, unowned: ownership.unownedNamespaces?.includes(tag) ?? false, visibilityProofVersion: 2, status: prior?.verifiedAbsent ? prior.status : 'retained_unattempted', verifiedAbsent: prior?.verifiedAbsent === true, attempts: prior?.attempts ?? [] };
    });
    const save = () => privateWrite(path, { run: m.run, journal, events: t.events, blocked: t.blocked, requestCount: t.used, requestCountScope: 'invocation', durableReservations: t.durableReservations, budget: cleanupBudget(m), automatic: options.automatic, mode: options.live ? 'live' : 'offline_simulation', complete: journal.every(e => e.verifiedAbsent), costProgress: t.costProgress, cost: { ...estimateCost(t.events), cleanupMetering: 'Namespace deletion surcharge unknown.' } });
    save();
    for (const entry of journal) {
        // Manifest membership alone never authorizes deletion, including on journal replay.
        if (entry.unowned || !entry.deleteAuthorized) {
            entry.status = entry.unowned ? 'retained_preexisting_namespace' : 'retained_ownership_unproven';
            entry.verifiedAbsent = false;
            save();
            continue;
        }
        if (entry.verifiedAbsent)
            continue;
        if (t.aborted)
            break;
        t.activateTags([entry.tag]);
        try {
            if (!entry.deleteAccepted) {
                entry.preDeleteStatus = await t.inspectNamespace(entry.tag);
                save();
                if (entry.preDeleteStatus !== 200) {
                    if (entry.preDeleteStatus === 404 && !entry.mayHaveWrites) {
                        entry.legacy = await t.legacyEmpty(entry.tag);
                        entry.verifiedAbsent = entry.legacy.empty;
                    }
                    entry.status = entry.verifiedAbsent ? 'verified_legacy_empty' : 'retained_visibility_unknown';
                    save();
                    continue;
                }
                for (let attempt = 0; attempt < 3; attempt++) {
                    // Whole run-unique namespace delete. A body, query, or moveTo cannot pass validation.
                    const r = await t.fetch(`https://api.supermemory.ai/ns/${entry.tag}`, { method: 'DELETE' });
                    entry.attempts.push({ status: r.status });
                    if (r.ok) {
                        entry.deleteAccepted = true;
                        save();
                        break;
                    }
                    if (r.status === 404) {
                        entry.status = 'retained_visibility_unknown';
                        break;
                    }
                    entry.status = 'retained_delete_failed';
                    save();
                    if (![429, 500, 502, 503, 504].includes(r.status))
                        break;
                    if (options.live)
                        await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
                }
            }
            if (entry.deleteAccepted) {
                entry.postDeleteStatus = await t.inspectNamespace(entry.tag);
                entry.legacy = await t.legacyEmpty(entry.tag);
                entry.verifiedAbsent = entry.preDeleteStatus === 200 && entry.postDeleteStatus === 404 && entry.legacy.empty;
                entry.status = entry.verifiedAbsent ? 'verified_absent' : 'retained_visibility_unknown';
            }
        }
        catch {
            entry.status = t.aborted ? 'retained_budget_exhausted' : 'retained_visibility_unknown';
        }
        save();
    }
    save();
    return { journal, requests: t.used, requestCountScope: 'invocation', durableReservations: t.durableReservations, complete: journal.every(e => e.verifiedAbsent), deletedNamespaces: journal.filter(e => e.verifiedAbsent && e.deleteAccepted).map(e => e.tag), verifiedEmptyNamespaces: journal.filter(e => e.verifiedAbsent && !e.deleteAccepted).map(e => e.tag), retainedNamespaces: journal.filter(e => !e.verifiedAbsent).map(e => ({ namespace: e.tag, reason: e.status })), costProgress: t.costProgress, cost: { ...estimateCost(t.events), namespaceDeletionMeterUsd: t.events.some(e => e.method === 'DELETE') ? 'unknown' : null } };
}
export function authorizeCleanup(m: Manifest, confirmation: unknown) {
    validateManifestIdentity(m);
    const authority = RunAuthority.acquire(m, 'cleanup');
    try { authority.authorizeCleanup(confirmation); return { run: m.run, status: 'cleanup_authorized_after_reconciliation' }; }
    finally { authority.close(); }
}
if (import.meta.main) {
    const args = process.argv.slice(2), i = args.indexOf('--manifest');
    if (args[0] === 'authorize') {
        try {
            const c = args.indexOf('--confirmation');
            if (i < 0 || c < 0 || args.includes('--live')) fail('explicit_manifest_and_confirmation_required');
            console.log(JSON.stringify(authorizeCleanup(JSON.parse(readFileSync(args[i + 1]!, 'utf8')), readCleanupConfirmation(args[c + 1]!))));
        } catch { console.error('cleanup_authorization_failed_closed'); process.exitCode = 1; }
    }
    else if (i < 0 || !args.includes('--live')) {
        console.error('cleanup_requires_live_and_manifest');
        process.exitCode = 1;
    }
    else
        cleanup(JSON.parse(readFileSync(args[i + 1]!, 'utf8')), { live: true, estimatedCleanupCeilingUsd: args.filter(a => a === '--estimated-cleanup-ceiling-usd').length === 1 ? Number(args[args.indexOf('--estimated-cleanup-ceiling-usd') + 1]) : undefined }).then(r => {
            console.log(JSON.stringify(r));
            if (!r.complete)
                process.exitCode = 1;
        }).catch(error => { console.error('cleanup_failed_closed: ' + (publicAuthorityError(error) ?? 'inspect the scoped cleanup journal'));  process.exitCode = 1; });
}
