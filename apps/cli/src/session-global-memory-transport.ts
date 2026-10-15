import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { Socket } from 'node:net';

const MAX_REQUEST_BYTES = 512 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_CONCURRENT_REQUESTS = 8;
const API_ORIGIN = 'https://api.supermemory.ai';
type JsonObject = Record<string, unknown>;

export type MemoryTransportFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface GlobalMemoryTransport {
  apiUrl: string;
  mcpUrl: string;
  token: string;
  close(): Promise<void>;
}

class TransportError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
function object(value: unknown): JsonObject {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TransportError(400, 'Expected a JSON object');
  return value as JsonObject;
}
function untagged(body: JsonObject): JsonObject {
  const { containerTag: _tag, containerTags: _tags, ...result } = body;
  // The native capture plugin records its generated selector here as well.
  if (result.metadata && typeof result.metadata === 'object' && !Array.isArray(result.metadata)) {
    const { originalContainerTags: _originalTags, ...metadata } = result.metadata as JsonObject;
    result.metadata = metadata;
  }
  return result;
}
async function readRequest(request: IncomingMessage): Promise<JsonObject> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > MAX_REQUEST_BYTES) throw new TransportError(413, 'Request too large');
    chunks.push(bytes);
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
  catch (error) { if (error instanceof TransportError) throw error; throw new TransportError(400, 'Invalid JSON'); }
}
async function readResponse(response: Response): Promise<unknown> {
  if (!response.ok || response.redirected) {
    await response.body?.cancel().catch(() => {});
    throw new TransportError(502, 'Memory provider request failed');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new TransportError(502, 'Invalid memory provider response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new TransportError(502, 'Memory provider response too large');
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new TransportError(502, 'Invalid memory provider response'); }
  } finally { await reader.cancel().catch(() => {}); }
}
function send(response: ServerResponse, status: number, body?: unknown): void {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}
const mcpTools = [
  { name: 'search_memory', description: 'Search account-global memories.', inputSchema: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer', minimum: 1, maximum: 100 } }, required: ['query'], additionalProperties: false } },
  { name: 'add_memory', description: 'Add a memory to the account without a container tag.', inputSchema: { type: 'object', properties: { content: { type: 'string' } }, required: ['content'], additionalProperties: false } },
  { name: 'listDocuments', description: 'List account-global documents.', inputSchema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 100 }, page: { type: 'integer', minimum: 1 } }, additionalProperties: false } },
];
function mcpOperation(params: JsonObject): { path: string; body: JsonObject } {
  let args = params.arguments ?? {};
  if (typeof args === 'string') {
    try { args = JSON.parse(args); } catch { throw new TransportError(400, 'Invalid tool arguments'); }
  }
  const { containerTag: _tag, containerTags: _tags, spaceId: _space, ...values } = object(args);
  const allowed = params.name === 'search_memory' ? ['query', 'q', 'limit'] : params.name === 'add_memory' ? ['content'] : params.name === 'listDocuments' ? ['limit', 'page'] : null;
  if (!allowed) throw new TransportError(400, 'Unknown memory tool');
  if (Object.keys(values).some((key) => !allowed.includes(key))) throw new TransportError(400, 'Unsupported tool argument');
  for (const key of ['limit', 'page']) {
    if (values[key] !== undefined && (!Number.isSafeInteger(values[key]) || (values[key] as number) < 1 || (key === 'limit' && (values[key] as number) > 100))) throw new TransportError(400, 'Invalid pagination');
  }
  if (params.name === 'search_memory') {
    const q = values.query ?? values.q;
    if (typeof q !== 'string' || !q.trim()) throw new TransportError(400, 'A search query is required');
    return { path: '/v4/search', body: { q, ...(values.limit === undefined ? {} : { limit: values.limit }) } };
  }
  if (params.name === 'add_memory') {
    if (typeof values.content !== 'string' || !values.content.trim()) throw new TransportError(400, 'Memory content is required');
    return { path: '/v3/documents', body: { content: values.content } };
  }
  return { path: '/v3/documents/list', body: values };
}

