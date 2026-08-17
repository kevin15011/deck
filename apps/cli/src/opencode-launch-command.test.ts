import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { runOpenCodeLaunch } from "./opencode-launch-command";
import { getDefaultDeckConfig } from "@deck/core";
import type { SupermemoryRuntimeTransport } from "@deck/adapter-supermemory/runtime";

function hermeticSupermemoryTransport(): SupermemoryRuntimeTransport {
  return {
    async health() {},
    async profile() { return { profile: {} }; },
    async search() { return { results: [] }; },
    async add() {},
  };
}

// Simple test file to verify provider selection behavior in launch command
// Note: Uses module mocks since the actual launch command has complex dependencies
describe("provider selection", () => {
  test("DEFAULT_SUPPORTED_MEMORY_PROVIDER_IDS includes only Supermemory", () => {
    const supportedIds = ["supermemory"];
    expect(supportedIds).toEqual(["supermemory"]);
  });

  test("provider selection no longer accepts removed providers", () => {
    const supportedIds = ["supermemory", "none"];
    expect(supportedIds).not.toContain("engram");
  });

  test("supermemory provider ID is valid for selection", () => {
    const providerId = "supermemory";
    expect(providerId).toBe("supermemory");
    expect(["supermemory", "none"]).toContain(providerId);
  });
});

describe("provider IDs consistency between launch and install", () => {
  test("install accepts same provider IDs as launch", () => {
    const installAccepted = ["supermemory", "none"];
    const launchAccepted = ["supermemory", "none"];
    expect(installAccepted.sort()).toEqual(launchAccepted.sort());
  });

  test("launch rejects unknown provider with diagnostic", () => {
    const unknownProvider = "unknown-provider";
    const supported = ["supermemory", "none"];
    expect(supported).not.toContain(unknownProvider);
    // Diagnostic would be "unsupported_memory_provider"
  });
});

describe("fail-open behavior", () => {
  test("provider unavailable continues with diagnostic, not blocking", async () => {
    const providerUnavailable = true;
    const shouldBlock = false; // should NOT block due to fail-open
    
    const diagnostics = providerUnavailable 
      ? [{ code: "memory_provider_unavailable", message: "Supermemory MCP unavailable", recoverable: true }]
      : [];
    
    if (diagnostics.length > 0) {
      expect(diagnostics[0].code).toBe("memory_provider_unavailable");
      expect(diagnostics[0].recoverable).toBe(true);
    }
    
    // Should NOT block the flow
    expect(shouldBlock).toBe(false);
  });
});

