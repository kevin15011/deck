import { describe, expect, test } from "bun:test";
import { SESSION_EVENT_KINDS, validateSessionEvent, boundRaw, RAW_PAYLOAD_LIMIT_BYTES } from "./events";

const base = () => ({
  v: 1, sessionId: "s1", seq: 1, ts: "2026-10-12T00:00:00.000Z", kind: "session.created",
  source: {}, data: {},
});

describe("validateSessionEvent", () => {
  test("accepts a valid envelope", () => {
    expect(validateSessionEvent(base()).ok).toBe(true);
  });
  test("rejects unknown kind", () => {
    const r = validateSessionEvent({ ...base(), kind: "nope" });
    expect(r.ok).toBe(false);
  });
  test("accepts runner.unmapped with raw", () => {
    const r = validateSessionEvent({
      ...base(), kind: "runner.unmapped",
      raw: { runnerId: "codex", protocol: "codex-app-server", payload: { a: 1 }, truncated: false },
    });
    expect(r.ok).toBe(true);
  });
  test.each([0, -1, 1.5, "1", NaN])("rejects invalid seq %p", (seq) => {
    expect(validateSessionEvent({ ...base(), seq }).ok).toBe(false);
  });
  test("rejects wrong version, bad ts, missing source/data", () => {
    expect(validateSessionEvent({ ...base(), v: 2 }).ok).toBe(false);
    expect(validateSessionEvent({ ...base(), ts: "yesterday" }).ok).toBe(false);
    expect(validateSessionEvent({ ...base(), source: undefined }).ok).toBe(false);
    expect(validateSessionEvent({ ...base(), data: [] }).ok).toBe(false);
    expect(validateSessionEvent(null).ok).toBe(false);
  });
  test("rejects non-string source ids and malformed raw", () => {
    expect(validateSessionEvent({ ...base(), source: { memberId: 3 } }).ok).toBe(false);
    expect(validateSessionEvent({ ...base(), raw: { runnerId: "x" } }).ok).toBe(false);
  });
  test("per-kind data: turn.completed requires valid status", () => {
    const ok = { ...base(), kind: "turn.completed", data: { status: "interrupted-forced" } };
    expect(validateSessionEvent(ok).ok).toBe(true);
    expect(validateSessionEvent({ ...ok, data: { status: "weird" } }).ok).toBe(false);
  });
  test("per-kind data: approval.requested needs approvalId", () => {
    expect(validateSessionEvent({ ...base(), kind: "approval.requested", data: {} }).ok).toBe(false);
    expect(validateSessionEvent({ ...base(), kind: "approval.requested", data: { approvalId: "a" } }).ok).toBe(true);
  });
  test("per-kind data: command.accepted needs commandId, type and an outcome", () => {
    const data = { commandId: "c", type: "prompt.send", outcome: { ok: true } };
    expect(validateSessionEvent({ ...base(), kind: "command.accepted", data }).ok).toBe(true);
    expect(validateSessionEvent({ ...base(), kind: "command.accepted", data: { type: "prompt.send", outcome: { ok: true } } }).ok).toBe(false);
    expect(validateSessionEvent({ ...base(), kind: "command.accepted", data: { commandId: "c", type: "prompt.send" } }).ok).toBe(false);
  });
  test("hook lifecycle requires bounded identity, native provenance and explicit status", () => {
    const data = { hookId: "h1", hookEvent: "sessionStart", provenance: "codex-app-server", status: "running" };
    expect(validateSessionEvent({ ...base(), kind: "hook.started", data }).ok).toBe(true);
    expect(validateSessionEvent({ ...base(), kind: "hook.completed", data: { ...data, status: "completed", durationMs: 42, provider: "supermemory", integration: "runner-plugin" } }).ok).toBe(true);
    for (const change of [{ hookId: "" }, { hookId: "x".repeat(257) }, { hookEvent: "x".repeat(129) }, { provenance: "inferred" }, { status: "saved" }, { durationMs: -1 }, { provider: "supermemory" }, { integration: "runner-plugin" }, { hookName: "x".repeat(501) }]) expect(validateSessionEvent({ ...base(), kind: "hook.completed", data: { ...data, ...change } }).ok).toBe(false);
  });
  test("kind union covers all design kinds", () => {
    expect(SESSION_EVENT_KINDS).toContain("runner.unmapped");
    expect(SESSION_EVENT_KINDS).toContain("command.accepted");
    expect(SESSION_EVENT_KINDS).toContain("hook.started");
    expect(SESSION_EVENT_KINDS).toContain("hook.completed");
    expect(SESSION_EVENT_KINDS.length).toBe(44);
  });
});

