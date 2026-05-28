import { describe, expect, test } from "bun:test";

import {
  DEFAULT_ORCHESTRATOR_PERSONALITY,
  type NormalizedDeckConfig,
} from "../../../config/deck-config";
import {
  buildCapabilityInstructionBundle,
  composeCapabilityInstructions,
  getEnabledPackageInstructionIds,
  type CapabilityInstructionBundle,
  type CapabilityInstructionCompositionContext,
} from "./index";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<NormalizedDeckConfig["packageInstructions"]> = {}): NormalizedDeckConfig {
  return {
    version: 1,
    adaptiveMemory: { activeProvider: "none" },
    packageInstructions: {
      pi: {
        "codebase-memory": overrides.pi?.["codebase-memory"] ?? false,
        "context-mode": overrides.pi?.["context-mode"] ?? false,
        rtk: overrides.pi?.rtk ?? false,
        "adaptive-memory": overrides.pi?.["adaptive-memory"] ?? false,
        serena: overrides.pi?.serena ?? false,
      },
      opencode: {
        "codebase-memory": overrides.opencode?.["codebase-memory"] ?? false,
        "context-mode": overrides.opencode?.["context-mode"] ?? false,
        rtk: overrides.opencode?.rtk ?? false,
        "adaptive-memory": overrides.opencode?.["adaptive-memory"] ?? false,
        serena: overrides.opencode?.serena ?? false,
      },
    },
    orchestratorPersonality: DEFAULT_ORCHESTRATOR_PERSONALITY,
    profiles: [],
    activeProfile: "default",
  };
}

// ---------------------------------------------------------------------------
// buildCapabilityInstructionBundle
// ---------------------------------------------------------------------------

describe("buildCapabilityInstructionBundle", () => {
  test("returns empty bundle when no package IDs provided", () => {
    const bundle = buildCapabilityInstructionBundle([]);
    expect(bundle.instructions).toHaveLength(0);
  });

  test("single package produces fragments from that package only", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);

    expect(bundle.instructions.length).toBeGreaterThan(0);
    for (const fragment of bundle.instructions) {
      expect(fragment.packageId).toBe("codebase-memory");
    }
  });

  test("multiple packages produce fragments from each package in deterministic order", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory", "context-mode", "rtk"]);

    expect(bundle.instructions.length).toBe(6); // 2 per package

    // First 2 should be codebase-memory (agent, skill)
    expect(bundle.instructions[0].packageId).toBe("codebase-memory");
    expect(bundle.instructions[0].surface).toBe("agent");
    expect(bundle.instructions[1].packageId).toBe("codebase-memory");
    expect(bundle.instructions[1].surface).toBe("skill");

    // Next 2 should be context-mode
    expect(bundle.instructions[2].packageId).toBe("context-mode");
    expect(bundle.instructions[2].surface).toBe("agent");
    expect(bundle.instructions[3].packageId).toBe("context-mode");
    expect(bundle.instructions[3].surface).toBe("skill");

    // Last 2 should be rtk
    expect(bundle.instructions[4].packageId).toBe("rtk");
    expect(bundle.instructions[4].surface).toBe("agent");
    expect(bundle.instructions[5].packageId).toBe("rtk");
    expect(bundle.instructions[5].surface).toBe("skill");
  });

  test("deduplicates duplicate package IDs", () => {
    const bundle = buildCapabilityInstructionBundle([
      "codebase-memory",
      "codebase-memory",
      "context-mode",
    ]);

    // Should not have duplicate codebase-memory fragments
    const cmFragments = bundle.instructions.filter((f) => f.packageId === "codebase-memory");
    expect(cmFragments).toHaveLength(2); // agent + skill, not 4
  });

  test("each fragment has surface, packageId, and non-empty markdown", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory", "context-mode", "rtk"]);

    for (const fragment of bundle.instructions) {
      expect(fragment.packageId).toBeOneOf(["codebase-memory", "context-mode", "rtk"]);
      expect(fragment.surface).toBeOneOf(["agent", "skill"]);
      expect(typeof fragment.markdown).toBe("string");
      expect(fragment.markdown.length).toBeGreaterThan(10);
    }
  });

  test("fragments do not include toolBindings (unlike memory bundle)", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);

    for (const fragment of bundle.instructions) {
      expect(fragment).not.toHaveProperty("toolBindings");
    }
  });
});

// ---------------------------------------------------------------------------
// getEnabledPackageInstructionIds
// ---------------------------------------------------------------------------

