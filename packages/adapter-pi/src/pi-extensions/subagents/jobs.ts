import { createHash, randomUUID } from "node:crypto";
import type { DeckAgent } from "./agents";
import type { ChildRunner } from "./runner";
import { validateClarification, type Clarify } from "./clarification";

export const MAX_JOBS = 32;
export const MAX_CONCURRENCY = 4;
export type JobState = "queued" | "running" | "completed" | "failed" | "cancelling" | "cancelled" | "interrupted";
export type Activity = { at: number; kind: "tool" | "report" | "retry" | "lifecycle"; text: string };
export type Job = {
  id: string; childId: string; parent: string; agent: string; policy: string; task: string; cwd: string;
  state: JobState; created: number; started?: number; ended?: number; lastActivity: number;
  activity: Activity[]; output: string; after?: string;
  title?: string; attempt?: number; failureKind?: string; exitCode?: number; signal?: string;
  outcomeId?: string; admitted?: boolean; reminded?: boolean; deliveryBlocked?: boolean;
  integration?: "pending" | "reviewing" | "integrated" | "blocked"; integrationNote?: string;
};
export type OutcomeIdentity = { taskId: string; outcomeId: string; attempt: number };
export type Assignment = { agent: DeckAgent; task: string; title?: string; cwd: string };
type Snapshot = { version: 1; parent: string; jobs: Job[] };
type Effects = {
  persist: (snapshot: Snapshot) => void;
  /** false means the owning runtime cannot queue a wake yet; do not spend retry budget. */
  notify: (message: string, outcomes: OutcomeIdentity[]) => void | boolean; changed: () => void;
  childFile: (id: string) => string; validateChild: (id: string) => void;
};
/** Strip terminal control sequences and bidi controls from untrusted child text before any UI or storage. */
export function clean(text: string, cap = 12000): string {
  // Bound work before parsing untrusted frames; redact before applying the display cap.
  return text.slice(0, 256 * 1024).replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "").replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/\b(?:Bearer|Basic)\s+[^\s",;}]+/gi, "[redacted authorization]")
    .replace(/\b(?:authorization|proxy-authorization)\s*:\s*[^\r\n,}]+/gi, "Authorization: [redacted]")
    .replace(/(["']?\b[\w.-]*(?:api[_-]?key|access[_-]?key|token|password|passwd|secret(?:[_-][\w-]+)?|authorization)["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|[^\s,;}]+)/gi, "$1[redacted]")
    .slice(0, cap);
}
export function policyOf(agent: DeckAgent): string {
  return createHash("sha256").update(JSON.stringify(agent)).digest("hex");
}
const uuid = (value: unknown): value is string => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const states = new Set(["queued", "running", "completed", "failed", "cancelling", "cancelled", "interrupted"]);
function validJob(j: any, parent: string): j is Job {
  return j && uuid(j.id) && uuid(j.childId) && j.parent === parent && typeof j.agent === "string" && /^deck-[a-z-]+$/.test(j.agent)
    && typeof j.policy === "string" && /^[a-f0-9]{64}$/.test(j.policy) && typeof j.task === "string" && j.task.length <= 12000
    && typeof j.cwd === "string" && j.cwd.length <= 4096 && states.has(j.state)
    && [j.created, j.lastActivity].every(v => typeof v === "number" && Number.isFinite(v) && v >= 0)
    && [j.started, j.ended].every(v => v === undefined || (typeof v === "number" && Number.isFinite(v) && v >= 0))
    && (j.outcomeId === undefined || uuid(j.outcomeId)) && [j.admitted, j.reminded, j.deliveryBlocked].every(v => v === undefined || typeof v === "boolean")
    && (j.failureKind === undefined || (typeof j.failureKind === "string" && /^[a-z_]{1,40}$/.test(j.failureKind)))
    && (j.exitCode === undefined || Number.isSafeInteger(j.exitCode)) && (j.signal === undefined || (typeof j.signal === "string" && /^SIG[A-Z0-9]{1,20}$/.test(j.signal)))
    && (j.title === undefined || (typeof j.title === "string" && j.title.length <= 80))
    && (j.attempt === undefined || (Number.isSafeInteger(j.attempt) && j.attempt >= 1))
    && (j.integration === undefined || ["pending", "reviewing", "integrated", "blocked"].includes(j.integration))
    && (j.integrationNote === undefined || (typeof j.integrationNote === "string" && j.integrationNote.length <= 2000))
    && (j.after === undefined || uuid(j.after)) && typeof j.output === "string" && j.output.length <= 12000
    && Array.isArray(j.activity) && j.activity.length <= 24 && j.activity.every((a: any) => a && Number.isFinite(a.at) && typeof a.text === "string" && a.text.length <= 1200 && ["tool", "report", "retry", "lifecycle"].includes(a.kind));
}

