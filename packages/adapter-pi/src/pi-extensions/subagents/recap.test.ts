import { expect, test } from "bun:test";
import { completionRecap, recapJobs, RECAP_MEMBERS } from "./recap";

const parent = "session", file = "/session.jsonl";
const boundary = (excluded: string[] = []) => ({ type: "custom", customType: "deck-recap-boundary-v1", data: { parent, file, excluded } });
const job = (id: string, integration = "integrated", attempt = 1) => ({ id, parent, agent: "deck-investigate", title: id, outcomeId: `${id}-${attempt}`, attempt, state: "completed", integration, integrationNote: `Evidence ${id}`, output: "UNTRUSTED CHILD REPORT" });
const snapshot = (...jobs: any[]) => ({ type: "custom", customType: "deck-subagents-v1", data: { parent, jobs } });
const answer = { type: "message", id: "answer", message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text: "Recommend the local route" }] } };
const anchor = { type: "custom", customType: "deck-recap-anchor-v1", data: { parent, file, entryId: "answer" } };

test("reconstructs original answer and latest task attempts, never cumulative answers or child reports", () => {
  const entries = [boundary(), answer, anchor, snapshot(job("A")), snapshot(job("A"), job("B", "pending")), { ...answer, id: "recursion", message: { ...answer.message, content: [{ type: "text", text: "RECURSIVE_RECAP" }] } }];
  const text = completionRecap(entries as any, parent, file, [job("A"), job("B", "pending")] as any)!;
  expect(text).toContain("Recommend the local route"); expect(text).toContain("Evidence A"); expect(text).toContain('"integration":"pending"');
  expect(text).not.toContain("UNTRUSTED CHILD REPORT"); expect(text).not.toContain("RECURSIVE_RECAP");
  const resumed = completionRecap([...entries, snapshot(job("A", "blocked", 2))] as any, parent, file, [job("A", "blocked", 2), job("B", "pending")] as any)!;
  expect(resumed).toContain('"attempt":2'); expect(resumed).not.toContain('"outcomeId":"A-1"');
});
test("running retry suppresses obsolete resolved attempt, duplicate snapshots and malformed records stay out", () => {
  const running = { ...job("A", "pending", 2), outcomeId: undefined, state: "running", integrationNote: undefined };
  const text = completionRecap([boundary(), snapshot(job("A")), snapshot(job("A")), snapshot(running), snapshot({ ...job("B"), attempt: -1 })] as any, parent, file, [running] as any)!;
  expect(text).not.toContain("Evidence A"); expect(text).not.toContain("Evidence B");
  const duplicate = completionRecap([boundary(), snapshot(job("A")), snapshot(job("A"))] as any, parent, file, [job("A")] as any)!;
  expect(duplicate.match(/Evidence A/g)).toHaveLength(1);
});
test("genuine boundary excludes old results; foreign session/file and absent provenance fail closed", () => {
  const entries = [boundary(), answer, anchor, snapshot(job("A")), boundary(["A-1"]), snapshot(job("A"), job("B"))];
  const text = completionRecap(entries as any, parent, file, [job("A"), job("B")] as any)!;
  expect(text).not.toContain("Recommend"); expect(text).not.toContain("Evidence A"); expect(text).toContain("Evidence B");
  expect(completionRecap(entries as any, "other", file, [] as any)).toBeUndefined();
  expect(completionRecap(entries as any, parent, "/other", [] as any)).toBeUndefined();
  expect(completionRecap([answer] as any, parent, file, [] as any)).toBeUndefined();
});
test("bounded reconstruction reports omission and truncation; persistence and pending are not completion", () => {
  const entries = [boundary(), { ...answer, message: { ...answer.message, content: [{ type: "text", text: "x".repeat(10000) }] } }, anchor, ...Array.from({length: 40}, (_, i) => snapshot(job(String(i))))];
  const text = completionRecap(entries as any, parent, file, [job("39", "blocked")] as any, true)!;
  expect(text.length).toBeLessThan(18000); expect(text).toContain('"omittedResults":8'); expect(text).toContain('"answerTruncated":true'); expect(text).toContain('"persistencePending":true');
  expect(text).toContain('"integration":"blocked"');
});

test("explicit block membership fences later attempts, unrelated tasks, foreign files and malformed membership", () => {
  const b = { ...boundary(), id: "block", data: { ...boundary().data, membership: true } };
  const members = { type: "custom", customType: RECAP_MEMBERS, data: { parent, file, boundaryId: "block", tasks: [{ id: "A", attempt: 1 }] } };
  const entries = [b, members, snapshot(job("A")), { ...members, data: { ...members.data, file: "/foreign", tasks: [{ id: "B", attempt: 1 }] } }, { ...members, data: { ...members.data, boundaryId: "other", tasks: [{ id: "C", attempt: 1 }] } }, { ...members, data: { ...members.data, tasks: [{ id: "D", attempt: -1 }] } }, snapshot(job("A"), job("B"), job("C"), job("D"))];
  const current = [job("A", "pending", 2), job("B", "pending"), job("C"), job("D")];
  expect(recapJobs(entries as any, parent, file, current as any)).toHaveLength(0);
  const text = completionRecap(entries as any, parent, file, current as any)!;
  expect(text).toContain('"outcomeId":"A-1"'); expect(text).not.toContain('"outcomeId":"A-2"');
  for (const id of ["B", "C", "D"]) expect(text).not.toContain(`Evidence ${id}`);
});
