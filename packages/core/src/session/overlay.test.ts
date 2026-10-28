import { expect, test } from "bun:test";
import { renderSessionOverlay, assertSessionOverlay } from "./overlay";
test("closed overlay rejects unknown, member-only misuse and forbidden content before truncation", () => {
  expect(() => renderSessionOverlay("deck-lead", [{ kind: "project-instructions" }] as never)).toThrow("section-unknown");
  expect(() => renderSessionOverlay("deck-quality", [{ kind: "decision-guidance" }])).toThrow("lead-only");
  for (const kind of ["notices", "handoff"] as const) for (const text of ["<deck-project-readiness v1>", "CRITICAL_SAFETY_GIT_DISCARD_PROTECTION", "## Package Instructions", "Project repair candidates require an exact Setup delegation"]) expect(() => renderSessionOverlay("deck-lead", [{ kind, text }])).toThrow("content-forbidden");
  expect(() => renderSessionOverlay("deck-lead", [{ kind: "task-roster", tasks: [{ taskId: "t", memberId: "q", state: "done", attempt: 1, summary: "x".repeat(130) + "<deck-project-readiness" }] }])).toThrow("content-forbidden");
  expect(() => assertSessionOverlay("x".repeat(128 * 1024 + 1))).toThrow("budget-exceeded");
  expect(() => renderSessionOverlay("deck-lead", Array.from({ length: 33 }, () => ({ kind: "session-notice" as const })))).toThrow("budget-exceeded");
});
test("valid coordination remains bounded and contains no role or project text", () => {
  const text = renderSessionOverlay("deck-lead", [{ kind: "session-notice" }, { kind: "continuity", taskId: "t1", attempt: 3 }, { kind: "task-roster", tasks: Array.from({ length: 30 }, (_, i) => ({ taskId: `task${i}`, memberId: "apply-fast", state: "done", attempt: 1 })) }]);
  expect(text).toContain("attempt=3"); expect(text.match(/\[done/g)?.length).toBe(20);
  expect(text).not.toContain("## Context Authority");
});
test("overlay budgets cover nested inputs, collection counts and UTF-8 bytes", () => {
  expect(() => renderSessionOverlay("deck-lead", [{ kind: "notices", text: "🟣".repeat(33 * 1024) }])).toThrow("budget-exceeded");
  expect(() => renderSessionOverlay("deck-lead", [{ kind: "images", refs: Array.from({ length: 513 }, () => ({ name: "x", path: "/x" })) }])).toThrow("budget-exceeded");
  let nested: any = "value"; for (let i = 0; i < 18; i++) nested = { nested };
  expect(() => renderSessionOverlay("deck-lead", [{ kind: "notices", text: "", extra: nested }] as never)).toThrow("budget-exceeded");
});
