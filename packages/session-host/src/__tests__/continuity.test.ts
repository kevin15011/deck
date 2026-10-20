import { expect, test } from "bun:test";
import { Ledger } from "../ledger";
import { continuityContext } from "../continuity";
import type { SessionEvent, SessionEventKind } from "@deck/core/session/events";

test("bounded original-source context signals omissions and truncation with complete JSON", () => {
  const ledger = Ledger.empty("s");
  const emit = (kind: SessionEventKind, data: Record<string, unknown>, taskId?: string) => ledger.apply({ v: 1, sessionId: "s", seq: ledger.seq + 1, ts: "2026-10-18T00:00:00Z", kind, source: taskId ? { taskId } : {}, data });
  emit("task.created", { taskId: "lead", memberId: "lead", runnerId: "codex", modelId: "m" });
  emit("task.state", { state: "running" }, "lead");
  emit("prompt.queued", { promptId: "p", text: "original", textHash: "hash", by: "user" });
  emit("prompt.dispatched", { promptId: "p", taskId: "lead", attempt: 1 });
  emit("message.completed", { role: "assistant", text: "a".repeat(10000) }, "lead");
  emit("task.result", { summary: "a".repeat(10000) }, "lead");
  emit("task.state", { state: "completed" }, "lead");
  for (let i = 0; i < 40; i++) {
    const taskId = `task-${i}`;
    emit("task.created", { taskId, memberId: "quality", runnerId: "claude", modelId: "m" });
    emit("task.state", { state: "running" }, taskId);
    emit("task.result", { summary: "🙂\\\"".repeat(3000) }, taskId);
    emit("task.state", { state: "completed" }, taskId);
  }
  const before = ledger.toState();
  const text = continuityContext(ledger); expect(text.length).toBeLessThanOrEqual(4096);
  const data = JSON.parse(text.split("\n").slice(1).join("\n"));
  expect(data.originalAnswer.length).toBe(1024); expect(data.answerTruncated).toBe(true);
  expect(data.outcomes.length).toBeLessThanOrEqual(32); expect(data.omittedOutcomes + data.outcomes.length).toBe(40);
  expect(data.outcomes[0]).toMatchObject({ review: "unverified", resultTruncated: true });
  expect(continuityContext(ledger, 180).length).toBeLessThanOrEqual(180);
  expect(ledger.toState()).toEqual(before);
});

test("legacy durable notice diagnostics are honored independently per attempt", () => {
  const ledger = Ledger.empty("s");
  const emit = (kind: SessionEventKind, data: Record<string, unknown>) => ledger.apply({ v: 1, sessionId: "s", seq: ledger.seq + 1, ts: "2026-10-18T00:00:00Z", kind, source: { taskId: "child" }, data } as SessionEvent);
  emit("task.created", { taskId: "child", memberId: "quality", runnerId: "codex", modelId: "m" });
  emit("task.state", { state: "running" }); emit("task.state", { state: "completed" });
  emit("diagnostic", { code: "lead.notices-delivered", notices: [{ taskId: "child", attempt: 1 }] });
  emit("task.continued", { attempt: 2 }); emit("task.state", { state: "running" }); emit("task.state", { state: "completed" });
  expect(ledger.task("child")!.attempts[0]!.delivery).toBeDefined();
  expect(ledger.latest("child")!.delivery).toBeUndefined();
});

test("uncertain delivery remains visible on the next genuine admitted block without becoming integration", () => {
  const ledger = Ledger.empty("s");
  const emit = (kind: SessionEventKind, data: Record<string, unknown>, taskId?: string) => ledger.apply({ v: 1, sessionId: "s", seq: ledger.seq + 1, ts: "2026-10-18T00:00:00Z", kind, source: taskId ? { taskId } : {}, data });
  emit("task.created", { taskId: "lead", memberId: "lead", runnerId: "codex", modelId: "m" });
  emit("task.state", { state: "running" }, "lead");
  emit("task.created", { taskId: "child", memberId: "quality", runnerId: "codex", modelId: "m" });
  emit("task.state", { state: "running" }, "child"); emit("task.result", { summary: "original child report" }, "child"); emit("task.state", { state: "completed" }, "child");
  emit("task.delivery", { taskId: "child", attempt: 1, leadTaskId: "lead", leadAttempt: 1 });
  emit("task.state", { state: "interrupted", reason: "daemon-restart" }, "lead");
  emit("task.continued", { attempt: 2 }, "lead"); emit("task.state", { state: "running" }, "lead");
  emit("prompt.queued", { promptId: "new-user", text: "new topic", textHash: "hash", by: "user" });
  emit("prompt.dispatched", { promptId: "new-user", taskId: "lead", attempt: 2 });
  const context = JSON.parse(continuityContext(ledger).split("\n").slice(1).join("\n"));
  expect(context.block.promptId).toBe("new-user");
  expect(context.outcomes).toMatchObject([{ taskId: "child", review: "unverified", result: "original child report", delivery: { leadAttempt: 1 } }]);
  expect(ledger.latest("child")?.retrieval).toBeUndefined(); expect(ledger.latest("child")?.integration).toBeUndefined();
});

