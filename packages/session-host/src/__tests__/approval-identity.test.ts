import { expect, test } from "bun:test";
import { ApprovalBroker } from "../approval-broker";
import { FakeClock } from "./test-helpers";

for (const [name, a, b] of [
  ["cwd", '["deploy","/dev"]', '["deploy","/prod"]'],
  ["credentials", '{"token":"dev"}', '{"token":"prod"}'],
  ["long arguments", "x".repeat(600) + "a", "x".repeat(600) + "b"],
  ["patterns", '["a b","c"]', '["a","b c"]'],
]) test(`exact grants distinguish ${name} despite identical display`, async () => {
  const events: any[] = [];
  const broker = new ApprovalBroker({ clock: new FakeClock(), sink: { emit: (_id, draft) => { events.push(draft); } } });
  const request = (identity: string) => broker.request({ sessionId: "s", taskId: "t", tool: "Tool", toolKey: "claude:Tool", exactKey: "same display", identity });
  const first = request(a!);
  expect(broker.respond({ approvalId: first.approvalId, decision: "allow", scope: "session", grant: "exact", by: "u" }).ok).toBe(true);
  await first.resolution;
  const different = request(b!);
  expect(broker.pending().map(p => p.approvalId)).toContain(different.approvalId);
  expect(await request(a!).resolution).toMatchObject({ by: expect.stringContaining("session-grant:") });
  for (const event of events) expect(JSON.stringify(event)).not.toContain('"identity"');
  expect(events.find(e => e.kind === "session.grant").data.matchKey).toMatch(/^[a-f0-9]{64}$/);
  expect(events.filter(e => e.kind !== "session.grant").every(e => !("matchKey" in e.data))).toBe(true);
  broker.dispose();
});

test("missing identity suppresses exact and always; legacy calls default to once", () => {
  const events: any[] = [];
  const broker = new ApprovalBroker({ clock: new FakeClock(), sink: { emit: (_id, draft) => { events.push(draft); } } });
  const request = broker.request({ sessionId: "s", taskId: "t", tool: "Tool", toolKey: "claude:Tool", exactKey: "display", nativeScopes: ["always"] });
  expect(events[0].data).toMatchObject({ grantKinds: ["tool"], allowedScopes: ["once", "session"] });
  expect(broker.respond({ approvalId: request.approvalId, decision: "allow", scope: "session", grant: "exact", by: "u" })).toEqual({ ok: false, code: "approval-scope-unsupported" });
  expect(broker.respond({ approvalId: request.approvalId, decision: "allow", scope: "always", confirmed: true, by: "u" })).toEqual({ ok: false, code: "approval-scope-unsupported" });
  const legacy = broker.request({ sessionId: "s", taskId: "t", tool: "Tool" });
  expect(events.at(-1).data).toMatchObject({ grantKinds: [], allowedScopes: ["once"] });
  expect(broker.respond({ approvalId: legacy.approvalId, decision: "allow", by: "u" })).toMatchObject({ ok: true, resolution: { scope: "once" } });
  broker.dispose();
});

test("identity and display bounds reject without echoing values", () => {
  const events: any[] = [];
  const broker = new ApprovalBroker({ clock: new FakeClock(), sink: { emit: (_id, draft) => { events.push(draft); } } });
  for (const fields of [{ identity: "x".repeat(16385) }, { identity: "é".repeat(8193) }, { exactKey: "x".repeat(4097) }]) {
    expect(() => broker.request({ sessionId: "s", taskId: "t", tool: "Tool", ...fields })).toThrow("approval-request-invalid");
  }
  expect(events).toEqual([]);
});

test("existing exact grants cannot auto-approve a shortened or absent display", async () => {
  const events: any[] = [];
  const broker = new ApprovalBroker({ clock: new FakeClock(), sink: { emit: (_id, draft) => { events.push(draft); } } });
  const fields = { sessionId: "s", taskId: "t", tool: "Tool", toolKey: "claude:Tool", identity: "full-action", exactKey: "visible action" };
  const first = broker.request(fields);
  expect(broker.respond({ approvalId: first.approvalId, decision: "allow", scope: "session", grant: "exact", by: "u" }).ok).toBe(true);
  await first.resolution;
  for (const exactKey of ["x".repeat(513), undefined]) {
    const next = broker.request({ ...fields, exactKey, nativeScopes: ["always"] });
    expect(broker.pending().map(p => p.approvalId)).toContain(next.approvalId);
    expect(events.at(-1).data.grantKinds).toEqual(["tool"]);
  }
  broker.dispose();
});
