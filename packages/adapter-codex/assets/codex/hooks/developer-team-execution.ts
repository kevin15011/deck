import { loadPreparedSessionStartRecord } from "@deck/core/session/start-context";
import { CODEX_ROOT_LEAD_BOOTSTRAP } from "../../../src/role-bootstrap";

type CodexHookInput = {
  session_id?: unknown;
  turn_id?: unknown;
  cwd?: unknown;
  hook_event_name?: unknown;
  prompt?: unknown;
  text?: unknown;
  message?: unknown;
  response?: unknown;
  tool_input?: unknown;
  source?: unknown;
  agent_id?: unknown;
  agent_type?: unknown;
};

type BridgeResponse = { accepted?: boolean; ok?: boolean; reason?: string; output?: Record<string, unknown>; advisoryText?: string };

const ALLOWED_EVENTS = new Set(["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "SubagentStart", "SubagentStop", "Stop"]);

export async function forwardCodexTrustedHook(
  value: unknown,
  options: {
    endpoint?: string;
    readiness?: boolean;
    token?: string;
    environment?: Readonly<Record<string, string | undefined>>;
    post?: (endpoint: string, token: string, body: string) => Promise<BridgeResponse>;
  } = {},
): Promise<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { decision: "block", reason: "invalid-evidence" };
  const input = value as CodexHookInput;
  if (typeof input.session_id !== "string" || !input.session_id || typeof input.cwd !== "string" || !input.cwd || typeof input.hook_event_name !== "string" || !ALLOWED_EVENTS.has(input.hook_event_name)) {
    return { decision: "block", reason: "invalid-evidence" };
  }
  let readiness: string | undefined;
  if (input.hook_event_name === "SessionStart" && options.readiness !== false) {
    try {
      // Native children use SubagentStart. Never promote a child-shaped or unknown
      // event to root provenance, even if it inherits the parent's environment.
      const nativeSession = input.agent_id === undefined && input.agent_type === undefined
        && typeof input.source === "string" && ["startup", "resume", "compact"].includes(input.source)
        && /^[a-zA-Z0-9_-]{1,128}$/.test(input.session_id)
        ? { sessionId: input.session_id, source: input.source } : undefined;
      const record = await loadPreparedSessionStartRecord(input.cwd as string, options.environment);
      readiness = record?.text;
      if (nativeSession && record?.refresh) {
        // Reuse the authenticated launch endpoint already validated by the shared
        // loader. Keep this Codex-only protocol out of other runners' loaders.
        const endpoint = new URL(record.refresh.endpoint); endpoint.pathname = "/codex-root";
        const response = await fetch(endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(2000), headers: {
          authorization: `Bearer ${record.refresh.token}`, "x-deck-native-session": nativeSession.sessionId, "x-deck-native-source": nativeSession.source,
        } });
        if (response.ok && response.body) {
          const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
          try {
            while (true) { const chunk = await reader.read(); if (chunk.done) break;
              size += chunk.value.length; if (size > 4096) throw new Error("codex-root-context-too-large"); chunks.push(chunk.value); }
          } finally { await reader.cancel(); }
          // Never replay arbitrary text from an old launch or persisted override.
          if (Buffer.concat(chunks).toString("utf8") === CODEX_ROOT_LEAD_BOOTSTRAP) readiness = [readiness, CODEX_ROOT_LEAD_BOOTSTRAP].filter(Boolean).join("\n\n");
        } else await response.body?.cancel();
      }
      if (readiness === undefined) process.stderr.write("deck-preparation: native-snapshot-unavailable\n");
    }
    catch { process.stderr.write("deck-preparation: session-start-context-unverified\n"); }
  }
  const prepared = (output: Record<string, unknown>) => readiness ? withAdditionalContext(output, input.hook_event_name, readiness) : output;
  const endpoint = options.endpoint ?? process.env.DECK_CODEX_BRIDGE_ENDPOINT;
  const token = options.token ?? process.env.DECK_CODEX_BRIDGE_TOKEN;
  if (!endpoint || !token) return prepared({});
  const post = options.post ?? (async (url, bearer, body) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" || (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost")) throw new Error("invalid bridge endpoint");
    const response = await fetch(parsed, { method: "POST", headers: { authorization: `Bearer ${bearer}`, "content-type": "application/json" }, body });
    if (!response.ok) throw new Error("bridge rejected request");
    return await response.json() as BridgeResponse;
  });
  try {
    const result = await post(endpoint, token, JSON.stringify(toLoopbackEvent(input)));
    if ((result.accepted === false || result.ok === false) && isExplicitMemoryEvent(input)) return { decision: "block", reason: result.reason ?? "modification-not-authorized" };
    if (result.advisoryText) return prepared(withAdditionalContext(result.output ?? {}, input.hook_event_name, result.advisoryText));
    return prepared(result.output ?? {});
  } catch {
    return isExplicitMemoryEvent(input) ? { decision: "block", reason: "invalid-evidence" } : prepared({});
  }
}

