/**
 * JSON Schema (draft 2020-12) for deck-session-event-v1 and deck-session-command-v1 (D-20).
 * Derived from the same constant tables the validators use; pure, no I/O.
 */
import { HOOK_STATUSES, SESSION_EVENT_KINDS, TURN_COMPLETED_STATUSES } from "./events";

type Json = Record<string, unknown>;
const nonEmptyString = { type: "string", minLength: 1 };
const questionAnswers: Json = { type: "object", maxProperties: 8, propertyNames: { ...nonEmptyString, pattern: "^[^\\u0000-\\u001f\\u007f-\\u009f]+$" }, additionalProperties: { type: "array", minItems: 1, maxItems: 12, items: { ...nonEmptyString, maxLength: 4000 } } };
const UUID_PATTERN = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";

function dataRule(kind: string, data: Json): Json {
  return { if: { properties: { kind: { const: kind } }, required: ["kind"] }, then: { properties: { data } } };
}
const requireId = (field: string): Json => ({ type: "object", required: [field], properties: { [field]: nonEmptyString } });
const hookData: Json = {
  type: "object",
  required: ["hookId", "hookEvent", "status", "provenance"],
  properties: {
    hookId: { ...nonEmptyString, maxLength: 256 },
    hookEvent: { ...nonEmptyString, maxLength: 128 },
    hookName: { type: "string", maxLength: 500 },
    status: { enum: [...HOOK_STATUSES] },
    provenance: { enum: ["claude-stream-json", "codex-app-server"] },
    durationMs: { type: "number", minimum: 0 },
    executionMode: { enum: ["sync", "async"] },
    handlerType: { enum: ["command", "mcpTool", "prompt", "agent"] },
    provider: { const: "supermemory" },
    integration: { const: "runner-plugin" },
  },
  allOf: [
    { if: { required: ["provider"] }, then: { required: ["integration"] } },
    { if: { required: ["integration"] }, then: { required: ["provider"] } },
  ],
};

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
      dataRule("session.created", { type: "object", properties: { approvals: { enum: ["relay", "yolo"] } } }),
      dataRule("session.approvals", { type: "object", required: ["mode", "by"], properties: { mode: { enum: ["relay", "yolo"] }, by: nonEmptyString } }),
      dataRule("hook.started", hookData),
      dataRule("hook.completed", hookData),
      dataRule("turn.completed", { type: "object", required: ["status"], properties: { status: { enum: [...TURN_COMPLETED_STATUSES] } } }),
      dataRule("approval.requested", { ...requireId("approvalId"), properties: { approvalId: nonEmptyString, exactKeyTruncated: { type: "boolean" }, grantKinds: { type: "array", maxItems: 2, uniqueItems: true, items: { enum: ["exact", "tool"] } }, allowedScopes: { type: "array", minItems: 1, maxItems: 3, uniqueItems: true, contains: { const: "once" }, items: { enum: ["once", "session", "always"] } }, toolKey: { ...nonEmptyString, maxLength: 256, pattern: "^[^:\\s\\u0000-\\u001f\\u007f-\\u009f]+:[^\\s\\u0000-\\u001f\\u007f-\\u009f]+$" }, exactKey: { ...nonEmptyString, maxLength: 512 }, risk: { enum: ["normal", "high"] }, alwaysNote: { type: "string", maxLength: 1000 } } }),
      dataRule("approval.resolved", { ...requireId("approvalId"), properties: { approvalId: nonEmptyString, scope: { enum: ["once", "session", "always"] }, auto: { type: "boolean" } } }),
      dataRule("session.grant", { type: "object", required: ["action", "grantId", "kind", "toolKey", "risk", "by"], properties: { action: { enum: ["added", "revoked"] }, grantId: nonEmptyString, kind: { enum: ["exact", "tool"] }, toolKey: { ...nonEmptyString, maxLength: 256, pattern: "^[^:\\s\\u0000-\\u001f\\u007f-\\u009f]+:[^\\s\\u0000-\\u001f\\u007f-\\u009f]+$" }, exactKey: { ...nonEmptyString, maxLength: 512 }, matchKey: { type: "string", pattern: "^[a-f0-9]{64}$" }, risk: { enum: ["normal", "high"] }, by: nonEmptyString }, allOf: [{ if: { properties: { kind: { const: "exact" } } }, then: { required: ["exactKey"] } }] }),
      dataRule("question.requested", requireId("questionId")),
      dataRule("question.resolved", {
        type: "object", required: ["questionId", "outcome", "by"],
        properties: { questionId: nonEmptyString, outcome: { enum: ["answered", "dismissed", "cancelled"] }, by: nonEmptyString, answers: questionAnswers },
        allOf: [{ if: { required: ["answers"] }, then: { properties: { outcome: { const: "answered" } } } }],
      }),
      dataRule("task.created", requireId("taskId")),
      dataRule("diagnostic", requireId("code")),
      dataRule("command.accepted", { type: "object", required: ["commandId", "type", "outcome"], properties: { commandId: nonEmptyString, type: nonEmptyString, outcome: { type: "object", required: ["ok"], properties: { ok: { type: "boolean" } } } } }),
    ],
  };
}

