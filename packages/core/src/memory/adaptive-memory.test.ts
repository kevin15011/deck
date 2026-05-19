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

function createTestEngramProvider(): AdaptiveMemoryProvider {
  return {
    id: "engram",
    displayName: "Engram",
    buildInjection: (context): MemoryInjectionBundle => ({
      instructions: [
        {
          surface: "session",
          teamId: context.teamId,
          markdown:
            "Use Engram only for auxiliary cross-session recall; OpenSpec remains authoritative.",
        },
        {
          surface: "agent",
          teamId: context.teamId,
          agentIds: ["deck-developer-orchestrator"],
          markdown: "Search Engram before delegating if runtime memory is enabled.",
        },
        {
          surface: "skill",
          teamId: context.teamId,
          skillIds: ["deck-developer-spec"],
          markdown: "Write a concise Engram summary only after OpenSpec artifacts exist.",
        },
      ],
      toolBindings: [
        {
          capability: "memory.search",
          serverName: "engram",
          toolNames: ["memory_search"],
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
    const provider = createTestEngramProvider();
    const bundle = provider.buildInjection({ teamId: "developer-team" });

    const result = composeAdaptiveMemory(baseContent, bundle, {
      surface: "session",
      teamId: "developer-team",
    });

    expect(result.content).toContain(baseContent);
    expect(result.content).toContain(ADAPTIVE_MEMORY_SECTION_HEADING);
    expect(result.content).toContain("Use Engram only for auxiliary cross-session recall");
    expect(result.content).not.toContain("Search Engram before delegating");
    expect(result.content).not.toContain("Write a concise Engram summary");
  });

  test("filters fragments by session, agent, and skill surfaces", () => {
    const bundle = createTestEngramProvider().buildInjection({
      teamId: "developer-team",
    });

    const agentResult = composeAdaptiveMemory(baseContent, bundle, {
      surface: "agent",
      teamId: "developer-team",
      agentId: "deck-developer-orchestrator",
    });
    expect(agentResult.content).toContain("Search Engram before delegating");
    expect(agentResult.content).not.toContain("Use Engram only");
    expect(agentResult.content).not.toContain("Write a concise Engram summary");

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
    expect(skillResult.content).toContain("Write a concise Engram summary");
    expect(skillResult.content).not.toContain("Use Engram only");
    expect(skillResult.content).not.toContain("Search Engram before delegating");
  });

  test("passes provider tool bindings through when fragments match", () => {
    const bundle = createTestEngramProvider().buildInjection({
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
        { capability: "memory.search", serverName: "engram", toolNames: ["memory_search"] },
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
    const providerBundle = createTestEngramProvider().buildInjection({
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

  test("resolves a supported Engram provider successfully", () => {
    const provider = createTestEngramProvider();
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
      supportedProviderIds: ["engram"],
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
      id: "engram",
      displayName: "Broken Engram",
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
    expect(diagnostics[0].providerId).toBe("engram");
    expect(diagnostics[0].message).toContain("init failed");
  });

  test("memoryInjection takes precedence over memoryProvider", () => {
    const preBuilt: MemoryInjectionBundle = {
      instructions: [
        { surface: "session", markdown: "Pre-built content.", teamId: "developer-team" },
      ],
      toolBindings: [],
    };
    const provider = createTestEngramProvider();

    const { bundle, diagnostics } = resolveMemoryInjection({
      memoryInjection: preBuilt,
      memoryProvider: provider,
    });
    expect(bundle).toBe(preBuilt);
    expect(diagnostics).toEqual([]);
  });

  test("rejects provider by default when no caller registry is injected", () => {
    const provider = createTestEngramProvider();

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
  test("recognizes Supermemory when caller registry supports it", () => {
    const provider: AdaptiveMemoryProvider = {
      id: "supermemory",
      displayName: "Supermemory MCP",
      buildInjection: () => ({
        instructions: [{ surface: "session", teamId: "developer-team", markdown: "Use Supermemory advisory context." }],
        toolBindings: [{ capability: "memory.search", serverName: "supermemory", toolNames: ["execute", "search_docs"] }],
      }),
    };

    const { bundle, diagnostics } = resolveMemoryInjection({
      memoryProvider: provider,
      supportedProviderIds: ["engram", "supermemory"],
      buildContext: { teamId: "developer-team" },
    });

    expect(diagnostics).toEqual([]);
    expect(bundle?.toolBindings[0].serverName).toBe("supermemory");
  });

  test("fails closed when more than one provider is active", () => {
    const provider = createTestEngramProvider();
    const supermemory: AdaptiveMemoryProvider = {
      id: "supermemory",
      displayName: "Supermemory MCP",
      buildInjection: () => ({ instructions: [], toolBindings: [] }),
    };

    const { bundle, diagnostics } = resolveMemoryInjection({
      memoryProviders: [provider, supermemory],
      supportedProviderIds: ["engram", "supermemory"],
    });

    expect(bundle).toBeUndefined();
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].code).toBe("multiple_memory_providers");
  });

  test("collects provider health diagnostics without blocking injection", async () => {
    const provider: AdaptiveMemoryProvider = {
      id: "supermemory",
      displayName: "Supermemory MCP",
      buildInjection: () => ({ instructions: [], toolBindings: [] }),
      health: () => ({
        providerId: "supermemory",
        status: "degraded",
        diagnostics: [{
          code: "ADAPTIVE_MEMORY_HEALTH_UNKNOWN",
          severity: "warning",
          message: "Authenticated runtime probe has not run.",
          providerId: "supermemory",
          recoverable: true,
        }],
      }),
    };

    const { bundle, diagnostics } = resolveMemoryInjection({
      memoryProvider: provider,
      supportedProviderIds: ["supermemory"],
    });
    expect(bundle).toBeDefined();
    expect(diagnostics).toEqual([]);

    const health = await import("./adaptive-memory").then((m) => m.collectMemoryProviderHealthDiagnostics(provider));
    expect(health?.status).toBe("degraded");
    expect(health?.diagnostics?.[0].code).toBe("ADAPTIVE_MEMORY_HEALTH_UNKNOWN");
  });
});
