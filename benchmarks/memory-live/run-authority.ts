import { isDocumentWrite, isMemoryProfile, isMemorySearch } from './request-policy';
import { validateCleanupConfirmation, type CleanupConfirmation } from './cleanup-authorization';
import { Database, constants as sql } from 'bun:sqlite';
import { constants, openSync, closeSync, fsyncSync, lstatSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Manifest } from './manifest';
import { fail, sha256, privateWrite, secureDir } from './security';

const LOCK = 'run-lock.sqlite', LEDGER = 'run-spend.sqlite', MARKER = 'run-authority.json';
const receiptNames = ['ownership.json', 'results.json', 'events.json', 'cleanup.json', 'cost-progress.json', 'cleanup-cost-progress.json'];
const publicErrors = new Set(['cleanup_requires_reconciliation_authorization', 'run_in_use', 'run_authority_missing_or_corrupt', 'run_authority_unsafe_file', 'run_authority_not_held', 'run_authority_required', 'run_spend_state_invalid', 'run_spend_receipt_invalid', 'run_spend_receipt_conflict', 'run_already_has_receipts_use_new_run', 'cleanup_request_budget_exhausted', 'cleanup_estimated_reserve_exhausted', 'cleanup_ceiling_exceeds_durable_allowance']);
export function publicAuthorityError(error: unknown) { return error instanceof Error && publicErrors.has(error.message) ? error.message : undefined; }
const flags = sql.SQLITE_OPEN_READWRITE | sql.SQLITE_OPEN_NOFOLLOW | sql.SQLITE_OPEN_PRIVATECACHE;
type Totals = { evaluationRequests: number; cleanupRequests: number; evaluationMicros: number; cleanupMicros: number; tokens: number; tokenEstimate: number };
type State = Totals & { cleanupAuthorization?: { confirmation: CleanupConfirmation; hash: string };  schema: 'deck-run-spend-v1'; run: string; bindingsHash: string; evaluationLimit: number; cleanupLimit: number; evaluationStarted: boolean; evaluationFinished: boolean; cleanupCeilingMicros: number | null };
type Effect = { cleanup: boolean; micros: number; tokens: number; tokenEstimate: number; write: boolean; tag: string };
const zero = (): Totals => ({ evaluationRequests: 0, cleanupRequests: 0, evaluationMicros: 0, cleanupMicros: 0, tokens: 0, tokenEstimate: 0 });
const integer = (n: unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
function identity(path: string) {
    const s = lstatSync(path);
    if (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1 || (s.mode & 0o777) !== 0o600 || process.getuid && s.uid !== process.getuid()) fail('run_authority_unsafe_file');
    return { dev: s.dev, ino: s.ino };
}
function syncFile(path: string) { const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { fsyncSync(fd); } finally { closeSync(fd); } }
function createDatabase(path: string) {
    const fd = openSync(path, constants.O_CREAT | constants.O_EXCL | constants.O_RDWR | constants.O_NOFOLLOW, 0o600);
    try { fsyncSync(fd); } finally { closeSync(fd); }
    return runAuthorityStorage.open(path);
}
function openDatabase(path: string) {
    identity(path);
    // SQLite may open auxiliary paths during construction or its first pragma/read.
    // lstat only: never open a FIFO, follow a link, or inspect a sidecar payload here.
    // Private regular journals must remain available for SQLite's crash recovery.
    for (const suffix of ['-journal', '-wal', '-shm']) {
        try { identity(path + suffix); }
        catch (error: any) { if (error.code !== 'ENOENT') throw error; }
    }
    const db = new Database(path, flags);
    try { db.exec('PRAGMA busy_timeout=0; PRAGMA synchronous=EXTRA;'); return db; }
    catch (e) { db.close(); throw e; }
}
// Internal effect seam, never selected by a manifest, environment or CLI flag.
// Production and subprocess recovery always use the durable database opener.
export const runAuthorityStorage = { open: openDatabase };
/** Prepared once, never recreated by execute/cleanup. Missing files mean unknown history. */
export function initializeRunAuthority(m: Manifest) {
    secureDir(m.evalRoot);
    if ([MARKER, LOCK, LEDGER, ...receiptNames].some(n => existsSync(join(m.evalRoot, n)))) fail('run_authority_already_exists_use_new_run');
    const bindingsHash = sha256(JSON.stringify(m.bindings));
    const lock = createDatabase(join(m.evalRoot, LOCK));
    try {
        lock.exec('BEGIN IMMEDIATE; CREATE TABLE identity (value TEXT NOT NULL)');
        lock.query('INSERT INTO identity VALUES (?)').run(JSON.stringify({ run: m.run, bindingsHash }));
        lock.exec('COMMIT');
    } finally { lock.close(); }
    const db = createDatabase(join(m.evalRoot, LEDGER));
    try {
        // Publish each database's schema and initial state in one durable commit.
        // No authority marker or external effect exists until both commits finish.
        db.exec('BEGIN IMMEDIATE; CREATE TABLE state (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL); CREATE TABLE effects (seq INTEGER PRIMARY KEY, value TEXT NOT NULL);');
        const state: State = { schema: 'deck-run-spend-v1', run: m.run, bindingsHash, evaluationLimit: m.requestBudget, cleanupLimit: m.cleanupRequestBudget ?? 7 * Object.keys(m.bindings).length, evaluationStarted: false, evaluationFinished: false, cleanupCeilingMicros: m.costGuard ? Math.round(m.costGuard.cleanupReserveUsd * 1e6) : null, ...zero() };
        db.query('INSERT INTO state VALUES (1, ?)').run(JSON.stringify(state));
        db.exec('COMMIT');
    } finally { db.close(); }
    privateWrite(join(m.evalRoot, MARKER), { schema: 'deck-run-authority-v1', run: m.run, bindingsHash, lock: identity(join(m.evalRoot, LOCK)), ledger: identity(join(m.evalRoot, LEDGER)) });
    syncFile(join(m.evalRoot, MARKER));
    const directory = openSync(m.evalRoot, constants.O_RDONLY | constants.O_DIRECTORY);
    try { fsyncSync(directory); } finally { closeSync(directory); }
}

/** The lock database holds an exclusive OS-backed SQLite transaction for the WHOLE run.
 * A separate SQLite ledger commits each reservation with synchronous=EXTRA before send.
 * Process death releases the lock, but cannot roll back already committed reservations.
 */
export class RunAuthority {
    #closed = false;
    #sealed = false;
    #state: State;
    #marker: any;
    private constructor(private m: Manifest, private purpose: 'evaluation' | 'cleanup', private lock: Database, private ledger: Database, marker: any) {
        this.#marker = marker;
        this.#state = this.readState();
        this.checkReceipts();
    }
    static acquire(m: Manifest, purpose: 'evaluation' | 'cleanup') {
        let lock: Database | undefined, ledger: Database | undefined;
        try {
            identity(join(m.evalRoot, MARKER));
            const marker = JSON.parse(readFileSync(join(m.evalRoot, MARKER), 'utf8'));
            const bindingsHash = sha256(JSON.stringify(m.bindings));
            if (marker.schema !== 'deck-run-authority-v1' || marker.run !== m.run || marker.bindingsHash !== bindingsHash || JSON.stringify(marker.lock) !== JSON.stringify(identity(join(m.evalRoot, LOCK))) || JSON.stringify(marker.ledger) !== JSON.stringify(identity(join(m.evalRoot, LEDGER)))) fail('run_authority_missing_or_corrupt');
            lock = runAuthorityStorage.open(join(m.evalRoot, LOCK));
            try { lock.exec('BEGIN EXCLUSIVE'); }
            catch (e: any) { if (e.code === 'SQLITE_BUSY' || e.code === 'SQLITE_LOCKED') fail('run_in_use'); throw e; }
            const ids = lock.query('SELECT value FROM identity').all() as { value: string }[];
            if (ids.length !== 1 || ids[0]!.value !== JSON.stringify({ run: m.run, bindingsHash })) fail('run_authority_missing_or_corrupt');
            ledger = runAuthorityStorage.open(join(m.evalRoot, LEDGER));
            return new RunAuthority(m, purpose, lock, ledger, marker);
        } catch (e: any) {
            ledger?.close(); lock?.close();
            if (e.code === 'SQLITE_BUSY' || e.code === 'SQLITE_LOCKED') fail('run_in_use');
            if (/^(run_in_use|run_spend_|run_authority_)/.test(e.message ?? '')) throw e;
            fail('run_authority_missing_or_corrupt');
        }
    }
    assertHeld(m = this.m) {
        if (this.#closed || m.run !== this.m.run || sha256(JSON.stringify(m.bindings)) !== this.#state.bindingsHash || JSON.stringify(this.#marker.lock) !== JSON.stringify(identity(join(this.m.evalRoot, LOCK))) || JSON.stringify(this.#marker.ledger) !== JSON.stringify(identity(join(this.m.evalRoot, LEDGER)))) fail('run_authority_not_held');
    }
    assertCleanup(m: Manifest) {
        this.assertHeld(m);
        if (this.purpose === 'evaluation') fail('cleanup_requires_reconciliation_authorization');
        this.assertCleanupAuthorization();
    }
    authorizeCleanup(value: unknown) {
        this.assertHeld();
        if (this.purpose !== 'cleanup') fail('run_in_use');
        validateCleanupConfirmation(this.m, value);
        this.persist({ ...this.#state, cleanupAuthorization: { confirmation: structuredClone(value), hash: sha256(JSON.stringify(value)) } });
    }
    assertCleanupAuthorization() {
        this.assertHeld();
        const a = this.#state.cleanupAuthorization;
        if (this.purpose !== 'cleanup' || !a || a.hash !== sha256(JSON.stringify(a.confirmation))) fail('cleanup_requires_reconciliation_authorization');
        validateCleanupConfirmation(this.m, a.confirmation);
    }
    private readState(): State {
        try {
            const rows = this.ledger.query('SELECT value FROM state WHERE id=1').all() as { value: string }[];
            if (rows.length !== 1) fail('invalid');
            const s = JSON.parse(rows[0]!.value) as State;
            if (s.schema !== 'deck-run-spend-v1' || s.run !== this.m.run || s.bindingsHash !== sha256(JSON.stringify(this.m.bindings)) || s.evaluationLimit !== this.m.requestBudget || s.cleanupLimit !== (this.m.cleanupRequestBudget ?? 7 * Object.keys(this.m.bindings).length) || typeof s.evaluationStarted !== 'boolean' || typeof s.evaluationFinished !== 'boolean' || !(s.cleanupCeilingMicros === null || integer(s.cleanupCeilingMicros)) || Object.keys(zero()).some(k => !integer(s[k as keyof Totals]))) fail('invalid');
            if (s.cleanupAuthorization) { validateCleanupConfirmation(this.m, s.cleanupAuthorization.confirmation); if (s.cleanupAuthorization.hash !== sha256(JSON.stringify(s.cleanupAuthorization.confirmation))) fail('invalid'); }
            const effects = this.ledger.query('SELECT seq, value FROM effects ORDER BY seq').all() as { seq: number; value: string }[];
            const totals = zero();
            for (const [index, row] of effects.entries()) {
                const e = JSON.parse(row.value) as Effect;
                if (row.seq !== index + 1 || typeof e.cleanup !== 'boolean' || typeof e.write !== 'boolean' || !integer(e.micros) || e.micros < 100 || !integer(e.tokens) || !integer(e.tokenEstimate) || !Object.values(this.m.bindings).includes(e.tag)) fail('invalid');
                totals[e.cleanup ? 'cleanupRequests' : 'evaluationRequests']++;
                totals[e.cleanup ? 'cleanupMicros' : 'evaluationMicros'] += e.micros;
                totals.tokens += e.tokens; totals.tokenEstimate += e.tokenEstimate;
            }
            if (Object.keys(totals).some(k => totals[k as keyof Totals] !== s[k as keyof Totals]) || s.evaluationRequests > s.evaluationLimit || s.cleanupRequests > s.cleanupLimit || s.cleanupCeilingMicros !== null && s.cleanupMicros > s.cleanupCeilingMicros || s.evaluationRequests > 0 && !s.evaluationStarted) fail('invalid');
            return s;
        } catch { fail('run_spend_state_invalid'); }
    }
    /** Reporting files may lag or be absent; they must never contradict the committed ledger.
     * A corrupt present receipt is an explicit reconciliation error, never a zero default.
     */
    private checkReceipts() {
        const progress = (p: any) => {
            if (!p || p.schema !== 'deck-estimated-cost-progress-v1' || p.estimated !== true || p.invoiceCap !== false || !integer(p.ingestionTokensUsed) || !integer(p.ingestionTokenEstimateUsed) || !integer(p.cleanupRequestsUsed) || !integer(p.evaluationRequestsUsed) || !Number.isFinite(p.cleanupUsedUsd) || p.cleanupUsedUsd < 0 || !Number.isFinite(p.evaluationUsedUsd) || p.evaluationUsedUsd < 0) fail('run_spend_receipt_invalid');
            if (p.ingestionTokensUsed > this.#state.tokens || p.ingestionTokenEstimateUsed > this.#state.tokenEstimate || p.cleanupRequestsUsed > this.#state.cleanupRequests || p.evaluationRequestsUsed > this.#state.evaluationRequests || Math.round(p.cleanupUsedUsd * 1e6) > this.#state.cleanupMicros || Math.round(p.evaluationUsedUsd * 1e6) > this.#state.evaluationMicros) fail('run_spend_receipt_conflict');
        };
        for (const name of ['cost-progress.json', 'cleanup-cost-progress.json', 'cleanup.json', 'results.json']) {
            const path = join(this.m.evalRoot, name);
            if (!existsSync(path)) continue;
            let saved: any;
            try { identity(path); saved = JSON.parse(readFileSync(path, 'utf8')); } catch { fail('run_spend_receipt_invalid'); }
            if (!saved || saved.run !== this.m.run) fail('run_spend_receipt_invalid');
            if (name.endsWith('progress.json')) progress(saved);
            else {
                if (saved.costProgress !== null) progress(saved.costProgress);
                if (name === 'cleanup.json') {
                    if (!integer(saved.requestCount) || saved.requestCount > this.#state.cleanupRequests || !Array.isArray(saved.events) || !Array.isArray(saved.journal)) fail('run_spend_receipt_invalid');
                } else {
                    if (!integer(saved.budget?.evaluationUsed) || !integer(saved.budget?.cleanupUsed) || saved.budget.evaluationUsed > this.#state.evaluationRequests || saved.budget.cleanupUsed > this.#state.cleanupRequests) fail('run_spend_receipt_invalid');
                }
            }
        }
    }
    private persist(state: State, effect?: Effect) {
        this.assertHeld();
        this.ledger.exec('BEGIN IMMEDIATE');
        try {
            if (effect) this.ledger.query('INSERT INTO effects VALUES (?, ?)').run(state.evaluationRequests + state.cleanupRequests, JSON.stringify(effect));
            this.ledger.query('UPDATE state SET value=? WHERE id=1').run(JSON.stringify(state));
            this.ledger.exec('COMMIT');
            this.#state = state;
        } catch (e) { this.ledger.exec('ROLLBACK'); throw e; }
    }
    startEvaluation() {
        this.assertHeld();
        if (this.purpose !== 'evaluation' || this.#state.evaluationStarted || this.#state.cleanupAuthorization || this.#state.cleanupRequests || receiptNames.some(n => existsSync(join(this.m.evalRoot, n)))) fail('run_already_has_receipts_use_new_run');
        this.persist({ ...this.#state, evaluationStarted: true });
    }
    finishEvaluation() { this.#sealed = true; this.persist({ ...this.#state, evaluationFinished: true }); }
    configureCleanup(ceiling?: number) {
        this.assertCleanupAuthorization();
        if (ceiling !== undefined) {
            const micros = Math.round(ceiling * 1e6);
            if (!integer(micros) || micros < 1 || this.#state.cleanupCeilingMicros !== null && micros > this.#state.cleanupCeilingMicros) fail('cleanup_ceiling_exceeds_durable_allowance');
            if (micros < this.#state.cleanupMicros) fail('cleanup_estimated_reserve_exhausted');
            this.persist({ ...this.#state, cleanupCeilingMicros: micros });
        }
        if (this.#state.cleanupRequests >= this.#state.cleanupLimit) fail('cleanup_request_budget_exhausted');
        if (this.#state.cleanupCeilingMicros !== null && this.#state.cleanupMicros + 100 > this.#state.cleanupCeilingMicros) fail('cleanup_estimated_reserve_exhausted');
    }
    totals() { return { ...this.#state }; }
    receipt() {
        const s = this.#state;
        return { cleanupAuthorization: s.cleanupAuthorization ? { hash: s.cleanupAuthorization.hash, confirmedAt: s.cleanupAuthorization.confirmation.confirmedAt, bindingsHash: s.cleanupAuthorization.confirmation.bindingsHash } : null, schema: 'deck-durable-reservations-v1', evaluationRequests: s.evaluationRequests, cleanupRequests: s.cleanupRequests, totalRequests: s.evaluationRequests + s.cleanupRequests, evaluationLimit: s.evaluationLimit, cleanupLimit: s.cleanupLimit, evaluationUsedUsd: s.evaluationMicros / 1e6, cleanupUsedUsd: s.cleanupMicros / 1e6, totalUsedUsd: (s.evaluationMicros + s.cleanupMicros) / 1e6, ingestionTokensUsed: s.tokens, ingestionTokenEstimateUsed: s.tokenEstimate, cleanupCeilingUsd: s.cleanupCeilingMicros === null ? null : s.cleanupCeilingMicros / 1e6, includesUncertainSends: true };
    }
    beforeReservation(cleanup: boolean) {
        this.assertHeld();
        if (cleanup) this.assertCleanup(this.m);
        if (!cleanup && (this.purpose !== 'evaluation' || this.#sealed || !this.#state.evaluationStarted)) fail('evaluation_authority_closed');
        if (this.#state[cleanup ? 'cleanupRequests' : 'evaluationRequests'] >= this.#state[cleanup ? 'cleanupLimit' : 'evaluationLimit']) fail('request_budget_exhausted');
    }
    reserve(endpoint: string, body: any, cleanup: boolean, tag: string) {
        this.beforeReservation(cleanup);
        const tokens = isDocumentWrite(endpoint) ? Buffer.byteLength(String(body.content ?? ''), 'utf8') : 0;
        const operations = Number(body.dreaming === 'instant') + Number(body.rerank === true || body.rerank === 'order' || body.rerank === 'aggregate') + Number(body.rewriteQuery === true) + Number(body.aggregate === true);
        const micros = tokens * 5 + Number(isMemorySearch(endpoint) || isMemoryProfile(endpoint) && !!body.q) * 5 + operations * 100 + 100;
        const s = { ...this.#state };
        s[cleanup ? 'cleanupRequests' : 'evaluationRequests']++;
        s[cleanup ? 'cleanupMicros' : 'evaluationMicros'] += micros;
        s.tokens += tokens; s.tokenEstimate += Math.ceil(tokens / 4);
        if (cleanup && s.cleanupCeilingMicros !== null && s.cleanupMicros > s.cleanupCeilingMicros) fail('estimated_cost_guard_stopped');
        this.persist(s, { cleanup, micros, tokens, tokenEstimate: Math.ceil(tokens / 4), tag, write: isDocumentWrite(endpoint) });
    }
    close() {
        if (this.#closed) return;
        this.#closed = true;
        try { this.ledger.close(); } finally { this.lock.close(); }
    }
}
