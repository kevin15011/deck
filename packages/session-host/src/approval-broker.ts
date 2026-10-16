import { matchesGrant, validateApprovalResponse, isApprovalToolKey, isApprovalRisk, type ApprovalScope, type ApprovalRisk, type ApprovalResponse, type SessionGrantKind, type SessionGrant } from "@deck/core/session/approval";
/**
 * ApprovalBroker (XR-5.1, XR-5.2, design 7): turns a runner's permission prompt into an
 * `approval.requested` event and blocks the requester until a client answers, the timeout
 * denies it, or the task/daemon ends. First valid response wins.
 */
import { boundRaw, RAW_PAYLOAD_LIMIT_BYTES } from "@deck/core/session/events";
import { redactText } from "@deck/core/session/redaction";
import { randomUUID, createHmac, randomBytes } from "node:crypto";
import { systemClock, type Clock, type TimerHandle } from "./clock";
import type { EventDraft } from "./event-log";

export const APPROVAL_TIMEOUT_MS = 15 * 60 * 1000;
const RESOLVED_MEMORY = 1000;
const SUMMARY_LIMIT = 300;

export type ApprovalDecision = "allow-once" | "deny";
export type ApprovalRequest = {
  sessionId: string; taskId: string; memberId?: string; runnerId?: string;
  tool: string; summary?: string; input?: unknown;
  toolKey?: string; identity?: string; exactKey?: string; risk?: ApprovalRisk; nativeScopes?: readonly ("always")[]; alwaysNote?: string;
};
export type ApprovalResolution = { approvalId: string; decision: ApprovalDecision; by: string; scope: ApprovalScope };
export type RespondResult = { ok: true; resolution: ApprovalResolution } | { ok: false; code: "already-resolved" | "unknown-approval" | "approval-scope-unsupported" | "approval-confirmation-required" };
export type PendingApproval = { approvalId: string; sessionId: string; taskId: string };

export interface ApprovalEventSink {
  emit(sessionId: string, draft: EventDraft): void;
}

export type ApprovalBrokerOptions = {
  sink: ApprovalEventSink;
  clock?: Clock;
  timeoutMs?: number;
  newId?: () => string;
};

type Entry = {
  request: Omit<ApprovalRequest, "identity"> & { risk: ApprovalRisk; allowedScopes: ApprovalScope[]; grantKinds: SessionGrantKind[]; exactKeyTruncated?: boolean; matchKey?: string }; approvalId: string; timer: TimerHandle;
  resolve: (r: ApprovalResolution) => void;
};

/** Core's `approval.respond` uses allow|deny; events and drivers use allow-once|deny. */
const normalize = (decision: "allow" | "allow-once" | "deny"): ApprovalDecision => (decision === "deny" ? "deny" : "allow-once");

function summarize(tool: string, input: unknown): string {
  let detail = "";
  if (input && typeof input === "object") {
    const o = input as Record<string, unknown>;
    const pick = o.command ?? o.file_path ?? o.path ?? o.url ?? o.pattern;
    detail = typeof pick === "string" ? pick : "";
  }
  return redactText(detail ? `${tool}: ${detail}` : tool, SUMMARY_LIMIT);
}

export class ApprovalBroker {
  private readonly grantsBySession = new Map<string, SessionGrant[]>();
  private readonly sessionKeys = new Map<string, Uint8Array>();
  private sessionKeyProvider?: (sessionId: string) => Uint8Array;
  setSessionKeyProvider(provider: (sessionId: string) => Uint8Array): void { this.sessionKeyProvider = provider; }
  private sessionKey(sessionId: string): Uint8Array {
    if (this.sessionKeyProvider) return this.sessionKeyProvider(sessionId);
    let key = this.sessionKeys.get(sessionId);
    if (!key) { key = randomBytes(32); this.sessionKeys.set(sessionId, key); }
    return key;
  }
  private grantProvider?: (sessionId: string) => readonly SessionGrant[];

