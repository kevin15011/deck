import { createHash, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import type { DeveloperTeamRunnerHostBridgeV1 } from "@deck/sdd-runtime";

export type CodexTrustedHookInputV1 = Readonly<{
  session_id: string;
  turn_id?: string;
  hook_event_name: "SessionStart" | "UserPromptSubmit" | "PreToolUse" | "PermissionRequest" | "PostToolUse" | "SubagentStart" | "SubagentStop" | "Stop";
  cwd: string;
  tool_use_id?: string;
}>;

export type CodexHookHostRequestV1 = Readonly<{ authorization: string | undefined; body: string }>;
export type CodexHookHostResponseV1 = Readonly<{ accepted: boolean; reason?: string; output?: Readonly<Record<string, unknown>> }>;

function digest(value: string): Buffer { return createHash("sha256").update(value).digest(); }

function normalizeCodexHookInput(value: unknown): Partial<CodexTrustedHookInputV1> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  if (record.schema === "deck-runner-memory-loopback-v1" && record.runnerId === "codex" && record.rawHook && typeof record.rawHook === "object" && !Array.isArray(record.rawHook)) {
    return record.rawHook as Partial<CodexTrustedHookInputV1>;
  }
  return record as Partial<CodexTrustedHookInputV1>;
}

export function createCodexTrustedHookHostV1(options: {
  projectRoot: string;
  bearerToken: string;
  bridge: DeveloperTeamRunnerHostBridgeV1;
  resolveExecutionEvent(input: CodexTrustedHookInputV1): unknown | Promise<unknown>;
}) {
  if (options.bearerToken.length < 16 || /[\0\r\n]/.test(options.bearerToken)) throw new Error("Invalid Codex bridge bearer token.");
  const expectedAuthorization = `Bearer ${options.bearerToken}`;
  const consumed = new Set<string>();

  return Object.freeze({
    async handle(request: CodexHookHostRequestV1): Promise<CodexHookHostResponseV1> {
      const provided = request.authorization ?? "";
      if (!timingSafeEqual(digest(provided), digest(expectedAuthorization))) return { accepted: false, reason: "modification-not-authorized:AUTHZ_INVALID" };
      if (Buffer.byteLength(request.body, "utf8") > 1024 * 1024) return { accepted: false, reason: "invalid-evidence" };
      let input: CodexTrustedHookInputV1;
      try {
        const parsed = normalizeCodexHookInput(JSON.parse(request.body));
        const allowed = new Set(["SessionStart", "UserPromptSubmit", "PreToolUse", "PermissionRequest", "PostToolUse", "SubagentStart", "SubagentStop", "Stop"]);
        if (typeof parsed.session_id !== "string" || !parsed.session_id || typeof parsed.cwd !== "string" || resolve(parsed.cwd) !== resolve(options.projectRoot) || typeof parsed.hook_event_name !== "string" || !allowed.has(parsed.hook_event_name)) throw new Error("invalid");
        if (parsed.turn_id !== undefined && (typeof parsed.turn_id !== "string" || !parsed.turn_id)) throw new Error("invalid");
        input = parsed as CodexTrustedHookInputV1;
      } catch {
        return { accepted: false, reason: "invalid-evidence" };
      }
      const replayKey = JSON.stringify([input.session_id, input.turn_id ?? null, input.tool_use_id ?? null, input.hook_event_name]);
      if (consumed.has(replayKey)) return { accepted: false, reason: "modification-not-authorized:AUTHZ_REPLAY" };
      consumed.add(replayKey);
      let event: unknown;
      try { event = await options.resolveExecutionEvent(Object.freeze({ ...input })); } catch { return { accepted: false, reason: "invalid-evidence" }; }
      const outcome = await options.bridge.execute(event);
      if (!["executed", "shadow-complete", "legacy-complete"].includes(outcome.code)) return { accepted: false, reason: outcome.authorizationCode ? `modification-not-authorized:${outcome.authorizationCode}` : outcome.code };
      return { accepted: true, output: {} };
    },
  });
}
