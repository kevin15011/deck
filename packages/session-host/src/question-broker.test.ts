import { expect, test } from "bun:test";
import { QuestionBroker } from "./question-broker";
const questions = [{ id: "q1", prompt: "Choose", options: [], multiple: false, allowOther: true, secret: true }];
test("first valid answer wins, invalid stays pending, events never contain answers", async () => {
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
