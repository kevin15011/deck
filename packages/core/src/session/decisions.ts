/** Canonical durable decision contracts. No runner, storage or UI effects. */
export const DECISION_STATES = ["pending", "deferred", "answered", "cancelled", "superseded"] as const;
export type DecisionState = typeof DECISION_STATES[number];
export type DecisionTarget = { decisionId: string; revision: number };
export type DecisionReply = DecisionTarget & { promptId: string; taskId: string; attempt: number; admittedSeq: number; questionRevision?: number; stale: boolean };
export type DecisionSource = { promptId: string } | { taskId: string; attempt: number };
export type Decision = {
  decisionId: string; revision: number; questionRevision: number; questionSeq: number; createdSeq: number; updatedSeq: number;
  question: string; state: DecisionState; origin: { taskId: string; attempt: number; admissionSeq: number }; source: DecisionSource;
  key: string; openingFingerprint: string; relatedTaskIds: string[]; previousDecisionId?: string; openSpecRef?: string;
  note?: string; resolution?: { promptId: string; disposition: "allow" | "deny" | "informational"; action?: string };
  replacementDecisionId?: string; scopePromptId?: string; replies: DecisionReply[];
};
export type DecisionReadModel = Decision & { queuedReplies: {promptId: string; revision: number}[]; omittedReplies: number };
export type DecisionSnapshot = { sessionId: string; seq: number; decisions: DecisionReadModel[]; omittedTerminal: number };
export type DurableDecisionCommand = { commandId: string; fingerprint: string; type: string; outcome: { ok: true; data: { decisionId?: string; revision?: number; state?: DecisionState; taskId?: string } } };
export const unresolvedDecision = (decision: Pick<Decision, "state">) => decision.state === "pending" || decision.state === "deferred";
export const DECISION_LIMITS = { unresolved: 16, question: 2000, note: 512 } as const;
export const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
export const text = (v: unknown, max = 128): v is string => typeof v === "string" && !!v.trim() && v.length <= max && !/[\u0000-\u0008\u000b-\u001f\u007f]/.test(v);
export const revision = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 1;
export const validDecisionTarget = (v: unknown): v is DecisionTarget => object(v) && Object.keys(v).every(k => ["decisionId", "revision"].includes(k)) && text(v.decisionId) && revision(v.revision);
export const idList = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 16 && v.every(id => text(id)) && new Set(v).size === v.length;
export const validDecisionSource = (v: unknown): v is DecisionSource => object(v) && (Object.keys(v).length === 1 && text(v.promptId) || Object.keys(v).length === 2 && text(v.taskId) && revision(v.attempt));
const str = (max: number) => ({ type: "string", minLength: 1, maxLength: max, pattern: "^(?![\\s\\S]*[\\u0000-\\u0008\\u000b-\\u001f\\u007f])[\\s\\S]*\\S[\\s\\S]*$" });
const positive = { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER };
export const DECISION_TARGET_SCHEMA = { type: "object", additionalProperties: false, required: ["decisionId", "revision"], properties: { decisionId: str(128), revision: positive } };
export const DECISION_USER_COMMAND_PROPERTIES = {decisionId:str(128),expectedRevision:positive,note:str(512)};
const base = { commandId: str(128), decisionId: str(128), expectedRevision: positive, note: str(512) };
const sourceSchema = { oneOf: [{ type: "object", additionalProperties: false, required: ["promptId"], properties: { promptId: str(128) } }, { type: "object", additionalProperties: false, required: ["taskId", "attempt"], properties: { taskId: str(128), attempt: positive } }] };
export const DECISION_TOOLS = [
  { name: "deck_decision_open", description: "Open a session-owned unresolved decision. Use a stable key per originating Lead attempt and durable commandId; sources are history, not permission. relatedTaskIds explicitly links delegated tasks to this dependency for future continuation without interrupting running work. A source reference alone never links or gates that task.", inputSchema: { type: "object", additionalProperties: false, required: ["commandId", "key", "question", "source"], properties: { commandId: base.commandId, key: str(128), question: str(2000), source: sourceSchema, relatedTaskIds: { type: "array", maxItems: 16, uniqueItems: true, items: str(128) }, openSpecRef: str(512), previousDecisionId:str(128) } } },
  { name: "deck_decision_list", description: "Read unresolved decisions and bounded terminal history. Read-only; no acknowledgement or resolution.", inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "deck_decision_revise", description: "Revise a pending/deferred question or explicitly supersede with rationale and replacement or explicit scope reference; both require this turn's genuine user prompt newer than the question, recorded as scopePromptId. Existing related task dependencies persist; revising or superseding does not remove them.", inputSchema: { type: "object", additionalProperties: false, required: ["commandId", "decisionId", "expectedRevision", "note"], properties: { ...base, question: str(2000), state: { const: "superseded" }, replacementDecisionId: str(128), scopePromptId: str(128) }, oneOf: [{required:["question"],not:{anyOf:[{required:["state"]},{required:["replacementDecisionId"]},{required:["scopePromptId"]}]}},{required:["state"],not:{required:["question"]},oneOf:[{required:["replacementDecisionId"],not:{required:["scopePromptId"]}},{required:["scopePromptId"],not:{required:["replacementDecisionId"]}}]}] } },
  { name: "deck_decision_resolve", description: "Explicitly answer using this Lead turn's admitted genuine user prompt, newer than the question. Host checks structure; Lead checks meaning. An allow disposition authorizes only its exact action, deny/informational authorizes no dependent work.", inputSchema: { type: "object", additionalProperties: false, required: ["commandId", "decisionId", "expectedRevision", "promptId", "note", "disposition"], properties: { ...base, promptId: str(128), disposition: { enum: ["allow", "deny", "informational"] }, action: str(160) }, allOf:[{if:{properties:{disposition:{const:"allow"}},required:["disposition"]},then:{required:["action"]}}] } },
] as const;
export function validDecisionTool(name: string, d: Record<string, unknown>): boolean {
  const tool = DECISION_TOOLS.find(t => t.name === name); if (!tool) return false;
  if (Object.keys(d).some(k => !Object.hasOwn(tool.inputSchema.properties, k))) return false;
  if (name === "deck_decision_list") return true;
  if (!text(d.commandId)) return false;
  if (name === "deck_decision_open") return text(d.key) && text(d.question, 2000) && validDecisionSource(d.source) && (d.relatedTaskIds === undefined || idList(d.relatedTaskIds)) && (d.openSpecRef === undefined || text(d.openSpecRef, 512)) && (d.previousDecisionId === undefined || text(d.previousDecisionId));
  if (!text(d.decisionId) || !revision(d.expectedRevision) || !text(d.note, 512)) return false;
  if (name === "deck_decision_resolve") return text(d.promptId) && ["allow", "deny", "informational"].includes(String(d.disposition)) && (d.action === undefined || text(d.action, 160)) && (d.disposition !== "allow" || text(d.action, 160));
  return (text(d.question, 2000) && d.state === undefined && d.replacementDecisionId === undefined && d.scopePromptId === undefined)
    || (d.state === "superseded" && d.question === undefined && (d.replacementDecisionId === undefined || text(d.replacementDecisionId)) && (d.scopePromptId === undefined || text(d.scopePromptId)) && (text(d.replacementDecisionId) !== text(d.scopePromptId)));
}
export const DECISION_GUIDANCE = `Decisions persist across topics and session release. Open unresolved questions with deck_decision_open and list them with deck_decision_list. Queued or admitted replies, task completion and observer reads never resolve decisions. Deferred decisions remain unresolved. Answered/cancelled/superseded decisions are terminal; open a linked new decision using previousDecisionId when requirements change. Use deck_decision_resolve only after interpreting applicable evidence from THIS turn's genuine admitted user prompt, newer than the question revision. Additional accepted genuine user inputs in this same Lead task/attempt may be cited explicitly by their own host promptId; preserve the initial prompt reference and never infer authority from mere pending delivery. Synthetic wakes, stale targeted replies, old/foreign prompts and unrelated language are not resolution authority. Host validates structural references, not the meaning of the answer. Supersede only with this turn's applicable genuine user evidence newer than the question, also when naming a replacement; the host records scopePromptId provenance. Revise ambiguous questions and ask last; do not assume permission from time or silence.
Declare dependsOn decision IDs and the exact action on dependent deck_delegate calls; continuation inherits them. Only answered/allow with a matching action satisfies a declared dependency. Negative/informational answers, deferral, cancellation and supersession do not authorize dependent execution. Removing/replacing dependencies or changing action on continuation needs explicit replan {promptId,note} and a stable commandId, backed by this turn's admitted user input newer than the previous dependency records. No task auto-launches after an answer. A source reference alone does not gate work. Opening with explicit relatedTaskIds links delegated tasks for future continuation without interrupting already running work; explicitly pause/cancel affected work when needed. Bind a missing task action explicitly on its first compatible continuation. At most 16 decision links per task; use explicit user-backed replan to remove/replace links. Native Lead tools and undeclared work are outside this structural gate. Do not create recap-only turns. Native current-turn input is available only through an advertised verified host capability. Only confirmed same-attempt input is current evidence; transcript-only, uncertain and historical input cannot refresh authority. Retained native context is advisory, not a new user instruction. Never silently resend uncertain input.`;

