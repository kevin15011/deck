import { expect, test } from "bun:test";
import type { SessionEvent } from "../packages/core/src/session/events";
import { liveApprovalDecision } from "./session-live-approvals";

test("live approval policy reads broker's public pending shape and allows only owned Deck MCP tools", () => {
  const pending = { approvalId: "a", sessionId: "s", taskId: "lead" };
  for (const [tool, expected] of [["mcp__deck__deck_delegate", "allow-once"], ["mcp__deck__deck_memory_recall", "allow-once"], ["Bash", "deny"], ["mcp__other__deck_delegate", "deny"], ["mcp__deck__unknown", "deny"]] as const) {
    const event = { v: 1, sessionId: "s", seq: 1, ts: "2026-10-12T00:00:00Z", kind: "approval.requested", source: { runnerId: "claude" }, data: { approvalId: "a", tool } } as SessionEvent;
    expect(liveApprovalDecision(pending, [event])).toBe(expected);
  }
  expect(liveApprovalDecision(pending, [])).toBe("deny");
  for (const [runnerId, tool, expected] of [["opencode", "deck_deck_memory_recall", "allow-once"], ["codex", "mcp__deck-session-lead-deck__deck_memory_recall", "allow-once"], ["codex", "mcp__deck-session-foreign-deck__deck_memory_recall", "deny"]] as const) expect(liveApprovalDecision(pending, [{ v: 1, sessionId: "s", seq: 1, ts: "2026-10-12T00:00:00Z", kind: "approval.requested", source: { runnerId }, data: { approvalId: "a", tool } } as SessionEvent])).toBe(expected);
});
