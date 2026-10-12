import { describe, expect, test } from "bun:test";
import { validateSessionCommand } from "./commands";

const id = "3f2b8c1e-5d4a-4b7e-9a1c-0e2d3f4a5b6c";

describe("validateSessionCommand", () => {
  test("accepts each command kind", () => {
    const cmds = [
      { type: "session.create", projectRoot: "/p" },
      { type: "session.attach", after: 0 },
      { type: "session.bindChange", changeId: "c" },
      { type: "prompt.send", text: "hi" },
      { type: "turn.interrupt", taskId: "t" },
      { type: "approval.respond", approvalId: "a", decision: "allow" },
      { type: "task.cancel", taskId: "t" },
      { type: "session.stop" },
    ];
    for (const c of cmds) expect(validateSessionCommand({ v: 1, commandId: id, ...c }).ok).toBe(true);
  });
  test("requires UUID commandId", () => {
    expect(validateSessionCommand({ v: 1, type: "session.stop" }).ok).toBe(false);
    expect(validateSessionCommand({ v: 1, commandId: "nope", type: "session.stop" }).ok).toBe(false);
  });
  test("rejects unknown type, bad version, bad fields", () => {
    expect(validateSessionCommand({ v: 1, commandId: id, type: "x" }).ok).toBe(false);
    expect(validateSessionCommand({ v: 2, commandId: id, type: "session.stop" }).ok).toBe(false);
    expect(validateSessionCommand({ v: 1, commandId: id, type: "session.attach", after: -1 }).ok).toBe(false);
    expect(validateSessionCommand({ v: 1, commandId: id, type: "approval.respond", approvalId: "a", decision: "maybe" }).ok).toBe(false);
    expect(validateSessionCommand({ v: 1, commandId: id, type: "prompt.send", text: "" }).ok).toBe(false);
    expect(validateSessionCommand(null).ok).toBe(false);
  });
});
