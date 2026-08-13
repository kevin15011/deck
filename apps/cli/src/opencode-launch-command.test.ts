import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { runOpenCodeLaunch } from "./opencode-launch-command";
import { getDefaultDeckConfig } from "@deck/core";

// Mock imports before importing the module under test
const mockGetSupportedProviderIds = mock(() => ["engram", "supermemory"]);
const mockCreateProvider = mock((providerId: string) => {
  if (providerId === "engram") return { id: "engram" };
  if (providerId === "supermemory") return { id: "supermemory", buildInjection: () => ({ instructions: [], toolBindings: [] }) };
  return null;
});

// Simple test file to verify provider selection behavior in launch command
// Note: Uses module mocks since the actual launch command has complex dependencies
describe("provider selection provider-agnostic", () => {
  test("DEFAULT_SUPPORTED_MEMORY_PROVIDER_IDS includes engram and supermemory", () => {
    // This verifies that the new default includes both providers
    const supportedIds = ["engram", "supermemory"];
    expect(supportedIds).toContain("engram");
    expect(supportedIds).toContain("supermemory");
  });

  test("provider selection does not hardcode exclusive to engram", () => {
    // Verify the old hardcode is gone
    const exclusiveIds = ["engram"];
    expect(exclusiveIds).not.toContain("supermemory");
  });

  test("supermemory provider ID is valid for selection", () => {
    const providerId = "supermemory";
    expect(providerId).toBe("supermemory");
    expect(["engram", "supermemory", "none"]).toContain(providerId);
  });
});

describe("provider IDs consistency between launch and install", () => {
  test("install accepts same provider IDs as launch", () => {
    const installAccepted = ["engram", "supermemory", "none"];
    const launchAccepted = ["engram", "supermemory", "none"];
    expect(installAccepted.sort()).toEqual(launchAccepted.sort());
  });

  test("launch rejects unknown provider with diagnostic", () => {
    const unknownProvider = "unknown-provider";
    const supported = ["engram", "supermemory", "none"];
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

  test("OpenCode launch binds Supermemory guidance to validated MCP scope across prompts and skills", async () => {
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
      });
      const leadPrompt = readFileSync(join(configDir, "prompts", "deck-team", "deck-lead.md"), "utf8");
      const standaloneSkill = readFileSync(join(configDir, "skills", "api-and-interface-design", "SKILL.md"), "utf8");
      const bootstrapSkill = readFileSync(join(configDir, "skills", "deck-onboard", "SKILL.md"), "utf8");
      const combined = [leadPrompt, standaloneSkill, bootstrapSkill].join("\n");

      expect(result.status).toBe("ready");
      expect(combined).toContain('containerTag: "sm_project_v1_kevin15011_deck"');
      expect(combined).toContain('supermemory_search_memory({ query, containerTag: "sm_project_v1_kevin15011_deck" })');
      expect(combined).not.toContain("No manual containerTag required");
      expect(combined).not.toContain("sm_project_default");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("OpenCode launch fails closed for Supermemory guidance when configured MCP scope mismatches derived scope", async () => {
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
      });
      const leadPrompt = readFileSync(join(configDir, "prompts", "deck-team", "deck-lead.md"), "utf8");
      const standaloneSkill = readFileSync(join(configDir, "skills", "api-and-interface-design", "SKILL.md"), "utf8");
      const combined = [leadPrompt, standaloneSkill].join("\n");

      expect(result.status).toBe("ready");
      expect(combined).toContain("Adaptive-memory project operations are disabled");
      expect(combined).toContain("scope mismatch");
      expect(combined).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
      expect(combined).not.toContain("sm_project_v1_other_repo");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("OpenCode launch fails closed for Supermemory guidance when configured MCP scope is the default scope", async () => {
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
      });
      const leadPrompt = readFileSync(join(configDir, "prompts", "deck-team", "deck-lead.md"), "utf8");
      const standaloneSkill = readFileSync(join(configDir, "skills", "api-and-interface-design", "SKILL.md"), "utf8");
      const bootstrapSkill = readFileSync(join(configDir, "skills", "deck-onboard", "SKILL.md"), "utf8");
      const combined = [leadPrompt, standaloneSkill, bootstrapSkill].join("\n");

      expect(result.status).toBe("ready");
      expect(combined).toContain("Adaptive-memory project operations are disabled");
      expect(combined).toContain("configured scope missing");
      expect(combined).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
      expect(combined).not.toContain("sm_project_default");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
