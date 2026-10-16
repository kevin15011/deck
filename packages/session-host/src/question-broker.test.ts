import { expect, test } from "bun:test";
import { QuestionBroker } from "./question-broker";
const questions = [{ id: "q1", prompt: "Choose", options: [], multiple: false, allowOther: true, secret: true }];
test("first valid answer wins, invalid stays pending, secret-only events never contain answers", async () => {
  const events: unknown[] = [];
  const broker = new QuestionBroker({ sink: { emit: (_, e) => { events.push(e); } } });
  const request = broker.request({ sessionId: "s", taskId: "t", questionId: "id", questions });
  expect(broker.respond({ questionId: "id", answers: {}, by: "u" })).toEqual({ ok: false, code: "question-answers-invalid" });
  expect(broker.pending()).toHaveLength(1);
  expect(broker.respond({ questionId: "id", answers: { q1: ["private-value"] }, by: "u" }).ok).toBe(true);
  expect(await request.resolution).toEqual({ outcome: "answered", answers: { q1: ["private-value"] } });
  expect(broker.dismiss({ questionId: "id", by: "u" })).toEqual({ ok: false, code: "already-resolved" });
  expect(JSON.stringify(events)).not.toContain("private-value");
  expect(JSON.stringify(events)).not.toContain('"answers"');
});
test("dismiss and task/shutdown cancellation release requesters", async () => {
  const broker = new QuestionBroker({ sink: { emit() {} } });
  const request = () => broker.request({ sessionId: "s", taskId: "t", questionId: crypto.randomUUID(), questions });
  const a = request(); broker.dismiss({ questionId: a.questionId, by: "u" }); expect(await a.resolution).toEqual({ outcome: "dismissed" });
  const b = request(); broker.cancelTask("s", "t"); expect(await b.resolution).toEqual({ outcome: "cancelled" });
  const c = request(); broker.dispose(); expect(await c.resolution).toEqual({ outcome: "cancelled" });
});
test("request rejects malformed questions and reused ids before emitting", async () => {
  const events: unknown[] = [];
  const broker = new QuestionBroker({ sink: { emit: (_, e) => { events.push(e); } } });
  const input = { sessionId: "s", taskId: "t", questionId: "id", questions };
  expect(() => broker.request({ ...input, questions: [] })).toThrow("question-request-invalid");
  const request = broker.request(input);
  expect(() => broker.request(input)).toThrow("question-id-reused");
  expect(broker.cancelTask("other", "t")).toBe(0);
  expect(broker.cancel("missing", "u")).toBe(false);
  broker.cancel("id", "u"); expect(await request.resolution).toEqual({ outcome: "cancelled" });
  expect(() => broker.request(input)).toThrow("question-id-reused");
  expect(events).toHaveLength(2);
});
test("sink failure still releases the requester and drops transient state", async () => {
  let fail = false;
  const broker = new QuestionBroker({ sink: { emit() { if (fail) throw new Error("disk-full"); } } });
  const request = broker.request({ sessionId: "s", taskId: "t", questionId: "id", questions });
  fail = true;
  expect(() => broker.cancel("id", "shutdown")).toThrow("disk-full");
  expect(await request.resolution).toEqual({ outcome: "cancelled" });
  expect(broker.pending()).toEqual([]);
});

test("mixed requests persist only non-secret answers and keep driver delivery complete", async () => {
  const events: any[] = [];
  const broker = new QuestionBroker({ sink: { emit: (_, e) => { events.push(e); } } });
  const request = broker.request({ sessionId: "s", taskId: "t", questionId: "mixed", questions: [
    { ...questions[0]!, id: "public", secret: false }, { ...questions[0]!, id: "private" },
  ] });
  const answers = { public: ["visible response"], private: ["SECRET_MIXED_SENTINEL"] };
  expect(broker.respond({ questionId: "mixed", answers, by: "user" })).toEqual({ ok: true });
  expect(await request.resolution).toEqual({ outcome: "answered", answers });
  expect(events.at(-1).data).toEqual({ questionId: "mixed", outcome: "answered", by: "user", answers: { public: ["visible response"] } });
  expect(JSON.stringify(events)).not.toContain("SECRET_MIXED_SENTINEL");
  answers.public[0] = "changed";
  expect(events.at(-1).data.answers.public).toEqual(["visible response"]);
});
test("public answers are bounded before persistence and dismiss/cancel remain answer-free", async () => {
  const events: any[] = [];
  const broker = new QuestionBroker({ sink: { emit: (_, e) => { events.push(e); } } });
  const input = { sessionId: "s", taskId: "t", questionId: "limits", questions: [{ ...questions[0]!, secret: false, multiple: true }] };
  const request = broker.request(input);
  for (const values of [Array(13).fill("A"), ["a".repeat(4001)]]) expect(broker.respond({ questionId: "limits", answers: { q1: values }, by: "u" })).toEqual({ ok: false, code: "question-answers-invalid" });
  expect(events.filter(e => e.kind === "question.resolved")).toHaveLength(0);
  const values = Array(12).fill("a".repeat(4000));
  expect(broker.respond({ questionId: "limits", answers: { q1: values }, by: "u" }).ok).toBe(true);
  await request.resolution;
  expect(events.at(-1).data.answers).toEqual({ q1: values });
  const dismissed = broker.request({ ...input, questionId: "dismiss" }); broker.dismiss({ questionId: "dismiss", by: "u" }); await dismissed.resolution;
  expect(events.at(-1).data).not.toHaveProperty("answers");
  const cancelled = broker.request({ ...input, questionId: "cancel" }); broker.cancel("cancel", "stop"); await cancelled.resolution;
  expect(events.at(-1).data).not.toHaveProperty("answers");
});
