/**
 * Tests for runner-adapter.ts fixes (Repair #21)
 * - Path canonicalization: read model assignments from explicit Pi agents dir
 * - No console.log leakage
 * - MCP config persistence
 */
import { describe, expect, test, beforeEach, spyOn } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  readDeveloperTeamModelAssignments,
  readDeveloperTeamThinkingAssignments,
  readDeveloperTeamModelConfigAssignments,
} from "./developer-team-install";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "deck-adapter-test-"));
}

function cleanup(path: string) {
  rmSync(path, { recursive: true, force: true });
}

describe("Repair #21: Path canonicalization for Pi agents directory", () => {
  test("reads model assignments from explicit ~/.pi/agent/agents directory without double .pi/agents append", () => {
    const home = tempHome();
    try {
      // Simulate Pi agents directory structure: ~/.pi/agent/agents/{agentId}.md
      const agentsDir = join(home, ".pi", "agent", "agents");
      mkdirSync(agentsDir, { recursive: true });

      // Write agent files with model frontmatter
      writeFileSync(
        join(agentsDir, "deck-developer-orchestrator.md"),
        ["---", "name: deck-developer-orchestrator", "model: openai-codex/gpt-5.5", "thinking: high", "---"].join("\n"),
        "utf-8",
      );
      writeFileSync(
        join(agentsDir, "deck-developer-explorer.md"),
        ["---", "name: deck-developer-explorer", "model: opencode-go/kimi-k2.6", "thinking: off", "---"].join("\n"),
        "utf-8",
      );

      // Read using explicit agentsDir (NEW - should NOT append .pi/agents)
      const assignments = readDeveloperTeamModelConfigAssignments(home, {
        exists: existsSync,
        readFile: (path) => readFileSync(path, "utf-8"),
        agentsDir: agentsDir, // Explicit path - should NOT append .pi/agents
      });

      expect(assignments.modelAssignments["deck-developer-orchestrator"]).toBe("openai-codex/gpt-5.5");
      expect(assignments.modelAssignments["deck-developer-explorer"]).toBe("opencode-go/kimi-k2.6");
      expect(assignments.thinkingAssignments["deck-developer-orchestrator"]).toBe("high");
      expect(assignments.thinkingAssignments["deck-developer-explorer"]).toBe("off");
    } finally {
      cleanup(home);
    }
  });

  test("legacy reader (readDeveloperTeamModelAssignments) works with explicit agentsDir", () => {
    const home = tempHome();
    try {
      const agentsDir = join(home, ".pi", "agent", "agents");
      mkdirSync(agentsDir, { recursive: true });

      writeFileSync(
        join(agentsDir, "deck-developer-orchestrator.md"),
        ["---", "name: orchestrator", "model: anthropic/claude-sonnet-4", "thinking: medium", "---"].join("\n"),
        "utf-8",
      );

      // Legacy reader with explicit agentsDir
      const modelAssignments = readDeveloperTeamModelAssignments(home, {
        exists: existsSync,
        readFile: (path) => readFileSync(path, "utf-8"),
        agentsDir: agentsDir,
      });

      expect(modelAssignments["deck-developer-orchestrator"]).toBe("anthropic/claude-sonnet-4");

      // Also test thinking assignments
      const thinkingAssignments = readDeveloperTeamThinkingAssignments(home, {
        exists: existsSync,
        readFile: (path) => readFileSync(path, "utf-8"),
        agentsDir: agentsDir,
      });

      expect(thinkingAssignments["deck-developer-orchestrator"]).toBe("medium");
    } finally {
      cleanup(home);
    }
  });

  test("returns empty when no agent files exist in explicit agentsDir", () => {
    const home = tempHome();
    try {
      const agentsDir = join(home, ".pi", "agent", "agents");
      mkdirSync(agentsDir, { recursive: true });
      // No files written

      const assignments = readDeveloperTeamModelConfigAssignments(home, {
        exists: existsSync,
        readFile: (path) => {
          throw new Error("Should not read");
        },
        agentsDir: agentsDir,
      });

      expect(Object.keys(assignments.modelAssignments)).toHaveLength(0);
      expect(Object.keys(assignments.thinkingAssignments)).toHaveLength(0);
    } finally {
      cleanup(home);
    }
  });
});

describe("Repair #21: No console.log leakage in runner-adapter", () => {
  test("runner-adapter.ts should not contain console.log statements", () => {
    const content = readFileSync(join(__dirname, "runner-adapter.ts"), "utf-8");
    // Check for console.log but exclude comments
    const lines = content.split("\n");
    const consoleLogLines = lines.filter((line) => {
      const trimmed = line.trim();
      // Skip comments
      if (trimmed.startsWith("//")) return false;
      // Check for console.log
      return line.includes("console.log(");
    });
    expect(consoleLogLines).toHaveLength(0);
  });
});

describe("Repair #21: MCP config write handler structure", () => {
  test("write-pi-mcp-config handler exists and calls all MCP writers", () => {
    // This test verifies the handler structure exists
    // Actual persistence is tested via integration tests in TUI
    const runnerAdapterPath = join(__dirname, "runner-adapter.ts");
    const content = readFileSync(runnerAdapterPath, "utf-8");

    // Verify handler exists with proper structure
    expect(content).toContain('action.kind === "write-pi-mcp-config"');

    // Verify all MCP server writers are called
    expect(content).toContain("writeContextModeMcpConfig");
    expect(content).toContain("writeCodebaseMemoryMcpConfig");
    expect(content).toContain("writeSerenaMcpConfig");
    expect(content).toContain("writeContext7McpConfig");
    expect(content).toContain("writeSupermemoryPiMcpConfig");
  });
});
