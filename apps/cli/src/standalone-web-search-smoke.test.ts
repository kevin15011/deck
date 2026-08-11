import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeDeckConfig, type RunnerAdapter } from "@deck/core";
import { inspectStandaloneWebSearchReadiness, isStandaloneWebSearchSmokeSuccessful } from "./standalone-web-search-smoke";

const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "deck-standalone-web-search-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("inspectStandaloneWebSearchReadiness", () => {
  test("resolves the bundled Tavily descriptor and produces a secret-free Pi/OpenCode readiness report", async () => {
    const projectRoot = temporaryRoot();
    writeDeckConfig(projectRoot, { webSearch: { enabled: true, provider: "tavily" } });
    const adapters = ["pi", "opencode"].map((runnerId) => ({
      runnerId,
      environmentIds: [`${runnerId}-development`],
      async getCapabilityInventory() {
        return {
          runnerId,
          environmentId: `${runnerId}-development`,
          capabilities: [{
            capabilityId: "web-search",
            label: "Web Search",
            description: "test",
            section: "runner",
            requirementLevel: "optional" as const,
            installKind: "runner-native" as const,
            isInstalled: false,
            isBlocked: false,
            webSearchReadiness: {
              capabilityId: "web-search" as const,
              enabled: true,
              state: "configured-but-not-materialized" as const,
              code: "mcp-not-materialized" as const,
              diagnostics: [],
            },
          }],
        };
      },
    })) as unknown as RunnerAdapter[];
    const report = await inspectStandaloneWebSearchReadiness({
      projectRoot,
      adapters,
    });

    expect(report).toEqual({
      webSearch: { enabled: true, provider: "tavily" },
      provider: "tavily",
      runners: {
        pi: { state: "configured-but-not-materialized", code: "mcp-not-materialized" },
        opencode: { state: "configured-but-not-materialized", code: "mcp-not-materialized" },
      },
    });
    expect(JSON.stringify(report).includes("credential-value")).toBe(false);
    expect(isStandaloneWebSearchSmokeSuccessful(report)).toBe(true);
  });

  test("requires valid Pi and OpenCode inventory reports and rejects unavailable or malformed readiness", () => {
    expect(isStandaloneWebSearchSmokeSuccessful({
      webSearch: { enabled: true, provider: "tavily" },
      provider: "tavily",
      runners: {
        pi: { state: "enabled-unconfigured", code: "credential-missing" },
      },
    })).toBe(false);
    expect(isStandaloneWebSearchSmokeSuccessful({
      webSearch: { enabled: true, provider: "tavily" },
      provider: "tavily",
      runners: {
        pi: { state: "unavailable", code: "inventory-unavailable" },
        opencode: { state: "enabled-unconfigured", code: "credential-missing" },
      },
    })).toBe(false);
    expect(isStandaloneWebSearchSmokeSuccessful({
      webSearch: { enabled: true, provider: "tavily" },
      provider: "tavily",
      runners: {
        pi: { state: "unknown", code: "credential-missing" },
        opencode: { state: "enabled-unconfigured", code: "credential-missing" },
      },
    })).toBe(false);
  });
});
