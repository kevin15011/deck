import { afterEach, expect, test } from "bun:test";
import { createDeckMemoryExtension } from "./extension";
import { clearPublishedMemoryHandoff } from "../shared/memory-handoff";
afterEach(clearPublishedMemoryHandoff);

// Protects native child ownership, short corrections, lossless segmentation, and no private block ingestion.
test("child captures its own public turn and complete oversized final, never aggregate-only continuations", async () => {
  const handlers: Record<string, Function> = {};
  const events: any[] = [];
  createDeckMemoryExtension({ env: { DECK_PI_CHILD: "1", DECK_PI_ROLE: "apply-fast", DECK_RUNNER_MEMORY_ENDPOINT: "http://127.0.0.1:1", DECK_RUNNER_MEMORY_TOKEN_FILE: "/fake" }, readFile: () => "fake",
    fetchImpl: (async (_url, init) => { events.push(JSON.parse(String(init?.body))); return Response.json({ ok: true, diagnostics: [] }); }) as typeof fetch,
  })({ on: (name: string, fn: Function) => { handlers[name] = fn; }, registerTool: () => {} } as never);
  const ctx = { sessionManager: { getSessionId: () => "child" } };
  await handlers.before_agent_start!({ prompt: "Blue.", systemPrompt: "PRIVATE_ADVISORY" }, ctx);
  const final = "🟦".repeat(20000) + "TAIL";
  handlers.turn_end!({ message: { role: "assistant", content: [{ type: "thinking", thinking: "PRIVATE_REASONING" }, { type: "text", text: final }] } }, ctx);
  await handlers.agent_end!({}, ctx);
  await handlers.session_shutdown!({ reason: "quit" }, ctx);
  const captured = events.filter(e => e.event === "capture");
  expect(captured[0]).toMatchObject({ role: "apply-fast", source: "trusted-user-prompt", content: "Blue." });
  expect(captured.filter(e => e.source === "trusted-final-assistant").map(e => e.content).join("")).toBe(final);
  expect(captured.every(e => Buffer.byteLength(e.content) <= 60 * 1024)).toBe(true);
  expect(JSON.stringify(captured)).not.toContain("PRIVATE_");
  const count = captured.length;
  handlers.turn_end!({ message: { role: "assistant", content: [{ type: "text", text: "Aggregate only" }] } }, ctx);
  await handlers.agent_end!({}, ctx);
  expect(events.filter(e => e.event === "capture")).toHaveLength(count);
});
