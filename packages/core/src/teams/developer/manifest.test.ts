import { describe, expect, test } from "bun:test";

import { buildDeveloperTeamManifest, buildDeveloperTeamManifestLegacy, getCataloguedAgentIds, isManifestModelComplete } from "./manifest";
import type { DeveloperTeamManifest, ManifestBuildResult } from "./manifest";

import { DEVELOPER_TEAM_AGENTS } from "./catalog";
import { buildCapabilityInstructionBundle } from "./instruction-bundles/index";

describe("DeveloperTeamManifest", () => {
  describe("buildDeveloperTeamManifest", () => {
    test("creates a manifest with a team entry", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      expect(result.manifest.team).toBeDefined();
      expect(result.manifest.team.id).toBe("developer-team");
      expect(result.manifest.team.displayName).toBe("Developer Team");
    });

    test("creates a manifest with exactly one agent per Developer Team entry", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      expect(result.manifest.agents.length).toBe(DEVELOPER_TEAM_AGENTS.length);
    });

    test("each agent has required fields", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      for (const agent of result.manifest.agents) {
        expect(typeof agent.agentId).toBe("string");
        expect(typeof agent.displayName).toBe("string");
        expect(typeof agent.instruction).toBe("string");
      }
    });

    test("agents have model assignments from catalog defaults", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      for (const agent of result.manifest.agents) {
        expect(agent.model).toBeTruthy();
      }
    });

    test("each agent in manifest matches a Developer Team catalog entry", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      const catalogIds = new Set(DEVELOPER_TEAM_AGENTS.map((a) => a.id));
      for (const agent of result.manifest.agents) {
        expect(catalogIds.has(agent.agentId)).toBe(true);
      }
    });

    test("creates a manifest with skills", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      expect(result.manifest.skills.length).toBe(DEVELOPER_TEAM_AGENTS.length);
      for (const skill of result.manifest.skills) {
        expect(typeof skill.agentId).toBe("string");
        expect(typeof skill.skillId).toBe("string");
        expect(typeof skill.body).toBe("string");
      }
    });

    test("manifest with no model overrides uses catalog defaults", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      for (const agent of result.manifest.agents) {
        const catalogEntry = DEVELOPER_TEAM_AGENTS.find((a) => a.id === agent.agentId);
        expect(catalogEntry).toBeDefined();
        // model is from catalog defaults
        expect(agent.model).toBeTruthy();
      }
    });

    test("model overrides are respected when provided", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
        modelAssignments: [
          { agentId: "deck-developer-orchestrator", modelId: "custom/model", reasoning: "high" },
        ],
      });

      const orchestrator = result.manifest.agents.find((a) => a.agentId === "deck-developer-orchestrator");
      expect(orchestrator?.model).toBe("custom/model");
      expect(orchestrator?.reasoning).toBe("high");
    });

    test("manifest has empty memory diagnostics by default", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      expect(Array.isArray(result.manifest.memoryDiagnostics)).toBe(true);
      expect(result.manifest.memoryDiagnostics).toHaveLength(0);
    });

    test("manifest passes memory diagnostics through", () => {
      const diagnostics = [
        { code: "test", message: "Test diagnostic", providerId: "test-provider" },
      ];

      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
        memoryDiagnostics: diagnostics,
      });

      expect(result.manifest.memoryDiagnostics).toHaveLength(1);
      expect(result.manifest.memoryDiagnostics[0].code).toBe("test");
    });

    test("returns ManifestBuildResult with empty errors and warnings in non-strict mode", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      expect(result.errors).toBeDefined();
      expect(result.warnings).toBeDefined();
      expect(Array.isArray(result.errors)).toBe(true);
      expect(Array.isArray(result.warnings)).toBe(true);
    });
  });

  describe("buildDeveloperTeamManifestLegacy", () => {
    test("returns DeveloperTeamManifest directly (backward compat)", () => {
      const manifest = buildDeveloperTeamManifestLegacy({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      expect(manifest.team).toBeDefined();
      expect(manifest.team.id).toBe("developer-team");
      expect(manifest.agents.length).toBe(DEVELOPER_TEAM_AGENTS.length);
    });

    test("returns manifest with no errors/warnings exposed", () => {
      const manifest = buildDeveloperTeamManifestLegacy({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      // Legacy returns the manifest directly, not a result object
      expect(manifest.agents).toBeDefined();
      expect((manifest as any).errors).toBeUndefined();
      expect((manifest as any).warnings).toBeUndefined();
    });
  });

  describe("strict mode", () => {
    test("strict:true with known agent produces no errors", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
        strict: true,
      });

      // All agents have real content in the registry
      expect(result.errors).toHaveLength(0);
    });

    test("strict:false (default) produces empty errors and warnings", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
        strict: false,
      });

      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    test("strict:true with unknown model assignment produces error", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
        strict: true,
        modelAssignments: [
          { agentId: "non-existent-agent", modelId: "test/model" },
        ],
      });

      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some(e => e.includes("non-existent-agent"))).toBe(true);
    });

    test("strict:true with memoryBundle and capabilityInstructions produces warning for same surface", () => {
      const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
      // memoryBundle has agent-surface instructions for specific agents
      // capabilityInstructions also has agent-surface instructions (global)
      // Both target agent surface → conflict
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
        strict: true,
        capabilityInstructions: bundle,
        memoryBundle: {
          instructions: [
            {
              surface: "agent",
              markdown: "## Memory instructions for agents",
              agentIds: ["deck-developer-orchestrator"],
            },
          ],
          toolBindings: [],
        },
      });

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some(w => w.includes("Memory and capability both inject"))).toBe(true);
    });
  });

  describe("isManifestModelComplete", () => {
    test("returns true when all agents have model assignments", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      expect(isManifestModelComplete(result.manifest)).toBe(true);
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
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      const manifestStr = JSON.stringify(result.manifest);
      // These patterns indicate runner-specific knowledge baked into core content
      expect(manifestStr).not.toContain("pi-mermaid");
      expect(manifestStr).not.toContain("pi-development");
      expect(manifestStr).not.toContain("opencode-development");
    });
  });

  describe("capabilityInstructions", () => {
    test("manifest without capabilityInstructions produces unchanged agent/skill content", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      // Explorer agent should not have package instruction sections
      const explorer = result.manifest.agents.find((a) => a.agentId === "deck-developer-explorer");
      expect(explorer!.instruction).not.toContain("## Package Instructions");
    });

    test("manifest with capabilityInstructions propagates instructions into agent content", () => {
      const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
        capabilityInstructions: bundle,
      });

      // Explorer agent should have package instruction section
      const explorer = result.manifest.agents.find((a) => a.agentId === "deck-developer-explorer");
      expect(explorer!.instruction).toContain("## Package Instructions (configured)");
      expect(explorer!.instruction).toContain("Codebase Memory");
    });

    test("manifest with capabilityInstructions propagates instructions into skill content", () => {
      const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
        capabilityInstructions: bundle,
      });

      // Explorer skill should have package instruction section
      const explorerSkill = result.manifest.skills.find((s) => s.agentId === "deck-developer-explorer");
      expect(explorerSkill!.body).toContain("## Package Instructions (configured)");
      expect(explorerSkill!.body).toContain("Codebase Memory");
    });

    test("multiple packages produce multiple instruction sections in manifest", () => {
      const bundle = buildCapabilityInstructionBundle(["codebase-memory", "context-mode"]);
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
        capabilityInstructions: bundle,
      });

      const explorer = result.manifest.agents.find((a) => a.agentId === "deck-developer-explorer");
      expect(explorer!.instruction).toContain("Codebase Memory");
      expect(explorer!.instruction).toContain("Context Mode");
    });

    test("memoryBundle and capabilityInstructions coexist in manifest output", () => {
      const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
        capabilityInstructions: bundle,
        memoryBundle: {
          instructions: [],
          toolBindings: [],
        },
      });

      // Both should be present (they coexist independently)
      const explorer = result.manifest.agents.find((a) => a.agentId === "deck-developer-explorer");
      expect(explorer!.memoryBundle).toBeDefined();
      expect(explorer!.instruction).toContain("## Package Instructions");
    });

    test("empty bundle does not inject instructions", () => {
      const bundle = buildCapabilityInstructionBundle([]);
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
        capabilityInstructions: bundle,
      });

      // With empty bundle, no instructions should be injected
      const explorer = result.manifest.agents.find((a) => a.agentId === "deck-developer-explorer");
      expect(explorer!.instruction).not.toContain("## Package Instructions");
    });

    test("all agents receive capability instructions when bundle is provided", () => {
      const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
        capabilityInstructions: bundle,
      });

      for (const agent of result.manifest.agents) {
        expect(agent.instruction).toContain("## Package Instructions (configured)");
      }
    });
  });

  // ---------------------------------------------------------------------------
  // Orchestrator Invariants in manifest — REQ-IBC-001, REQ-IBC-002, REQ-IBC-003
  // ---------------------------------------------------------------------------

  describe("buildDeveloperTeamManifest with orchestrator invariants", () => {
    test("orchestrator agent instruction contains invariant section", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      const orchestrator = result.manifest.agents.find(
        (a) => a.agentId === "deck-developer-orchestrator",
      );
      expect(orchestrator).toBeDefined();
      expect(orchestrator!.instruction).toContain("## Orchestrator Invariants");
      expect(orchestrator!.instruction).toContain("INV-001");
      expect(orchestrator!.instruction).toContain("INV-002");
      expect(orchestrator!.instruction).toContain("INV-003");
      expect(orchestrator!.instruction).toContain("INV-004");
      expect(orchestrator!.instruction).toContain("INV-005");
      expect(orchestrator!.instruction).toContain("INV-006");
    });

    test("orchestrator skill contains invariant section", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      const orchestratorSkill = result.manifest.skills.find(
        (s) => s.agentId === "deck-developer-orchestrator",
      );
      expect(orchestratorSkill).toBeDefined();
      expect(orchestratorSkill!.body).toContain("## Orchestrator Invariants");
      expect(orchestratorSkill!.body).toContain("INV-001");
      expect(orchestratorSkill!.body).toContain("INV-002");
      expect(orchestratorSkill!.body).toContain("INV-003");
      expect(orchestratorSkill!.body).toContain("INV-004");
      expect(orchestratorSkill!.body).toContain("INV-006");
    });

    test("non-orchestrator agents do NOT contain invariant section", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      const nonOrchestrators = result.manifest.agents.filter(
        (a) => a.agentId !== "deck-developer-orchestrator",
      );
      for (const agent of nonOrchestrators) {
        expect(agent.instruction, `${agent.agentId} should NOT contain invariants`).not.toContain(
          "## Orchestrator Invariants",
        );
      }
    });

    test("manifest content is runner-neutral — no Pi/OpenCode in invariant text", () => {
      const result = buildDeveloperTeamManifest({
        team: { id: "developer-team", displayName: "Developer Team" },
      });

      // All invariant text should be runner-neutral
      const orchestrator = result.manifest.agents.find(
        (a) => a.agentId === "deck-developer-orchestrator",
      )!;
      expect(orchestrator.instruction).not.toContain("Pi");
      expect(orchestrator.instruction).not.toContain("OpenCode");
      expect(orchestrator.instruction).not.toContain("opencode");

      const orchestratorSkill = result.manifest.skills.find(
        (s) => s.agentId === "deck-developer-orchestrator",
      )!;
      expect(orchestratorSkill.body).not.toContain("Pi");
      expect(orchestratorSkill.body).not.toContain("OpenCode");
      expect(orchestratorSkill.body).not.toContain("opencode");
    });
  });
});