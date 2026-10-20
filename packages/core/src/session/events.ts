import { isApprovalScope, isApprovalRisk, isApprovalToolKey, isSessionGrantKind } from "./approval";
import {validSteeringFence,validSteeringResult} from "./steering";
import { validDecisionMutation, validDecisionReply, validDecisionCommand } from "./decisions";
/**
 * deck-session-event-v1 — pure, provider-neutral event envelope and validators (XR-1.1–1.4).
 * No Node, network, or filesystem APIs.
 */
import { isQuestionAnswers } from "./question";
import { isApprovalMode } from "./commands";
import { validTaskAccounting, validTaskIntegration } from "./mcp";
import { redactText } from "./redaction";

export const SESSION_EVENT_VERSION = 1 as const;
export const RAW_PAYLOAD_LIMIT_BYTES = 64 * 1024;

export const SESSION_EVENT_KINDS = [
  "session.created", "session.bound", "session.state", "session.ended", "session.recovered", "session.assignment", "session.approvals", "session.grant", "session.successor", "session.released", "session.reopened", "session.renamed", "session.removed",
  "task.created", "task.state", "task.continued", "task.result", "task.delivery", "task.retrieval", "task.integration",
  "turn.started", "turn.completed",
  "message.delta", "message.completed", "reasoning.delta", "tool.started", "tool.completed",
  "hook.started", "hook.completed",
  "question.requested", "question.resolved",
  "approval.requested", "approval.resolved", "memory.recalled", "memory.proposed", "memory.written",
  "usage", "rate-limit", "diagnostic", "runner.unmapped", "client.attached", "client.detached",
  /** Durable idempotency receipt: a command was accepted and its outcome is recorded (XR-1.5, survives daemon restart). */
  "command.accepted",
  "decision.command", "decision.opened", "decision.revised", "decision.state", "decision.reply",
  "prompt.steering", "prompt.steered", "prompt.queued", "prompt.dispatched", "prompt.state", "prompt.queue",
] as const;
export type SessionEventKind = (typeof SESSION_EVENT_KINDS)[number];

/** Driver wire protocol id (e.g. "claude-stream-json"); concrete values are declared by drivers, not core. */
export type DriverProtocol = string;
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
export const HOOK_STATUSES = ["running", "completed", "failed", "blocked", "stopped", "unknown"] as const;
const hookData = (d: Record<string, unknown>): string | null => {
  for (const [key, limit] of [["hookId", 256], ["hookEvent", 128]] as const) if (!isStr(d[key]) || (d[key] as string).length > limit) return `data.${key} invalid`;
  if (d.hookName !== undefined && (typeof d.hookName !== "string" || d.hookName.length > 500)) return "data.hookName invalid";
  if (!(HOOK_STATUSES as readonly unknown[]).includes(d.status)) return "data.status invalid";
  if (!["claude-stream-json", "codex-app-server"].includes(d.provenance as string)) return "data.provenance invalid";
  if (d.durationMs !== undefined && (typeof d.durationMs !== "number" || !Number.isFinite(d.durationMs) || d.durationMs < 0)) return "data.durationMs invalid";
  if (d.executionMode !== undefined && !["sync", "async"].includes(d.executionMode as string)) return "data.executionMode invalid";
  if (d.handlerType !== undefined && !["command", "mcpTool", "prompt", "agent"].includes(d.handlerType as string)) return "data.handlerType invalid";
  if ((d.provider !== undefined || d.integration !== undefined) && (d.provider !== "supermemory" || d.integration !== "runner-plugin")) return "data.provider/integration invalid";
  return null;
};

