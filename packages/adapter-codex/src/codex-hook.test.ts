import { expect, test } from "bun:test";
import { forwardCodexTrustedHook } from "../assets/codex/hooks/developer-team-execution";

const event = { session_id: "session-1", cwd: "/project", hook_event_name: "PreToolUse" };

// Protects the shared input boundary after retiring the transport: invalid native data has no effects.
test("invalid and authority-free native hook inputs reject before readiness effects", async () => {
  expect(await forwardCodexTrustedHook({ ...event, hook_event_name: "PromptClaimedAuthority" }, { readiness: false })).toMatchObject({ decision: "block", reason: "invalid-evidence" });
  expect(await forwardCodexTrustedHook({ ...event, session_id: "" }, { readiness: false })).toMatchObject({ decision: "block", reason: "invalid-evidence" });
  expect(await forwardCodexTrustedHook(event, { readiness: false })).toEqual({});
});

// Oracle: obsolete transport-shaped options cannot regain any forwarding or prompt injection effect.
test("non-session hooks never forward prompt content through obsolete transport options", async () => {
  let calls = 0;
  const output = await forwardCodexTrustedHook({ ...event, hook_event_name: "UserPromptSubmit", prompt: "remember this", response: "private output" }, {
    readiness: false, endpoint: "http://127.0.0.1:43127/hook", token: "synthetic-fixture-token",
    post: async () => { calls++; return { ok: true, advisoryText: "must not be injected" }; },
  } as never);
  expect(calls).toBe(0); expect(output).toEqual({});
});
