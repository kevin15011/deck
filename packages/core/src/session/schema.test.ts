import { DECISION_TOOLS, validDecisionTool } from "./decisions";
import { describe, expect, test } from "bun:test";
import { validateSessionEvent } from "./events";
import { validateSessionCommand } from "./commands";
import { SESSION_COMMAND_SCHEMA, SESSION_EVENT_SCHEMA, SESSION_SCHEMA_DIGEST } from "./schema.generated";
import { buildSessionSchemas } from "./schema";

/** Minimal JSON Schema checker covering only the keywords our generated schemas use. */
function check(schema: any, value: any): boolean {
  if (schema === true || (typeof schema === "object" && Object.keys(schema).length === 0)) return true;
  if (schema.anyOf && !schema.anyOf.some((s: any) => check(s, value))) return false;
  if (schema.oneOf && schema.oneOf.filter((s: any) => check(s, value)).length !== 1) return false;
  if (schema.not && check(schema.not, value)) return false;
  if ("const" in schema && value !== schema.const) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type) {
    const t = schema.type;
    const ok = t === "array" ? Array.isArray(value) : t === "object" ? typeof value === "object" && value !== null && !Array.isArray(value)
      : t === "integer" ? Number.isInteger(value) : t === "number" ? typeof value === "number" && Number.isFinite(value) : t === "string" ? typeof value === "string" : t === "boolean" ? typeof value === "boolean" : true;
    if (!ok) return false;
  }
  if (typeof value === "string") {
    if (schema.minLength && value.length < schema.minLength) return false;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return false;
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return false;
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) return false;
  }
  if (Array.isArray(value)) {
    if(schema.minItems !== undefined && value.length < schema.minItems || schema.maxItems !== undefined && value.length > schema.maxItems) return false;
    if(schema.uniqueItems && new Set(value.map(item => JSON.stringify(item))).size !== value.length) return false;
    if(schema.contains && !value.some(item => check(schema.contains, item))) return false;
    if(schema.items && !value.every(item => check(schema.items,item))) return false;
  }
  if (typeof value === "number" && schema.maximum !== undefined && value > schema.maximum) return false;
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) return false;
  if (value && typeof value === "object" && !Array.isArray(value)) {
    if (schema.maxProperties !== undefined && Object.keys(value).length > schema.maxProperties) return false;
    if (schema.propertyNames && !Object.keys(value).every(key => check(schema.propertyNames, key))) return false;
    if (schema.additionalProperties && !Object.entries(value).filter(([key]) => !(key in (schema.properties ?? {}))).every(([, v]) => check(schema.additionalProperties, v))) return false;
    if(schema.additionalProperties===false && Object.keys(value).some(k=>!Object.hasOwn(schema.properties??{},k))) return false;
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
const hook = { hookId: "h1", hookEvent: "sessionStart", provenance: "codex-app-server", status: "running" };
const hookFixtures = [
  hook,
  { ...hook, hookName: "sessionStart", executionMode: "async", handlerType: "command", durationMs: 42, provider: "supermemory", integration: "runner-plugin" },
  ...["completed", "failed", "blocked", "stopped", "unknown"].map(status => ({ ...hook, status })),
  ...["hookId", "hookEvent", "provenance", "status"].map(field => Object.fromEntries(Object.entries(hook).filter(([key]) => key !== field))),
  ...[{ hookId: "" }, { hookId: "x".repeat(257) }, { hookEvent: "" }, { hookEvent: "x".repeat(129) }, { hookName: "x".repeat(501) }, { provenance: "inferred" }, { status: "saved" }, { durationMs: -1 }, { durationMs: "42" }, { durationMs: NaN }, { durationMs: Infinity }, { executionMode: "background" }, { handlerType: "shell" }, { provider: "supermemory" }, { integration: "runner-plugin" }, { provider: "other", integration: "runner-plugin" }].map(change => ({ ...hook, ...change })),
];

const accounting = { taskId: "child", attempt: 1, leadTaskId: "lead", leadAttempt: 2 };
const integration = { ...accounting, commandId: "review", state: "integrated", note: "Reviewed", evidenceSeqs: [1, 2] };
const continuityFixtures = [
  ...["task.delivery", "task.retrieval"].flatMap(kind => [accounting, {}, { ...accounting, attempt: 0 }, { ...accounting, leadAttempt: 1.5 }, { ...accounting, promptId: "" }].map(data => ev({ kind, data }))),
  ...[integration, {}, { ...integration, state: "verified" }, { ...integration, evidenceSeqs: [] }, { ...integration, evidenceSeqs: [1, 1] }, { ...integration, evidenceSeqs: [0] }, { ...integration, note: "x".repeat(513) }, { ...integration, attempt: 0 }, { ...integration, note: " " }, { ...integration, commandId: " " }, { ...integration, attempt: 1e20 }, { ...integration, evidenceSeqs: [1e20] }].map(data => ev({ kind: "task.integration", data })),
];
const decisionRecord = {decisionId:"decision-1",revision:1,questionRevision:1,questionSeq:4,createdSeq:4,updatedSeq:4,question:"Proceed?",state:"pending",origin:{taskId:"lead",attempt:1,admissionSeq:2},source:{promptId:"p"},key:"key",openingFingerprint:"hash",relatedTaskIds:[]};
const decisionCommand={commandId:"open-1",fingerprint:"hash",type:"deck_decision_open",outcome:{ok:true,data:{decisionId:"decision-1"}}};
const decisionFixtures=[
 ...["decision.opened","decision.revised","decision.state"].flatMap(kind=>[{decision:decisionRecord,command:decisionCommand},{decision:{...decisionRecord,revision:0},command:decisionCommand},{decision:{...decisionRecord,question:"q".repeat(2001)},command:decisionCommand},{decision:{...decisionRecord,note:"bad\u0000"},command:decisionCommand},{decision:{...decisionRecord,state:"answered",note:"Missing resolution"},command:decisionCommand},{decision:{...decisionRecord,state:"superseded",note:"Explicit replacement",replacementDecisionId:"new",scopePromptId:"current-user"},command:decisionCommand},{decision:{...decisionRecord,state:"superseded",note:"Missing user provenance",replacementDecisionId:"new"},command:decisionCommand},{decision:decisionRecord}].map(data=>ev({kind,data}))),
 ...[{command:decisionCommand},{command:{commandId:"incomplete"}},{}].map(data=>ev({kind:"decision.command",data})),
 ...[{decisionId:"decision-1",revision:1,promptId:"p",taskId:"lead",attempt:2,admittedSeq:8,stale:false},{decisionId:"decision-1",revision:0},{}].map(data=>ev({kind:"decision.reply",data})),
];
const fence={promptId:"p",taskId:"lead",attempt:1,nativeThreadId:"thread",nativeTurnId:"turn",clientUserMessageId:"p",text:"Exact native text"};
const eventFixtures: unknown[] = [
  ...[{ grantKinds: [] }, { grantKinds: ["exact", "tool"], exactKeyTruncated: false }, { grantKinds: ["exact", "exact"] }, { grantKinds: ["all"] }, { grantKinds: "exact" }, { exactKeyTruncated: "true" }, {}, { allowedScopes: ["once"] }, { allowedScopes: ["session"] }, { allowedScopes: ["once", "once"] }, { allowedScopes: ["once", "session", "always"], toolKey: "claude:Bash", risk: "high" }, { toolKey: "Bash" }, { toolKey: "claude:bad key" }, { exactKey: "x".repeat(513) }, { risk: "low" }].map(data => ev({ kind: "approval.requested", data: { approvalId: "a", ...data } })),
  ...["once", "session", "always", "forever"].map(scope => ev({ kind: "approval.resolved", data: { approvalId: "a", scope } })),
  ...[{ kind: "exact", exactKey: "ls", matchKey: "a".repeat(64) }, { kind: "exact", exactKey: "ls", matchKey: "raw-secret" }, { kind: "exact", exactKey: "ls" }, { kind: "exact" }, { kind: "tool" }, { kind: "tool", toolKey: "bad" }].map(data => ev({ kind: "session.grant", data: { action: "added", grantId: "g", toolKey: "claude:Bash", risk: "high", by: "u", ...data } })),
  ...["answered", "dismissed", "cancelled"].flatMap(outcome => [
    ev({ kind: "question.resolved", data: { questionId: "r", outcome, by: "user" } }),
    ...[{}, { q1: ["visible"] }, null, [], { q1: [] }, { q1: Array(13).fill("A") }, { q1: ["x".repeat(4001)] }, { "bad\n": ["A"] }, Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`q${i}`, ["A"]]))].map(answers => ev({ kind: "question.resolved", data: { questionId: "r", outcome, by: "user", answers } })),
  ]),
  ...["relay", "yolo", "runner-default", null].flatMap(mode => [ev({ data: { approvals: mode } }), ev({ kind: "session.approvals", data: { mode, by: "user" } })]),
  ev({ kind: "session.approvals", data: { mode: "relay" } }),
  ...["question.requested", "question.resolved"].flatMap(kind => [ev({ kind, data: {} }), ev({ kind, data: { questionId: "q" } })]),
 ...[{}, {queueFallback:false}, {queueFallback:true}, {queueFallback:'true'}, {queueFallback:null}].map(extra=>ev({kind:'prompt.steered',data:{promptId:'p',steeringSeq:3,state:'not-accepted',eligible:false,stale:false,...extra}})),
 ...['accepted','unknown'].map(state=>ev({kind:'prompt.steered',data:{promptId:'p',steeringSeq:3,state,eligible:false,stale:false,via:'receipt',queueFallback:true}})),
 ...[fence,...['codex','claude','opencode','',null,12,['claude'],{value:'claude'},true].map(runnerId=>({...fence,runnerId})),{...fence,attempt:0},{...fence,text:""},{...fence,nativeTurnId:"x".repeat(129)},{...fence,targetQuestionRevision:0}].map(data=>ev({kind:"prompt.steering",data})),
 ...[{promptId:"p",steeringSeq:3,state:"accepted",eligible:true,stale:false,via:"receipt"},{promptId:"p",steeringSeq:3,state:"unknown",eligible:false,stale:false},{promptId:"p",steeringSeq:3,state:"accepted",eligible:true},{promptId:"p",steeringSeq:0,state:"unknown",eligible:false,stale:false}].map(data=>ev({kind:"prompt.steered",data})),
  ...continuityFixtures, ...decisionFixtures,
  ev({}), ev({ kind: "nope" }), ev({ seq: 0 }), ev({ seq: 1.5 }), ev({ v: 2 }), ev({ ts: "bad" }),
  ev({ source: undefined }), ev({ data: [] }), ev({ source: { memberId: 1 } }),
  ev({ kind: "turn.completed", data: { status: "completed" } }), ev({ kind: "turn.completed", data: { status: "x" } }),
  ev({ kind: "turn.completed", data: {} }),
  ev({ kind: "approval.requested", data: {} }), ev({ kind: "approval.requested", data: { approvalId: "a" } }),
  ev({ kind: "runner.unmapped", raw: { runnerId: "codex", protocol: "codex-app-server", payload: 1, truncated: false } }),
  ev({ raw: { runnerId: "x" } }), ev({ sessionId: "" }),
  ...["hook.started", "hook.completed"].flatMap(kind => hookFixtures.map(data => ev({ kind, data }))),
];
const commandFixtures: unknown[] = [
  ...[{}, { scope: "once" }, { scope: "session", grant: "exact" }, { scope: "always", confirmed: true }, { scope: "forever" }, { grant: "all" }, { confirmed: "yes" }].map(data => cm({ type: "approval.respond", approvalId: "a", decision: "allow", ...data })),
  cm({ type: "session.revokeGrant", grantId: "g" }), cm({ type: "session.revokeGrant" }),
  ...["relay", "yolo", "runner-default", null].flatMap(mode => [cm({ type: "session.create", projectRoot: "/p", approvals: mode }), cm({ type: "session.setApprovals", mode })]),
  cm({ type: "session.setApprovals" }),
  ...[{}, { q1: ["A"] }, { q1: [] }, { q1: Array(13).fill("A") }, { "bad\n": ["A"] }, { q1: ["x".repeat(4001)] }, Object.fromEntries(Array.from({ length: 9 }, (_, i) => [`q${i}`, ["A"]]))].map(answers => cm({ type: "question.answer", questionId: "q", answers })),
  cm({ type: "question.dismiss", questionId: "q" }), cm({ type: "question.dismiss" }),
 cm({type:"prompt.send",text:"Current turn",delivery:"current-turn"}),cm({type:"prompt.send",text:"Bad delivery",delivery:"unsafe"}),
 ...[{decisionId:"d",revision:1},{decisionId:"d",revision:0},{decisionId:"d",revision:1,extra:true}].map(decisionTarget=>cm({type:"prompt.send",text:"reply",decisionTarget})),
 ...["decision.defer","decision.cancel","decision.reopen"].flatMap(type=>[{decisionId:"d",expectedRevision:1,note:"User intent"},{decisionId:"d",expectedRevision:0,note:"Bad"},{decisionId:"d",expectedRevision:1,note:"x".repeat(513)},{decisionId:"d",expectedRevision:1,note:"bad\u0000"},{decisionId:"d",expectedRevision:1,note:"bad\u001f"},{decisionId:"d",expectedRevision:1,note:" \n\t"}].map(d=>cm({type,...d}))),
  cm({}), cm({ commandId: "nope" }), cm({ type: "x" }), cm({ v: 2 }),
  cm({ type: "session.create", projectRoot: "/p" }), cm({ type: "session.create" }),
  cm({ type: "session.create", projectId: "p" }), cm({ type: "session.create", projectRoot: "/p", projectId: "p" }),
  cm({ type: "project.register", path: "/p", name: "Deck" }), cm({ type: "project.register" }),
  cm({ type: "project.rename", projectId: "p", name: "New name" }), cm({ type: "project.rename", projectId: "p" }),
  cm({ type: "project.remove", projectId: "p" }), cm({ type: "project.remove" }),
  ...[{projectId:"p",runnerId:"opencode",trusted:true,expectedRevision:0},{projectId:"p",runnerId:"opencode",trusted:false,expectedRevision:0},{projectId:"p",runnerId:"opencode",trusted:"true",expectedRevision:0},{projectId:"p",runnerId:"codex",trusted:true,expectedRevision:0},{projectId:"",runnerId:"opencode",trusted:false,expectedRevision:0}].map(value=>cm({type:"project.trust",...value})),
  ...[{}, ...[-1,0.5,"0",null,Number.MAX_SAFE_INTEGER,Number.MAX_SAFE_INTEGER+1].map(expectedRevision=>({expectedRevision}))].map(fields=>cm({type:"project.trust",projectId:"p",runnerId:"opencode",trusted:true,...fields})),
  cm({type:"session.release"}),cm({type:"session.remove"}),cm({type:"session.rename",title:"Renamed"}),cm({type:"session.rename",title:" "}),cm({type:"session.rename",title:"x".repeat(161)}),
  cm({ type: "session.prepare" }), cm({ type: "session.prepare.cancel", preparationId: "p" }), cm({ type: "session.prepare.cancel" }),
  cm({ type: "session.continue", title: "Follow up" }), cm({ type: "session.continue", title: "x".repeat(161) }),
  cm({ type: "session.assignMember", memberId: "lead", expectedRevision: 0, assignment: { runnerId: "codex", modelId: "gpt" } }),
  cm({ type: "session.assignMember", memberId: "lead", expectedRevision: -1, assignment: { runnerId: "codex", modelId: "gpt" } }),
  cm({ type: "session.attach", after: 0 }), cm({ type: "session.attach", after: -1 }),
  cm({ type: "prompt.send", text: "hi" }), cm({ type: "prompt.send", text: "" }),
  ...[{text:"",attachmentIds:[cid]}, {text:"",attachmentIds:[]}, {text:"hi",attachmentIds:[cid,cid]}, {text:"",attachmentIds:["../file"]}, {text:"hi",attachmentIds:"file"}, {text:"hi",attachmentIds:[]}, {text:"   "}, {text:"hi",attachmentIds:Array.from({length:9},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,"0")}`)}].map(fields=>cm({type:"prompt.send",...fields})),
  cm({ type: "approval.respond", approvalId: "a", decision: "allow" }), cm({ type: "approval.respond", approvalId: "a", decision: "maybe" }),
  cm({ type: "turn.interrupt", taskId: "t" }), cm({ type: "turn.interrupt" }),
];

test("canonical decision MCP schemas agree with runtime input validation",()=>{
 const base={commandId:"c",decisionId:"d",expectedRevision:1,note:"Reason"};
 const inputs:Record<string,Record<string,unknown>[]>={
  deck_decision_open:[{commandId:"c",key:"key",question:"Question?",source:{promptId:"p"}},{commandId:"c",key:"key",question:"",source:{promptId:"p"}},{commandId:"c",key:"key",question:"Question?",source:{taskId:"t",attempt:1}},{commandId:"c",key:"key",question:"Question?",source:{promptId:"p",taskId:"t"}}],
  deck_decision_list:[{}, {extra:true}],
  deck_decision_revise:[{...base,question:"New question?"},{...base,state:"superseded",replacementDecisionId:"new"},{...base,state:"superseded",scopePromptId:"p"},{...base,state:"superseded",replacementDecisionId:"new",scopePromptId:"p"},{...base,state:"superseded",replacementDecisionId:"new",scopePromptId:3},{...base}],
  deck_decision_resolve:[{...base,promptId:"p",disposition:"deny"},{...base,promptId:"p",disposition:"allow",action:"execute"},{...base,promptId:"p",disposition:"allow"},{...base,promptId:"p",disposition:"unknown"},{...base,promptId:"p",disposition:"informational",note:"bad\u0000"}],
 };
 for(const tool of DECISION_TOOLS)for(const input of inputs[tool.name]!)expect([check(tool.inputSchema,input),tool.name,input]).toEqual([validDecisionTool(tool.name,input),tool.name,input]);
});
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
