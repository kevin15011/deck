/**
 * ApprovalBroker (XR-5.1, XR-5.2, design 7): turns a runner's permission prompt into an
 * `approval.requested` event and blocks the requester until a client answers, the timeout
 * denies it, or the task/daemon ends. First valid response wins.
 */
import { boundRaw, RAW_PAYLOAD_LIMIT_BYTES } from "@deck/core/session/events";
import { redactText } from "@deck/core/session/redaction";
import { randomUUID } from "node:crypto";
import { systemClock, type Clock, type TimerHandle } from "./clock";
import type { EventDraft } from "./event-log";

export const APPROVAL_TIMEOUT_MS = 15 * 60 * 1000;
const RESOLVED_MEMORY = 1000;
const SUMMARY_LIMIT = 300;

export type ApprovalDecision = "allow-once" | "deny";
export type ApprovalRequest = {
  sessionId: string; taskId: string; memberId?: string; runnerId?: string;
  tool: string; summary?: string; input?: unknown;
};
export type ApprovalResolution = { approvalId: string; decision: ApprovalDecision; by: string };
export type RespondResult = { ok: true; resolution: ApprovalResolution } | { ok: false; code: "already-resolved" | "unknown-approval" };
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
  request: ApprovalRequest; approvalId: string; timer: TimerHandle;
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
    const approvalId = (this.options.newId ?? randomUUID)();
    let resolve!: (r: ApprovalResolution) => void;
    const resolution = new Promise<ApprovalResolution>((res) => { resolve = res; });
    const timer = this.clock.setTimeout(() => {
      // The requester is released even if the log sink fails (e.g. disk full); a timer must never throw.
      try { this.settle(approvalId, "deny", "timeout"); } catch { /* sink failure already surfaced by the caller of emit */ }
    }, this.timeoutMs);
    this.pendingById.set(approvalId, { request, approvalId, timer, resolve });

    const input = request.input === undefined ? undefined : boundRaw({ runnerId: request.runnerId ?? "deck", protocol: "approval", payload: request.input }, RAW_PAYLOAD_LIMIT_BYTES).payload;
    this.options.sink.emit(request.sessionId, {
      kind: "approval.requested",
      source: this.source(request),
      data: { approvalId, taskId: request.taskId, tool: request.tool, summary: request.summary ?? summarize(request.tool, request.input), ...(input === undefined ? {} : { input }) },
    });
    return { approvalId, resolution };
  }

  respond(input: { approvalId: string; decision: "allow" | "allow-once" | "deny"; by: string }): RespondResult {
    if (!this.pendingById.has(input.approvalId)) {
      return { ok: false, code: this.resolvedSet.has(input.approvalId) ? "already-resolved" : "unknown-approval" };
    }
    return { ok: true, resolution: this.settle(input.approvalId, normalize(input.decision), input.by)! };
  }

  pending(): PendingApproval[] {
    return [...this.pendingById.values()].map((e) => ({ approvalId: e.approvalId, sessionId: e.request.sessionId, taskId: e.request.taskId }));
  }

  /** Deny every pending approval of a task (task ended, interrupted or cancelled). */
  cancelTask(taskId: string, by = "task-ended"): number {
    const ids = [...this.pendingById.values()].filter((e) => e.request.taskId === taskId).map((e) => e.approvalId);
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

  private settle(approvalId: string, decision: ApprovalDecision, by: string): ApprovalResolution | undefined {
    const entry = this.pendingById.get(approvalId);
    if (!entry) return undefined;
    this.pendingById.delete(approvalId);
    this.clock.clearTimeout(entry.timer);
    this.remember(approvalId);
    const resolution: ApprovalResolution = { approvalId, decision, by };
    try {
      this.options.sink.emit(entry.request.sessionId, { kind: "approval.resolved", source: this.source(entry.request), data: { approvalId, decision, by } });
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
