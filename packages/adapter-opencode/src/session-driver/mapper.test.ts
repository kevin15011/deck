import { describe, expect, test } from "bun:test";
import { OpenCodeEventMapper, mapOpenCodeEvent } from "./mapper";

const updated = (part: Record<string, unknown>) => ({ type: "message.part.updated", properties: { part: { messageID: "m1", ...part } } });
const delta = (partID: string, text: string) => ({ type: "message.part.delta", properties: { messageID: "m1", partID, field: "text", delta: text } });

describe("OpenCode normalized activity", () => {
  test("reasoning snapshots carry stable identity and cumulative format", () => {
    expect(mapOpenCodeEvent(updated({ id: "r1", type: "reasoning", text: "Inspect" }))[0]!.data).toMatchObject({ messageId: "m1", partId: "r1", format: "snapshot", reasoningKind: "text", text: "Inspect" });
  });
  test("per-driver part classification keeps reasoning deltas out of chat and preserves text streaming", () => {
    const mapper = new OpenCodeEventMapper();
    expect(mapper.map(delta("r1", "unknown first"))[0]!.kind).toBe("runner.unmapped");
    mapper.map(updated({ id: "r1", type: "reasoning", text: "Inspect" }));
    expect(mapper.map(delta("r1", " source"))[0]).toMatchObject({ kind: "reasoning.delta", data: { messageId: "m1", partId: "r1", format: "delta", reasoningKind: "text", text: " source" } });
    mapper.map(updated({ id: "t1", type: "text", text: "" }));
    expect(mapper.map(delta("t1", "Reply"))[0]).toMatchObject({ kind: "message.delta", data: { text: "Reply", messageId: "m1" } });
    expect(new OpenCodeEventMapper().map(delta("t1", "Other session"))[0]!.kind).toBe("runner.unmapped");
    expect(mapper.map({ ...delta("r1", "Other message"), properties: { ...delta("r1", "Other message").properties, messageID: "m2" } })[0]!.kind).toBe("runner.unmapped");
  });
  test("tool updates retain input and failed status with bounded sanitized details", () => {
    const tool = (state: Record<string, unknown>) => updated({ id: "p1", type: "tool", callID: "c1", tool: "skill", state });
    expect(mapOpenCodeEvent(tool({ status: "running", input: { name: "frontend" } }))[0]!.data).toMatchObject({ toolUseId: "c1", name: "skill", input: { name: "frontend" }, status: "running" });
    const failed = mapOpenCodeEvent(tool({ status: "error", input: { token: "synthetic-input" }, error: "Authorization: Bearer synthetic-output" }))[0]!;
    expect(failed.data).toMatchObject({ status: "failed", isError: true });
    expect(JSON.stringify(failed.data)).not.toContain("synthetic-input");
    expect(JSON.stringify(failed.data)).not.toContain("synthetic-output");
    const big = mapOpenCodeEvent(tool({ status: "completed", output: "x".repeat(100000) }))[0]!;
    expect(String(big.data.output).length).toBeLessThanOrEqual(8192);
    const thought = mapOpenCodeEvent(updated({ id: "r1", type: "reasoning", text: "token=synthetic-thought\u001b[31m" }))[0]!;
    expect(thought.data.text).not.toContain("synthetic-thought");
    expect(thought.data.text).not.toContain("\u001b");
  });
});
