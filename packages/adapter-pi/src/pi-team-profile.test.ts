import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildTeamSystemPrompt,
  materializeTeamProfile,
  type MaterializeTeamProfileOptions,
} from "./pi-team-profile";

function createTempDir(prefix = "deck-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("buildTeamSystemPrompt", () => {
  test("includes all Developer Team agent roles for developer-team", () => {
    const { content } = buildTeamSystemPrompt("developer-team");

    expect(content).toContain("Developer Team");
    expect(content).toContain("deck-developer-orchestrator");
    expect(content).toContain("deck-developer-explorer");
    expect(content).toContain("deck-developer-apply-general");
    expect(content).toContain("deck-developer-verify");
    expect(content).toContain("deck-developer-archive");
    expect(content).toContain("Orchestrator");
    expect(content).toContain("Explorer");
  });

  test("contains real orchestrator operating rules — not placeholder", () => {
    const { content } = buildTeamSystemPrompt("developer-team");

    // Should have delegation rules
    expect(content).toContain("Delegation Rules");
    expect(content).toContain("4+");

    // Should have dependency graph
    expect(content).toContain("Dependency Graph");

    // Should NOT have placeholder text
    expect(content).not.toContain("Follow the team's established workflow");
  });

  test("contains Deck-specific apply routing", () => {
    const { content } = buildTeamSystemPrompt("developer-team");
    expect(content).toContain("General");
    expect(content).toContain("Backend");
    expect(content).toContain("Frontend");
  });

  test("references project AI notes", () => {
    const { content } = buildTeamSystemPrompt("developer-team");
    expect(content).toContain(".deck/ai-notes/");
  });

  test("throws for unknown team", () => {
    expect(() => buildTeamSystemPrompt("unknown-team")).toThrow(/unknown team/i);
  });

  test("returns empty memoryDiagnostics when no memory provider is passed", () => {
    const { content, memoryDiagnostics } = buildTeamSystemPrompt("developer-team");
    expect(content).toContain("Developer Team");
    expect(memoryDiagnostics).toHaveLength(0);
  });

  test("returns unchanged content when memory provider is undefined", () => {
    const noMemory = buildTeamSystemPrompt("developer-team");
    const withUndefined = buildTeamSystemPrompt("developer-team", { memoryProvider: undefined });

    expect(noMemory.content).toBe(withUndefined.content);
    expect(noMemory.memoryDiagnostics).toHaveLength(0);
    expect(withUndefined.memoryDiagnostics).toHaveLength(0);
  });

  test("composes Engram memory into session prompt when Engram provider is provided", () => {
    const engramProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "engram",
      displayName: "Engram Memory",
      buildInjection: () => ({
        instructions: [
          {
            surface: "session",
            markdown: "Use Engram memory for persistent context.",
            teamId: "developer-team",
          },
        ],
        toolBindings: [
          { capability: "memory.search", serverName: "engram", toolNames: ["memory_search"] },
        ],
      }),
    };

    const { content, memoryDiagnostics } = buildTeamSystemPrompt("developer-team", {
      memoryProvider: engramProvider,
    });

    expect(content).toContain("## Adaptive Memory (provider-injected)");
    expect(content).toContain("Use Engram memory for persistent context.");
    expect(content).toContain("Memory is auxiliary");
    expect(memoryDiagnostics).toHaveLength(0);
  });

  test("returns diagnostic when supported Engram provider buildInjection throws", () => {
    const brokenEngram: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "engram", // Supported ID, but buildInjection throws
      displayName: "Broken Engram",
      buildInjection: () => {
        throw new Error("provider initialization failed");
      },
    };

    const { content, memoryDiagnostics } = buildTeamSystemPrompt("developer-team", {
      memoryProvider: brokenEngram,
    });

    // Should return base content without injection
    expect(content).toContain("Developer Team");
    expect(content).not.toContain("## Adaptive Memory (provider-injected)");
    // Should have diagnostic
    expect(memoryDiagnostics).toHaveLength(1);
    expect(memoryDiagnostics[0].code).toBe("memory_provider_unavailable");
    expect(memoryDiagnostics[0].providerId).toBe("engram");
  });

  test("returns diagnostic when unsupported provider ID is passed", () => {
    const unsupportedProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "unknown-provider",
      displayName: "Unknown",
      buildInjection: () => ({
        instructions: [{ surface: "session" as const, markdown: "Should not inject", teamId: "developer-team" }],
        toolBindings: [],
      }),
    };

    const { content, memoryDiagnostics } = buildTeamSystemPrompt("developer-team", {
      memoryProvider: unsupportedProvider,
    });

    // Should return base content without injection
    expect(content).toContain("Developer Team");
    expect(content).not.toContain("## Adaptive Memory (provider-injected)");
    expect(content).not.toContain("Should not inject");
    // Should have unsupported_memory_provider diagnostic
    expect(memoryDiagnostics).toHaveLength(1);
    expect(memoryDiagnostics[0].code).toBe("unsupported_memory_provider");
    expect(memoryDiagnostics[0].providerId).toBe("unknown-provider");
  });

  test("composes Supermemory advisory context into explicit official/adaptive sections", () => {
    const supermemoryProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "supermemory",
      displayName: "Supermemory MCP",
      buildInjection: () => ({
        instructions: [
          { surface: "session", markdown: "Use Supermemory MCP advisory context through execute and search_docs only.", teamId: "developer-team" },
        ],
        toolBindings: [{ capability: "memory.search", serverName: "supermemory", toolNames: ["execute", "search_docs"] }],
      }),
    };

    const { content, memoryDiagnostics } = buildTeamSystemPrompt("developer-team", { memoryProvider: supermemoryProvider });

    expect(memoryDiagnostics).toHaveLength(0);
    expect(content).toContain("## OFFICIAL CONTEXT");
    expect(content).toContain("## ADAPTIVE CONTEXT");
    expect(content).toContain("OpenSpec artifacts and Spec Registry entries are authoritative");
    expect(content).toContain("Use Supermemory MCP advisory context through execute and search_docs only.");
    expect(content).toContain("## Adaptive Memory (provider-injected)");
  });

  test("renders adaptive-context absence indicator when Supermemory provider is unavailable", () => {
    const brokenSupermemory: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "supermemory",
      displayName: "Supermemory MCP",
      buildInjection: () => {
        throw new Error("Supermemory MCP validation is incomplete or failed.");
      },
    };

    const { content, memoryDiagnostics } = buildTeamSystemPrompt("developer-team", { memoryProvider: brokenSupermemory });

    expect(memoryDiagnostics).toHaveLength(1);
    expect(memoryDiagnostics[0].providerId).toBe("supermemory");
    expect(content).toContain("## OFFICIAL CONTEXT");
    expect(content).toContain("## ADAPTIVE CONTEXT");
    expect(content).toContain("Adaptive context was not loaded");
    expect(content).toContain("OpenSpec artifacts and Spec Registry entries are authoritative");
    expect(content).not.toContain("## Adaptive Memory (provider-injected)");
  });

});

