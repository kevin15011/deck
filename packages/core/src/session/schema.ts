/**
 * JSON Schema (draft 2020-12) for deck-session-event-v1 and deck-session-command-v1 (D-20).
 * Derived from the same constant tables the validators use; pure, no I/O.
 */
import { SESSION_EVENT_KINDS, TURN_COMPLETED_STATUSES } from "./events";

type Json = Record<string, unknown>;
const nonEmptyString = { type: "string", minLength: 1 };
const UUID_PATTERN = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

function dataRule(kind: string, data: Json): Json {
  return { if: { properties: { kind: { const: kind } }, required: ["kind"] }, then: { properties: { data } } };
}
const requireId = (field: string): Json => ({ type: "object", required: [field], properties: { [field]: nonEmptyString } });

export function buildSessionEventSchema(): Json {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "deck-session-event-v1",
    type: "object",
    required: ["v", "sessionId", "seq", "ts", "kind", "source", "data"],
    properties: {
      v: { const: 1 },
      sessionId: nonEmptyString,
      seq: { type: "integer", minimum: 1 },
      ts: { type: "string", format: "date-time" },
      kind: { enum: [...SESSION_EVENT_KINDS] },
      source: {
        type: "object",
        properties: { memberId: { type: "string" }, taskId: { type: "string" }, runnerId: { type: "string" }, nativeSessionId: { type: "string" } },
      },
      data: { type: "object" },
      raw: {
        type: "object",
        required: ["runnerId", "protocol", "payload", "truncated"],
        properties: { runnerId: nonEmptyString, protocol: nonEmptyString, payload: {}, truncated: { type: "boolean" } },
      },
    },
    allOf: [
      dataRule("turn.completed", { type: "object", required: ["status"], properties: { status: { enum: [...TURN_COMPLETED_STATUSES] } } }),
      dataRule("approval.requested", requireId("approvalId")),
      dataRule("approval.resolved", requireId("approvalId")),
      dataRule("task.created", requireId("taskId")),
      dataRule("diagnostic", requireId("code")),
      dataRule("command.accepted", { type: "object", required: ["commandId", "type", "outcome"], properties: { commandId: nonEmptyString, type: nonEmptyString, outcome: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } } } }),
    ],
  };
}

const COMMAND_VARIANTS: ReadonlyArray<[string, Json, string[]]> = [
  ["session.create", { projectRoot: nonEmptyString, changeId: nonEmptyString }, ["projectRoot"]],
  ["session.attach", { after: { type: "integer", minimum: 0 } }, ["after"]],
  ["session.bindChange", { changeId: nonEmptyString }, ["changeId"]],
  ["prompt.send", { text: nonEmptyString, target: { const: "lead" } }, ["text"]],
  ["turn.interrupt", { taskId: nonEmptyString }, ["taskId"]],
  ["approval.respond", { approvalId: nonEmptyString, decision: { enum: ["allow", "allow-once", "deny"] } }, ["approvalId", "decision"]],
  ["task.cancel", { taskId: nonEmptyString }, ["taskId"]],
  ["session.stop", {}, []],
];

export function buildSessionCommandSchema(): Json {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "deck-session-command-v1",
    type: "object",
    required: ["v", "commandId", "type"],
    properties: { v: { const: 1 }, commandId: { type: "string", pattern: UUID_PATTERN }, type: { enum: COMMAND_VARIANTS.map(([t]) => t) } },
    allOf: COMMAND_VARIANTS.map(([type, props, required]) => ({
      if: { properties: { type: { const: type } }, required: ["type"] },
      then: { required, properties: props },
    })),
  };
}

export function buildSessionSchemas(): { event: Json; command: Json } {
  return { event: buildSessionEventSchema(), command: buildSessionCommandSchema() };
}
