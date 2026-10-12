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
  test("kind union covers all design kinds", () => {
    expect(SESSION_EVENT_KINDS).toContain("runner.unmapped");
    expect(SESSION_EVENT_KINDS).toContain("command.accepted");
    expect(SESSION_EVENT_KINDS.length).toBe(28);
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
