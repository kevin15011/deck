import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPiRunnerCapabilities } from "./runner-capabilities";
import { buildDeveloperTeamManifest } from "../../core/src/teams/developer/manifest";

describe("Pi RunnerCapabilities factory", () => {
  const capabilities = createPiRunnerCapabilities();

  test("returns an object satisfying RunnerCapabilities type", () => {
    expect(capabilities).toBeDefined();
    expect(typeof capabilities.id).toBe("string");
    expect(typeof capabilities.displayName).toBe("string");
    expect(Array.isArray(capabilities.environments)).toBe(true);
    expect(typeof capabilities.inspectEnvironment).toBe("function");
    expect(typeof capabilities.tools).toBe("object");
    expect(typeof capabilities.teams).toBe("object");
    expect(typeof capabilities.models).toBe("object");
    expect(typeof capabilities.memory).toBe("object");
  });

  test("has id 'pi'", () => {
    expect(capabilities.id).toBe("pi");
  });

  test("has displayName 'Pi'", () => {
    expect(capabilities.displayName).toBe("Pi");
  });

  test("has pi-development environment", () => {
    expect(capabilities.environments).toHaveLength(1);
    expect(capabilities.environments[0].id).toBe("pi-development");
    expect(capabilities.environments[0].displayName).toBe("Pi Development");
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

  test("memory facet has required methods", () => {
    expect(typeof capabilities.memory.getProviders).toBe("function");
    expect(typeof capabilities.memory.getSupportedProviderIds).toBe("function");
  });

  test("getSupportedProviderIds returns memory provider IDs", () => {
    const ids = capabilities.memory.getSupportedProviderIds();
    expect(Array.isArray(ids)).toBe(true);
    expect(ids).toContain("engram");
    expect(ids).toContain("supermemory");
  });

  test("getTeamsForEnvironment returns teams for pi-development", () => {
    const teams = capabilities.teams.getTeamsForEnvironment("pi-development");
    expect(Array.isArray(teams)).toBe(true);
    expect(teams.length).toBeGreaterThan(0);
  });

  test("getTeamsForEnvironment returns empty for unknown environment", () => {
    const teams = capabilities.teams.getTeamsForEnvironment("unknown");
    expect(Array.isArray(teams)).toBe(true);
    expect(teams).toHaveLength(0);
  });

  test("getTeamsForEnvironment returns empty for opencode-development", () => {
    const teams = capabilities.teams.getTeamsForEnvironment("opencode-development");
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

  test("no imports from @deck/adapter-opencode (cross-adapter contamination)", () => {
    const source = require("fs").readFileSync(__filename.replace(".test.ts", ".ts"), "utf-8");
    expect(source).not.toContain("@deck/adapter-opencode");
  });

  test("no imports from @deck/adapter-supermemory (cross-adapter contamination)", () => {
    const source = require("fs").readFileSync(__filename.replace(".test.ts", ".ts"), "utf-8");
    expect(source).not.toContain("@deck/adapter-supermemory");
  });

  test("no imports from @deck/adapter-engram (providers injected at composition time)", () => {
    const source = require("fs").readFileSync(__filename.replace(".test.ts", ".ts"), "utf-8");
    expect(source).not.toContain("@deck/adapter-engram");
  });

  test("buildInstallPlan preserves all standalone package files with metadata", () => {
    const manifest = buildDeveloperTeamManifest({
      team: { id: "developer-team", displayName: "Developer Team" },
    }).manifest;
    const result = capabilities.teams.buildDeveloperTeamInstallPlan({
      projectRoot: "/tmp/test-standalone-packages",
      environmentId: "pi-development",
      manifest,
    });

    expect(result).toBeDefined();
    const standaloneFiles = result!.files.filter((file) => file.kind === "standalone-skill");
    const standaloneSkillIds = new Set(standaloneFiles.map((file) => file.skillId));
    expect(standaloneSkillIds.size).toBe(29);
    expect(standaloneSkillIds.has("frontend-design")).toBe(true);
    expect(standaloneSkillIds.has("web-quality-audit")).toBe(true);
    expect(standaloneFiles).toContainEqual(expect.objectContaining({
      path: ".pi/skills/web-quality-audit/scripts/analyze.sh",
      kind: "standalone-skill",
      skillId: "web-quality-audit",
      packagePath: "scripts/analyze.sh",
    }));
    expect(result!.files.some((file) => file.path.includes("/commands/sdd-") || file.path.startsWith("commands/sdd-"))).toBe(false);
  });

  test("capability verify checks standalone support files under ~/.pi/agent", async () => {
    const home = mkdtempSync(join(tmpdir(), "deck-pi-capability-home-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-pi-capability-project-"));
    const previousHome = process.env.HOME;
    process.env.HOME = home;

    try {
      const plan = capabilities.developerTeam!.buildInstallPlan({ projectRoot });
      await capabilities.developerTeam!.applyInstall({
        projectRoot,
        environmentId: "pi-development",
        plan,
      });

      const supportFile = join(home, ".pi", "agent", "skills", "web-quality-audit", "scripts", "analyze.sh");
      expect(existsSync(supportFile)).toBe(true);
      writeFileSync(supportFile, "stale support file", "utf-8");

      const result = await capabilities.developerTeam!.verifyInstall({
        projectRoot,
        environmentId: "pi-development",
      });

      expect(result.valid).toBe(false);
      expect(result.skillResults).toContainEqual({ agentId: "web-quality-audit", valid: false });
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      rmSync(home, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test("capability backup reads standalone support files from ~/.pi/agent", async () => {
    const home = mkdtempSync(join(tmpdir(), "deck-pi-capability-home-"));
    const projectRoot = mkdtempSync(join(tmpdir(), "deck-pi-capability-project-"));
    const previousHome = process.env.HOME;
    process.env.HOME = home;

    try {
      const plan = capabilities.developerTeam!.buildInstallPlan({ projectRoot });
      await capabilities.developerTeam!.applyInstall({
        projectRoot,
        environmentId: "pi-development",
        plan,
      });

      const supportFile = join(home, ".pi", "agent", "skills", "web-quality-audit", "scripts", "analyze.sh");
      writeFileSync(supportFile, "existing support file", "utf-8");

      const backup = capabilities.developerTeam!.backupFiles(plan);
      expect(backup.files).toContainEqual(expect.objectContaining({
        path: supportFile,
        originalContent: "existing support file",
      }));
      expect(readFileSync(supportFile, "utf-8")).toBe("existing support file");
    } finally {
      if (previousHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = previousHome;
      }
      rmSync(home, { recursive: true, force: true });
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
