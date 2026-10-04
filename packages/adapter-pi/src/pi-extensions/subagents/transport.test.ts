import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createChildRunner } from "./runner";
import { parseAgentMarkdown } from "./agents";

const agent = parseAgentMarkdown("deck-apply-fast", "---\nname: deck-apply-fast\n---\nApply");
test("startup proof uses Node-compatible IPC and closes cleanly under allocation pressure", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-ipc-proof-"));
  const script = join(root, "child.mjs");
  writeFileSync(script, `if (!process.send) process.exit(2);
await new Promise((resolve, reject) => process.send({version:1, nonce:process.env.DECK_PI_CONTAINMENT, pid:process.pid}, error => error ? reject(error) : resolve()));
process.disconnect();
console.log(JSON.stringify({type:"message_end",message:{role:"assistant",content:[{type:"text",text:"IPC_VERIFIED"}],stopReason:"stop"}}));`);
  const runner = createChildRunner({ piInvocation: () => ({ command: "node", args: [script] }), timeoutMs: 3000, killGraceMs: 50 });
  try {
    for (let attempt = 0; attempt < 4; attempt++) {
      const pending = runner.run({ agent, task: "transport", cwd: root });
      Bun.gc(true);
      const result = await pending;
      expect(result.errorMessage).toBeUndefined();
      expect(result.failed).toBe(false);
      expect(result.text).toBe("IPC_VERIFIED");
    }
  } finally { runner.killAll(); rmSync(root, { recursive: true, force: true }); }
}, 15000);
