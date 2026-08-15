import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DEVELOPER_TEAM_LANGUAGE_POLICY } from "@deck/core/teams/developer/content-registry";
import {
  buildTeamSystemPrompt,
  materializeTeamProfile,
  type MaterializeTeamProfileOptions,
} from "./pi-team-profile";

const compactPromptActivation = {
  schema: "prompt-profile-activation-v1" as const,
  status: "eligible" as const,
  requestedProfile: "compact" as const,
  effectiveProfile: "compact" as const,
  reasonCodes: [] as const,
  evidenceDigest: `sha256:${"a".repeat(64)}` as const,
};

function createTempDir(prefix = "deck-test-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function countOccurrences(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

describe("buildTeamSystemPrompt", () => {
  test("builds the adaptive Developer Team Lead prompt by default", () => {
    const { content } = buildTeamSystemPrompt("developer-team");

    expect(content).toContain("# Lead (deck-lead)");
    expect(content).toContain("Adaptive Developer Team Contract");
    expect(content).toContain("## Route selection");
    expect(content).toContain("## Conversational deltas");
  });

  test("materializes the Pi runtime context before adaptive memory", () => {
    const supermemoryProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "fixture-memory",
      displayName: "Supermemory Memory",
      buildInjection: () => ({
        instructions: [
          {
            surface: "session",
            markdown: "Use Supermemory memory for persistent context.",
            teamId: "developer-team",
          },
        ],
        toolBindings: [],
      }),
    };

    const { content } = buildTeamSystemPrompt("developer-team", { memoryProvider: supermemoryProvider, supportedMemoryProviderIds: ["fixture-memory"] });

    expect(content).toContain("## Skill Discovery Runtime Context");
    expect(content).toContain("- active_runner_id: pi");
    expect(content).toContain("- validate_command: deck skill-registry validate --runner pi");
    expect(content).toContain("- discover_command: deck skill-registry discover --runner pi");
    expect(content).toContain("- refresh_command: deck skill-registry refresh --runner pi");
    expect(content).toContain("Verify a selected candidate's current locator or runner exposure immediately before loading it");
    expect(content).toContain("load it only through the active runner's normal skill mechanism.");
    expect(content).toContain("bounded direct discovery");
    expect(content).not.toContain("## Skill: ");
    expect(content).not.toContain("--runner opencode");
    expect(content).not.toContain(".pi/skills");
    expect(content).not.toContain(".opencode/skills");
    expect(content).not.toContain("~/.pi/");
    expect(content).not.toContain("~/.config/opencode/");
    expect(countOccurrences(content, "## Skill Discovery Authority Boundary")).toBe(1);

    const runtimeContextIndex = content.indexOf("## Skill Discovery Runtime Context");
    const adaptiveMemoryIndex = content.indexOf("## Adaptive Memory (provider-injected)");
    expect(runtimeContextIndex).toBeGreaterThanOrEqual(0);
    expect(adaptiveMemoryIndex).toBeGreaterThan(runtimeContextIndex);
  });

  test("uses compact session content by default regardless of obsolete rollout receipts", () => {
    const compact = buildTeamSystemPrompt("developer-team");
    const eligible = buildTeamSystemPrompt("developer-team", {
      promptProfileActivation: compactPromptActivation,
    });
    const paused = buildTeamSystemPrompt("developer-team", {
      promptProfileActivation: { ...compactPromptActivation, status: "rollout-paused" },
    });

    expect(compact.content).toContain("# Lead (deck-lead)");
    expect(compact.content).toContain("Adaptive Developer Team Contract");
    expect(eligible.content).toBe(compact.content);
    expect(paused.content).toBe(compact.content);
  });

  test("contains proportional routing and authority rules", () => {
    const { content } = buildTeamSystemPrompt("developer-team");

    expect(content).toContain("Choose the smallest route");
    expect(content).toContain("Modifying work requires the user's request and the active runner's authority");
    expect(content).toContain("Do not use file count as a routing signal");
    expect(content).not.toContain("Delegate each phase");
  });

  test("contains adaptive specialist routing", () => {
    const { content } = buildTeamSystemPrompt("developer-team");
    expect(content).toContain("Apply Fast");
    expect(content).toContain("Apply Deep");
    expect(content).toContain("Investigate");
    expect(content).toContain("Quality is not a universal gate");
  });

  test("keeps official context authoritative", () => {
    const { content } = buildTeamSystemPrompt("developer-team");
    expect(content).toContain("OpenSpec artifacts and Spec Registry entries are authoritative");
    expect(content).toContain("adaptive memory is advisory");
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

  test("composes Supermemory memory into session prompt when Supermemory provider is provided", () => {
    const supermemoryProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "fixture-memory",
      displayName: "Supermemory Memory",
      buildInjection: () => ({
        instructions: [
          {
            surface: "session",
            markdown: "Use Supermemory memory for persistent context.",
            teamId: "developer-team",
          },
        ],
        toolBindings: [
          { capability: "memory.search", serverName: "fixture-memory", toolNames: ["memory_search"] },
        ],
      }),
    };

    const { content, memoryDiagnostics } = buildTeamSystemPrompt("developer-team", {
      memoryProvider: supermemoryProvider,
      supportedMemoryProviderIds: ["fixture-memory"],
    });

    expect(content).toContain("## Adaptive Memory (provider-injected)");
    expect(content).toContain("Use Supermemory memory for persistent context.");
    expect(content).toContain("Memory is auxiliary");
    expect(memoryDiagnostics).toHaveLength(0);
  });

  test("returns diagnostic when supported Supermemory provider buildInjection throws", () => {
    const brokenSupermemory: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "fixture-memory", // Supported ID, but buildInjection throws
      displayName: "Broken Supermemory",
      buildInjection: () => {
        throw new Error("provider initialization failed");
      },
    };

    const { content, memoryDiagnostics } = buildTeamSystemPrompt("developer-team", {
      memoryProvider: brokenSupermemory,
      supportedMemoryProviderIds: ["fixture-memory"],
    });

    // Should return base content without injection
    expect(content).toContain("Developer Team");
    expect(content).not.toContain("## Adaptive Memory (provider-injected)");
    // Should have diagnostic
    expect(memoryDiagnostics).toHaveLength(1);
    expect(memoryDiagnostics[0].code).toBe("memory_provider_unavailable");
    expect(memoryDiagnostics[0].providerId).toBe("fixture-memory");
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
      id: "fixture-memory",
      displayName: "Supermemory MCP",
      buildInjection: () => ({
        instructions: [
          { surface: "session", markdown: "Use Supermemory MCP advisory context through execute and search_docs only.", teamId: "developer-team" },
        ],
        toolBindings: [{ capability: "memory.search", serverName: "fixture-memory", toolNames: ["execute", "search_docs"] }],
      }),
    };

    const { content, memoryDiagnostics } = buildTeamSystemPrompt("developer-team", { memoryProvider: supermemoryProvider, supportedMemoryProviderIds: ["fixture-memory"] });

    expect(memoryDiagnostics).toHaveLength(0);
    expect(content).toContain("## OFFICIAL CONTEXT");
    expect(content).toContain("## ADAPTIVE CONTEXT");
    expect(content).toContain("OpenSpec artifacts and Spec Registry entries are authoritative");
    expect(content).toContain("Use Supermemory MCP advisory context through execute and search_docs only.");
    expect(content).toContain("## Adaptive Memory (provider-injected)");
  });

  test("renders adaptive-context absence indicator when Supermemory provider is unavailable", () => {
    const brokenSupermemory: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
      id: "fixture-memory",
      displayName: "Supermemory MCP",
      buildInjection: () => {
        throw new Error("Supermemory MCP validation is incomplete or failed.");
      },
    };

    const { content, memoryDiagnostics } = buildTeamSystemPrompt("developer-team", { memoryProvider: brokenSupermemory, supportedMemoryProviderIds: ["fixture-memory"] });

    expect(memoryDiagnostics).toHaveLength(1);
    expect(memoryDiagnostics[0].providerId).toBe("fixture-memory");
    expect(content).toContain("## OFFICIAL CONTEXT");
    expect(content).toContain("## ADAPTIVE CONTEXT");
    expect(content).toContain("Adaptive context was not loaded");
    expect(content).toContain("OpenSpec artifacts and Spec Registry entries are authoritative");
    expect(content).not.toContain("## Adaptive Memory (provider-injected)");
  });

  test("renders launch-owned memoryUnavailableReason without resolving provider", () => {
    const sentinel = "secret-token-do-not-leak";
    const { content, memoryDiagnostics } = buildTeamSystemPrompt("developer-team", {
      memoryUnavailableReason: "Supermemory runtime validation failed; check Pi MCP configuration.",
    });

    expect(memoryDiagnostics).toHaveLength(0);
    expect(content).toContain("## OFFICIAL CONTEXT");
    expect(content).toContain("## ADAPTIVE CONTEXT");
    expect(content).toContain("Adaptive context was not loaded: Supermemory runtime validation failed");
    expect(content).not.toContain("## Adaptive Memory (provider-injected)");
    expect(content).not.toContain(sentinel);
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
      expect(content).toContain("Adaptive Developer Team Contract");
      expect(content).toContain("- active_runner_id: pi");
      expect(content).toContain("deck skill-registry refresh --runner pi");
      expect(content).not.toContain("--runner opencode");
      expect(content).not.toContain(".pi/skills");
      expect(content).not.toContain(".opencode/skills");
      expect(content).not.toContain("~/.pi/");
      expect(content).not.toContain("~/.config/opencode/");
      expect(countOccurrences(content, "## Skill Discovery Authority Boundary")).toBe(1);
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

    expect(written).toHaveLength(2);
    expect(written[0].path).toBe("/fake/.deck/pi/profiles/developer-team/system-prompt.md");
    expect(written[0].content).toContain("Developer Team");
    expect(written[1].path).toBe("/fake/.deck/pi/profiles/developer-team/extensions/developer-team-execution.js");
    expect(written[1].content).toContain('"tool_call"');
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
      });

      // Since content matches, writeFile should not be called
      expect(writeCalled).toBe(false);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("materializes with Supermemory memory provider and includes Adaptive Memory section", () => {
    const projectRoot = createTempDir();
    try {
      const supermemoryProvider: import("@deck/core/memory/adaptive-memory").AdaptiveMemoryProvider = {
        id: "fixture-memory",
        displayName: "Supermemory Memory",
        buildInjection: () => ({
          instructions: [
            {
              surface: "session",
              markdown: "Use Supermemory for persistent session context.",
              teamId: "developer-team",
            },
          ],
          toolBindings: [
            { capability: "memory.search", serverName: "fixture-memory", toolNames: ["memory_search"] },
          ],
        }),
      };

      materializeTeamProfile({
        teamId: "developer-team",
        projectRoot,
        memoryProvider: supermemoryProvider,
        supportedMemoryProviderIds: ["fixture-memory"],
      });

      const content = readFileSync(
        join(projectRoot, ".deck", "pi", "profiles", "developer-team", "system-prompt.md"),
        "utf-8",
      );

      expect(content).toContain("## Adaptive Memory (provider-injected)");
      expect(content).toContain("Use Supermemory for persistent session context.");
      expect(content).toContain("Memory is auxiliary");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// Developer Team language policy propagation to Pi team profile
// (REQ-ADAPT-002, REQ-LEAK-001, REQ-LEAK-002, REQ-TEST-001, REQ-TEST-003)
// ---------------------------------------------------------------------------

describe("Developer Team language policy propagation to Pi team profile", () => {
  test("buildTeamSystemPrompt includes the language policy and excludes the known leak", () => {
    const { content } = buildTeamSystemPrompt("developer-team");
    expect(content).toContain(DEVELOPER_TEAM_LANGUAGE_POLICY);
    expect(content).not.toContain("herramienta");
  });

  test("materialized profile system-prompt.md includes the language policy and excludes the known leak", () => {
    const projectRoot = createTempDir();
    try {
      materializeTeamProfile({ teamId: "developer-team", projectRoot });
      const content = readFileSync(
        join(projectRoot, ".deck", "pi", "profiles", "developer-team", "system-prompt.md"),
        "utf-8",
      );
      expect(content).toContain(DEVELOPER_TEAM_LANGUAGE_POLICY);
      expect(content).not.toContain("herramienta");
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
