import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPiHarness, findRealPi } from "../../pi-cli-harness";
import { createChildRunner } from "./runner";
import { parseAgentMarkdown } from "./agents";
import { createDeckSubagentsExtension } from "./extension";

async function until(fn: () => boolean) { const end = Date.now() + 10000; while (!fn()) { if (Date.now() > end) throw new Error("Timed out"); await Bun.sleep(10); } }
test.skipIf(process.platform !== "linux" || !findRealPi())("native running child queues clarification without interrupting bash or replacing history", async () => {
  const h = createPiHarness(), started = join(h.root, "started"), ended = join(h.root, "ended"), history = join(h.root, "child.jsonl"), log = join(h.root, "provider.jsonl");
  const runner = createChildRunner({ packageRoot: join(h.agentDir, "deck/package"), piInvocation: args => ({ command: findRealPi()!, args }), killGraceMs: 50,
    env: { PATH: process.env.PATH, HOME: h.home, PI_CODING_AGENT_DIR: h.agentDir, FAUX_LOG: log, FAUX_CHILD_TOOL: "bash", FAUX_CHILD_TOOL_INPUT: JSON.stringify({ command: `touch '${started}'; sleep 1; echo SHELL_FINISHED > '${ended}'` }) } });
  let deliver: ((message: string) => Promise<unknown>) | undefined;
  let pending: ReturnType<typeof runner.run> | undefined;
  try {
    writeFileSync(history, JSON.stringify({ type: "session", version: 3, id: "same-child", timestamp: new Date().toISOString(), cwd: h.project }) + "\n");
    pending = runner.run({ agent: parseAgentMarkdown("deck-apply-fast", "---\nname: deck-apply-fast\nmodel: faux/faux-1\n---\nApply"), task: "Original authorized assignment", cwd: h.project, sessionFile: history, parentId: "parent", taskId: "task", attempt: 1, onClarifyReady: fn => { deliver = fn; } });
    await until(() => existsSync(started));
    expect(deliver).toBeFunction();
    expect(await deliver!("Clarify acceptance: check the marker only.")).toMatchObject({ delivery: "accepted" });
    expect(existsSync(ended)).toBe(false);
    const result = await pending;
    expect(result.failed, JSON.stringify(result)).toBe(false);
    expect(readFileSync(ended, "utf8")).toContain("SHELL_FINISHED");
    const entries = readFileSync(history, "utf8").trim().split("\n").map(s => JSON.parse(s));
    expect(entries.filter(e => e.type === "session")).toHaveLength(1);
    const users = entries.filter(e => e.type === "message" && e.message.role === "user");
    expect(users).toHaveLength(2);
    expect(JSON.stringify(users[0])).toContain("Original authorized assignment");
    expect(JSON.stringify(users[1])).toContain("Lead clarification");
    expect(JSON.stringify(users[1])).toContain("not new user authorization");
    expect(readFileSync(log, "utf8").split("\n").filter(Boolean).map(s => JSON.parse(s)).some(e => e.child && e.text.includes("Clarify acceptance: check the marker only.") && e.roles.includes("toolResult"))).toBe(true);
    expect(deliver).toBeUndefined();
  } finally { runner.killAll(); await pending; h.cleanup(); }
}, 20000);

test.skipIf(process.platform !== "linux" || !findRealPi())("existing subagent clarify action reaches packaged native child and rejects terminal/foreign targets", async () => {
  const h = createPiHarness(), started = join(h.root, "started"), historyLog = join(h.root, "provider.jsonl"), agentsDir = join(h.root, "roles");
  mkdirSync(agentsDir);
  writeFileSync(join(agentsDir, "deck-apply-fast.md"), "---\nname: deck-apply-fast\nmodel: faux/faux-1\n---\nApply");
  const tools: any[] = [], handlers: Record<string, any[]> = {}, snapshots: any[] = [];
  const parentFile = join(h.root, "parent.jsonl");
  writeFileSync(parentFile, "");
  const ctx = { cwd: h.project, hasUI: false, isIdle: () => true, sessionManager: { getSessionId: () => "parent", getSessionFile: () => parentFile, getEntries: () => [], getBranch: () => [] } };
  createDeckSubagentsExtension({ agentsDir, piInvocation: args => ({ command: findRealPi()!, args }), killGraceMs: 50,
    env: { PATH: process.env.PATH, HOME: h.home, PI_CODING_AGENT_DIR: h.agentDir, FAUX_LOG: historyLog, FAUX_CHILD_TOOL: "bash", FAUX_CHILD_TOOL_INPUT: JSON.stringify({ command: `touch '${started}'; sleep 1; echo COMPLETED_SHELL` }) } })({
    on: (name: string, fn: any) => { (handlers[name] ??= []).push(fn); },
    registerTool: (tool: any) => tools.push(tool), registerCommand() {},
    appendEntry: (_name: string, value: any) => snapshots.push(value), sendMessage() {},
  } as never);
  const emit = async (name: string) => { for (const fn of handlers[name] ?? []) await fn({}, ctx); };
  const call = (params: any) => tools[0].execute("call", params, undefined, undefined, ctx);
  try {
    await emit("session_start");
    expect(tools[0].parameters.properties.action.enum).toContain("clarify");
    const accepted = await call({ agent: "deck-apply-fast", task: "Original task" });
    const taskId = accepted.details.taskIds[0];
    await until(() => existsSync(started));
    const receipt = await call({ action: "clarify", taskId, message: "NATIVE_TOOL_CLARIFICATION" });
    expect(receipt.isError).toBeUndefined();
    expect(receipt.details.delivery).toBe("accepted");
    expect(receipt.content[0].text).toContain("not confirmation");
    expect((await call({ action: "clarify", taskId: "foreign", message: "wrong target" })).isError).toBe(true);
    expect((await call({ action: "clarify", taskId, message: "x".repeat(4001) })).isError).toBe(true);
    await until(() => snapshots.at(-1)?.jobs?.find((j: any) => j.id === taskId)?.state === "completed");
    expect((await call({ action: "clarify", taskId, message: "late" })).isError).toBe(true);
    const calls = readFileSync(historyLog, "utf8").trim().split("\n").map(s => JSON.parse(s)).filter(e => e.child);
    expect(calls).toHaveLength(2);
    expect(calls[1].text).toContain("NATIVE_TOOL_CLARIFICATION");
    expect(calls[1].text).toContain("Original task");
    expect(calls[1].text).toContain("COMPLETED_SHELL");
  } finally { await emit("session_shutdown"); h.cleanup(); }
}, 20000);
