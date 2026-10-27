import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DriverApprovalRequest, DriverTaskInput } from "@deck/core/session/driver";
import { createCodexSessionDriver } from "./driver";
import { ISOLATION_FEATURES } from "./launch";
import { FakeChild, harness } from "./test-support";
import { CODEX_MAX_FRAME_BYTES } from "./rpc";
import mcpMemoryApproval from "./__fixtures__/0.162.1/mcp-memory-approval.json";
import overloadIncident from "./__fixtures__/0.162.1/overload-incident.json";

const input: DriverTaskInput = {
  taskId: "task", memberId: "lead", cwd: "/work", assignment: { runnerId: "codex", modelId: "openai-codex/gpt-5", thinking: "high" },
  rolePrompt: "Role instructions", prompt: "hello", mcp: { servers: ["deck"], sessionTools: [] },
  mcpServerSpecs: { deck: { command: "/deck", args: ["internal", "session-mcp"], env: { DECK_SESSION_CREDENTIAL_FILE: "/private/credential" } } },
  approvals: "runner-default", credentialFile: "/private/credential", disableNativeDelegation: true,
};
const config = (isolated: boolean) => ({ features: Object.fromEntries(ISOLATION_FEATURES.map((f) => [f, false])), mcp_servers: {
  foreign: { enabled: true, command: "foreign" },
} });
function responder(child: FakeChild, index: number, m: Record<string, unknown>) {
  const params = m.params as Record<string, unknown>;
  if (m.method === "initialize") child.stdout({ id: m.id, result: {} });
  if (m.method === "config/read") child.stdout({ id: m.id, result: { config: config(index === 2) } });
  if (m.method === "thread/start" || m.method === "thread/resume") child.stdout({ id: m.id, result: { thread: { id: params.threadId ?? "native-thread",historyMode:"legacy" } } });
  if (m.method === "mcpServerStatus/list") child.stdout({ id: m.id, result: { data: [{ name: "deck-session-task-deck", runtimeStatus: "connected" }], nextCursor: null } });
  if (m.method === "turn/start") child.stdout({ id: m.id, result: { turn: { id: "turn" } } });
  if (m.method === "turn/interrupt") { child.stdout({ id: m.id, result: {} }); child.stdout({ method: "turn/completed", params: { threadId: "native-thread", turn: { id: "turn", status: "interrupted" } } }); }
}
const imageDirs: string[] = [];

