import { isQuestionAnswers } from "./question";
/** deck-session-command-v1 — pure command types and validator (XR-1.5). */
import type { CrossTeamAssignments, RunnerQualifiedAssignment } from "./assignments";
export type ImageAttachment = { attachmentId: string; mimeType: "image/png" | "image/jpeg" | "image/webp"; name: string; sizeBytes: number; width: number; height: number };
export const IMAGE_ATTACHMENT_LIMITS = { maxImages: 8, maxFileBytes: 5 * 1024 * 1024, maxMessageBytes: 20 * 1024 * 1024, maxDimension: 16384, maxPixels: 40_000_000 } as const;
export const SESSION_COMMAND_VERSION = 1 as const;

export type SessionCommandBody =
  | { type: "project.register"; path: string; name?: string }
  | { type: "project.rename"; projectId: string; name: string }
  | { type: "project.remove"; projectId: string }
  | { type: "session.create"; projectRoot?: string; projectId?: string; title?: string; changeId?: string; members?: CrossTeamAssignments }
  | { type: "session.prepare" }
  | { type: "session.prepare.cancel"; preparationId: string }
  | { type: "session.continue"; title?: string }
  | { type: "session.assignMember"; memberId: string; assignment: RunnerQualifiedAssignment; expectedRevision: number }
  | { type: "session.attach"; after: number }
  | { type: "session.bindChange"; changeId: string }
  | { type: "prompt.send"; text: string; attachmentIds?: string[]; target?: "lead" }
  | { type: "prompt.cancel"; promptId: string }
  | { type: "prompt.resume" }
  | { type: "turn.interrupt"; taskId: string }
  | { type: "approval.respond"; approvalId: string; decision: "allow" | "allow-once" | "deny" }
  | { type: "question.answer"; questionId: string; answers: Record<string, string[]> }
  | { type: "question.dismiss"; questionId: string }
  | { type: "task.cancel"; taskId: string }
  | { type: "session.release" }
  | { type: "session.rename"; title: string }
  | { type: "session.remove" }
  | { type: "session.stop" };
export type SessionCommand = { v: 1; commandId: string } & SessionCommandBody;

export type CommandValidation = { ok: true; value: SessionCommand } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string" && v.length > 0;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const boundedString = (v: unknown, max: number) => typeof v === "string" && v.trim().length > 0 && v.length <= max && !/[\x00-\x1f]/.test(v);
const assignment = (v: unknown) => isObj(v) && boundedString(v.runnerId, 80) && boundedString(v.modelId, 256) && (v.thinking === undefined || boundedString(v.thinking, 80));

const FIELD_RULES: Record<string, (c: Record<string, unknown>) => string | null> = {
  "project.register": (c) => !boundedString(c.path, 4096) ? "path invalid" : c.name !== undefined && !boundedString(c.name, 160) ? "name invalid" : null,
  "project.rename": (c) => !boundedString(c.projectId, 64) ? "projectId invalid" : !boundedString(c.name, 160) ? "name invalid" : null,
  "project.remove": (c) => boundedString(c.projectId, 64) ? null : "projectId invalid",
  "session.create": (c) => (str(c.projectRoot) ? 1 : 0) + (str(c.projectId) ? 1 : 0) !== 1 ? "exactly one projectRoot or projectId required" : c.changeId !== undefined && !str(c.changeId) ? "changeId invalid" : c.title !== undefined && !boundedString(c.title, 160) ? "title invalid" : c.members !== undefined && (!isObj(c.members) || Object.keys(c.members).length > 32 || !Object.entries(c.members).every(([key, value]) => boundedString(key, 80) && assignment(value))) ? "members invalid" : null,
  "session.prepare": () => null,
  "session.prepare.cancel": (c) => str(c.preparationId) ? null : "preparationId required",
  "session.continue": (c) => c.title !== undefined && !boundedString(c.title, 160) ? "title invalid" : null,
  "session.assignMember": (c) => !boundedString(c.memberId, 80) ? "memberId invalid" : !assignment(c.assignment) ? "assignment invalid" : !Number.isSafeInteger(c.expectedRevision) || (c.expectedRevision as number) < 0 ? "expectedRevision invalid" : null,
  "session.attach": (c) => Number.isInteger(c.after) && (c.after as number) >= 0 ? null : "after must be an integer >= 0",
  "session.bindChange": (c) => str(c.changeId) ? null : "changeId required",
  "prompt.send": (c) => typeof c.text !== "string" || !c.text.length && !(Array.isArray(c.attachmentIds) && c.attachmentIds.length) ? "text or images required" : c.attachmentIds !== undefined && (!Array.isArray(c.attachmentIds) || c.attachmentIds.length > IMAGE_ATTACHMENT_LIMITS.maxImages || !c.attachmentIds.every(id => typeof id === "string" && UUID.test(id)) || new Set(c.attachmentIds).size !== c.attachmentIds.length) ? "attachmentIds invalid" : c.target !== undefined && c.target !== "lead" ? "target invalid" : null,
  "prompt.cancel": (c) => str(c.promptId) ? null : "promptId required",
  "prompt.resume": () => null,
  "turn.interrupt": (c) => str(c.taskId) ? null : "taskId required",
  "approval.respond": (c) => !str(c.approvalId) ? "approvalId required" : c.decision !== "allow" && c.decision !== "allow-once" && c.decision !== "deny" ? "decision must be allow|allow-once|deny" : null,
  "question.answer": (c) => !str(c.questionId) ? "questionId required" : !isQuestionAnswers(c.answers) ? "answers invalid" : null,
  "question.dismiss": (c) => str(c.questionId) ? null : "questionId required",
  "task.cancel": (c) => str(c.taskId) ? null : "taskId required",
  "session.release": () => null,
  "session.rename": (c) => boundedString(c.title,160) ? null : "title invalid",
  "session.remove": () => null,
  "session.stop": () => null,
};

export function validateSessionCommand(input: unknown): CommandValidation {
  if (!isObj(input)) return { ok: false, errors: ["command must be an object"] };
  const errors: string[] = [];
  if (input.v !== SESSION_COMMAND_VERSION) errors.push("v must be 1");
  if (typeof input.commandId !== "string" || !UUID.test(input.commandId)) errors.push("commandId must be a UUID");
  const rule = typeof input.type === "string" && Object.hasOwn(FIELD_RULES, input.type) ? FIELD_RULES[input.type] : undefined;
  if (!rule) errors.push("unknown command type");
  else { const m = rule(input); if (m) errors.push(m); }
  return errors.length ? { ok: false, errors } : { ok: true, value: input as unknown as SessionCommand };
}
