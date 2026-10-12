import { describe, expect, test } from "bun:test";
import { validateSessionEvent } from "./events";
import { validateSessionCommand } from "./commands";
import { SESSION_COMMAND_SCHEMA, SESSION_EVENT_SCHEMA, SESSION_SCHEMA_DIGEST } from "./schema.generated";
import { buildSessionSchemas } from "./schema";

/** Minimal JSON Schema checker covering only the keywords our generated schemas use. */
function check(schema: any, value: any): boolean {
  if (schema === true || (typeof schema === "object" && Object.keys(schema).length === 0)) return true;
  if ("const" in schema && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type) {
    const t = schema.type;
    const ok = t === "object" ? typeof value === "object" && value !== null && !Array.isArray(value)
      : t === "integer" ? Number.isInteger(value) : t === "string" ? typeof value === "string" : t === "boolean" ? typeof value === "boolean" : true;
    if (!ok) return false;
  }
  if (typeof value === "string") {
    if (schema.minLength && value.length < schema.minLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) return false;
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) return false;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const r of schema.required ?? []) if (!(r in value)) return false;
    for (const [k, s] of Object.entries(schema.properties ?? {})) if (k in value && !check(s, value[k])) return false;
  }
  for (const sub of schema.allOf ?? []) {
    if (check(sub.if, value) && !check(sub.then, value)) return false;
  }
  return true;
}

const ts = "2026-10-12T00:00:00.000Z";
const ev = (o: object) => ({ v: 1, sessionId: "s", seq: 1, ts, kind: "session.created", source: {}, data: {}, ...o });
const cid = "3f2b8c1e-5d4a-4b7e-9a1c-0e2d3f4a5b6c";
const cm = (o: object) => ({ v: 1, commandId: cid, type: "session.stop", ...o });

const eventFixtures: unknown[] = [
  ev({}), ev({ kind: "nope" }), ev({ seq: 0 }), ev({ seq: 1.5 }), ev({ v: 2 }), ev({ ts: "bad" }),
  ev({ source: undefined }), ev({ data: [] }), ev({ source: { memberId: 1 } }),
  ev({ kind: "turn.completed", data: { status: "completed" } }), ev({ kind: "turn.completed", data: { status: "x" } }),
  ev({ kind: "turn.completed", data: {} }),
  ev({ kind: "approval.requested", data: {} }), ev({ kind: "approval.requested", data: { approvalId: "a" } }),
  ev({ kind: "runner.unmapped", raw: { runnerId: "codex", protocol: "codex-app-server", payload: 1, truncated: false } }),
  ev({ raw: { runnerId: "x" } }), ev({ sessionId: "" }),
];
const commandFixtures: unknown[] = [
  cm({}), cm({ commandId: "nope" }), cm({ type: "x" }), cm({ v: 2 }),
  cm({ type: "session.create", projectRoot: "/p" }), cm({ type: "session.create" }),
  cm({ type: "session.attach", after: 0 }), cm({ type: "session.attach", after: -1 }),
  cm({ type: "prompt.send", text: "hi" }), cm({ type: "prompt.send", text: "" }),
  cm({ type: "approval.respond", approvalId: "a", decision: "allow" }), cm({ type: "approval.respond", approvalId: "a", decision: "maybe" }),
  cm({ type: "turn.interrupt", taskId: "t" }), cm({ type: "turn.interrupt" }),
];

describe("generated session schemas", () => {
  test("generated module matches the in-memory build (no drift)", () => {
    const built = buildSessionSchemas();
    expect(SESSION_EVENT_SCHEMA).toEqual(built.event as any);
    expect(SESSION_COMMAND_SCHEMA).toEqual(built.command as any);
    expect(SESSION_SCHEMA_DIGEST).toMatch(/^[0-9a-f]{64}$/);
  });
  test("event schema agrees with the validator on the fixture set", () => {
    for (const f of eventFixtures) expect([check(SESSION_EVENT_SCHEMA, f), JSON.stringify(f)]).toEqual([validateSessionEvent(f).ok, JSON.stringify(f)]);
  });
  test("command schema agrees with the validator on the fixture set", () => {
    for (const f of commandFixtures) expect([check(SESSION_COMMAND_SCHEMA, f), JSON.stringify(f)]).toEqual([validateSessionCommand(f).ok, JSON.stringify(f)]);
  });
});
