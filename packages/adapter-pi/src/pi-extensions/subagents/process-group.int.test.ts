import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createChildRunner } from "./runner";
import { parseAgentMarkdown } from "./agents";
import { processIsExecuting } from "./execution-lease";

test.skipIf(process.platform === "win32")("cancellation settles the child AND a SIGTERM-ignoring delegated tool descendant", async () => {
  const dir = mkdtempSync(join(tmpdir(), "deck-subagent-process-group-")); const log = join(dir, "log"); let descendant: number | undefined;
  const ac = new AbortController();
  let cleanup: Promise<unknown> | undefined;
  try {
    const runner = createChildRunner({ env: { PATH: process.env.PATH, FAKE_PI_LOG: log, HOME: dir, PI_CODING_AGENT_DIR: dir }, piInvocation: args => ({ command: process.execPath, args: [fileURLToPath(new URL("../../__fixtures__/fake-pi-child.mjs", import.meta.url)), ...args] }), killGraceMs: 100 });
    const pending = runner.run({ agent: parseAgentMarkdown("deck-apply-fast", "---\nname: deck-apply-fast\n---\nApply"), task: "DESCENDANT", cwd: dir, signal: ac.signal });
    cleanup = pending;
    const deadline = performance.now() + 3000;
    while (!descendant && performance.now() < deadline) {
      try { descendant = readFileSync(log, "utf8").split("\n").filter(Boolean).map(l => JSON.parse(l)).find(r => r.descendantPid)?.descendantPid; }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
      if (!descendant) await Bun.sleep(10);
    }
    expect(descendant).toBeDefined(); ac.abort();
    const outcome = await Promise.race([pending, Bun.sleep(1500).then(() => null)]);
    expect(outcome?.aborted).toBe(true);
    expect(processIsExecuting(descendant!)).toBe(false);
  } finally { ac.abort(); await cleanup; rmSync(dir, { recursive: true, force: true }); }
}, 5000);
