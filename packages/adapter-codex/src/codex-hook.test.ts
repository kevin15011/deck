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
      expect(JSON.parse(body)).toMatchObject({ schema: "deck-runner-memory-loopback-v1", runnerId: "codex", sessionId: "session-1", event: "role_start", eventId: expect.any(String), timestamp: expect.any(Number) });
      return { accepted: true, output: { hookSpecificOutput: { hookEventName: "PreToolUse" } } };
    },
  });
  expect(calls).toBe(1);
  expect(output).toEqual({ hookSpecificOutput: { hookEventName: "PreToolUse" } });
});

test("Codex memory hook injects advisory through official hookSpecificOutput additionalContext", async () => {
  const output = await forwardCodexTrustedHook({ ...event, hook_event_name: "UserPromptSubmit", prompt: "Remember that Codex recall is native." }, {
    endpoint: "http://127.0.0.1:43127/hook",
    token: "external-one-use-token",
    post: async () => ({ ok: true, advisoryText: "<DECK_ADAPTIVE_CONTEXT_JSON_V1>safe</DECK_ADAPTIVE_CONTEXT_JSON_V1>" }),
  });
  expect(output).toEqual({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: expect.stringContaining("DECK_ADAPTIVE_CONTEXT_JSON_V1") } });
  expect(output).not.toHaveProperty("deckAdaptiveMemoryContext");
});

test("invalid, tampered, and authority-free hook inputs reject with zero effects", async () => {
  let calls = 0;
  const post = async () => { calls += 1; return { accepted: true }; };
  expect(await forwardCodexTrustedHook({ ...event, hook_event_name: "PromptClaimedAuthority" }, { endpoint: "http://127.0.0.1", token: "token", post })).toMatchObject({ decision: "block" });
  expect(await forwardCodexTrustedHook({ ...event, session_id: "" }, { endpoint: "http://127.0.0.1", token: "token", post })).toMatchObject({ decision: "block" });
  expect(await forwardCodexTrustedHook(event, { post })).toEqual({});
  expect(calls).toBe(0);
});

test("Codex memory hook fails open for ineligible ordinary prompt and provider failures", async () => {
  const ineligible = await forwardCodexTrustedHook({ ...event, hook_event_name: "UserPromptSubmit", prompt: "continue" }, {
    endpoint: "http://127.0.0.1:43127/hook",
    token: "external-one-use-token",
    post: async () => ({ ok: false, reason: "trivial_operational_text" }),
  });
  expect(ineligible).toEqual({});

  const providerFailure = await forwardCodexTrustedHook({ ...event, hook_event_name: "SessionStart", prompt: "current task" }, {
    endpoint: "http://127.0.0.1:43127/hook",
    token: "external-one-use-token",
    post: async () => { throw new Error("provider down"); },
  });
  expect(providerFailure).toEqual({});
});

test("Codex memory hook blocks explicit memory dependency failures only", async () => {
  await expect(forwardCodexTrustedHook({ ...event, hook_event_name: "UserPromptSubmit", prompt: "remember: Important limitation: retry this failed provider write." }, {
    endpoint: "http://127.0.0.1:43127/hook",
    token: "external-one-use-token",
    post: async () => ({ ok: false, reason: "provider_error" }),
  })).resolves.toMatchObject({ decision: "block" });
});
