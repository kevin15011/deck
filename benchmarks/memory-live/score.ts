import { CANARIES, FAKE_SECRETS, foreignCanary } from './security';
export type Fact = {
    id: string;
    text: string;
    match: {
        all_of_regex: string[];
        flags?: string;
    };
};
export type Question = {
    id: string;
    category: string;
    role: string;
    expected_facts: Fact[];
    forbidden_facts: Fact[];
    feature_status?: string;
    [key: string]: any;
};
const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim();
export function propositions(text: string) {
    // Preserve dotted identifiers and factual contrasts such as "existed but was undefined".
    // Separate temporal contrasts only, including a trailing "now" within the same clause.
    return text.normalize('NFKC').split(/\n|;\s*|(?<=[.!?])\s+(?=[A-Z"“])|,?\s+(?=(?:now|currently|previously|historically|formerly|used to)\b)|,?\s+but\s+(?=(?:(?![.!?](?:\s|$)|[;\n]).)*\b(?:now|currently|previously|historically|formerly|used to)\b)/iu).map(norm).filter(Boolean).map(text => ({ text, ambiguous: /["“”]|```|\b(?:might|perhaps|possibly|uncertain|hypothetical|if we)\b/i.test(text), historical: /\b(?:old|past|historical)\s*:|\b(?:previously|historically|formerly|used to|obsolete|outdated|superseded|old decision|no longer)\b/i.test(text), rejected: /\breject(?:ed|s)?\b|\bruled out\b/i.test(text) }));
}
function factState(fact: Fact, unit: string, stale = false): 'match' | 'absent' | 'unresolved' {
    let unresolved = false;
    for (const p of propositions(unit)) {
        if (!fact.match.all_of_regex.every(s => new RegExp(s, (fact.match.flags ?? 'i').replace(/[gy]/g, '')).test(p.text)))
            continue;
        if (p.historical || p.rejected && (stale || !/\breject(?:ed|s)?\b|\bruled out\b/i.test(fact.text)))
            continue;
        if (p.ambiguous) {
            unresolved = true;
            continue;
        }
        if (p.historical)
            continue;
        const negative = /\b(?:not|never|no|without|cannot|can't|don't|doesn't|mustn't)\b/i;
        // Negated gold is creditable only with explicit matching negative vocabulary in the frozen atom.
        if (negative.test(p.text) !== negative.test(fact.text)) {
            if (!stale)
                unresolved = true;
            continue;
        }
        return 'match';
    }
    return unresolved ? 'unresolved' : 'absent';
}
export function scoreUnits(q: Question, units: string[], k: number) {
    const top = units.slice(0, k);
    const gold = new Set<string>();
    const forbidden = new Set<string>();
    const unresolved = new Set<string>();
    const seen = new Set<string>();
    let relevant = 0, duplicates = 0, staleHits = 0;
    for (const unit of top) {
        const n = norm(unit);
        if (seen.has(n)) {
            duplicates++;
            continue;
        }
        seen.add(n);
        const bad = q.forbidden_facts.filter(f => factState(f, unit, true) === 'match');
        bad.forEach(f => forbidden.add(f.id));
        const matched = q.expected_facts.filter(f => factState(f, unit) === 'match');
        for (const f of [...q.expected_facts, ...q.forbidden_facts])
            if (factState(f, unit, q.forbidden_facts.includes(f)) === 'unresolved')
                unresolved.add(f.id);
        if (q.forbidden_facts.some(f => f.match.all_of_regex.every(s => new RegExp(s, 'i').test(unit))))
            staleHits++;
        const newFacts = matched.filter(f => !gold.has(f.id));
        matched.forEach(f => gold.add(f.id));
        if (newFacts.length && !bad.length)
            relevant++;
    }
    const joined = top.join('\n');
    return { precisionAtK: k && q.expected_facts.length ? relevant / k : null, recallAtK: q.expected_facts.length ? gold.size / q.expected_facts.length : null, occupancy: k ? top.length / k : 0, returnedPrecision: top.length && q.expected_facts.length ? relevant / top.length : null, gold: [...gold], forbidden: [...forbidden], unresolved: [...unresolved], duplicateRate: top.length ? duplicates / top.length : 0, staleHits, staleAsCurrent: forbidden.size, supersessionCorrect: q.category === 'superseded_decisions' ? gold.size === q.expected_facts.length && !forbidden.size && !unresolved.size : null, secrets: FAKE_SECRETS.filter(s => joined.includes(s)).length, canaries: CANARIES.filter(s => joined.includes(s)), foreignCanaries: CANARIES.filter(s => joined.includes(s) && foreignCanary(s, q.project_under_query)) };
}
export function futureProbe(q: Question) { return { id: q.id, category: q.category, status: 'unsupported', coverage: 0, demonstratedSuccesses: 0, opportunities: q.category === 'transfer' ? 1 : 0, conditionalQuality: null, reason: 'Current production runtime has no operational transfer/sharing/promotion route.' }; }
export function quantiles(values: number[]) { const s = [...values].sort((a, b) => a - b); return { n: s.length, p50: s.length ? s[Math.ceil(.5 * s.length) - 1] : null, p95: s.length ? s[Math.ceil(.95 * s.length) - 1] : null }; }
export function estimateCost(events: {
    endpoint: string;
    inputTokenEstimate: number;
    superRagTokenEstimate?: number;
    operationEstimate?: number;
    status?: number;
    profileWithQuery?: boolean;
    blocked?: boolean;
}[]) {
    const profileWithQuery = events.filter(e => e.endpoint === '/v4/profile' && e.profileWithQuery).length;
    const writes = events.filter(e => e.endpoint === '/v3/documents');
    const searchQueries = events.filter(e => e.endpoint === '/v4/search').length;
    const memoryTokens = writes.reduce((n, e) => n + e.inputTokenEstimate, 0);
    const superRagTokens = events.reduce((n, e) => n + (e.superRagTokenEstimate ?? 0), 0);
    const operations = events.filter(e => e.status !== undefined && e.status < 300).reduce((n, e) => n + (e.operationEstimate ?? 0), 0);
    return { label: 'estimate', ratesSnapshot: '2026-10-21 published v5 meters; applied to current legacy endpoint baseline', searchQueries, memoryTokens, superRagTokens, operations, usd: searchQueries * 0.000005 + memoryTokens * 0.000005 + superRagTokens * 0.000001 + operations * 0.0001, profileWithQueryRequests: profileWithQuery, profileQueryMeterUsd: profileWithQuery ? 'unknown' : null, totalUsdStatus: profileWithQuery ? 'lower_bound_profile_query_meter_unknown' : 'estimate', estimatedUsdCreditDebit: searchQueries * 0.000005 + memoryTokens * 0.000005 + superRagTokens * 0.000001 + operations * 0.0001, providerCredits: 'USD-denominated balance; actual debit unknown without provider usage reconciliation', limitations: ['UTF-8/4 input token estimate, not metered changed chunks or extracted output.', 'Dynamic dreaming/add-on operation charges and legacy-to-v5 meter equivalence unverified.', 'SuperRAG $1/M tokens and operations $0.10/1K included only when observed; neither requested by R.'] };
}
