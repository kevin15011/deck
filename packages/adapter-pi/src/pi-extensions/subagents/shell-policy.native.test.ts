import { expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPiHarness, findRealPi } from "../../pi-cli-harness";
import { createChildRunner } from "./runner";
import { parseAgentMarkdown } from "./agents";

test.skipIf(process.platform !== "linux" || !findRealPi())("custom non-Bash shell cannot acknowledge containment or launch a command", async () => {
  const h = createPiHarness(), history = join(h.root, "history.jsonl"), effect = join(h.root, "effect");
  try {
    writeFileSync(join(h.agentDir, "settings.json"), JSON.stringify({ packages: ["./deck/package"], shellPath: "/bin/sh" }));
    writeFileSync(history, JSON.stringify({ type: "session", version: 3, id: "child", timestamp: new Date().toISOString(), cwd: h.project }) + "\n", { mode: 0o600 });
    const runner = createChildRunner({ packageRoot: join(h.agentDir, "deck/package"), piInvocation: args => ({ command: findRealPi()!, args }), env: { PATH: process.env.PATH, HOME: h.home, PI_CODING_AGENT_DIR: h.agentDir, FAUX_CHILD_TOOL: "bash", FAUX_CHILD_TOOL_INPUT: JSON.stringify({ command: `echo escape > '${effect}'` }) } });
    const result = await runner.run({ agent: parseAgentMarkdown("deck-apply-fast", "---\nname: deck-apply-fast\nmodel: faux/faux-1\n---\nApply"), task: "unsupported shell", cwd: h.project, sessionFile: history, parentId: "parent", taskId: "task" });
    expect(result.failed).toBe(true); expect(result.errorMessage).toContain("startup was not verified");
    expect(existsSync(effect)).toBe(false);
    expect(JSON.parse(readFileSync(history + ".execution", "utf8")).effectsUncertain).toBe(true);
  } finally { h.cleanup(); }
}, 10000);

for (const [role, tool] of [["investigate", "bash"], ["quality", "bash"], ["apply-fast", "powershell"]]) test.skipIf(process.platform !== "linux" || !findRealPi())(`packaged child ${role} cannot escape through ${tool}`, async () => {
  const h = createPiHarness(), log = join(h.root, "provider-log"), effect = join(h.root, "effect");
  try {
    const runner = createChildRunner({ packageRoot: join(h.agentDir, "deck/package"), piInvocation: args => ({ command: findRealPi()!, args }), env: { PATH: process.env.PATH, HOME: h.home, PI_CODING_AGENT_DIR: h.agentDir, FAUX_LOG: log, FAUX_CHILD_TOOL: tool, FAUX_CHILD_TOOL_INPUT: JSON.stringify({ command: `echo escape > '${effect}'` }) } });
    const result = await runner.run({ agent: parseAgentMarkdown(`deck-${role}`, `---\nname: deck-${role}\nmodel: faux/faux-1\n---\nRole`), task: "try forbidden shell", cwd: h.project });
    expect(result.failed, JSON.stringify(result)).toBe(false);
    expect(existsSync(effect)).toBe(false);
    const calls = readFileSync(log, "utf8").trim().split("\n").map(l => JSON.parse(l));
    expect(calls.at(-1).text).toContain('"isError":true');
    expect(calls.at(-1).text).toMatch(/unsupported|blocked|not found|not allowed/i);
  } finally { h.cleanup(); }
}, 10000);
