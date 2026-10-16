import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DriverTaskInput } from "@deck/core/session/driver";
import { createCodexSessionDriver } from "./driver";
import { ISOLATION_FEATURES } from "./launch";
import { FakeChild, harness } from "./test-support";
import mcpMemoryApproval from "./__fixtures__/0.162.1/mcp-memory-approval.json";

const input: DriverTaskInput = {
  taskId: "task", memberId: "lead", cwd: "/work", assignment: { runnerId: "codex", modelId: "openai-codex/gpt-5", thinking: "high" },
  rolePrompt: "Role instructions", prompt: "hello", mcp: { servers: ["deck"], sessionTools: [] },
  mcpServerSpecs: { deck: { command: "/deck", args: ["internal", "session-mcp"], env: { DECK_SESSION_CREDENTIAL_FILE: "/private/credential" } } },
  approvals: "runner-default", credentialFile: "/private/credential", disableNativeDelegation: true,
};
const config = (isolated: boolean) => ({ features: Object.fromEntries(ISOLATION_FEATURES.map((f) => [f, false])), mcp_servers: {
  foreign: { enabled: !isolated, command: "foreign" }, ...(isolated ? { "deck-session-task-deck": { enabled: true, ...input.mcpServerSpecs.deck } } : {}),
} });
function responder(child: FakeChild, index: number, m: Record<string, unknown>) {
  const params = m.params as Record<string, unknown>;
  if (m.method === "initialize") child.stdout({ id: m.id, result: {} });
  if (m.method === "config/read") child.stdout({ id: m.id, result: { config: config(index === 2) } });
  if (m.method === "thread/start" || m.method === "thread/resume") child.stdout({ id: m.id, result: { thread: { id: params.threadId ?? "native-thread" } } });
  if (m.method === "mcpServerStatus/list") child.stdout({ id: m.id, result: { data: [{ name: "deck-session-task-deck", runtimeStatus: "connected" }], nextCursor: null } });
  if (m.method === "turn/start") child.stdout({ id: m.id, result: { turn: { id: "turn" } } });
  if (m.method === "turn/interrupt") { child.stdout({ id: m.id, result: {} }); child.stdout({ method: "turn/completed", params: { threadId: "native-thread", turn: { id: "turn", status: "interrupted" } } }); }
}
const imageDirs: string[] = [];
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
    await task.nativeSessionId; const child = h.children[1]!;
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
    h.io.approval = async (request) => { approvals.push(request); return { decision }; };
    const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io);
    await task.nativeSessionId;
    const child = h.children[1]!; child.stdout(mcpMemoryApproval);
    await Promise.resolve(); await Promise.resolve();
    expect(approvals).toEqual([{ approvalId: "codex:0", tool: "mcp__deck-session-task-deck__deck_memory_recall", summary: mcpMemoryApproval.params.message, input: { query: "acceptance" } }]);
    expect(child.writes.find((m) => m.id === 0)?.result).toEqual({ action: decision === "allow" ? "accept" : "decline", content: decision === "allow" ? {} : null, _meta: null });
    await task.close(); await task.done;
  });
  test("approved Codex bypass accepts isolated native MCP tools without invoking the relay", async () => {
    const h = harness(responder); let brokerCalls = 0;
    h.io.approval = async () => { brokerCalls++; return { decision: "deny" }; };
    const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId;
    const child = h.children[1]!; child.stdout(mcpMemoryApproval);
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
    const child = h.children[1]!; child.stdout({ ...mcpMemoryApproval, params: { ...mcpMemoryApproval.params, ...override } });
    await Promise.resolve();
    expect(child.writes.find((m) => m.id === 0)?.error).toMatchObject({ code: -32601 });
    expect(brokerCalls).toBe(0); await task.close(); await task.done;
  });
  test("declines a native MCP approval whose broker resolves after interruption", async () => {
    const h = harness(responder); let release!: (decision: { decision: "allow" }) => void;
    h.io.approval = () => new Promise((resolve) => { release = resolve; });
    const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io); await task.nativeSessionId;
    const child = h.children[1]!; child.stdout(mcpMemoryApproval);
    await task.interrupt(); release({ decision: "allow" }); await Promise.resolve(); await Promise.resolve();
    expect(child.writes.find((m) => m.id === 0)?.result).toEqual({ action: "decline", content: null, _meta: null });
    await task.done; await task.close();
  });
  test("cannot approve a request without a native turn id while turn/start is pending", async () => {
    const h = harness((child, index, m) => { if (m.method !== "turn/start") responder(child, index, m); });
    const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId;
    const { turnId: _turnId, ...params } = mcpMemoryApproval.params;
    const child = h.children[1]!; child.stdout({ ...mcpMemoryApproval, params });
    await Promise.resolve();
    expect(child.writes.find((m) => m.id === 0)?.error).toMatchObject({ code: -32601 });
    await task.close(); await task.done;
  });
  test("a pending approval cannot authorize a later turn that reuses the same native id", async () => {
    const h = harness(responder); let release!: (decision: { decision: "allow" }) => void;
    h.io.approval = () => new Promise((resolve) => { release = resolve; });
    const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io); await task.nativeSessionId;
    const child = h.children[1]!; child.stdout(mcpMemoryApproval);
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
      expect(h.children[1]?.terminations).toBe(1);
      await task.close();
    }
  });
  test("isolates via metadata inventory/restart, keeps native auth home and reuses one thread for followups", async () => {
    const h = harness(responder), driver = createCodexSessionDriver({ baseEnv: { CODEX_HOME: "/native/auth-home" } });
    const task = await driver.startTask(input, h.io);
    expect(await task.nativeSessionId).toBe("native-thread");
    expect(h.children[0]?.terminations).toBe(1);
    expect(h.spawns[1]?.args.find((arg) => arg.startsWith("mcp_servers="))).toContain('"foreign"={"enabled"=false}');
    expect(h.spawns[1]?.options?.env?.CODEX_HOME).toBe("/native/auth-home");
    expect(h.children[0]?.writes.some((m) => m.method === "thread/start")).toBe(false);
    const child = h.children[1]!;
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
    const child = h.children[1]!;
    expect(child.writes.find((m) => m.method === "thread/resume")?.params).toMatchObject({ threadId: "saved", approvalPolicy: "on-request", sandbox: "read-only" });
    child.stdout({ id: "approval", method: "item/commandExecution/requestApproval", params: { threadId: "saved", turnId: "turn", command: "echo hi" } });
    await Promise.resolve(); await Promise.resolve();
    expect(child.writes.find((m) => m.id === "approval")?.result).toEqual({ decision: decision === "allow" ? "accept" : "decline" });
    await task.close(); await task.done;
  });
  test("fails closed on a changed effective config before any thread exists", async () => {
    const h = harness((child, index, m) => {
      if (index === 2 && m.method === "config/read") child.stdout({ id: m.id, result: { config: config(false) } });
      else responder(child, index, m);
    });
    const task = await createCodexSessionDriver().startTask(input, h.io);
    await expect(task.nativeSessionId).rejects.toThrow("isolation");
    expect((await task.done).status).toBe("failed");
    expect(h.children[1]?.writes.some((m) => m.method === "thread/start")).toBe(false);
    expect(h.children[1]?.terminations).toBe(1);
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
    expect(h.children[1]?.terminations).toBe(1);
    await expect(task.send("after forced shutdown")).rejects.toThrow("closed");
  });
  test("fails pending turn on process exit and rejects further turns", async () => {
    const h = harness(responder), task = await createCodexSessionDriver().startTask(input, h.io);
    await task.nativeSessionId; h.children[1]!.exit();
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
    expect(h.children[1]?.writes.some((m) => m.method === "turn/start")).toBe(false);
  });
  test("does not release broker approval after interruption", async () => {
    const h = harness(responder);
    let resolveDecision!: (decision: { decision: "allow" }) => void;
    h.io.approval = () => new Promise((resolve) => { resolveDecision = resolve; });
    const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io);
    await task.nativeSessionId;
    const child = h.children[1]!;
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
  test.each(["malformed-startup", "startup-interrupt"])("shares the outstanding group drain across done and repeated close: %s", async (mode) => {
    let releaseDrain!: () => void;
    const drain = new Promise<void>((resolve) => { releaseDrain = resolve; });
    const h = harness((child, _index, m) => { if (mode === "malformed-startup" && m.method === "initialize") child.stdoutRaw("invalid JSON\n"); });
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
  expect(h.spawns[1]!.options?.env?.CODEX_HOME).toBe("/native/auth-and-resume");
  const hooks = h.spawns[1]!.args.find(arg => arg.startsWith("hooks="))!;
  expect(hooks).toContain('"foreign-json"={"enabled"=false}');
  expect(hooks).toContain('"recall"={"enabled"=true,"trusted_hash"="recall-hash"}');
  expect(hooks).toContain('"flush"={"enabled"=true,"trusted_hash"="flush-hash"}');
  expect(h.spawns[1]!.args.join(" ")).not.toContain("bypass-hook-trust");
  expect(h.children[1]!.writes.find(m => m.method === "thread/resume")?.params).toMatchObject({ threadId: "saved" });
  h.children[1]!.stdout({ method: "hook/started", params: { threadId: "saved", turnId: "turn", run: { id: "actual-recall-run", eventName: "userPromptSubmit", source: "sessionFlags", status: "running", handlerType: "command" } } });
  expect(h.events.find(e => e.kind === "hook.started")?.data).toMatchObject({ provider: "supermemory", integration: "runner-plugin" });
  expect(requested.nativeMemory!.plugin!.exclusiveHookEvents).toBeUndefined();
  await task.close(); await task.done;
});
test.each([
  ["foreign hook remains enabled", (hooks: ReturnType<typeof memoryHooks>) => hooks.map(h => h.key === "foreign-json" ? { ...h, enabled: true } : h)],
  ["official hook was modified", (hooks: ReturnType<typeof memoryHooks>) => hooks.map(h => h.key === "recall" ? { ...h, trustStatus: "modified" } : h)],
  ["official flush is missing", (hooks: ReturnType<typeof memoryHooks>) => hooks.filter(h => h.key !== "flush")],
])("blocks native prompt effects when hook isolation fails: %s", async (_name, transform) => {
  const h = harness(memoryResponder(transform));
  const task = await createCodexSessionDriver({ rpcTimeoutMs: 100 }).startTask(memoryInput(), h.io);
  expect(await task.done).toMatchObject({ status: "failed" });
  expect(h.children[1]!.writes.some(m => m.method === "thread/start" || m.method === "thread/resume" || m.method === "turn/start")).toBe(false);
  expect(h.children[1]!.terminations).toBe(1);
  await task.close();
});
test("foreign-thread hook notifications retain only metadata, never raw hook output", async () => {
  const h = harness(responder);
  const task = await createCodexSessionDriver().startTask(input, h.io);
  await task.nativeSessionId;
  for (const method of ["hook/started", "hook/completed", "hook/future"]) h.children[1]!.stdout({ method, params: { threadId: "foreign-thread", run: { id: "foreign-run", eventName: "stop", entries: [{ kind: "context", text: "PRIVATE_HOOK_STDOUT_SENTINEL" }], stdout: "PRIVATE_HOOK_STDOUT_SENTINEL" } } });
  h.children[1]!.stdout({ id: 0, method: "hook/completed", params: { threadId: "native-thread", run: { id: "malformed-request", stdout: "PRIVATE_HOOK_STDOUT_SENTINEL" } } });
  h.children[1]!.stdout({ id: 1, method: "hook/future", params: { threadId: "native-thread", run: { stdout: "PRIVATE_HOOK_STDOUT_SENTINEL" } } });
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
  test("maps choices and secret free text and only sends answers to RPC", async () => {
    const h = harness(responder); const requests: unknown[] = [];
    h.io.question = async request => { requests.push(request); return { outcome: "answered", answers: { choice: ["A"], secret: ["SECRET_SENTINEL"] } }; };
    const task = await createCodexSessionDriver().startTask({ ...input, approvals: "relay" }, h.io); await task.nativeSessionId;
    const child = h.children[1]!; child.stdout(questionRequest); await Promise.resolve();
    expect(requests).toEqual([{ questionId: "codex:question", questions: [
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
    const child = h.children[1]!; child.stdout(questionRequest); await Promise.resolve();
    expect(child.writes.find(m => m.id === "question")?.result).toEqual(emptyQuestionAnswers);
    expect(JSON.stringify(h.events)).not.toContain("SECRET_SENTINEL"); await task.close();
  });
  test.each([{ threadId: "foreign" }, { turnId: "stale" }])("dismisses stale requests without relaying %j", async override => {
    const h = harness(responder); let calls = 0; h.io.question = async () => { calls++; return { outcome: "dismissed" }; };
    const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId;
    const child = h.children[1]!; child.stdout({ ...questionRequest, params: { ...questionRequest.params, ...override } });
    expect(calls).toBe(0); expect(child.writes.find(m => m.id === "question")?.result).toEqual(emptyQuestionAnswers); await task.close();
  });
  test("deduplicates pending and completed requests and discards answers after interruption", async () => {
    const h = harness(responder); let calls = 0;
    let release!: (v: { outcome: "answered"; answers: Record<string, string[]> }) => void;
    h.io.question = () => { calls++; return new Promise(resolve => { release = resolve; }); };
    const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId;
    const child = h.children[1]!; child.stdout(questionRequest); child.stdout(questionRequest);
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
  const child = h.children[1]!; child.stdout(questionRequest);
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
  const child = h.children[1]!;
  child.responder = m => { if (m.id === "question") throw new Error("SECRET_SENTINEL"); responder(child, 2, m); };
  child.stdout(questionRequest);
  expect(await task.done).toMatchObject({ status: "failed", error: "codex-question-reply-failed" });
  expect(JSON.stringify(h.events)).not.toContain("SECRET_SENTINEL"); await task.close();
});
test("Codex questions support zero request IDs and empty option arrays", async () => {
  const h = harness(responder); let seen: unknown;
  h.io.question = async request => { seen = request; return { outcome: "dismissed" }; };
  const task = await createCodexSessionDriver().startTask(input, h.io); await task.nativeSessionId;
  const child = h.children[1]!; child.stdout({ ...questionRequest, id: 0, params: { ...questionRequest.params, questions: [{ id: "text", header: "Text", question: "Type", options: [] }] } }); await Promise.resolve();
  expect(seen).toMatchObject({ questionId: "codex:0", questions: [{ id: "text", options: [], multiple: false, allowOther: false, secret: false }] });
  expect(child.writes.find(m => m.id === 0)?.result).toEqual({ answers: { text: { answers: [] } } }); await task.close();
});
