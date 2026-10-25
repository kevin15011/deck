import { describe, expect, test } from "bun:test";

import {
  DEFAULT_ORCHESTRATOR_PERSONALITY,
  getDefaultDeckConfig,
  type NormalizedDeckConfig,
} from "../../../config/deck-config";
import {
  buildCapabilityInstructionBundle,
  buildCapabilityToolPolicyBundle,
  bindAdaptiveMemoryInstructionBundle,
  composeCapabilityInstructions,
  getEnabledCapabilityInstructionIds,
  getEnabledPackageInstructionIds,
  validateCapabilityInstructionMetadata,
  type CapabilityInstructionBundle,
  type CapabilityInstructionCompositionContext,
} from "./index";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<NormalizedDeckConfig["packageInstructions"]> = {}): NormalizedDeckConfig {
  return {
    ...getDefaultDeckConfig(),
    capabilities: { 'codebase-memory': { enabled: false, runners: Object.fromEntries(Object.entries(overrides).map(([runner, selection]) => [runner, selection?.['codebase-memory'] === true])) } },
    packageInstructions: Object.fromEntries(Object.entries(getDefaultDeckConfig().packageInstructions).map(([runner, selection]) => [runner, { ...selection, 'code-economy': false, rtk: false, 'adaptive-memory': false, ...overrides[runner as keyof typeof overrides] }])),
  } as NormalizedDeckConfig;
}

test("Codex defaults preserve continuing package order and valid surface metadata", () => {
  const config = getDefaultDeckConfig();
  expect(Object.keys(config.packageInstructions.codex)).toEqual(["codebase-memory", "code-economy", "rtk", "adaptive-memory"]);
  expect(getEnabledPackageInstructionIds(config, "codex")).toEqual(["code-economy", "rtk", "adaptive-memory"]);
  const bundle = buildCapabilityInstructionBundle(["serena", "code-economy", "context-mode", "code-economy"]);
  expect([...new Set(bundle.instructions.map((fragment) => fragment.packageId))]).toEqual(["code-economy"]);
  expect(validateCapabilityInstructionMetadata(bundle)).toEqual([]);
});

test("Web Search instructions follow the separate optional capability toggle", () => {
  const config = { ...getDefaultDeckConfig(), webSearch: { enabled: true, provider: "tavily" } };

  expect(getEnabledCapabilityInstructionIds(config, "codex")).toContain("web-search");
  expect(getEnabledCapabilityInstructionIds(getDefaultDeckConfig(), "codex")).not.toContain("web-search");
});

