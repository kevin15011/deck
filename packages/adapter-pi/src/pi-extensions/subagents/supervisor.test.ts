import { expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CHILD_SUPERVISOR_SOURCE } from "./supervisor";
import { createChildRunner } from "./runner";
import { parseAgentMarkdown } from "./agents";

test.skipIf(process.platform === "win32")("already-disconnected supervisor never spawns a worker", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-supervisor-disconnect-"));
  const marker = join(root, "effect"), script = join(root, "supervisor.mjs"), worker = join(root, "worker.mjs");
  writeFileSync(script, `process.disconnect(); await new Promise(r => setTimeout(r, 50));\n${CHILD_SUPERVISOR_SOURCE}`);
  writeFileSync(worker, `import {writeFileSync} from 'node:fs'; writeFileSync(${JSON.stringify(marker)},'effect');`);
  const child = spawn(process.execPath, [script, process.execPath, worker], { detached: true, stdio: ["ignore", "ignore", "ignore", "ipc"] });
  const exited = new Promise<void>(resolve => child.once("exit", () => resolve()));
  try {
    await Promise.race([exited, Bun.sleep(400)]);
    expect(existsSync(marker)).toBe(false);
    expect(child.signalCode).toBe("SIGKILL");
  } finally {
    if (child.pid && child.exitCode === null && child.signalCode === null) process.kill(-child.pid, "SIGKILL");
    await exited; rmSync(root, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("descendant-held output cannot turn an incomplete drain into success", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-supervisor-drain-")), worker = join(root, "worker.mjs");
  writeFileSync(worker, `import {spawn} from 'node:child_process'; const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['ignore',1,2]}); child.unref(); console.log(JSON.stringify({type:'message_end',message:{role:'assistant',content:'earlier progress'}})); setTimeout(()=>process.exit(0),50);`);
  const runner = createChildRunner({ piInvocation: () => ({ command: process.execPath, args: [worker] }), killGraceMs: 50 });
  try {
    const result = await runner.run({ agent: parseAgentMarkdown("deck-quality", "---\nname: deck-quality\n---\nReview"), task: "drain", cwd: root });
    expect(result.failed).toBe(true);
    expect(result.errorMessage).toContain("output");
  } finally { runner.killAll(); rmSync(root, { recursive: true, force: true }); }
}, 5000);
