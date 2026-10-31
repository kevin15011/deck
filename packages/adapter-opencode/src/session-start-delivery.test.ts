import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenCodeDeveloperTeamExecutionPluginV1 } from "../assets/opencode/plugins/developer-team-execution";
import { createPiDeveloperTeamExecutionExtensionV1 } from "../../adapter-pi/assets/pi/extensions/developer-team-execution";

// Protects immutable delivery: transforms must use lifecycle-cached evidence,
// and a rejected replacement must never retain evidence from the prior lifecycle.
test("OpenCode and Pi lifecycle consumers cache validated snapshots and reject tampering", async () => {
  const root = mkdtempSync(join(tmpdir(), "deck-lifecycle-"));
  try {
    const file = join(root, "context.json");
    const raw = JSON.stringify({ root, epoch: "epoch", generation: "generation", text: "prepared readiness" });
    writeFileSync(file, raw, { mode: 0o600 });
    const environment = { DECK_SESSION_START_CONTEXT: file, DECK_SESSION_START_DIGEST: createHash("sha256").update(raw).digest("hex"), DECK_SESSION_START_EPOCH: "epoch", DECK_SESSION_START_GENERATION: "generation" };
    const plugin = await createOpenCodeDeveloperTeamExecutionPluginV1({ environment })({ directory: root });
    const handlers: Record<string, (event: any, context: any) => Promise<any>> = {};
    createPiDeveloperTeamExecutionExtensionV1({ environment })({ on: (event, handler) => { handlers[event] = handler; } });
    await handlers.session_start!({}, { cwd: root });
    writeFileSync(file, raw.replace("prepared readiness", "tampered readiness"));
    const output = { system: ["native instructions"] };
    await plugin["experimental.chat.system.transform"]({}, output);
    await plugin["experimental.chat.system.transform"]({}, output);
    expect(output.system).toEqual(["native instructions", "prepared readiness"]);
    expect(await handlers.before_agent_start!({ systemPrompt: "native instructions" }, {})).toEqual({ systemPrompt: "native instructions\n\nprepared readiness" });
    await plugin.event({ event: { type: "session.created" } });
    const refreshed = { system: ["native instructions"] };
    await plugin["experimental.chat.system.transform"]({}, refreshed);
    expect(refreshed.system).toEqual(["native instructions"]);
    await handlers.session_start!({}, { cwd: root });
    expect(await handlers.before_agent_start!({ systemPrompt: "native instructions" }, {})).toBeUndefined();
    const rejected = await createOpenCodeDeveloperTeamExecutionPluginV1({ environment })({ directory: root });
    const clean = { system: ["native instructions"] };
    await rejected["experimental.chat.system.transform"]({}, clean);
    expect(clean.system).toEqual(["native instructions"]);
    const updated = raw.replace("prepared readiness", "refreshed readiness");
    writeFileSync(file, updated);
    environment.DECK_SESSION_START_DIGEST = createHash("sha256").update(updated).digest("hex");
    for (const type of ["session.created", "file.watcher.updated", "session.idle"]) {
      await plugin.event({ event: { type } });
      const output = { system: [] as string[] };
      await plugin["experimental.chat.system.transform"]({}, output);
      expect(output.system).toEqual(["refreshed readiness"]);
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});
