import { describe, expect, test } from "bun:test";
import { CODEX_MAX_FRAME_BYTES, CodexRpc, CodexRpcFrameError } from "./rpc";

describe("Codex app-server JSONL transport", () => {
  test("correlates interleaved replies, split frames, server requests and notifications", async () => {
    const writes: string[] = [], messages: unknown[] = [];
    const rpc = new CodexRpc((s) => writes.push(s), (m) => messages.push(m));
    const a = rpc.call("one", {}), b = rpc.call("two", {});
    rpc.push('{"id":2,"result":{"ok":2}}\n{"meth');
    rpc.push('od":"future/event","params":{}}\n{"id":"server-1","method":"approval","params":{}}\n{"id":1,"result":{"ok":1}}\n');
    expect(await a).toEqual({ ok: 1 }); expect(await b).toEqual({ ok: 2 });
    expect(messages).toHaveLength(2);
    rpc.reply("server-1", { decision: "decline" });
    expect(JSON.parse(writes[2]!)).toEqual({ id: "server-1", result: { decision: "decline" } });
    rpc.close();
  });
  test("fails all pending requests on invalid framing and bounds an unterminated frame", async () => {
    const rpc = new CodexRpc(() => {}, () => {}, { maxFrameBytes: 20 });
    const call = rpc.call("one", {}).catch((e: Error) => e.message);
    expect(() => rpc.push("x".repeat(21))).toThrow("frame-too-large");
    expect(await call).toContain("frame-too-large");
  });
  test("rejects native errors and closed pending calls", async () => {
    const rpc = new CodexRpc(() => {}, () => {});
    const call = rpc.call("one", {}).catch((e: Error) => e.message);
    rpc.push('{"id":1,"error":{"code":-32602,"message":"invalid params"}}\n');
    expect(await call).toContain("-32602");
    const pending = rpc.call("two", {}).catch((e: Error) => e.message);
    rpc.close(); expect(await pending).toContain("closed");
  });
});

test.each([false, true])("keeps the finite default frame bound, including split frames (%s)", async split => {
  const rpc = new CodexRpc(() => {}, () => {});
  const pending = rpc.call("thread/resume", {}).catch((error: Error) => error.message);
  const frame = JSON.stringify({ id: 1, result: { text: "x".repeat(CODEX_MAX_FRAME_BYTES) } }) + "\n";
  if (split) rpc.push(frame.slice(0, 1024));
  expect(() => rpc.push(split ? frame.slice(1024) : frame)).toThrow("codex-rpc-frame-too-large");
  expect(await pending).toBe("codex-rpc-frame-too-large");
});
test("invalid JSON rejects pending requests with a safe fixed code", async () => {
  const rpc = new CodexRpc(() => {}, () => {});
  const pending = rpc.call("initialize", {}).catch((error: Error) => error.message);
  expect(() => rpc.push('SECRET_FRAME_SENTINEL invalid JSON\n')).toThrow("codex-rpc-invalid-frame");
  expect(await pending).toBe("codex-rpc-invalid-frame");
});

test("admits the exact wire-byte boundary with multibyte and surrogate chunk splits, then valid frames", () => {
  const messages: unknown[] = [];
  const frame = JSON.stringify({ method: "synthetic", params: { text: 'é😀"\\\n' } });
  const rpc = new CodexRpc(() => {}, m => messages.push(m), { maxFrameBytes: Buffer.byteLength(frame) });
  // One code unit per push deliberately divides the emoji surrogate pair.
  for (let i = 0; i < frame.length; i++) rpc.push(frame[i]!);
  rpc.push('\n{"method":"next"}\n');
  expect(messages).toEqual([JSON.parse(frame), { method: "next" }]); rpc.close();
});

test("accepts a frame at the finite default capacity through 64 KiB chunks", () => {
  let completions = 0;
  const rpc = new CodexRpc(() => {}, m => { expect(m.method).toBe("large"); completions++; });
  const shell = JSON.stringify({ method: "large", params: { output: "" } });
  const frame = JSON.stringify({ method: "large", params: { output: "x".repeat(CODEX_MAX_FRAME_BYTES - Buffer.byteLength(shell)) } });
  expect(Buffer.byteLength(frame)).toBe(CODEX_MAX_FRAME_BYTES);
  for (let i = 0; i < frame.length; i += 64 * 1024) rpc.push(frame.slice(i, i + 64 * 1024));
  rpc.push("\n");
  expect(completions).toBe(1); rpc.close();
});

test("counts serialized bytes rather than characters and reports exact versus lower-bound sizes safely", async () => {
  for (const complete of [true, false]) {
    const messages: unknown[] = [];
    const rpc = new CodexRpc(() => {}, m => messages.push(m), { maxFrameBytes: 40 });
    const pending = [rpc.call("one", {}), rpc.call("two", {})].map(p => p.catch(e => e));
    const frame = JSON.stringify({ result: "é".repeat(25) });
    expect(frame.length).toBeLessThanOrEqual(40);
    rpc.push(frame.slice(0, 15));
    let failure: CodexRpcFrameError | undefined;
    try { rpc.push(frame.slice(15) + (complete ? '\n{"id":1,"result":"must not resolve"}\n' : "")); }
    catch (error) { failure = error as CodexRpcFrameError; }
    expect(failure?.size).toEqual({ frameBytes: Buffer.byteLength(frame), frameBytesKind: complete ? "exact" : "lower-bound", maxFrameBytes: 40, pendingCalls: 2 });
    expect(await Promise.all(pending)).toEqual([failure, failure]);
    rpc.push('{"id":2,"result":true}\n');
    expect(messages).toHaveLength(0);
    await expect(rpc.call("later", {})).rejects.toBe(failure);
    rpc.close(); rpc.close();
  }
});

test("bounds frames independently within a coalesced chunk and rejects excessive whitespace", () => {
  const messages: unknown[] = [];
  const rpc = new CodexRpc(() => {}, m => messages.push(m), { maxFrameBytes: 20 });
  rpc.push('{"method":"one"}\n{"method":"two"}\n');
  expect(messages).toHaveLength(2);
  expect(() => rpc.push(" ".repeat(21) + "\n")).toThrow("codex-rpc-frame-too-large");
});

test("closing in a notification callback prevents dispatch of later coalesced control messages", () => {
  const messages: unknown[] = [];
  const rpc = new CodexRpc(() => {}, m => { messages.push(m); rpc.close(); });
  rpc.push('{"method":"stop"}\n{"id":"permission","method":"approval"}\n');
  expect(messages).toEqual([{ method: "stop" }]);
});

test.each(['{"secret":"PRIVATE_PAYLOAD",}\n', '[]\n', 'null\n'])("malformed frames fail closed without dispatching following frames (%s)", async frame => {
  const messages: unknown[] = [];
  const rpc = new CodexRpc(() => {}, m => messages.push(m));
  const pending = rpc.call("one", {}).catch(e => e);
  expect(() => rpc.push(frame + '{"id":1,"result":true}\n')).toThrow("codex-rpc-invalid-frame");
  const error = await pending;
  expect(error instanceof Error ? error.message : undefined).toBe("codex-rpc-invalid-frame");
  expect(messages).toHaveLength(0);
  rpc.close();
});
