import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeRunnerLaunchPlan, runRunnerLaunch } from "./runner-launch-command";
import { createEmptyPiManifest, hashJsonValue } from "@deck/adapter-pi";
import { getDefaultDeckConfig, type RunnerAdapter, type RunnerLaunchPlan } from "@deck/core";

for (const fault of ["ownership", "integrity", "missing"] as const) {
  test(`Deck Pi pre-spawn ${fault}: protects effects boundary`, async () => {
    const root = mkdtempSync(join(tmpdir(), "deck-pi-pre-spawn-"));
    mkdirSync(join(root, "deck"));
    const ownedRoot = join(root, "codebase-native-v0.11.0", `${process.platform}-${process.arch}`);
    const command = fault === "integrity" ? join(ownedRoot, "codebase-memory-mcp") : join(root, "missing/codebase-memory-mcp");
    if (fault === "integrity") { mkdirSync(ownedRoot, { recursive: true, mode: 0o700 }); writeFileSync(command, "corrupt", { mode: 0o700 }); }
    const entry = { command, exposure: "direct" };
    const manifest = createEmptyPiManifest(); manifest.mcp.servers["codebase-memory"] = hashJsonValue(entry);
    writeFileSync(join(root, "deck/manifest.json"), fault === "ownership" ? "invalid" : JSON.stringify(manifest));
    writeFileSync(join(root, "mcp.json"), JSON.stringify({ mcpServers: { "codebase-memory": entry } }));
    const plan: RunnerLaunchPlan = { command: "never-real-pi", args: [], cwd: root, stdio: "pipe", stdin: "closed", envOverlay: { DECK_PI_SESSION: { value: "1" }, PI_CODING_AGENT_DIR: { value: root } } };
    let spawns = 0;
    const effects = { inheritedEnv: { HOME: root }, spawn: async () => { spawns++; return { exitCode: 0, stdout: "", stderr: "" }; } };
    try {
      if (fault === "missing") { expect((await executeRunnerLaunchPlan(plan, effects)).exitCode).toBe(0); expect(spawns).toBe(1); }
      else { await expect(executeRunnerLaunchPlan(plan, effects)).rejects.toThrow(fault === "ownership" ? "pi-codebase-ownership-invalid" : "codebase-memory-integrity-failed"); expect(spawns).toBe(0); }
      if (fault !== "missing") {
        const adapter = {
          runnerId: "pi", displayName: "Pi", environmentIds: ["pi-development"],
          buildDeveloperTeamInstallPlan: () => ({ files: [], mutationPreview: [] }),
          applyDeveloperTeamInstall: async () => ({ results: [], changedCount: 0, unchangedCount: 0 }),
          verifyDeveloperTeamInstall: () => ({ valid: true, diagnostics: [] }),
          backupDeveloperTeamFiles: () => ({ payload: undefined, diagnostics: [] }),
          rollbackDeveloperTeamFiles: async () => ({ status: "nothing-to-do", conflicts: [], diagnostics: [] }),
          buildLaunchPlan: () => ({ status: "ready", plan, diagnostics: [] }),
        } as unknown as RunnerAdapter;
        const config = getDefaultDeckConfig();
        const result = await runRunnerLaunch({ cliMemoryProvider: "none", adapter, launch: { projectRoot: root, teamId: "developer-team", mode: "interactive", deckConfig: { ...config, adaptiveMemory: { ...config.adaptiveMemory, enabled: false } } }, yes: true, interactive: false, presentPreview: async () => {}, processEffects: effects });
        expect(result).toMatchObject({ status: "blocked", message: expect.stringContaining(fault === "ownership" ? "pi-codebase-ownership-invalid" : "codebase-memory-integrity-failed") });
        expect(spawns).toBe(0);
      }
      const controller = new AbortController(); const reason = new DOMException("cancelled", "AbortError"); controller.abort(reason);
      await expect(executeRunnerLaunchPlan(plan, effects, controller.signal)).rejects.toBe(reason);
      expect(spawns).toBe(fault === "missing" ? 1 : 0);
      await expect(runRunnerLaunch({ signal: controller.signal } as never)).rejects.toBe(reason);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
