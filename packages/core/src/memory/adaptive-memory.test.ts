import { describe, expect, test } from "bun:test";

import {
  ADAPTIVE_MEMORY_AUXILIARY_POLICY,
  ADAPTIVE_MEMORY_SECTION_HEADING,
  type AdaptiveMemoryProvider,
  composeAdaptiveMemory,
  type MemoryInjectionBundle,
  resolveMemoryInjection,
} from "./adaptive-memory";

const baseContent = "# Developer Team\n\nBase instructions.";

function createTestMemoryProvider(id: string): AdaptiveMemoryProvider {
  return {
    id,
    displayName: `${id} Provider`,
    buildInjection: (context): MemoryInjectionBundle => ({
      instructions: [
        {
          surface: "session",
          teamId: context.teamId,
          markdown: `Use ${id} only for auxiliary cross-session recall.`,
        },
        {
          surface: "agent",
          teamId: context.teamId,
          agentIds: ["deck-developer-orchestrator"],
          markdown: `Search ${id} before delegating.`,
        },
        {
          surface: "skill",
          teamId: context.teamId,
          skillIds: ["deck-developer-spec"],
          markdown: `Write ${id} summary only after artifacts exist.`,
        },
      ],
      toolBindings: [
        {
          capability: "memory.search",
          serverName: id,
          toolNames: [`${id}_search`],
        },
      ],
    }),
  };
}

describe("composeAdaptiveMemory", () => {
  test("leaves content and tool bindings unchanged when memory is disabled", () => {
    const result = composeAdaptiveMemory(baseContent, undefined, {
      surface: "session",
      teamId: "developer-team",
    });

    expect(result.content).toBe(baseContent);
    expect(result.content).not.toContain(ADAPTIVE_MEMORY_SECTION_HEADING);
    expect(result.toolBindings).toEqual([]);
  });

  test("composes a single provider fragment for the requested surface", () => {
    const provider = createTestMemoryProvider("mock-provider");
    const bundle = provider.buildInjection({ teamId: "developer-team" });

    const result = composeAdaptiveMemory(baseContent, bundle, {
      surface: "session",
      teamId: "developer-team",
    });

    expect(result.content).toContain(baseContent);
    expect(result.content).toContain(ADAPTIVE_MEMORY_SECTION_HEADING);
    expect(result.content).toContain("Use mock-provider only for auxiliary cross-session recall");
    expect(result.content).not.toContain("Search mock-provider before delegating");
    expect(result.content).not.toContain("Write a concise mock-provider summary");
  });

  test("filters fragments by session, agent, and skill surfaces", () => {
    const bundle = createTestMemoryProvider("mock-provider").buildInjection({
      teamId: "developer-team",
    });

    const agentResult = composeAdaptiveMemory(baseContent, bundle, {
      surface: "agent",
      teamId: "developer-team",
      agentId: "deck-developer-orchestrator",
    });
    expect(agentResult.content).toContain("Search mock-provider before delegating");
    expect(agentResult.content).not.toContain("Use mock-provider only");
    expect(agentResult.content).not.toContain("Write a concise mock-provider summary");

    const otherAgentResult = composeAdaptiveMemory(baseContent, bundle, {
      surface: "agent",
      teamId: "developer-team",
      agentId: "deck-developer-spec",
    });
    expect(otherAgentResult.content).toBe(baseContent);
    expect(otherAgentResult.content).not.toContain(ADAPTIVE_MEMORY_SECTION_HEADING);

    const skillResult = composeAdaptiveMemory(baseContent, bundle, {
      surface: "skill",
      teamId: "developer-team",
      skillId: "deck-developer-spec",
    });
    expect(skillResult.content).toContain("Write mock-provider summary only after artifacts exist.");
    expect(skillResult.content).not.toContain("Use mock-provider only");
    expect(skillResult.content).not.toContain("Search mock-provider before delegating");
  });

  test("passes provider tool bindings through when fragments match", () => {
    const bundle = createTestMemoryProvider("mock-provider").buildInjection({
      teamId: "developer-team",
    });

    const result = composeAdaptiveMemory(baseContent, bundle, {
      surface: "session",
      teamId: "developer-team",
    });

    expect(result.toolBindings).toBe(bundle.toolBindings);
  });

  test("returns empty tool bindings when no fragments match the target surface", () => {
    // Bundle with only agent fragments; requesting session surface
    const bundle: MemoryInjectionBundle = {
      instructions: [
        {
          surface: "agent",
          markdown: "Agent-only instructions.",
          teamId: "developer-team",
        },
      ],
      toolBindings: [
        { capability: "memory.search", serverName: "mock-provider", toolNames: ["mock_search"] },
      ],
    };

    const result = composeAdaptiveMemory(baseContent, bundle, {
      surface: "session",
      teamId: "developer-team",
    });

    // No matching fragments -> no section, no tool bindings
    expect(result.content).toBe(baseContent);
    expect(result.toolBindings).toEqual([]);
  });

  test("enforces the auxiliary memory policy in composed output", () => {
    const providerBundle = createTestMemoryProvider("mock-provider").buildInjection({
      teamId: "developer-team",
    });

    const result = composeAdaptiveMemory(baseContent, providerBundle, {
      surface: "session",
      teamId: "developer-team",
    });

    expect(result.content).toContain(ADAPTIVE_MEMORY_AUXILIARY_POLICY);
    expect(result.content).toMatch(/Memory is auxiliary/i);
    expect(result.content).toMatch(/OpenSpec artifacts/i);
    expect(result.content).toMatch(/Spec Registry entries/i);
  });
});

