import { describe, expect, test } from "bun:test";

import { buildOpenCodeRunnerCapabilityInventory } from "./capability-inventory";
import type { OpenCodeToolsReview } from "./required-tools";
import { resolveWebSearchReadiness } from "@deck/core";

function review(overrides: Partial<OpenCodeToolsReview> = {}): OpenCodeToolsReview {
  return {
    installedPackages: [],
    tools: [
      { name: "RTK", installed: false },
      { name: "context-mode", installed: false },
      { name: "codebase-memory", installed: false },
      { name: "Context7", installed: false },
    ],
    toolStatuses: [],
    ...overrides,
  };
}

describe("buildOpenCodeRunnerCapabilityInventory", () => {
  test("marks command-backed capability ready only for usable evidence", () => {
    const inventory = buildOpenCodeRunnerCapabilityInventory(review({
      installedPackages: ["codebase-memory-mcp"],
      evidence: {
        "codebase-memory": {
          toolId: "codebase-memory",
          state: "absent",
          source: "absent",
          reasonCodes: ["declaration-only", "no-evidence"],
        },
      },
    }));

    expect(inventory["codebase-memory"]?.installed).toBe(false);
    expect(inventory["codebase-memory"]?.status).toBe("missing");
  });

  test("preserves usable evidence and plugin/config-only compatibility", () => {
    const inventory = buildOpenCodeRunnerCapabilityInventory(review({
      installedPackages: ["opencode-mermaid-renderer", "context-mode"],
      evidence: {
        "codebase-memory": {
          toolId: "codebase-memory",
          state: "usable",
          source: "canonical-target",
          reasonCodes: ["canonical-target-usable"],
        },
        "context-mode": {
          toolId: "context-mode",
          state: "declared",
          source: "configured",
          reasonCodes: ["declaration-only"],
        },
      },
    }), { includeInternal: true });

    expect(inventory["codebase-memory"]?.installed).toBe(true);
    expect(inventory["codebase-memory"]?.status).toBe("ready");
    expect(inventory["context-mode"]?.installed).toBe(false);
    expect(inventory._internal?.["opencode-mermaid"]?.status).toBe("ready");
  });

  test("projects Web Search readiness without provider values", () => {
    const evidence = {
      enabled: true,
      runnerSupported: true,
      providerConfigured: true,
      credentialAvailable: true,
      executableAvailable: true,
      mcpConfigured: true,
    } as const;
    const readiness = resolveWebSearchReadiness(evidence);
    const inventory = buildOpenCodeRunnerCapabilityInventory(review(), {
      webSearch: { readiness, evidence },
    });

    expect(inventory["web-search"]).toMatchObject({ installed: true, status: "ready" });
    expect(inventory["web-search"]?.webSearchReadiness).toMatchObject({ state: "ready" });
  });
});
