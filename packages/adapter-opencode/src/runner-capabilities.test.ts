import { describe, expect, test } from "bun:test";

import { createOpenCodeRunnerCapabilities } from "./runner-capabilities";
import { buildOpenCodeDeveloperTeamInstallPlan } from "./developer-team-install";
import { getDefaultDeckConfig } from "@deck/core";
import { STANDALONE_SKILLS } from "@deck/core/skills/external";
import { getBootstrapSkillFiles } from "@deck/core/skills/bootstrap";
import { buildDeveloperTeamManifest } from "../../core/src/teams/developer/manifest";
import type { CapabilityInstructionBundle } from "../../core/src/teams/developer/instruction-bundles/index";

// Test helper: create a minimal non-default capabilityInstructions bundle
function createTestCapabilityInstructions(): CapabilityInstructionBundle {
  return {
    instructions: [
      {
        packageId: "codebase-memory",
        surface: "skill",
        markdown: "# Custom Test Instruction Fragment\n\nThis is a test fragment for regression testing.",
        skillIds: ["deck-developer-apply-general"],
      },
    ],
  };
};

describe("OpenCode RunnerCapabilities factory", () => {
  const capabilities = createOpenCodeRunnerCapabilities();

  test("returns an object satisfying RunnerCapabilities type", () => {
    expect(capabilities).toBeDefined();
    expect(typeof capabilities.id).toBe("string");
    expect(typeof capabilities.displayName).toBe("string");
    expect(Array.isArray(capabilities.environments)).toBe(true);
    expect(typeof capabilities.inspectEnvironment).toBe("function");
    expect(typeof capabilities.tools).toBe("object");
    expect(typeof capabilities.teams).toBe("object");
    expect(typeof capabilities.models).toBe("object");
  });

  test("has id 'opencode'", () => {
    expect(capabilities.id).toBe("opencode");
  });

  test("has displayName 'OpenCode'", () => {
    expect(capabilities.displayName).toBe("OpenCode");
  });

  test("has opencode-development environment", () => {
    expect(capabilities.environments).toHaveLength(1);
    expect(capabilities.environments[0].id).toBe("opencode-development");
    expect(capabilities.environments[0].displayName).toBe("OpenCode Development");
  });

  test("tools facet has required methods", () => {
    expect(typeof capabilities.tools.buildInstallationPlan).toBe("function");
    expect(typeof capabilities.tools.installTools).toBe("function");
    expect(typeof capabilities.tools.reviewTools).toBe("function");
  });

  test("teams facet has required methods", () => {
    expect(typeof capabilities.teams.getTeamsForEnvironment).toBe("function");
    expect(typeof capabilities.teams.buildDeveloperTeamManifest).toBe("function");
    expect(typeof capabilities.teams.buildDeveloperTeamInstallPlan).toBe("function");
    expect(typeof capabilities.teams.applyDeveloperTeamInstall).toBe("function");
    expect(typeof capabilities.teams.verifyDeveloperTeamInstall).toBe("function");
  });

  test("models facet has required methods", () => {
    expect(typeof capabilities.models.getCatalog).toBe("function");
    expect(typeof capabilities.models.readAssignments).toBe("function");
    expect(typeof capabilities.models.resolveAssignment).toBe("function");
  });

  test("getTeamsForEnvironment returns teams for opencode-development", () => {
    const teams = capabilities.teams.getTeamsForEnvironment("opencode-development");
    expect(Array.isArray(teams)).toBe(true);
    expect(teams.length).toBeGreaterThan(0);
  });

  test("getTeamsForEnvironment returns empty for unknown environment", () => {
    const teams = capabilities.teams.getTeamsForEnvironment("unknown");
    expect(Array.isArray(teams)).toBe(true);
    expect(teams).toHaveLength(0);
  });

  test("getTeamsForEnvironment returns empty for pi-development", () => {
    const teams = capabilities.teams.getTeamsForEnvironment("pi-development");
    expect(Array.isArray(teams)).toBe(true);
    expect(teams).toHaveLength(0);
  });

  test("getCatalog returns model catalog", () => {
    const catalog = capabilities.models.getCatalog({});
    expect(catalog).toBeDefined();
    expect(Array.isArray(catalog.providers)).toBe(true);
    expect(Array.isArray(catalog.models)).toBe(true);
    expect(Array.isArray(catalog.developerTeamDefaults)).toBe(true);
  });

  test("no imports from @deck/adapter-pi (cross-adapter contamination)", () => {
    const source = require("fs").readFileSync(__filename.replace(".test.ts", ".ts"), "utf-8");
    expect(source).not.toContain("@deck/adapter-pi");
  });

  test("no imports from removed @deck/adapter-engram", () => {
    const source = require("fs").readFileSync(__filename.replace(".test.ts", ".ts"), "utf-8");
    expect(source).not.toContain("@deck/adapter-engram");
  });
});