/** Session-scoped boundary for native plugins whose omitted selector otherwise means a folder or active space. */
export async function startGlobalMemoryTransport(options: { token: string; signal?: AbortSignal; fetch?: MemoryTransportFetch }): Promise<GlobalMemoryTransport> {
  if (!options.token || /[\r\n]/.test(options.token)) throw new Error('A valid memory credential is required');
  if (options.signal?.aborted) throw new Error('Memory transport was cancelled');
  const childToken = randomBytes(32).toString('hex');
  const authorization = Buffer.from(`Bearer ${childToken}`);
  const prefix = `/${randomBytes(24).toString('hex')}`;
  const providerFetch = options.fetch ?? fetch;
  const active = new Set<AbortController>();
  const sockets = new Set<Socket>();
  let closed = false;
  let host = '';
  let closePromise: Promise<void> | undefined;
  const server = createServer(async (request, response) => {
    const received = Buffer.from(request.headers.authorization ?? '');
    if (received.length !== authorization.length || !timingSafeEqual(received, authorization)) return send(response, 401, { error: 'Unauthorized' });
    if (request.headers.host !== host || request.headers.origin) return send(response, 403, { error: 'Invalid request origin' });
    if (request.method !== 'POST') return send(response, 405, { error: 'Method not allowed' });
    const path = request.url?.slice(prefix.length);
    if (!request.url?.startsWith(prefix) || !['/v3/documents', '/v3/documents/list', '/v4/search', '/v4/profile', '/mcp'].includes(path!)) return send(response, 404, { error: 'Unknown memory endpoint' });
    if (closed || active.size >= MAX_CONCURRENT_REQUESTS) return send(response, 503, { error: 'Memory transport busy' });
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')) return send(response, 415, { error: 'JSON content type required' });
    if (Number(request.headers['content-length']) > MAX_REQUEST_BYTES) return send(response, 413, { error: 'Request too large' });
    const controller = new AbortController();
    active.add(controller);
    const timer = setTimeout(() => {
      controller.abort();
      if (!response.headersSent && !response.destroyed) send(response, 504, { error: 'Memory request timed out' });
      request.destroy();
    }, REQUEST_TIMEOUT_MS);
    const disconnect = () => { if (!response.writableEnded) controller.abort(); };
    response.on('close', disconnect);
    const upstream = async (apiPath: string, body: JsonObject): Promise<unknown> => {
      const result = await providerFetch(`${API_ORIGIN}${apiPath}`, { method: 'POST', headers: { Authorization: `Bearer ${options.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(untagged(body)), redirect: 'error', signal: controller.signal });
      return readResponse(result);
    };
    let rpc: JsonObject | undefined;
    try {
      const body = await readRequest(request);
      if (controller.signal.aborted) throw new TransportError(504, 'Memory request cancelled');
      if (path === '/mcp') {
        rpc = body;
        if (body.jsonrpc !== '2.0' || typeof body.method !== 'string' || (body.id !== undefined && body.id !== null && typeof body.id !== 'string' && typeof body.id !== 'number')) throw new TransportError(400, 'Invalid MCP request');
        if (body.method === 'notifications/initialized') return send(response, 202);
        if (body.id === undefined || body.id === null) throw new TransportError(400, 'MCP request ID required');
        let result: unknown;
        if (body.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'deck-global-memory', version: '1.0.0' } };
        else if (body.method === 'tools/list') result = { tools: mcpTools };
        else if (body.method === 'tools/call') {
          const operation = mcpOperation(object(body.params));
          result = { content: [{ type: 'text', text: JSON.stringify(await upstream(operation.path, operation.body)) }] };
        } else throw new TransportError(400, 'Unsupported MCP method');
        send(response, 200, { jsonrpc: '2.0', id: body.id, result });
      } else if (path === '/v4/profile') {
        const clean = untagged(body);
        const searchResults = typeof clean.q === 'string' && clean.q.trim() ? await upstream('/v4/search', clean) : { results: [], total: 0 };
        send(response, 200, { profile: { static: [], dynamic: [] }, searchResults });
      } else send(response, 200, await upstream(path!, body));
    } catch (error) {
      const known = error instanceof TransportError;
      const message = known ? error.message : 'Memory provider request failed';
      if (!response.headersSent && !response.destroyed) {
        if (rpc?.id !== undefined && rpc?.id !== null) send(response, 200, { jsonrpc: '2.0', id: rpc.id, error: { code: -32000, message } });
        else send(response, known ? error.status : 502, { error: message });
      }
    } finally {
      clearTimeout(timer);
      response.off('close', disconnect);
      active.delete(controller);
    }
  });
  server.on('connection', (socket) => { sockets.add(socket); socket.once('close', () => sockets.delete(socket)); });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = REQUEST_TIMEOUT_MS;
  server.keepAliveTimeout = 1_000;
  server.maxHeadersCount = 32;
  server.maxConnections = 32;
  const close = (): Promise<void> => {
    if (!closePromise) {
      closed = true;
      options.signal?.removeEventListener('abort', onAbort);
      for (const controller of active) controller.abort();
      closePromise = new Promise((resolve) => { server.close(() => resolve()); server.closeAllConnections(); for (const socket of sockets) socket.destroy(); });
    }
    return closePromise;
  };
  const onAbort = () => { void close(); };
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); });
  const address = server.address();
  if (!address || typeof address === 'string') { await close(); throw new Error('Memory transport unavailable'); }
  host = `127.0.0.1:${address.port}`;
  options.signal?.addEventListener('abort', onAbort, { once: true });
  if (options.signal?.aborted) { await close(); throw new Error('Memory transport was cancelled'); }
  const apiUrl = `http://${host}${prefix}`;
  return { apiUrl, mcpUrl: `${apiUrl}/mcp`, token: childToken, close };
}