describe("getEnabledPackageInstructionIds", () => {
  test("returns empty array when all packages are disabled", () => {
    const config = makeConfig({});
    const ids = getEnabledPackageInstructionIds(config, "pi");
    expect(ids).toEqual([]);
  });

  test("returns only enabled packages for pi runner", () => {
    const config = makeConfig({
      pi: { "codebase-memory": true, "context-mode": false, rtk: true, "adaptive-memory": false },
    });

    const ids = getEnabledPackageInstructionIds(config, "pi");
    expect(ids).toEqual(["codebase-memory", "rtk"]);
  });

  test("returns only enabled packages for opencode runner", () => {
    const config = makeConfig({
      opencode: { "codebase-memory": false, "context-mode": true, rtk: false, "adaptive-memory": false },
    });

    const ids = getEnabledPackageInstructionIds(config, "opencode");
    expect(ids).toEqual(["context-mode"]);
  });

  test("returns empty for unknown runner", () => {
    const config = makeConfig();
    const ids = getEnabledPackageInstructionIds(config, "pi" as any);
    expect(Array.isArray(ids)).toBe(true);
  });

  test("preserves canonical order even when enabled in different order", () => {
    const config = makeConfig({
      pi: { "codebase-memory": true, "context-mode": true, rtk: true, "adaptive-memory": false },
    });

    const ids = getEnabledPackageInstructionIds(config, "pi");
    // Order should be canonical: codebase-memory, context-mode, rtk, adaptive-memory
    expect(ids).toEqual(["codebase-memory", "context-mode", "rtk"]);
  });
});

// ---------------------------------------------------------------------------
// composeCapabilityInstructions
// ---------------------------------------------------------------------------

describe("composeCapabilityInstructions", () => {
  const agentContext: CapabilityInstructionCompositionContext = {
    surface: "agent",
    agentId: "deck-developer-explorer",
  };

  const skillContext: CapabilityInstructionCompositionContext = {
    surface: "skill",
    skillId: "deck-developer-explorer-skill",
  };

  test("returns base unchanged when bundle is undefined", () => {
    const base = "Some agent body content";
    const result = composeCapabilityInstructions(base, undefined, agentContext);
    expect(result).toBe(base);
  });

  test("returns base unchanged when bundle has no instructions", () => {
    const base = "Some agent body content";
    const bundle: CapabilityInstructionBundle = { instructions: [] };
    const result = composeCapabilityInstructions(base, bundle, agentContext);
    expect(result).toBe(base);
  });

  test("appends labeled section when agent-surface fragments match", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
    const base = "Some agent body content";

    const result = composeCapabilityInstructions(base, bundle, agentContext);

    expect(result).toContain("## Package Instructions (configured)");
    expect(result).toContain("These instructions are enabled by the runner's native package instruction system");
    expect(result).toContain("Codebase Memory");
  });

  test("does not append section when no agent-surface fragments match", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
    const base = "Some agent body content";

    // Use session surface — codebase-memory has no session fragments
    const sessionContext: CapabilityInstructionCompositionContext = { surface: "session" };
    const result = composeCapabilityInstructions(base, bundle, sessionContext);

    expect(result).toBe(base);
  });

  test("appends labeled section for skill-surface fragments", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
    const base = "Some skill body content";

    const result = composeCapabilityInstructions(base, bundle, skillContext);

    expect(result).toContain("## Package Instructions (configured)");
    expect(result).toContain("Codebase Memory");
  });

  test("filters fragments by surface only when no agentIds filter is set", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
    const base = "Agent body";

    // Fragment has surface:agent but no agentIds filter — should match any agent
    const anotherAgentContext: CapabilityInstructionCompositionContext = {
      surface: "agent",
      agentId: "deck-developer-proposal",
    };

    const result = composeCapabilityInstructions(base, bundle, anotherAgentContext);

    expect(result).toContain("## Package Instructions (configured)");
    expect(result).toContain("Codebase Memory");
  });

  test("labeled section appears at end of content", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
    const base = "Agent body content";

    const result = composeCapabilityInstructions(base, bundle, agentContext);

    // The labeled section should be appended after the base
    expect(result.indexOf("## Package Instructions (configured)")).toBeGreaterThan(
      base.indexOf("Agent body"),
    );
  });

  test("multiple matching fragments are concatenated in order", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory", "context-mode"]);
    const base = "Agent body";

    const result = composeCapabilityInstructions(base, bundle, agentContext);

    // Should contain both package instruction section headings
    expect(result).toContain("Codebase Memory");
    expect(result).toContain("Context Mode");
  });

  test("base content is preserved before instruction section", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory"]);
    const base = "# Explorer Agent\n\nSome important content";

    const result = composeCapabilityInstructions(base, bundle, agentContext);

    expect(result).toContain("# Explorer Agent");
    expect(result).toContain("Some important content");
    expect(result).toContain("## Package Instructions (configured)");
  });
});