/**
 * deck-session-event-v1 — pure, provider-neutral event envelope and validators (XR-1.1–1.4).
 * No Node, network, or filesystem APIs.
 */
import { redactText } from "./redaction";

export const SESSION_EVENT_VERSION = 1 as const;
export const RAW_PAYLOAD_LIMIT_BYTES = 64 * 1024;

export const SESSION_EVENT_KINDS = [
  "session.created", "session.bound", "session.state", "session.ended", "session.recovered",
  "task.created", "task.state", "task.continued", "task.result",
  "turn.started", "turn.completed",
  "message.delta", "message.completed", "reasoning.delta", "tool.started", "tool.completed",
  "approval.requested", "approval.resolved", "memory.recalled", "memory.proposed", "memory.written",
  "usage", "rate-limit", "diagnostic", "runner.unmapped", "client.attached", "client.detached",
] as const;
export type SessionEventKind = (typeof SESSION_EVENT_KINDS)[number];

export type DriverProtocol = "claude-stream-json" | "codex-app-server" | "opencode-serve";
export const TURN_COMPLETED_STATUSES = ["completed", "interrupted", "interrupted-forced", "failed"] as const;

export type SessionEventSource = { memberId?: string; taskId?: string; runnerId?: string; nativeSessionId?: string };
export type SessionEventRaw = { runnerId: string; protocol: DriverProtocol | string; payload: unknown; truncated: boolean };
export type SessionEvent = {
  v: 1; sessionId: string; seq: number; ts: string; kind: SessionEventKind;
  source: SessionEventSource; data: Record<string, unknown>; raw?: SessionEventRaw;
};

export type SessionValidation<T> = { ok: true; value: T } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const KINDS = new Set<string>(SESSION_EVENT_KINDS);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

/** Kind-specific data checks; kinds not listed accept any object. */
const DATA_RULES: Partial<Record<SessionEventKind, (d: Record<string, unknown>) => string | null>> = {
  "turn.completed": (d) => (TURN_COMPLETED_STATUSES as readonly string[]).includes(d.status as string) ? null : "data.status invalid",
  "approval.requested": (d) => isStr(d.approvalId) ? null : "data.approvalId required",
  "approval.resolved": (d) => isStr(d.approvalId) ? null : "data.approvalId required",
  "task.created": (d) => isStr(d.taskId) ? null : "data.taskId required",
  "diagnostic": (d) => isStr(d.code) ? null : "data.code required",
};

export function validateSessionEvent(input: unknown): SessionValidation<SessionEvent> {
  const errors: string[] = [];
  if (!isObj(input)) return { ok: false, errors: ["event must be an object"] };
  if (input.v !== SESSION_EVENT_VERSION) errors.push("v must be 1");
  if (!isStr(input.sessionId)) errors.push("sessionId required");
  if (!Number.isInteger(input.seq) || (input.seq as number) < 1) errors.push("seq must be an integer >= 1");
  if (typeof input.ts !== "string" || !ISO.test(input.ts) || Number.isNaN(Date.parse(input.ts))) errors.push("ts must be ISO 8601");
  if (typeof input.kind !== "string" || !KINDS.has(input.kind)) errors.push("unknown kind");
  if (!isObj(input.source)) errors.push("source must be an object");
  else for (const k of ["memberId", "taskId", "runnerId", "nativeSessionId"])
    if (input.source[k] !== undefined && typeof input.source[k] !== "string") errors.push(`source.${k} must be a string`);
  if (!isObj(input.data)) errors.push("data must be an object");
  else if (typeof input.kind === "string" && KINDS.has(input.kind)) {
    const msg = DATA_RULES[input.kind as SessionEventKind]?.(input.data);
    if (msg) errors.push(msg);
  }
  if (input.raw !== undefined) {
    const r = input.raw;
    if (!isObj(r) || !isStr(r.runnerId) || !isStr(r.protocol) || typeof r.truncated !== "boolean" || !("payload" in r))
      errors.push("raw must be {runnerId, protocol, payload, truncated}");
  }
  return errors.length ? { ok: false, errors } : { ok: true, value: input as unknown as SessionEvent };
}

/** Redact and bound a raw payload before persistence (XR-1.3). */
export function boundRaw(
  input: { runnerId: string; protocol: DriverProtocol | string; payload: unknown },
  limit = RAW_PAYLOAD_LIMIT_BYTES,
): SessionEventRaw {
  let json: string;
  try { json = JSON.stringify(input.payload) ?? "null"; } catch { json = String(input.payload); }
  const redacted = redactText(json, Number.MAX_SAFE_INTEGER);
  const truncated = json.length > limit || redacted.length > limit || json.length > 256 * 1024;
  if (!truncated) {
    try { return { runnerId: input.runnerId, protocol: input.protocol, payload: JSON.parse(redacted), truncated: false }; } catch { /* fall through to string form */ }
  }
  return { runnerId: input.runnerId, protocol: input.protocol, payload: redacted.slice(0, limit), truncated };
}