  /** The host ledger owns durable grants; standalone brokers use the local projection. */
  setGrantProvider(provider: (sessionId: string) => readonly SessionGrant[]): void { this.grantProvider = provider; }
  grants(sessionId: string): SessionGrant[] { return structuredClone([...(this.grantProvider?.(sessionId) ?? this.grantsBySession.get(sessionId) ?? [])]); }
  revokeGrant(sessionId: string, grantId: string, by: string): boolean {
    const grant = this.grants(sessionId).find(g => g.grantId === grantId);
    if (!grant) return false;
    const { createdAt: _, ...data } = grant;
    this.options.sink.emit(sessionId, { kind: "session.grant", data: { ...data, ...(data.exactKey ? { exactKey: redactText(data.exactKey, 512) } : {}), action: "revoked", by } });
    if (!this.grantProvider) this.grantsBySession.set(sessionId, this.grants(sessionId).filter(g => g.grantId !== grantId));
    return true;
  }

  private readonly pendingById = new Map<string, Entry>();
  private readonly resolvedIds: string[] = [];
  private readonly resolvedSet = new Set<string>();
  private readonly clock: Clock;
  private readonly timeoutMs: number;

  constructor(private readonly options: ApprovalBrokerOptions) {
    this.clock = options.clock ?? systemClock;
    this.timeoutMs = options.timeoutMs ?? APPROVAL_TIMEOUT_MS;
  }

  request(request: ApprovalRequest): { approvalId: string; resolution: Promise<ApprovalResolution> } {
    if (request.toolKey !== undefined && (!isApprovalToolKey(request.toolKey) || request.runnerId && !request.toolKey.startsWith(`${request.runnerId}:`)) || request.risk !== undefined && !isApprovalRisk(request.risk)) throw new Error("approval-request-invalid");
    if (request.identity !== undefined && (typeof request.identity !== "string" || !request.identity.length || Buffer.byteLength(request.identity, "utf8") > 16 * 1024) || request.exactKey !== undefined && (typeof request.exactKey !== "string" || request.exactKey.length > 4096)) throw new Error("approval-request-invalid");
    const display = request.exactKey ? redactText(request.exactKey, 4096) : undefined;
    const exactKeyTruncated = !!display && display.length > 512;
    const exactKey = display?.slice(0, 512);
    const matchKey = request.identity && request.toolKey ? createHmac("sha256", this.sessionKey(request.sessionId)).update(request.toolKey + "\0" + request.identity).digest("hex") : undefined;
    const grantKinds: SessionGrantKind[] = request.toolKey ? [...(matchKey && exactKey && !exactKeyTruncated ? ["exact" as const] : []), "tool"] : [];
    const allowedScopes: ApprovalScope[] = ["once", ...(request.toolKey ? ["session" as const] : []), ...(request.identity && !exactKeyTruncated && request.nativeScopes?.includes("always") ? ["always" as const] : [])];
    // Never retain raw identity in pending state or spread it into an event.
    const { identity: _, ...safeRequest } = request;
    const normalized = { ...safeRequest, risk: request.risk ?? "normal", allowedScopes, grantKinds, exactKey, exactKeyTruncated, matchKey };
    const approvalId = (this.options.newId ?? randomUUID)();
    let resolve!: (r: ApprovalResolution) => void;
    const resolution = new Promise<ApprovalResolution>((res) => { resolve = res; });
    const timer = this.clock.setTimeout(() => {
      // The requester is released even if the log sink fails (e.g. disk full); a timer must never throw.
      try { this.settle(approvalId, "deny", "timeout"); } catch { /* sink failure already surfaced by the caller of emit */ }
    }, this.timeoutMs);
    this.pendingById.set(approvalId, { request: normalized, approvalId, timer, resolve });

    const input = request.input === undefined ? undefined : boundRaw({ runnerId: request.runnerId ?? "deck", protocol: "approval", payload: request.input }, RAW_PAYLOAD_LIMIT_BYTES).payload;
    this.options.sink.emit(request.sessionId, {
      kind: "approval.requested",
      source: this.source(request),
      data: { approvalId, taskId: request.taskId, tool: request.tool, summary: request.summary ? redactText(request.summary, SUMMARY_LIMIT) : summarize(request.tool, request.input), allowedScopes, grantKinds, ...(exactKeyTruncated ? { exactKeyTruncated: true } : {}), risk: normalized.risk, ...(request.toolKey ? { toolKey: request.toolKey } : {}), ...(exactKey ? { exactKey } : {}), ...(allowedScopes.includes("always") && request.alwaysNote ? { alwaysNote: redactText(request.alwaysNote, 1000) } : {}), ...(input === undefined ? {} : { input }) },
    });
    const grant = this.grants(request.sessionId).find(g => grantKinds.includes(g.kind) && matchesGrant(g, normalized));
    if (grant) this.settle(approvalId, "allow-once", `session-grant:${grant.grantId}`, "once", true);
    return { approvalId, resolution };
  }