/** One queue per parent, not one pool per tool call. No process survives close(). */
export class BackgroundJobs {
  records: Job[] = [];
  persistencePending = false;
  private parent = "";
  private generation = 0;
  private closed = true;
  private active = new Map<string, { controller: AbortController; promise: Promise<void>; clarify?: Clarify }>();
  private agents = new Map<string, DeckAgent>();
  private continuing = new Set<string>();
  private savedAt = 0;
  private deliveryQueued = false;
  private deliveries = new Map<string, { attempts: number; at: number }>();
  constructor(private runner: ChildRunner, private effects: Effects) {}

  private changed() { try { this.effects.changed(); } catch { /* UI cannot affect execution or delivery. */ } }
  private save() {
    try {
      this.effects.persist({ version: 1, parent: this.parent, jobs: structuredClone(this.records) });
      this.savedAt = Date.now(); this.persistencePending = false;
    } catch (error) { this.persistencePending = true; throw error; }
    finally { this.changed(); }
  }
  private saveOutcome() { try { this.save(); } catch { /* Keep state in memory and visibly retry persistence. */ } }
  private queueDelivery() {
    if (this.closed || this.deliveryQueued) return;
    this.deliveryQueued = true; const generation = this.generation;
    queueMicrotask(() => {
      if (generation !== this.generation) return;
      this.deliveryQueued = false; this.deliverPending();
    });
  }
  private outstanding(j: Job) { return Boolean(j.outcomeId) && j.integration !== "integrated" && j.integration !== "blocked"; }
  acknowledge(ids: string[]) {
    let changed = false;
    for (const j of this.records) if (j.outcomeId && ids.includes(j.outcomeId) && !j.admitted) {
      j.admitted = true; j.deliveryBlocked = false; changed = true;
      this.deliveries.set(j.outcomeId, { attempts: this.deliveries.get(j.outcomeId)?.attempts ?? 0, at: Date.now() });
    }
    if (changed) this.saveOutcome();
  }
  review(id: string): Job {
    const j = this.get(id);
    if (!j.outcomeId || j.integration === "integrated" || ["queued", "running", "cancelling"].includes(j.state)) throw new Error("No pending outcome to review");
    j.integration = "reviewing"; this.saveOutcome(); return j;
  }
  resolve(id: string, outcomeId: string, disposition: string, note: string) {
    const j = this.get(id);
    if (!j.outcomeId || j.outcomeId !== outcomeId || ["queued", "running", "cancelling"].includes(j.state)) throw new Error("Current terminal outcome ID required; obsolete outcomes cannot be resolved");
    if (!["integrated", "blocked"].includes(disposition) || typeof note !== "string" || !note.trim() || note.length > 2000) throw new Error("Resolve requires integrated/blocked and a non-empty summary (max 2000 characters)");
    if (disposition === "integrated" && j.integration !== "reviewing" && j.integration !== "integrated") throw new Error("Review the current outcome before integrating it");
    j.integration = disposition as "integrated" | "blocked"; j.integrationNote = clean(note, 2000);
    this.saveOutcome();
  }
  deliverPending(now = Date.now()) {
    if (this.closed) return;
    if (this.persistencePending) this.saveOutcome();
    const eligible = this.records.filter(j => {
      if (!this.outstanding(j)) return false;
      const d = this.deliveries.get(j.outcomeId!) ?? { attempts: 0, at: 0 };
      if (d.at && now - d.at < 2000) return false;
      return j.admitted ? !j.reminded : d.attempts < 3;
    });
    if (!eligible.length) return;
    const outcomes = eligible.map(j => ({ taskId: j.id, outcomeId: j.outcomeId!, attempt: j.attempt ?? 1 }));
    try {
      // No child text or raw reports in wakes. The fresh context board supplies current identities;
      // review explicitly fetches untrusted evidence, avoiding duplicate/report floods in chat.
      if (this.effects.notify("Deck Pi task results need Lead review. Use the current task board to validate, integrate, or report a blocker; do not merely acknowledge completion.", outcomes) === false) return;
    } catch { /* Same logical outcomes remain pending until actual native context admission. */ }
    for (const j of eligible) {
      const d = this.deliveries.get(j.outcomeId!) ?? { attempts: 0, at: 0 };
      this.deliveries.set(j.outcomeId!, { attempts: d.attempts + 1, at: now });
      if (j.admitted) j.reminded = true;
      else j.deliveryBlocked = d.attempts + 1 >= 3;
    }
    this.saveOutcome();
  }
  private finish(j: Job) {
    j.outcomeId = randomUUID(); j.admitted = false; j.reminded = false; j.deliveryBlocked = false;
    j.integration = "pending"; j.integrationNote = undefined;
    this.saveOutcome(); this.queueDelivery();
  }
  open(parent: string, snapshots: unknown[]) {
    if (this.active.size) throw new Error("Children must settle before opening another parent");
    this.deliveries.clear(); this.deliveryQueued = false; this.persistencePending = false;
    this.parent = parent; this.generation++; this.closed = false; this.records = []; this.agents.clear(); this.continuing.clear();
    for (const raw of snapshots) {
      const s = raw as Partial<Snapshot>;
      if (s?.version !== 1 || s.parent !== parent || !Array.isArray(s.jobs) || s.jobs.length > MAX_JOBS || !s.jobs.every(j => validJob(j, parent))) continue;
      const outcomes = s.jobs.flatMap(j => j.outcomeId ? [j.outcomeId] : []);
      if (new Set(s.jobs.map(j => j.id)).size !== s.jobs.length || new Set(s.jobs.map(j => j.childId)).size !== s.jobs.length || new Set(outcomes).size !== outcomes.length) continue;
      if (s.jobs.some((j, index) => j.after && !s.jobs!.slice(0, index).some(p => p.id === j.after))) continue;
      this.records = structuredClone(s.jobs).map(j => ({ ...j, attempt: j.attempt ?? 1,
        title: clean(j.title ?? j.task, 80).replace(/\s+/g, " "), task: clean(j.task), output: clean(j.output),
        integration: j.integration ?? (j.outcomeId ? "pending" : undefined), integrationNote: j.integrationNote ? clean(j.integrationNote, 2000) : undefined,
        activity: j.activity.map(a => ({ ...a, text: clean(a.text, 1200) })),
        state: ["running", "queued", "cancelling"].includes(j.state) ? "interrupted" : j.state }));
    }
    this.changed();
  }
  async reopen() {
    if (!this.closed) return false;
    await this.settled(); this.closed = false; this.generation++;
    // Navigation cancellation is not consent to restart interrupted jobs.
    this.changed(); return true;
  }
  accept(mode: "single" | "parallel" | "chain", items: Assignment[]): string[] {
    if (this.closed) throw new Error("No active parent session");
    if (!items.length || items.length > 8) throw new Error("Max is 8 tasks per delegation");
    if (this.records.length + items.length > MAX_JOBS) throw new Error("Session record limit (32) reached; inspect existing jobs before starting a new session");
    if (items.some(i => !i.task.trim() || i.task.length > 12000 || i.cwd.length > 4096 || (i.title !== undefined && (typeof i.title !== "string" || !i.title.trim() || i.title.length > 80)))) throw new Error("Invalid or oversized assignment");
    const jobs: Job[] = items.map(i => ({ id: randomUUID(), childId: randomUUID(), parent: this.parent, agent: i.agent.id, policy: policyOf(i.agent),
      title: clean(i.title ?? i.task, 80).replace(/\s+/g, " "), attempt: 1, task: clean(i.task), cwd: i.cwd,
      state: "queued", created: Date.now(), lastActivity: Date.now(), activity: [], output: "" }));
    jobs.forEach((j, n) => { if (mode === "chain" && n > 0) j.after = jobs[n - 1]!.id; this.agents.set(j.id, items[n]!.agent); });
    this.records.push(...jobs);
    try { for (const j of jobs) this.effects.childFile(j.childId); this.save(); }
    catch (e) {
      this.records = this.records.filter(j => !jobs.includes(j)); for (const j of jobs) this.agents.delete(j.id);
      this.saveOutcome(); throw e;
    }
    this.pump(); return jobs.map(j => j.id);
  }
  resume(id: string, agent: DeckAgent) {
    const j = this.get(id);
    if (this.closed || !["interrupted", "failed", "cancelled"].includes(j.state) || this.active.has(id)) throw new Error("Job is not eligible for continuation (already active or completed)");
    if (agent.id !== j.agent || policyOf(agent) !== j.policy) throw new Error("Role policy changed; continuation refused");
    this.effects.validateChild(j.childId);
    if (j.after && this.get(j.after).state !== "completed") throw new Error("Continue the interrupted predecessor first");
    const previous = structuredClone(j); const hadStarted = j.started !== undefined;
    this.agents.set(id, agent); if (hadStarted) this.continuing.add(id);
    j.attempt = (j.attempt ?? 1) + (hadStarted ? 1 : 0); j.state = "queued"; j.started = undefined; j.ended = undefined;
    j.outcomeId = undefined; j.admitted = undefined; j.reminded = undefined; j.deliveryBlocked = undefined;
    j.integration = undefined; j.integrationNote = undefined; j.output = "";
    j.failureKind = undefined; j.exitCode = undefined; j.signal = undefined;
    j.activity = [...j.activity, { at: Date.now(), kind: "lifecycle" as const, text: `Explicit continuation: attempt ${j.attempt}` }].slice(-24);
    try { this.save(); }
    catch (error) { Object.assign(j, previous); this.continuing.delete(id); this.saveOutcome(); throw error; }
    if (previous.outcomeId) this.deliveries.delete(previous.outcomeId);
    this.pump();
  }
  get(id: string): Job { const j = this.records.find(j => j.id === id); if (!j) throw new Error("Unknown task ID for this parent"); return j; }
  async clarify(id: string, message: string) {
    validateClarification(message);
    const j = this.get(id), active = this.active.get(id), generation = this.generation, attempt = j.attempt;
    const live = () => !this.closed && this.generation === generation && j.parent === this.parent && j.attempt === attempt && j.state === "running" && this.active.get(id) === active && !active?.controller.signal.aborted;
    if (!live() || !active?.clarify) throw new Error("Exact running child transport required; target is stale, terminal, cancelling, or not ready");
    const receipt = await active.clarify(message);
    if (!live()) throw new Error("Target settled or changed during delivery; queued clarification may not have been consumed");
    return receipt;
  }

