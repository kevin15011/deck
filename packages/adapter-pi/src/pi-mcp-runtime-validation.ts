import {
  redactPiMcpConfigDiagnosticText,
  validateSupermemoryPiMcpConfig,
  type ValidateSupermemoryPiMcpConfigOptions,
} from "./pi-mcp-config";
import { extractValidatedSupermemoryPiMcpRuntimeServer } from "./pi-mcp-config-internal";

export type SupermemoryRuntimeValidationDiagnostic = {
  code:
    | "configuration-invalid"
    | "runtime-unreachable"
    | "timeout"
    | "unauthenticated"
    | "runtime-unavailable"
    | "invalid-response"
    | "missing-tools";
  message: string;
  detail?: string;
};

export type SupermemoryRuntimeValidationResult =
  | {
      ok: true;
      authenticatedRuntimeValidated: true;
      path: string;
      serverName: string;
      endpoint: string;
      toolNames: readonly string[];
      diagnostics: readonly SupermemoryRuntimeValidationDiagnostic[];
    }
  | {
      ok: false;
      authenticatedRuntimeValidated: false;
      path: string;
      serverName: string;
      endpoint?: string;
      diagnostics: readonly SupermemoryRuntimeValidationDiagnostic[];
    };

export type SupermemoryRuntimeValidationOptions = ValidateSupermemoryPiMcpConfigOptions & {
  /** Per-request timeout for each non-mutating JSON-RPC probe (initialize, then tools/list). */
  timeoutMs?: number;
  fetch?: typeof fetch;
  AbortController?: typeof AbortController;
};

type JsonRecord = Record<string, unknown>;

const DEFAULT_TIMEOUT_MS = 3000;
const REQUIRED_TOOLS = ["execute", "search_docs"] as const;
const MCP_PROTOCOL_VERSION = "2024-11-05";
const MCP_CLIENT_INFO = { name: "deck-pi-runtime-validation", version: "0.0.0" } as const;

export async function validateSupermemoryPiMcpRuntime(
  options: SupermemoryRuntimeValidationOptions = {},
): Promise<SupermemoryRuntimeValidationResult> {
  const staticValidation = validateSupermemoryPiMcpConfig(options);
  if (!staticValidation.ok) {
    return failed(staticValidation.path, staticValidation.serverName, undefined, {
      code: "configuration-invalid",
      message: "Supermemory Pi MCP configuration is missing or invalid; launched without adaptive-memory injection.",
      detail: staticValidation.diagnostics.map((diagnostic) => diagnostic.message).join(" "),
    });
  }

  let runtimeServer;
  try {
    runtimeServer = extractValidatedSupermemoryPiMcpRuntimeServer(options);
  } catch (error) {
    return failed(staticValidation.path, staticValidation.serverName, undefined, {
      code: "configuration-invalid",
      message: "Supermemory Pi MCP configuration could not be read safely; launched without adaptive-memory injection.",
      detail: stringifyError(error),
    });
  }

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const AbortControllerImpl = options.AbortController ?? globalThis.AbortController;
  if (typeof fetchImpl !== "function" || typeof AbortControllerImpl !== "function") {
    return failed(runtimeServer.path, runtimeServer.serverName, runtimeServer.endpoint, {
      code: "runtime-unreachable",
      message: "Supermemory runtime validation cannot run because fetch or AbortController is unavailable.",
    });
  }

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const redactText = createSecretAwareRedactor(Object.values(runtimeServer.headers));

  const initialize = await postJsonRpc(fetchImpl, AbortControllerImpl, runtimeServer.endpoint, runtimeServer.headers, "initialize", timeoutMs, redactText);
  if (!initialize.ok) return failed(runtimeServer.path, runtimeServer.serverName, runtimeServer.endpoint, initialize.diagnostic, redactText);

  const tools = await postJsonRpc(fetchImpl, AbortControllerImpl, runtimeServer.endpoint, runtimeServer.headers, "tools/list", timeoutMs, redactText);
  if (!tools.ok) return failed(runtimeServer.path, runtimeServer.serverName, runtimeServer.endpoint, tools.diagnostic, redactText);

  const toolNames = extractToolNames(tools.body);
  if (!toolNames) {
    return failed(runtimeServer.path, runtimeServer.serverName, runtimeServer.endpoint, {
      code: "invalid-response",
      message: "Supermemory runtime returned an invalid tools/list response; launched without adaptive-memory injection.",
    }, redactText);
  }

  const missing = REQUIRED_TOOLS.filter((tool) => !toolNames.includes(tool));
  if (missing.length > 0) {
    return failed(runtimeServer.path, runtimeServer.serverName, runtimeServer.endpoint, {
      code: "missing-tools",
      message: `Supermemory runtime did not expose expected MCP tools (${missing.join(", ")}); launched without adaptive-memory injection.`,
      detail: `Available tools: ${toolNames.join(", ") || "none"}`,
    }, redactText);
  }

  return {
    ok: true,
    authenticatedRuntimeValidated: true,
    path: runtimeServer.path,
    serverName: runtimeServer.serverName,
    endpoint: runtimeServer.endpoint,
    toolNames,
    diagnostics: [],
  };
}