describe("boundRaw", () => {
  test("keeps small payloads and marks truncated=false", () => {
    const r = boundRaw({ runnerId: "claude", protocol: "claude-stream-json", payload: { hi: "there" } });
    expect(r.truncated).toBe(false);
    expect(r.payload).toEqual({ hi: "there" });
  });
  test("truncates payloads over 64 KiB and sets flag", () => {
    const r = boundRaw({ runnerId: "claude", protocol: "claude-stream-json", payload: { big: "x".repeat(100_000) } });
    expect(r.truncated).toBe(true);
    expect(typeof r.payload).toBe("string");
    expect((r.payload as string).length).toBeLessThanOrEqual(RAW_PAYLOAD_LIMIT_BYTES);
  });
  test("redacts secrets before bounding", () => {
    const r = boundRaw({ runnerId: "claude", protocol: "claude-stream-json", payload: { token: "abc123secret" } });
    expect(JSON.stringify(r.payload)).not.toContain("abc123secret");
  });
});

test("question events require a questionId", () => {
  for (const kind of ["question.requested", "question.resolved"]) {
    const event = { v: 1, sessionId: "s", seq: 1, ts: "2026-10-12T00:00:00Z", kind, source: {}, data: {} };
    expect(validateSessionEvent(event).ok).toBe(false);
    expect(validateSessionEvent({ ...event, data: { questionId: "q", ...(kind === "question.resolved" ? { outcome: "answered", by: "user" } : {}) } }).ok).toBe(true);
  }
});

test("approval mode events validate explicit modes and actor", () => {
  for (const mode of ["relay", "yolo"]) {
    expect(validateSessionEvent({ ...base(), data: { approvals: mode } }).ok).toBe(true);
    expect(validateSessionEvent({ ...base(), kind: "session.approvals", data: { mode, by: "client" } }).ok).toBe(true);
  }
  for (const mode of ["runner-default", "", null]) {
    expect(validateSessionEvent({ ...base(), data: { approvals: mode } }).ok).toBe(false);
    expect(validateSessionEvent({ ...base(), kind: "session.approvals", data: { mode, by: "client" } }).ok).toBe(false);
  }
  expect(validateSessionEvent({ ...base(), kind: "session.approvals", data: { mode: "relay" } }).ok).toBe(false);
});

test("resolved question answers are bounded and only allowed for answered outcomes", () => {
  const event = (data: object) => ({ ...base(), kind: "question.resolved", data: { questionId: "r", outcome: "answered", by: "user", ...data } });
  expect(validateSessionEvent(event({ answers: { q1: ["visible"] } })).ok).toBe(true);
  expect(validateSessionEvent(event({ answers: {} })).ok).toBe(true);
  expect(validateSessionEvent(event({ answers: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`q${i}`, Array(12).fill("a".repeat(4000))])) })).ok).toBe(true);
  for (const answers of [null, [], { q1: [] }, { q1: [1] }, { q1: Array(13).fill("A") }, { q1: ["a".repeat(4001)] }, { "bad\n": ["A"] }, Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`q${i}`, ["A"]]))]) expect(validateSessionEvent(event({ answers })).ok).toBe(false);
  for (const outcome of ["dismissed", "cancelled"]) {
    expect(validateSessionEvent(event({ outcome })).ok).toBe(true);
    expect(validateSessionEvent(event({ outcome, answers: {} })).ok).toBe(false);
  }
});

test("approval event extensions validate scopes, safe keys, risk and grants", () => {
  const event = (kind: string, data: object) => validateSessionEvent({ ...base(), kind, data }).ok;
  expect(event("approval.requested", { approvalId: "a", allowedScopes: ["once", "session"], toolKey: "claude:Bash", exactKey: "ls", risk: "high" })).toBe(true);
  for (const data of [{ allowedScopes: ["session"] }, { allowedScopes: ["once", "once"] }, { risk: "low" }, { toolKey: "Bash" }, { exactKey: "x".repeat(513) }]) expect(event("approval.requested", { approvalId: "a", ...data })).toBe(false);
  expect(event("approval.resolved", { approvalId: "a", scope: "session", auto: true })).toBe(true);
  expect(event("approval.resolved", { approvalId: "a", scope: "forever" })).toBe(false);
  const grant = { action: "added", grantId: "g", kind: "exact", toolKey: "claude:Bash", exactKey: "ls", risk: "high", by: "u" };
  expect(event("session.grant", grant)).toBe(true);
  expect(event("session.grant", { ...grant, exactKey: undefined })).toBe(false);
});
