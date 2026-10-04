import { expect, test } from "bun:test";
import { createDeckSubagentsExtension } from "./extension";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createChildRunner } from "./runner";
import { parseAgentMarkdown } from "./agents";
import { assertExecutionSettled } from "./execution-lease";

for (const proof of ["stdout", "wrong-pid", "wrong-nonce"]) test(`custom child ${proof} cannot clear the uncertain execution fence`, async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-child-proof-")), history = join(root, "history.jsonl"), script = join(root, "child.mjs");
  try {
    writeFileSync(history, "{}\n", { mode: 0o600 });
    writeFileSync(script, `import {writeSync} from 'node:fs'; const proof={version:1,nonce:${proof === "wrong-nonce" ? '"foreign"' : "process.env.DECK_PI_CONTAINMENT"},pid:${proof === "wrong-pid" ? "process.ppid" : "process.pid"}}; ${proof === "stdout" ? "writeSync(1,JSON.stringify(proof)+'\\n');" : "await new Promise(resolve => process.send(proof, resolve));"} if(process.connected) process.disconnect();`);
    const runner = createChildRunner({ piInvocation: () => ({ command: process.execPath, args: [script] }) });
    const request = { agent: parseAgentMarkdown("deck-apply-fast", "---\nname: deck-apply-fast\n---\nApply"), task: "custom runtime", cwd: root, sessionFile: history, parentId: "parent", taskId: "task" };
    const result = await runner.run(request);
    expect(result.failed).toBe(true); expect(result.errorMessage).toContain("startup was not verified");
    expect(JSON.parse(readFileSync(history + ".execution", "utf8")).effectsUncertain).toBe(true);
    expect(() => assertExecutionSettled(history, "parent", "task")).toThrow("ownership");
    expect((await runner.run(request)).errorMessage).toContain("ownership");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const role of ["investigate", "quality"]) test(`child ${role} never gains shell tools or parent UI/delegation`, async () => {
  const handlers: Record<string, any> = {}; const tools: any[] = [];
  await createDeckSubagentsExtension({ env: { DECK_PI_CHILD: "1", DECK_PI_ROLE: role, DECK_PI_CONTAINMENT: "test" } })({
    on: (name: string, handler: any) => handlers[name] = handler,
    registerTool: (tool: any) => tools.push(tool), registerCommand: () => { throw new Error("Parent command leaked"); },
  } as never);
  expect(tools).toHaveLength(0);
  for (const toolName of ["bash", "powershell"]) expect((await handlers.tool_call({ toolName })).block).toBe(true);
  expect(await handlers.tool_call({ toolName: "read" })).toBeUndefined();
  expect(handlers.session_start).toBeUndefined();
});
