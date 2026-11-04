import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDefaultDeckConfig } from "@deck/core";
import { createCodexRunnerAdapter } from "../../../packages/adapter-codex/src/runner-adapter";
import { CODEX_0162_FIXTURE as release } from "../../../packages/adapter-codex/src/__fixtures__/codex/release-0.162.1";
import { TAVILY_PROVIDER_DESCRIPTOR } from "@deck/provider-tavily";
import { executeRunnerLaunchPlan } from "./runner-launch-command";

// Protects the producer-to-spawn credential contract: only the selected search
// credential may cross the boundary, and child output must redact it.
for (const authorization of ["producer", "unknown-binding", "unapproved-key"] as const) {
  test(`Codex fallback credential at process boundary: ${authorization}`, async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "deck-codex-search-launch-")));
    const codexHome = join(root, ".codex");
    mkdirSync(codexHome);
    writeFileSync(join(codexHome, "config.toml"), 'web_search = "disabled"\n');
    const credential = "fixture-search-credential";
    const unrelated = "fixture-unapproved-credential";
    const adapter = createCodexRunnerAdapter({
      userHome: root, codexHome,
      sessionDriver: { baseEnv: {} },
      preflight: { probe: async () => ({ found: true, version: "0.162.1", help: release.help, execHelp: release.execHelp, resumeHelp: release.resumeHelp }) },
      webSearchCredential: () => credential,
      webSearchProviderResolver: () => TAVILY_PROVIDER_DESCRIPTOR,
    });
    try {
      const deckConfig = getDefaultDeckConfig();
      deckConfig.webSearch = { enabled: true, provider: "tavily" };
      const launch = await adapter.buildLaunchPlan!({ mode: "interactive", projectRoot: root, teamId: "developer-team", deckConfig });
      if (launch.status !== "ready") throw new Error(`Unexpected launch status: ${launch.status}`);
      expect(launch.plan.envOverlay?.TAVILY_API_KEY?.value).toBe(credential);
      const plan = { ...launch.plan };
      if (authorization === "unknown-binding") {
        plan.sensitiveEnvAuthorization = { binding: "unapproved-launch", keys: ["TAVILY_API_KEY"] };
      } else if (authorization === "unapproved-key") {
        plan.sensitiveEnvAuthorization = { ...plan.sensitiveEnvAuthorization!, keys: ["UNAPPROVED_API_KEY"] };
      }
      plan.envOverlay = { ...plan.envOverlay, UNAPPROVED_API_KEY: { value: unrelated, sensitive: true } };
      let spawnedEnvironment: Record<string, string> | undefined;
      const outcome = await executeRunnerLaunchPlan(plan, {
        inheritedEnv: { TAVILY_API_KEY: "fixture-inherited-credential", UNAPPROVED_API_KEY: "fixture-inherited-unapproved" },
        spawn: async (_command, _args, options) => {
          spawnedEnvironment = options.env;
          return { exitCode: 0, stdout: credential, stderr: unrelated };
        },
      });
      expect(spawnedEnvironment).toBeDefined();
      if (authorization === "producer") expect(spawnedEnvironment!.TAVILY_API_KEY).toBe(credential);
      else expect(spawnedEnvironment!.TAVILY_API_KEY).toBeUndefined();
      expect(spawnedEnvironment!.UNAPPROVED_API_KEY).toBeUndefined();
      expect(outcome.stdout).toBe("[REDACTED]");
      expect(outcome.stderr).toBe("[REDACTED]");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
