import type { SessionEvent } from "../packages/core/src/session/events";
import type { PendingApproval } from "../packages/session-host/src/approval-broker";

/** The broker's public pending view intentionally omits tool input. Read the matching log event. */
export function liveApprovalDecision(pending: PendingApproval, events: readonly SessionEvent[]): "allow-once" | "deny" {
  const event = events.find((item) => item.kind === "approval.requested" && item.data.approvalId === pending.approvalId);
  const tool = event?.data.tool;
  if (typeof tool !== "string") return "deny";
  const runner = event?.source.runnerId;
  const prefix = runner === "codex" ? `mcp__deck-session-${pending.taskId}-deck__` : runner === "opencode" ? "deck_" : "mcp__deck__";
  if (!tool.startsWith(prefix)) return "deny";
  return ["deck_delegate", "deck_task_wait", "deck_task_result", "deck_task_cancel", "deck_memory_recall", "deck_memory_propose", "deck_status"].includes(tool.slice(prefix.length)) ? "allow-once" : "deny";
}
