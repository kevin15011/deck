/** Runner-neutral questions. Answers are transient and must never enter session events. */
export type Question = {
  id: string; header?: string; prompt: string;
  options: { label: string; description?: string }[];
  multiple: boolean; allowOther: boolean; secret: boolean;
};
export type DriverQuestionRequest = { questionId: string; questions: Question[] };
export type DriverQuestionAnswer = { outcome: "answered"; answers: Record<string, string[]> } | { outcome: "dismissed" | "cancelled" };
export type QuestionValidation = { ok: true } | { ok: false; code: "question-answers-invalid" };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === "string" && v.length > 0 && !/[\x00-\x1f\x7f-\x9f]/.test(v);
export function isQuestionAnswers(answers: unknown): answers is Record<string, string[]> {
  return object(answers) && Object.keys(answers).length <= 8 && Object.entries(answers).every(([key, values]) =>
    id(key) && Array.isArray(values) && values.length > 0 && values.length <= 12 &&
    values.every(value => typeof value === "string" && value.length > 0 && value.length <= 4000));
}

export function validateQuestions(questions: unknown): questions is Question[] {
  if (!Array.isArray(questions) || questions.length === 0 || questions.length > 8) return false;
  const ids = new Set<string>();
  return questions.every(q => {
    if (!object(q) || !id(q.id) || ids.has(q.id)) return false;
    ids.add(q.id);
    return typeof q.prompt === "string" && q.prompt.length > 0 && q.prompt.length <= 2000 &&
      (q.header === undefined || typeof q.header === "string" && q.header.length <= 120) &&
      typeof q.multiple === "boolean" && typeof q.allowOther === "boolean" && typeof q.secret === "boolean" &&
      Array.isArray(q.options) && q.options.length <= 12 && q.options.every(o =>
        object(o) && typeof o.label === "string" && o.label.length > 0 && o.label.length <= 200 &&
        (o.description === undefined || typeof o.description === "string" && o.description.length <= 1000));
  });
}

export function validateQuestionAnswers(questions: readonly Question[], answers: unknown): QuestionValidation {
  const invalid = { ok: false, code: "question-answers-invalid" } as const;
  if (!validateQuestions(questions) || !isQuestionAnswers(answers) || Object.keys(answers).length !== questions.length) return invalid;
  for (const q of questions) {
    if (!Object.hasOwn(answers, q.id)) return invalid;
    const values = answers[q.id]!;
    if (!q.multiple && values.length !== 1) return invalid;
    if (q.options.length && !q.allowOther && values.some(v => !q.options.some(o => o.label === v))) return invalid;
  }
  return { ok: true };
}