const recordSchema = { type: "object", required: ["decisionId", "revision", "questionRevision", "questionSeq", "createdSeq", "updatedSeq", "question", "state", "origin", "source", "key", "openingFingerprint", "relatedTaskIds"], properties: {
  decisionId: str(128), revision: positive, questionRevision: positive, questionSeq: positive, createdSeq: positive, updatedSeq: positive,
  question: str(2000), state: { enum: [...DECISION_STATES] }, source: sourceSchema,
  origin: { type: "object", required: ["taskId", "attempt", "admissionSeq"], properties: { taskId: str(128), attempt: positive, admissionSeq: positive } },
  key: str(128), openingFingerprint: str(128), relatedTaskIds: { type: "array", maxItems: 16, uniqueItems: true, items: str(128) }, note: str(512),
  openSpecRef:str(512), previousDecisionId:str(128), replacementDecisionId:str(128), scopePromptId:str(128),
  resolution:{type:"object",required:["promptId","disposition"],properties:{promptId:str(128),disposition:{enum:["allow","deny","informational"]},action:str(160)},allOf:[{if:{properties:{disposition:{const:"allow"}},required:["disposition"]},then:{required:["action"]}}]},
},allOf:[{if:{properties:{state:{const:"answered"}},required:["state"]},then:{required:["resolution","note"]}},{if:{properties:{state:{enum:["deferred","cancelled","superseded"]}},required:["state"]},then:{required:["note"]}},{if:{properties:{state:{const:"superseded"}},required:["state"]},then:{required:["scopePromptId"]}}] };
export const DECISION_MUTATION_SCHEMA = { type: "object", required: ["decision", "command"], properties: { decision: recordSchema,
  command: { type: "object", required: ["commandId", "fingerprint", "type", "outcome"], properties: { commandId: str(128), fingerprint: str(128), type: str(128), outcome: { type: "object", required: ["ok", "data"], properties: { ok: { const: true }, data: { type: "object" } } } } } } };