async function postJsonRpc(
  fetchImpl: typeof fetch,
  AbortControllerImpl: typeof AbortController,
  endpoint: string,
  headers: Record<string, string>,
  method: "initialize" | "tools/list",
  timeoutMs: number,
  redactText: (value: string) => string,
): Promise<{ ok: true; body: unknown } | { ok: false; diagnostic: SupermemoryRuntimeValidationDiagnostic }> {
  const controller = new AbortControllerImpl();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1, timeoutMs));

  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...headers,
      },
      body: JSON.stringify(jsonRpcRequest(method)),
      signal: controller.signal,
    });

    if (response.status === 401 || response.status === 403) {
      return { ok: false, diagnostic: { code: "unauthenticated", message: "Supermemory authentication failed; check the configured Pi MCP credential and try again." } };
    }
    if (!response.ok) {
      return { ok: false, diagnostic: { code: "runtime-unavailable", message: `Supermemory runtime ${method} check failed with HTTP ${response.status}; launched without adaptive-memory injection.` } };
    }

    let body: unknown;
    try {
      body = await parseMcpResponse(response);
    } catch (error) {
      return { ok: false, diagnostic: { code: "invalid-response", message: `Supermemory runtime returned an invalid ${method} response; launched without adaptive-memory injection.`, detail: stringifyError(error, redactText) } };
    }
    if (!isPlainRecord(body)) {
      return { ok: false, diagnostic: { code: "invalid-response", message: `Supermemory runtime returned an invalid ${method} response; launched without adaptive-memory injection.` } };
    }
    if (body.error) {
      return { ok: false, diagnostic: { code: "invalid-response", message: `Supermemory runtime returned an invalid ${method} response; launched without adaptive-memory injection.`, detail: jsonRpcErrorDetail(body, redactText) } };
    }
    return { ok: true, body };
  } catch (error) {
    if (timedOut || (error instanceof Error && error.name === "AbortError")) {
      return { ok: false, diagnostic: { code: "timeout", message: "Supermemory runtime validation timed out; launched without adaptive-memory injection." } };
    }
    return { ok: false, diagnostic: { code: "runtime-unreachable", message: "Supermemory runtime is unreachable; launched without adaptive-memory injection.", detail: stringifyError(error, redactText) } };
  } finally {
    clearTimeout(timer);
  }
}

function jsonRpcRequest(method: "initialize" | "tools/list"): JsonRecord {
  if (method === "initialize") {
    return {
      jsonrpc: "2.0",
      id: method,
      method,
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: MCP_CLIENT_INFO,
      },
    };
  }

  return { jsonrpc: "2.0", id: method, method };
}

function jsonRpcErrorDetail(body: JsonRecord, redactText: (value: string) => string): string | undefined {
  const error = body.error;
  return isPlainRecord(error) ? redactText(String(error.message ?? "JSON-RPC error")) : undefined;
}

async function parseMcpResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("text/event-stream")) {
    const data = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .find((line) => line && line !== "[DONE]");
    if (!data) throw new Error("Missing SSE data frame");
    return JSON.parse(data);
  }
  return JSON.parse(text);
}

function extractToolNames(body: unknown): string[] | undefined {
  if (!isPlainRecord(body)) return undefined;
  const result = body.result;
  if (!isPlainRecord(result) || !Array.isArray(result.tools)) return undefined;
  const names = result.tools
    .map((tool) => (isPlainRecord(tool) && typeof tool.name === "string" ? tool.name : undefined))
    .filter((name): name is string => Boolean(name));
  return names.length === result.tools.length ? names : undefined;
}

function failed(
  path: string,
  serverName: string,
  endpoint: string | undefined,
  diagnostic: SupermemoryRuntimeValidationDiagnostic,
  redactText: (value: string) => string = redactPiMcpConfigDiagnosticText,
): SupermemoryRuntimeValidationResult {
  return {
    ok: false,
    authenticatedRuntimeValidated: false,
    path,
    serverName,
    ...(endpoint ? { endpoint } : {}),
    diagnostics: [redactRuntimeDiagnostic(diagnostic, redactText)],
  };
}

function redactRuntimeDiagnostic(
  diagnostic: SupermemoryRuntimeValidationDiagnostic,
  redactText: (value: string) => string,
): SupermemoryRuntimeValidationDiagnostic {
  return {
    ...diagnostic,
    message: redactText(diagnostic.message),
    ...(diagnostic.detail ? { detail: redactText(diagnostic.detail) } : {}),
  };
}

function stringifyError(error: unknown, redactText: (value: string) => string = redactPiMcpConfigDiagnosticText): string {
  return redactText(error instanceof Error ? error.message : String(error));
}

function createSecretAwareRedactor(secretValues: readonly string[]): (value: string) => string {
  const secrets = [...new Set(secretValues.map((secret) => secret.trim()).filter(Boolean))];
  return (value: string) => {
    let redacted = redactPiMcpConfigDiagnosticText(value);
    for (const secret of secrets) {
      redacted = redacted.split(secret).join("[REDACTED]");
    }
    return redacted;
  };
}

function isPlainRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
