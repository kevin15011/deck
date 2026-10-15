import { describe, expect, test } from "bun:test";
import { validateSessionCommand } from "./commands";

const id = "3f2b8c1e-5d4a-4b7e-9a1c-0e2d3f4a5b6c";

describe("validateSessionCommand", () => {
  test("accepts each command kind", () => {
    const cmds = [
      { type: "session.create", projectRoot: "/p" },
      { type: "project.register", path: "~/repos/deck", name: "Deck" },
      { type: "project.rename", projectId: "project-123", name: "Deck workspace" },
      { type: "project.remove", projectId: "project-123" },
      { type: "session.create", projectId: "project-123", title: "Feature", members: { lead: { runnerId: "codex", modelId: "gpt", thinking: "high" } } },
      { type: "session.prepare" },
      { type: "session.prepare.cancel", preparationId: "p" },
      { type: "session.continue", title: "Follow up" },
      { type: "session.assignMember", memberId: "lead", expectedRevision: 0, assignment: { runnerId: "claude", modelId: "opus" } },
      { type: "session.attach", after: 0 },
      { type: "session.bindChange", changeId: "c" },
      { type: "prompt.send", text: "hi" },
      { type: "turn.interrupt", taskId: "t" },
      { type: "approval.respond", approvalId: "a", decision: "allow" },
      { type: "approval.respond", approvalId: "a", decision: "allow-once" },
      { type: "approval.respond", approvalId: "a", decision: "deny" },
      { type: "task.cancel", taskId: "t" },
      { type: "session.stop" },
    ];
    for (const c of cmds) expect(validateSessionCommand({ v: 1, commandId: id, ...c }).ok).toBe(true);
  });
  test("requires UUID commandId", () => {
    expect(validateSessionCommand({ v: 1, type: "session.stop" }).ok).toBe(false);
    expect(validateSessionCommand({ v: 1, commandId: "nope", type: "session.stop" }).ok).toBe(false);
  });
  test("workspace commands reject ambiguous projects, invalid assignments and unbounded names", () => {
    for (const c of [
      { type: "session.create", projectId: "p", projectRoot: "/p" },
      { type: "session.create", projectId: "p", members: { lead: { runnerId: "codex" } } },
      { type: "session.assignMember", memberId: "lead", expectedRevision: -1, assignment: { runnerId: "codex", modelId: "gpt" } },
      { type: "session.assignMember", memberId: "lead", expectedRevision: 0, assignment: { runnerId: "codex", modelId: "" } },
      { type: "session.continue", title: "x".repeat(161) },
      { type: "project.register", path: "/p", name: "\n" },
      { type: "project.rename", projectId: "project-123", name: "   " },
      { type: "project.rename", projectId: "project-123", name: "x".repeat(161) },
      { type: "project.remove", projectId: "" },
    ]) expect(validateSessionCommand({ v: 1, commandId: id, ...c }).ok).toBe(false);
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

 test("image-only prompts require bounded unique opaque attachment IDs", () => {
 const send = (fields: object) => validateSessionCommand({v:1,commandId:id,type:"prompt.send",text:"",...fields}).ok;
 expect(send({attachmentIds:[id]})).toBe(true);
 for (const attachmentIds of [[], ["../image"], [id,id], Array.from({length:9},()=>id), "image"]) expect(send({attachmentIds})).toBe(false);
 });

 test("session release, rename and soft remove commands validate bounded fields", () => {
 for(const fields of [{type:"session.release"},{type:"session.remove"},{type:"session.rename",title:"Renamed"}]) expect(validateSessionCommand({v:1,commandId:id,...fields}).ok).toBe(true);
 for(const title of [""," ","x".repeat(161),"bad\nname"]) expect(validateSessionCommand({v:1,commandId:id,type:"session.rename",title}).ok).toBe(false);
 });
