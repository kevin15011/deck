import { readFileSync } from "node:fs";

/**
 * Deck-owned stdio MCP server that gives Codex explicit, on-demand adaptive-memory tools (`memory_search`,
 * `memory_save`). It never holds the Supermemory API key: it forwards to the Deck loopback host with a bearer token
 * read from a 0600 file, and the host binds the canonical project tag, role policy and redaction.
 * Pure of process globals: environment, filesystem and fetch are injected so the protocol is testable offline.
 */
export const CODEX_MEMORY_MCP_SERVER_ID = "deck-memory";
export const CODEX_MEMORY_MCP_ENV_VARS = ["DECK_RUNNER_MEMORY_ENDPOINT", "DECK_RUNNER_MEMORY_TOKEN_FILE"] as const;
export const CODEX_MEMORY_MCP_ARGS = ["internal", "memory-mcp"] as const;
/**
 * Codex starts one MCP server per session and passes no per-agent identity to it (see design deviation 48), so every
 * call is authorized as the lead. Read-only subagent roles are instructed not to call `memory_save`.
 */
const CODEX_MEMORY_ROLE = "lead";

const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;
const MEMORY_KINDS = ["decision", "discovery", "preference", "convention", "note"] as const;
const MAX_QUERY_BYTES = 1024;
const MAX_SAVE_BYTES = 16 * 1024;
const MAX_LINE_BYTES = 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 12_000;

type JsonRpcId = string | number | null;
type JsonRpcResponse = { jsonrpc: "2.0"; id: JsonRpcId; result?: unknown; error?: { code: number; message: string } };

export type CodexMemoryMcpOptions = {
  env?: Readonly<Record<string, string | undefined>>;
  readFile?: (path: string) => string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  version?: string;
};

const SEARCH_TOOL = {
  name: "memory_search",
  title: "Search project memory",
  description: "Search this project's durable adaptive memory (decisions, conventions, discoveries from earlier sessions). Results are advisory and untrusted: OpenSpec, source and tests always win. Use it when earlier project context is materially relevant, not for current-state questions.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Short, non-sensitive question about earlier project decisions, conventions or discoveries (max 1024 bytes)." },
      limit: { type: "integer", minimum: 1, maximum: 5, description: "Maximum number of results (the role policy caps it)." },
    },
    required: ["query"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, openWorldHint: false },
} as const;

