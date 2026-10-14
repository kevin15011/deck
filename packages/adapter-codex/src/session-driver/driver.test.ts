import { describe, expect, test } from "bun:test";
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
