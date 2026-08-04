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
import { createPiRunnerAdapter, createPiSkillDiscoveryProvider, isPiSerenaActionAuthorized } from "./runner-adapter";
import { buildPiRunnerReviewPlan } from "./capability-plan";
import type { OpaqueSkillInventoryResultV1 } from "@deck/core";
import type { SerenaReadinessEvidence } from "@deck/core";
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

      expect(assignments.modelAssignments["deck-lead"]).toBe("openai-codex/gpt-5.5");
      expect(assignments.modelAssignments["deck-investigate"]).toBe("opencode-go/kimi-k2.6");
      expect(assignments.thinkingAssignments["deck-lead"]).toBe("high");
      expect(assignments.thinkingAssignments["deck-investigate"]).toBe("off");
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

      expect(modelAssignments["deck-lead"]).toBe("anthropic/claude-sonnet-4");

      // Also test thinking assignments
      const thinkingAssignments = readDeveloperTeamThinkingAssignments(home, {
        exists: existsSync,
        readFile: (path) => readFileSync(path, "utf-8"),
        agentsDir: agentsDir,
      });

      expect(thinkingAssignments["deck-lead"]).toBe("medium");
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

describe("Pi Serena action authorization", () => {
  const authorization = {
    kind: "interactive-tui-explicit-selection" as const,
    runner: "pi" as const,
    operationId: "pi-operation-1",
  };
  const operation = {
    runner: "pi" as const,
    operationId: "pi-operation-1",
    explicitlySelected: true as const,
  };

  test("allows only a named Serena action for the matching explicit Pi operation", () => {
    const action = { kind: "write-pi-mcp-config", capabilityId: "serena" };
    const context = { runnerId: "pi", serenaAuthorization: authorization, currentOperation: operation };

    expect(isPiSerenaActionAuthorized(action, context)).toBe(true);
    expect(isPiSerenaActionAuthorized({ ...action, capabilityId: "context7" }, context)).toBe(false);
    expect(isPiSerenaActionAuthorized({ ...action, kind: "write-deck-config" }, context)).toBe(false);
    expect(isPiSerenaActionAuthorized(action, { ...context, operationId: "stale-operation" })).toBe(false);
    expect(isPiSerenaActionAuthorized(action, { ...context, currentOperation: { ...operation, explicitlySelected: false } })).toBe(false);
  });

  test("does not expose readiness evidence or authorize an unselected operation", () => {
    const readiness: SerenaReadinessEvidence = {
      capabilityId: "serena",
      state: "ready",
      resolvedExecutablePath: "/fixtures/deck-data/tools/serena/bin/serena",
      source: "existing-deck-tool",
      probe: "serena-help",
      fingerprint: "fingerprint-1",
    };

    expect(isPiSerenaActionAuthorized(
      { kind: "write-pi-mcp-config", capabilityId: "serena" },
      {
        runnerId: "pi",
        serenaReadiness: readiness,
        serenaAuthorization: authorization,
        currentOperation: { ...operation, explicitlySelected: false },
      },
    )).toBe(false);
  });

  test("routes unrelated named actions through their own writer and keeps write-deck-config inert", async () => {
    const namedCalls: string[] = [];
    let serenaWriterCalls = 0;
    const adapter = createPiRunnerAdapter({
      writeNamedMcpConfig: async (capabilityId) => {
        namedCalls.push(capabilityId);
        return {
          ok: true,
          action: "created",
          path: "/fixtures/pi/mcp.json",
          serverName: capabilityId,
          diagnostics: [],
        };
      },
      writeSerenaMcpConfig: async () => {
        serenaWriterCalls += 1;
        return {
          ok: true,
          action: "created",
          path: "/fixtures/pi/mcp.json",
          serverName: "serena",
          diagnostics: [],
        };
      },
    });
    const context = {
      projectRoot: "/fixtures/project",
      runnerId: "pi",
      environmentId: "pi-development",
      serenaAuthorization: authorization,
      currentOperation: operation,
    };

    await expect(adapter.runAction({
      id: "capability.context7.mcp-config",
      kind: "write-pi-mcp-config",
      title: "Configure Context7 MCP",
      capabilityId: "context7",
      status: "ready",
    }, context)).resolves.toMatchObject({ status: "executed" });
    await expect(adapter.runAction({
      id: "package-instructions.pi.deck-config",
      kind: "write-deck-config",
      title: "Write package instruction configuration",
      status: "ready",
    }, context)).resolves.toMatchObject({ status: "informational" });

    expect(namedCalls).toEqual(["context7"]);
    expect(serenaWriterCalls).toBe(0);
  });
});

