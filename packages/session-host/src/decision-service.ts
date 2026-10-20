/** Decision effects share the session ledger and its append/flush authority. */
import { DECISION_LIMITS, idList, object, revision, text, unresolvedDecision, validDecisionTool, type Decision, type DurableDecisionCommand } from "@deck/core/session/decisions";
import type { EventDraft } from "./event-log";
import { TERMINAL_TASK_STATES, type Ledger } from "./ledger";
import type { ExecuteOutcome as CommandOutcome } from "./protocol";
export type DecisionCaller = { taskId: string; attempt: number; admissionSeq?: number; promptId?: string };
export type DecisionPort = { ledger: Ledger; lastSeq(): number; append(draft: EventDraft): void; flush(): void };
const fail = (code: string): CommandOutcome => ({ ok: false, code });
export { decisionFingerprint } from "./mutation-identity";
import { decisionFingerprint } from "./mutation-identity";

export class DecisionService {
  constructor(private readonly port: DecisionPort) {}
  get ledger() { return this.port.ledger; }
  list(): CommandOutcome {
    const all = this.ledger.decisions(), unresolved = all.filter(unresolvedDecision), terminal = all.filter(d => !unresolvedDecision(d));
    return { ok: true, data: { sessionId: this.ledger.sessionId, seq: this.ledger.seq, omittedTerminal: Math.max(0, terminal.length - 32), decisions: [...unresolved, ...terminal.slice(-32)].map(d => ({ ...structuredClone(d), replies: structuredClone(d.replies.slice(-8)), omittedReplies: Math.max(0, d.replies.length - 8), queuedReplies: this.ledger.prompts().filter(p => p.state === "queued" && p.decisionTarget?.decisionId === d.decisionId).map(p => ({ promptId: p.promptId, revision: p.decisionTarget!.revision })) })) } };
  }
  duplicate(type: string, d: Record<string, unknown>): CommandOutcome | undefined {
    const identity = typeof d.commandId === "string" ? this.ledger.mutationIdentity(d.commandId) : undefined;
    if (identity && (identity.type !== type || identity.fingerprint && identity.fingerprint !== decisionFingerprint(type, d))) return fail("command-id-reused");
    const prior = typeof d.commandId === "string" ? this.ledger.decisionCommand(d.commandId) : undefined;
    return prior ? prior.type !== type || prior.fingerprint !== decisionFingerprint(type, d) ? fail("command-id-reused") : { ...structuredClone(prior.outcome), duplicate: true } : undefined;
  }
  evidence(caller: DecisionCaller, promptId: unknown, afterSeq = 0): boolean {
    const prompt = typeof promptId === "string" ? this.ledger.prompt(promptId) : undefined;
    if (prompt?.decisionTarget) {
      const target = this.ledger.decision(prompt.decisionTarget.decisionId);
      if (!target || target.replies.find(r => r.promptId === prompt.promptId)?.stale || prompt.targetQuestionRevision !== target.questionRevision) return false;
    }
    return !!caller.admissionSeq && !!prompt && (promptId === caller.promptId || prompt.steering?.state === "accepted" && prompt.steering.eligible) && prompt.by !== "daemon" && (prompt.state === "dispatched" || prompt.state === "accepted") && prompt.taskId === caller.taskId && prompt.attempt === caller.attempt && (prompt.firstAdmissionSeq ?? 0) > afterSeq;
  }
  tool(name: string, d: Record<string, unknown>, caller: DecisionCaller): CommandOutcome {
    if (!validDecisionTool(name, d)) return fail("invalid-arguments");
    if (name === "deck_decision_list") return this.list();
    const duplicate = this.duplicate(name, d); if (duplicate) return duplicate;
    const nextSeq = this.port.lastSeq() + 1;
    if (name === "deck_decision_open") {
      const decisionId = `decision-${decisionFingerprint("opening-key", { sessionId: this.ledger.sessionId, taskId: caller.taskId, attempt: caller.attempt, key: d.key }).slice(0, 32)}`;
      const openingFingerprint = decisionFingerprint("opening", Object.fromEntries(Object.entries(d).filter(([k]) => k !== "commandId")));
      const prior = this.ledger.decision(decisionId);
      if (prior) {
        if (prior.openingFingerprint !== openingFingerprint) return fail("decision-key-reused");
        const outcome = { ok: true as const, data: { decisionId, revision: 1, state: "pending" as const } };
        this.port.append({kind:"decision.command",data:{command:{commandId:d.commandId,type:name,fingerprint:decisionFingerprint(name,d),outcome}}}); this.port.flush();
        return {...outcome, duplicate:true};
      }
      const source = d.source as Decision["source"];
      if ("promptId" in source) {
        const prompt = this.ledger.prompt(source.promptId);
        if (!prompt?.dispatchedSeq || prompt.by === "daemon") return fail("decision-source-invalid");
      } else {
        const task = this.ledger.task(source.taskId), attempt = task?.attempts.find(a => a.attempt === source.attempt);
        if (!attempt || task?.memberId === "lead" || !TERMINAL_TASK_STATES.includes(attempt.state)) return fail("decision-source-invalid");
      }
      if (d.previousDecisionId && !this.ledger.decision(String(d.previousDecisionId))) return fail("decision-unknown");
      const relatedTaskIds = d.relatedTaskIds as string[] | undefined ?? [];
      if (relatedTaskIds.some(id => !this.ledger.task(id) || this.ledger.task(id)?.memberId === "lead")) return fail("task-unknown");
      if (relatedTaskIds.some(id => (this.ledger.task(id)?.dependsOn?.length ?? 0) >= 16)) return fail("dependency-capacity");
      if (d.openSpecRef !== undefined && (!this.ledger.session.changeId || !(d.openSpecRef as string).startsWith(`openspec/changes/${this.ledger.session.changeId}/`) || (d.openSpecRef as string).split("/").some(p => p === ".." || p === "."))) return fail("decision-source-invalid");
      if (this.ledger.decisions().filter(unresolvedDecision).length >= DECISION_LIMITS.unresolved) return fail("decision-capacity");
      const decision: Decision = { decisionId, revision: 1, questionRevision: 1, questionSeq: nextSeq, createdSeq: nextSeq, updatedSeq: nextSeq, question: d.question as string, state: "pending", origin: { taskId: caller.taskId, attempt: caller.attempt, admissionSeq: caller.admissionSeq! }, source: structuredClone(source), key: d.key as string, openingFingerprint, relatedTaskIds, ...(d.previousDecisionId ? {previousDecisionId:String(d.previousDecisionId)} : {}), ...(d.openSpecRef ? { openSpecRef: d.openSpecRef as string } : {}), replies: [] };
      return this.commit("decision.opened", name, d, decision);
    }
    const prior = this.ledger.decision(d.decisionId as string);
    if (!prior) return fail("decision-unknown");
    if (prior.revision !== d.expectedRevision) return fail("decision-revision-conflict");
    if (!unresolvedDecision(prior)) return fail("decision-terminal");
    const decision = { ...structuredClone(prior), revision: prior.revision + 1, updatedSeq: nextSeq, note: d.note as string };
    if (name === "deck_decision_resolve") {
      const prompt = this.ledger.prompt(String(d.promptId));
      if (prompt && prompt.promptId === caller.promptId && prompt.decisionTarget && this.ledger.decision(prompt.decisionTarget.decisionId)?.replies.find(r => r.promptId === prompt.promptId)?.stale) return fail("decision-reply-stale");
      if (!this.evidence(caller, d.promptId, prior.questionSeq)) return fail("decision-evidence-invalid");
      decision.state = "answered"; decision.resolution = { promptId: d.promptId as string, disposition: d.disposition as "allow" | "deny" | "informational", ...(d.action ? { action: d.action as string } : {}) };
    } else if (d.state === "superseded") {
      if (d.replacementDecisionId) {
        const replacement = this.ledger.decision(String(d.replacementDecisionId));
        if (!replacement || !unresolvedDecision(replacement) || replacement.decisionId === prior.decisionId) return fail("decision-replacement-invalid");
        // A child outcome alone cannot retire a user decision, even via a replacement.
        if (!this.evidence(caller, caller.promptId, prior.questionSeq)) return fail("decision-evidence-invalid");
        decision.replacementDecisionId = replacement.decisionId; decision.scopePromptId = caller.promptId;
      } else if (!this.evidence(caller, d.scopePromptId, prior.questionSeq)) return fail("decision-evidence-invalid");
      if (d.scopePromptId) decision.scopePromptId = String(d.scopePromptId);
      decision.state = "superseded";
    } else if (decision.question !== d.question) {
      decision.question = d.question as string; decision.questionRevision = decision.revision; decision.questionSeq = nextSeq;
    }
    return this.commit(name === "deck_decision_revise" ? "decision.revised" : "decision.state", name, d, decision);
  }
  user(type: string, d: Record<string, unknown>): CommandOutcome {
    if (!text(d.commandId) || !text(d.decisionId) || !revision(d.expectedRevision) || !text(d.note, 512)) return fail("invalid-arguments");
    const duplicate = this.duplicate(type, d); if (duplicate) return duplicate;
    const prior = this.ledger.decision(d.decisionId);
    if (!prior) return fail("decision-unknown");
    if (prior.revision !== d.expectedRevision) return fail("decision-revision-conflict");
    if (!unresolvedDecision(prior)) return fail("decision-terminal");
    const state = type === "decision.defer" && prior.state === "pending" ? "deferred" : type === "decision.reopen" && prior.state === "deferred" ? "pending" : type === "decision.cancel" ? "cancelled" : undefined;
    if (!state) return fail("decision-transition-invalid");
    return this.commit("decision.state", type, d, { ...structuredClone(prior), state, note: d.note, revision: prior.revision + 1, updatedSeq: this.port.lastSeq() + 1 });
  }
  private commit(kind: "decision.opened" | "decision.revised" | "decision.state", type: string, input: Record<string, unknown>, decision: Decision): CommandOutcome {
    const outcome: DurableDecisionCommand["outcome"] = { ok: true, data: { decisionId: decision.decisionId, revision: decision.revision, state: decision.state } };
    const command: DurableDecisionCommand = { commandId: input.commandId as string, type, fingerprint: decisionFingerprint(type, input), outcome };
    const { replies, ...record } = decision;
    this.port.append({ kind, data: { decision: record, command } }); this.port.flush(); return outcome;
  }
  dependencies(ids: string[], action?: string): boolean {
    return ids.every(id => { const d = this.ledger.decision(id); return d?.state === "answered" && d.resolution?.disposition === "allow" && !!action && d.resolution.action === action; });
  }
}
