import { describe, expect, test } from "bun:test";

import { createOpenCodeRunnerCapabilities } from "./runner-capabilities";

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
    expect(typeof capabilities.memory).toBe("object");
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

  test("no imports from @deck/adapter-engram (providers injected at composition time)", () => {
    const source = require("fs").readFileSync(__filename.replace(".test.ts", ".ts"), "utf-8");
    expect(source).not.toContain("@deck/adapter-engram");
  });
});