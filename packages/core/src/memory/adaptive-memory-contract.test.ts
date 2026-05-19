import { describe, expect, test } from "bun:test";

import {
  ADAPTIVE_MEMORY_PROVIDER_IDS,
  ADAPTIVE_MEMORY_SCOPES,
  DEFAULT_ADAPTIVE_MEMORY_COMMIT_POLICY,
  createAdaptiveMemoryDiagnostic,
  isAdaptiveMemoryScope,
  mergeAdaptiveMemoryCommitPolicy,
  normalizeAdaptiveMemoryProviderIdentity,
} from "./adaptive-memory-contract";

import type {
  AdaptiveMemoryAdapter,
  AdaptiveMemoryCandidate,
  AdaptiveMemoryContextRequest,
  AdaptiveMemoryProviderIdentity,
} from "./adaptive-memory-contract";

describe("adaptive memory contract", () => {
  test("defines provider-neutral built-in provider identity without MCP tool names", () => {
    expect(ADAPTIVE_MEMORY_PROVIDER_IDS).toEqual(["engram", "supermemory"]);

    const serializedContracts = [
      ...ADAPTIVE_MEMORY_PROVIDER_IDS,
      ...ADAPTIVE_MEMORY_SCOPES,
      DEFAULT_ADAPTIVE_MEMORY_COMMIT_POLICY,
    ].join(" ");

    expect(serializedContracts).not.toContain("execute");
    expect(serializedContracts).not.toContain("search_docs");
  });

  test("normalizes provider identity labels", () => {
    const identity: AdaptiveMemoryProviderIdentity = {
      id: " custom-provider ",
      displayName: " Custom Provider ",
      version: " 1.2.3 ",
    };

    expect(normalizeAdaptiveMemoryProviderIdentity(identity)).toEqual({
      id: "custom-provider",
      displayName: "Custom Provider",
      version: "1.2.3",
    });
  });

  test("exposes supported memory scopes", () => {
    expect(ADAPTIVE_MEMORY_SCOPES).toEqual(["personal", "project", "team", "org"]);
    expect(isAdaptiveMemoryScope("personal")).toBe(true);
    expect(isAdaptiveMemoryScope("workspace")).toBe(false);
  });

  test("creates structured diagnostics for health and operation failures", () => {
    const diagnostic = createAdaptiveMemoryDiagnostic(
      "ADAPTIVE_MEMORY_PROVIDER_UNAVAILABLE",
      "Provider unavailable; continuing without adaptive memory.",
      { providerId: "engram", severity: "error", recoverable: true },
    );

    expect(diagnostic).toEqual({
      code: "ADAPTIVE_MEMORY_PROVIDER_UNAVAILABLE",
      message: "Provider unavailable; continuing without adaptive memory.",
      severity: "error",
      providerId: "engram",
      recoverable: true,
      details: undefined,
    });
  });

  test("defines context/search/commit/configure/health adapter operations", async () => {
    const candidate: AdaptiveMemoryCandidate = {
      content: "User prefers concise implementation summaries.",
      containerTag: "u:user-1",
      highSignal: true,
      scope: { scope: "personal", userId: "user-1" },
      metadata: {
        source: "preference",
        scope: "personal",
        type: "preference",
        confidence: 0.9,
        createdBy: "user",
      },
    };

    const adapter: AdaptiveMemoryAdapter = {
      identity: { id: "engram", displayName: "Engram" },
      async loadContext(request) {
        return { providerId: this.identity.id, items: [], diagnostics: request.limit === 0 ? [] : undefined };
      },
      async search(request) {
        return {
          providerId: this.identity.id,
          items: request.query ? [{ ...candidate, id: "memory-1" }] : [],
        };
      },
      async commit(request) {
        return {
          savedCount: request.candidates.length,
          discardedCount: 0,
          decisions: request.candidates.map((entry) => ({
            accepted: true,
            scope: entry.metadata.scope,
            source: entry.metadata.source,
            reason: "high signal",
          })),
        };
      },
      async configure(_request) {},
      async health() {
        return { providerId: this.identity.id, status: "available" };
      },
    };

    const contextRequest: AdaptiveMemoryContextRequest = {
      phase: "apply",
      scopes: [{ scope: "personal", userId: "user-1" }],
      limit: 5,
    };

    expect((await adapter.loadContext(contextRequest)).items).toEqual([]);
    expect((await adapter.search({ query: "summary style", scopes: contextRequest.scopes })).items).toHaveLength(1);
    expect((await adapter.commit({ candidates: [candidate] })).savedCount).toBe(1);
    await expect(adapter.configure({ providerId: "engram", scopes: contextRequest.scopes })).resolves.toBeUndefined();
    expect((await adapter.health()).status).toBe("available");
  });

  test("merges commit policy defaults with caller overrides", () => {
    expect(mergeAdaptiveMemoryCommitPolicy({ maxMemoriesPerSession: 3 })).toEqual({
      maxMemoriesPerSession: 3,
      preferredMinimumHighSignalMemories: 3,
      requireHighSignal: true,
    });
  });
});
