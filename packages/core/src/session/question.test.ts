import { expect, test } from "bun:test";
import { validateQuestionAnswers, type Question } from "./question";
const q: Question = { id: "q1", prompt: "Choose", options: [{ label: "A" }, { label: "B" }], multiple: false, allowOther: false, secret: false };
test("answers honor single, multiple, other, free text and secret", () => {
  expect(validateQuestionAnswers([q], { q1: ["A"] }).ok).toBe(true);
  expect(validateQuestionAnswers([q], { q1: ["A", "B"] }).ok).toBe(false);
  expect(validateQuestionAnswers([{ ...q, multiple: true }], { q1: ["A", "B"] }).ok).toBe(true);
  expect(validateQuestionAnswers([{ ...q, allowOther: true }], { q1: ["custom"] }).ok).toBe(true);
  expect(validateQuestionAnswers([{ ...q, options: [], secret: true }], { q1: ["private"] }).ok).toBe(true);
});
test("rejects missing, extra, empty, oversized and invalid answers without exposing values", () => {
  for (const answers of [{}, { q1: [] }, { q1: ["unknown"] }, { q1: ["A"], extra: ["A"] }, { q1: ["x".repeat(4001)] }, { q1: Array(13).fill("A") }, { "bad\nkey": ["A"] }]) {
    expect(validateQuestionAnswers([q], answers).ok).toBe(false);
  }
});
test("question and answer bounds accept limits and reject overflow", () => {
  const free = { ...q, options: [], prompt: "p".repeat(2000), header: "h".repeat(120) };
  expect(validateQuestionAnswers([free], { q1: ["a".repeat(4000)] }).ok).toBe(true);
  for (const change of [{ prompt: "p".repeat(2001) }, { header: "h".repeat(121) }, { options: Array(13).fill({ label: "A" }) }, { options: [{ label: "a".repeat(201) }] }, { options: [{ label: "A", description: "d".repeat(1001) }] }]) {
    expect(validateQuestionAnswers([{ ...q, ...change }], { q1: ["A"] }).ok).toBe(false);
  }
  const eight = Array.from({ length: 8 }, (_, i) => ({ ...free, id: `q${i}` }));
  expect(validateQuestionAnswers(eight, Object.fromEntries(eight.map(q => [q.id, ["text"]]))).ok).toBe(true);
  expect(validateQuestionAnswers([...eight, { ...free, id: "q8" }], {}).ok).toBe(false);
  expect(validateQuestionAnswers([q, q], { q1: ["A"] }).ok).toBe(false);
  expect(validateQuestionAnswers([{ ...q, multiple: true }], { q1: Array(12).fill("A") }).ok).toBe(true);
});