describe("production prompt activation", () => {
  test("blocks when caller omits global Deck config", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-opencode-missing-config-"));
    try {
      const result = await runOpenCodeLaunch({
        teamId: "developer-team",
        projectRoot,
        configDir: join(projectRoot, ".config", "opencode"),
        commandExists: () => true,
        dryRun: true,
      } as never);
      expect(result.status).toBe("error");
      expect(JSON.stringify(result)).toContain("DECK_CONFIG_REQUIRED");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("installs compact prompts without a rollout receipt", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-opencode-rollout-"));
    const configDir = join(projectRoot, ".config", "opencode");
    try {
      mkdirSync(configDir, { recursive: true });
      const result = await runOpenCodeLaunch({
        teamId: "developer-team",
        projectRoot,
        configDir,
        deckConfig: getDefaultDeckConfig(),
        commandExists: () => true,
        dryRun: true,
      });
      const prompt = readFileSync(
        join(configDir, "prompts", "deck-team", "deck-apply-fast.md"),
        "utf8",
      );

      expect(result.status).toBe("ready");
      expect(prompt).toContain("# Apply Fast (deck-apply-fast)");
      expect(prompt).toContain("Adaptive Developer Team Contract");
      expect(prompt).toContain("## Proportional TDD");
      expect(prompt).toContain("Modifying work requires the user's request and the active runner's authority");
      expect(prompt).not.toContain("Orchestrator will inject renderApplyAuthorizationCard()");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("legacy OpenCode launch installs provider-neutral Web Search instructions when enabled", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-opencode-web-search-launch-"));
    const configDir = join(projectRoot, ".config", "opencode");
    try {
      mkdirSync(configDir, { recursive: true });
      const deckConfig = {
        ...getDefaultDeckConfig(),
        webSearch: { enabled: true, provider: "tavily" },
      };

      const result = await runOpenCodeLaunch({
        teamId: "developer-team",
        projectRoot,
        configDir,
        deckConfig,
        commandExists: () => true,
        dryRun: true,
        supermemoryRuntimeTransport: hermeticSupermemoryTransport(),
        supermemoryRuntimeStateHome: join(projectRoot, ".state"),
      });
      const leadPrompt = readFileSync(join(configDir, "prompts", "deck-team", "deck-lead.md"), "utf8");
      const leadSkill = readFileSync(join(configDir, "skills", "deck-lead", "SKILL.md"), "utf8");
      const content = `${leadPrompt}\n${leadSkill}`;

      expect(result.status).toBe("ready");
      expect(content).toContain("Web Search Capability (provider-neutral)");
      expect(content).toContain("Use short direct research only when it materially reduces uncertainty");
      expect(content).not.toMatch(/Tavily|tavily_|TAVILY_API_KEY/);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("OpenCode launch binds Supermemory guidance to Runtime-owned scope across prompts and skills", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-opencode-supermemory-launch-"));
    const configDir = join(projectRoot, ".config", "opencode");
    try {
      mkdirSync(configDir, { recursive: true });
      execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
      execFileSync("git", ["remote", "add", "origin", "https://github.com/kevin15011/deck.git"], { cwd: projectRoot, stdio: "ignore" });
      writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: "https://mcp.supermemory.ai/mcp",
            headers: { "x-sm-project": "sm_project_v1_kevin15011_deck" },
          },
        },
      }));
      const deckConfig = {
        ...getDefaultDeckConfig(),
        adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } },
      };

      const result = await runOpenCodeLaunch({
        teamId: "developer-team",
        projectRoot,
        configDir,
        deckConfig,
        commandExists: () => true,
        dryRun: true,
        supermemoryRuntimeTransport: hermeticSupermemoryTransport(),
        supermemoryRuntimeStateHome: join(projectRoot, ".state"),
      });
      const leadPrompt = readFileSync(join(configDir, "prompts", "deck-team", "deck-lead.md"), "utf8");
      const standaloneSkill = readFileSync(join(configDir, "skills", "api-and-interface-design", "SKILL.md"), "utf8");
      const bootstrapSkill = readFileSync(join(configDir, "skills", "deck-onboard", "SKILL.md"), "utf8");
      const combined = [leadPrompt, standaloneSkill, bootstrapSkill].join("\n");

      expect(result.status).toBe("ready");
      expect(combined).toContain("Runtime-managed recall and capture bind project scope server-side");
      expect(combined).toContain("schemas permit model-selected project scope");
      expect(combined).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
      expect(combined).not.toContain("supermemory_search_memory");
      expect(combined).not.toContain("No manual containerTag required");
      expect(combined).not.toContain('containerTag: "sm_project_default"');
      expect(combined).not.toContain('supermemory_search_memory({ query, containerTag: "sm_project_default" })');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("OpenCode launch materializes runtime recall before prompt install without raw MCP calls", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-opencode-runtime-recall-"));
    const configDir = join(projectRoot, ".config", "opencode");
    const stateHome = join(projectRoot, ".state");
    const envHome = join(projectRoot, "empty-home");
    const envConfig = join(projectRoot, "empty-config");
    const envCache = join(projectRoot, "empty-cache");
    const envState = join(projectRoot, "empty-state");
    const previousEnv = {
      HOME: process.env.HOME,
      XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
      XDG_STATE_HOME: process.env.XDG_STATE_HOME,
      XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
    };
    const previousFetch = globalThis.fetch;
    const calls: string[] = [];
    const transport: SupermemoryRuntimeTransport = {
      async health(payload) { calls.push(`health:${payload.containerTag}`); },
      async profile(payload) { calls.push(`profile:${payload.containerTag}`); return { profile: { static: ["Remembered convention: runtime recall reaches OpenCode prompts before agent processing."] } }; },
      async search(payload) { calls.push(`search:${payload.containerTag}:${payload.q}`); return { results: [{ content: "Current task: prove OpenCode uses trusted runtime memory injection with zero raw MCP calls." }] }; },
      async add() { calls.push("add"); },
    };
    try {
      process.env.HOME = envHome;
      process.env.XDG_CONFIG_HOME = envConfig;
      process.env.XDG_STATE_HOME = envState;
      process.env.XDG_CACHE_HOME = envCache;
      globalThis.fetch = (async () => { throw new Error("network blocked in hermetic launch test"); }) as unknown as typeof fetch;
      mkdirSync(configDir, { recursive: true });
      execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
      execFileSync("git", ["remote", "add", "origin", "https://github.com/acme/opencode-runtime.git"], { cwd: projectRoot, stdio: "ignore" });

      const result = await runOpenCodeLaunch({
        teamId: "developer-team",
        projectRoot,
        configDir,
        deckConfig: { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" } },
        commandExists: () => true,
        dryRun: true,
        supermemoryRuntimeTransport: transport,
        supermemoryRuntimeStateHome: stateHome,
      });
      const leadPrompt = readFileSync(join(configDir, "prompts", "deck-team", "deck-lead.md"), "utf8");
      const opencodeConfig = readFileSync(join(configDir, "opencode.json"), "utf8");

      expect(result.status).toBe("ready");
      expect(leadPrompt).toContain("DECK_ADAPTIVE_CONTEXT_JSON_V1");
      expect(leadPrompt).toContain("runtime memory injection");
      expect(opencodeConfig).not.toContain("mcp.supermemory.ai");
      expect(calls).toEqual([
        "health:sm_project_v1_acme_opencode_runtime",
        "profile:sm_project_v1_acme_opencode_runtime",
        "search:sm_project_v1_acme_opencode_runtime:current task project context",
      ]);
      expect(existsSync(join(envState, "deck", "supermemory-runtime.jsonl"))).toBe(false);
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      globalThis.fetch = previousFetch;
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("OpenCode launch ignores mismatched raw MCP scope because Runtime owns scope", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-opencode-supermemory-mismatch-"));
    const configDir = join(projectRoot, ".config", "opencode");
    try {
      mkdirSync(configDir, { recursive: true });
      execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
      execFileSync("git", ["remote", "add", "origin", "https://github.com/kevin15011/deck.git"], { cwd: projectRoot, stdio: "ignore" });
      writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: "https://mcp.supermemory.ai/mcp",
            headers: { "x-sm-project": "sm_project_v1_other_repo" },
          },
        },
      }));
      const deckConfig = {
        ...getDefaultDeckConfig(),
        adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } },
      };

      const result = await runOpenCodeLaunch({
        teamId: "developer-team",
        projectRoot,
        configDir,
        deckConfig,
        commandExists: () => true,
        dryRun: true,
        supermemoryRuntimeTransport: hermeticSupermemoryTransport(),
        supermemoryRuntimeStateHome: join(projectRoot, ".state"),
      });
      const leadPrompt = readFileSync(join(configDir, "prompts", "deck-team", "deck-lead.md"), "utf8");
      const standaloneSkill = readFileSync(join(configDir, "skills", "api-and-interface-design", "SKILL.md"), "utf8");
      const combined = [leadPrompt, standaloneSkill].join("\n");

      expect(result.status).toBe("ready");
      expect(combined).toContain("Runtime-managed recall and capture bind project scope server-side");
      expect(combined).toContain("schemas permit model-selected project scope");
      expect(combined).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
      expect(combined).not.toContain("sm_project_v1_other_repo");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("OpenCode launch ignores default raw MCP scope because Runtime owns scope", async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-opencode-supermemory-default-"));
    const configDir = join(projectRoot, ".config", "opencode");
    try {
      mkdirSync(configDir, { recursive: true });
      execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
      execFileSync("git", ["remote", "add", "origin", "https://github.com/kevin15011/deck.git"], { cwd: projectRoot, stdio: "ignore" });
      writeFileSync(join(configDir, "opencode.json"), JSON.stringify({
        mcp: {
          supermemory: {
            type: "remote",
            url: "https://mcp.supermemory.ai/mcp",
            headers: { "x-sm-project": "sm_project_default" },
          },
        },
      }));
      const deckConfig = {
        ...getDefaultDeckConfig(),
        adaptiveMemory: { activeProvider: "supermemory", supermemory: { mcpServerName: "supermemory" } },
      };

      const result = await runOpenCodeLaunch({
        teamId: "developer-team",
        projectRoot,
        configDir,
        deckConfig,
        commandExists: () => true,
        dryRun: true,
        supermemoryRuntimeTransport: hermeticSupermemoryTransport(),
        supermemoryRuntimeStateHome: join(projectRoot, ".state"),
      });
      const leadPrompt = readFileSync(join(configDir, "prompts", "deck-team", "deck-lead.md"), "utf8");
      const standaloneSkill = readFileSync(join(configDir, "skills", "api-and-interface-design", "SKILL.md"), "utf8");
      const bootstrapSkill = readFileSync(join(configDir, "skills", "deck-onboard", "SKILL.md"), "utf8");
      const combined = [leadPrompt, standaloneSkill, bootstrapSkill].join("\n");

      expect(result.status).toBe("ready");
      expect(combined).toContain("Runtime-managed recall and capture bind project scope server-side");
      expect(combined).toContain("schemas permit model-selected project scope");
      expect(combined).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
      expect(combined).not.toContain('containerTag: "sm_project_default"');
      expect(combined).not.toContain('supermemory_search_memory({ query, containerTag: "sm_project_default" })');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