describe("resolveMemoryInjection", () => {
  test("returns undefined bundle and no diagnostics when no options are provided", () => {
    const { bundle, diagnostics } = resolveMemoryInjection(undefined);
    expect(bundle).toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  test("returns pre-built bundle when memoryInjection is provided", () => {
    const preBuilt: MemoryInjectionBundle = {
      instructions: [
        { surface: "session", markdown: "Pre-built injection.", teamId: "developer-team" },
      ],
      toolBindings: [],
    };

    const { bundle, diagnostics } = resolveMemoryInjection({ memoryInjection: preBuilt });
    expect(bundle).toBe(preBuilt);
    expect(diagnostics).toEqual([]);
  });

  test("returns undefined bundle and no diagnostics when no provider or injection", () => {
    const { bundle, diagnostics } = resolveMemoryInjection({});
    expect(bundle).toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  test("resolves a supported mock provider successfully", () => {
    const provider = createTestMemoryProvider("mock-provider");
    const { bundle, diagnostics } = resolveMemoryInjection({
      memoryProvider: provider,
      supportedProviderIds: [provider.id],
      buildContext: { teamId: "developer-team" },
    });
    expect(bundle).toBeDefined();
    expect(bundle!.instructions.length).toBeGreaterThan(0);
    expect(diagnostics).toEqual([]);
  });

  test("rejects unsupported provider ID with unsupported_memory_provider diagnostic", () => {
    const unsupported: AdaptiveMemoryProvider = {
      id: "unknown-provider",
      displayName: "Unknown",
      buildInjection: () => ({
        instructions: [{ surface: "session", markdown: "Should not be injected.", teamId: "developer-team" }],
        toolBindings: [],
      }),
    };

    const { bundle, diagnostics } = resolveMemoryInjection({
      memoryProvider: unsupported,
      supportedProviderIds: ["mock-provider"],
      buildContext: { teamId: "developer-team" },
    });
    expect(bundle).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("unsupported_memory_provider");
    expect(diagnostics[0].providerId).toBe("unknown-provider");
    expect(diagnostics[0].message).toContain("Unsupported memory provider");
  });

  test("produces memory_provider_unavailable diagnostic when provider buildInjection throws", () => {
    const broken: AdaptiveMemoryProvider = {
      id: "mock-provider",
      displayName: "Broken Mock Provider",
      buildInjection: () => {
        throw new Error("init failed");
      },
    };

    const { bundle, diagnostics } = resolveMemoryInjection({
      memoryProvider: broken,
      supportedProviderIds: [broken.id],
      buildContext: { teamId: "developer-team" },
    });
    expect(bundle).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("memory_provider_unavailable");
    expect(diagnostics[0].providerId).toBe("mock-provider");
    expect(diagnostics[0].message).toContain("init failed");
  });

  test("memoryInjection takes precedence over memoryProvider", () => {
    const preBuilt: MemoryInjectionBundle = {
      instructions: [
        { surface: "session", markdown: "Pre-built content.", teamId: "developer-team" },
      ],
      toolBindings: [],
    };
    const provider = createTestMemoryProvider("mock-provider");

    const { bundle, diagnostics } = resolveMemoryInjection({
      memoryInjection: preBuilt,
      memoryProvider: provider,
    });
    expect(bundle).toBe(preBuilt);
    expect(diagnostics).toEqual([]);
  });

  test("rejects provider by default when no caller registry is injected", () => {
    const provider = createTestMemoryProvider("mock-provider");

    const { bundle, diagnostics } = resolveMemoryInjection({ memoryProvider: provider });
    expect(bundle).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("unsupported_memory_provider");
    expect(diagnostics[0].providerId).toBe(provider.id);
  });

  test("rejects provider with empty ID", () => {
    const emptyId: AdaptiveMemoryProvider = {
      id: "",
      displayName: "Empty",
      buildInjection: () => ({ instructions: [], toolBindings: [] }),
    };

    const { bundle, diagnostics } = resolveMemoryInjection({ memoryProvider: emptyId });
    expect(bundle).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("unsupported_memory_provider");
  });
});
describe("extended adaptive memory provider resolution", () => {
  test("resolves a provider when caller registry supports its ID", () => {
    const provider: AdaptiveMemoryProvider = {
      id: "test-provider",
      displayName: "Test Provider",
      buildInjection: () => ({
        instructions: [{ surface: "session", teamId: "developer-team", markdown: "Use test provider advisory context." }],
        toolBindings: [{ capability: "memory.search", serverName: "test-provider", toolNames: ["test_search"] }],
      }),
    };

    const { bundle, diagnostics } = resolveMemoryInjection({
      memoryProvider: provider,
      supportedProviderIds: ["test-provider", "another-provider"],
      buildContext: { teamId: "developer-team" },
    });

    expect(diagnostics).toEqual([]);
    expect(bundle?.toolBindings[0].serverName).toBe("test-provider");
  });

  test("fails closed when more than one provider is active", () => {
    const provider = createTestMemoryProvider("mock-provider");
    const otherProvider: AdaptiveMemoryProvider = {
      id: "another-provider",
      displayName: "Another Provider",
      buildInjection: () => ({ instructions: [], toolBindings: [] }),
    };

    const { bundle, diagnostics } = resolveMemoryInjection({
      memoryProviders: [provider, otherProvider],
      supportedProviderIds: ["mock-provider", "another-provider"],
    });

    expect(bundle).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("multiple_memory_providers");
  });

  test("collects provider health diagnostics without blocking injection", async () => {
    const provider: AdaptiveMemoryProvider = {
      id: "mock-provider",
      displayName: "Mock Provider",
      buildInjection: () => ({ instructions: [], toolBindings: [] }),
      health: () => ({
        providerId: "mock-provider",
        status: "degraded",
        diagnostics: [{
          code: "ADAPTIVE_MEMORY_HEALTH_UNKNOWN",
          severity: "warning",
          message: "Authenticated runtime probe has not run.",
          providerId: "mock-provider",
          recoverable: true,
        }],
      }),
    };

    const { bundle, diagnostics } = resolveMemoryInjection({
      memoryProvider: provider,
      supportedProviderIds: ["mock-provider"],
    });
    expect(bundle).toBeDefined();
    expect(diagnostics).toEqual([]);

    const health = await import("./adaptive-memory").then((m) => m.collectMemoryProviderHealthDiagnostics(provider));
    expect(health?.status).toBe("degraded");
    expect(health?.diagnostics?.[0].code).toBe("ADAPTIVE_MEMORY_HEALTH_UNKNOWN");
  });
});