  async cancel(id: string) {
    const j = this.get(id); const active = this.active.get(id);
    if (j.state === "running") { j.state = "cancelling"; active?.controller.abort(); }
    else if (j.state === "queued") { j.state = "cancelled"; j.ended = Date.now(); j.output = "Cancelled before execution."; j.failureKind = "cancelled"; this.finish(j); }
    this.skipDependents(id); this.saveOutcome(); this.pump(); await active?.promise;
  }
  private skipDependents(id: string) {
    for (const j of this.records.filter(j => j.after === id && j.state === "queued")) {
      j.state = "cancelled"; j.ended = Date.now(); j.output = "Not started: predecessor did not complete."; j.failureKind = "predecessor_incomplete";
      this.finish(j); this.skipDependents(j.id);
    }
  }
  private pump() {
    if (this.closed) return;
    for (const j of this.records) {
      if (this.active.size >= MAX_CONCURRENCY) break;
      if (j.state !== "queued" || (j.after && this.get(j.after).state !== "completed")) continue;
      const agent = this.agents.get(j.id); if (!agent) continue;
      const controller = new AbortController(); const generation = this.generation; const attempt = j.attempt;
      const live = () => !this.closed && generation === this.generation && attempt === j.attempt && j.parent === this.parent && j.state === "running";
      j.state = "running"; j.started = Date.now();
      try { this.save(); }
      catch { j.state = "failed"; j.ended = Date.now(); j.output = "Execution not started: task state could not be persisted."; j.failureKind = "persistence_failed"; this.skipDependents(j.id); this.finish(j); continue; }
      const previous = j.after ? this.get(j.after).output : "";
      const assignment = j.task.replace(/\{previous\}/g, () => previous);
      const continuation = this.continuing.delete(j.id);
      const task = continuation ? "Continue this exact child history. Inspect previous effects and ambiguous mutations/tests before proceeding; never blindly replay the original assignment. Report what was already applied, what remains, and the evidence. Original assignment: " + assignment : assignment;
      const promise = Promise.resolve().then(async () => {
        try {
          const r = await this.runner.run({ agent, task, cwd: j.cwd, sessionFile: this.effects.childFile(j.childId), parentId: this.parent, taskId: j.id, attempt: j.attempt ?? 1, signal: controller.signal,
            onClarifyReady: deliver => { const a = this.active.get(j.id); if (a && live()) a.clarify = deliver; },
            onActivity: a => {
              if (!live()) return;
              const entry = { ...a, at: Date.now(), text: clean(a.text, 1200) };
              j.lastActivity = entry.at; j.activity.push(entry); j.activity = j.activity.slice(-24);
              // Progress stays in the panel/history. It never creates a chat message or model turn.
              if (Date.now() - this.savedAt >= 10000) this.saveOutcome(); else this.changed();
            } });
          if (!live()) return;
          j.failureKind = r.failureKind; j.exitCode = r.exitCode; j.signal = r.signal;
          j.state = r.failed ? "failed" : "completed"; j.ended = Date.now(); j.output = clean(r.failed ? r.errorMessage ?? "Delegated execution failed; inspect its history." : r.text);
          if (r.failed) this.skipDependents(j.id);
          this.finish(j);
        } catch (e) {
          if (live()) { j.state = "failed"; j.ended = Date.now(); j.output = clean(String(e)); j.failureKind = "runner_error"; this.skipDependents(j.id); this.finish(j); }
        } finally {
          this.active.delete(j.id);
          if (!this.closed && generation === this.generation && j.state === "cancelling") {
            j.state = "cancelled"; j.ended = Date.now(); j.output = "Cancelled by request. Prior effects are not rolled back; inspect before continuation."; j.failureKind = "cancelled"; this.finish(j);
          }
          this.pump();
        }
      });
      this.active.set(j.id, { controller, promise });
    }
  }
  async settled() { while (this.active.size) await Promise.all([...this.active.values()].map(a => a.promise)); }
  async close() {
    if (this.closed) { await this.settled(); return; }
    this.closed = true; this.generation++; this.deliveryQueued = false;
    for (const j of this.records) if (["queued", "running", "cancelling"].includes(j.state)) {
      j.state = "interrupted"; j.ended = Date.now(); j.failureKind = "session_interrupted";
      j.integration = "blocked"; j.integrationNote = "Session lifecycle interrupted execution; explicit continuation required.";
    }
    for (const a of this.active.values()) a.controller.abort();
    try { this.runner.killAll(); } finally { this.saveOutcome(); await this.settled(); }
  }
}
