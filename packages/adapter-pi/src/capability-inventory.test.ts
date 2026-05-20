import { describe, expect, test } from "bun:test";

import { buildPiRunnerCapabilityInventory } from "./capability-inventory";
import type { PiRequiredToolsReview } from "./required-tools";
import { createToolStatus } from "./tool-status";

function makeReview(installedPackages: string[] = []): PiRequiredToolsReview {
  const names = ["sub-agents", "MCP packages", "context-mode", "codebase-memory", "RTK", "Context7", "Engram memory"];
  return {
    installedPackages,
    requiredTools: names.map((name) => ({
      name,
      installed: installedPackages.some((pkg) => normalize(pkg) === normalize(name)),
    })),
    tools: names.map((name) => {
      const installed = installedPackages.some((pkg) => normalize(pkg) === normalize(name));
      return createToolStatus(name, installed ? "found" : "missing", installed ? "configured" : "missing");
    }),
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

describe("buildPiRunnerCapabilityInventory — user-facing capabilities", () => {
  test("maps installed package capabilities to ready and missing external capabilities to manual", () => {
    const inventory = buildPiRunnerCapabilityInventory(makeReview(["context-mode"]), undefined, {
      runnerScope: "pi",
    });

    expect(inventory["context-mode"]?.status).toBe("ready");
    expect(inventory["context-mode"]?.installed).toBe(true);
    expect(inventory.rtk?.status).toBe("manual");
    expect(inventory.rtk?.installed).toBe(false);
    expect(inventory["codebase-memory"]?.status).toBe("manual");
  });

  test("keeps pi-hud pending-source for Pi and omits it for OpenCode", () => {
    const piInventory = buildPiRunnerCapabilityInventory(makeReview(), undefined, { runnerScope: "pi" });
    const opencodeInventory = buildPiRunnerCapabilityInventory(makeReview(), undefined, { runnerScope: "opencode" });

    expect(piInventory["pi-hud"]?.status).toBe("pending-source");
    expect(piInventory["pi-hud"]?.installed).toBe(false);
    expect(opencodeInventory["pi-hud"]).toBeUndefined();
  });
});

describe("buildPiRunnerCapabilityInventory — runner-mermaid exclusion (REQ-DASH-001)", () => {
  test("runner-mermaid is NOT in user-facing inventory for Pi", () => {
    const inventory = buildPiRunnerCapabilityInventory(makeReview(), undefined, { runnerScope: "pi" });

    expect(inventory["runner-mermaid"]).toBeUndefined();
  });

  test("runner-mermaid is NOT in user-facing inventory for OpenCode", () => {
    const inventory = buildPiRunnerCapabilityInventory(makeReview(), undefined, { runnerScope: "opencode" });

    expect(inventory["runner-mermaid"]).toBeUndefined();
  });

  test("installing pi-mermaid explicitly does NOT surface runner-mermaid as pending-source", () => {
    // REQ-DASH-001: runner-mermaid must not appear as pending-source
    // REQ-PIINSTALL-002: pi-mermaid detection is internal
    const inventory = buildPiRunnerCapabilityInventory(
      makeReview(["pi-mermaid", "pi-hud"]),
      undefined,
      { runnerScope: "pi" },
    );

    expect(inventory["runner-mermaid"]).toBeUndefined();
    expect(inventory["pi-hud"]?.status).toBe("pending-source");
  });
});

describe("buildPiRunnerCapabilityInventory — internal pi-mermaid detection (REQ-PIINSTALL-001)", () => {
  test("pi-mermaid detected as ready when present in installedPackages", () => {
    // Internal entry key is "runner-mermaid" (capability ID), mapped from "pi-mermaid" package ID
    const inventory = buildPiRunnerCapabilityInventory(
      makeReview(["context-mode", "pi-mermaid"]),
      undefined,
      { runnerScope: "pi", includeInternal: true },
    );

    expect(inventory._internal?.["runner-mermaid"]).toBeDefined();
    expect(inventory._internal?.["runner-mermaid"]?.status).toBe("ready");
    expect(inventory._internal?.["runner-mermaid"]?.installed).toBe(true);
    expect(inventory._internal?.["runner-mermaid"]?.implementationId).toBe("pi-mermaid");
    expect(inventory._internal?.["runner-mermaid"]?.source).toBe("npm:pi-mermaid");
  });

  test("pi-mermaid detected as missing when absent from review", () => {
    const inventory = buildPiRunnerCapabilityInventory(makeReview(), undefined, {
      runnerScope: "pi",
      includeInternal: true,
    });

    expect(inventory._internal?.["runner-mermaid"]).toBeDefined();
    expect(inventory._internal?.["runner-mermaid"]?.status).toBe("missing");
    expect(inventory._internal?.["runner-mermaid"]?.installed).toBe(false);
  });

  test("pi-mermaid detected as ready via npm:pi-mermaid normalized name", () => {
    const inventory = buildPiRunnerCapabilityInventory(
      makeReview(["context-mode", "npm:pi-mermaid"]),
      undefined,
      { runnerScope: "pi", includeInternal: true },
    );

    expect(inventory._internal?.["runner-mermaid"]?.status).toBe("ready");
    expect(inventory._internal?.["runner-mermaid"]?.installed).toBe(true);
  });

  test("internal pi-mermaid entry is absent for OpenCode scope", () => {
    const inventory = buildPiRunnerCapabilityInventory(makeReview(), undefined, {
      runnerScope: "opencode",
      includeInternal: true,
    });

    // Internal detection only applies to pi scope
    expect(inventory._internal).toBeUndefined();
  });

  test("internal pi-mermaid entry is absent when includeInternal is false", () => {
    const inventory = buildPiRunnerCapabilityInventory(makeReview(), undefined, {
      runnerScope: "pi",
      includeInternal: false,
    });

    expect(inventory._internal).toBeUndefined();
  });
});

describe("buildPiRunnerCapabilityInventory — no pending-source or blocked status for visual support", () => {
  test("user-facing inventory does not contain runner-mermaid with pending-source", () => {
    // REQ-DASH-001: Mermaid must not appear as pending-source in user-facing inventory
    const inventory = buildPiRunnerCapabilityInventory(
      makeReview(["pi-mermaid", "pi-hud"]),
      undefined,
      { runnerScope: "pi" },
    );

    expect(inventory["runner-mermaid"]).toBeUndefined();
    // pi-hud is still pending-source (expected, not visual support)
    expect(inventory["pi-hud"]?.status).toBe("pending-source");
  });

  test("user-facing inventory does not contain runner-mermaid with blocked", () => {
    const inventory = buildPiRunnerCapabilityInventory(makeReview(), undefined, { runnerScope: "opencode" });

    expect(inventory["runner-mermaid"]).toBeUndefined();
  });
});