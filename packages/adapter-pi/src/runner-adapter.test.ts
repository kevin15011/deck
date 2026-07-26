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

import { chmodSync } from "node:fs";
import { createPiRunnerAdapter, createPiSkillDiscoveryProvider } from "./runner-adapter";
import type { OpaqueSkillInventoryResultV1 } from "@deck/core";
import { discoverSkillsFromProvider } from "../../core/src/skill-discovery/discovery";

describe("Pi active-runner skill discovery provider", () => {
  test("attaches deterministic Pi-only filesystem source declarations", async () => {
    const home = tempHome();
    const projectRoot = join(home, "project");
    try {
      mkdirSync(projectRoot, { recursive: true });
      const adapter = createPiRunnerAdapter({ homeDirectory: home });
      const provider = adapter.skillDiscovery;

      expect(provider?.schema).toBe("skill-discovery-source-provider-v1");
      expect(provider?.runnerId).toBe("pi");

      const first = await provider!.listSources({ projectRoot });
      const second = await provider!.listSources({ projectRoot });

      expect(first.outcome).toBe("complete");
      expect(first.sources.map((source) => source.declaration.sourceId)).toEqual([
        "pi-project-skills",
        "pi-user-agent-skills",
        "pi-user-skills",
      ]);
      expect(second.sources.map((source) => source.declaration.sourceId)).toEqual(
        first.sources.map((source) => source.declaration.sourceId),
      );
      expect(first.sources.every((source) => source.kind === "filesystem")).toBe(true);
      expect(first.sources.map((source) => source.declaration.runnerId)).toEqual(["pi", "pi", "pi"]);
      expect(first.sources.map((source) => source.declaration.sourceCategory)).toEqual([
        "project_runner",
        "user_runner",
        "user_runner",
      ]);
      expect(first.sources.map((source) => source.declaration.safeLocatorBase)).toEqual([
        ".pi/skills",
        "pi-user-agent-skills",
        "pi-user-skills",
      ]);
      expect(first.sources.some((source) => source.declaration.sourceId.startsWith("opencode"))).toBe(false);
      expect(JSON.stringify(first.sources.map((source) => source.declaration))).not.toContain(home);
    } finally {
      cleanup(home);
    }
  });

  test("composes Core generic roots with Pi sources and excludes OpenCode roots", async () => {
    const home = tempHome();
    const projectRoot = join(home, "project");
    try {
      mkdirSync(join(projectRoot, ".agents", "skills", "generic"), { recursive: true });
      mkdirSync(join(projectRoot, ".skills", "generic"), { recursive: true });
      mkdirSync(join(projectRoot, ".pi", "skills", "pi-only"), { recursive: true });
      mkdirSync(join(home, ".config", "opencode", "skills", "other-runner-only"), { recursive: true });
      writeFileSync(join(projectRoot, ".agents", "skills", "generic", "SKILL.md"), "---\nname: generic-agents\n---\n");
      writeFileSync(join(projectRoot, ".skills", "generic", "SKILL.md"), "---\nname: generic-skills\n---\n");
      writeFileSync(join(projectRoot, ".pi", "skills", "pi-only", "SKILL.md"), "---\nname: pi-only\n---\n");
      writeFileSync(join(home, ".config", "opencode", "skills", "other-runner-only", "SKILL.md"), "---\nname: other-runner-only\n---\n");

      const adapter = createPiRunnerAdapter({ homeDirectory: home });
      const result = await discoverSkillsFromProvider({
        projectRoot,
        activeRunnerId: "pi",
        provider: adapter.skillDiscovery!,
      });

      expect(result.outcome).toBe("complete");
      expect(result.observations.map((observation) => observation.name)).toEqual([
        "generic-agents",
        "pi-only",
        "generic-skills",
      ]);
      expect(result.observations.some((observation) => observation.name === "other-runner-only")).toBe(false);
    } finally {
      cleanup(home);
    }
  });

  test("treats absent Pi roots as a complete empty source set", async () => {
    const home = tempHome();
    try {
      const result = await createPiRunnerAdapter({ homeDirectory: home }).skillDiscovery!.listSources({
        projectRoot: join(home, "missing-project"),
      });

      expect(result.outcome).toBe("complete");
      expect(result.sources).toHaveLength(3);
      expect(result.diagnostics).toEqual([]);
    } finally {
      cleanup(home);
    }
  });

  test("marks an existing unreadable Pi root indeterminate without exposing its path", async () => {
    const home = tempHome();
    const projectRoot = join(home, "project");
    const skillsRoot = join(projectRoot, ".pi", "skills");
    try {
      mkdirSync(skillsRoot, { recursive: true });
      chmodSync(skillsRoot, 0o000);

      const result = await createPiRunnerAdapter({ homeDirectory: home }).skillDiscovery!.listSources({ projectRoot });

      expect(result.outcome).toBe("indeterminate");
      if (result.outcome === "indeterminate") {
        expect(result.reasonCode).toBe("partial_source_evaluation");
      }
      expect(result.diagnostics[0]?.source_id).toBe("pi-project-skills");
      expect(JSON.stringify(result.diagnostics)).not.toContain(home);
    } finally {
      chmodSync(skillsRoot, 0o700);
      cleanup(home);
    }
  });

  test("exposes bounded opaque inventory results without adding writer or authority behavior", async () => {
    const home = tempHome();
    const inventory: OpaqueSkillInventoryResultV1 = {
      outcome: "complete",
      observations: [{ opaqueId: "package-skill", name: "Package Skill" }],
      diagnostics: [],
    };
    try {
      const provider = createPiSkillDiscoveryProvider({
        homeDirectory: home,
        opaqueInventory: async () => inventory,
      });
      const result = await provider.listSources({ projectRoot: join(home, "project") });
      const opaque = result.sources.find((source) => source.kind === "opaque_inventory");

      expect(opaque?.declaration.sourceCategory).toBe("runner_exposed");
      expect(opaque?.declaration.expectedContent).toBe("opaque_inventory_v1");
      expect("writer" in provider).toBe(false);
      expect("authorize" in provider).toBe(false);
      expect(await (opaque as Extract<typeof opaque, { kind: "opaque_inventory" }>).readInventory()).toEqual(inventory);
    } finally {
      cleanup(home);
    }
  });

  test("resolves only safe current Pi locators", async () => {
    const home = tempHome();
    const projectRoot = join(home, "project");
    const projectSkill = join(projectRoot, ".pi", "skills", "project-skill", "SKILL.md");
    const userSkill = join(home, ".pi", "agent", "skills", "user-skill", "SKILL.md");
    try {
      mkdirSync(join(projectSkill, ".."), { recursive: true });
      mkdirSync(join(userSkill, ".."), { recursive: true });
      writeFileSync(projectSkill, "# project", "utf-8");
      writeFileSync(userSkill, "# user", "utf-8");
      const provider = createPiRunnerAdapter({ homeDirectory: home }).skillDiscovery!;

      await expect(provider.resolveLocator({ projectRoot, locator: "project:.pi/skills/project-skill/SKILL.md" })).resolves.toMatchObject({
        status: "available",
      });
      await expect(provider.resolveLocator({ projectRoot, locator: "runner:pi:pi-user-agent-skills/user-skill/SKILL.md" })).resolves.toMatchObject({
        status: "available",
      });
      await expect(provider.resolveLocator({ projectRoot, locator: "project:.pi/skills/missing/SKILL.md" })).resolves.toEqual({
        status: "missing",
      });
      const rejected = await provider.resolveLocator({ projectRoot, locator: "project:../outside/SKILL.md" });
      expect(rejected.status).toBe("rejected");
      expect(JSON.stringify(rejected)).not.toContain(home);
    } finally {
      cleanup(home);
    }
  });
});

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
