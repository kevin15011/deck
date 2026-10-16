import { describe, expect, test } from "bun:test";
import { CodexRpc } from "./rpc";

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

test.each([false, true])("keeps the default 1 MiB frame bound, including split frames (%s)", async split => {
  const rpc = new CodexRpc(() => {}, () => {});
  const pending = rpc.call("thread/resume", {}).catch((error: Error) => error.message);
  const frame = JSON.stringify({ id: 1, result: { text: "x".repeat(1024 * 1024) } }) + "\n";
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
