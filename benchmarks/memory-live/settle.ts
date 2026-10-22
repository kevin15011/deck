import { NamespaceTransport } from './namespace-transport';
import { sha256 } from './security';
/** Hash only returned identity+text; clocks, usage, scores and response order cannot prevent a plateau. */
export function settleProjection(body: any) {
    const text = (x: any) => typeof x === 'string' ? x : x?.memory ?? x?.content ?? x?.chunk ?? x?.text ?? '';
    const rows = [...(body?.results ?? []), ...(body?.searchResults?.results ?? []), ...(body?.profile?.static ?? []), ...(body?.profile?.dynamic ?? [])].map(x => ({ id: typeof x === 'object' ? String(x?.id ?? '') : '', text: text(x).normalize('NFKC').replace(/\s+/g, ' ').trim() })).filter(x => x.text);
    return [...new Map(rows.map(x => [JSON.stringify(x), x])).values()].sort((a, b) => a.id.localeCompare(b.id) || a.text.localeCompare(b.text));
}
export async function settle(t: NamespaceTransport, scope: string, content: string, offline: boolean) {
    const start = performance.now();
    let previous = '', stable = false, polls = 0, nonempty = false;
    for (const seconds of [2, 4, 8, 16, 30, 30]) {
        if (!offline)
            await new Promise(r => setTimeout(r, seconds * 1000));
        const response = await t.fetch('https://api.supermemory.ai/v4/profile', { method: 'POST', body: JSON.stringify({ containerTag: scope, q: content.slice(0, 80) }) });
        polls++;
        if (!response.ok)
            continue;
        const body = await response.json().catch(() => null);
        if (body === null)
            continue;
        const projection = settleProjection(body);
        nonempty = projection.length > 0;
        const hash = sha256(JSON.stringify(projection));
        if (hash === previous) {
            stable = true;
            break;
        }
        previous = hash;
    }
    return { polls, durationMs: performance.now() - start, status: stable && nonempty ? 'stable_retrieval_heuristic' : stable ? 'no_hit_plateau' : 'settling_uncertain', projectionHash: previous, proofOfIndexing: false };
}