type ReviewCase = { label: string; delivered: boolean; retrieved: boolean; receivingState: "completed" | "interrupted"; review?: "blocked" | "integrated" | "discarded" };
const reviewCases: ReviewCase[] = [
  { label: "retrieved without integration", delivered: false, retrieved: true, receivingState: "completed" },
  { label: "delivered to a completed Lead without integration", delivered: true, retrieved: false, receivingState: "completed" },
  { label: "delivered and retrieved before Lead interruption", delivered: true, retrieved: true, receivingState: "interrupted" },
  { label: "blocked integration", delivered: true, retrieved: true, receivingState: "completed", review: "blocked" },
];

function priorBlockOutcomes(cases: ReviewCase[]) {
  const ledger = Ledger.empty("s");
  const emit = (kind: SessionEventKind, data: Record<string, unknown>, taskId?: string) => ledger.apply({ v: 1, sessionId: "s", seq: ledger.seq + 1, ts: "2026-10-18T00:00:00Z", kind, source: taskId ? { taskId } : {}, data });
  emit("task.created", { taskId: "lead", memberId: "lead", runnerId: "codex", modelId: "m" }); emit("task.state", { state: "running" }, "lead");
  emit("prompt.queued", { promptId: "original", text: "original topic", textHash: "original-hash", by: "user" });
  emit("prompt.dispatched", { promptId: "original", taskId: "lead", attempt: 1 });
  for (const [index, scenario] of cases.entries()) {
    const taskId = `child-${index}`, accounting = { taskId, attempt: 1, leadTaskId: "lead", leadAttempt: 1 };
    emit("task.created", { taskId, memberId: "quality", runnerId: "codex", modelId: "m" }); emit("task.state", { state: "running" }, taskId);
    emit("task.result", { summary: `Original report ${index}` }, taskId); const resultSeq = ledger.seq;
    emit("task.state", { state: "completed" }, taskId);
    if (scenario.delivered) emit("task.delivery", accounting);
    if (scenario.retrieved) emit("task.retrieval", accounting);
    if (scenario.review) emit("task.integration", { ...accounting, commandId: `review-${index}`, state: scenario.review, note: `Review ${scenario.review}`, evidenceSeqs: [resultSeq] });
  }
  emit("task.state", { state: cases[0]!.receivingState }, "lead");
  emit("task.continued", { attempt: 2 }, "lead"); emit("task.state", { state: "running" }, "lead");
  emit("prompt.queued", { promptId: "new-user", text: "new topic", textHash: "new-hash", by: "user" });
  emit("prompt.dispatched", { promptId: "new-user", taskId: "lead", attempt: 2 });
  return ledger;
}
const parsedContinuity = (ledger: Ledger) => {
  const text = continuityContext(ledger); expect(text.length).toBeLessThanOrEqual(4096);
  return JSON.parse(text.split("\n").slice(1).join("\n"));
};

test.each(reviewCases)("P1 retains $label across a genuine block change", scenario => {
  const ledger = priorBlockOutcomes([scenario]), before = ledger.toState();
  const context = parsedContinuity(ledger);
  expect(context.block.promptId).toBe("new-user");
  expect(context.outcomes).toMatchObject([{ taskId: "child-0", attempt: 1, review: scenario.review ?? "unverified", result: "Original report 0" }]);
  expect(context.omittedOutcomes).toBe(0); expect(ledger.toState()).toEqual(before);
});

test("P1 counts retained outstanding outcomes truthfully when they overflow across blocks", () => {
  const outstanding = Array.from({ length: 40 }, (_, i) => reviewCases[i % reviewCases.length]!);
  const disposed = ["integrated", "discarded"].map(review => ({ ...reviewCases[3]!, review } as ReviewCase));
  const ledger = priorBlockOutcomes([...outstanding, ...disposed]);
  const context = parsedContinuity(ledger);
  expect(context.outcomes.length).toBeGreaterThan(0); expect(context.outcomes.length).toBeLessThanOrEqual(32);
  expect(context.omittedOutcomes).toBeGreaterThan(0);
  expect(context.outcomes.length + context.omittedOutcomes).toBe(40);
  expect(context.outcomes.every((outcome: { review: string }) => ["unverified", "blocked"].includes(outcome.review))).toBe(true);
  expect(context.retrieve).toContain("deck_task_result");
});

test.each(["integrated", "discarded"] as const)("P1 permits old %s outcomes to leave the recap after explicit disposition", review => {
  const ledger = priorBlockOutcomes([reviewCases[3]!]);
  expect(parsedContinuity(ledger).outcomes).toMatchObject([{ review: "blocked" }]);
  ledger.apply({ v: 1, sessionId: "s", seq: ledger.seq + 1, ts: "2026-10-18T00:00:00Z", kind: "task.integration", source: { taskId: "lead" },
    data: { taskId: "child-0", attempt: 1, leadTaskId: "lead", leadAttempt: 2, commandId: `revisit-${review}`, state: review, note: "Explicitly revisited blocked review", evidenceSeqs: [ledger.latest("child-0")!.resultSeq!] } });
  const context = parsedContinuity(ledger);
  expect(context.outcomes).toEqual([]); expect(context.omittedOutcomes).toBe(0);
  expect(ledger.latest("child-0")!.integrations!.map(record => record.state)).toEqual(["blocked", review]);
});
