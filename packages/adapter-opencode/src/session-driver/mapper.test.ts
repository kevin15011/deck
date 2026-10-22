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


describe("question tool answer privacy", () => {
  const answer = "PRIVATE_ANSWER_SENTINEL";
  for (const status of ["completed", "error", "running", "pending", "unknown"]) {
    test(`${status} question parts omit all answer-bearing fields and raw payloads`, () => {
      const events = mapOpenCodeEvent(updated({
        id: "p-question", type: "tool", tool: "question", callID: "c-question",
        state: {
          status,
          input: { questions: [{ question: "Choose", header: "Choice", options: [{ label: "Yes", description: "Proceed" }] }], answers: [[answer]] },
          output: `User has answered your questions: "Choose"="${answer}". You can now continue with the user answers in mind.`,
          error: answer, metadata: { answers: [[answer]] }, title: answer,
          time: { start: 1, end: 2 },
        },
      }));
      expect(JSON.stringify(events)).not.toContain(answer);
      expect(events).toHaveLength(1);
      expect(events[0]!.raw).toBeUndefined();
      if (["running", "completed", "error"].includes(status)) {
        expect(events[0]).toMatchObject({
          kind: status === "running" ? "tool.started" : "tool.completed",
          data: { toolUseId: "c-question", name: "question", status: status === "error" ? "failed" : status },
        });
        expect(events[0]!.data).not.toHaveProperty("input");
        expect(events[0]!.data).not.toHaveProperty("output");
      }
    });
  }
  test("question parts without state cannot leak through the unmapped fallback", () => {
    const events = mapOpenCodeEvent(updated({ type: "tool", tool: "question", metadata: { answers: [[answer]] }, title: answer }));
    expect(JSON.stringify(events)).not.toContain(answer);
  });
  test("known question part deltas omit raw answers for every field", () => {
    const mapper = new OpenCodeEventMapper();
    mapper.map(updated({ id: "q1", type: "tool", tool: "question", callID: "cq", state: { status: "running" } }));
    for (const field of ["text", "input", "output", "metadata", "title", "error"]) {
      const events = mapper.map({ ...delta("q1", answer), properties: { ...delta("q1", answer).properties, field } });
      expect(JSON.stringify(events)).not.toContain(answer);
      expect(events[0]!.raw).toBeUndefined();
    }
  });
  test("unclassified deltas and tool updates never capture answers", () => {
    const mapper = new OpenCodeEventMapper();
    for (const field of ["text", "input", "output", "metadata", "title", "error"]) {
      expect(JSON.stringify(mapper.map({ type: "message.part.delta", properties: { messageID: "m1", partID: "q1", field, delta: answer } }))).not.toContain(answer);
    }
    for (const status of ["running", "completed", "error", "pending"]) {
      expect(JSON.stringify(mapper.map(updated({ id: "q1", type: "tool", state: { status, input: answer, output: answer, metadata: answer, title: answer, error: answer } })))).not.toContain(answer);
    }
    mapper.map(updated({ id: "q1", type: "tool", tool: "question" }));
  });
  test("evicted question classifications remain safe for deltas and partial updates", () => {
    const mapper = new OpenCodeEventMapper();
    mapper.map(updated({ id: "q1", type: "tool", tool: "question" }));
    for (let i = 0; i < 1024; i++) mapper.map(updated({ id: `p${i}`, type: "text", text: "" }));
    for (const field of ["text", "output"]) {
      expect(JSON.stringify(mapper.map({ type: "message.part.delta", properties: { messageID: "m1", partID: "q1", field, delta: answer } }))).not.toContain(answer);
    }
    expect(JSON.stringify(mapper.map(updated({ id: "q1", type: "tool", state: { status: "completed", output: answer } })))).not.toContain(answer);
  });
  test("partial updates preserve question classification before and after the tool name arrives", () => {
    const mapper = new OpenCodeEventMapper();
    const partial = updated({ id: "q1", type: "tool", callID: "cq", state: { status: "completed", input: answer, output: answer, metadata: answer, title: answer, error: answer } });
    expect(JSON.stringify(mapper.map(partial))).not.toContain(answer);
    mapper.map(updated({ id: "q1", type: "tool", tool: "question" }));
    const events = mapper.map(partial);
    expect(JSON.stringify(events)).not.toContain(answer);
    expect(events[0]).toMatchObject({ kind: "tool.completed", data: { name: "question", status: "completed" } });
    expect(JSON.stringify(mapper.map(delta("q1", answer)))).not.toContain(answer);
  });
  for (const tool of ["bash", "read", "edit", "mcp__context7__query-docs"]) {
    test(`${tool} unnamed completion inherits the ordinary tool decision`, () => {
      const mapper = new OpenCodeEventMapper();
      mapper.map(updated({ id: "ordinary", type: "tool", tool, callID: "c1", state: { status: "running", input: { path: "file" } } }));
      const raw = updated({ id: "ordinary", type: "tool", callID: "c1", state: { status: "completed", output: "ORDINARY_RESULT" } });
      const events = mapper.map(raw);
      expect(events[0]).toMatchObject({ kind: "tool.completed", data: { output: "ORDINARY_RESULT", status: "completed" } });
      expect(events[0]!.raw).toBe(raw);
      expect(mapper.map(delta("ordinary", "ordinary delta"))[0]!.raw).toBeDefined();
    });
  }
  test("ordinary tool lifecycles and deltas retain normal payloads", () => {
    const mapper = new OpenCodeEventMapper();
    for (const tool of ["bash", "read"]) {
      for (const status of ["running", "completed"]) {
        const raw = updated({ id: tool, type: "tool", tool, callID: tool, state: { status, input: { path: "file" }, output: "ordinary output" } });
        expect(mapper.map(raw)[0]).toMatchObject({ kind: status === "running" ? "tool.started" : "tool.completed", raw, data: { name: tool, status } });
      }
      const raw = delta(tool, "ordinary delta");
      expect(mapper.map(raw)[0]!.raw).toBe(raw);
    }
  });
  test("other tools retain completion output and raw payload", () => {
    const raw = updated({ type: "tool", tool: "bash", callID: "c-bash", state: { status: "completed", input: { command: "pwd" }, output: "unchanged output" } });
    const events = mapOpenCodeEvent(raw);
    expect(events[0]!.data.output).toBe("unchanged output");
    expect(events[0]!.raw).toBe(raw);
  });
});


test('OpenCode context matches the native positive-output assistant sum, not input alone', () => {
  const info = { role: 'assistant', sessionID: 's', parentID: 'u', providerID: 'p', modelID: 'm', tokens: { input: 100, output: 10, reasoning: 5, cache: { read: 80, write: 20 } } };
  const map = (patch = {}) => mapOpenCodeEvent({ type: 'message.updated', properties: { info: { ...info, ...patch } } })[0].data;
  expect(map()).toMatchObject({ input: 100, output: 10, cache: { read: 80, write: 20 }, context: { basis: 'opencode-assistant-context', tokens: 215, capacity: null, modelId: 'p/m' } });
  expect(map({ summary: true }).context).toBeUndefined();
  for (const output of [0, -1, NaN, Infinity, undefined]) expect(map({ tokens: { ...info.tokens, output } }).context).toBeUndefined();
  for (const input of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER, undefined]) expect(map({ tokens: { ...info.tokens, input } }).context).toMatchObject({ tokens: null });
});