describe("Codex transport capacity", () => {
  // A separate Bun process must exit cleanly without an unhandledRejection listener.
  // The parent test runner's rejection handling must not mask a leaked callback promise.
  test.each(["transport-pending", "running-rejected", "running-drained", "native-interrupted"])("interruption cleanup has no unhandled rejection: %s", async mode => {
    const script = `
      import assert from "node:assert/strict";
      import { createCodexSessionDriver } from ${JSON.stringify(import.meta.resolve("./driver"))};
      import { harness } from ${JSON.stringify(import.meta.resolve("./test-support"))};
      import { ISOLATION_FEATURES } from ${JSON.stringify(import.meta.resolve("./launch"))};
      const input = ${JSON.stringify(input)};
      const mode = ${JSON.stringify(mode)};
      const h = harness((child, _index, m) => {
        if (m.method === "initialize") child.stdout({ id: m.id, result: {} });
        if (m.method === "config/read") child.stdout({ id: m.id, result: { config: {
          features: Object.fromEntries(ISOLATION_FEATURES.map(f => [f, false])), mcp_servers: {}
        } } });
        if (m.method === "thread/start") child.stdout({ id: m.id, result: { thread: { id: "native-thread", historyMode: "legacy" } } });
        if (m.method === "mcpServerStatus/list") child.stdout({ id: m.id, result: { data: [{ name: "deck-session-task-deck", runtimeStatus: "connected" }], nextCursor: null } });
        if (m.method === "turn/start") child.stdout({ id: m.id, result: { turn: { id: "turn" } } });
        if (m.method === "turn/interrupt") {
          child.stdout({ id: m.id, result: {} });
          if (mode === "native-interrupted") child.stdout({ method: "turn/completed", params: { threadId: "native-thread", turn: { id: "turn", status: "interrupted" } } });
        }
      });
      const task = await createCodexSessionDriver({ escalationMs: 5 }).startTask(input, h.io);
      await task.nativeSessionId; await Promise.resolve();
      const child = h.children.at(-1);
      let release, entered;
      const held = new Promise(r => { release = r; });
      const started = new Promise(r => { entered = r; });
      child.terminateGroup = async () => {
        child.terminations++; entered(); await held;
        if (mode === "transport-pending" || mode === "running-rejected") throw new Error("fixture cleanup rejected");
        child.exit();
      };
      let settled = false;
      void task.done.then(() => { settled = true; });
      await task.interrupt();
      if (mode === "transport-pending") child.stdoutRaw("PRIVATE_BAD_FRAME\\n");
      if (mode.startsWith("running")) await started;
      await Bun.sleep(25);
      assert.equal(settled, mode === "native-interrupted");
      assert.equal(child.terminations, mode === "native-interrupted" ? 0 : 1);
      release();
      const outcome = await task.done;
      if (mode === "transport-pending") assert.deepEqual(outcome, { status: "failed", error: "codex-rpc-invalid-frame", failure: { category: "deck", origin: "deck", certainty: "reported", code: "codex-rpc-invalid-frame" } });
      else assert.deepEqual(outcome, { status: mode === "native-interrupted" ? "interrupted" : "interrupted-forced" });
      const firstClose = task.close();
      assert.equal(task.close(), firstClose);
      if (mode === "transport-pending" || mode === "running-rejected") {
        await assert.rejects(firstClose, /fixture cleanup rejected/);
        await assert.rejects(task.close(), /fixture cleanup rejected/);
      } else { await firstClose; await task.close(); }
      assert.equal(h.events.filter(e => e.kind === "turn.completed").length, 1);
      assert.equal(JSON.stringify(h.events).includes("PRIVATE_BAD_FRAME"), false);
      child.exit();
      await Bun.sleep(25);
      console.log("cleanup probe passed");
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, stderr }).toEqual({ code: 0, stderr: "" });
    expect(stdout.trim()).toBe("cleanup probe passed");
  });

  test('Codex transport failure retains cleanup rejection through repeated close', async () => {
    const h=harness(responder);
    const task=await createCodexSessionDriver().startTask(input,h.io);await task.nativeSessionId;await Promise.resolve();
    const child=h.children.at(-1)!;let release!:()=>void;
    const held=new Promise<void>(r=>{release=r;});
    child.terminateGroup=async()=>{await held;throw new Error('fixture cleanup rejected');};
    try {
      child.stdoutRaw('PRIVATE_BAD_FRAME\n');release();
      expect(await task.done).toEqual({status:'failed',error:'codex-rpc-invalid-frame',failure:{category:'deck',origin:'deck',certainty:'reported',code:'codex-rpc-invalid-frame'}});
      await expect(task.close()).rejects.toThrow('fixture cleanup rejected');
      await expect(task.close()).rejects.toThrow('fixture cleanup rejected');
      expect(JSON.stringify(h.events)).not.toContain('PRIVATE_BAD_FRAME');
    } finally {release();child.exit();}
  });

  test("preserves >1 MiB escaped command completion, exit status, and subsequent permission correlation", async () => {
    const h = harness(responder);
    const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io);
    try {
      await task.nativeSessionId; await Promise.resolve();
      const child = h.children.at(-1)!;
      const item = { id: "large-command", type: "commandExecution", command: "synthetic", cwd: "/work", status: "completed", exitCode: 7, durationMs: 12, aggregatedOutput: 'é😀"\\\n'.repeat(180_000) };
      child.stdout({ method: "item/started", params: { threadId: "native-thread", turnId: "turn", item: { ...item, aggregatedOutput: null, status: "inProgress", exitCode: null } } });
      const frame = JSON.stringify({ method: "item/completed", params: { threadId: "native-thread", turnId: "turn", item } }) + "\n";
      expect(Buffer.byteLength(frame)).toBeGreaterThan(1024 * 1024);
      for (let offset = 0; offset < frame.length; offset += 8191) child.stdoutRaw(frame.slice(offset, offset + 8191));
      child.stdout(mcpMemoryApproval); await Promise.resolve(); await Promise.resolve();
      expect(child.writes.find(m => m.id === 0)?.result).toMatchObject({ action: "decline" });
      child.stdout({ method: "turn/completed", params: { threadId: "native-thread", turn: { id: "turn", status: "completed" } } });
      expect(await task.done).toEqual({ status: "completed" });
      expect(h.events.find(e => e.kind === "tool.completed")?.data).toMatchObject({ toolCallId: "large-command", nativeThreadId: "native-thread", nativeTurnId: "turn", status: "failed", exitCode: 7, durationMs: 12 });
      expect(String(h.events.find(e => e.kind === "tool.completed")!.data.output).length).toBeLessThanOrEqual(16 * 1024);
      expect(child.terminations).toBe(0);
      expect(child.writes.filter(m => m.method === "turn/start")).toHaveLength(1);
    } finally { await task.close(); }
    expect(h.children[0]!.terminations).toBe(1);
  });
  test("correlates a large pending resume-shaped reply without replacing native identity or replaying", async () => {
    const h = harness((child, index, m) => {
      if (m.method === "thread/resume") {
        expect(m.params).toMatchObject({ threadId: "saved", excludeTurns: true });
        child.stdout({ id: m.id, result: { thread: { id: "saved", historyMode: "legacy", turns: [{ id: "prior", items: [{ type: "commandExecution", aggregatedOutput: "x".repeat(1_200_000) }] }] } } });
      } else responder(child, index, m);
    });
    const task = await createCodexSessionDriver().startTask({ ...input, resume: { nativeSessionId: "saved" } }, h.io);
    try {
      expect(await task.nativeSessionId).toBe("saved"); await Promise.resolve();
      const child = h.children[0]!;
      child.stdout({ method: "turn/completed", params: { threadId: "saved", turn: { id: "turn", status: "completed" } } });
      expect(await task.done).toEqual({ status: "completed" });
      expect(child.writes.filter(m => m.method === "thread/resume")).toHaveLength(1);
      expect(child.writes.some(m => m.method === "thread/start")).toBe(false);
      expect(child.terminations).toBe(0);
    } finally { await task.close(); }
  });
});

test('usage belongs to exact live native turn; post-compaction counters remain raw usage only', async () => {
  const h = harness(responder); const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId; await Promise.resolve();
  const child = h.children.at(-1)!;
  const usage = (patch = {}) => child.stdout({ method: 'thread/tokenUsage/updated', params: { threadId: 'native-thread', turnId: 'turn', tokenUsage: { last: { totalTokens: 100, cachedInputTokens: 90 }, total: { totalTokens: 90000 }, modelContextWindow: 200 }, ...patch } });
  usage({ threadId: 'foreign' }); usage({ turnId: 'old' }); usage({ turnId: undefined });
  expect(h.events.filter(e => e.kind === 'usage')).toHaveLength(0);
  usage(); expect(h.events.filter(e => e.kind === 'usage').at(-1)?.data.context).toMatchObject({ tokens: 100, capacity: 200 });
  for (const method of ['item/started', 'item/completed']) child.stdout({ method, params: { threadId: 'native-thread', turnId: 'turn', item: { id: 'compaction', type: 'contextCompaction' } } });
  usage(); expect(h.events.filter(e => e.kind === 'usage').at(-1)?.data.context).toBeUndefined();
  expect(h.events.filter(e => e.kind === 'usage').at(-1)?.data.last).toEqual({ totalTokens: 100, cachedInputTokens: 90 });
  child.stdout({ method: 'turn/completed', params: { threadId: 'native-thread', turn: { id: 'turn', status: 'completed' } } }); await task.done;
  const count = h.events.filter(e => e.kind === 'usage').length; usage();
  expect(h.events.filter(e => e.kind === 'usage')).toHaveLength(count); await task.close();
});

describe("P012 Codex failure outcomes", () => {
  test("the observed overload incident reaches the terminal outcome", async () => {
    const h = harness(responder); const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId; await Promise.resolve();
    const child = h.children.at(-1)!; child.stdout(overloadIncident.notification); child.stdout(overloadIncident.terminal);
    expect(await task.done).toEqual({ status: "failed", failure: { category: "provider-overloaded", origin: "provider", certainty: "reported", code: "serverOverloaded" } }); await task.close();
  });
  const overloaded = { codexErrorInfo: "serverOverloaded", message: "Selected model at capacity. PRIVATE_SENTINEL", additionalDetails: "PRIVATE_SENTINEL" };
  const scope = { threadId: "native-thread", turnId: "turn" };
  async function started() {
    const h = harness(responder); const task = await createCodexSessionDriver().startTask(input, h.io);
    await task.nativeSessionId; await Promise.resolve();
    const child = h.children.at(-1)!;
    return { h, task, child, notify: (patch: Record<string, unknown> = {}) => child.stdout({ method: "error", params: { ...scope, willRetry: false, error: overloaded, ...patch } }),
      complete: (status = "failed", error?: unknown, threadId: string | undefined = scope.threadId) => child.stdout({ method: "turn/completed", params: { threadId, turn: { id: scope.turnId, status, error } } }) };
  }
  test("terminal result evidence wins over a different notification and never copies native prose", async () => {
    const t = await started(); t.notify(); t.complete("failed", { codexErrorInfo: "usageLimitExceeded", message: "PRIVATE_SENTINEL" });
    const outcome = await t.task.done;
    expect(outcome).toMatchObject({ status: "failed", failure: { category: "quota", origin: "provider", code: "usageLimitExceeded" } });
    expect(JSON.stringify(outcome)).not.toContain("PRIVATE_SENTINEL"); await t.task.close();
  });
  test.each([undefined, null, { message: "unclassified terminal detail" }])("matching nonretrying notification supplies a missing terminal category (%j)", async error => {
    const t = await started(); t.notify(); t.complete("failed", error);
    expect(await t.task.done).toEqual({ status: "failed", failure: { category: "provider-overloaded", origin: "provider", certainty: "reported", code: "serverOverloaded" } }); await t.task.close();
  });
  test("valid but unknown result evidence takes precedence over an earlier overload", async () => {
    const t = await started(); t.notify(); t.complete("failed", { codexErrorInfo: "other", message: "PRIVATE_SENTINEL" });
    expect(await t.task.done).toEqual({ status: "failed", failure: { category: "unknown", origin: "unknown", certainty: "inferred" } }); await t.task.close();
  });
  test.each([{ threadId: "foreign" }, { turnId: "old" }, { threadId: undefined }, { turnId: undefined }, { willRetry: undefined }])("ignores uncorrelated notification fallback (%j)", async patch => {
    const t = await started(); t.notify(patch); t.complete();
    expect((await t.task.done).failure).toEqual({ category: "unknown", origin: "unknown", certainty: "inferred" }); await t.task.close();
  });
  test("native retry never settles the turn and clears a superseded nonretrying error", async () => {
    const t = await started(); let settled = false; void t.task.done.then(() => { settled = true; });
    t.notify(); t.notify({ willRetry: true }); await Promise.resolve(); expect(settled).toBe(false);
    t.complete(); expect((await t.task.done).failure?.category).toBe("unknown"); await t.task.close();
  });
  test.each(["completed", "interrupted"])("%s never inherits a failure, including erroneous terminal details", async status => {
    const t = await started(); t.notify(); t.complete(status, overloaded);
    expect(await t.task.done).toEqual({ status: status as "completed" | "interrupted" }); await t.task.close();
  });
  test("a requested interruption drops failure metadata even if native completion reports failed", async () => {
    const h = harness((child, index, m) => { if (m.method === "turn/interrupt") child.stdout({ id: m.id, result: {} }); else responder(child, index, m); });
    const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId; await Promise.resolve();
    const child = h.children.at(-1)!; child.stdout({ method: "error", params: { ...scope, willRetry: false, error: overloaded } });
    await task.interrupt(); child.stdout({ method: "turn/completed", params: { threadId: scope.threadId, turn: { id: scope.turnId, status: "failed", error: overloaded } } });
    expect((await task.done).failure).toBeUndefined(); await task.close();
  });
  test("forced close cannot inherit a pending failure", async () => {
    const t = await started(); t.notify(); await t.task.close();
    expect(await t.task.done).toEqual({ status: "interrupted-forced" });
  });
  test("an error received before native turn identity is known cannot seed a later terminal", async () => {
    const h = harness((child, index, m) => { if (m.method !== "turn/start") responder(child, index, m); });
    const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId;
    const child = h.children.at(-1)!;
    child.stdout({ method: "error", params: { ...scope, willRetry: false, error: overloaded } });
    const request = child.writes.find(m => m.method === "turn/start")!;
    child.stdout({ id: request.id, result: { turn: { id: "turn" } } }); await Promise.resolve();
    child.stdout({ method: "turn/completed", params: { threadId: "native-thread", turn: { id: "turn", status: "failed" } } });
    expect((await task.done).failure?.category).toBe("unknown"); await task.close();
  });
  test("later attempts cannot inherit an old fallback, even when a runner reuses a turn ID", async () => {
    const t = await started(); t.notify(); t.complete(); await t.task.done;
    t.notify(); const next = t.task.send("manual retry"); await Promise.resolve(); t.complete();
    expect((await next).failure?.category).toBe("unknown");
    const recovered = t.task.send("manual retry again"); await Promise.resolve(); t.notify({ willRetry: true }); t.complete("completed", overloaded);
    expect(await recovered).toEqual({ status: "completed" }); await t.task.close();
  });
  test("a terminal without matching thread identity cannot acquire a provider cause", async () => {
    const other = await started(); other.child.stdout({ method: "turn/completed", params: { turn: { id: "turn", status: "failed", error: overloaded } } });
    expect((await other.task.done).failure?.category).toBe("unknown"); await other.task.close();
  });
});
afterEach(() => { for (const dir of imageDirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function images() {
  const dir = mkdtempSync(join(tmpdir(), "deck-codex-images-")); imageDirs.push(dir);
  return ["image/png", "image/jpeg"].map((mimeType, index) => {
    const path = join(dir, `image-${index}`); writeFileSync(path, `image-bytes-${index}`);
    return { path, mimeType: mimeType as "image/png" | "image/jpeg", name: `Image ${index + 1}` };
  });
}
describe("Codex native image inputs", () => {
  test.each([false, true])("passes multiple localImage inputs to fresh/resumed turns (%s) without inheriting attachments", async (resumed) => {
    const files = images(); const h = harness(responder);
    const task = await createCodexSessionDriver().startTask({ ...input, images: files, ...(resumed ? { resume: { nativeSessionId: "native-thread" } } : {}) }, h.io);
    await task.nativeSessionId; const child = h.children.at(-1)!;
    for (let i = 0; i < 100 && !child.writes.some(m => m.method === "turn/start"); i++) await new Promise(r => setTimeout(r, 1));
    expect((child.writes.find(m => m.method === "turn/start")!.params as any).input).toEqual([{ type: "text", text: "hello" }, ...files.map(file => ({ type: "localImage", path: file.path }))]);
    child.stdout({ method: "item/started", params: { threadId: "native-thread", item: { type: "userMessage", content: [{ type: "localImage", path: files[0]!.path }] } } });
    expect(JSON.stringify(h.events)).not.toContain(files[0]!.path);
    const complete = () => child.stdout({ method: "turn/completed", params: { threadId: "native-thread", turn: { id: "turn", status: "completed" } } });
    complete(); await task.done;
    const second = task.send("", [files[1]!]);
    for (let i = 0; i < 100 && child.writes.filter(m => m.method === "turn/start").length < 2; i++) await new Promise(r => setTimeout(r, 1));
    expect((child.writes.filter(m => m.method === "turn/start")[1]!.params as any).input).toEqual([{ type: "localImage", path: files[1]!.path }]); complete(); await second;
    const third = task.send("text only"); await Promise.resolve();
    expect((child.writes.filter(m => m.method === "turn/start")[2]!.params as any).input).toEqual([{ type: "text", text: "text only" }]); complete(); await third; await task.close();
  });
  test("rejects missing, oversized, excessive and aggregate oversized image inputs without exposing paths", async () => {
    const files = images(); const huge = { ...files[0]!, path: `${files[0]!.path}-huge` }; writeFileSync(huge.path, ""); truncateSync(huge.path, 5 * 1024 * 1024 + 1);
    const aggregate = { ...files[0]!, path: `${files[0]!.path}-aggregate` }; writeFileSync(aggregate.path, ""); truncateSync(aggregate.path, 5 * 1024 * 1024);
    for (const bad of [[{ ...files[0]!, path: `${files[0]!.path}-missing` }], [huge], Array(9).fill(files[0]), Array(5).fill(aggregate)]) {
      const h = harness(responder); const task = await createCodexSessionDriver().startTask({ ...input, images: bad }, h.io);
      expect(await task.done).toMatchObject({ status: "failed", error: "image-input-invalid" });
      expect(h.children.flatMap(child => child.writes).some(m => m.method === "turn/start")).toBe(false); expect(JSON.stringify(h.events)).not.toContain(files[0]!.path); await task.close();
    }
  });
});
describe("Codex session driver", () => {
  test.each(["allow", "deny"] as const)("relays observed native MCP approval form (%s), including request id zero", async (decision) => {
    const h = harness(responder);
    const approvals: unknown[] = [];
    h.io.approval = async (request) => { approvals.push(request); return { decision, scope: "always" }; };
    const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io);
    await task.nativeSessionId;
    const child = h.children.at(-1)!; child.stdout(mcpMemoryApproval);
    await Promise.resolve(); await Promise.resolve();
    expect(approvals).toEqual([{ approvalId: "codex:0", toolKey: "codex:mcp:deck-session-task-deck:deck_memory_recall", identity: JSON.stringify({ query: "acceptance" }), exactKey: JSON.stringify({ query: "acceptance" }), risk: "normal", tool: "mcp__deck-session-task-deck__deck_memory_recall", summary: mcpMemoryApproval.params.message, input: { query: "acceptance" } }]);
    expect(child.writes.find((m) => m.id === 0)?.result).toEqual({ action: decision === "allow" ? "accept" : "decline", content: decision === "allow" ? {} : null, _meta: null });
    await task.close(); await task.done;
  });
  test("approved Codex bypass accepts isolated native MCP tools without invoking the relay", async () => {
    const h = harness(responder); let brokerCalls = 0;
    h.io.approval = async () => { brokerCalls++; return { decision: "deny" }; };
    const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId;
    const child = h.children.at(-1)!; child.stdout(mcpMemoryApproval);
    await Promise.resolve();
    expect(child.writes.find((m) => m.id === 0)?.result).toEqual({ action: "accept", content: {}, _meta: null });
    expect(brokerCalls).toBe(0); await task.close(); await task.done;
  });
  test.each([
    { _meta: { codex_approval_kind: "arbitrary-form" } },
    { requestedSchema: { type: "object", properties: { password: { type: "string" } } } },
    { requestedSchema: { type: "object", properties: [] } },
    { serverName: "foreign-server" }, { turnId: "stale-turn" }, { mode: "url" },
  ])("rejects unrecognized, foreign or stale elicitation without asking the broker: %j", async (override) => {
    const h = harness(responder); let brokerCalls = 0;
    h.io.approval = async () => { brokerCalls++; return { decision: "allow" }; };
    const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io); await task.nativeSessionId;
    const child = h.children.at(-1)!; child.stdout({ ...mcpMemoryApproval, params: { ...mcpMemoryApproval.params, ...override } });
    await Promise.resolve();
    expect(child.writes.find((m) => m.id === 0)?.error).toMatchObject({ code: -32601 });
    expect(brokerCalls).toBe(0); await task.close(); await task.done;
  });
  test("declines a native MCP approval whose broker resolves after interruption", async () => {
    const h = harness(responder); let release!: (decision: { decision: "allow" }) => void;
    h.io.approval = () => new Promise((resolve) => { release = resolve; });
    const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io); await task.nativeSessionId;
    const child = h.children.at(-1)!; child.stdout(mcpMemoryApproval);
    await task.interrupt(); release({ decision: "allow" }); await Promise.resolve(); await Promise.resolve();
    expect(child.writes.find((m) => m.id === 0)?.result).toEqual({ action: "decline", content: null, _meta: null });
    await task.done; await task.close();
  });
  test("cannot approve a request without a native turn id while turn/start is pending", async () => {
    const h = harness((child, index, m) => { if (m.method !== "turn/start") responder(child, index, m); });
    const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId;
    const { turnId: _turnId, ...params } = mcpMemoryApproval.params;
    const child = h.children.at(-1)!; child.stdout({ ...mcpMemoryApproval, params });
    await Promise.resolve();
    expect(child.writes.find((m) => m.id === 0)?.error).toMatchObject({ code: -32601 });
    await task.close(); await task.done;
  });
  test("a pending approval cannot authorize a later turn that reuses the same native id", async () => {
    const h = harness(responder); let release!: (decision: { decision: "allow" }) => void;
    h.io.approval = () => new Promise((resolve) => { release = resolve; });
    const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io); await task.nativeSessionId;
    const child = h.children.at(-1)!; child.stdout(mcpMemoryApproval);
    child.stdout({ method: "turn/completed", params: { threadId: "native-thread", turn: { id: "turn", status: "completed" } } });
    await task.done;
    const followup = task.send("next turn"); await Promise.resolve();
    release({ decision: "allow" }); await Promise.resolve(); await Promise.resolve();
    expect(child.writes.find((m) => m.id === 0)?.result).toEqual({ action: "decline", content: null, _meta: null });
    await task.interrupt(); await followup; await task.close();
  });
  test("marks only an exact missing thread/resume response for host reseeding", async () => {
    for (const [message, missing] of [["thread not found: saved", true], ["authentication failed", false]] as const) {
      const h = harness((child, index, m) => {
        if (m.method === "thread/resume") child.stdout({ id: m.id, error: { code: -32600, message } });
        else responder(child, index, m);
      });
      const task = await createCodexSessionDriver().startTask({ ...input, resume: { nativeSessionId: "saved" } }, h.io);
      expect((await task.done).reasonCode).toBe(missing ? "native-session-not-found" : undefined);
      expect(h.children.at(-1)?.terminations).toBe(1);
      await task.close();
    }
  });
  test("reads native config in the execution process, keeps auth home and reuses its thread for followups", async () => {
    const h = harness(responder), driver = createCodexSessionDriver({ baseEnv: { CODEX_HOME: "/native/auth-home" } });
    const task = await driver.startTask(input, h.io);
    expect(await task.nativeSessionId).toBe("native-thread");
    expect(h.children[0]?.terminations).toBe(0);
    expect(h.spawns.at(-1)?.args.some(arg => arg.startsWith("mcp_servers="))).toBe(false);
    expect(h.children.at(-1)?.writes.find(m => m.method === "thread/start")?.params).toMatchObject({config:{mcp_servers:{"deck-session-task-deck":{command:"/deck"}}}});
    expect(h.spawns.at(-1)?.options?.env?.CODEX_HOME).toBe("/native/auth-home");
    expect(h.children[0]?.writes.some((m) => m.method === "thread/start")).toBe(true);
    const child = h.children.at(-1)!;
    expect(child.writes.find((m) => m.method === "thread/start")?.params).toMatchObject({ sandbox: "danger-full-access", approvalPolicy: "never", model: "gpt-5", developerInstructions: input.rolePrompt });
    child.stdout({ method: "turn/completed", params: { threadId: "native-thread", turn: { id: "turn", status: "completed" } } });
    expect(await task.done).toEqual({ status: "completed" });
    const followup = task.send("again");
    await task.interrupt(); expect(await followup).toEqual({ status: "interrupted" });
    await task.close(); expect(child.terminations).toBe(1);
  });
  test.each(["allow", "deny"] as const)("relays %s to native approval and preserves native resume", async (decision) => {
    const h = harness(responder); h.io.approval = async () => ({ decision });
    const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay", resume: { nativeSessionId: "saved" } }, h.io);
    await task.nativeSessionId;
    const child = h.children.at(-1)!;
    expect(child.writes.find((m) => m.method === "thread/resume")?.params).toMatchObject({ threadId: "saved", approvalPolicy: "on-request", sandbox: "read-only" });
    child.stdout({ id: "approval", method: "item/commandExecution/requestApproval", params: { threadId: "saved", turnId: "turn", command: "echo hi" } });
    await Promise.resolve(); await Promise.resolve();
    expect(child.writes.find((m) => m.id === "approval")?.result).toEqual({ decision: decision === "allow" ? "accept" : "decline" });
    await task.close(); await task.done;
  });
  test("fails closed on a changed effective config before any thread exists", async () => {
    const h = harness((child, index, m) => {
      if (m.method === "config/read") child.stdout({ id: m.id, result: { config: {...config(false),features:{multi_agent:true,multi_agent_v2:false}} } });
      else responder(child, index, m);
    });
    const task = await createCodexSessionDriver().startTask(input, h.io);
    await expect(task.nativeSessionId).rejects.toThrow("isolation");
    expect((await task.done).status).toBe("failed");
    expect(h.children.at(-1)?.writes.some((m) => m.method === "thread/start")).toBe(false);
    expect(h.children.at(-1)?.terminations).toBe(1);
  });
  test("reports tested version range without running a model", async () => {
    expect(await createCodexSessionDriver({ exec: async () => ({ code: 0, stdout: "codex-cli 0.162.1" }) }).probe({ cwd: "/work" })).toMatchObject({ status: "ready", version: "0.162.1" });
    expect(await createCodexSessionDriver({ exec: async () => ({ code: 0, stdout: "codex-cli 0.161.0" }) }).probe({ cwd: "/work" })).toMatchObject({ status: "blocked" });
  });
  test("forces interruption after deadline and settles only after group cleanup", async () => {
    const h = harness((child, index, m) => {
      if (m.method === "turn/interrupt") child.stdout({ id: m.id, result: {} });
      else responder(child, index, m);
    });
    const task = await createCodexSessionDriver({ escalationMs: 1 }).startTask(input, h.io);
    await task.nativeSessionId; await task.interrupt();
    expect(await task.done).toEqual({ status: "interrupted-forced" });
    expect(h.children.at(-1)?.terminations).toBe(1);
    await expect(task.send("after forced shutdown")).rejects.toThrow("closed");
  });
  test("fails pending turn on process exit and rejects further turns", async () => {
    const h = harness(responder), task = await createCodexSessionDriver().startTask(input, h.io);
    await task.nativeSessionId; h.children.at(-1)!.exit();
    expect((await task.done).status).toBe("failed");
    await expect(task.send("after crash")).rejects.toThrow("closed");
  });
  test("rejects a leaked runtime server before first model prompt", async () => {
    const h = harness((child, index, m) => {
      if (m.method === "mcpServerStatus/list") child.stdout({ id: m.id, result: { data: [{ name: "foreign", runtimeStatus: "connected" }], nextCursor: null } });
      else responder(child, index, m);
    });
    const task = await createCodexSessionDriver().startTask(input, h.io);
    expect((await task.done).status).toBe("failed");
    expect(h.children.at(-1)?.writes.some((m) => m.method === "turn/start")).toBe(false);
  });
  test("does not release broker approval after interruption", async () => {
    const h = harness(responder);
    let resolveDecision!: (decision: { decision: "allow" }) => void;
    h.io.approval = () => new Promise((resolve) => { resolveDecision = resolve; });
    const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io);
    await task.nativeSessionId;
    const child = h.children.at(-1)!;
    child.stdout({ id: 50, method: "item/fileChange/requestApproval", params: { threadId: "native-thread", turnId: "turn" } });
    await task.interrupt(); resolveDecision({ decision: "allow" });
    await Promise.resolve(); await Promise.resolve();
    expect(child.writes.find((m) => m.id === 50)?.result).toEqual({ decision: "decline" });
    expect((await task.done).status).toBe("interrupted"); await task.close();
  });
  test("interrupts a blocked startup and cleans up its inventory process", async () => {
    const h = harness(() => {});
    const task = await createCodexSessionDriver().startTask(input, h.io);
    await task.interrupt();
    expect((await task.done).status).toBe("interrupted-forced");
    expect(h.children[0]?.terminations).toBe(1);
    await expect(task.nativeSessionId).rejects.toThrow("closed");
  });
  test("bounds supervisor readiness before beginning the RPC handshake", async () => {
    const h = harness(responder), spawn = h.io.spawn;
    h.io.spawn = async (...args) => { const child = await spawn(...args); (child as FakeChild).ready = new Promise(() => {}); return child; };
    const task = await createCodexSessionDriver({ rpcTimeoutMs: 1 }).startTask(input, h.io);
    expect((await task.done).status).toBe("failed");
    expect(h.children[0]?.terminations).toBe(1);
    expect(h.children[0]?.writes).toHaveLength(0);
  });
  test.each(["malformed-startup", "oversized-startup", "startup-interrupt"])("shares the outstanding group drain across done and repeated close: %s", async (mode) => {
    let releaseDrain!: () => void;
    const drain = new Promise<void>((resolve) => { releaseDrain = resolve; });
    const h = harness((child, _index, m) => {
      if (m.method !== "initialize") return;
      if (mode === "malformed-startup") child.stdoutRaw("invalid JSON\n");
      if (mode === "oversized-startup") child.stdoutRaw("x".repeat(CODEX_MAX_FRAME_BYTES + 1));
    });
    const spawn = h.io.spawn;
    h.io.spawn = async (...args) => {
      const child = await spawn(...args) as FakeChild;
      child.terminateGroup = async () => { child.terminations++; await drain; child.exit(); };
      return child;
    };
    const task = await createCodexSessionDriver().startTask(input, h.io);
    let doneSettled = false, firstCloseSettled = false, secondCloseSettled = false;
    const done = task.done.then(() => { doneSettled = true; });
    if (mode === "startup-interrupt") void task.interrupt();
    await new Promise((resolve) => setImmediate(resolve));
    const firstClose = task.close().then(() => { firstCloseSettled = true; });
    const secondClose = task.close().then(() => { secondCloseSettled = true; });
    await new Promise((resolve) => setImmediate(resolve));
    try {
      expect({ doneSettled, firstCloseSettled, secondCloseSettled }).toEqual({ doneSettled: false, firstCloseSettled: false, secondCloseSettled: false });
      expect(h.children[0]?.terminations).toBe(1);
    } finally { releaseDrain(); await Promise.all([done, firstClose, secondClose]); }
    expect(doneSettled && firstCloseSettled && secondCloseSettled).toBe(true);
  });
});

const memoryInput = (): DriverTaskInput => ({ ...input, nativeMemory: { provider: "supermemory", integration: "runner-plugin", status: "ready", projectScope: "sm_project_v1_owner_repo", plugin: { root: "/owned/supermemory", nodeCommand: "/usr/bin/node", scripts: { recall: "/owned/supermemory/recall.js", flush: "/owned/supermemory/flush.js" } } } });
const memoryHooks = (isolated: boolean) => [
  { key: "foreign-json", currentHash: "foreign-hash", eventName: "sessionStart", handlerType: "command", command: "echo foreign", source: "user", enabled: !isolated, trustStatus: "trusted" },
  { key: "recall", currentHash: "recall-hash", eventName: "userPromptSubmit", handlerType: "command", command: "'/usr/bin/node' '/owned/supermemory/recall.js'", source: "sessionFlags", enabled: true, trustStatus: isolated ? "trusted" : "untrusted" },
  { key: "flush", currentHash: "flush-hash", eventName: "stop", handlerType: "command", command: "'/usr/bin/node' '/owned/supermemory/flush.js'", source: "sessionFlags", enabled: true, trustStatus: isolated ? "trusted" : "untrusted" },
];
function memoryResponder(transform?: (hooks: ReturnType<typeof memoryHooks>) => ReturnType<typeof memoryHooks>) {
  return (child: FakeChild, index: number, m: Record<string, unknown>) => {
    if (m.method === "config/read") child.stdout({ id: m.id, result: { config: { ...config(index === 2), features: { ...config(index === 2).features, hooks: true } } } });
    else if (m.method === "hooks/list") child.stdout({ id: m.id, result: { data: [{ cwd: "/work", hooks: index === 2 && transform ? transform(memoryHooks(true)) : memoryHooks(index === 2), errors: [], warnings: [] }] } });
    else responder(child, index, m);
  };
}
test("isolates inherited hooks.json without changing native auth home and trusts only admitted official hook hashes", async () => {
  const h = harness(memoryResponder());
  const requested = { ...memoryInput(), resume: { nativeSessionId: "saved" } };
  const task = await createCodexSessionDriver({ baseEnv: { CODEX_HOME: "/native/auth-and-resume" } }).startTask(requested, h.io);
  expect(await task.nativeSessionId).toBe("saved");
  expect(h.children[0]!.writes.some(m => m.method === "thread/start" || m.method === "thread/resume")).toBe(false);
  expect(h.spawns.at(-1)!.options?.env?.CODEX_HOME).toBe("/native/auth-and-resume");
  const hooks = h.spawns.at(-1)!.args.find(arg => arg.startsWith("hooks="))!;
  expect(hooks).not.toContain("foreign-json");
  expect(hooks).toContain('"recall"={"enabled"=true,"trusted_hash"="recall-hash"}');
  expect(hooks).toContain('"flush"={"enabled"=true,"trusted_hash"="flush-hash"}');
  expect(h.spawns.at(-1)!.args.join(" ")).not.toContain("bypass-hook-trust");
  expect(h.children.at(-1)!.writes.find(m => m.method === "thread/resume")?.params).toMatchObject({ threadId: "saved" });
  h.children.at(-1)!.stdout({ method: "hook/started", params: { threadId: "saved", turnId: "turn", run: { id: "actual-recall-run", eventName: "userPromptSubmit", source: "sessionFlags", status: "running", handlerType: "command" } } });
  expect(h.events.find(e => e.kind === "hook.started")?.data).toMatchObject({ provider: "supermemory", integration: "runner-plugin" });
  expect(requested.nativeMemory!.plugin!.exclusiveHookEvents).toBeUndefined();
  await task.close(); await task.done;
});
test.each([
  ["foreign hook conflicts with memory recall", (hooks: ReturnType<typeof memoryHooks>) => hooks.map(h => h.key === "foreign-json" ? { ...h, enabled: true, eventName: "userPromptSubmit" } : h)],
  ["official hook was modified", (hooks: ReturnType<typeof memoryHooks>) => hooks.map(h => h.key === "recall" ? { ...h, trustStatus: "modified" } : h)],
  ["official flush is missing", (hooks: ReturnType<typeof memoryHooks>) => hooks.filter(h => h.key !== "flush")],
])("blocks native prompt effects when hook isolation fails: %s", async (_name, transform) => {
  const h = harness(memoryResponder(transform));
  const task = await createCodexSessionDriver({ rpcTimeoutMs: 100 }).startTask(memoryInput(), h.io);
  expect(await task.done).toMatchObject({ status: "failed" });
  expect(h.children.at(-1)!.writes.some(m => m.method === "thread/start" || m.method === "thread/resume" || m.method === "turn/start")).toBe(false);
  expect(h.children.at(-1)!.terminations).toBe(1);
  await task.close();
});
test("foreign-thread hook notifications retain only metadata, never raw hook output", async () => {
  const h = harness(responder);
  const task = await createCodexSessionDriver().startTask(input, h.io);
  await task.nativeSessionId;
  for (const method of ["hook/started", "hook/completed", "hook/future"]) h.children.at(-1)!.stdout({ method, params: { threadId: "foreign-thread", run: { id: "foreign-run", eventName: "stop", entries: [{ kind: "context", text: "PRIVATE_HOOK_STDOUT_SENTINEL" }], stdout: "PRIVATE_HOOK_STDOUT_SENTINEL" } } });
  h.children.at(-1)!.stdout({ id: 0, method: "hook/completed", params: { threadId: "native-thread", run: { id: "malformed-request", stdout: "PRIVATE_HOOK_STDOUT_SENTINEL" } } });
  h.children.at(-1)!.stdout({ id: 1, method: "hook/future", params: { threadId: "native-thread", run: { stdout: "PRIVATE_HOOK_STDOUT_SENTINEL" } } });
  expect(h.events.filter(e => e.kind === "runner.unmapped" && e.data.reason === "foreign-thread")).toHaveLength(3);
  expect(JSON.stringify(h.events)).not.toContain("PRIVATE_HOOK_STDOUT_SENTINEL");
  await task.close(); await task.done;
});

const questionRequest = { id: "question", method: "item/tool/requestUserInput", params: {
  threadId: "native-thread", turnId: "turn", itemId: "item", isBlocking: true,
  questions: [{ id: "choice", header: "Pick", question: "Choose", options: [{ label: "A", description: "First" }], isOther: true, isSecret: false },
    { id: "secret", header: "Key", question: "Enter key", options: null, isOther: false, isSecret: true }],
} };
const emptyQuestionAnswers = { answers: { choice: { answers: [] }, secret: { answers: [] } } };
describe("Codex user questions", () => {
  test("delivers reused RPC IDs from separate native processes to a shared broker", async () => {
    const seen = new Set<string>();
    const broker: NonNullable<import("@deck/core/session/driver").DriverHostIo["question"]> = async request => {
      if (seen.has(request.questionId)) throw new Error("question-id-reused");
      seen.add(request.questionId);
      return { outcome: "answered", answers: { choice: ["A"], secret: ["value"] } };
    };
    // Reusing the task ID too models restarting its native process.
    for (const approvals of ["relay", "runner-default"] as const) {
      const h = harness(responder); h.io.question = broker;
      const task = await createCodexSessionDriver().startTask({ ...input, approvals }, h.io);
      try {
        await task.nativeSessionId;
        const child = h.children.at(-1)!; child.stdout(questionRequest); await Promise.resolve();
        expect(child.writes.find(m => m.id === "question")?.result).toEqual({ answers: { choice: { answers: ["A"] }, secret: { answers: ["value"] } } });
      } finally { await task.close(); }
    }
    expect(seen.size).toBe(2);
  });
  test("maps choices and secret free text and only sends answers to RPC", async () => {
    const h = harness(responder); const requests: unknown[] = [];
    h.io.question = async request => { requests.push(request); return { outcome: "answered", answers: { choice: ["A"], secret: ["SECRET_SENTINEL"] } }; };
    const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io); await task.nativeSessionId;
    const child = h.children.at(-1)!; child.stdout(questionRequest); await Promise.resolve();
    expect(requests).toEqual([{ questionId: expect.stringMatching(/^codex:task:question:[0-9a-f-]{36}$/), questions: [
      { id: "choice", header: "Pick", prompt: "Choose", options: [{ label: "A", description: "First" }], multiple: false, allowOther: true, secret: false },
      { id: "secret", header: "Key", prompt: "Enter key", options: [], multiple: false, allowOther: false, secret: true },
    ] }]);
    expect(child.writes.find(m => m.id === "question")?.result).toEqual({ answers: { choice: { answers: ["A"] }, secret: { answers: ["SECRET_SENTINEL"] } } });
    expect(JSON.stringify(h.events)).not.toContain("SECRET_SENTINEL"); await task.close();
  });
  test.each(["dismissed", "cancelled", "absent", "throws"])("returns empty arrays for %s", async outcome => {
    const h = harness(responder);
    if (outcome !== "absent") h.io.question = async () => { if (outcome === "throws") throw new Error("SECRET_SENTINEL"); return { outcome: outcome as "dismissed" | "cancelled" }; };
    const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId;
    const child = h.children.at(-1)!; child.stdout(questionRequest); await Promise.resolve();
    expect(child.writes.find(m => m.id === "question")?.result).toEqual(emptyQuestionAnswers);
    expect(h.events.filter(event => event.kind === "diagnostic" && event.data.code === "codex-question-broker-failed")).toHaveLength(outcome === "throws" ? 1 : 0);
    expect(JSON.stringify(h.events)).not.toContain("SECRET_SENTINEL"); await task.close();
  });
  test.each([{ threadId: "foreign" }, { turnId: "stale" }])("dismisses stale requests without relaying %j", async override => {
    const h = harness(responder); let calls = 0; h.io.question = async () => { calls++; return { outcome: "dismissed" }; };
    const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId;
    const child = h.children.at(-1)!; child.stdout({ ...questionRequest, params: { ...questionRequest.params, ...override } });
    expect(calls).toBe(0); expect(child.writes.find(m => m.id === "question")?.result).toEqual(emptyQuestionAnswers); await task.close();
  });
  test("deduplicates pending and completed requests and discards answers after interruption", async () => {
    const h = harness(responder); let calls = 0;
    let release!: (v: { outcome: "answered"; answers: Record<string, string[]> }) => void;
    h.io.question = () => { calls++; return new Promise(resolve => { release = resolve; }); };
    const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId;
    const child = h.children.at(-1)!; child.stdout(questionRequest); child.stdout(questionRequest);
    await task.interrupt(); release({ outcome: "answered", answers: { choice: ["A"], secret: ["SECRET_SENTINEL"] } }); await Promise.resolve();
    child.stdout(questionRequest);
    expect(calls).toBe(1); expect(child.writes.filter(m => m.id === "question")).toEqual([{ id: "question", result: emptyQuestionAnswers }]);
    expect(JSON.stringify(h.events)).not.toContain("SECRET_SENTINEL"); await task.close();
  });
});

test("Codex question answers from a previous turn cannot reach a replacement turn", async () => {
  const h = harness(responder);
  let release!: (v: { outcome: "answered"; answers: Record<string, string[]> }) => void;
  h.io.question = () => new Promise(resolve => { release = resolve; });
  const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId;
  const child = h.children.at(-1)!; child.stdout(questionRequest);
  child.stdout({ method: "turn/completed", params: { threadId: "native-thread", turn: { id: "turn", status: "completed" } } }); await task.done;
  const next = task.send("next"); await Promise.resolve();
  release({ outcome: "answered", answers: { choice: ["A"], secret: ["SECRET_SENTINEL"] } }); await Promise.resolve();
  expect(child.writes.find(m => m.id === "question")?.result).toEqual(emptyQuestionAnswers);
  expect(JSON.stringify(h.events)).not.toContain("SECRET_SENTINEL"); await task.interrupt(); await next; await task.close();
});
test("Codex question reply write failures redact secret-bearing errors", async () => {
  const h = harness(responder);
  h.io.question = async () => ({ outcome: "answered", answers: { choice: ["A"], secret: ["SECRET_SENTINEL"] } });
  const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId;
  const child = h.children.at(-1)!;
  child.responder = m => { if (m.id === "question") throw new Error("SECRET_SENTINEL"); responder(child, 2, m); };
  child.stdout(questionRequest);
  expect(await task.done).toMatchObject({ status: "failed", error: "codex-question-reply-failed" });
  expect(JSON.stringify(h.events)).not.toContain("SECRET_SENTINEL"); await task.close();
});
test("Codex questions support zero request IDs and empty option arrays", async () => {
  const h = harness(responder); let seen: unknown;
  h.io.question = async request => { seen = request; return { outcome: "dismissed" }; };
  const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId;
  const child = h.children.at(-1)!; child.stdout({ ...questionRequest, id: 0, params: { ...questionRequest.params, questions: [{ id: "text", header: "Text", question: "Type", options: [] }] } }); await Promise.resolve();
  expect(seen).toMatchObject({ questionId: expect.stringMatching(/^codex:task:0:[0-9a-f-]{36}$/), questions: [{ id: "text", options: [], multiple: false, allowOther: false, secret: false }] });
  expect(child.writes.find(m => m.id === 0)?.result).toEqual({ answers: { text: { answers: [] } } }); await task.close();
});

const scopeRequests = [
  { name: "commandExecution", params: { command: "git status", cwd: "/work", proposedExecpolicyAmendment: ["git", "status"] }, exactKey: JSON.stringify({ command: "git status", cwd: "/work" }), risk: "high" },
  { name: "fileChange", params: { grantRoot: "/work/src", reason: "Edit source" }, exactKey: "/work/src\nEdit source", risk: "high" },
  { name: "permissions", params: { cwd: "/work", permissions: { fileSystem: { write: ["/work/src"] }, network: { enabled: true } }, reason: "Build" }, exactKey: JSON.stringify({ cwd: "/work", permissions: { fileSystem: { write: ["/work/src"] }, network: { enabled: true } } }), risk: "high" },
] as const;
const nativeApproval = (name: string, params: object = {}) => ({ id: "scoped", method: `item/${name}/requestApproval`, params: { threadId: "native-thread", turnId: "turn", ...params } });
describe("Codex approval scopes", () => {
  for (const request of scopeRequests) {
    test.each(["once", "always", "deny"] as const)(`${request.name} advertises fields and maps %s`, async scope => {
      const h = harness(responder); let seen: unknown;
      h.io.approval = async req => { seen = req; return { decision: scope === "deny" ? "deny" : "allow", scope: scope === "always" ? "always" : "once" }; };
      const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io);
      try {
        await task.nativeSessionId; const child = h.children.at(-1)!;
        child.stdout(nativeApproval(request.name, request.params)); await Promise.resolve();
        expect(seen).toMatchObject({ toolKey: `codex:${request.name}`, exactKey: request.exactKey, risk: request.risk });
        if (request.name === "commandExecution") {
          expect((seen as any).nativeScopes).toEqual(["always"]);
          expect((seen as any).alwaysNote).toContain("git status");
          expect((seen as any).alwaysNote).toContain("future sessions and Deck cannot revoke it");
        } else {
          expect((seen as any).nativeScopes).toBeUndefined(); expect((seen as any).alwaysNote).toBeUndefined();
        }
        const expected = request.name === "permissions" ? scope === "deny" ? { permissions: {} } : { permissions: request.params.permissions, scope: "turn" }
          : { decision: scope === "deny" ? "decline" : request.name === "commandExecution" && scope === "always" ? { acceptWithExecpolicyAmendment: { execpolicy_amendment: request.params.proposedExecpolicyAmendment } } : "accept" };
        expect(child.writes.find(m => m.id === "scoped")?.result).toEqual(expected);
        expect(JSON.stringify(child.writes)).not.toContain("acceptForSession");
        expect(JSON.stringify(child.writes)).not.toContain("applyNetworkPolicyAmendment");
      } finally { await task.close(); }
    });
    test(`${request.name} denies an interrupted pending allow`, async () => {
      const h = harness(responder); let release!: (value: { decision: "allow"; scope: "always" }) => void;
      h.io.approval = () => new Promise(resolve => { release = resolve; });
      const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io);
      try {
        await task.nativeSessionId; const child = h.children.at(-1)!; child.stdout(nativeApproval(request.name, request.params));
        await task.interrupt(); release({ decision: "allow", scope: "always" }); await Promise.resolve();
        expect(child.writes.find(m => m.id === "scoped")?.result).toEqual(request.name === "permissions" ? { permissions: {} } : { decision: "decline" });
      } finally { await task.close(); }
    });
    test(`${request.name} rejects stale requests without asking the broker`, async () => {
      const h = harness(responder); let calls = 0; h.io.approval = async () => { calls++; return { decision: "allow" }; };
      const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io);
      try {
        await task.nativeSessionId; const child = h.children.at(-1)!;
        child.stdout(nativeApproval(request.name, { ...request.params, turnId: "old" }));
        expect(child.writes.find(m => m.id === "scoped")?.error).toMatchObject({ code: -32601 }); expect(calls).toBe(0);
      } finally { await task.close(); }
    });
  }
  test.each([undefined, [], [""]])("does not offer persistence for absent or empty amendment %j", async amendment => {
    const h = harness(responder); let seen: any;
    h.io.approval = async req => { seen = req; return { decision: "allow", scope: "always" }; };
    const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io);
    try {
      await task.nativeSessionId; const child = h.children.at(-1)!;
      child.stdout(nativeApproval("commandExecution", { command: "echo hi", proposedExecpolicyAmendment: amendment, proposedNetworkPolicyAmendments: [{ host: "example.com", action: "allow" }] })); await Promise.resolve();
      expect(seen.nativeScopes).toBeUndefined(); expect(seen.alwaysNote).toBeUndefined();
      expect(child.writes.find(m => m.id === "scoped")?.result).toEqual({ decision: "accept" });
    } finally { await task.close(); }
  });
  test("redacts full command displays including cwd; omits unavailable file identities", async () => {
    const h = harness(responder); const seen: any[] = [];
    h.io.approval = async req => { seen.push(req); return { decision: "deny" }; };
    const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io);
    try {
      await task.nativeSessionId; const child = h.children.at(-1)!;
      child.stdout(nativeApproval("commandExecution", { command: `TOKEN=SECRET_SENTINEL echo ${"x".repeat(600)}`, cwd: "/PRIVATE_CWD" })); await Promise.resolve();
      expect(seen[0].exactKey).toHaveLength(JSON.stringify({ command: `TOKEN=[redacted] echo ${"x".repeat(600)}`, cwd: "/PRIVATE_CWD" }).length); expect(seen[0].exactKey).toContain("[redacted]");
      expect(seen[0].exactKey).not.toContain("SECRET_SENTINEL"); expect(seen[0].exactKey).toContain("PRIVATE_CWD");
      child.stdout({ ...nativeApproval("fileChange"), id: "file" }); await Promise.resolve(); expect(seen[1].exactKey).toBeUndefined();
    } finally { await task.close(); }
  });
  test("permissions broker failure denies without exposing secret errors", async () => {
    const h = harness(responder); h.io.approval = async () => { throw new Error("SECRET_SENTINEL"); };
    const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io);
    try {
      await task.nativeSessionId; const child = h.children.at(-1)!; child.stdout(nativeApproval("permissions", scopeRequests[2].params)); await Promise.resolve();
      expect(child.writes.find(m => m.id === "scoped")?.result).toEqual({ permissions: {} }); expect(JSON.stringify(h.events)).not.toContain("SECRET_SENTINEL");
    } finally { await task.close(); }
  });
});

test("Codex unknown approval methods stay unsupported", async () => {
  const h = harness(responder); let calls = 0; h.io.approval = async () => { calls++; return { decision: "allow" }; };
  const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io);
  try {
    await task.nativeSessionId; const child = h.children.at(-1)!; child.stdout(nativeApproval("unknown"));
    expect(child.writes.find(m => m.id === "scoped")?.error).toMatchObject({ code: -32601 }); expect(calls).toBe(0);
  } finally { await task.close(); }
});
test("Codex permissions from a previous turn cannot authorize a replacement turn", async () => {
  const h = harness(responder); let release!: (value: { decision: "allow" }) => void;
  h.io.approval = () => new Promise(resolve => { release = resolve; });
  const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io);
  try {
    await task.nativeSessionId; const child = h.children.at(-1)!; child.stdout(nativeApproval("permissions", scopeRequests[2].params));
    child.stdout({ method: "turn/completed", params: { threadId: "native-thread", turn: { id: "turn", status: "completed" } } }); await task.done;
    const next = task.send("next"); await Promise.resolve(); release({ decision: "allow" }); await Promise.resolve();
    expect(child.writes.find(m => m.id === "scoped")?.result).toEqual({ permissions: {} });
    await task.interrupt(); await next;
  } finally { await task.close(); }
});

async function captureApprovalRequests(messages: object[]): Promise<DriverApprovalRequest[]> {
  const h = harness(responder); const requests: DriverApprovalRequest[] = [];
  h.io.approval = async request => { requests.push(request); return { decision: "deny" }; };
  const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io);
  try {
    await task.nativeSessionId;
    for (const [index, message] of messages.entries()) {
      h.children.at(-1)!.stdout({ ...message, id: `identity-${index}` }); await Promise.resolve();
    }
    expect(requests).toHaveLength(messages.length);
    expect(JSON.stringify(h.events)).not.toContain("IDENTITY_SECRET_SENTINEL");
    expect(JSON.stringify(h.events)).not.toContain('"identity"');
    return requests;
  } finally { await task.close(); }
}
describe("Codex approval match identities", () => {
  test.each([
    [{ command: "./deploy", cwd: "/sandbox" }, { command: "./deploy", cwd: "/production" }],
    [{ command: "x".repeat(600) + " safe", cwd: "/work" }, { command: "x".repeat(600) + " dangerous", cwd: "/work" }],
    [{ command: "TOKEN=IDENTITY_SECRET_SENTINEL_A deploy", cwd: "/work" }, { command: "TOKEN=IDENTITY_SECRET_SENTINEL_B deploy", cwd: "/work" }],
  ])("keeps distinct commands apart (%#)", async (a, b) => {
    const requests = await captureApprovalRequests([a, b, a].map(params => nativeApproval("commandExecution", params)));
    expect(typeof requests[0].identity === "string").toBe(true);
    expect(requests[0].identity !== requests[1].identity).toBe(true);
    expect(requests[0].identity === requests[2].identity).toBe(true);
  });
  test("passes the full redacted display past 512 characters, capped at 4096", async () => {
    const requests = await captureApprovalRequests([600, 5000].map(size => nativeApproval("commandExecution", { command: `TOKEN=IDENTITY_SECRET_SENTINEL ${"x".repeat(size)}`, cwd: "/work" })));
    expect(requests[0].exactKey).toBe(JSON.stringify({ command: `TOKEN=[redacted] ${"x".repeat(600)}`, cwd: "/work" }));
    expect(requests[1].exactKey).toHaveLength(4096);
  });
  test("omits identities exceeding 16 KiB in UTF-8 bytes", async () => {
    const requests = await captureApprovalRequests(["x".repeat(17 * 1024), "界".repeat(6000)].map(command => nativeApproval("commandExecution", { command, cwd: "/work" })));
    expect(requests.every(request => request.identity === undefined)).toBe(true);
  });
  test("separates MCP tools on one server and canonicalizes full arguments", async () => {
    const mcp = (name: string, args: object) => ({ ...mcpMemoryApproval, params: { ...mcpMemoryApproval.params, message: `Allow the deck-session-task-deck MCP server to run tool "${name}"?`, _meta: { ...mcpMemoryApproval.params._meta, tool_params: args } } });
    const requests = await captureApprovalRequests([
      mcp("deck_memory_recall", { b: 2, a: { y: 2, x: 1 } }), mcp("delete_records", { table: "all" }),
      mcp("deck_memory_recall", { a: { x: 1, y: 2 }, b: 2 }), mcp("deck_memory_recall", { b: 3, a: { y: 2, x: 1 } }),
    ]);
    expect(requests[0].toolKey).toBe("codex:mcp:deck-session-task-deck:deck_memory_recall");
    expect(requests[1].toolKey).toBe("codex:mcp:deck-session-task-deck:delete_records");
    expect(requests[0].identity === requests[2].identity).toBe(true);
    expect(requests[0].identity !== requests[3].identity).toBe(true);
    expect(requests[1].risk).toBe("high");
  });
  test("recognizes explicit MCP tool metadata and isolates missing names", async () => {
    const mcp = (_meta: object) => ({ ...mcpMemoryApproval, params: { ...mcpMemoryApproval.params, message: "MCP approval", _meta: { ...mcpMemoryApproval.params._meta, ..._meta } } });
    const requests = await captureApprovalRequests([mcp({ tool_name: "delete_records" }), mcp({}), mcp({})]);
    expect(requests[0].toolKey).toBe("codex:mcp:deck-session-task-deck:delete_records");
    expect(requests[1].risk).toBe("high"); expect(requests[1].identity === undefined).toBe(true);
    expect(requests[1].toolKey !== requests[2].toolKey).toBe(true);
  });
  test("file identities require paths, normalize and sort them, and include grantRoot", async () => {
    const requests = await captureApprovalRequests([
      nativeApproval("fileChange", { paths: ["src/../b.ts", "a.ts"], cwd: "/work", grantRoot: "." }),
      nativeApproval("fileChange", { paths: ["/work/a.ts", "/work/b.ts"], grantRoot: "/work" }),
      nativeApproval("fileChange", { paths: ["/work/a.ts", "/work/c.ts"], grantRoot: "/work" }),
      nativeApproval("fileChange", { grantRoot: "/work", reason: "Edit" }),
    ]);
    expect(typeof requests[0].identity === "string").toBe(true);
    expect(requests[0].identity === requests[1].identity).toBe(true);
    expect(requests[0].identity !== requests[2].identity).toBe(true);
    expect(requests[3].identity === undefined).toBe(true);
  });
  test("permissions identities include cwd and canonical nested permissions", async () => {
    const a = { network: { enabled: true }, fileSystem: { write: ["/work"] } };
    const b = { fileSystem: { write: ["/work"] }, network: { enabled: true } };
    const requests = await captureApprovalRequests([
      nativeApproval("permissions", { cwd: "/sandbox", permissions: a }), nativeApproval("permissions", { cwd: "/production", permissions: a }),
      nativeApproval("permissions", { cwd: "/sandbox", permissions: b }),
    ]);
    expect(requests[0].identity !== requests[1].identity).toBe(true);
    expect(requests[0].identity === requests[2].identity).toBe(true);
  });
});

describe("Codex bounded resume responses", () => {
  test.each([false, true])("excludes turns only when resuming (%s)", async resumed => {
    const h = harness(responder);
    const task = await createCodexSessionDriver().startTask({ ...input, ...(resumed ? { resume: { nativeSessionId: "saved" } } : {}) }, h.io);
    try {
      await task.nativeSessionId;
      const request = h.children.at(-1)!.writes.find(m => m.method === (resumed ? "thread/resume" : "thread/start"))!;
      expect(Object.hasOwn(request.params as object, "excludeTurns")).toBe(resumed);
      if (resumed) expect(request.params).toMatchObject({ threadId: "saved", excludeTurns: true });
    } finally { await task.close(); }
  });
  test("resumes large history by requesting only thread metadata", async () => {
    const h = harness((child, index, m) => {
      if (m.method === "thread/resume") {
        const params = m.params as Record<string, unknown>;
        child.stdout({ id: m.id, result: { thread: { id: "saved", turns: params.excludeTurns === true ? [] : [{ text: "x".repeat(1_050_693) }] } } });
      } else responder(child, index, m);
    });
    const task = await createCodexSessionDriver().startTask({ ...input, resume: { nativeSessionId: "saved" } }, h.io);
    try {
      await expect(task.nativeSessionId).resolves.toBe("saved");
      const child = h.children.at(-1)!;
      expect(child.writes.some(m => m.method === "turn/start")).toBe(true);
      child.stdout({ method: "turn/completed", params: { threadId: "saved", turn: { id: "turn", status: "completed" } } });
      expect(await task.done).toEqual({ status: "completed" });
    } finally { await task.close(); }
  });
  test.each(["startup", "running"])("preserves frame-too-large without exposing frames (%s)", async phase => {
    const h = harness((child, index, m) => {
      if (phase === "startup" && m.method === "thread/resume") child.stdout({ id: m.id, result: { thread: { id: "saved", text: "FRAME_SECRET_SENTINEL" + "x".repeat(CODEX_MAX_FRAME_BYTES) } } });
      else responder(child, index, m);
    });
    const task = await createCodexSessionDriver().startTask({ ...input, resume: { nativeSessionId: "saved" } }, h.io);
    try {
      if (phase === "running") {
        await task.nativeSessionId;
        h.children.at(-1)!.stdoutRaw(`{"text":"FRAME_SECRET_SENTINEL${"x".repeat(CODEX_MAX_FRAME_BYTES)}"}\n`);
      } else await expect(task.nativeSessionId).rejects.toThrow("codex-rpc-frame-too-large");
      expect(await task.done).toEqual({ status: "failed", error: "codex-rpc-frame-too-large", failure:{category:'deck',origin:'deck',certainty:'reported',code:'codex-rpc-frame-too-large'} });
      const diagnostics = h.events.filter(event => event.kind === "diagnostic" && event.data.code === "codex-rpc-frame-too-large");
      expect(diagnostics).toHaveLength(1);
      expect(diagnostics[0]!.data).toEqual({ code: "codex-rpc-frame-too-large", frameBytes: expect.any(Number), frameBytesKind: "exact", maxFrameBytes: CODEX_MAX_FRAME_BYTES, pendingCalls: phase === "startup" ? 1 : 0 });
      expect(diagnostics[0]!.data.frameBytes).toBeGreaterThan(CODEX_MAX_FRAME_BYTES);
      expect(h.children.at(-1)!.terminations).toBe(1);
      expect(JSON.stringify(h.events)).not.toContain("FRAME_SECRET_SENTINEL");
    } finally { await task.close(); }
  });
  test.each(["write-error", "native-error", "invalid-json"])("keeps unknown errors generic (%s)", async mode => {
    const h = harness((child, index, m) => {
      if (m.method !== "initialize") return responder(child, index, m);
      if (mode === "write-error") throw new Error("codex-UNKNOWN_SECRET_SENTINEL");
      if (mode === "native-error") child.stdout({ id: m.id, error: { code: -32603, message: "codex-UNKNOWN_SECRET_SENTINEL" } });
      else child.stdoutRaw('codex-UNKNOWN_SECRET_SENTINEL invalid JSON\n');
    });
    const task = await createCodexSessionDriver().startTask(input, h.io);
    try {
      const code = mode === "invalid-json" ? "codex-rpc-invalid-frame" : "codex-startup-failed";
      expect(await task.done).toEqual({ status: "failed", error: code, ...(mode==='invalid-json'?{failure:{category:'deck',origin:'deck',certainty:'reported',code}}:{}) });
      await expect(task.nativeSessionId).rejects.toThrow(code);
      expect(h.events.filter(event => event.kind === "diagnostic" && event.data.code !== "codex-mcp-aliases" && event.data.code !== "personal-mcp.sources")).toEqual([{ kind: "diagnostic", data: { code } }]);
      expect(JSON.stringify(h.events)).not.toContain("UNKNOWN_SECRET_SENTINEL");
    } finally { await task.close(); }
  });
});

describe('Codex text steering',()=>{
 test('exact active turn and client correlation; receipt versus conservative refusal and history',async()=>{
  let mode='accepted';const h=harness((child,index,m)=>{
   responder(child,index,m);
   if(m.method==='turn/steer')child.stdout(mode==='accepted'?{id:m.id,result:{turnId:'turn'}}:{id:m.id,error:{code:-32600,message:mode==='idle'?'no active turn to steer':'opaque failure'}});
   if(m.method==='thread/read')child.stdout({id:m.id,result:{thread:{id:'native-thread',turns:[{id:'turn',items:[{type:'userMessage',id:'item-2',clientId:'client',content:[{type:'text',text:'Exact text'}]}]}]}}});
  });
  const handle=await createCodexSessionDriver().startTask({...input,steeringVersion:'0.162.1'} as any,h.io);await handle.nativeSessionId;await Promise.resolve();
  const target=(handle as any).steeringTarget();expect(target).toEqual({nativeThreadId:'native-thread',nativeTurnId:'turn'});
  const message={...target,clientUserMessageId:'client',text:'Exact text'};
  expect(await (handle as any).steer(message)).toMatchObject({state:'accepted',...message,via:'receipt'});
  mode='idle';expect(await (handle as any).steer(message)).toMatchObject({state:'not-accepted',reason:'no-active-turn'});
  mode='opaque';expect(await (handle as any).steer(message)).toMatchObject({state:'unknown'});
  expect(await (handle as any).reconcileSteering(message)).toMatchObject({state:'accepted',...message,via:'history'});
  expect(await (handle as any).reconcileSteering({...message,text:'Different text'})).toMatchObject({state:'unknown'});
  await handle.close();
 });
});

test.each(['complete-first','close-first','lost-receipt'] as const)('steering remains conservative across native completion/transport ordering: %s',async(mode)=>{
 let request:any;const h=harness((child,index,m)=>{responder(child,index,m);if(m.method==='turn/steer')request=m;});
 const handle=await createCodexSessionDriver({rpcTimeoutMs:mode==='lost-receipt'?5:100}).startTask({...input,steeringVersion:'0.162.1'},h.io);await handle.nativeSessionId;await Promise.resolve();const child=h.children.at(-1)!,target=handle.steeringTarget!()!;
 const outcome=handle.steer!({...target,clientUserMessageId:'one-write',text:'Exact input'});
 if(mode==='complete-first'){child.stdout({method:'turn/completed',params:{threadId:'native-thread',turn:{id:'turn',status:'completed'}}});child.stdout({id:request.id,result:{turnId:'turn'}});expect(await outcome).toMatchObject({state:'accepted'});}
 else if(mode==='close-first'){await handle.close();expect(await outcome).toMatchObject({state:'unknown'});}
 else expect(await outcome).toMatchObject({state:'unknown'});
 expect(child.writes.filter(m=>m.method==='turn/steer')).toHaveLength(1);expect(child.writes.filter(m=>m.method==='turn/start')).toHaveLength(1);await handle.close();
});
test('steering requires a turn/start-confirmed identity and rejects stale turn-start notifications',async()=>{
 let request:any;const h=harness((child,index,m)=>{if(m.method==='turn/start'){request=m;return;}responder(child,index,m);});
 const handle=await createCodexSessionDriver().startTask({...input,steeringVersion:'0.162.1'},h.io);await handle.nativeSessionId;const child=h.children.at(-1)!;
 child.stdout({method:'turn/started',params:{threadId:'native-thread',turn:{id:'unconfirmed'}}});expect(handle.steeringTarget!()).toBeUndefined();
 child.stdout({id:request.id,result:{turn:{id:'turn'}}});await Promise.resolve();expect(handle.steeringTarget!()).toMatchObject({nativeTurnId:'turn'});
 child.stdout({method:'turn/started',params:{threadId:'native-thread',turn:{id:'stale'}}});expect(handle.steeringTarget!()).toMatchObject({nativeTurnId:'turn'});await handle.close();
});
test('unverified build suffixes do not advertise native steering even with the tested base version',async()=>{
 const driver=createCodexSessionDriver({exec:async()=>({code:0,stdout:'codex-cli 0.162.1-custom\n'})});expect((await driver.probe({cwd:'/work'})).capabilities).not.toContain('turn-steer-text-0.162.1');
});

test('native personal names stay stable and connection failures stay nonfatal without copying secrets',async()=>{
 const h=harness((child,index,m)=>{
  if(m.method==='mcpServerStatus/list'){child.stdout({id:m.id,result:{data:[{name:'deck-session-task-deck',runtimeStatus:'connected'},{name:'personal',runtimeStatus:'failed',toolsError:'PRIVATE_FAILURE_SENTINEL'}]}});return;}
  responder(child,index,m);
 });
 const task=await createCodexSessionDriver().startTask(input,h.io);await task.nativeSessionId;
 const start=h.children.at(-1)!.writes.find(m=>m.method==='thread/start')!;expect((start.params as any).config.mcp_servers.personal).toBeUndefined();expect(JSON.stringify(h.events)).not.toContain('PRIVATE_FAILURE_SENTINEL');expect(h.events).toContainEqual({kind:'diagnostic',data:{code:'personal-mcp.runtime',active:[],unavailable:['personal']}});await task.close();await task.done;
});

test('one existing native process reads config and starts the thread when managed memory needs no hook calibration',async()=>{
 const h=harness(responder),task=await createCodexSessionDriver().startTask(input,h.io);
 try{await task.nativeSessionId;expect(h.spawns).toHaveLength(1);expect(h.children[0]!.writes.some(m=>m.method==='config/read')).toBe(true);expect(h.children[0]!.writes.some(m=>m.method==='thread/start')).toBe(true);}finally{await task.close();await task.done;}
});

test('an admitted native personal server uses the existing approval broker; arbitrary foreign names stay rejected',async()=>{
 const h=harness((child,index,message)=>{if(message.method==='mcpServerStatus/list')child.stdout({id:message.id,result:{data:[{name:'deck-session-task-deck',runtimeStatus:'connected'},{name:'personal',runtimeStatus:'connected'}]}});else responder(child,index,message);});
 const requests:DriverApprovalRequest[]=[];h.io.approval=async request=>{requests.push(request);return{decision:'allow'};};
 const task=await createCodexSessionDriver().startTask({...input,approvals:'relay'},h.io);
 try{await task.nativeSessionId;const child=h.children.at(-1)!;child.stdout({...mcpMemoryApproval,params:{...mcpMemoryApproval.params,serverName:'personal',message:mcpMemoryApproval.params.message.replace('deck-session-task-deck','personal')}});await Promise.resolve();await Promise.resolve();expect(requests).toHaveLength(1);expect(requests[0]!.toolKey).toStartWith('codex:mcp:personal:');expect(child.writes.find(m=>m.id===0)?.result).toMatchObject({action:'accept'});}finally{await task.close();await task.done;}
});

test('compaction fences foreign threads, stale/inactive turns and delayed completion across turns', async () => {
  let turn = 0;
  const h = harness((child, index, m) => {
    if (m.method === 'turn/start') child.stdout({ id: m.id, result: { turn: { id: `turn-${++turn}` } } });
    else responder(child, index, m);
  });
  const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId; await Promise.resolve();
  const child = h.children.at(-1)!;
  const compact = (method: string, turnId = 'turn-1', threadId = 'native-thread') => child.stdout({ method, params: { threadId, turnId, item: { type: 'contextCompaction', id: 'compact' } } });
  const observed = () => h.events.filter(e => e.data.code === 'context.compaction');
  compact('item/started', 'turn-1', 'foreign'); compact('item/started', 'stale');
  expect(observed()).toHaveLength(0);
  compact('item/started'); expect(observed()).toHaveLength(1);
  child.stdout({ method: 'turn/completed', params: { threadId: 'native-thread', turn: { id: 'turn-1', status: 'completed' } } }); await task.done;
  compact('item/started'); compact('item/completed'); expect(observed()).toHaveLength(1);
  const next = task.send('next'); await Promise.resolve(); await Promise.resolve();
  compact('item/started', 'turn-2'); compact('item/completed', 'turn-1');
  expect(observed().map(e => e.data.state)).toEqual(['started', 'started']);
  compact('item/completed', 'turn-2'); expect(observed().at(-1)?.data.state).toBe('completed');
  await task.close(); await next;
});

test('compaction requires a known current turn while startup identity is unknown', async () => {
  const h = harness((child, index, m) => { if (m.method !== 'turn/start') responder(child, index, m); });
  const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId;
  const child = h.children.at(-1)!;
  const compact = () => child.stdout({ method: 'item/started', params: { threadId: 'native-thread', turnId: 'turn', item: { type: 'contextCompaction', id: 'c' } } });
  compact(); expect(h.events.filter(e => e.data.code === 'context.compaction')).toHaveLength(0);
  child.stdout({ method: 'turn/started', params: { threadId: 'native-thread', turn: { id: 'turn' } } });
  compact(); expect(h.events.filter(e => e.data.code === 'context.compaction')).toHaveLength(1);
  await task.close(); await task.done;
});

test('compaction cannot revive interrupted or closed turns', async () => {
 const h = harness((child, index, m) => {
  if (m.method === 'turn/interrupt') child.stdout({ id: m.id, result: {} });
  else responder(child, index, m);
 });
 const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId; await Promise.resolve();
 const child = h.children.at(-1)!;
 await task.interrupt();
 for (const method of ['item/started', 'item/completed']) child.stdout({ method, params: { threadId: 'native-thread', turnId: 'turn', item: { type: 'contextCompaction', id: 'c' } } });
 expect(h.events.filter(e => e.data.code === 'context.compaction')).toHaveLength(0);
 await task.close(); await task.done;
 child.stdout({ method: 'item/started', params: { threadId: 'native-thread', turnId: 'turn', item: { type: 'contextCompaction', id: 'late' } } });
 expect(h.events.filter(e => e.data.code === 'context.compaction')).toHaveLength(0);
});

// Promoted from the independent review's real-driver/fake-transport reproduction.
test('tool attribution and policy mutation require exact known live thread and turn',async()=>{
 const h=harness(responder);const task=await createCodexSessionDriver().startTask(input,h.io);await task.nativeSessionId;await Promise.resolve();
 const child=h.children.at(-1)!;
 const usage=()=>child.stdout({method:'thread/tokenUsage/updated',params:{threadId:'native-thread',turnId:'turn',tokenUsage:{last:{inputTokens:100,cachedInputTokens:20,outputTokens:1,totalTokens:101,reasoningOutputTokens:0},total:{totalTokens:101}}}});
 const tool=(method:string,threadId:unknown,turnId:unknown)=>child.stdout({method,params:{threadId,turnId,item:{id:'file',type:'fileChange',status:'completed',changes:[{path:'/work/current.ts',kind:'update',diff:'+current'}]}}});
 try {
  usage();const before=h.events.length;
  for(const method of ['item/started','item/completed'])for(const [thread,turn] of [['native-thread','previous-turn'],['native-thread',undefined],[undefined,'turn'],['foreign','turn']])tool(method,thread,turn);
  expect(h.events.filter(e=>e.kind==='tool.completed'||e.kind==='tool.started')).toHaveLength(0);
  expect(h.events.slice(before).filter(e=>e.data.code==='request.input-invalidated')).toHaveLength(0);
  tool('item/started','native-thread','turn');tool('item/completed','native-thread','turn');
  expect(h.events.filter(e=>e.kind==='tool.completed')).toMatchObject([{data:{nativeThreadId:'native-thread',nativeTurnId:'turn',edits:[{path:'/work/current.ts',op:'update'}]}}]);
  expect(h.events.slice(before).filter(e=>e.data.code==='request.input-invalidated')).toHaveLength(1);
  usage();child.stdout({method:'turn/completed',params:{threadId:'native-thread',turn:{id:'turn',status:'completed'}}});await task.done;
  expect(h.events.some(e=>e.data.code==='request.input-finalized')).toBe(true);
  const ended=h.events.filter(e=>e.kind==='tool.completed').length;tool('item/completed','native-thread','turn');
  expect(h.events.filter(e=>e.kind==='tool.completed')).toHaveLength(ended);
 }finally{await task.close();}
});

test('tool attribution is unavailable before native turn identity is known',async()=>{
 const h=harness((child,index,m)=>{if(m.method!=='turn/start')responder(child,index,m);});
 const task=await createCodexSessionDriver().startTask(input,h.io);await task.nativeSessionId;
 try {
  const child=h.children.at(-1)!;
  // An unconfirmed/missing-thread turn-start notification cannot manufacture proof.
  child.stdout({method:'turn/started',params:{turn:{id:'turn'}}});
  child.stdout({method:'item/completed',params:{threadId:'native-thread',turnId:'turn',item:{id:'early',type:'fileChange',status:'completed',changes:[{path:'/work/early.ts',kind:'add'}]}}});
  expect(h.events.filter(e=>e.kind==='tool.completed')).toHaveLength(0);
  expect(h.events.some(e=>e.data.code==='request.input-invalidated')).toBe(false);
 }finally{await task.close();}
});


test.each([true, false])("input claim gate precedes native turn/start: %s", async allowed => {
  let claims = 0, writes = 0;
  const h = harness((child, index, message) => {
    if (message.method === 'turn/start') { expect(claims).toBe(1); writes++; }
    responder(child, index, message);
  });
  const task = await createCodexSessionDriver().startTask(input, { ...h.io, claimInput: () => { claims++; return allowed; } });
  await task.nativeSessionId;
  if (!allowed) expect((await task.done).status).toBe('interrupted');
  else { await new Promise(resolve => setTimeout(resolve, 5)); }
  expect(claims).toBe(1); expect(writes).toBe(allowed ? 1 : 0);
  await task.close();
});

test('interrupt after thread creation while MCP attestation waits cannot send turn/start',async()=>{
  let reached=false,writes=0;
  const h=harness((child,index,message)=>{
    if(message.method==='mcpServerStatus/list'){reached=true;return;}
    if(message.method==='turn/start')writes++;
    responder(child,index,message);
  });
  const task=await createCodexSessionDriver().startTask(input,{...h.io,claimInput:()=>true});
  for(let n=0;n<100&&!reached;n++)await Bun.sleep(1);expect(reached).toBe(true);
  await task.interrupt();expect((await task.done).status).toBe('interrupted-forced');expect(writes).toBe(0);await task.close();
});
