import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import {
  WEB_SEARCH_CAPABILITY_ID,
  WEB_SEARCH_ROLE_POLICY_V1,
  WEB_SEARCH_SEMANTIC_CONTRACT_V1,
  renderWebSearchInstructions,
  resolveWebSearchReadiness,
} from "./web-search-capability";
import {
  getCanonicalCapability,
  getRunnerCapabilityMapping,
} from "./runner-capability-registry";
import { resolveRunnerParity } from "./runner-capability-parity";
import {
  buildCapabilityInstructionBundle,
  composeCapabilityInstructions,
  getAgentContent,
  getTeamSessionInstructions,
} from "./index";
import { validateDeckConfig, writeDeckConfigFileAtomic } from "./config/deck-config";
import { mkdirSync, mkdtempSync, readFileSync as readFile, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("canonical web-search capability", () => {
  test("is optional, runner-neutral, and requires all semantic materialization surfaces", () => {
    const capability = getCanonicalCapability(WEB_SEARCH_CAPABILITY_ID);

    expect(capability).toMatchObject({
      id: "web-search",
      category: "mcps",
      requirement: "optional",
      userFacing: true,
      requiredSurfaces: ["agent", "skill", "session", "mcp", "install"],
    });
    expect(capability).not.toHaveProperty("sharedBinary");
    expect(readFileSync(new URL("./web-search-capability.ts", import.meta.url), "utf8")).not.toMatch(/tavily|TAVILY_API_KEY|tavily_search|tavily_extract/i);
  });

  test("resolves disabled, incomplete, not-materialized, ready, and unsupported states", () => {
    expect(resolveWebSearchReadiness({
      enabled: false,
      runnerSupported: true,
      providerConfigured: false,
      credentialAvailable: false,
      executableAvailable: false,
      mcpConfigured: false,
    })).toMatchObject({ state: "disabled" });

    expect(resolveWebSearchReadiness({
      enabled: true,
      runnerSupported: true,
      providerConfigured: true,
      credentialAvailable: false,
      executableAvailable: true,
      mcpConfigured: false,
    })).toMatchObject({ state: "enabled-unconfigured", code: "credential-missing" });

    expect(resolveWebSearchReadiness({
      enabled: true,
      runnerSupported: true,
      providerConfigured: true,
      credentialAvailable: true,
      executableAvailable: true,
      mcpConfigured: false,
    })).toMatchObject({ state: "configured-but-not-materialized", code: "mcp-not-materialized" });

    expect(resolveWebSearchReadiness({
      enabled: true,
      runnerSupported: true,
      providerConfigured: true,
      credentialAvailable: true,
      executableAvailable: true,
      mcpConfigured: true,
    })).toMatchObject({ state: "ready", code: "ready" });

    expect(resolveWebSearchReadiness({
      enabled: true,
      runnerSupported: false,
      providerConfigured: true,
      credentialAvailable: true,
      executableAvailable: true,
      mcpConfigured: false,
    })).toMatchObject({ state: "unsupported", code: "unsupported-runner" });
  });

  test("parity reports unsupported instead of silently treating an unregistered runner as ready", () => {
    const report = resolveRunnerParity("claude", {
      webSearch: {
        enabled: true,
        providerConfigured: true,
        credentialAvailable: true,
        executableAvailable: true,
        mcpConfigured: false,
      },
    });

    expect(report.capabilities.find((entry) => entry.capabilityId === "web-search")).toMatchObject({
      status: "unsupported",
      code: "capability-unsupported",
    });
  });

  test("adapter contributions expose supported parity without moving provider metadata into Core", async () => {
    const [{ PI_RUNNER_CAPABILITY_CONTRIBUTION }, { OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION }, { CODEX_RUNNER_CAPABILITY_CONTRIBUTION }] = await Promise.all([
      import("@deck/adapter-pi"),
      import("@deck/adapter-opencode"),
      import("@deck/adapter-codex"),
    ]);

    for (const [runner, contribution] of [
      ["pi", PI_RUNNER_CAPABILITY_CONTRIBUTION],
      ["opencode", OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION],
      ["codex", CODEX_RUNNER_CAPABILITY_CONTRIBUTION],
    ] as const) {
      expect(getRunnerCapabilityMapping(WEB_SEARCH_CAPABILITY_ID, runner, [contribution])).toMatchObject({
        capabilityId: "web-search",
        runnerId: runner,
        status: "supported",
      });
    }
  });
});

describe("provider-neutral web-search semantic contract", () => {
  test("covers compact selection, provenance, quality, freshness, role policy, priorities, and safety", () => {
    expect(WEB_SEARCH_SEMANTIC_CONTRACT_V1.operations).toEqual(["search", "extract"]);
    expect(WEB_SEARCH_SEMANTIC_CONTRACT_V1.sourceSelection.maxSearchResults).toBeLessThanOrEqual(8);
    expect(WEB_SEARCH_SEMANTIC_CONTRACT_V1.sourceSelection.maxSelectedSources).toBeLessThanOrEqual(3);
    expect(WEB_SEARCH_SEMANTIC_CONTRACT_V1.provenance.requiredFields).toEqual(expect.arrayContaining([
      "url",
      "title",
      "provider",
      "retrievedAt",
    ]));
    expect(WEB_SEARCH_SEMANTIC_CONTRACT_V1.sourceQualityOrder.slice(0, 2)).toEqual(["repository", "context7"]);
    expect(WEB_SEARCH_SEMANTIC_CONTRACT_V1.freshness).toMatchObject({
      recordRetrievalTime: true,
      preferRecentForVolatileClaims: true,
    });
    expect(Object.keys(WEB_SEARCH_ROLE_POLICY_V1)).toEqual(expect.arrayContaining([
      "Lead",
      "Investigate",
      "Architect",
      "Apply Fast",
      "Apply Deep",
      "Quality",
      "Setup",
    ]));

    const rendered = renderWebSearchInstructions();
    expect(rendered).toMatch(/search|extract/i);
    expect(rendered).toMatch(/repository|Context7/i);
    expect(rendered).toMatch(/provenance|retrieval time|freshness/i);
    expect(rendered).toMatch(/untrusted|prompt injection|secret/i);
    expect(rendered).toMatch(/crawl|map|research/i);
    expect(rendered).not.toMatch(/tavily|TAVILY_API_KEY|tavily_search|tavily_extract/i);
  });

  test("is composed into session and role content only when selected", () => {
    const bundle = buildCapabilityInstructionBundle(["web-search"]);
    const session = getTeamSessionInstructions("developer-team", { capabilityInstructions: bundle });
    const investigate = getAgentContent("deck-investigate", { capabilityInstructions: bundle });
    const applyFast = getAgentContent("deck-apply-fast", { capabilityInstructions: bundle });

    expect(session).toContain("Web Search");
    expect(investigate?.agentBody).toContain("Web Search");
    expect(applyFast?.skillBody).toContain("untrusted");
    expect(getTeamSessionInstructions("developer-team")).not.toContain("Web Search");
  });

  test("filters role guidance to canonical Developer Team agents and skills", () => {
    const bundle = buildCapabilityInstructionBundle(["web-search"]);

    const investigate = composeCapabilityInstructions("base", bundle, {
      surface: "agent",
      teamId: "developer-team",
      agentId: "deck-investigate",
    });
    const applyFast = composeCapabilityInstructions("base", bundle, {
      surface: "skill",
      teamId: "developer-team",
      skillId: "deck-apply-fast",
    });
    const unrelated = composeCapabilityInstructions("base", bundle, {
      surface: "skill",
      skillId: "idea-refine",
    });
    const bootstrap = composeCapabilityInstructions("base", bundle, {
      surface: "skill",
      skillId: "deck-onboard",
    });

    expect(investigate).toContain("Primary web-search consumer");
    expect(investigate).not.toContain("Use only for a focused current-doc");
    expect(applyFast).toContain("focused current-doc");
    expect(unrelated).toBe("base");
    expect(bootstrap).toBe("base");
  });

  test("keeps optional readiness visible without turning it into a global runner blocker", async () => {
    const [{ PI_RUNNER_CAPABILITY_CONTRIBUTION }, { OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION }, { CODEX_RUNNER_CAPABILITY_CONTRIBUTION }] = await Promise.all([
      import("@deck/adapter-pi"),
      import("@deck/adapter-opencode"),
      import("@deck/adapter-codex"),
    ]);
    const contributions = {
      pi: [PI_RUNNER_CAPABILITY_CONTRIBUTION],
      opencode: [OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION],
      codex: [CODEX_RUNNER_CAPABILITY_CONTRIBUTION],
    } as const;
    for (const runnerId of ["pi", "opencode", "codex"] as const) {
      const incomplete = resolveRunnerParity(runnerId, {
        webSearch: {
          enabled: true,
          runnerSupported: true,
          providerConfigured: true,
          credentialAvailable: true,
          executableAvailable: true,
          mcpConfigured: false,
        },
      }, contributions[runnerId]);
      expect(incomplete.blockers.some((entry) => entry.capabilityId === "web-search")).toBe(false);
      expect(incomplete.gaps).toContainEqual(expect.objectContaining({ capabilityId: "web-search", status: "configured-but-not-materialized" }));

      const conflict = resolveRunnerParity(runnerId, {
        webSearch: {
          enabled: true,
          runnerSupported: true,
          providerConfigured: true,
          credentialAvailable: true,
          executableAvailable: true,
          mcpConfigured: false,
          mcpConfigConflict: true,
        },
      }, contributions[runnerId]);
      expect(conflict.blockers.some((entry) => entry.capabilityId === "web-search")).toBe(false);
      expect(conflict.gaps).toContainEqual(expect.objectContaining({ capabilityId: "web-search", status: "configured-but-not-materialized" }));
    }
  });

  test("keeps provider metadata out of every Core production source", () => {
    const sourceRoot = new URL(".", import.meta.url);
    const visit = (url: URL): string[] => {
      const paths = readdirSync(url, { withFileTypes: true });
      return paths.flatMap((entry) => {
        const child = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, url);
        if (entry.isDirectory()) return visit(child);
        return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")
          ? [readFileSync(child, "utf8")]
          : [];
      });
    };

    expect(visit(sourceRoot).join("\n")).not.toMatch(/tavily|TAVILY_API_KEY|tavily_search|tavily_extract/i);
  });
});

describe("web-search configuration", () => {
  test("defaults disabled and keeps opaque provider selection out of Core validation", () => {
    expect(validateDeckConfig({}).webSearch).toEqual({ enabled: false });
    expect(validateDeckConfig({ webSearch: { enabled: true, provider: "future-provider" } }).webSearch).toEqual({
      enabled: true,
      provider: "future-provider",
    });
  });

  test("never persists a credential-shaped field or credential value", () => {
    const root = mkdtempSync(join(tmpdir(), "deck-web-search-config-"));
    try {
      expect(() => validateDeckConfig({ webSearch: { enabled: true, apiKey: "do-not-store" } })).toThrow();
      const xdg = join(root, "xdg");
      const configPath = join(xdg, "deck", "config.json");
      mkdirSync(join(xdg, "deck"), { recursive: true });
      const normalized = writeDeckConfigFileAtomic(configPath, { webSearch: { enabled: true, provider: "tavily" } }, { containmentRoot: xdg, expectedDigest: null });
      const snapshot = readFile(configPath);
      expect(snapshot).not.toContain("TAVILY_API_KEY");
      expect(snapshot).not.toContain("do-not-store");
      expect(normalized.webSearch).toEqual({ enabled: true, provider: "tavily" });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
