import { loadPreparedSessionStartRecord } from "@deck/core/session/start-context";
import { CODEX_ROOT_LEAD_BOOTSTRAP } from "../../../src/role-bootstrap";

type CodexHookInput = {
  session_id?: unknown;
  cwd?: unknown;
  hook_event_name?: unknown;
  source?: unknown;
  agent_id?: unknown;
  agent_type?: unknown;
};

const ALLOWED_EVENTS = new Set(["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "SubagentStart", "SubagentStop", "Stop"]);

export async function forwardCodexTrustedHook(
  value: unknown,
  options: {
    readiness?: boolean;
    environment?: Readonly<Record<string, string | undefined>>;
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
  return readiness ? withAdditionalContext({}, input.hook_event_name, readiness) : {};
}

function withAdditionalContext(output: Record<string, unknown>, hookEventName: unknown, additionalContext: string): Record<string, unknown> {
  const prior = output.hookSpecificOutput && typeof output.hookSpecificOutput === "object" && !Array.isArray(output.hookSpecificOutput)
    ? output.hookSpecificOutput as Record<string, unknown>
    : {};
  return { ...output, hookSpecificOutput: { ...prior, hookEventName, additionalContext: [prior.additionalContext, additionalContext].filter(text => typeof text === "string" && text).join("\n\n") } };
}
