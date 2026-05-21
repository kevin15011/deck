import { describe, expect, test } from "bun:test";

import { buildDeveloperTeamManifest, getCataloguedAgentIds, isManifestModelComplete } from "./manifest";
import type { DeveloperTeamManifest } from "./manifest";

import { DEVELOPER_TEAM_AGENTS } from "./catalog";

describe("DeveloperTeamManifest", () => {
  describe("buildDeveloperTeamManifest", () => {
    test("creates a manifest with a team entry", () => {
      const manifest = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      expect(manifest.team).toBeDefined();
      expect(manifest.team.id).toBe("developer-team");
      expect(manifest.team.displayName).toBe("Developer Team");
    });

    test("creates a manifest with exactly one agent per Developer Team entry", () => {
      const manifest = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      expect(manifest.agents.length).toBe(DEVELOPER_TEAM_AGENTS.length);
    });

    test("each agent has required fields", () => {
      const manifest = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      for (const agent of manifest.agents) {
        expect(typeof agent.agentId).toBe("string");
        expect(typeof agent.displayName).toBe("string");
        expect(typeof agent.instruction).toBe("string");
      }
    });

    test("agents have model assignments from catalog defaults", () => {
      const manifest = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      for (const agent of manifest.agents) {
        expect(agent.model).toBeTruthy();
      }
    });

    test("each agent in manifest matches a Developer Team catalog entry", () => {
      const manifest = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      const catalogIds = new Set(DEVELOPER_TEAM_AGENTS.map((a) => a.id));
      for (const agent of manifest.agents) {
        expect(catalogIds.has(agent.agentId)).toBe(true);
      }
    });

    test("creates a manifest with skills", () => {
      const manifest = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      expect(manifest.skills.length).toBe(DEVELOPER_TEAM_AGENTS.length);
      for (const skill of manifest.skills) {
        expect(typeof skill.agentId).toBe("string");
        expect(typeof skill.skillId).toBe("string");
        expect(typeof skill.body).toBe("string");
      }
    });

    test("manifest with no model overrides uses catalog defaults", () => {
      const manifest = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      for (const agent of manifest.agents) {
        const catalogEntry = DEVELOPER_TEAM_AGENTS.find((a) => a.id === agent.agentId);
        expect(catalogEntry).toBeDefined();
        // model is from catalog defaults
        expect(agent.model).toBeTruthy();
      }
    });

    test("model overrides are respected when provided", () => {
      const manifest = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
        modelAssignments: [
          { agentId: "deck-developer-orchestrator", modelId: "custom/model", reasoning: "high" },
        ],
      });

      const orchestrator = manifest.agents.find((a) => a.agentId === "deck-developer-orchestrator");
      expect(orchestrator?.model).toBe("custom/model");
      expect(orchestrator?.reasoning).toBe("high");
    });

    test("manifest has empty memory diagnostics by default", () => {
      const manifest = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      expect(Array.isArray(manifest.memoryDiagnostics)).toBe(true);
      expect(manifest.memoryDiagnostics).toHaveLength(0);
    });

    test("manifest passes memory diagnostics through", () => {
      const diagnostics = [
        { code: "test", message: "Test diagnostic", providerId: "test-provider" },
      ];

      const manifest = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
        memoryDiagnostics: diagnostics,
      });

      expect(manifest.memoryDiagnostics).toHaveLength(1);
      expect(manifest.memoryDiagnostics[0].code).toBe("test");
    });
  });

  describe("isManifestModelComplete", () => {
    test("returns true when all agents have model assignments", () => {
      const manifest = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      expect(isManifestModelComplete(manifest)).toBe(true);
    });

    test("returns false when any agent lacks a model", () => {
      const manifest: DeveloperTeamManifest = {
        team: { id: "developer-team", displayName: "Developer Team" },
        agents: [
          { agentId: "deck-developer-orchestrator", displayName: "Orchestrator", instruction: "test", model: "test/model" },
          { agentId: "deck-developer-explorer", displayName: "Explorer", instruction: "test" }, // no model
        ],
        skills: [],
        memoryDiagnostics: [],
      };

      expect(isManifestModelComplete(manifest)).toBe(false);
    });
  });

  describe("getCataloguedAgentIds", () => {
    test("returns all Developer Team agent IDs", () => {
      const ids = getCataloguedAgentIds();
      expect(ids).toHaveLength(DEVELOPER_TEAM_AGENTS.length);

      for (const agent of DEVELOPER_TEAM_AGENTS) {
        expect(ids).toContain(agent.id);
      }
    });
  });

  describe("builder is runner-neutral", () => {
    test("manifest does not contain pi-mermaid or runner-specific package names", () => {
      const manifest = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      const manifestStr = JSON.stringify(manifest);
      // These patterns indicate runner-specific knowledge baked into core content
      expect(manifestStr).not.toContain("pi-mermaid");
      expect(manifestStr).not.toContain("pi-development");
      expect(manifestStr).not.toContain("opencode-development");
    });
  });
});