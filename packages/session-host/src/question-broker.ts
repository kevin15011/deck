import { validateQuestionAnswers, validateQuestions, type Question, type DriverQuestionAnswer } from "@deck/core/session/question";
import type { EventDraft } from "./event-log";

export type QuestionRequest = { sessionId: string; taskId: string; memberId?: string; runnerId?: string; questionId: string; tool?: string; questions: Question[] };
export type PendingQuestion = { questionId: string; sessionId: string; taskId: string };
export type QuestionRespondResult = { ok: true } | { ok: false; code: "already-resolved" | "unknown-question" | "question-answers-invalid" };
export type QuestionBrokerOptions = { sink: { emit(sessionId: string, draft: EventDraft): void } };
type Entry = { request: QuestionRequest; resolve(answer: DriverQuestionAnswer): void };

/** No timeout: questions live until answered, dismissed, or their task/host ends. */
export class QuestionBroker {
  private readonly entries = new Map<string, Entry>();
  private readonly resolved = new Set<string>();
  constructor(private readonly options: QuestionBrokerOptions) {}

  request(request: QuestionRequest): { questionId: string; resolution: Promise<DriverQuestionAnswer> } {
    if (!request.questionId || !validateQuestions(request.questions)) throw new Error("question-request-invalid");
    if (this.entries.has(request.questionId) || this.resolved.has(request.questionId)) throw new Error("question-id-reused");
    const copy = structuredClone(request);
    let resolve!: Entry["resolve"];
    const resolution = new Promise<DriverQuestionAnswer>(r => { resolve = r; });
    this.entries.set(copy.questionId, { request: copy, resolve });
    try {
      this.options.sink.emit(copy.sessionId, { kind: "question.requested", source: this.source(copy), data: { questionId: copy.questionId, taskId: copy.taskId, ...(copy.tool ? { tool: copy.tool } : {}), questions: structuredClone(copy.questions) } });
    } catch (error) { this.entries.delete(copy.questionId); resolve({ outcome: "cancelled" }); throw error; }
    return { questionId: copy.questionId, resolution };
  }
  pending(): PendingQuestion[] { return [...this.entries.values()].map(({ request: r }) => ({ questionId: r.questionId, sessionId: r.sessionId, taskId: r.taskId })); }
  private missing(id: string): QuestionRespondResult { return { ok: false, code: this.resolved.has(id) ? "already-resolved" : "unknown-question" }; }
  respond(input: { questionId: string; answers: Record<string, string[]>; by: string }): QuestionRespondResult {
    const entry = this.entries.get(input.questionId);
    if (!entry) return this.missing(input.questionId);
    if (!validateQuestionAnswers(entry.request.questions, input.answers).ok) return { ok: false, code: "question-answers-invalid" };
    this.settle(input.questionId, { outcome: "answered", answers: structuredClone(input.answers) }, input.by);
    return { ok: true };
  }
  dismiss(input: { questionId: string; by: string }): QuestionRespondResult {
    if (!this.entries.has(input.questionId)) return this.missing(input.questionId);
    this.settle(input.questionId, { outcome: "dismissed" }, input.by); return { ok: true };
  }
  cancel(questionId: string, by: string): boolean { return this.settle(questionId, { outcome: "cancelled" }, by); }
  cancelTask(sessionId: string, taskId: string, by = "task-ended"): number {
    const ids = this.pending().filter(p => p.sessionId === sessionId && p.taskId === taskId);
    for (const p of ids) this.cancel(p.questionId, by);
    return ids.length;
  }
  dispose(by = "shutdown"): void { for (const id of [...this.entries.keys()]) this.cancel(id, by); }
  private source(r: QuestionRequest) { return { taskId: r.taskId, ...(r.memberId ? { memberId: r.memberId } : {}), ...(r.runnerId ? { runnerId: r.runnerId } : {}) }; }
  private settle(id: string, answer: DriverQuestionAnswer, by: string): boolean {
    const entry = this.entries.get(id); if (!entry) return false;
    this.entries.delete(id); this.resolved.add(id);
    if (this.resolved.size > 1000) this.resolved.delete(this.resolved.values().next().value!);
    try { this.options.sink.emit(entry.request.sessionId, { kind: "question.resolved", source: this.source(entry.request), data: { questionId: id, outcome: answer.outcome, by } }); }
    finally { entry.resolve(answer); }
    return true;
  }
}
