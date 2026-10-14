import { describe, expect, test } from "bun:test";
import type { EventDraft } from "../event-log";
import { APPROVAL_TIMEOUT_MS, ApprovalBroker } from "../approval-broker";
import { FakeClock } from "./test-helpers";

function setup(options: { timeoutMs?: number } = {}) {
  const clock = new FakeClock();
  const events: Array<{ sessionId: string } & EventDraft> = [];
  let n = 0;
  const broker = new ApprovalBroker({
    sink: { emit: (sessionId, draft) => { events.push({ sessionId, ...draft }); } },
    clock, newId: () => `ap-${++n}`, ...options,
  });
  const req = (over: Record<string, unknown> = {}) => broker.request({ sessionId: "s-1", taskId: "t-1", memberId: "lead", runnerId: "claude", tool: "Bash", input: { command: "ls -la" }, ...over });
  return { clock, events, broker, req };
}

describe("ApprovalBroker (XR-5.1, XR-5.2)", () => {
  test("request emits approval.requested {approvalId, taskId, tool, summary, input} and stays pending", async () => {
    const { events, req, broker } = setup();
    const r = req();
    expect(r.approvalId).toBe("ap-1");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ sessionId: "s-1", kind: "approval.requested", source: { taskId: "t-1", memberId: "lead", runnerId: "claude" } });
    expect(events[0]!.data).toMatchObject({ approvalId: "ap-1", taskId: "t-1", tool: "Bash", input: { command: "ls -la" } });
    expect(typeof events[0]!.data!.summary).toBe("string");
    expect(broker.pending().map((p) => p.approvalId)).toEqual(["ap-1"]);
    const settled = await Promise.race([r.resolution.then(() => "resolved"), Promise.resolve("pending")]);
    expect(settled).toBe("pending");
  });

  test("allow resolves allow-once and records who answered", async () => {
    const { events, req, broker } = setup();
    const r = req();
    const out = broker.respond({ approvalId: r.approvalId, decision: "allow", by: "device-1" });
    expect(out).toEqual({ ok: true, resolution: { approvalId: "ap-1", decision: "allow-once", by: "device-1" } });
    expect(await r.resolution).toEqual({ approvalId: "ap-1", decision: "allow-once", by: "device-1" });
    expect(events.at(-1)).toMatchObject({ kind: "approval.resolved", data: { approvalId: "ap-1", decision: "allow-once", by: "device-1" } });
    expect(broker.pending()).toEqual([]);
  });

  test("deny resolves deny; allow-once is accepted as a synonym of allow", async () => {
    const { req, broker } = setup();
    const a = req(), b = req();
    broker.respond({ approvalId: a.approvalId, decision: "deny", by: "d" });
    broker.respond({ approvalId: b.approvalId, decision: "allow-once", by: "d" });
    expect((await a.resolution).decision).toBe("deny");
    expect((await b.resolution).decision).toBe("allow-once");
  });

  test("first response wins; the second gets already-resolved and emits nothing (two clients)", async () => {
    const { events, req, broker } = setup();
    const r = req();
    expect(broker.respond({ approvalId: r.approvalId, decision: "deny", by: "phone" }).ok).toBe(true);
    const count = events.length;
    expect(broker.respond({ approvalId: r.approvalId, decision: "allow", by: "laptop" })).toEqual({ ok: false, code: "already-resolved" });
    expect(events).toHaveLength(count);
    expect((await r.resolution).by).toBe("phone");
  });

  test("an unknown approval id is reported as such", () => {
    const { broker } = setup();
    expect(broker.respond({ approvalId: "nope", decision: "allow", by: "x" })).toEqual({ ok: false, code: "unknown-approval" });
  });

  test("an unanswered approval denies after 15 minutes with by=timeout", async () => {
    const { clock, events, req, broker } = setup();
    expect(APPROVAL_TIMEOUT_MS).toBe(15 * 60 * 1000);
    const r = req();
    clock.advance(APPROVAL_TIMEOUT_MS - 1);
    expect(broker.pending()).toHaveLength(1);
    clock.advance(1);
    expect(await r.resolution).toEqual({ approvalId: "ap-1", decision: "deny", by: "timeout" });
    expect(events.at(-1)).toMatchObject({ kind: "approval.resolved", data: { decision: "deny", by: "timeout" } });
    // a late answer cannot revive it
    expect(broker.respond({ approvalId: r.approvalId, decision: "allow", by: "late" })).toEqual({ ok: false, code: "already-resolved" });
  });

  test("answering clears the timeout timer", () => {
    const { clock, req, broker } = setup();
    const r = req();
    expect(clock.pending).toBe(1);
    broker.respond({ approvalId: r.approvalId, decision: "allow", by: "d" });
    expect(clock.pending).toBe(0);
  });

  test("the timeout is configurable", async () => {
    const { clock, req } = setup({ timeoutMs: 1000 });
    const r = req();
    clock.advance(1000);
    expect((await r.resolution).by).toBe("timeout");
  });

  test("approvals are independent", async () => {
    const { clock, req, broker } = setup({ timeoutMs: 1000 });
    const a = req();
    clock.advance(600);
    const b = req({ taskId: "t-2" });
    clock.advance(400);
    expect((await a.resolution).by).toBe("timeout");
    expect(broker.pending().map((p) => p.approvalId)).toEqual([b.approvalId]);
  });

  test("cancelTask denies that task's approvals only (task ended / interrupted)", async () => {
    const { events, req, broker } = setup();
    const a = req({ taskId: "t-1" }), b = req({ taskId: "t-2" });
    expect(broker.cancelTask("s-1", "t-1", "task-ended")).toBe(1);
    expect(await a.resolution).toEqual({ approvalId: a.approvalId, decision: "deny", by: "task-ended" });
    expect(broker.pending().map((p) => p.approvalId)).toEqual([b.approvalId]);
    expect(events.filter((e) => e.kind === "approval.resolved")).toHaveLength(1);
  });

  test("dispose denies everything so no child waits forever", async () => {
    const { req, broker, clock } = setup();
    const a = req(), b = req({ sessionId: "s-2" });
    broker.dispose();
    expect((await a.resolution).by).toBe("shutdown");
    expect((await b.resolution).by).toBe("shutdown");
    expect(clock.pending).toBe(0);
  });

  test("secrets in tool input are redacted before they reach the event log", () => {
    const { events, req } = setup();
    req({ input: { command: "curl -H 'Authorization: Bearer sk-abcdef123456' https://x", api_key: "supersecretvalue" } });
    const text = JSON.stringify(events[0]);
    expect(text).not.toContain("sk-abcdef123456");
    expect(text).not.toContain("supersecretvalue");
  });

  test("oversized input is bounded", () => {
    const { events, req } = setup();
    req({ input: { blob: "z".repeat(500_000) } });
    expect(JSON.stringify(events[0]).length).toBeLessThan(80_000);
  });

  test("the summary describes the tool call without echoing a whole payload", () => {
    const { events, req } = setup();
    req({ tool: "Bash", input: { command: "rm -rf build" } });
    expect(String(events[0]!.data!.summary)).toContain("Bash");
    expect(String(events[0]!.data!.summary)).toContain("rm -rf build");
  });

  test("a failing event sink never strands the requester on timeout", async () => {
    const clock = new FakeClock();
    let fail = false;
    const broker = new ApprovalBroker({ sink: { emit: () => { if (fail) throw new Error("disk full"); } }, clock });
    const r = broker.request({ sessionId: "s", taskId: "t", tool: "Bash" });
    fail = true;
    clock.advance(APPROVAL_TIMEOUT_MS);
    expect((await r.resolution).by).toBe("timeout");
  });
});
