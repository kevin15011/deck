import { join } from "node:path";

/** Claude uses this identity for the MCP declared by the official plugin. */
export const CLAUDE_SUPERMEMORY_MCP_ID = "plugin:supermemory:supermemory";

// Runs only in the dedicated proxy process. Keep the pinned vendor bytes intact:
// its auth, repository scoping, JSON/SSE replies and legacy session handling stay
// authoritative. This bridges the metadata lost when stdio is converted to HTTP.
const transport = String.raw`
const originalFetch = globalThis.fetch;
let legacyVersion;
const subscriptions = new Map();
const send = message => process.stdout.write(JSON.stringify(message) + '\n');
async function listen(url, options, message, controller) {
  try {
    const response = await originalFetch(url, { ...options, signal: controller.signal });
    if (!response.ok) throw new Error('Subscription HTTP ' + response.status);
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      if (response.status !== 202) send(await response.json());
      return;
    }
    const reader = response.body.getReader(), decoder = new TextDecoder();
    let buffer = '', data = [];
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length + data.join('\n').length > 1024 * 1024) throw new Error('Subscription frame exceeds bound');
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end).replace(/\r$/, ''); buffer = buffer.slice(end + 1);
          if (line === '') { if (data.length) send(JSON.parse(data.join('\n'))); data = []; }
          else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
        }
      }
    } finally { await reader.cancel().catch(() => {}); }
  } catch {
    if (!controller.signal.aborted) send({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'Supermemory subscription transport failed' } });
  } finally { subscriptions.delete(message.id); }
}
const encode = value => /^[\x20-\x7e\t]*$/.test(value) && value.trim() === value && !/^=\?base64\?.*\?=$/.test(value)
  ? value : '=?base64?' + Buffer.from(value, 'utf8').toString('base64') + '?=';
globalThis.fetch = async (url, options) => {
  if (options?.method !== 'POST' || typeof options.body !== 'string') return originalFetch(url, options);
  let message;
  try { message = JSON.parse(options.body); } catch { return originalFetch(url, options); }
  if (message?.jsonrpc !== '2.0' || typeof message.method !== 'string') return originalFetch(url, options);
  if (message.method === 'notifications/cancelled' && subscriptions.has(message.params?.requestId)) {
    subscriptions.get(message.params.requestId).abort();
    return new Response(null, { status: 202 });
  }
  const headers = new Headers(options.headers);
  headers.set('Mcp-Method', message.method);
  const version = message.params?._meta?.['io.modelcontextprotocol/protocolVersion']
    ?? (message.method === 'initialize' ? message.params?.protocolVersion : legacyVersion);
  if (version) headers.set('MCP-Protocol-Version', version);
  const name = message.method === 'resources/read' ? message.params?.uri
    : ['tools/call', 'prompts/get'].includes(message.method) ? message.params?.name : undefined;
  if (typeof name === 'string') headers.set('Mcp-Name', encode(name));
  if (message.method === 'subscriptions/listen') {
    // The vendor serializes finite replies. A modern subscription must not hold
    // that queue or inherit its 30s finite-request timeout. Stdio cancellation or
    // proxy process exit owns this request's lifetime; no detached child exists.
    const controller = new AbortController();
    subscriptions.set(message.id, controller);
    void listen(url, { ...options, headers }, message, controller);
    return new Response(null, { status: 202 });
  }
  const response = await originalFetch(url, { ...options, headers });
  if (message.method === 'initialize' && response.ok) {
    const body = await response.clone().text();
    const candidates = [body, ...body.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5))];
    for (const candidate of candidates) {
      try { const result = JSON.parse(candidate); if (result.id === message.id && result.result?.protocolVersion) legacyVersion = result.result.protocolVersion; } catch {}
    }
  }
  return response;
};
`;

/** Explicit per-process adapter; no NODE_OPTIONS or installed plugin mutation. */
export function claudeSupermemoryProxyArgs(root: string): string[] {
  return ["-e", `${transport}\nrequire(${JSON.stringify(join(root, "hooks", "mcp-proxy.js"))});\n`];
}