/** Kind-specific data checks; kinds not listed accept any object. */
const DATA_RULES: Partial<Record<SessionEventKind, (d: Record<string, unknown>) => string | null>> = {
  "session.created": (d) => d.approvals === undefined || isApprovalMode(d.approvals) ? null : "data.approvals invalid",
  "session.approvals": (d) => !isApprovalMode(d.mode) ? "data.mode invalid" : !isStr(d.by) ? "data.by required" : null,
  "prompt.steering": d => validSteeringFence(d) ? null : "steering fence invalid",
  "prompt.steered": d => validSteeringResult(d) ? null : "steering outcome invalid",
  "decision.command": d => validDecisionCommand(d.command) ? null : "decision command invalid",
  "decision.opened": d => validDecisionMutation(d) ? null : "decision mutation invalid",
  "decision.revised": d => validDecisionMutation(d) ? null : "decision mutation invalid",
  "decision.state": d => validDecisionMutation(d) ? null : "decision mutation invalid",
  "decision.reply": d => validDecisionReply(d) ? null : "decision reply invalid",
  "task.delivery": d => validTaskAccounting(d) ? null : "data task accounting invalid",
  "task.retrieval": d => validTaskAccounting(d) ? null : "data task accounting invalid",
  "task.integration": d => validTaskAccounting(d) && validTaskIntegration(d) ? null : "data task integration invalid",
  "hook.started": hookData,
  "hook.completed": hookData,
  "turn.completed": (d) => (TURN_COMPLETED_STATUSES as readonly string[]).includes(d.status as string) ? null : "data.status invalid",
  "approval.requested": (d) => !isStr(d.approvalId) ? "data.approvalId required" : d.allowedScopes !== undefined && (!Array.isArray(d.allowedScopes) || !d.allowedScopes.includes("once") || d.allowedScopes.length > 3 || new Set(d.allowedScopes).size !== d.allowedScopes.length || !d.allowedScopes.every(isApprovalScope)) ? "data.allowedScopes invalid" : d.exactKeyTruncated !== undefined && typeof d.exactKeyTruncated !== "boolean" ? "data.exactKeyTruncated invalid" : d.grantKinds !== undefined && (!Array.isArray(d.grantKinds) || d.grantKinds.length > 2 || new Set(d.grantKinds).size !== d.grantKinds.length || !d.grantKinds.every(isSessionGrantKind)) ? "data.grantKinds invalid" : d.toolKey !== undefined && !isApprovalToolKey(d.toolKey) ? "data.toolKey invalid" : d.risk !== undefined && !isApprovalRisk(d.risk) ? "data.risk invalid" : d.exactKey !== undefined && (typeof d.exactKey !== "string" || !d.exactKey.length || d.exactKey.length > 512) ? "data.exactKey invalid" : d.alwaysNote !== undefined && (typeof d.alwaysNote !== "string" || d.alwaysNote.length > 1000) ? "data.alwaysNote invalid" : null,
  "approval.resolved": (d) => !isStr(d.approvalId) ? "data.approvalId required" : d.scope !== undefined && !isApprovalScope(d.scope) ? "data.scope invalid" : d.auto !== undefined && typeof d.auto !== "boolean" ? "data.auto invalid" : null,
  "session.grant": (d) => !["added", "revoked"].includes(d.action as string) || !isStr(d.grantId) || !isSessionGrantKind(d.kind) || !isApprovalToolKey(d.toolKey) || !isApprovalRisk(d.risk) || !isStr(d.by) || d.exactKey !== undefined && (typeof d.exactKey !== "string" || !d.exactKey.length || d.exactKey.length > 512) || d.matchKey !== undefined && (typeof d.matchKey !== "string" || !/^[a-f0-9]{64}$/.test(d.matchKey)) || d.kind === "exact" && !isStr(d.exactKey) ? "data.grant invalid" : null,
  "question.requested": (d) => isStr(d.questionId) ? null : "data.questionId required",
  "question.resolved": (d) => !isStr(d.questionId) ? "data.questionId required"
    : !["answered", "dismissed", "cancelled"].includes(d.outcome as string) ? "data.outcome invalid"
    : !isStr(d.by) ? "data.by required"
    : Object.hasOwn(d, "answers") && (d.outcome !== "answered" || !isQuestionAnswers(d.answers)) ? "data.answers invalid" : null,
  "task.created": (d) => isStr(d.taskId) ? null : "data.taskId required",
  "diagnostic": (d) => isStr(d.code) ? null : "data.code required",
  "command.accepted": (d) => !isStr(d.commandId) ? "data.commandId required" : !isStr(d.type) ? "data.type required" : !isObj(d.outcome) || typeof d.outcome.ok !== "boolean" ? "data.outcome required" : null,
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
