import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDeckSubagentsExtension } from "./extension";

const FAKE_PI = fileURLToPath(new URL("../../__fixtures__/fake-pi-child.mjs", import.meta.url));
let dir: string, log: string, agentsDir: string;
let cleanup: Array<() => Promise<void>>;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deck-background-")); log = join(dir, "children.jsonl"); agentsDir = join(dir, "agents"); mkdirSync(agentsDir);
  for (const role of ["investigate", "quality", "apply-fast", "lead"]) writeFileSync(join(agentsDir, `deck-${role}.md`), `---\nname: deck-${role}\nmodel: test/model\nthinking: low\ntools: read,grep,find,ls\n---\n${role}\n`);
  cleanup = [];
});
afterEach(async () => { for (const close of cleanup) await close(); rmSync(dir, { recursive: true, force: true }); });
function load(child = false) {
  const tools: any[] = []; const commands: Record<string, any> = {}; const handlers: Record<string, any[]> = {};
  const messages: any[] = []; const entries: Record<string, any[]> = {}; let parent = "parent-a"; let branch: any[] | undefined;
  const ctx = { cwd: dir, hasUI: false, mode: "json", isIdle: () => true, ui: { setStatus() {}, setWidget() {} }, sessionManager: {
    getSessionId: () => parent, getSessionFile: () => join(dir, parent + ".jsonl"), getEntries: () => entries[parent] ?? [], getBranch: () => branch ?? entries[parent] ?? [],
  } };
  createDeckSubagentsExtension({ agentsDir, env: { PATH: process.env.PATH, FAKE_PI_LOG: log, HOME: dir, PI_CODING_AGENT_DIR: dir, ...(child ? { DECK_PI_CHILD: "1" } : {}) }, piInvocation: args => ({ command: process.execPath, args: [FAKE_PI, ...args] }), killGraceMs: 100 })( {
    registerTool: (t: any) => tools.push(t), registerCommand: (name: string, c: any) => commands[name] = c,
    on: (name: string, h: any) => (handlers[name] ??= []).push(h),
    appendEntry: (customType: string, data: any) => (entries[parent] ??= []).push({ type: "custom", customType, data: structuredClone(data) }),
    sendMessage: (m: any, opts: any) => messages.push({ ...m, opts, parent }),
  } as never);
  const emit = async (name: string) => { for (const h of handlers[name] ?? []) await h({}, ctx); };
  const call = (params: any, signal?: AbortSignal) => tools[0].execute("call", params, signal, undefined, ctx);
  const switchTo = async (id: string) => { await emit("session_before_switch"); parent = id; await emit("session_start"); };
  const modelContext = async (messages: any[]) => {
    for (const handler of handlers.context ?? []) messages = (await handler({ messages }, ctx))?.messages ?? messages;
    return messages;
  };
  const i = { tools, commands, messages, entries, emit, call, switchTo, modelContext, selectBranch: (value: any[]) => { branch = value; } }; cleanup.push(() => emit("session_shutdown")); return i;
}
const records = () => existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map(l => JSON.parse(l)) : [];
const text = (r: any) => r.content[0].text;
async function waitUntil(fn: () => boolean) { const end = Date.now() + 5000; while (!fn()) { if (Date.now() > end) throw new Error("Timed out"); await Bun.sleep(10); } }
async function completed(i: ReturnType<typeof load>, id: string) { let r: any; await waitUntil(() => { const snapshots = i.entries["parent-a"] ?? []; r = snapshots.at(-1)?.data.jobs.find((j: any) => j.id === id); return ["completed", "failed", "cancelled"].includes(r?.state); }); return r; }

