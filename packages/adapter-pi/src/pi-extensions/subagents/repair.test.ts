import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createChildRunner } from "./runner";
import { parseAgentMarkdown } from "./agents";
import { clean } from "./jobs";
import { assertExecutionSettled, claimExecution, processIsExecuting } from "./execution-lease";
function timeoutProbe(stage: string, data: Record<string, unknown> = {}) {
  const observer = Reflect.get(globalThis, "__deckTimeoutProbe");
  if (typeof observer === "function") {
    try { observer(stage, data); } catch { /* Diagnostics must not alter test control flow. */ }
  }
}

const agent = parseAgentMarkdown("deck-apply-fast", "---\nname: deck-apply-fast\n---\nApply");
const executing = processIsExecuting;
async function until(fn: () => boolean) { const end = Date.now() + 3000; while (!fn()) { if (Date.now() > end) throw new Error("Timed out"); await Bun.sleep(10); } }
test("quoted JSON, env, header and assignment credentials are redacted and bounded", () => {
  const text = clean('{"token":"sentinel-secret","api_key": "api secret","password":"p\\\"quoted"} OPENAI_API_KEY=env-secret DATABASE_PASSWORD="db secret" X-API-Key: header-secret Authorization: Basic abcdef token = \'assignment secret\'');
  for (const secret of ["sentinel-secret", "api secret", "p", "env-secret", "db secret", "header-secret", "abcdef", "assignment secret"]) {
    if (secret !== "p") expect(text).not.toContain(secret);
  }
  expect(text).not.toContain('quoted'); expect(clean("x".repeat(500000))).toHaveLength(12000);
  expect(clean('{"authorization":"auth-sentinel"} AWS_SECRET_ACCESS_KEY=aws-sentinel CLIENT_SECRET_VALUE="client-sentinel"')).not.toContain("sentinel");
});
test.skipIf(!["linux", "darwin"].includes(process.platform))("unknown, reused and foreign execution identities fail closed without signals", () => {
  const dir = mkdtempSync(join(tmpdir(), "deck-lease-identity-")), file = join(dir, "child.jsonl");
  try {
    claimExecution(file, "parent", "task", false);
    const recorded = JSON.parse(readFileSync(file + ".execution", "utf8")).parent;
    const boot = recorded.boot;
    const id = process.platform === "darwin" ? recorded : { pid: process.pid, birth: "0", boot };
    const lease = { version: 2, effectsUncertain: false, nonce: "test", file, parentId: "parent", taskId: "task", parent: id, child: id, group: process.pid };
    for (const changes of [{}, { parent: undefined }, { parent: { pid: -1, birth: "0", boot } }, { parentId: "foreign" }, { child: undefined }, { group: -1 }]) {
      writeFileSync(file + ".execution", JSON.stringify({ ...lease, ...changes }), { mode: 0o600 });
      expect(() => assertExecutionSettled(file, "parent", "task")).toThrow("settled");
      expect(process.kill(process.pid, 0)).toBe(true);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test.skipIf(!["linux", "darwin"].includes(process.platform))("normal leader exit settles ignored-stdio SIGTERM-ignoring descendants", async () => {
  const dir = mkdtempSync(join(tmpdir(), "deck-terminal-group-")); let pid = 0;
  try {
    const child = join(dir, "child.mjs"), log = join(dir, "pid");
    writeFileSync(child, `import {spawn} from 'node:child_process'; import {writeFileSync} from 'node:fs'; const p=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"],{stdio:'ignore'}); writeFileSync(${JSON.stringify(log)},String(p.pid)); p.unref(); setTimeout(()=>process.exit(0),100);`);
    const runner = createChildRunner({ piInvocation: () => ({ command: process.execPath, args: [child] }), killGraceMs: 50 });
    const result = await runner.run({ agent, task: "work", cwd: dir });
    pid = Number(readFileSync(log, "utf8"));
    expect(result.failed).toBe(true); expect(result.errorMessage).toContain("startup was not verified");
    await until(() => !executing(pid));
    runner.killAll(); expect(executing(pid)).toBe(false);
  } finally { if (pid && executing(pid)) process.kill(pid, "SIGKILL"); rmSync(dir, { recursive: true, force: true }); }
}, 5000);
test.skipIf(!["linux", "darwin"].includes(process.platform))("SIGKILL parent cannot produce a duplicate history writer; recovery waits for prior group settlement", async () => {
  const dir = mkdtempSync(join(tmpdir(), "deck-parent-death-"));
  let parent: ReturnType<typeof spawn> | undefined; let pid = 0;
  try {
    const child = join(dir, "child.mjs"), log = join(dir, "pid"), file = join(dir, "child.jsonl");
    writeFileSync(file, "{}\n", { mode: 0o600 });
    writeFileSync(child, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(log)},String(process.pid)); setTimeout(()=>process.exit(0),900);`);
    const runnerPath = resolve(import.meta.dir, "runner.ts"), agentsPath = resolve(import.meta.dir, "agents.ts");
    const parentScript = join(dir, "parent.mjs");
    writeFileSync(parentScript, `import {createChildRunner} from ${JSON.stringify(runnerPath)}; import {parseAgentMarkdown} from ${JSON.stringify(agentsPath)}; await createChildRunner({piInvocation:()=>({command:process.execPath,args:[${JSON.stringify(child)}]})}).run({agent:parseAgentMarkdown("deck-quality","---\\nname: deck-quality\\n---\\nReview"),task:"work",cwd:${JSON.stringify(dir)},sessionFile:${JSON.stringify(file)},parentId:"parent",taskId:"task"});`);
    timeoutProbe("parent-death.spawn.before", { dir });
    parent = spawn(process.execPath, [parentScript], { stdio: "ignore" });
    timeoutProbe("parent-death.spawn.after", { pid: parent.pid });
    await until(() => existsSync(log)); pid = Number(readFileSync(log, "utf8"));
    timeoutProbe("parent-death.child.ready", { parentPid: parent.pid, childPid: pid });
    await until(() => { try { return !!JSON.parse(readFileSync(file + ".execution", "utf8")).child && !existsSync(file + ".execution.gate"); } catch { return false; } });
    timeoutProbe("parent-death.lease.ready", { parentPid: parent.pid, childPid: pid });
    expect(executing(pid)).toBe(true);
    expect(() => assertExecutionSettled(file, "parent", "task")).toThrow("settled");
    const runner = createChildRunner({ piInvocation: () => ({ command: process.execPath, args: [child] }) });
    const request = { agent: parseAgentMarkdown("deck-quality", "---\nname: deck-quality\n---\nReview"), task: "work", cwd: dir, sessionFile: file, parentId: "parent", taskId: "task" };
    timeoutProbe("parent-death.refusal.before");
    const refused = await runner.run(request);
    timeoutProbe("parent-death.refusal.after", { failed: refused.failed, parentExitCode: parent.exitCode, parentSignalCode: parent.signalCode });
    expect(refused.failed).toBe(true); expect(refused.errorMessage).toContain("settled");
    expect(Number(readFileSync(log, "utf8"))).toBe(pid);
    const group = JSON.parse(readFileSync(file + ".execution", "utf8")).group;
    timeoutProbe("parent-death.close-listener.before", { parentPid: parent.pid, childPid: pid, group, exitCode: parent.exitCode, signalCode: parent.signalCode });
    const exited = new Promise<void>(r => parent!.once("close", () => r()));
    const signalled = parent.kill("SIGKILL");
    timeoutProbe("parent-death.kill.after", { parentPid: parent.pid, signalled, exitCode: parent.exitCode, signalCode: parent.signalCode });
    await exited;
    timeoutProbe("parent-death.close.after", { parentPid: parent.pid, exitCode: parent.exitCode, signalCode: parent.signalCode });
    await until(() => !executing(pid));
    timeoutProbe("parent-death.child.stopped", { childPid: pid });
    // Exit and OS reaping are distinct; do not treat a zombie group as absent.
    await until(() => { try { process.kill(-group, 0); return false; } catch { return true; } });
    expect(() => process.kill(-group, 0)).toThrow();
    timeoutProbe("parent-death.recovery.before");
    expect((await runner.run(request)).failed).toBe(false);
    timeoutProbe("parent-death.recovery.after");
  } finally { parent?.kill("SIGKILL"); if (pid && executing(pid)) process.kill(pid, "SIGKILL"); rmSync(dir, { recursive: true, force: true }); }
}, 6000);
