import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { runPiLaunch } from "./pi-launch-command";

function createTempDir(prefix = "deck-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeOrchestratorAssignment(projectRoot: string, model = "openai-codex/gpt-5.5", thinking: string | undefined = "medium") {
  mkdirSync(join(projectRoot, ".pi", "agents"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".pi", "agents", "deck-developer-orchestrator.md"),
    [
      "---",
      "name: deck-developer-orchestrator",
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

  test("passes Engram memory provider to materializeTeamProfile", async () => {
    const projectRoot = createTempDir();
    try {
      const engramProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
        id: "engram",
        displayName: "Engram Memory",
        buildInjection: () => ({
          instructions: [
            {
              surface: "session" as const,
              markdown: "Test Engram session injection.",
              teamId: "developer-team",
            },
          ],
          toolBindings: [
            { capability: "memory.search" as const, serverName: "engram", toolNames: ["memory_search"] },
          ],
        }),
      };

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        memoryProvider: engramProvider,
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
        expect(systemPromptContent).toContain("Test Engram session injection.");
        expect(systemPromptContent).toContain("Memory is auxiliary");
      }
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("reports memory_provider_unavailable diagnostic when provider buildInjection throws", async () => {
    const brokenProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "engram",
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
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        // Should report diagnostics from both profile and install materialization
        expect(result.memoryDiagnostics.length).toBeGreaterThanOrEqual(1);
        expect(result.memoryDiagnostics.some(d => d.code === "memory_provider_unavailable")).toBe(true);
        expect(result.memoryDiagnostics.find(d => d.code === "memory_provider_unavailable")!.providerId).toBe("engram");
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

  test("--memory=engram materializes agent and skill files with tool bindings (REQ-AMI-002)", async () => {
    const projectRoot = createTempDir();
    try {
      const engramProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
        id: "engram",
        displayName: "Engram Memory",
        buildInjection: () => ({
          instructions: [
            {
              surface: "session" as const,
              markdown: "Session Engram memory injection.",
              teamId: "developer-team",
            },
            {
              surface: "agent" as const,
              markdown: "Agent Engram memory injection.",
              teamId: "developer-team",
            },
            {
              surface: "skill" as const,
              markdown: "Skill Engram memory injection.",
              teamId: "developer-team",
            },
          ],
          toolBindings: [
            { capability: "memory.search" as const, serverName: "engram", toolNames: ["memory_search"] },
            { capability: "memory.read" as const, serverName: "engram", toolNames: ["memory_read"] },
            { capability: "memory.write" as const, serverName: "engram", toolNames: ["memory_write"] },
          ],
        }),
      };

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        memoryProvider: engramProvider,
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
      const orchestratorPath = path.join(projectRoot, ".pi", "agents", "deck-developer-orchestrator.md");
      expect(fs.existsSync(orchestratorPath)).toBe(true);
      const orchestratorContent = fs.readFileSync(orchestratorPath, "utf-8");
      expect(orchestratorContent).toContain("## Adaptive Memory (provider-injected)");
      expect(orchestratorContent).toContain("Agent Engram memory injection.");
      expect(orchestratorContent).toContain("memory_search");
      expect(orchestratorContent).toContain("memory_read");
      expect(orchestratorContent).toContain("memory_write");

      // Skill files should be materialized with Adaptive Memory section
      const skillPath = path.join(projectRoot, ".pi", "skills", "deck-developer-orchestrator", "SKILL.md");
      expect(fs.existsSync(skillPath)).toBe(true);
      const skillContent = fs.readFileSync(skillPath, "utf-8");
      expect(skillContent).toContain("## Adaptive Memory (provider-injected)");
      expect(skillContent).toContain("Skill Engram memory injection.");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("--memory=engram preserves pre-existing orchestrator model and thinking assignments", async () => {
    const projectRoot = createTempDir();
    try {
      writeOrchestratorAssignment(projectRoot);
      const engramProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
        id: "engram",
        displayName: "Engram Memory",
        buildInjection: () => ({
          instructions: [
            {
              surface: "session" as const,
              markdown: "Session Engram memory injection.",
              teamId: "developer-team",
            },
            {
              surface: "agent" as const,
              markdown: "Agent Engram memory injection.",
              teamId: "developer-team",
            },
          ],
          toolBindings: [
            { capability: "memory.search" as const, serverName: "engram", toolNames: ["memory_search"] },
          ],
        }),
      };

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        memoryProvider: engramProvider,
      });

      expect(result.status).toBe("ready");
      expect(result.memoryDiagnostics).toHaveLength(0);
      if (result.status === "ready") {
        expect(result.plan.args).toContain("--model");
        expect(result.plan.args).toContain("openai-codex/gpt-5.5");
        expect(result.plan.args).toContain("--thinking");
        expect(result.plan.args).toContain("medium");
      }

      const orchestratorPath = join(projectRoot, ".pi", "agents", "deck-developer-orchestrator.md");
      const orchestratorContent = readFileSync(orchestratorPath, "utf-8");
      expect(orchestratorContent).toContain("model: openai-codex/gpt-5.5");
      expect(orchestratorContent).toContain("thinking: medium");
      expect(orchestratorContent).toContain("## Adaptive Memory (provider-injected)");
      expect(orchestratorContent).toContain("memory_search");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("--memory=engram materialization omits unsupported orchestrator thinking", async () => {
    const projectRoot = createTempDir();
    try {
      writeOrchestratorAssignment(projectRoot, "opencode-go/kimi-k2.6", "high");
      const engramProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
        id: "engram",
        displayName: "Engram Memory",
        buildInjection: () => ({
          instructions: [{ surface: "agent" as const, markdown: "Agent Engram memory injection.", teamId: "developer-team" }],
          toolBindings: [],
        }),
      };

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        memoryProvider: engramProvider,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.plan.args).toContain("opencode-go/kimi-k2.6");
        expect(result.plan.args).not.toContain("--thinking");
        expect(result.plan.args).not.toContain("off");
        expect(result.plan.args).not.toContain("high");
      }

      const orchestratorPath = join(projectRoot, ".pi", "agents", "deck-developer-orchestrator.md");
      const orchestratorContent = readFileSync(orchestratorPath, "utf-8");
      expect(orchestratorContent).toContain("model: opencode-go/kimi-k2.6");
      expect(orchestratorContent).not.toContain("thinking:");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("--memory=engram materialization preserves missing thinking frontmatter", async () => {
    const projectRoot = createTempDir();
    try {
      writeOrchestratorAssignment(projectRoot, "custom/no-reasoning", "");
      const engramProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
        id: "engram",
        displayName: "Engram Memory",
        buildInjection: () => ({
          instructions: [{ surface: "agent" as const, markdown: "Agent Engram memory injection.", teamId: "developer-team" }],
          toolBindings: [],
        }),
      };

      const result = await runPiLaunch({
        teamId: "developer-team",
        projectRoot,
        flags: {},
        commandExists: () => true,
        dryRun: true,
        memoryProvider: engramProvider,
      });

      expect(result.status).toBe("ready");
      if (result.status === "ready") {
        expect(result.plan.args).toContain("custom/no-reasoning");
        expect(result.plan.args).not.toContain("--thinking");
      }

      const orchestratorPath = join(projectRoot, ".pi", "agents", "deck-developer-orchestrator.md");
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