test("registration preserves recursion guard and exposes discoverable controls", () => {
  const i = load(); expect(i.tools).toHaveLength(1); expect(i.commands.subagents.description).toContain("toggle");
  expect(i.tools[0].description).toContain("overlapping active delegates"); expect(i.tools[0].description).not.toContain("deck-lead,");
  expect(load(true).tools).toHaveLength(0);
});
test("accepts immediately; conversational lead can inspect while child is unfinished; exact child identity/policy/env", async () => {
  const i = load(); await i.emit("session_start");
  const start = Date.now(); const r = await i.call({ agent: "deck-investigate", task: "SLEEP EVENTS" });
  expect(Date.now() - start).toBeLessThan(200); expect(text(r)).toContain("accepted");
  const id = r.details.taskIds[0]; await waitUntil(() => records().length > 0);
  expect(text(await i.call({ action: "inspect", taskId: id }))).toContain("running");
  const rec = records()[0]; expect(rec.argv).toContain("--session"); expect(rec.argv).not.toContain("--no-session");
  expect(rec.env.DECK_PI_PARENT_SESSION).toBe("parent-a"); expect(rec.env.DECK_PI_TASK_ID).toBe(id); expect(rec.env.DECK_PI_CHILD).toBe("1");
  expect(rec.argv[rec.argv.indexOf("--tools") + 1]).toBe("read,grep,find,ls");
  await i.call({ action: "cancel", taskId: id }); await i.emit("session_shutdown");
});
test("parallel and chain acknowledge; prior output substitution and failure stop preserved", async () => {
  const i = load(); await i.emit("session_start");
  const parallel = await i.call({ tasks: [{ agent: "deck-investigate", task: "HOLD one" }, { agent: "deck-quality", task: "FAIL" }] });
  const a = await completed(i, parallel.details.taskIds[0]); const b = await completed(i, parallel.details.taskIds[1]);
  expect(a.state).toBe("completed"); expect(b.output).toContain("model not found");
  const chain = await i.call({ chain: [{ agent: "deck-investigate", task: "first" }, { agent: "deck-quality", task: "review {previous}" }] });
  expect((await completed(i, chain.details.taskIds[1])).output).toContain("review ECHO(test/model|low|read,grep,find,ls): first");
  const broken = await i.call({ chain: [{ agent: "deck-quality", task: "FAIL" }, { agent: "deck-quality", task: "never" }] });
  expect((await completed(i, broken.details.taskIds[1])).state).toBe("cancelled");
});
test("real tool events distinguished from reports; safe followUp terminal delivery including idle", async () => {
  const i = load(); await i.emit("session_start");
  const r = await i.call({ agent: "deck-quality", task: "EVENTS" }); const j = await completed(i, r.details.taskIds[0]);
  expect(j.activity.map((a: any) => a.kind)).toContain("tool"); expect(j.activity.map((a: any) => a.kind)).toContain("report"); expect(j.activity.map((a: any) => a.kind)).toContain("retry");
  expect(i.messages.filter(m => m.customType === "deck-subagent-outcome")).toHaveLength(1);
  expect(i.messages.every(m => m.opts.deliverAs === "followUp" && m.opts.triggerTurn && m.display === false)).toBe(true);
  expect(i.messages[0].content).not.toContain("ECHO");
});
test("new parent never adopts; native-selected old parent restores no processes; exact explicit continuation rejects duplicates", async () => {
  const i = load(); await i.emit("session_start");
  const r = await i.call({ agent: "deck-quality", task: "SLEEP inspect previous effects" }); const id = r.details.taskIds[0];
  await waitUntil(() => records().length === 1); const original = records()[0];
  await i.switchTo("parent-b"); expect(text(await i.call({ action: "list" }))).toContain("No subagents"); expect(i.messages).toHaveLength(0);
  await i.switchTo("parent-a"); expect(text(await i.call({ action: "inspect", taskId: id }))).toContain("interrupted"); expect(records()).toHaveLength(1);
  expect((await i.call({ action: "resume", taskId: id })).isError).toBeUndefined();
  expect((await i.call({ action: "resume", taskId: id })).isError).toBe(true);
  await waitUntil(() => records().length === 2); const resumed = records()[1];
  expect(resumed.argv[resumed.argv.indexOf("--session") + 1]).toBe(original.argv[original.argv.indexOf("--session") + 1]);
  expect(resumed.previousHistory).toContain("SLEEP inspect previous effects"); expect(resumed.argv.at(-1)).toContain("Inspect previous effects");
});
test("shell-capable jobs remain inspectable but explicit continuation refuses uncertain effects without spawn", async () => {
  const i = load(); await i.emit("session_start");
  const accepted = await i.call({ agent: "deck-apply-fast", task: "SLEEP NO_PROOF" }); const id = accepted.details.taskIds[0];
  await waitUntil(() => records().length === 1);
  await i.switchTo("parent-b"); await i.switchTo("parent-a");
  expect(text(await i.call({ action: "inspect", taskId: id }))).toContain("interrupted");
  const refused = await i.call({ action: "resume", taskId: id });
  expect(refused.isError).toBe(true); expect(text(refused)).toContain("effects ownership is uncertain");
  expect(records()).toHaveLength(1);
});
test("rejects role changes/missing exact history and invalid parameters without unrelated spawn", async () => {
  const i = load(); await i.emit("session_start");
  for (const params of [{}, { agent: "deck-lead", task: "x" }, { agent: "unknown", task: "x" }, { agent: "deck-quality", task: "x", tasks: [{ agent: "deck-quality", task: "y" }] }, { tasks: Array.from({ length: 9 }, () => ({ agent: "deck-quality", task: "x" })) }]) expect((await i.call(params)).isError).toBe(true);
  const r = await i.call({ agent: "deck-quality", task: "SLEEP" }); await waitUntil(() => records().length === 1); await i.switchTo("parent-b"); await i.switchTo("parent-a");
  writeFileSync(join(agentsDir, "deck-quality.md"), "---\nname: deck-quality\n---\nchanged");
  expect(text(await i.call({ action: "resume", taskId: r.details.taskIds[0] }))).toContain("policy changed");
  expect(records()).toHaveLength(1);
});
test("tree navigation never rewinds the execution journal or hides accepted jobs, including reload", async () => {
  const i = load(); await i.emit("session_start");
  const r = await i.call({ agent: "deck-quality", task: "HOLD" }); const id = r.details.taskIds[0];
  const old = structuredClone(i.entries["parent-a"]!); await completed(i, id);
  for (const branch of [old, []]) {
    await i.emit("session_before_tree"); i.selectBranch(branch); await i.emit("session_tree");
    expect(text(await i.call({ action: "inspect", taskId: id }))).toContain("completed");
    expect((await i.call({ action: "resume", taskId: id })).isError).toBe(true);
    await i.emit("session_start");
    expect(text(await i.call({ action: "inspect", taskId: id }))).toContain("completed");
  }
  expect(records().filter(r => Array.isArray(r.argv))).toHaveLength(1);
});
test("cancelled/vetoed/failed navigation keeps interrupted jobs inspectable and new delegation usable", async () => {
  const i = load(); await i.emit("session_start");
  for (const event of ["session_before_tree", "session_before_switch", "session_before_fork"]) {
    const r = await i.call({ agent: "deck-quality", task: "SLEEP" }); const id = r.details.taskIds[0];
    await waitUntil(() => records().length === i.entries["parent-a"]!.at(-1).data.jobs.length);
    await i.emit(event); // Native veto/error emits no reopening event.
    expect(text(await i.call({ action: "inspect", taskId: id }))).toContain("interrupted");
    const n = records().length; await Bun.sleep(30); expect(records()).toHaveLength(n);
  }
  const next = await i.call({ agent: "deck-quality", task: "works after cancelled navigation" });
  expect(next.isError).toBeUndefined(); await completed(i, next.details.taskIds[0]);
});
test("tool signal stops pre-acceptance only; session shutdown settles all children without outcome leakage", async () => {
  const i = load(); await i.emit("session_start"); const ac = new AbortController(); ac.abort();
  expect((await i.call({ agent: "deck-quality", task: "SLEEP" }, ac.signal)).isError).toBe(true);
  const accepted = await i.call({ agent: "deck-quality", task: "IGNORE_TERM" }); expect(accepted.isError).toBeUndefined();
  await waitUntil(() => records().length === 1); await i.emit("session_shutdown");
  expect(i.messages).toHaveLength(0); expect(i.entries["parent-a"]!.at(-1).data.jobs[0].state).toBe("interrupted");
  expect(() => process.kill(records()[0].pid, 0)).toThrow();
});
test("Lead reviews and resolves exact outcomes; collapsed tool cards hide internal prompts and reports", async () => {
  const i = load(); await i.emit("session_start");
  const params = { agent: "deck-quality", title: "Check memory", task: "INTERNAL_ASSIGNMENT_EVENTS" };
  const accepted = await i.call(params), id = accepted.details.taskIds[0];
  const job = await completed(i, id);
  const card = (result: any, expanded: boolean) => i.tools[0].renderResult(result, { expanded, isPartial: false }).render(100).join("\n");
  expect(i.tools[0].renderCall(params).render(100).join("\n")).not.toContain("INTERNAL_ASSIGNMENT");
  expect(card(accepted, false)).not.toContain(id);
  expect((await i.call({ action: "resolve", taskId: id, outcomeId: job.outcomeId, disposition: "integrated", summary: "Premature" })).isError).toBe(true);
  const review = await i.call({ action: "review", taskId: id });
  expect(review.details.integration).toBe("reviewing"); expect(review.details.outcomeId).toBe(job.outcomeId);
  expect(card(review, false)).toContain("Check memory"); expect(card(review, false)).not.toContain("INTERNAL_ASSIGNMENT");
  expect(card(review, true)).toContain("INTERNAL_ASSIGNMENT");
  expect((await i.call({ action: "resolve", taskId: id, outcomeId: "obsolete", disposition: "integrated", summary: "Invalid" })).isError).toBe(true);
  const resolved = await i.call({ action: "resolve", taskId: id, outcomeId: job.outcomeId, disposition: "integrated", summary: "Verified evidence and integrated the result" });
  expect(resolved.details.integration).toBe("integrated");
});
test("native contexts replace obsolete and foreign wake messages with only current task state", async () => {
  const i = load(); await i.emit("session_start");
  const accepted = await i.call({ agent: "deck-quality", task: "FAIL" }), id = accepted.details.taskIds[0];
  const terminal = await completed(i, id), oldOutcome = terminal.outcomeId;
  const oldWake = { role: "custom", ...i.messages[0], content: "STALE_FAILED_ATTEMPT" };
  expect((await i.call({ action: "resume", taskId: id })).isError).toBeUndefined();
  const current = JSON.stringify(await i.modelContext([oldWake, oldWake, { role: "custom", customType: "deck-subagent-report", content: "OLD_PROGRESS" }]));
  expect(current).not.toContain("STALE_FAILED_ATTEMPT"); expect(current).not.toContain("OLD_PROGRESS"); expect(current).not.toContain(oldOutcome);
  expect(current).toContain("DECK_PI_TASK_BOARD");
  await i.switchTo("parent-b");
  expect(await i.modelContext([oldWake])).toEqual([]);
  expect((await i.call({ action: "review", taskId: id })).isError).toBe(true);
});
