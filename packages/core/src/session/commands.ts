/** deck-session-command-v1 — pure command types and validator (XR-1.5). */
export const SESSION_COMMAND_VERSION = 1 as const;

export type SessionCommandBody =
  | { type: "session.create"; projectRoot: string; changeId?: string }
  | { type: "session.attach"; after: number }
  | { type: "session.bindChange"; changeId: string }
  | { type: "prompt.send"; text: string; target?: "lead" }
  | { type: "turn.interrupt"; taskId: string }
  | { type: "approval.respond"; approvalId: string; decision: "allow" | "deny" }
  | { type: "task.cancel"; taskId: string }
  | { type: "session.stop" };
export type SessionCommand = { v: 1; commandId: string } & SessionCommandBody;

export type CommandValidation = { ok: true; value: SessionCommand } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown) => typeof v === "string" && v.length > 0;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FIELD_RULES: Record<string, (c: Record<string, unknown>) => string | null> = {
  "session.create": (c) => !str(c.projectRoot) ? "projectRoot required" : c.changeId !== undefined && !str(c.changeId) ? "changeId invalid" : null,
  "session.attach": (c) => Number.isInteger(c.after) && (c.after as number) >= 0 ? null : "after must be an integer >= 0",
  "session.bindChange": (c) => str(c.changeId) ? null : "changeId required",
  "prompt.send": (c) => !str(c.text) ? "text required" : c.target !== undefined && c.target !== "lead" ? "target invalid" : null,
  "turn.interrupt": (c) => str(c.taskId) ? null : "taskId required",
  "approval.respond": (c) => !str(c.approvalId) ? "approvalId required" : c.decision !== "allow" && c.decision !== "deny" ? "decision must be allow|deny" : null,
  "task.cancel": (c) => str(c.taskId) ? null : "taskId required",
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
