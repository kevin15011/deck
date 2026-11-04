import { describe, expect, test } from "bun:test";
import { createRunnerCapabilityRegistry, createRunnerParityContributions } from "./runner-capability-registry";
import { composeRunnerCapabilityContributions } from "@deck/core";

describe("runner-capability-registry", () => {
  test("composes all real adapter parity contributions without collisions or order dependence", () => {
    const contributions = createRunnerParityContributions();
    const forward = composeRunnerCapabilityContributions(contributions);
    const reversed = composeRunnerCapabilityContributions([...contributions].reverse());
    expect(reversed).toEqual(forward);
  });

  describe("createRunnerCapabilityRegistry", () => {
    test("creates registry with pi runner capabilities", () => {
      const catalog = createRunnerCapabilityRegistry();
      const pi = catalog.runners["pi"];

      expect(pi).toBeDefined();
      expect(pi.id).toBe("pi");
      expect(pi.displayName).toBe("Pi");
      expect(typeof pi.inspectEnvironment).toBe("function");
      expect(pi.environments).toContainEqual(expect.objectContaining({ id: "pi-development" }));
    });

    test("creates registry with opencode runner capabilities", () => {
      const catalog = createRunnerCapabilityRegistry();
      const opencode = catalog.runners["opencode"];

      expect(opencode).toBeDefined();
      expect(opencode.id).toBe("opencode");
      expect(opencode.displayName).toBe("OpenCode");
      expect(typeof opencode.inspectEnvironment).toBe("function");
      expect(opencode.environments).toContainEqual(expect.objectContaining({ id: "opencode-development" }));
    });

    test("catalog contains both runners", () => {
      const catalog = createRunnerCapabilityRegistry();
      const runnerIds = Object.keys(catalog.runners);

      expect(runnerIds).toContain("pi");
      expect(runnerIds).toContain("opencode");
      expect(runnerIds.length).toBe(2);
    });

    test("each runner has all required capability facets", () => {
      const catalog = createRunnerCapabilityRegistry();

      for (const runner of Object.values(catalog.runners)) {
        expect(runner).toHaveProperty("tools");
        expect(runner).toHaveProperty("teams");
        expect(runner).toHaveProperty("models");

        // Tool capabilities
        expect(typeof runner.tools.buildInstallationPlan).toBe("function");
        expect(typeof runner.tools.installTools).toBe("function");
        expect(typeof runner.tools.reviewTools).toBe("function");

        // Team capabilities
        expect(typeof runner.teams.getTeamsForEnvironment).toBe("function");
        expect(typeof runner.teams.buildDeveloperTeamManifest).toBe("function");
        expect(typeof runner.teams.buildDeveloperTeamInstallPlan).toBe("function");
        expect(typeof runner.teams.applyDeveloperTeamInstall).toBe("function");
        expect(typeof runner.teams.verifyDeveloperTeamInstall).toBe("function");

        // Model capabilities
        expect(typeof runner.models.getCatalog).toBe("function");
        expect(typeof runner.models.readAssignments).toBe("function");
        expect(typeof runner.models.resolveAssignment).toBe("function");

      }
    });

    test("catalog exposes runner IDs", () => {
      const catalog = createRunnerCapabilityRegistry();
      expect(catalog.runnerIds).toEqual(["pi", "opencode"]);
    });

    test("catalog exposes only the reviewed Web Search provider", () => {
      const catalog = createRunnerCapabilityRegistry();

      expect(catalog.webSearchProviderIds).toEqual(["tavily"]);
      expect(catalog.getWebSearchProvider("tavily")).toMatchObject({
        providerId: "tavily",
        implementationId: "tavily-mcp",
      });
      expect(catalog.getWebSearchProvider("future-provider")).toBeUndefined();
    });
  });

  describe("catalog lookup", () => {
    test("getRunner returns runner by ID", () => {
      const catalog = createRunnerCapabilityRegistry();
      const pi = catalog.getRunner("pi");

      expect(pi).toBeDefined();
      expect(pi?.id).toBe("pi");
    });

    test("getRunner returns undefined for unknown runner", () => {
      const catalog = createRunnerCapabilityRegistry();
      const unknown = catalog.getRunner("unknown");

      expect(unknown).toBeUndefined();
    });

    test("hasRunner returns true for known runner", () => {
      const catalog = createRunnerCapabilityRegistry();
      expect(catalog.hasRunner("pi")).toBe(true);
      expect(catalog.hasRunner("opencode")).toBe(true);
    });

    test("hasRunner returns false for unknown runner", () => {
      const catalog = createRunnerCapabilityRegistry();
      expect(catalog.hasRunner("unknown")).toBe(false);
    });
  });
});
