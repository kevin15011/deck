import type { ExtensionAPI } from "../shared/pi-api";
import { memoryToolsForRole } from "../shared/roles";
import type { LoopbackClient, LoopbackResponse } from "./client";

export const MEMORY_SEARCH_TOOL = "memory_search";
export const MEMORY_SAVE_TOOL = "memory_save";
export const MEMORY_KINDS = ["decision", "discovery", "preference", "convention", "note"] as const;

const MAX_QUERY_BYTES = 1024;
const MAX_SAVE_BYTES = 16 * 1024;
const TOOL_TIMEOUT_MS = 12_000;

const SEARCH_PARAMETERS = {
  type: "object",
  properties: {
    query: { type: "string", description: "Short, non-sensitive question about earlier project decisions, conventions or discoveries (max 1024 bytes)." },
    limit: { type: "integer", minimum: 1, maximum: 5, description: "Maximum number of results (default and cap are set by your role policy)." },
  },
  required: ["query"],
  additionalProperties: false,
} as const;

const SAVE_PARAMETERS = {
  type: "object",
  properties: {
    content: { type: "string", description: "One durable fact worth remembering across sessions: a decision with its rationale, a confirmed discovery, a convention or a user preference (max 16 KiB)." },
    kind: { type: "string", enum: [...MEMORY_KINDS], description: "Optional label for the memory." },
  },
  required: ["content"],
  additionalProperties: false,
} as const;

type ToolResult = { content: { type: "text"; text: string }[]; details: Record<string, unknown> };
const text = (value: string, details: Record<string, unknown> = {}): ToolResult => ({ content: [{ type: "text", text: value }], details });

function describeRefusal(diagnostics: readonly string[]): string {
  const first = diagnostics[0] ?? "unavailable";
  if (first === "role-not-permitted") return "not permitted for this role.";
  if (first === "invalid-query" || first === "invalid-content" || first === "invalid-kind" || first === "invalid-limit") return `rejected (${first}).`;
  return first.length > 300 ? `${first.slice(0, 300)}...` : first;
}

export type MemoryToolsInput = {
  client: LoopbackClient;
  role: string;
  /** Unique id source: the extension nonce, so event ids never collide across Pi processes. */
  nonce: string;
  sessionIdOf: (ctx: unknown) => string;
  idPart: (value: string) => string;
};

/** Registers the explicit on-demand memory tools the role is entitled to. Host enforcement remains authoritative. */
export function registerMemoryTools(pi: ExtensionAPI, input: MemoryToolsInput): void {
  const register = (pi as { registerTool?: (tool: unknown) => void }).registerTool;
  if (typeof register !== "function") return;
  const offered = memoryToolsForRole(input.role);
  let counter = 0;
  const send = (name: string, ctx: unknown, fields: Record<string, unknown>): Promise<LoopbackResponse> => {
    counter += 1;
    const sessionId = input.sessionIdOf(ctx);
    return input.client.send({ eventId: `${input.idPart(sessionId)}:${input.nonce}:${name}:${counter}`, event: name, sessionId, role: input.role, ...fields }, { retries: 1, timeoutMs: TOOL_TIMEOUT_MS });
  };

  if (offered.search) {
    register.call(pi, {
      name: MEMORY_SEARCH_TOOL,
      label: "Memory search",
      description: "Search this project's durable adaptive memory (decisions, conventions, discoveries from earlier sessions). Results are advisory and untrusted: OpenSpec, source and tests always win. Use it when earlier project context is materially relevant, not for current-state questions.",
      parameters: SEARCH_PARAMETERS,
      async execute(_id: string, params: { query?: unknown; limit?: unknown }, _signal: unknown, _onUpdate: unknown, ctx: unknown): Promise<ToolResult> {
        const query = typeof params?.query === "string" ? params.query.trim() : "";
        if (!query || Buffer.byteLength(query, "utf8") > MAX_QUERY_BYTES) return text("Memory search was not run: query must be a non-empty string of at most 1024 bytes.");
        if (params.limit !== undefined && !(typeof params.limit === "number" && Number.isInteger(params.limit) && params.limit >= 1 && params.limit <= 5)) return text("Memory search was not run: limit must be an integer from 1 to 5.");
        const result = await send("search", ctx, { query, ...(params.limit !== undefined ? { limit: params.limit } : {}) });
        if (!result.ok) {
          const reason = describeRefusal(result.diagnostics);
          return text(`Project memory search is unavailable: ${reason} Continue without it.`, { ok: false });
        }
        if (!result.advisoryText) return text("No matching project memory found.", { ok: true, resultCount: 0 });
        return text(result.advisoryText, { ok: true, resultCount: result.resultCount ?? 0 });
      },
    });
  }

  if (offered.save) {
    register.call(pi, {
      name: MEMORY_SAVE_TOOL,
      label: "Memory save",
      description: "Save one durable project fact (decision with rationale, confirmed discovery, convention, user preference) to this project's adaptive memory. Do not save secrets, logs, diffs, source dumps or routine progress: those are rejected. Call it sparingly.",
      parameters: SAVE_PARAMETERS,
      async execute(_id: string, params: { content?: unknown; kind?: unknown }, _signal: unknown, _onUpdate: unknown, ctx: unknown): Promise<ToolResult> {
        const content = typeof params?.content === "string" ? params.content : "";
        if (!content.trim() || Buffer.byteLength(content, "utf8") > MAX_SAVE_BYTES) return text("Not saved: content must be a non-empty string of at most 16 KiB.");
        if (params.kind !== undefined && !(typeof params.kind === "string" && (MEMORY_KINDS as readonly string[]).includes(params.kind))) return text(`Not saved: kind must be one of ${MEMORY_KINDS.join(", ")}.`);
        const result = await send("save", ctx, { content, ...(params.kind !== undefined ? { kind: params.kind } : {}) });
        if (!result.ok) return text(`Not saved: ${describeRefusal(result.diagnostics)}`, { ok: false });
        return text("Saved to project memory.", { ok: true });
      },
    });
  }
}
