import { safeDocumentId } from './processing';
import type { RunAuthority } from './run-authority';
import type { Manifest } from './manifest';
import type { CostLedger } from './cost-guard';
import { isCanonicalSupermemoryProjectScope } from '../../packages/core/src/memory/canonical-supermemory-project';
import { sha256, validRun, FAKE_SECRETS, CANARIES, scrub, fail, foreignCanary } from './security';
import { validateFilters, nativeOrRuntimeId, rejectAccountEndpoint, namespaceConfiguration, isDocumentWrite, isMemorySearch, isMemoryProfile } from './request-policy';
export type TransportTiming = { now(): number; schedule(ms: number, callback: () => void): () => void };
const realTransportTiming: TransportTiming = {
    now: () => performance.now(),
    schedule: (ms, callback) => { const timer = setTimeout(callback, ms); return () => clearTimeout(timer); },
};
export type Wire = (url: URL, init: RequestInit) => Promise<Response>;
/** Closed, content-free classification; never retain a native exception or body. */
export class TransportFailure extends Error {
    constructor(readonly kind: 'timeout' | 'abort' | 'network') { super('egress_failed'); }
}
export class BudgetExceeded extends Error {
    constructor() { super('request_budget_exhausted'); }
}
export type Event = {
    endpoint: string;
    method: string;
    phase: string;
    tag: string;
    preHash: string;
    postHash: string;
    requestHash: string;
    responseHash?: string;
    processingResponse?: { eventIndex: number; artifact: string; artifactSha256: string };
    documentId?: string;
    contentHash?: string;
    customIdHash?: string;
    writeStartedAtMs?: number;
    acceptedAtMs?: number;
    status?: number;
    durationMs: number;
    inputTokenEstimate: number;
    contentUtf8Bytes?: number;
    serializedBodyUtf8Bytes?: number;
    conservativeTokenUpperProxy?: number;
    superRagTokenEstimate?: number;
    operationEstimate?: number;
    profileWithQuery?: boolean;
    error?: string;
    transportFailure?: 'timeout' | 'abort' | 'network';
    completed?: boolean;
    blocked?: boolean;
    category?: string;
};
const canonicalFields: Record<string, Set<string>> = {
    document: new Set(['content', 'id', 'metadata', 'dreaming']),
    search: new Set(['query', 'searchMode', 'rerank', 'rewriteQuery', 'limit', 'threshold', 'include']),
    profile: new Set(),
};
const fields: Record<string, Set<string>> = {
    '/v3/documents': new Set(['content', 'containerTag', 'containerTags', 'customId', 'metadata', 'dreaming', 'entityContext', 'supportingContext']),
    '/v4/search': new Set(['q', 'containerTag', 'containerTags', 'searchMode', 'rerank', 'rewriteQuery', 'limit', 'threshold', 'filters']),
    '/v4/profile': new Set(['containerTag', 'containerTags', 'q', 'filters']),
};
export const RESPONSE_HEADERS = ['content-type', 'retry-after', 'retry-after-ms', 'x-should-retry', 'x-request-id', 'request-id', 'x-api-version', 'x-supermemory-version'];
export class NamespaceTransport {
    readonly events: Event[] = [];
    readonly blocked: Event[] = [];
    readonly owned: Record<string, string[]> = {};
    readonly writeIntents = new Set<string>();
    readonly violations: {
        kind: string;
        hash: string;
    }[] = [];
    readonly observations: {
        eventIndex?: number;
        bodyJsonParsed?: boolean;
        endpoint: string;
        phase: string;
        tag: string;
        body: any;
    }[] = [];
    aborted = false;
    phase = 'setup';
    frozen = false;
    #key: () => string;
    #wire: Wire;
    #bindings: Map<string, string>;
    #tags: Set<string>;
    #active: Set<string>;
    #budget: number;
    #used = 0;
    #costLedger?: CostLedger;
    #authority?: RunAuthority;
    #pending = new Set<Promise<void>>();
    #cleanup: boolean;
    #deleteNamespaces: boolean;
    #preflight = false;
    #inspection = false;
    #legacyProbe = false;
    #requireWriteVisibility: boolean;
    #visibilityWait: (ms: number) => Promise<void>;
    #customIds = new Map<string, Set<string>>();
    readonly namespaceVisibility: {
        tag: string;
        status: string;
        v5Status?: number;
        attempts: {
            v5Status?: number;
            error?: string;
        }[];
    }[] = [];
    visibilityUnknown = false;
    #changed?: () => void;
    #run: string;
    #now: () => number;
    #deadlineAtMs: number;
    #elapsedDeadlineAtMs: number;
    #remainingRunMs?: () => number;
    #deadlineExpired = false;
    #requestTimeoutMs: number;
    #timing: TransportTiming;
    constructor(input: {
        run: string;
        bindings: Record<string, string>;
        budget: number;
        wire: Wire;
        key?: () => string;
        cleanup?: boolean;
        verifyWriteVisibility?: boolean;
        visibilityWait?: (ms: number) => Promise<void>;
        authorizeNamespaceDelete?: boolean;
        owned?: Record<string, string[]>;
        changed?: () => void;
        costLedger?: CostLedger;
        authority?: RunAuthority;
        now?: () => number;
        deadlineAtMs?: number;
        remainingRunMs?: () => number;
        requestTimeoutMs?: number;
        timing?: TransportTiming;
    }) {
        if (!validRun(input.run) || !Number.isSafeInteger(input.budget) || input.budget < 1)
            fail('invalid_transport_manifest');
        const entries = Object.entries(input.bindings);
        if (!entries.length || new Set(entries.map(e => e[1])).size !== entries.length)
            fail('non_bijective_mapping');
        for (const [scope, tag] of entries)
            if (scope !== scope.trim() || !isCanonicalSupermemoryProjectScope(scope) || !/^sm_project_v1_eval_/.test(scope) || !tag.startsWith(`deck_eval_${input.run}_`) || !/^deck_eval_[a-z0-9_]{1,89}$/.test(tag) || /(?:^|_)(?:default|legacy|production)(?:_|$)/.test(tag))
                fail('invalid_namespace_binding');
        this.#run = input.run;
        this.#now = input.now ?? Date.now;
        this.#timing = input.timing ?? realTransportTiming;
        this.#deadlineAtMs = input.deadlineAtMs ?? Infinity;
        this.#elapsedDeadlineAtMs = this.#timing.now() + Math.max(0, this.#deadlineAtMs - this.#now());
        this.#remainingRunMs = input.remainingRunMs;
        this.#requestTimeoutMs = input.requestTimeoutMs ?? 15000;
        this.#costLedger = input.costLedger;
        this.#authority = input.authority;
        this.#bindings = new Map(entries);
        this.#tags = new Set(entries.map(e => e[1]));
        this.#active = new Set(this.#tags);
        this.#key = input.key ?? (() => 'NONFUNCTIONAL_OFFLINE_EGRESS');
        this.#wire = input.wire;
        this.#budget = input.budget;
        this.#cleanup = input.cleanup ?? false;
        this.#requireWriteVisibility = input.verifyWriteVisibility === true;
        this.#visibilityWait = input.visibilityWait ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
        this.#deleteNamespaces = input.authorizeNamespaceDelete === true;
        this.#changed = input.changed;
        for (const [tag, ids] of Object.entries(input.owned ?? {})) {
            if (!this.#tags.has(tag) || !Array.isArray(ids) || !ids.every(x => typeof x === 'string' && x.length < 256))
                fail('invalid_ownership');
            this.owned[tag] = [...ids];
        }
    }
    assertRunAuthority(m: Manifest) { if (!this.#authority) fail('run_authority_required'); this.#authority.assertCleanup(m); }
    get durableReservations() { return this.#authority?.receipt() ?? null; }
    async drain() { while (this.#pending.size) await Promise.all([...this.#pending]); }
    get used() { return this.#used; }
    get costProgress() { return this.#costLedger?.snapshot() ?? null; }
    /** UTC remains receipt data. Elapsed time can only shorten its allowance;
     * once either limit expires it stays closed, even after a civil clock jump. */
    private remainingMs() {
        const remaining = Math.min(this.#deadlineAtMs - this.#now(), this.#elapsedDeadlineAtMs - this.#timing.now(), this.#remainingRunMs?.() ?? Infinity);
        if (!(remaining > 0)) this.#deadlineExpired = true;
        return this.#deadlineExpired ? 0 : remaining;
    }
    assertDeadline() { if (this.remainingMs() <= 0) fail('evaluation_deadline'); }
    /** Preserve the only egress/key closures while giving cleanup its own bounded counter. */
    createCleanupTransport(budget: number) { return new NamespaceTransport({ run: this.#run, bindings: Object.fromEntries(this.#bindings), budget, wire: this.#wire, key: this.#key, cleanup: true, authorizeNamespaceDelete: true, owned: this.owned, costLedger: this.#costLedger, authority: this.#authority }); }
    recordNativeFenceBlock(kind: string, durationMs = 0) {
        if (!['socket', 'http2', 'dns', 'child_process', 'origin'].includes(kind))
            fail('invalid_fence_receipt');
        this.blocked.push({ endpoint: '/native-fence/' + kind, method: 'BLOCKED', phase: this.phase, tag: '', preHash: sha256(''), postHash: '', requestHash: sha256(kind), durationMs: Number.isFinite(durationMs) && durationMs >= 0 && durationMs < 60000 ? durationMs : 0, inputTokenEstimate: 0, blocked: true, error: 'native_' + kind + '_blocked', category: 'native_fence' });
    }
    sanitize(value: string) { return scrub(value, this.#key()); }
    activateRepeat(repeat: number) {
        if (!Number.isInteger(repeat) || repeat < 1)
            fail('invalid_repeat');
        this.activateTags([...this.#tags].filter(tag => new RegExp(`^deck_eval_${this.#run}_(?:r_runtime|n_claude|n_codex|n_opencode)_${repeat}_(?:a|b|b_private|control)$`).test(tag)));
    }
    activateTags(tags: string[]) {
        if (!tags.length || tags.some(t => !this.#tags.has(t)))
            fail('invalid_active_namespace_set');
        this.#active = new Set(tags);
    }
    map(scope: unknown): string {
        if (typeof scope !== 'string')
            fail('missing_or_plural_scope');
        const tag = this.#bindings.get(scope) ?? (this.#tags.has(scope) ? scope : undefined);
        if (!tag || !this.#active.has(tag))
            fail('namespace_not_in_run_allowlist');
        return tag;
    }
    /** Register only evaluator-generated identities, never IDs supplied by a plugin request. */
    registerCustomIds(scope: string, ids: string[]) {
        const tag = this.map(scope);
        if (ids.some(id => !nativeOrRuntimeId(id)))
            fail('invalid_registered_custom_id');
        const allowed = this.#customIds.get(tag) ?? new Set<string>();
        ids.forEach(id => allowed.add(id));
        this.#customIds.set(tag, allowed);
    }
    runtimeSession(scope: string, logical: string) {
        const tag = this.map(scope);
        const session = `deck_eval_${this.#run}_${sha256(tag + ':' + logical).slice(0, 32)}`;
        this.registerCustomIds(scope, ['deck_conversation_' + sha256(scope + ':' + session).slice(0, 16)]);
        return session;
    }
    async inspectNamespace(tag: string) {
        this.map(tag);
        this.#inspection = true;
        try {
            return (await this.fetch(`https://api.supermemory.ai/ns/${tag}`, { method: 'GET' })).status;
        }
        finally {
            this.#inspection = false;
        }
    }
    /** Both legacy endpoints must acknowledge an empty, recognizable response. 404 is unknown. */
    async legacyEmpty(tag: string) {
        this.map(tag);
        this.#legacyProbe = true;
        try {
            const profile = await this.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', body: JSON.stringify({ containerTag: tag }) });
            const p = await profile.json().catch(() => null) as any;
            const search = await this.fetch('https://api.supermemory.ai/v4/search', { method: 'POST', body: JSON.stringify({ containerTag: tag, q: 'synthetic evaluation namespace visibility check', searchMode: 'hybrid', threshold: 0, limit: 1, rerank: false }) });
            const q = await search.json().catch(() => null) as any;
            const profileEmpty = profile.status === 200 && Array.isArray(p?.profile?.static) && Array.isArray(p?.profile?.dynamic) && !p.profile.static.length && !p.profile.dynamic.length && (!p.profile.buckets || typeof p.profile.buckets === 'object' && !Object.keys(p.profile.buckets).length) && (!p.searchResults || Array.isArray(p.searchResults.results) && !p.searchResults.results.length && p.searchResults.total === 0);
            const searchEmpty = search.status === 200 && Array.isArray(q?.results) && !q.results.length && q.total === 0;
            return { empty: Boolean(profileEmpty && searchEmpty), profileStatus: profile.status, searchStatus: search.status, profileEmpty: Boolean(profileEmpty), searchEmpty: Boolean(searchEmpty) };
        }
        finally {
            this.#legacyProbe = false;
        }
    }
    async preflightNamespace(tag: string) {
        this.map(tag);
        this.#preflight = true;
        try {
            const status = await this.inspectNamespace(tag);
            if (status !== 200 && status !== 404)
                fail('namespace_preflight_unknown');
            if (status === 200)
                for (const type of ['documents', 'chunks', 'memories']) {
                    const r = await this.fetch(`https://api.supermemory.ai/ns/${tag}/list/${type}?page=1&limit=1`, { method: 'POST', body: JSON.stringify(type === 'memories' ? { include: { forgotten: true } } : {}) });
                    const b = await r.json().catch(() => null) as any;
                    if (r.status !== 200 || !Array.isArray(b?.[type]) || b.pagination?.totalItems !== 0 || b[type].length)
                        fail('namespace_preflight_not_empty_or_unknown');
                }
            const legacy = await this.legacyEmpty(tag);
            if (!legacy.empty)
                fail('namespace_preflight_legacy_not_empty_or_unknown');
            return { tag, status: status === 404 ? 'v5_absent_legacy_empty' : 'empty_on_both_read_paths', empty: true, v5Status: status, legacy };
        }
        finally {
            this.#preflight = false;
        }
    }
    private async verifyFirstWrite(tag: string) {
        if (!this.#requireWriteVisibility || this.namespaceVisibility.some(v => v.tag === tag))
            return;
        const receipt: (typeof this.namespaceVisibility)[number] = { tag, status: 'pending', attempts: [] };
        this.namespaceVisibility.push(receipt);
        this.#changed?.();
        for (const delay of [2000, 4000, 8000]) {
            if (this.aborted || this.#used >= this.#budget) {
                this.aborted = true;
                break;
            }
            if (this.remainingMs() <= 0) break;
            await this.#visibilityWait(Math.min(delay, this.remainingMs()));
            try {
                receipt.v5Status = await this.inspectNamespace(tag);
                receipt.attempts.push({ v5Status: receipt.v5Status });
            }
            catch {
                receipt.attempts.push({ error: this.aborted ? 'request_budget_exhausted' : 'visibility_request_failed' });
            }
            this.#changed?.();
            if (receipt.v5Status === 200 || this.aborted)
                break;
        }
        receipt.status = receipt.v5Status === 200 ? 'visible_v5_200' : 'retained_visibility_unknown';
        this.visibilityUnknown = receipt.status !== 'visible_v5_200';
        this.#changed?.();
        this.assertDeadline();
        if (this.visibilityUnknown)
            fail('namespace_visibility_unknown');
    }
    fetch = async (input: URL | string, init: RequestInit = {}) => {
        const start = this.#timing.now(), before = this.events.length;
        let body: any = {};
        let endpoint = 'invalid-url';
        try {
            endpoint = new URL(String(input)).pathname;
        }
        catch { }
        ;
        const method = (init.method ?? 'GET').toUpperCase();
        try {
            // Inspect raw and decoded body before *any* endpoint/scope rejection. Never persist values.
            const raw = String(init.body ?? '');
            let malformed = false;
            try {
                body = raw ? JSON.parse(raw) : {};
            }
            catch {
                malformed = true;
            }
            const callerHeaders = [...new Headers(init.headers)].flat().join('\n');
            const contains = (v: any, secret: string): boolean => typeof v === 'string' ? v.includes(secret) : !!v && typeof v === 'object' && Object.entries(v).some(([k, x]) => k.includes(secret) || contains(x, secret));
            const key = this.#key();
            if (key && (raw.includes(key) || contains(body, key) || callerHeaders.includes(key) || contains(init.headers, key) || String(input).includes(key))) {
                this.violations.push({ kind: 'credential_attempt', hash: sha256('credential_attempt') });
                fail('eval_credential_egress_blocked');
            }
            const found = FAKE_SECRETS.filter(s => raw.includes(s) || contains(body, s) || callerHeaders.includes(s) || contains(init.headers, s));
            if (found.length) {
                for (const s of found)
                    this.violations.push({ kind: 'secret_attempt', hash: sha256(s) });
                fail('synthetic_secret_egress_blocked');
            }
            if (malformed)
                fail('invalid_json_body');
            const url = new URL(String(input));
            endpoint = url.pathname;
            return await this.perform(url, init, method, body);
        }
        catch (e) {
            if (this.events.length === before) {
                const reason = e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'request_rejected';
                const category = reason === 'eval_credential_egress_blocked' ? 'credential' : reason === 'synthetic_secret_egress_blocked' ? 'secret' : endpoint === '/v3/settings' ? 'account_settings' : ['account_endpoint_forbidden', 'account_modification_forbidden'].includes(reason) ? 'account_scope' : reason === 'namespace_not_in_run_allowlist' ? 'legacy_or_inactive_scope' : ['request_budget_exhausted', 'estimated_cost_guard_stopped'].includes(reason) ? 'budget' : 'endpoint_or_schema';
                this.blocked.push({ endpoint: this.sanitize(endpoint), method, phase: this.phase, tag: '', preHash: sha256(this.sanitize(String(body?.containerTag ?? body?.containerTags ?? ''))), postHash: '', requestHash: sha256(this.sanitize(JSON.stringify(body))), durationMs: this.#timing.now() - start, inputTokenEstimate: 0, blocked: true, error: reason, category, profileWithQuery: isMemoryProfile(endpoint) && !!body?.q });
            }
            throw e;
        }
    };
    private async perform(url: URL, init: RequestInit, method: string, body: any) {
        this.assertDeadline();
        if (this.visibilityUnknown)
            fail('namespace_visibility_unknown');
        if (url.origin !== 'https://api.supermemory.ai' || url.username || url.password || url.hash)
            fail('fixed_origin_and_no_query_required');
        if (!body || Array.isArray(body) || typeof body !== 'object')
            fail('invalid_json_body');
        rejectAccountEndpoint(url.pathname, method);
        let tag: string;
        let configurationWrite = false;
        const document = url.pathname.match(/^\/ns\/(deck_eval_[a-z0-9_]+)\/document\/([^/]+)$/);
        const configurationTag = namespaceConfiguration(url.pathname, method, body);
        const canonical = url.pathname.match(/^\/ns\/([a-zA-Z0-9_:-]+)\/(document|search|profile)$/);
        const original = JSON.stringify(body), logical = canonical?.[1] ?? body.containerTag ?? body.containerTags?.[0];
        const ns = url.pathname.match(/^\/ns\/(deck_eval_[a-z0-9_]+)(?:\/list\/(documents|chunks|memories))?$/);
        if (document) {
            tag = this.map(document[1]);
            let id: string; try { id = decodeURIComponent(document[2]!); } catch { fail('invalid_document_id_encoding'); }
            if (this.#cleanup || this.#preflight || method !== 'GET' || url.search || Object.keys(body).length || !safeDocumentId(id) || encodeURIComponent(id) !== document[2] || !this.owned[tag]?.includes(id)) fail('document_status_requires_exact_owned_id');
        }
        else if (configurationTag !== undefined) {
            if (this.#cleanup || this.#preflight || this.#inspection || url.search)
                fail('namespace_configuration_phase_forbidden');
            tag = this.map(configurationTag);
            configurationWrite = true;
            if (this.frozen) {
                this.violations.push({ kind: 'read_only_fence_write', hash: sha256(scrub(original)) });
                fail('corpus_frozen');
            }
        }
        else if (ns && (this.#cleanup || this.#preflight || this.#inspection)) {
            tag = this.map(ns[1]);
            if (this.#inspection) {
                if (ns[2] || method !== 'GET' || url.search || Object.keys(body).length)
                    fail('inspection_endpoint_only');
            }
            else if (this.#cleanup) {
                if (ns[2] || !['DELETE', 'GET'].includes(method) || url.search || Object.keys(body).length)
                    fail('cleanup_endpoint_only');
                if (method === 'DELETE') { if (!this.#authority) fail('cleanup_requires_reconciliation_authorization'); this.#authority.assertCleanupAuthorization(); }
                if (!this.#deleteNamespaces && !this.owned[tag]?.length)
                    fail('cleanup_requires_owned_predecessor');
            }
            else if (ns[2]) {
                if (method !== 'POST' || url.search !== '?page=1&limit=1' || JSON.stringify(body) !== JSON.stringify(ns[2] === 'memories' ? { include: { forgotten: true } } : {}))
                    fail('preflight_endpoint_only');
            }
            else if (method !== 'GET' || url.search || Object.keys(body).length)
                fail('preflight_endpoint_only');
        }
        else {
            if (canonical && (this.#cleanup || this.#preflight || this.#inspection || this.#legacyProbe)) fail('canonical_operation_phase_forbidden');
            if (this.#cleanup && (!this.#legacyProbe || !['/v4/profile', '/v4/search'].includes(url.pathname)) || url.search || method !== 'POST' || !(canonical ? canonicalFields[canonical[2]!] : fields[url.pathname]))
                fail('endpoint_not_allowlisted');
            if (Object.keys(body).some(k => !(canonical ? canonicalFields[canonical[2]!]! : fields[url.pathname]!).has(k)))
                fail('unknown_endpoint_body_field');
            const selectors = ['containerTag', 'containerTags'].filter(k => k in body);
            if (selectors.length !== (canonical ? 0 : 1))
                fail('one_scope_required');
            const field = selectors[0];
            const value = field ? body[field] : canonical![1];
            if (field === 'containerTags' && (!Array.isArray(value) || value.length !== 1))
                fail('multi_container_forbidden');
            tag = this.map(field === 'containerTags' ? value[0] : value);
            for (const name of ['q', 'query', 'content', 'customId', 'id', 'entityContext', 'supportingContext'])
                if (name in body && typeof body[name] !== 'string')
                    fail('invalid_endpoint_body_type');
            if (isDocumentWrite(url.pathname)) {
                const id = canonical ? body.id : body.customId;
                if (typeof id !== 'string' || !(new RegExp(`^deck_eval_${this.#run}_[a-f0-9]{32,64}$`).test(id) || this.#customIds.get(tag)?.has(id)))
                    fail('custom_id_not_run_owned');
            }
            if ('filters' in body)
                validateFilters(body.filters);
            const check = (v: any): void => {
                if (!v || typeof v !== 'object')
                    return;
                for (const [k, x] of Object.entries(v)) {
                    if (k === 'originalContainerTags') {
                        if (!Array.isArray(x) || x.length !== 1 || this.map(x[0]) !== tag)
                            fail('nested_selector_forbidden');
                        v[k] = [tag];
                        continue;
                    }
                    if (/container.?tags?|namespaces?|^(?:tags|scopes?|spaces|projectIds?)$/i.test(k))
                        fail('nested_selector_forbidden');
                    check(x);
                }
            };
            for (const [k, v] of Object.entries(body))
                if (k !== field)
                    check({ [k]: v });
            if (field) body[field] = field === 'containerTags' ? [tag] : tag;
            if (canonical) {
                // Preserve v5's wire contract; map only the exact admitted namespace.
                url.pathname = `/ns/${tag}/${canonical[2]}`;
                if (canonical[2] === 'document' && typeof body.content !== 'string') fail('invalid_endpoint_body_type');
                if (canonical[2] === 'search' && typeof body.query !== 'string') fail('invalid_endpoint_body_type');
                if ('rerank' in body && !['none', 'order', 'aggregate'].includes(body.rerank)) fail('invalid_endpoint_body_type');
                if ('dreaming' in body && !['dynamic', 'instant'].includes(body.dreaming)) fail('invalid_endpoint_body_type');
                if ('searchMode' in body && !['hybrid', 'memories', 'chunks'].includes(body.searchMode)) fail('invalid_endpoint_body_type');
                if ('limit' in body && (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 100)) fail('invalid_endpoint_body_type');
                if ('threshold' in body && (typeof body.threshold !== 'number' || body.threshold < 0 || body.threshold > 1)) fail('invalid_endpoint_body_type');
                if ('rewriteQuery' in body && typeof body.rewriteQuery !== 'boolean') fail('invalid_endpoint_body_type');
                if ('include' in body && (!body.include || typeof body.include !== 'object' || Array.isArray(body.include) || Object.entries(body.include).some(([k, v]) => !['documents', 'related', 'forgotten'].includes(k) || typeof v !== 'boolean'))) fail('invalid_endpoint_body_type');
                if ('metadata' in body && (!body.metadata || typeof body.metadata !== 'object' || Array.isArray(body.metadata) || Object.values(body.metadata).some(v => !['string', 'number', 'boolean'].includes(typeof v) && !(Array.isArray(v) && v.every(x => typeof x === 'string'))))) fail('invalid_endpoint_body_type');
            }
            if (this.frozen && isDocumentWrite(url.pathname)) {
                this.violations.push({ kind: 'read_only_fence_write', hash: sha256(scrub(original)) });
                fail('corpus_frozen');
            }
        }
        if (!this.#cleanup && this.#costLedger?.snapshot().stopped) fail('estimated_cost_guard_stopped');
        if (this.aborted || this.#used >= this.#budget) {
            this.aborted = true;
            throw new BudgetExceeded();
        }
        try {
            this.#authority?.beforeReservation(this.#cleanup);
            const commit = () => this.#authority?.reserve(url.pathname, body, this.#cleanup, tag);
            if (this.#costLedger) this.#costLedger.reserve(url.pathname, body, this.#cleanup, commit);
            else commit();
        }
        catch (e) { this.aborted = true; throw e; }
        this.#used++;
        const key = this.#key();
        const mapped = JSON.stringify(body);
        const event: Event = { endpoint: url.pathname, method, phase: this.phase, tag, preHash: sha256(String(logical ?? tag)), postHash: sha256(tag), requestHash: sha256(scrub(mapped, key)), durationMs: 0, contentUtf8Bytes: isDocumentWrite(url.pathname) ? Buffer.byteLength(String(body.content ?? ''), 'utf8') : 0, serializedBodyUtf8Bytes: method === 'GET' || method === 'DELETE' && !configurationWrite ? 0 : Buffer.byteLength(mapped, 'utf8'), conservativeTokenUpperProxy: isDocumentWrite(url.pathname) ? Buffer.byteLength(String(body.content ?? ''), 'utf8') : 0, inputTokenEstimate: isDocumentWrite(url.pathname) && body.taskType !== 'superrag' ? Math.ceil(Buffer.byteLength(String(body.content ?? '')) / 4) : 0, superRagTokenEstimate: body.taskType === 'superrag' ? Math.ceil(Buffer.byteLength(String(body.content ?? '')) / 4) : 0, operationEstimate: Number(body.dreaming === 'instant') + Number(body.rerank === true || body.rerank === 'order' || body.rerank === 'aggregate') + Number(body.rewriteQuery === true) + Number(body.aggregate === true), profileWithQuery: isMemoryProfile(url.pathname) && !!body.q };
        if (isDocumentWrite(url.pathname)) Object.assign(event, { writeStartedAtMs: this.#now(), contentHash: sha256(body.content), customIdHash: sha256(body.id ?? body.customId ?? '') });
        if (document) event.phase = 'processing_monitor';
        event.completed = false;
        const eventIndex = this.events.length;
        this.events.push(event);
        if (isDocumentWrite(url.pathname) || configurationWrite)
            this.writeIntents.add(tag);
        this.#changed?.();
        const start = this.#timing.now();
        let egressEnded: number | undefined;
        let done!: () => void;
        const pending = new Promise<void>(resolve => { done = resolve; });
        this.#pending.add(pending);
        try {
            // Identity/account override headers are never forwarded, including all x-sm-* headers.
            const headers = new Headers({ accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${key}` });
            this.assertDeadline();
            const { response, text } = await boundedWire(this.#wire, url, { ...init, method, body: method === 'GET' || method === 'DELETE' && !configurationWrite ? undefined : mapped, redirect: 'error', headers }, Math.min(this.#requestTimeoutMs, this.remainingMs()), this.#timing, () => this.assertDeadline());
            event.status = response.status;
            if (response.status >= 300 && response.status < 400)
                fail('redirect_rejected');
            let raw = text;
            for (const s of FAKE_SECRETS)
                if (raw.includes(s))
                    this.violations.push({ kind: 'secret_return', hash: sha256(s) });
            for (const c of CANARIES)
                if (raw.includes(c) && foreignCanary(c, tag))
                    this.violations.push({ kind: 'cross_project_canary_return', hash: sha256(c) });
            if (key && raw.includes(key))
                this.violations.push({ kind: 'credential_echo_redacted', hash: sha256('credential_echo_redacted') });
            raw = scrub(raw, key);
            event.responseHash = sha256(raw);
            let data: any, bodyJsonParsed = true;
            try {
                data = JSON.parse(raw);
            }
            catch {
                data = {}; bodyJsonParsed = false;
            }
            this.observations.push({ eventIndex, bodyJsonParsed, endpoint: url.pathname, phase: event.phase, tag, body: data });
            if (isDocumentWrite(url.pathname) && response.ok) {
                event.acceptedAtMs = this.#now();
                const id = data?.id ?? data?.documentId ?? data?.data?.id;
                if (safeDocumentId(id)) {
                    event.documentId = id;
                    const ids = this.owned[tag] ??= [];
                    if (!ids.includes(id))
                        ids.push(id);
                    this.#changed?.(); // Observe acceptance even during first-write visibility waiting.
                }
                else
                    this.violations.push({ kind: 'write_ack_without_owned_id', hash: sha256(tag) });
            }
            egressEnded = this.#timing.now();
            if (isDocumentWrite(url.pathname) && response.ok)
                await this.verifyFirstWrite(tag);
            const responseHeaders = new Headers();
            for (const name of RESPONSE_HEADERS) {
                const value = response.headers.get(name);
                if (value !== null)
                    responseHeaders.set(name, scrub(value, key));
            }
            return new Response([204, 205].includes(response.status) ? null : raw, { status: response.status, headers: responseHeaders });
        }
        catch (e) {
            egressEnded ??= this.#timing.now();
            event.error = e instanceof Error && ['redirect_rejected', 'namespace_visibility_unknown'].includes(e.message) ? e.message : 'egress_failed';
            if (e instanceof TransportFailure) { event.transportFailure = e.kind; throw e; }
            throw new Error(event.error);
        }
        finally {
            // A timeout/failed acknowledgement can still have written data. Check its first
            // namespace visibility too, retaining the write intent regardless of outcome.
            if (isDocumentWrite(url.pathname) && this.#requireWriteVisibility && !this.namespaceVisibility.some(v => v.tag === tag)) {
                try {
                    await this.verifyFirstWrite(tag);
                }
                catch {
                    event.error = 'namespace_visibility_unknown';
                }
            }
            event.durationMs = (egressEnded ?? this.#timing.now()) - start;
            event.completed = true;
            try { this.#changed?.(); } finally { this.#pending.delete(pending); done(); }
        }
    }
}
/** FIFO fake: real wire shapes, no ranking, semantic matching, extraction or gold lookup. */
export function simulatedWire(): Wire {
    const docs = new Map<string, Map<string, string>>();
    return async (url, init) => {
        const b = init.body ? JSON.parse(String(init.body)) : {};
        const tag = b.containerTag ?? b.containerTags?.[0] ?? url.pathname.split('/')[2];
        const pool = docs.get(tag);
        if (init.method === 'DELETE') {
            docs.delete(tag);
            return Response.json({ deleted: true });
        }
        if (isDocumentWrite(url.pathname)) {
            const p = pool ?? new Map<string, string>();
            docs.set(tag, p);
            const id = b.id ?? b.customId;
            // v5 conversation IDs append public deltas; legacy fixtures use their own snapshots.
            p.set(id, b.id && p.has(id) ? p.get(id) + '\n' + b.content : b.content);
            return Response.json({ id, status: 'acknowledged' });
        }
        if (url.pathname.startsWith('/ns/') && !isMemoryProfile(url.pathname) && !isMemorySearch(url.pathname)) {
            if (!pool) return Response.json({ error: 'not_found' }, { status: 404 });
            if (url.pathname.split('/')[3] === 'document') {
                const id = decodeURIComponent(url.pathname.split('/')[4]!);
                if (!pool.has(id)) return Response.json({ error: 'not_found' }, { status: 404 });
                return Response.json({ id, content: pool.get(id), system: { status: 'done', dreamingStatus: 'done', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } });
            }
            const type = url.pathname.split('/')[4];
            return type ? Response.json({ [type]: [...pool].slice(0, 1).map(([id]) => ({ id })), pagination: { currentPage: 1, totalItems: pool.size, totalPages: 1 } }) : Response.json({ namespace: tag });
        }
        const hits = [...(pool ?? [])].slice(0, b.limit ?? 5).map(([id, memory]) => ({ id, memory, similarity: 0.9, updatedAt: '2026-10-21T00:00:00Z' }));
        if (isMemorySearch(url.pathname))
            return Response.json({ results: hits, total: hits.length, timing: 1 });
        if (url.pathname.startsWith('/ns/')) return Response.json({ profile: { static: [], dynamic: [] } });
        return Response.json({ profile: { static: [], dynamic: [] }, searchResults: { results: hits, total: hits.length, timing: 1 } });
    };
}

/** Bound both headers and body consumption, even for a test wire that ignores abort.
 * A timed-out attempt remains charged. Late resolution cannot mutate event/ownership state. */
async function boundedWire(wire: Wire, url: URL, init: RequestInit, timeoutMs: number, timing: TransportTiming, assertDeadline: () => void) {
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) fail('evaluation_deadline');
    const timeout = new AbortController(), cancelTimeout = timing.schedule(Math.max(1, timeoutMs), () => timeout.abort());
    const signal = AbortSignal.any([timeout.signal, ...(init.signal ? [init.signal] : [])]);
    let abort!: () => void;
    try {
        const abortKind = () => timeout.signal.aborted || init.signal?.reason?.name === 'TimeoutError' ? 'timeout' as const : 'abort' as const;
        if (signal.aborted) throw new TransportFailure(abortKind());
        const aborted = new Promise<never>((_, reject) => { abort = () => reject(new TransportFailure(abortKind())); signal.addEventListener('abort', abort, { once: true }); });
        return await Promise.race([
            aborted,
            (async () => { try { assertDeadline(); const response = await wire(url, { ...init, signal }); return { response, text: await response.text() }; } catch { throw new TransportFailure(signal.aborted ? abortKind() : 'network'); } })(),
        ]);
    } finally { cancelTimeout(); if (abort) signal.removeEventListener('abort', abort); }
}