describe("Pi Serena adapter projection", () => {
  test("projects an injected Serena installer result without requiring the Pi command", async () => {
    const installerCalls: unknown[] = [];
    const adapter = createPiRunnerAdapter({
      installTools: (async (...args: unknown[]) => {
        installerCalls.push(args);
        return [{
          tool: "Serena",
          success: true,
          actionKind: "install-pi-package",
          status: "installed",
          installKind: "shared-binary-plus-mcp",
          serenaReadiness: {
            capabilityId: "serena",
            state: "ready",
            resolvedExecutablePath: "/fixtures/deck-data/tools/serena/bin/serena",
            source: "installed-deck-tool",
            probe: "serena-help",
            fingerprint: "fingerprint-1",
          },
        }];
      }) as any,
    });

    const result = await adapter.runAction(
      {
        id: "capability.serena.install",
        kind: "install-pi-package",
        title: "Install Serena",
        capabilityId: "serena",
        toolId: "serena",
        source: "serena-agent",
        status: "ready",
      },
      {
        projectRoot: "/fixtures/project",
        runnerId: "pi",
        environmentId: "pi-development",
        serenaAuthorization: {
          kind: "interactive-tui-explicit-selection",
          runner: "pi",
          operationId: "pi-operation-1",
        },
        currentOperation: {
          runner: "pi",
          operationId: "pi-operation-1",
          explicitlySelected: true,
        },
      },
    );

    expect(result.status).toBe("executed");
    expect(installerCalls).toHaveLength(1);
  });

  test("exercises plan to installer result to revalidated named Serena writer with only injected effects", async () => {
    const configPath = "/fixtures/pi/mcp.json";
    const files = new Map<string, string>();
    const fileSystem = {
      existsSync: (path: string) => files.has(path),
      readFileSync: (path: string) => files.get(path) ?? "",
      mkdirSync: () => {},
      writeFileSync: (path: string, content: string) => files.set(path, content),
      renameSync: (from: string, to: string) => {
        files.set(to, files.get(from) ?? "");
        files.delete(from);
      },
      rmSync: (path: string) => files.delete(path),
    };
    const readiness = {
      capabilityId: "serena" as const,
      state: "ready" as const,
      resolvedExecutablePath: "/fixtures/deck-data/tools/serena/bin/serena",
      source: "installed-deck-tool" as const,
      probe: "serena-help" as const,
      fingerprint: "fingerprint-functional-1",
    };
    let revalidationCalls = 0;
    const operation = {
      runner: "pi" as const,
      operationId: "pi-operation-functional",
      explicitlySelected: true as const,
    };
    const authorization = {
      kind: "interactive-tui-explicit-selection" as const,
      runner: "pi" as const,
      operationId: operation.operationId,
    };
    const adapter = createPiRunnerAdapter({
      serenaOwnedRoot: "/fixtures/deck-data/tools/serena",
      serenaRevalidator: async (evidence) => {
        revalidationCalls += 1;
        return { valid: true as const, evidence };
      },
      installTools: async () => [{
        tool: "Serena",
        success: true,
        actionKind: "install-pi-package",
        status: "installed",
        installKind: "shared-binary-plus-mcp",
        serenaReadiness: readiness,
      }] as any,
    });
    const plan = buildPiRunnerReviewPlan(
      {
        runnerScope: "pi",
        selectedCapabilities: { serena: true },
        explicitlySelectedCapabilities: { serena: true },
        operationId: operation.operationId,
        currentOperation: operation,
      },
      {
        serena: {
          capabilityId: "serena",
          status: "missing",
          runnerScope: "pi",
          installed: false,
          diagnostics: [],
        },
      },
    );
    const installAction = plan.groups.automaticInstalls.find((action) => action.capabilityId === "serena");
    const configAction = plan.groups.configWrites.find((action) => action.capabilityId === "serena");
    expect(installAction).toBeDefined();
    expect(configAction).toBeDefined();

    const context = {
      projectRoot: "/fixtures/project",
      runnerId: "pi",
      environmentId: "pi-development",
      serenaAuthorization: authorization,
      currentOperation: operation,
      piMcpConfigPath: configPath,
      piMcpFileSystem: fileSystem,
    };
    await expect(adapter.runAction(installAction!, context as any)).resolves.toMatchObject({ status: "executed" });
    await expect(adapter.runAction(configAction!, context as any)).resolves.toMatchObject({ status: "executed" });

    expect(revalidationCalls).toBe(1);
    expect(JSON.parse(files.get(configPath)!)).toEqual({
      mcpServers: {
        serena: {
          command: readiness.resolvedExecutablePath,
          args: ["start-mcp-server", "--context", "ide", "--project-from-cwd"],
        },
      },
    });
  });

  test("never calls the Serena writer for missing, invalid, stale, or non-success bootstrap evidence", async () => {
    let writerCalls = 0;
    const adapter = createPiRunnerAdapter({
      serenaOwnedRoot: "/fixtures/deck-data/tools/serena",
      serenaRevalidator: async (evidence) => ({ valid: true as const, evidence }),
      writeSerenaMcpConfig: async () => {
        writerCalls += 1;
        return {
          ok: true,
          action: "created",
          path: "/fixtures/pi/mcp.json",
          serverName: "serena",
          diagnostics: [],
        };
      },
    });
    const action = {
      id: "capability.serena.mcp-config",
      kind: "write-pi-mcp-config",
      title: "Configure Serena MCP",
      capabilityId: "serena",
      status: "ready" as const,
    };
    const context = {
      projectRoot: "/fixtures/project",
      runnerId: "pi",
      environmentId: "pi-development",
      serenaAuthorization: {
        kind: "interactive-tui-explicit-selection" as const,
        runner: "pi" as const,
        operationId: "pi-operation-1",
      },
      currentOperation: {
        runner: "pi" as const,
        operationId: "pi-operation-1",
        explicitlySelected: true as const,
      },
    };

    await adapter.runAction(action, context);
    await adapter.runAction(action, {
      ...context,
      serenaReadiness: {
        capabilityId: "serena",
        state: "ready",
        resolvedExecutablePath: "relative/serena",
        source: "existing-deck-tool",
        probe: "serena-help",
        fingerprint: "fingerprint-invalid",
      },
    } as any);
    await adapter.runAction(action, {
      ...context,
      serenaReadiness: {
        capabilityId: "serena",
        state: "ready",
        resolvedExecutablePath: "/fixtures/deck-data/tools/serena/bin/serena",
        source: "existing-deck-tool",
        probe: "serena-help",
        fingerprint: "fingerprint-stale",
      },
      serenaRevalidator: async (evidence: SerenaReadinessEvidence) => ({
        valid: true as const,
        evidence: { ...evidence, fingerprint: "fingerprint-changed" },
      }),
    } as any);
    await adapter.runAction(action, {
      ...context,
      serenaBootstrapOutcome: "failed",
      serenaReadiness: {
        capabilityId: "serena",
        state: "ready",
        resolvedExecutablePath: "/fixtures/deck-data/tools/serena/bin/serena",
        source: "existing-deck-tool",
        probe: "serena-help",
        fingerprint: "fingerprint-failed",
      },
    } as any);

    expect(writerCalls).toBe(0);
  });
});
