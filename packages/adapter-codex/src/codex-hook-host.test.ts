import { expect, test } from "bun:test";
import { createCodexTrustedHookHostV1 } from "./codex-hook-host";

test("Codex hook host validates route identity, bearer authority, and replay before bridge effects", async () => {
  let effects = 0;
  const host = createCodexTrustedHookHostV1({
    projectRoot: "/project",
    bearerToken: "external-bridge-token",
    bridge: { runnerId: "codex", capabilities: { invocationAuthorizationV1: true, perExecutionDossierV1: true, targetedRepairCapabilityV1: true }, execute: async () => { effects += 1; return { schema: "developer-team-host-execution-result-v1", runnerId: "codex", executionId: "x", code: "executed", effect: { invoked: true } }; } },
    resolveExecutionEvent: async () => ({ trusted: true }),
  });
  const request = { authorization: "Bearer external-bridge-token", body: JSON.stringify({ session_id: "s", turn_id: "t", hook_event_name: "PreToolUse", cwd: "/project", tool_use_id: "tool-1" }) };
  expect(await host.handle(request)).toEqual({ accepted: true, output: {} });
  expect(effects).toBe(1);
  expect(await host.handle(request)).toMatchObject({ accepted: false, reason: expect.stringContaining("REPLAY") });
  expect(await host.handle({ ...request, authorization: "Bearer tampered" })).toMatchObject({ accepted: false, reason: expect.stringContaining("AUTHZ_INVALID") });
  expect(await host.handle({ ...request, body: JSON.stringify({ session_id: "s2", hook_event_name: "PreToolUse", cwd: "/other" }) })).toMatchObject({ accepted: false, reason: "invalid-evidence" });
  expect(effects).toBe(1);
});
