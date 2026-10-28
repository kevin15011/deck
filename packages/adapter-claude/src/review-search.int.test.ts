import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getDefaultDeckConfig } from "../../core/src/index";
import { TAVILY_PROVIDER_DESCRIPTOR } from "../../provider-tavily/src/index";
import { createClaudeRunnerAdapter } from "./runner-adapter";

test.each([
  { route: "native", credential: false, executable: false, provider: false, ready: true, install: false },
  { route: "fallback", credential: false, executable: true, provider: true, ready: false, install: false },
  { route: "fallback", credential: true, executable: true, provider: false, ready: false, install: false },
  { route: "fallback", credential: true, executable: false, provider: true, ready: true, install: true },
  { route: "fallback", credential: true, executable: true, provider: true, ready: true, install: false },
])("review search route: %j", async row => {
  const home = await mkdtemp(join(tmpdir(), "deck-review-search-"));
  let credentialReads = 0;
  const executableReads: string[] = [];
  try {
    const adapter = createClaudeRunnerAdapter({
      homeDir: home, dataRoot: join(home, "deck"),
      sessionDriver: { baseEnv: { HOME: home, ...(row.route === "fallback" ? { CLAUDE_CODE_USE_BEDROCK: "1" } : {}) } },
      resolveCommand: name => { executableReads.push(name); return row.executable ? process.execPath : undefined; },
      webSearchCredential: () => { credentialReads++; return row.credential ? "fixture-key" : ""; },
      webSearchProviderResolver: () => row.provider ? TAVILY_PROVIDER_DESCRIPTOR : undefined,
    });
    const config = getDefaultDeckConfig();
    config.adaptiveMemory.enabled = false;
    config.adaptiveMemory.activeProvider = "none";
    config.webSearch = { enabled: true, provider: "tavily" };
    if (row.route === "native") {
      const plan = adapter.buildDeveloperTeamInstallPlan({ projectRoot: home, environmentId: "claude-development", deckConfig: config, capabilityIds: ["claude-team-files", "web-search"] });
      expect(plan.blocked).toBe(false);
      await adapter.applyDeveloperTeamInstall({ projectRoot: home, environmentId: "claude-development", plan });
      const quality = plan.files.find(file => file.path.endsWith("/agents/deck-quality.md"))!;
      expect(await readFile(quality.path, "utf8")).toContain("WebSearch");
      const inventory = await adapter.getCapabilityInventory({ projectRoot: home, runnerId: "claude", environmentId: "claude-development", deckConfig: config });
      expect(inventory.capabilities.find(c => c.capabilityId === "web-search")?.webSearchReadiness?.state).toBe("ready");
      expect((await adapter.buildLaunchPlan!({ projectRoot: home, teamId: "developer-team", mode: "interactive", deckConfig: config })).status).toBe("ready");
    }
    credentialReads = 0;
    executableReads.length = 0;
    const state = { runnerId: "claude", environmentId: "claude-development", selectedCapabilities: { "claude-team-files": true, "web-search": true }, packageInstructions: {}, adaptiveMemory: { provider: "none" as const }, webSearchProvider: "tavily", runtime: { projectRoot: home } };
    const inventory = { runnerId: "claude", environmentId: "claude-development", capabilities: [] };
    const review = adapter.buildReviewPlan(state, inventory);
    expect(review.ready).toBe(row.ready);
    expect(review.groups.automaticInstalls.some(action => action.capabilityId === "web-search")).toBe(row.install);
    expect(credentialReads).toBe(row.route === "native" ? 0 : 1);
    if (row.route === "native") expect(executableReads).not.toContain("tavily-mcp");
    if (row.route === "fallback" && row.ready) expect(executableReads).toContain("tavily-mcp");
  } finally { await rm(home, { recursive: true, force: true }); }
}, 30_000);
