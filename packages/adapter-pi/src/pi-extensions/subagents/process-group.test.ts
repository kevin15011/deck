import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createChildRunner } from "./runner";
import { parseAgentMarkdown } from "./agents";

test.skipIf(process.platform === "win32")("cancellation settles the child AND a SIGTERM-ignoring delegated tool descendant", async () => {
  const dir = mkdtempSync(join(tmpdir(), "deck-subagent-process-group-")); const log = join(dir, "log"); let descendant: number | undefined;
  try {
    const runner = createChildRunner({ env: { PATH: process.env.PATH, FAKE_PI_LOG: log, HOME: dir, PI_CODING_AGENT_DIR: dir }, piInvocation: args => ({ command: process.execPath, args: [fileURLToPath(new URL("../../__fixtures__/fake-pi-child.mjs", import.meta.url)), ...args] }), killGraceMs: 100 });
    const ac = new AbortController(); const pending = runner.run({ agent: parseAgentMarkdown("deck-apply-fast", "---\nname: deck-apply-fast\n---\nApply"), task: "DESCENDANT", cwd: dir, signal: ac.signal });
    await Bun.sleep(250); descendant = readFileSync(log, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).find(r => r.descendantPid)?.descendantPid;
    expect(descendant).toBeDefined(); ac.abort();
    const outcome = await Promise.race([pending, Bun.sleep(1500).then(() => null)]);
    expect(outcome?.aborted).toBe(true);
    let executing = false;
    try { executing = !readFileSync(`/proc/${descendant}/stat`, "utf8").includes(") Z "); } catch { /* exited/reaped */ }
    expect(executing).toBe(false);
  } finally { if (descendant) { try { process.kill(descendant, "SIGKILL"); } catch {} } rmSync(dir, { recursive: true, force: true }); }
}, 5000);