export const DECISION_REPLY_SCHEMA = { type: "object", required: ["decisionId", "revision", "promptId", "taskId", "attempt", "admittedSeq", "stale"], properties: { ...DECISION_TARGET_SCHEMA.properties, promptId: str(128), taskId: str(128), attempt: positive, admittedSeq: positive, questionRevision: positive, stale: { type: "boolean" } } };
export function validDecisionCommand(c: unknown): boolean {
  return object(c) && text(c.commandId) && text(c.fingerprint) && text(c.type) && object(c.outcome) && c.outcome.ok === true && object(c.outcome.data);
}
function validDecisionResolution(value:unknown):boolean {
  return object(value) && text(value.promptId) && ["allow","deny","informational"].includes(String(value.disposition)) && (value.action===undefined || text(value.action,160)) && (value.disposition!=="allow" || text(value.action,160));
}
export function validDecisionMutation(data: Record<string, unknown>): boolean {
  const d = data.decision, c = data.command;
  return object(d) && text(d.decisionId) && [d.revision, d.questionRevision, d.questionSeq, d.createdSeq, d.updatedSeq].every(revision)
    && text(d.question, 2000) && DECISION_STATES.includes(d.state as DecisionState) && validDecisionSource(d.source)
    && object(d.origin) && text(d.origin.taskId) && revision(d.origin.attempt) && revision(d.origin.admissionSeq)
    && text(d.key) && text(d.openingFingerprint) && idList(d.relatedTaskIds) && (d.note === undefined || text(d.note, 512))
    && (d.openSpecRef === undefined || text(d.openSpecRef,512)) && (d.previousDecisionId===undefined||text(d.previousDecisionId)) && (d.replacementDecisionId === undefined || text(d.replacementDecisionId)) && (d.scopePromptId === undefined || text(d.scopePromptId))
    && (!["answered","deferred","cancelled","superseded"].includes(String(d.state)) || text(d.note,512))
    && (d.state !== "superseded" || text(d.scopePromptId))
    && (d.resolution === undefined || validDecisionResolution(d.resolution)) && (d.state !== "answered" || validDecisionResolution(d.resolution))
    && validDecisionCommand(c);
}
export function validDecisionReply(d: Record<string, unknown>): boolean {
  return text(d.decisionId) && revision(d.revision) && text(d.promptId) && text(d.taskId) && revision(d.attempt) && revision(d.admittedSeq) && typeof d.stale === "boolean" && (d.questionRevision === undefined || revision(d.questionRevision));
}

export type DecisionDependencies = { dependsOn?: string[]; action?: string; replan?: { promptId: string; note: string } };
export const DECISION_DEPENDENCY_PROPERTIES = {
  dependsOn: {type:"array",maxItems:16,uniqueItems:true,items:str(128)}, action:str(160), commandId:str(128),
  replan:{type:"object",additionalProperties:false,required:["promptId","note"],properties:{promptId:str(128),note:str(512)}},
} as const;
export function validDependencyInput(d: Record<string,unknown>): boolean {
  return (d.dependsOn === undefined || idList(d.dependsOn)) && (d.action === undefined || text(d.action,160))
    && (d.replan === undefined || object(d.replan) && Object.keys(d.replan).length===2 && text(d.replan.promptId) && text(d.replan.note,512) && text(d.commandId))
    && (d.commandId === undefined || text(d.commandId) && d.replan !== undefined);
}

export const DECISION_DELEGATION_RULES = [{if:{required:["replan"]},then:{required:["commandId"]}},{if:{required:["commandId"]},then:{required:["replan"]}}] as const;