describe("materializeTeamProfile", () => {
  test("creates profile directory and writes system-prompt.md", () => {
    const projectRoot = createTempDir();
    try {
      materializeTeamProfile({
        teamId: "developer-team",
        projectRoot,
      });

      const profileDir = join(projectRoot, ".deck", "pi", "profiles", "developer-team");
      const systemPromptPath = join(profileDir, "system-prompt.md");

      const content = readFileSync(systemPromptPath, "utf-8");
      expect(content).toContain("Developer Team");
      expect(content).toContain("deck-developer-orchestrator");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("is idempotent — re-running does not error", () => {
    const projectRoot = createTempDir();
    try {
      materializeTeamProfile({ teamId: "developer-team", projectRoot });
      materializeTeamProfile({ teamId: "developer-team", projectRoot });

      const content = readFileSync(
        join(projectRoot, ".deck", "pi", "profiles", "developer-team", "system-prompt.md"),
        "utf-8",
      );
      expect(content).toContain("Developer Team");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("uses injected fs functions for testability", () => {
    const projectRoot = "/fake";
    const written: { path: string; content: string }[] = [];

    materializeTeamProfile({
      teamId: "developer-team",
      projectRoot,
      mkdir: () => { /* no-op */ },
      writeFile: (path, content) => { written.push({ path, content }); },
      readFile: () => { throw new Error("should not read"); },
      exists: () => false, // file does not exist yet -> should write
    });

    expect(written).toHaveLength(1);
    expect(written[0].path).toBe("/fake/.deck/pi/profiles/developer-team/system-prompt.md");
    expect(written[0].content).toContain("Developer Team");
  });

  test("does not write if content is unchanged", () => {
    const projectRoot = createTempDir();
    try {
      // First write
      materializeTeamProfile({ teamId: "developer-team", projectRoot });

      const content = readFileSync(
        join(projectRoot, ".deck", "pi", "profiles", "developer-team", "system-prompt.md"),
        "utf-8",
      );

      // Second write with same content should not change the file
      let writeCalled = false;
      materializeTeamProfile({
        teamId: "developer-team",
        projectRoot,
        writeFile: (path, data) => {
          writeCalled = true;
          writeFileSync(path, data, "utf-8");
        },
        readFile: () => content,
        exists: () => true,
      });

      // Since content matches, writeFile should not be called
      expect(writeCalled).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("materializes with Engram memory provider and includes Adaptive Memory section", () => {
    const projectRoot = createTempDir();
    try {
      const engramProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
        id: "engram",
        displayName: "Engram Memory",
        buildInjection: () => ({
          instructions: [
            {
              surface: "session",
              markdown: "Use Engram for persistent session context.",
              teamId: "developer-team",
            },
          ],
          toolBindings: [
            { capability: "memory.search", serverName: "engram", toolNames: ["memory_search"] },
          ],
        }),
      };

      materializeTeamProfile({
        teamId: "developer-team",
        projectRoot,
        memoryProvider: engramProvider,
      });

      const content = readFileSync(
        join(projectRoot, ".deck", "pi", "profiles", "developer-team", "system-prompt.md"),
        "utf-8",
      );

      expect(content).toContain("## Adaptive Memory (provider-injected)");
      expect(content).toContain("Use Engram for persistent session context.");
      expect(content).toContain("Memory is auxiliary");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});