test("instruction metadata validation rejects canonical surface and tool-policy mismatches", () => {
  const canonical = buildCapabilityInstructionBundle(["codebase-memory", "serena"]);
  const changedSurface: CapabilityInstructionBundle = {
    instructions: canonical.instructions.map((fragment, index) => index === 0 ? { ...fragment, surface: "session" } : fragment),
  };
  expect(validateCapabilityInstructionMetadata(changedSurface)).toContainEqual(expect.stringContaining("canonical instruction metadata mismatch"));

  const mismatchedPolicy = { policies: { 'codebase-memory': { packageId: 'codebase-memory' as const, enabledTools: ['injected'], disabledTools: [], targetAgents: ['deck-apply-fast', 'deck-apply-deep'] as const } } };
  expect(validateCapabilityInstructionMetadata(canonical, mismatchedPolicy)).toContainEqual(expect.stringContaining("canonical tool policy mismatch"));
});

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

    expect(bundle.instructions.length).toBe(4); // retired package contributes nothing

    // First 2 should be codebase-memory (agent, skill)
    expect(bundle.instructions[0].packageId).toBe("codebase-memory");
    expect(bundle.instructions[0].surface).toBe("agent");
    expect(bundle.instructions[1].packageId).toBe("codebase-memory");
    expect(bundle.instructions[1].surface).toBe("skill");

    expect(bundle.instructions[2].packageId).toBe("rtk");
    expect(bundle.instructions[2].surface).toBe("agent");
    expect(bundle.instructions[3].packageId).toBe("rtk");
    expect(bundle.instructions[3].surface).toBe("skill");
    expect(bundle.instructions.some(fragment => fragment.packageId === 'context-mode')).toBe(false);
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

  test("code-economy produces fragments with correct packageId and surfaces", () => {
    const bundle = buildCapabilityInstructionBundle(["code-economy"]);

    expect(bundle.instructions.length).toBeGreaterThan(0);
    for (const fragment of bundle.instructions) {
      expect(fragment.packageId).toBe("code-economy");
      expect(fragment.surface).toBeOneOf(["agent", "skill"]);
      expect(fragment.markdown.length).toBeGreaterThan(10);
    }
  });

  test("each fragment has surface, packageId, and non-empty markdown", () => {
    const bundle = buildCapabilityInstructionBundle(["codebase-memory", "code-economy", "context-mode", "rtk"]);

    for (const fragment of bundle.instructions) {
      expect(fragment.packageId).toBeOneOf(["codebase-memory", "code-economy", "context-mode", "rtk"]);
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

  test("rebinds caller-supplied adaptive-memory fragments while preserving unrelated package fragments", () => {
    const callerBundle: CapabilityInstructionBundle = {
      instructions: [
        { packageId: "code-economy", surface: "agent", markdown: "preserve code economy", teamId: "developer-team" },
        { packageId: "adaptive-memory", surface: "agent", markdown: "stale unscoped adaptive memory", teamId: "developer-team" },
        { packageId: "adaptive-memory", surface: "skill", markdown: "No manual containerTag required", teamId: "developer-team" },
        { packageId: "serena", surface: "agent", markdown: "preserve serena", teamId: "developer-team" },
      ],
    };

    const rebound = bindAdaptiveMemoryInstructionBundle(callerBundle, {
      supermemoryProjectScope: "sm_project_v1_kevin15011_deck",
      configuredSupermemoryProjectScope: "sm_project_v1_kevin15011_deck",
    });
    expect(rebound).toBeDefined();
    const text = rebound!.instructions.map((fragment) => fragment.markdown).join("\n");

    expect(text).toContain("preserve code economy");
    expect(text).toContain("preserve serena");
    expect(text).toContain("Runtime-managed recall and capture bind project scope server-side");
    expect(text).toContain("schemas permit model-selected project scope");
    expect(text).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
    expect(text).not.toContain("supermemory_search_memory");
    expect(text).not.toContain("stale unscoped adaptive memory");
    expect(text).not.toContain("No manual containerTag required");
  });

  test("can add fail-closed adaptive-memory guidance when a memory provider is active but scopes are not verified", () => {
    const callerBundle = buildCapabilityInstructionBundle(["code-economy"]);

    const rebound = bindAdaptiveMemoryInstructionBundle(callerBundle, {
      supermemoryProjectScope: "sm_project_v1_kevin15011_deck",
      configuredSupermemoryProjectScope: "sm_project_default",
      includeWhenMissing: true,
    });
    expect(rebound).toBeDefined();
    const text = rebound!.instructions.map((fragment) => fragment.markdown).join("\n");

    expect(text).toContain("Anti-Overengineering Rules");
    expect(text).toContain("Adaptive-memory project operations are disabled");
    expect(text).not.toContain('containerTag: "sm_project_v1_kevin15011_deck"');
    expect(text).not.toContain("sm_project_default");
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
      pi: { "codebase-memory": true, "code-economy": true, "context-mode": false, rtk: true, "adaptive-memory": false, serena: false },
    });

    const ids = getEnabledPackageInstructionIds(config, "pi");
    expect(ids).toEqual(["codebase-memory", "code-economy", "rtk"]);
  });

  test("returns only enabled packages for opencode runner", () => {
    const config = makeConfig({
      opencode: { "codebase-memory": false, "code-economy": true, "context-mode": true, rtk: false, "adaptive-memory": false, serena: false },
    });

    const ids = getEnabledPackageInstructionIds(config, "opencode");
    expect(ids).toEqual(["code-economy"]);
  });

  test("returns empty for unknown runner", () => {
    const config = makeConfig();
    const ids = getEnabledPackageInstructionIds(config, "pi" as any);
    expect(Array.isArray(ids)).toBe(true);
  });

  test("preserves canonical order even when enabled in different order", () => {
    const config = makeConfig({
      pi: { "codebase-memory": true, "context-mode": true, rtk: true, "adaptive-memory": false, serena: false, "code-economy": true },
    });

    const ids = getEnabledPackageInstructionIds(config, "pi");
    // Order should be canonical: codebase-memory, code-economy, context-mode, rtk
    expect(ids).toEqual(["codebase-memory", "code-economy", "rtk"]);
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
    expect(result).not.toContain("Context Mode");
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

// ---------------------------------------------------------------------------
// buildCapabilityToolPolicyBundle
// ---------------------------------------------------------------------------

describe("buildCapabilityToolPolicyBundle", () => {
  test("returns empty bundle when no packages enabled", () => {
    const bundle = buildCapabilityToolPolicyBundle([]);
    expect(bundle.policies).toEqual({});
  });

  test("returns empty policies when serena not in packageIds", () => {
    const bundle = buildCapabilityToolPolicyBundle(["codebase-memory", "context-mode"]);
    expect(bundle.policies.serena).toBeUndefined();
  });

  test("retired selection never creates tool grants, including duplicate legacy IDs", () => {
    for (const ids of [["serena"], ["serena", "serena", "codebase-memory"]] as const) {
      expect(buildCapabilityToolPolicyBundle(ids).policies).toEqual({});
    }
  });
});
