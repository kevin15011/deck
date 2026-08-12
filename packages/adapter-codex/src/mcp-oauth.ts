import { spawnSync } from "node:child_process";
import { CODEX_SUPERMEMORY_MCP_URL } from "./mcp-config";

export const CODEX_MCP_STATUS_TIMEOUT_MS = 5_000;
export const CODEX_MCP_STATUS_MAX_OUTPUT_BYTES = 64 * 1024;

export type CodexSupermemoryOAuthState =
  | "authenticated"
  | "not-authenticated"
  | "not-configured"
  | "unsupported"
  | "unknown";

export type CodexSupermemoryOAuthStatus = { state: CodexSupermemoryOAuthState };

const CANONICAL_SUPERMEMORY_PROJECT_SCOPE = /^sm_project_v1_[a-z0-9]+_[a-z0-9]+(?:_[a-z0-9]+)*$/;

export type CodexMcpStatusCommandRequest = {
  file: "codex";
  args: readonly ["mcp", "list", "--json"];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
};

export type CodexMcpStatusCommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
};

export interface CodexMcpStatusCommandRunner {
  run(request: CodexMcpStatusCommandRequest): Promise<CodexMcpStatusCommandResult>;
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** Parses only Codex's documented MCP list JSON shape; command output is never surfaced. */
export function parseCodexSupermemoryOAuthStatus(stdout: string): CodexSupermemoryOAuthStatus {
  if (byteLength(stdout) > CODEX_MCP_STATUS_MAX_OUTPUT_BYTES) return { state: "unknown" };
  let entries: unknown;
  try {
    entries = JSON.parse(stdout);
  } catch {
    return { state: "unknown" };
  }
  if (!Array.isArray(entries)) return { state: "unknown" };

  const entry = entries.find((candidate) => isRecord(candidate) && candidate.name === "supermemory");
  if (!entry || !isRecord(entry)) return { state: "not-configured" };
  if (entry.enabled !== true) return { state: "not-configured" };
  const transport = entry.transport;
  if (!isRecord(transport) || transport.type !== "streamable_http" || transport.url !== CODEX_SUPERMEMORY_MCP_URL
    || transport.bearer_token_env_var !== null && transport.bearer_token_env_var !== undefined
    || transport.env_http_headers !== null && transport.env_http_headers !== undefined) {
    return { state: "not-configured" };
  }
  const httpHeaders = transport.http_headers;
  if (!isRecord(httpHeaders) || typeof httpHeaders["x-sm-project"] !== "string" || !CANONICAL_SUPERMEMORY_PROJECT_SCOPE.test(httpHeaders["x-sm-project"].trim())) {
    return { state: "not-configured" };
  }
  switch (entry.auth_status) {
    case "oauth": return { state: "authenticated" };
    case "logged_in":
    case "not_logged_in": return { state: "not-authenticated" };
    case "unsupported": return { state: "unsupported" };
    default: return { state: "unknown" };
  }
}

/** Runs only Codex's bounded, read-only MCP list inspection command. */
export async function inspectCodexSupermemoryOAuth(input: {
  projectRoot: string;
  commandRunner?: CodexMcpStatusCommandRunner;
}): Promise<CodexSupermemoryOAuthStatus> {
  const runner = input.commandRunner ?? nodeCodexMcpStatusCommandRunner;
  try {
    const result = await runner.run({
      file: "codex",
      args: ["mcp", "list", "--json"],
      cwd: input.projectRoot,
      timeoutMs: CODEX_MCP_STATUS_TIMEOUT_MS,
      maxOutputBytes: CODEX_MCP_STATUS_MAX_OUTPUT_BYTES,
    });
    return result.exitCode === 0 ? parseCodexSupermemoryOAuthStatus(result.stdout) : { state: "unknown" };
  } catch {
    return { state: "unknown" };
  }
}

/** Production boundary for read-only OAuth status inspection; tests inject the runner above. */
export const nodeCodexMcpStatusCommandRunner: CodexMcpStatusCommandRunner = {
  async run(request) {
    const result = spawnSync(request.file, [...request.args], {
      cwd: request.cwd,
      encoding: "utf8",
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      timeout: request.timeoutMs,
      maxBuffer: request.maxOutputBytes,
      killSignal: "SIGKILL",
    });
    return {
      exitCode: result.status,
      stdout: typeof result.stdout === "string" ? result.stdout : "",
      stderr: typeof result.stderr === "string" ? result.stderr : "",
    };
  },
};
