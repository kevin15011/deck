/**
 * Per-turn launch plan for the Claude session driver (XR-4.3, XR-4.7, design 4.1).
 *
 * One `claude -p` process per turn. The first turn assigns the native session id
 * (`--session-id`), later turns `--resume` it. Isolation: a strict, explicit MCP set from a
 * 0600 file and a `--settings` override that disables hooks. Never `--bare` (API-key only) and
 * never `--safe-mode` (verified on 2.1.296 to drop the explicit MCP set too). The existing
 * interactive launch lane in `claude-launch-plan.ts` is not touched.
 */
import type { DriverTaskInput } from "@deck/core/session/driver";

export const DECK_APPROVE_PROMPT_TOOL = "mcp__deck__deck_approve";
const DECK_SERVER_ID = "deck";
const EFFORT_LEVELS = new Set(["low", "medium", "high", "xhigh", "max"]);
/** Claude exposes native delegation as `Task` (older) / `Agent` (newer); naming both is harmless. */
const NATIVE_DELEGATION_TOOLS = "Task,Agent";
/** Approval timeout (15 min) plus a minute: the permission-prompt MCP call blocks for the whole wait. */
const MCP_TOOL_TIMEOUT_MS = 16 * 60 * 1000;
const MAX_SCALAR_BYTES = 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ClaudeLaunchError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "ClaudeLaunchError"; }
}

export type ClaudeTurnLaunch = {
  command: string;
  args: string[];
  env: Record<string, string>;
  /** MCP server ids the child must list at init, in config order. */
  expectedMcpServers: string[];
  diagnostics: Array<{ code: string; detail?: string }>;
};

export type ClaudeLaunchFiles = { writePrivateFile(name: string, content: string): string };
export type ClaudeLaunchOptions = {
  executable?: string;
  baseEnv?: Readonly<Record<string, string | undefined>>;
  /** Appended verbatim after Deck's flags. For the opt-in live contract script (e.g. `--tools ""`); production leaves it unset. */
  extraArgs?: readonly string[];
};

const safeScalar = (value: string): boolean =>
  value.length > 0 && value.trim() === value && !value.startsWith("-") && !/[\0\r\n]/.test(value) && Buffer.byteLength(value, "utf8") <= MAX_SCALAR_BYTES;

/** One stream-json user message (newline terminated). */
export function encodeUserMessage(text: string): string {
  return `${JSON.stringify({ type: "user", message: { role: "user", content: text } })}\n`;
}

export function buildClaudeTurnLaunch(input: DriverTaskInput, files: ClaudeLaunchFiles, options: ClaudeLaunchOptions = {}): ClaudeTurnLaunch {
  const { modelId, thinking } = input.assignment;
  if (!safeScalar(modelId)) throw new ClaudeLaunchError("claude-invalid-model", "Claude model id must be a bounded, non-option scalar");
  const sessionId = input.resume?.nativeSessionId ?? input.nativeSessionId;
  if (!sessionId || !UUID.test(sessionId)) throw new ClaudeLaunchError("claude-invalid-session-id", "Claude native session id must be a UUID");

  const diagnostics: ClaudeTurnLaunch["diagnostics"] = [];
  const specs: Record<string, { command: string; args: readonly string[]; env: Readonly<Record<string, string>> } | { type: "http"; url: string; headers?: Record<string, string> }> = {};
  for (const id of input.mcp.servers) {
    const spec = input.mcpServerSpecs[id];
    if (!spec) throw new ClaudeLaunchError("claude-mcp-spec-missing", `No launch spec for MCP server "${id}"`);
    if (spec.transport === "http") {
      const headers = Object.fromEntries(Object.entries(spec.envHttpHeaders ?? {}).map(([name, variable]) => {
        if (!/^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable))
          throw new ClaudeLaunchError("claude-http-header-reference-invalid", "HTTP headers require valid header and environment variable names");
        return [name, "${" + variable + "}"];
      }));
      specs[id] = { type: "http", url: spec.url, ...(Object.keys(headers).length ? { headers } : {}) };
    } else specs[id] = { command: spec.command, args: [...spec.args], env: { ...spec.env } };
  }
  if (input.approvals === "relay" && !(DECK_SERVER_ID in specs)) {
    throw new ClaudeLaunchError("claude-session-mcp-missing", "Relay approvals need the Deck session MCP server in the child set");
  }
  const mcpConfigFile = files.writePrivateFile("mcp-config.json", JSON.stringify({ mcpServers: specs }));

  const args: string[] = ["-p", "--model", modelId];
  if (thinking !== undefined) {
    if (EFFORT_LEVELS.has(thinking)) args.push("--effort", thinking);
    else diagnostics.push({ code: "claude-thinking-ignored", detail: thinking });
  }
  args.push(...(input.resume ? ["--resume", sessionId] : ["--session-id", sessionId]));
  args.push("--input-format", "stream-json", "--output-format", "stream-json", "--verbose", "--include-partial-messages");
  args.push("--strict-mcp-config", "--mcp-config", mcpConfigFile);
  args.push("--settings", JSON.stringify({ attribution: { commit: "", pr: "" }, disableAllHooks: true }));
  if (input.approvals === "relay") args.push("--permission-prompt-tool", DECK_APPROVE_PROMPT_TOOL);
  if (input.disableNativeDelegation) args.push("--disallowedTools", NATIVE_DELEGATION_TOOLS);
  if (input.rolePrompt.length > 0) args.push("--append-system-prompt-file", files.writePrivateFile("role-prompt.md", input.rolePrompt));

  if (options.extraArgs) args.push(...options.extraArgs);

  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(options.baseEnv ?? process.env)) if (typeof value === "string") env[key] = value;
  env.MCP_TOOL_TIMEOUT = String(MCP_TOOL_TIMEOUT_MS);

  return { command: options.executable ?? "claude", args, env, expectedMcpServers: [...input.mcp.servers], diagnostics };
}
