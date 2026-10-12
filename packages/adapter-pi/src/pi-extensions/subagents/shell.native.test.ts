import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPiHarness, findRealPi } from "../../pi-cli-harness";
import { createChildRunner } from "./runner";
import { parseAgentMarkdown } from "./agents";
import { assertExecutionSettled, processGroupOf, processIsExecuting } from "./execution-lease";

const executing = processIsExecuting;
async function until(fn: () => boolean) { const end = performance.now() + 8000; while (!fn()) { if (performance.now() > end) throw new Error("Timed out"); await Bun.sleep(10); } }
for (const mode of ["completion", "cancellation", "timeout", "failure"] as const) test.skipIf(!["linux", "darwin"].includes(process.platform) || !findRealPi())(`packaged Pi child native bash settles redirected background process on ${mode}; same history remains eligible`, async () => {
  const harness = createPiHarness(); const marker = join(harness.root, "pid"), history = join(harness.root, "child.jsonl");
  const env: Record<string, string | undefined> = { PATH: process.env.PATH, HOME: harness.home, PI_CODING_AGENT_DIR: harness.agentDir, FAUX_CHILD_TOOL: "bash", FAUX_CHILD_TOOL_INPUT: JSON.stringify({ command: `sleep 30 </dev/null >/dev/null 2>&1 & echo $! > '${marker}'; printf NATIVE_OK; ${["cancellation", "timeout"].includes(mode) ? "sleep 30" : "sleep 0.1"}`, ...(mode === "timeout" ? { timeout: 0.2 } : {}) }), ...(mode === "failure" ? { FAUX_CHILD_FAIL: "1" } : {}) };
  const runner = createChildRunner({ piInvocation: args => ({ command: findRealPi()!, args }), packageRoot: join(harness.agentDir, "deck/package"), killGraceMs: 50, env });
  let pid = 0; let pending: ReturnType<typeof runner.run> | undefined;
  try {
    writeFileSync(history, JSON.stringify({ type: "session", version: 3, id: "child", timestamp: new Date().toISOString(), cwd: harness.project }) + "\n", { mode: 0o600 });
    const ac = new AbortController(); const agent = parseAgentMarkdown("deck-apply-fast", "---\nname: deck-apply-fast\nmodel: faux/faux-1\n---\nApply");
    const request = { agent, task: "exercise native bash", cwd: harness.project, sessionFile: history, parentId: "parent", taskId: "task" };
    pending = runner.run({ ...request, signal: ac.signal });
    await until(() => existsSync(marker)); pid = Number(readFileSync(marker, "utf8"));
    const lease = JSON.parse(readFileSync(history + ".execution", "utf8"));
    expect(processGroupOf(pid)).toBe(lease.group);
    if (mode === "cancellation") ac.abort();
    const result = await pending;
    expect(result.aborted).toBe(mode === "cancellation");
    expect(result.failed, JSON.stringify(result)).toBe(mode !== "completion");
    expect(result.failureKind).toBe(mode === "completion" ? undefined : mode === "cancellation" ? "cancelled" : mode === "timeout" ? "shell_timeout" : "model_error");
    if (mode === "timeout") { expect(result.signal).toBe("SIGKILL"); expect(result.errorMessage).toContain("shell command timeout after 0.2s"); }
    expect(executing(pid)).toBe(false);
    expect(() => assertExecutionSettled(history, "parent", "task")).not.toThrow();
    expect(existsSync(history + ".execution")).toBe(false);
    if (["completion", "failure"].includes(mode)) expect(readFileSync(history, "utf8")).toContain("NATIVE_OK");
    if (mode !== "completion") {
      delete env.FAUX_CHILD_TOOL; delete env.FAUX_CHILD_FAIL;
      const continued = await runner.run({ ...request, task: "Inspect previous effects then continue" });
      expect(continued.failed).toBe(false);
      expect(continued.errorMessage ?? "").not.toContain("ownership");
      expect(readFileSync(history, "utf8")).toContain("Inspect previous effects then continue");
    }
  } finally { runner.killAll(); await pending; if (pid && executing(pid)) { try { process.kill(pid, "SIGKILL"); } catch {} } harness.cleanup(); }
}, 20000);
