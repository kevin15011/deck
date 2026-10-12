/**
 * `deck internal session-mcp` (D-11): an MCP stdio server inside each native child that forwards
 * `deck_approve` / `deck_status` to the daemon over its Unix socket, authenticated by a task
 * credential read from a 0600 file named in env. stdout carries only JSON-RPC frames.
 */
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { APPROVAL_TIMEOUT_MS } from "./approval-broker";
import { DECK_APPROVE_TOOL, DECK_STATUS_TOOL, SESSION_CREDENTIAL_ENV, SESSION_MCP_SERVER_ID } from "./bridge-config";
import { ControlClient } from "./control-client";
import { assertPrivateFile } from "./paths";
import type { CommandOutcome } from "./protocol";

const DEFAULT_PROTOCOL_VERSION = "2025-06-18";
const CALL_TIMEOUT_MS = 15_000;

export type McpBridgeOptions = {
  input: NodeJS.ReadableStream;
  write: (line: string) => void;
  env: Readonly<Record<string, string | undefined>>;
  version: string;
  connect?: (socketPath: string) => Promise<ControlClient>;
};

const TOOLS = [
  {
    name: DECK_APPROVE_TOOL,
    description: "Relay a permission prompt to the Deck user and wait for the decision. Returns {behavior, updatedInput|message}.",
    inputSchema: {
      type: "object",
      properties: { tool_name: { type: "string" }, input: { type: "object" }, tool_use_id: { type: "string" } },
      required: ["tool_name", "input"],
    },
  },
  { name: DECK_STATUS_TOOL, description: "Report the state of this Deck session task.", inputSchema: { type: "object", properties: {} } },
];

class ToolFailure extends Error {
  constructor(readonly code: string, message?: string) { super(message ?? code); }
}

function readCredential(env: McpBridgeOptions["env"]): { token: string; socketPath: string } {
  const file = env[SESSION_CREDENTIAL_ENV];
  if (!file) throw new ToolFailure("credential-unavailable", `${SESSION_CREDENTIAL_ENV} is not set`);
  try { assertPrivateFile(file); } catch (error) {
    const message = (error as NodeJS.ErrnoException).code === "ENOENT" ? "credential file is missing" : (error as Error).message;
    throw new ToolFailure((error as NodeJS.ErrnoException).code === "ENOENT" ? "credential-unavailable" : "credential-insecure", message);
  }
  try {
    const raw = JSON.parse(readFileSync(file, "utf8")) as { token?: unknown; socketPath?: unknown };
    if (typeof raw.token !== "string" || typeof raw.socketPath !== "string" || !raw.token || !raw.socketPath) throw new Error("shape");
    return { token: raw.token, socketPath: raw.socketPath };
  } catch { throw new ToolFailure("credential-unavailable", "credential file is unreadable"); }
}

const ok = (id: unknown, result: unknown) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id: unknown, code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const toolText = (text: string, isError = false) => ({ content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) });

export async function runSessionMcpBridge(options: McpBridgeOptions): Promise<void> {
  const connect = options.connect ?? ((path: string) => ControlClient.connect(path, { timeoutMs: 3000 }));
  let client: ControlClient | undefined;
  const inflight = new Set<Promise<void>>();
  const send = (message: unknown) => options.write(`${JSON.stringify(message)}\n`);

  async function daemon(socketPath: string): Promise<ControlClient> {
    if (client) {
      const current = client;
      const alive = await Promise.race([current.closed.then(() => false), Promise.resolve(true)]);
      if (alive) return current;
      client = undefined;
    }
    try { client = await connect(socketPath); } catch { throw new ToolFailure("daemon-unreachable", "cannot reach the Deck daemon"); }
    return client;
  }

  async function callTool(name: string, args: unknown): Promise<string> {
    if (name !== DECK_APPROVE_TOOL && name !== DECK_STATUS_TOOL) throw new ToolFailure("tool-unknown", `unknown tool ${name}`);
    if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) throw new ToolFailure("invalid-arguments", "arguments must be an object");
    const { token, socketPath } = readCredential(options.env);
    const connection = await daemon(socketPath);
    let reply;
    try {
      reply = await connection.request({ t: "bridge.call", token, tool: name, arguments: args }, name === DECK_APPROVE_TOOL ? APPROVAL_TIMEOUT_MS + 60_000 : CALL_TIMEOUT_MS);
    } catch (error) {
      throw new ToolFailure((error as Error).message.includes("Timed out") ? "daemon-timeout" : "daemon-unreachable", "the Deck daemon did not answer");
    }
    if (reply.t !== "bridge.result") throw new ToolFailure("protocol-error", `unexpected ${reply.t}`);
    const outcome: CommandOutcome = reply.outcome;
    if (!outcome.ok) throw new ToolFailure(outcome.code, outcome.message);
    return JSON.stringify(outcome.data ?? {});
  }

  async function handle(line: string): Promise<void> {
    let message: { id?: unknown; method?: unknown; params?: { name?: unknown; arguments?: unknown; protocolVersion?: unknown } };
    try { message = JSON.parse(line); } catch { return send(rpcError(null, -32700, "Parse error")); }
    if (typeof message !== "object" || message === null) return send(rpcError(null, -32600, "Invalid request"));
    const { id, method } = message;
    const isRequest = id !== undefined && id !== null;
    if (typeof method !== "string") { if (isRequest) send(rpcError(id, -32600, "Invalid request")); return; }
    switch (method) {
      case "initialize":
        return send(ok(id, {
          protocolVersion: typeof message.params?.protocolVersion === "string" ? message.params.protocolVersion : DEFAULT_PROTOCOL_VERSION,
          capabilities: { tools: {} }, serverInfo: { name: SESSION_MCP_SERVER_ID, version: options.version },
        }));
      case "ping": return isRequest ? send(ok(id, {})) : undefined;
      case "tools/list": return isRequest ? send(ok(id, { tools: TOOLS })) : undefined;
      case "tools/call": {
        if (!isRequest) return;
        const name = message.params?.name;
        if (typeof name !== "string") return send(rpcError(id, -32602, "tools/call needs a tool name"));
        try {
          send(ok(id, toolText(await callTool(name, message.params?.arguments))));
        } catch (error) {
          const failure = error instanceof ToolFailure ? error : new ToolFailure("internal-error");
          send(ok(id, toolText(`deck bridge error: ${failure.code}${failure.message !== failure.code ? ` (${failure.message})` : ""}`, true)));
        }
        return;
      }
      default:
        if (isRequest) send(rpcError(id, -32601, `Method not found: ${method}`));
    }
  }

  await new Promise<void>((resolve) => {
    const rl = createInterface({ input: options.input });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      const task = handle(line).catch(() => {}).finally(() => { inflight.delete(task); });
      inflight.add(task);
    });
    rl.once("close", resolve);
  });
  // The child closed stdin: nothing can consume further replies. Dropping the daemon connection
  // lets the daemon deny any approval still waiting on this bridge.
  client?.close();
  await Promise.allSettled([...inflight]);
}
