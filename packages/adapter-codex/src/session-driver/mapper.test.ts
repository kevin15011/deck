import { describe, expect, test } from "bun:test";
import { mapCodexNotification } from "./mapper";

describe("Codex app-server notification mapping", () => {
  test("maps native terminal outcomes and unknown payloads", () => {
    expect(mapCodexNotification({ method: "turn/completed", params: { turn: { id: "t", status: "interrupted" } } })[0]?.data.status).toBe("interrupted");
    const raw = { method: "future/event", params: { newField: true } };
    expect(mapCodexNotification(raw)[0]).toEqual({ kind: "runner.unmapped", data: { nativeType: "future/event" }, raw });
  });
  test("maps assistant, reasoning, tool, usage and rate limit frames", () => {
    const kinds = [
      ["item/agentMessage/delta", { delta: "hello" }, "message.delta"],
      ["item/reasoning/summaryTextDelta", { delta: "think" }, "reasoning.delta"],
      ["item/started", { item: { id: "x", type: "commandExecution", command: "echo hi" } }, "tool.started"],
      ["item/completed", { item: { id: "x", type: "agentMessage", text: "hello" } }, "message.completed"],
      ["thread/tokenUsage/updated", { tokenUsage: { total: { inputTokens: 3 } } }, "usage"],
      ["account/rateLimits/updated", { rateLimits: {} }, "rate-limit"],
    ] as const;
    for (const [method, params, kind] of kinds) expect(mapCodexNotification({ method, params })[0]?.kind).toBe(kind);
  });
  test("bounds tool result data while retaining its original envelope for host redaction", () => {
    const raw = { method: "item/completed", params: { item: { type: "commandExecution", aggregatedOutput: "x".repeat(100000) } } };
    const event = mapCodexNotification(raw)[0]!;
    expect(JSON.stringify(event.data).length).toBeLessThan(18000);
    expect(event.raw).toBe(raw);
  });
});