  respond(input: ApprovalResponse & { approvalId: string; by: string }): RespondResult {
    const entry = this.pendingById.get(input.approvalId);
    if (!entry) return { ok: false, code: this.resolvedSet.has(input.approvalId) ? "already-resolved" : "unknown-approval" };
    const validation = validateApprovalResponse(entry.request, input);
    if (!validation.ok) return validation;
    if (validation.scope === "session") {
      const grants = this.grants(entry.request.sessionId);
      if (grants.length >= 100) this.revokeGrant(entry.request.sessionId, grants[0]!.grantId, "grant-limit");
      const grant: SessionGrant = { grantId: randomUUID(), kind: input.grant!, toolKey: entry.request.toolKey!, risk: entry.request.risk, createdAt: new Date(this.clock.now()).toISOString(), ...(input.grant === "exact" ? { exactKey: entry.request.exactKey!, matchKey: entry.request.matchKey! } : {}) };
      const { createdAt: _, ...data } = grant;
      this.options.sink.emit(entry.request.sessionId, { kind: "session.grant", source: this.source(entry.request), data: { ...data, action: "added", by: input.by, approvalId: input.approvalId } });
      // Only standalone brokers need a separate in-memory grant projection.
      if (!this.grantProvider) this.grantsBySession.set(entry.request.sessionId, [...this.grants(entry.request.sessionId), grant]);
    }
    return { ok: true, resolution: this.settle(input.approvalId, normalize(input.decision), input.by, validation.scope)! };
  }

  pending(): PendingApproval[] {
    return [...this.pendingById.values()].map((e) => ({ approvalId: e.approvalId, sessionId: e.request.sessionId, taskId: e.request.taskId }));
  }

  /** Deny one pending approval (its requester went away). */
  cancel(approvalId: string, by: string): boolean {
    return this.settle(approvalId, "deny", by) !== undefined;
  }

  /** Deny every pending approval of a task (task ended, interrupted or cancelled). */
  cancelTask(sessionId: string, taskId: string, by = "task-ended"): number {
    const ids = [...this.pendingById.values()].filter((e) => e.request.sessionId === sessionId && e.request.taskId === taskId).map((e) => e.approvalId);
    for (const id of ids) this.settle(id, "deny", by);
    return ids.length;
  }

  /** Daemon shutdown: nothing may wait forever on an answer that cannot come. */
  dispose(by = "shutdown"): void {
    for (const id of [...this.pendingById.keys()]) this.settle(id, "deny", by);
  }

  private source(r: ApprovalRequest) {
    return { taskId: r.taskId, ...(r.memberId ? { memberId: r.memberId } : {}), ...(r.runnerId ? { runnerId: r.runnerId } : {}) };
  }

  private settle(approvalId: string, decision: ApprovalDecision, by: string, scope: ApprovalScope = "once", auto = false): ApprovalResolution | undefined {
    const entry = this.pendingById.get(approvalId);
    if (!entry) return undefined;
    this.pendingById.delete(approvalId);
    this.clock.clearTimeout(entry.timer);
    this.remember(approvalId);
    const resolution: ApprovalResolution = { approvalId, decision, by, scope };
    try {
      this.options.sink.emit(entry.request.sessionId, { kind: "approval.resolved", source: this.source(entry.request), data: { approvalId, decision, by, scope, ...(auto ? { auto: true } : {}) } });
    } finally {
      entry.resolve(resolution);
    }
    return resolution;
  }

  private remember(id: string): void {
    this.resolvedSet.add(id);
    this.resolvedIds.push(id);
    if (this.resolvedIds.length > RESOLVED_MEMORY) this.resolvedSet.delete(this.resolvedIds.shift()!);
  }
}
