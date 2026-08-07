import { expect, test } from "bun:test";
import { forwardCodexTrustedHook } from "../assets/codex/hooks/developer-team-execution";

const event = { session_id: "session-1", turn_id: "turn-1", cwd: "/project", hook_event_name: "PreToolUse" };

test("trusted Codex hook forwards only bounded released lifecycle events", async () => {
  let calls = 0;
  const output = await forwardCodexTrustedHook(event, {
    endpoint: "http://127.0.0.1:43127/hook",
    token: "external-one-use-token",
    post: async (_endpoint, token, body) => {
      calls += 1;
      expect(token).toBe("external-one-use-token");
      expect(JSON.parse(body)).toEqual(event);
      return { accepted: true, output: { hookSpecificOutput: { hookEventName: "PreToolUse" } } };
    },
  });
  expect(calls).toBe(1);
  expect(output).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse" } });
});

test("invalid, tampered, and authority-free hook inputs reject with zero effects", async () => {
  let calls = 0;
  const post = async () => { calls += 1; return { accepted: true }; };
  expect(await forwardCodexTrustedHook({ ...event, hook_event_name: "PromptClaimedAuthority" }, { endpoint: "http://127.0.0.1", token: "token", post })).toMatchObject({ decision: "block" });
  expect(await forwardCodexTrustedHook({ ...event, session_id: "" }, { endpoint: "http://127.0.0.1", token: "token", post })).toMatchObject({ decision: "block" });
  expect(await forwardCodexTrustedHook(event, { post })).toMatchObject({ decision: "block", reason: expect.stringContaining("AUTHZ_PROVIDER_MISSING") });
  expect(calls).toBe(0);
});