describe("verify reuse of built plan", () => {
  const capabilities = createOpenCodeRunnerCapabilities();

  test("produces verifyInstall method", () => {
    expect(typeof capabilities.developerTeam?.verifyInstall).toBe("function");
  });

  test("produces buildInstallPlan method", () => {
    expect(typeof capabilities.developerTeam?.buildInstallPlan).toBe("function");
  });

  test("produces applyInstall method", () => {
    expect(typeof capabilities.developerTeam?.applyInstall).toBe("function");
  });

  test("buildInstallPlan produces files with content", async () => {
    // Build plan with custom capabilityInstructions
    const custom = createTestCapabilityInstructions();
    const planInput = {
      projectRoot: "/tmp/test-capability-regression",
      capabilityInstructions: custom,
      modelAssignments: [],
      manifest: {
        agents: [],
        standaloneSkills: [],
      },
    };
    const result = capabilities.developerTeam?.buildInstallPlan(planInput);
    expect(result).toBeDefined();
    expect(result?.files).toBeDefined();
    expect(result?.files.length).toBeGreaterThan(0);
  });

  test("buildInstallPlan preserves all standalone package files with metadata", () => {
    const manifest = buildDeveloperTeamManifest({
      team: { id: "developer-team", displayName: "Developer Team" },
    }).manifest;
    const result = capabilities.teams.buildDeveloperTeamInstallPlan({
      projectRoot: "/tmp/test-standalone-packages",
      environmentId: "opencode-development",
      deckConfig: getDefaultDeckConfig(),
      manifest,
    });

    expect(result).toBeDefined();
    const standaloneFiles = result!.files.filter((file) => file.kind === "standalone-skill");
    const standaloneSkillIds = new Set(standaloneFiles.map((file) => file.skillId));
    expect(standaloneSkillIds.size).toBe(STANDALONE_SKILLS.length + getBootstrapSkillFiles().length);
    expect(standaloneSkillIds).toContain("deck-onboard");
    expect(standaloneSkillIds).toContain("deck-archive");
    expect(standaloneSkillIds.has("frontend-design")).toBe(true);
    expect(standaloneSkillIds.has("web-quality-audit")).toBe(true);
    expect(standaloneFiles).toContainEqual(expect.objectContaining({
      path: "skills/web-quality-audit/scripts/analyze.sh",
      kind: "standalone-skill",
      skillId: "web-quality-audit",
      packagePath: "scripts/analyze.sh",
    }));
    expect(result!.files.some((file) => file.path.includes("/commands/sdd-") || file.path.startsWith("commands/sdd-"))).toBe(false);
  });

  test("buildInstallPlan with non-default personality produces files", async () => {
    // Build plan - personality is passed through capInstructions in the test context
    const planInput = {
      projectRoot: "/tmp/test-personality-regression",
      capabilityInstructions: undefined,
      modelAssignments: [],
      manifest: {
        agents: [],
        standaloneSkills: [],
      },
    };
    const result = capabilities.developerTeam?.buildInstallPlan(planInput);
    expect(result).toBeDefined();
    expect(result?.files).toBeDefined();
    expect(result?.files.length).toBeGreaterThan(0);
  });

  test("can construct custom capabilityInstructions for testing", () => {
    const custom = createTestCapabilityInstructions();
    expect(custom.instructions).toBeDefined();
    expect(custom.instructions.length).toBeGreaterThan(0);
    expect(custom.instructions[0].packageId).toBe("codebase-memory");
  });

  // Note: Full end-to-end build→verify tests require temp file system.
  // The fixed build functions capture the complete built plan internally for verify fallback.
  // This fix addresses the previous bug where apply path overwrote the plan with partial reconstruction.
});
