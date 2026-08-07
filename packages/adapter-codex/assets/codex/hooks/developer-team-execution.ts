type CodexHookInput = {
  session_id?: unknown;
  turn_id?: unknown;
  cwd?: unknown;
  hook_event_name?: unknown;
};

type BridgeResponse = { accepted: boolean; reason?: string; output?: Record<string, unknown> };

const ALLOWED_EVENTS = new Set(["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "SubagentStart", "SubagentStop", "Stop"]);

export async function forwardCodexTrustedHook(
  value: unknown,
  options: {
    endpoint?: string;
    token?: string;
    post?: (endpoint: string, token: string, body: string) => Promise<BridgeResponse>;
  } = {},
): Promise<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { decision: "block", reason: "invalid-evidence" };
  const input = value as CodexHookInput;
  if (typeof input.session_id !== "string" || !input.session_id || typeof input.cwd !== "string" || !input.cwd || typeof input.hook_event_name !== "string" || !ALLOWED_EVENTS.has(input.hook_event_name)) {
    return { decision: "block", reason: "invalid-evidence" };
  }
  const endpoint = options.endpoint ?? process.env.DECK_CODEX_BRIDGE_ENDPOINT;
  const token = options.token ?? process.env.DECK_CODEX_BRIDGE_TOKEN;
  if (!endpoint || !token) return { decision: "block", reason: "modification-not-authorized:AUTHZ_PROVIDER_MISSING" };
  const post = options.post ?? (async (url, bearer, body) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" || (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost")) throw new Error("invalid bridge endpoint");
    const response = await fetch(parsed, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body });
    if (!response.ok) throw new Error("bridge rejected request");
    return await response.json() as BridgeResponse;
  });
  try {
    const result = await post(endpoint, token, JSON.stringify(input));
    if (!result.accepted) return { decision: "block", reason: result.reason ?? "modification-not-authorized" };
    return result.output ?? {};
  } catch {
    return { decision: "block", reason: "invalid-evidence" };
  }
}

if (import.meta.main) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of Bun.stdin.stream()) {
    size += chunk.byteLength;
    if (size > 1024 * 1024) throw new Error("hook input too large");
    chunks.push(chunk);
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks));
  const output = await forwardCodexTrustedHook(JSON.parse(text));
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
