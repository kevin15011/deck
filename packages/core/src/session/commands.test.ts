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
      { type:"project.trust",projectId:"p",runnerId:"opencode",trusted:true,expectedRevision:0 },
      { type:"project.trust",projectId:"p",runnerId:"opencode",trusted:false,expectedRevision:0 },
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
      ...[{projectId:"p",runnerId:"codex",trusted:true,expectedRevision:0},{projectId:"p",runnerId:"opencode",trusted:"true",expectedRevision:0},{projectId:"",runnerId:"opencode",trusted:true,expectedRevision:0}].map(value=>({type:"project.trust",...value})),
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

test("question commands enforce bounded answer shape", () => {
  const command = (fields: object) => validateSessionCommand({ v: 1, commandId: id, type: "question.answer", questionId: "r", ...fields });
  expect(command({ answers: { q1: ["A"] } }).ok).toBe(true);
  expect(command({ type: "question.dismiss" }).ok).toBe(true);
  for (const answers of [null, [], { q1: "A" }, { q1: [] }, { q1: [1] }, { q1: ["x".repeat(4001)] }, { q1: Array(13).fill("A") }, { "q\n": ["A"] }, Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`q${i}`, ["A"]]))]) expect(command({ answers }).ok).toBe(false);
});
test("per-session approvals accept only relay or yolo", () => {
  for (const mode of ["relay", "yolo"]) {
    expect(validateSessionCommand({ v: 1, commandId: id, type: "session.create", projectRoot: "/p", approvals: mode }).ok).toBe(true);
    expect(validateSessionCommand({ v: 1, commandId: id, type: "session.setApprovals", mode }).ok).toBe(true);
  }
  for (const mode of ["runner-default", "allow", "", null, 1]) {
    expect(validateSessionCommand({ v: 1, commandId: id, type: "session.create", projectRoot: "/p", approvals: mode }).ok).toBe(false);
    expect(validateSessionCommand({ v: 1, commandId: id, type: "session.setApprovals", mode }).ok).toBe(false);
  }
  expect(validateSessionCommand({ v: 1, commandId: id, type: "session.setApprovals" }).ok).toBe(false);
});

test("question answer commands retain all entries until the broker filters the event", () => {
  const command = { v: 1 as const, commandId: id, type: "question.answer" as const, questionId: "request", answers: { public: ["visible"], private: ["transient"] } };
  expect(validateSessionCommand(command)).toEqual({ ok: true, value: command });
});

test("approval scopes and revoke commands preserve legacy syntax and reject malformed extensions", () => {
  const command = (fields: object) => validateSessionCommand({ v: 1, commandId: id, type: "approval.respond", approvalId: "a", decision: "allow", ...fields }).ok;
  for (const scope of [undefined, "once", "session", "always"]) expect(command({ scope, grant: "tool", confirmed: true })).toBe(true);
  for (const fields of [{ scope: "forever" }, { scope: null }, { grant: "all" }, { confirmed: "yes" }]) expect(command(fields)).toBe(false);
  expect(command({ type: "session.revokeGrant", grantId: "g" })).toBe(true);
  expect(command({ type: "session.revokeGrant" })).toBe(false);
});

test("project trust requires a reviewed nonnegative safe revision, including legacy clients", () => {
 const command = {v:1,commandId:id,type:"project.trust",projectId:"p",runnerId:"opencode",trusted:true};
 expect(validateSessionCommand(command).ok).toBe(false);
 for (const expectedRevision of [-1, 0.5, "0", null, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]) expect(validateSessionCommand({...command,expectedRevision}).ok).toBe(false);
 for (const expectedRevision of [0,1,Number.MAX_SAFE_INTEGER]) expect(validateSessionCommand({...command,expectedRevision}).ok).toBe(true);
});