function withAdditionalContext(output: Record<string, unknown>, hookEventName: unknown, additionalContext: string): Record<string, unknown> {
  const prior = output.hookSpecificOutput && typeof output.hookSpecificOutput === "object" && !Array.isArray(output.hookSpecificOutput)
    ? output.hookSpecificOutput as Record<string, unknown>
    : {};
  return { ...output, hookSpecificOutput: { ...prior, hookEventName, additionalContext: [prior.additionalContext, additionalContext].filter(text => typeof text === "string" && text).join("\n\n") } };
}

function toLoopbackEvent(input: CodexHookInput): Record<string, unknown> {
  const text = typeof input.prompt === "string" ? input.prompt : typeof input.text === "string" ? input.text : textFromMessage(input.message);
  const stable = `${input.session_id}:${input.turn_id ?? "turn"}:${input.hook_event_name}`;
  const base = { schema: "deck-runner-memory-loopback-v1", runnerId: "codex", sessionId: input.session_id, role: "lead", rawHook: input, timestamp: Date.now() };
  if (input.hook_event_name === "SessionStart") return { ...base, eventId: `${stable}:session_start`, event: "session_start", query: text };
  if (input.hook_event_name === "UserPromptSubmit") return { ...base, eventId: `${stable}:user_capture`, event: "capture", source: "trusted-user-prompt", content: text ?? "" };
  if (input.hook_event_name === "SubagentStart" || input.hook_event_name === "PreToolUse") return { ...base, eventId: `${stable}:role_start`, event: "role_start", role: roleFromToolInput(input.tool_input), query: text };
  if (input.hook_event_name === "Stop") {
    const finalText = typeof input.response === "string" ? input.response : textFromMessage(input.message);
    return finalText
      ? { ...base, eventId: `${stable}:assistant_capture`, event: "capture", source: "trusted-final-assistant", content: finalText }
      : { ...base, eventId: `${stable}:shutdown_flush`, event: "shutdown_flush" };
  }
  return { ...base, eventId: `${stable}:recall`, event: "recall", query: text };
}

function isExplicitMemoryEvent(input: CodexHookInput): boolean {
  return input.hook_event_name === "UserPromptSubmit" && /^(?:recall|remember|memorize|save\s+(?:this|to memory))\b/i.test(String(input.prompt ?? input.text ?? ""));
}

function textFromMessage(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as { content?: unknown; text?: unknown };
  if (typeof record.content === "string") return record.content.slice(0, 64 * 1024);
  if (typeof record.text === "string") return record.text.slice(0, 64 * 1024);
  return undefined;
}

function roleFromToolInput(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as { subagent_type?: unknown; agent?: unknown; role?: unknown };
  const role = record.subagent_type ?? record.agent ?? record.role;
  if (role === "deck-apply-fast") return "apply-fast";
  if (role === "deck-apply-deep") return "apply-deep";
  if (role === "deck-quality") return "quality";
  if (role === "deck-setup") return "setup";
  if (role === "deck-investigate") return "investigate";
  if (role === "deck-architect") return "architect";
  return undefined;
}