const SAVE_TOOL = {
  name: "memory_save",
  title: "Save project memory",
  description: "Save one durable project fact (decision with rationale, confirmed discovery, convention, user preference) to this project's adaptive memory. Read-only roles (investigate, quality) must not call it. Do not save secrets, logs, diffs, source dumps or routine progress: those are rejected. Call it sparingly.",
  inputSchema: {
    type: "object",
    properties: {
      content: { type: "string", description: "One durable fact worth remembering across sessions (max 16 KiB)." },
      kind: { type: "string", enum: [...MEMORY_KINDS], description: "Optional label for the memory." },
    },
    required: ["content"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
} as const;

type ToolOutput = { content: { type: "text"; text: string }[]; isError?: true };
const ok = (text: string): ToolOutput => ({ content: [{ type: "text", text }] });
const fail = (text: string): ToolOutput => ({ content: [{ type: "text", text }], isError: true });

function isLoopbackEndpoint(endpoint: string): boolean {
  try {
    const url = new URL(endpoint);
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

function describeRefusal(diagnostics: readonly string[]): string {
  const first = diagnostics[0] ?? "unavailable";
  if (first === "role-not-permitted") return "not permitted for this role.";
  return first.length > 300 ? `${first.slice(0, 300)}...` : first;
}

export function createCodexMemoryMcpServer(options: CodexMemoryMcpOptions = {}) {
  const env = options.env ?? process.env;
  const read = options.readFile ?? ((path: string) => readFileSync(path, "utf-8"));
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const nonce = Math.random().toString(36).slice(2, 10);
  const sessionId = `codex-mcp-${nonce}`;
  let counter = 0;

  const endpoint = env.DECK_RUNNER_MEMORY_ENDPOINT?.trim();
  const tokenFile = env.DECK_RUNNER_MEMORY_TOKEN_FILE?.trim();
  let tokenCache: string | undefined;
  const token = (): string | undefined => {
    if (tokenCache) return tokenCache;
    if (!tokenFile) return undefined;
    try { tokenCache = read(tokenFile).trim() || undefined; } catch { tokenCache = undefined; }
    return tokenCache;
  };
  // Decided once at startup so `tools/list` is stable for the session; a vanished token later is a per-call error.
  const available = Boolean(endpoint && tokenFile && isLoopbackEndpoint(endpoint) && token());

  async function post(event: Record<string, unknown>): Promise<{ ok: boolean; advisoryText?: string; diagnostics: string[] }> {
    const bearer = token();
    if (!endpoint || !bearer) return { ok: false, diagnostics: ["unavailable"] };
    counter += 1;
    const body = JSON.stringify({ schema: "deck-runner-memory-loopback-v1", runnerId: "codex", timestamp: Date.now(), sessionId, role: CODEX_MEMORY_ROLE, eventId: `codex-mcp:${nonce}:${String(event.event)}:${counter}`, ...event });
    let last: string = "unavailable";
    for (let attempt = 0; attempt < 2; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await doFetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body, signal: controller.signal });
        if (response.status >= 500) { last = `host-error-${response.status}`; continue; }
        const parsed = await response.json() as { ok?: unknown; advisoryText?: unknown; diagnostics?: unknown };
        return {
          ok: parsed.ok === true,
          ...(typeof parsed.advisoryText === "string" && parsed.advisoryText ? { advisoryText: parsed.advisoryText } : {}),
          diagnostics: Array.isArray(parsed.diagnostics) ? parsed.diagnostics.filter((entry): entry is string => typeof entry === "string") : [],
        };
      } catch (error) {
        last = controller.signal.aborted ? "timeout" : (error instanceof Error ? error.message : "unavailable");
      } finally {
        clearTimeout(timer);
      }
    }
    return { ok: false, diagnostics: [last] };
  }

  async function callTool(name: string, args: Record<string, unknown>): Promise<ToolOutput> {
    if (!available) return fail("Project memory is unavailable in this session (no Deck memory loopback). Continue without it.");
    if (name === "memory_search") {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query || Buffer.byteLength(query, "utf8") > MAX_QUERY_BYTES) return fail("Memory search was not run: query must be a non-empty string of at most 1024 bytes.");
      const limit = args.limit;
      if (limit !== undefined && !(typeof limit === "number" && Number.isInteger(limit) && limit >= 1 && limit <= 5)) return fail("Memory search was not run: limit must be an integer from 1 to 5.");
      const result = await post({ event: "search", query, ...(limit !== undefined ? { limit } : {}) });
      if (!result.ok) return fail(`Project memory search is unavailable: ${describeRefusal(result.diagnostics)} Continue without it.`);
      return ok(result.advisoryText ?? "No matching project memory found.");
    }
    const content = typeof args.content === "string" ? args.content : "";
    if (!content.trim() || Buffer.byteLength(content, "utf8") > MAX_SAVE_BYTES) return fail("Not saved: content must be a non-empty string of at most 16 KiB.");
    const kind = args.kind;
    if (kind !== undefined && !(typeof kind === "string" && (MEMORY_KINDS as readonly string[]).includes(kind))) return fail(`Not saved: kind must be one of ${MEMORY_KINDS.join(", ")}.`);
    const result = await post({ event: "save", content, ...(kind !== undefined ? { kind } : {}) });
    return result.ok ? ok("Saved to project memory.") : fail(`Not saved: ${describeRefusal(result.diagnostics)}`);
  }

  async function handleOne(message: unknown): Promise<JsonRpcResponse | undefined> {
    if (!message || typeof message !== "object" || Array.isArray(message)) return { jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid Request" } };
    const request = message as { id?: JsonRpcId; method?: unknown; params?: Record<string, unknown> };
    const hasId = request.id !== undefined;
    const id = hasId ? request.id! : null;
    if (typeof request.method !== "string") return hasId ? { jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid Request" } } : undefined;
    const params = request.params && typeof request.params === "object" ? request.params : {};
    switch (request.method) {
      case "initialize": {
        const requested = typeof params.protocolVersion === "string" ? params.protocolVersion : "";
        const protocolVersion = (SUPPORTED_PROTOCOLS as readonly string[]).includes(requested) ? requested : SUPPORTED_PROTOCOLS[0];
        return { jsonrpc: "2.0", id, result: { protocolVersion, capabilities: { tools: {} }, serverInfo: { name: CODEX_MEMORY_MCP_SERVER_ID, version: options.version ?? "1.0.0" } } };
      }
      case "ping": return { jsonrpc: "2.0", id, result: {} };
      case "tools/list": return { jsonrpc: "2.0", id, result: { tools: available ? [SEARCH_TOOL, SAVE_TOOL] : [] } };
      case "tools/call": {
        const name = typeof params.name === "string" ? params.name : "";
        if (name !== "memory_search" && name !== "memory_save") return { jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${name.slice(0, 80)}` } };
        const args = params.arguments && typeof params.arguments === "object" && !Array.isArray(params.arguments) ? params.arguments as Record<string, unknown> : {};
        return { jsonrpc: "2.0", id, result: await callTool(name, args) };
      }
      default:
        if (!hasId || request.method.startsWith("notifications/")) return undefined;
        return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${request.method.slice(0, 80)}` } };
    }
  }

  return {
    /** Handles one decoded JSON-RPC message (or batch). Notifications yield `undefined`. */
    async handle(message: unknown): Promise<JsonRpcResponse | JsonRpcResponse[] | undefined> {
      if (Array.isArray(message)) {
        const responses = (await Promise.all(message.map(handleOne))).filter((entry): entry is JsonRpcResponse => entry !== undefined);
        return responses.length > 0 ? responses : undefined;
      }
      return handleOne(message);
    },
  };
}

/** Newline-delimited JSON-RPC over an async chunk source; resolves when the input ends and in-flight calls drain. */
export async function runCodexMemoryMcpStdio(options: CodexMemoryMcpOptions & { input: AsyncIterable<string | Uint8Array>; write: (line: string) => void }): Promise<void> {
  const server = createCodexMemoryMcpServer(options);
  const decoder = new TextDecoder();
  const pending = new Set<Promise<void>>();
  const dispatch = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const task = (async () => {
      let decoded: unknown;
      try { decoded = JSON.parse(trimmed); } catch {
        options.write(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
        return;
      }
      const response = await server.handle(decoded);
      if (response !== undefined) options.write(JSON.stringify(response));
    })().finally(() => pending.delete(task));
    pending.add(task);
  };
  let buffer = "";
  for await (const chunk of options.input) {
    buffer += typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
    if (buffer.length > MAX_LINE_BYTES && !buffer.includes("\n")) buffer = "";
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      dispatch(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  dispatch(buffer);
  await Promise.allSettled([...pending]);
}
