import { NamespaceTransport } from './namespace-transport';
// A non-cloud test token on an IPC-only interface. No server is bound in any mode.
export const LOCAL_BEARER = 'NONFUNCTIONAL_EVAL_LOCAL_BEARER';
export const IPC_ORIGIN = 'http://127.0.0.1:1';
export function gateway(t: NamespaceTransport) {
    return async (request: Request): Promise<Response> => {
        const url = new URL(request.url);
        if (url.origin !== IPC_ORIGIN || url.username || url.password || request.headers.has('origin'))
            return Response.json({ error: 'gateway_origin_rejected' }, { status: 403 });
        if (request.headers.get('authorization') !== `Bearer ${LOCAL_BEARER}`)
            return Response.json({ error: 'gateway_auth_rejected' }, { status: 401 });
        const body = await request.text();
        if (Buffer.byteLength(body) > 512 * 1024)
            return Response.json({ error: 'gateway_payload_limit' }, { status: 413 });
        // Endpoint/schema/scope checks live in the single transport so *blocked* calls
        // (including account settings PATCH and legacy fan-out) are measurable too.
        try {
            return await t.fetch(new URL(url.pathname + url.search, 'https://api.supermemory.ai'), { method: request.method, body: body || undefined, signal: request.signal, headers: request.headers });
        }
        catch (e) {
            const reason = e instanceof Error && /^[a-z_]+$/.test(e.message) ? e.message : 'gateway_request_rejected';
            return Response.json({ error: reason }, { status: t.aborted ? 429 : 403 });
        }
    };
}
