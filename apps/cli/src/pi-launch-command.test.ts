import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { getDefaultDeckConfig } from "@deck/core";
import type { SupermemoryRuntimeTransport } from "@deck/adapter-supermemory/runtime";
import { runPiLaunch as runPiLaunchProduction } from "./pi-launch-command";
import { runPiLaunchLegacyCompatibility as runPiLaunch } from "./pi-launch-command-legacy-compatibility.test-support";

function createTempDir(prefix = "deck-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeOrchestratorAssignment(projectRoot: string, model = "openai-codex/gpt-5.5", thinking: string | undefined = "medium") {
  mkdirSync(join(projectRoot, ".pi", "agents"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".pi", "agents", "deck-lead.md"),
    [
      "---",
      "name: deck-lead",
      `model: ${model}`,
      ...(thinking ? [`thinking: ${thinking}`] : []),
      "---",
      "",
      "# Agent",
    ].join("\n"),
    "utf-8",
  );
}

describe("runPiLaunch", () => {
  test("production launch fails closed when caller omits global Deck config", async () => {
    const projectRoot = createTempDir();
    try {
      const result = await runPiLaunchProduction({ teamId: "developer-team", projectRoot, flags: {}, commandExists: () => true, dryRun: true } as never);
      expect(result.status).toBe("error");
      expect(JSON.stringify(result)).toContain("DECK_CONFIG_REQUIRED");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("production launch uses only the injected global provider selection", async () => {
    const projectRoot = createTempDir();
    try {
      const result = await runPiLaunchProduction({ teamId: "developer-team", projectRoot, flags: {}, commandExists: () => true, dryRun: true, deckConfig: getDefaultDeckConfig() });
      expect(result.status).toBe("ready");
      if (result.status === "ready") expect(result.memoryDiagnostics).toEqual([]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("production Pi launch starts supervised loopback and passes only ephemeral bridge env", async () => {
    const projectRoot = createTempDir();
    const transport: SupermemoryRuntimeTransport = {
      async health() {},
      async profile() { return { profile: { static: ["Remembered convention: Pi uses Deck loopback."] } }; },
      async search() { return { results: [] }; },
      async add() {},
    };
    try {
      execFileSync("git", ["init"], { cwd: projectRoot, stdio: "ignore" });
      execFileSync("git", ["remote", "add", "origin", "git@github.com:kevin15011/deck.git"], { cwd: projectRoot, stdio: "ignore" });
      const result = await runPiLaunchProduction({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        deckConfig: { ...getDefaultDeckConfig(), adaptiveMemory: { enabled: true, activeProvider: "supermemory" } },
        supermemoryRuntime: { stateHome: join(projectRoot, ".state"), transport },
      });
      expect(result.status).toBe("launched");
      if (result.status === "launched") {
        expect(result.plan.env.DECK_RUNNER_MEMORY_ENDPOINT).toMatch(/^http:\/\/127\.0\.0\.1:/);
        expect(result.plan.env.DECK_RUNNER_MEMORY_TOKEN).toBeDefined();
        expect(result.plan.env).not.toHaveProperty("SUPERMEMORY_API_KEY");
        await result.loopbackBridge?.close();
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("returns error when pi command is not found", async () => {
    const result = await runPiLaunch({
      teamId: "developer-team",
      projectRoot: "/tmp/project",
      flags: {},
      commandExists: () => false,
    });

    expect(result.status).toBe("error");
    if (result.status === "error") {
      expect(result.message).toContain("pi");
    }
  });

  test("returns launch info without spawning when dryRun is true", async () => {
    const projectRoot = createTempDir();
    try {
      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        piCommand: "pi",
        dryRun: true,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.plan.command).toBe("pi");
        expect(result.plan.isContinue).toBe(false);
        expect(result.plan.sessionDir).toContain("developer-team");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("materializes profile before returning dry-run plan", async () => {
    const projectRoot = createTempDir();
    try {
      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
      });

      expect(result.status).toBe("ready");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("materializes compact prompts without a rollout receipt", async () => {
    const projectRoot = createTempDir();
    try {
      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
      });
      const prompt = readFileSync(
        join(projectRoot, ".deck", "pi", "profiles", "developer-team", "system-prompt.md"),
        "utf8",
      );

      expect(result.status).toBe("ready");
      expect(prompt).toContain("# Lead (deck-lead)");
      expect(prompt).toContain("Adaptive Developer Team Contract");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("dry-run plan includes orchestrator model and thinking flags", async () => {
    const projectRoot = createTempDir();
    try {
      writeOrchestratorAssignment(projectRoot);
      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.plan.args).toContain("--model");
        expect(result.plan.args).toContain("openai-codex/gpt-5.5");
        expect(result.plan.args).toContain("--thinking");
        expect(result.plan.args).toContain("medium");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("passes Supermemory memory provider to materializeTeamProfile", async () => {
    const projectRoot = createTempDir();
    try {
      const supermemoryProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
        id: "fixture-memory",
        displayName: "Supermemory Memory",
        buildInjection: () => ({
          instructions: [
            {
              surface: "session" as const,
              markdown: "Test Supermemory session injection.",
              teamId: "developer-team",
            },
          ],
          toolBindings: [
            { capability: "memory.search" as const, serverName: "fixture-memory", toolNames: ["supermemory_search_memory"] },
          ],
        }),
      };

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        memoryProvider: supermemoryProvider,
        supportedMemoryProviderIds: ["fixture-memory"],
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics).toHaveLength(0);

        // Check that the system-prompt.md contains the injected memory section
        const fs = require("node:fs");
        const path = require("node:path");
        const profileDir = path.join(projectRoot, ".deck", "pi", "profiles", "developer-team");
        const systemPromptContent = fs.readFileSync(path.join(profileDir, "system-prompt.md"), "utf-8");
        expect(systemPromptContent).toContain("## Adaptive Memory (provider-injected)");
        expect(systemPromptContent).toContain("Test Supermemory session injection.");
        expect(systemPromptContent).toContain("Memory is auxiliary");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports memory_provider_unavailable diagnostic when provider buildInjection throws", async () => {
    const brokenProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "fixture-memory",
      displayName: "Broken",
      buildInjection: () => {
        throw new Error("provider failed");
      },
    };

    const projectRoot = createTempDir();
    try {
      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        memoryProvider: brokenProvider,
        supportedMemoryProviderIds: ["fixture-memory"],
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        // Should report diagnostics from both profile and install materialization
        expect(result.memoryDiagnostics.length).toBeGreaterThanOrEqual(1);
        expect(result.memoryDiagnostics.some(d => d.code === "memory_provider_unavailable")).toBe(true);
        expect(result.memoryDiagnostics.find(d => d.code === "memory_provider_unavailable")!.providerId).toBe("fixture-memory");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("no memory diagnostics when no memory provider is provided", async () => {
    const projectRoot = createTempDir();
    try {
      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics).toHaveLength(0);
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  // --- Regression tests for verify/review findings ---

  test("--memory=supermemory materializes agent and skill files with tool bindings (REQ-AMI-002)", async () => {
    const projectRoot = createTempDir();
    try {
      const supermemoryProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
        id: "fixture-memory",
        displayName: "Supermemory Memory",
        buildInjection: () => ({
          instructions: [
            {
              surface: "session" as const,
              markdown: "Session Supermemory memory injection.",
              teamId: "developer-team",
            },
            {
              surface: "agent" as const,
              markdown: "Agent Supermemory memory injection.",
              teamId: "developer-team",
            },
            {
              surface: "skill" as const,
              markdown: "Skill Supermemory memory injection.",
              teamId: "developer-team",
            },
          ],
          toolBindings: [
            { capability: "memory.search" as const, serverName: "fixture-memory", toolNames: ["supermemory_search_memory"] },
            { capability: "memory.read" as const, serverName: "fixture-memory", toolNames: ["supermemory_getDocument"] },
            { capability: "memory.write" as const, serverName: "fixture-memory", toolNames: ["supermemory_add_memory"] },
          ],
        }),
      };

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        memoryProvider: supermemoryProvider,
        supportedMemoryProviderIds: ["fixture-memory"],
      });

      expect(result.status).toBe("ready");
      expect(result.memoryDiagnostics).toHaveLength(0);

      // Session profile should contain Adaptive Memory section
      const fs = require("node:fs");
      const path = require("node:path");
      const profileDir = path.join(projectRoot, ".deck", "pi", "profiles", "developer-team");
      const systemPromptContent = fs.readFileSync(path.join(profileDir, "system-prompt.md"), "utf-8");
      expect(systemPromptContent).toContain("## Adaptive Memory (provider-injected)");

      // Agent files should be materialized with Adaptive Memory section and tool bindings
      const orchestratorPath = path.join(projectRoot, ".pi", "agents", "deck-lead.md");
      expect(fs.existsSync(orchestratorPath)).toBe(true);
      const orchestratorContent = fs.readFileSync(orchestratorPath, "utf-8");
      expect(orchestratorContent).toContain("## Adaptive Memory (provider-injected)");
      expect(orchestratorContent).toContain("Agent Supermemory memory injection.");
      expect(orchestratorContent).toContain("supermemory_search_memory");
      expect(orchestratorContent).toContain("supermemory_getDocument");
      expect(orchestratorContent).toContain("supermemory_add_memory");

      // Skill files should be materialized with Adaptive Memory section
      const skillPath = path.join(projectRoot, ".pi", "skills", "deck-lead", "SKILL.md");
      expect(fs.existsSync(skillPath)).toBe(true);
      const skillContent = fs.readFileSync(skillPath, "utf-8");
      expect(skillContent).toContain("## Adaptive Memory (provider-injected)");
      expect(skillContent).toContain("Skill Supermemory memory injection.");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("--memory=supermemory preserves pre-existing orchestrator model and thinking assignments", async () => {
    const projectRoot = createTempDir();
    try {
      writeOrchestratorAssignment(projectRoot);
      const supermemoryProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
        id: "fixture-memory",
        displayName: "Supermemory Memory",
        buildInjection: () => ({
          instructions: [
            {
              surface: "session" as const,
              markdown: "Session Supermemory memory injection.",
              teamId: "developer-team",
            },
            {
              surface: "agent" as const,
              markdown: "Agent Supermemory memory injection.",
              teamId: "developer-team",
            },
          ],
          toolBindings: [
            { capability: "memory.search" as const, serverName: "fixture-memory", toolNames: ["supermemory_search_memory"] },
          ],
        }),
      };

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        memoryProvider: supermemoryProvider,
        supportedMemoryProviderIds: ["fixture-memory"],
      });

      expect(result.status).toBe("ready");
      expect(result.memoryDiagnostics).toHaveLength(0);
      if (result.status === "ready") {
        expect(result.plan.args).toContain("--model");
        expect(result.plan.args).toContain("openai-codex/gpt-5.5");
        expect(result.plan.args).toContain("--thinking");
        expect(result.plan.args).toContain("medium");
      }

      const orchestratorPath = join(projectRoot, ".pi", "agents", "deck-lead.md");
      const orchestratorContent = readFileSync(orchestratorPath, "utf-8");
      expect(orchestratorContent).toContain("model: openai-codex/gpt-5.5");
      expect(orchestratorContent).toContain("thinking: medium");
      expect(orchestratorContent).toContain("## Adaptive Memory (provider-injected)");
      expect(orchestratorContent).toContain("supermemory_search_memory");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("--memory=supermemory materialization omits unsupported orchestrator thinking", async () => {
    const projectRoot = createTempDir();
    try {
      writeOrchestratorAssignment(projectRoot, "opencode-go/kimi-k2.6", "high");
      const supermemoryProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
        id: "fixture-memory",
        displayName: "Supermemory Memory",
        buildInjection: () => ({
          instructions: [{ surface: "agent" as const, markdown: "Agent Supermemory memory injection.", teamId: "developer-team" }],
          toolBindings: [],
        }),
      };

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        memoryProvider: supermemoryProvider,
        supportedMemoryProviderIds: ["fixture-memory"],
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.plan.args).toContain("opencode-go/kimi-k2.6");
        expect(result.plan.args).not.toContain("--thinking");
        expect(result.plan.args).not.toContain("off");
        expect(result.plan.args).not.toContain("high");
      }

      const orchestratorPath = join(projectRoot, ".pi", "agents", "deck-lead.md");
      const orchestratorContent = readFileSync(orchestratorPath, "utf-8");
      expect(orchestratorContent).toContain("model: opencode-go/kimi-k2.6");
      expect(orchestratorContent).not.toContain("thinking:");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("--memory=supermemory materialization preserves missing thinking frontmatter", async () => {
    const projectRoot = createTempDir();
    try {
      writeOrchestratorAssignment(projectRoot, "custom/no-reasoning", "");
      const supermemoryProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
        id: "fixture-memory",
        displayName: "Supermemory Memory",
        buildInjection: () => ({
          instructions: [{ surface: "agent" as const, markdown: "Agent Supermemory memory injection.", teamId: "developer-team" }],
          toolBindings: [],
        }),
      };

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        memoryProvider: supermemoryProvider,
        supportedMemoryProviderIds: ["fixture-memory"],
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.plan.args).toContain("custom/no-reasoning");
        expect(result.plan.args).not.toContain("--thinking");
      }

      const orchestratorPath = join(projectRoot, ".pi", "agents", "deck-lead.md");
      const orchestratorContent = readFileSync(orchestratorPath, "utf-8");
      expect(orchestratorContent).toContain("model: custom/no-reasoning");
      expect(orchestratorContent).not.toContain("thinking:");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("unsupported provider object cannot silently inject content (REQ-AMI-003)", async () => {
    const unsupportedProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "unknown-provider",
      displayName: "Unknown",
      buildInjection: () => ({
        instructions: [
          {
            surface: "session" as const,
            markdown: "This should NOT be injected.",
            teamId: "developer-team",
          },
        ],
        toolBindings: [],
      }),
    };

    const projectRoot = createTempDir();
    try {
      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        memoryProvider: unsupportedProvider,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        // Should produce unsupported_memory_provider diagnostics
        expect(result.memoryDiagnostics.length).toBeGreaterThanOrEqual(1);
        expect(result.memoryDiagnostics.some(d => d.code === "unsupported_memory_provider")).toBe(true);
        expect(result.memoryDiagnostics.find(d => d.code === "unsupported_memory_provider")!.providerId).toBe("unknown-provider");

        // Content should NOT contain the unsupported provider injection
        const fs = require("node:fs");
        const path = require("node:path");
        const profileDir = path.join(projectRoot, ".deck", "pi", "profiles", "developer-team");
        const systemPromptContent = fs.readFileSync(path.join(profileDir, "system-prompt.md"), "utf-8");
        expect(systemPromptContent).not.toContain("This should NOT be injected");
        expect(systemPromptContent).not.toContain("## Adaptive Memory (provider-injected)");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("without memory provider, agent/skill files are not re-materialized", async () => {
    const projectRoot = createTempDir();
    try {
      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.memoryDiagnostics).toHaveLength(0);

        // System prompt should NOT have Adaptive Memory section
        const fs = require("node:fs");
        const path = require("node:path");
        const profileDir = path.join(projectRoot, ".deck", "pi", "profiles", "developer-team");
        const systemPromptContent = fs.readFileSync(path.join(profileDir, "system-prompt.md"), "utf-8");
        expect(systemPromptContent).not.toContain("## Adaptive Memory (provider-injected)");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