const COMMAND_VARIANTS: ReadonlyArray<[string, Json, string[]]> = [
  ["project.register", { path: { ...nonEmptyString, maxLength: 4096 }, name: { ...nonEmptyString, maxLength: 160 } }, ["path"]],
  ["project.rename", { projectId: { ...nonEmptyString, maxLength: 64 }, name: { ...nonEmptyString, maxLength: 160 } }, ["projectId", "name"]],
  ["project.remove", { projectId: { ...nonEmptyString, maxLength: 64 } }, ["projectId"]],
  ["session.create", { approvals: { enum: ["relay", "yolo"] }, projectRoot: nonEmptyString, projectId: nonEmptyString, title: { ...nonEmptyString, maxLength: 160 }, changeId: nonEmptyString, members: { type: "object", maxProperties: 32, additionalProperties: { type: "object", required: ["runnerId", "modelId"], properties: { runnerId: nonEmptyString, modelId: nonEmptyString, thinking: nonEmptyString } } } }, []],
  ["session.prepare", {}, []],
  ["session.prepare.cancel", { preparationId: nonEmptyString }, ["preparationId"]],
  ["session.continue", { title: { ...nonEmptyString, maxLength: 160 } }, []],
  ["session.setApprovals", { mode: { enum: ["relay", "yolo"] } }, ["mode"]],
  ["session.assignMember", { memberId: nonEmptyString, expectedRevision: { type: "integer", minimum: 0 }, assignment: { type: "object", required: ["runnerId", "modelId"], properties: { runnerId: nonEmptyString, modelId: nonEmptyString, thinking: nonEmptyString } } }, ["memberId", "expectedRevision", "assignment"]],
  ["session.attach", { after: { type: "integer", minimum: 0 } }, ["after"]],
  ["session.bindChange", { changeId: nonEmptyString }, ["changeId"]],
  ["prompt.send", { text: { type: "string" }, attachmentIds: { type: "array", maxItems: 8, uniqueItems: true, items: { type: "string", pattern: UUID_PATTERN } }, target: { const: "lead" } }, ["text"]],
  ["prompt.cancel", { promptId: nonEmptyString }, ["promptId"]],
  ["prompt.resume", {}, []],
  ["turn.interrupt", { taskId: nonEmptyString }, ["taskId"]],
  ["approval.respond", { approvalId: nonEmptyString, decision: { enum: ["allow", "allow-once", "deny"] }, scope: { enum: ["once", "session", "always"] }, grant: { enum: ["exact", "tool"] }, confirmed: { type: "boolean" } }, ["approvalId", "decision"]],
  ["question.answer", { questionId: nonEmptyString, answers: questionAnswers }, ["questionId", "answers"]],
  ["question.dismiss", { questionId: nonEmptyString }, ["questionId"]],
  ["task.cancel", { taskId: nonEmptyString }, ["taskId"]],
  ["session.revokeGrant", { grantId: nonEmptyString }, ["grantId"]],
  ["session.release", {}, []],
  ["session.rename", {title: {...nonEmptyString,maxLength:160,pattern:"^(?=.*\\S)[^\\u0000-\\u001f]*$"}}, ["title"]],
  ["session.remove", {}, []],
  ["session.stop", {}, []],
];

export function buildSessionCommandSchema(): Json {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: "deck-session-command-v1",
    type: "object",
    required: ["v", "commandId", "type"],
    properties: { v: { const: 1 }, commandId: { type: "string", pattern: UUID_PATTERN }, type: { enum: COMMAND_VARIANTS.map(([t]) => t) } },
    allOf: [...COMMAND_VARIANTS.map(([type, props, required]) => ({
      if: { properties: { type: { const: type } }, required: ["type"] },
      then: { required, properties: props, ...(type === "prompt.send" ? { anyOf: [{ properties: { text: nonEmptyString } }, { required: ["attachmentIds"], properties: { attachmentIds: { minItems: 1 } } }] } : {}) },
    })), { if: { properties: { type: { const: "session.create" } }, required: ["type"] }, then: { oneOf: [{ required: ["projectRoot"], not: { required: ["projectId"] } }, { required: ["projectId"], not: { required: ["projectRoot"] } }] } }],
  };
}

export function buildSessionSchemas(): { event: Json; command: Json } {
  return { event: buildSessionEventSchema(), command: buildSessionCommandSchema() };
}
