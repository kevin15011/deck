import { describe, expect, test } from "bun:test";

import {
  ALL_PI_RUNNER_CAPABILITY_IDS,
  INTERNAL_CAPABILITY_ENTRIES,
  PI_RUNNER_CAPABILITY_CATALOG,
  PI_RUNNER_CAPABILITY_IDS,
  getPiRunnerCapability,
  getUserFacingCapability,
} from "./capability-catalog";

describe("PI_RUNNER_CAPABILITY_CATALOG", () => {
  test("contains only user-facing capability entries — excludes runner-mermaid (internal)", () => {
    // REQ-DASH-001: runner-mermaid must not appear as a user-facing capability
    expect([...PI_RUNNER_CAPABILITY_IDS].sort()).toEqual([
      "codebase-memory",
      "context-mode",
      "pi-hud",
      "rtk",
    ]);

    const serialized = JSON.stringify(PI_RUNNER_CAPABILITY_CATALOG);
    expect(serialized).not.toContain("runner-mermaid");
    expect(serialized).not.toContain("@juicesharp/rpiv-todo");
    expect(serialized).not.toContain("@juicesharp/rpiv-ask-user-question");
    expect(serialized.toLowerCase()).not.toContain("context7");
    expect(serialized).not.toContain("engram-memory");
  });

  test("does not include legacy packages/context7 in any entry", () => {
    for (const capabilityId of PI_RUNNER_CAPABILITY_IDS) {
      const entry = PI_RUNNER_CAPABILITY_CATALOG[capabilityId];
      expect(entry.source?.toLowerCase() ?? "").not.toContain("context7");
      expect(entry.toolId?.toLowerCase() ?? "").not.toContain("context7");
    }
  });
});

describe("INTERNAL_CAPABILITY_ENTRIES", () => {
  test("contains runner-mermaid as internal only", () => {
    expect(Object.keys(INTERNAL_CAPABILITY_ENTRIES)).toEqual(["runner-mermaid"]);

    const mermaid = INTERNAL_CAPABILITY_ENTRIES["runner-mermaid"];
    expect(mermaid.isInternal).toBe(true);
    expect(mermaid.requirementLevel).toBe("required");
    expect(mermaid.runnerScope).toBe("all");
    expect(mermaid.implementations?.pi?.id).toBe("pi-mermaid");
    expect(mermaid.implementations?.pi?.source).toBe("npm:pi-mermaid");
  });

  test("runner-mermaid is excluded from user-facing capability IDs", () => {
    expect(PI_RUNNER_CAPABILITY_IDS).not.toContain("runner-mermaid");
    // runner-mermaid is in INTERNAL_CAPABILITY_ENTRIES, not PI_RUNNER_CAPABILITY_CATALOG
    expect((INTERNAL_CAPABILITY_ENTRIES["runner-mermaid"] as { isInternal?: boolean }).isInternal).toBe(true);
  });
});

describe("ALL_PI_RUNNER_CAPABILITY_IDS", () => {
  test("includes both user-facing and internal capability IDs", () => {
    expect([...ALL_PI_RUNNER_CAPABILITY_IDS].sort()).toEqual([
      "codebase-memory",
      "context-mode",
      "pi-hud",
      "rtk",
      "runner-mermaid",
    ]);
  });
});

describe("getPiRunnerCapability", () => {
  test("returns capability entry for known IDs including internal", () => {
    const contextMode = getPiRunnerCapability("context-mode");
    expect(contextMode?.capabilityId).toBe("context-mode");

    const mermaid = getPiRunnerCapability("runner-mermaid");
    expect(mermaid?.capabilityId).toBe("runner-mermaid");
    expect((mermaid as { isInternal?: boolean }).isInternal).toBe(true);
  });

  test("returns undefined for unknown capability IDs", () => {
    expect(getPiRunnerCapability("unknown-capability" as CapabilityId)).toBeUndefined();
  });
});

describe("getUserFacingCapability", () => {
  test("returns user-facing entry for known user-facing IDs", () => {
    const contextMode = getUserFacingCapability("context-mode");
    expect(contextMode?.capabilityId).toBe("context-mode");
    expect(contextMode?.isInternal).toBeUndefined();
  });

  test("returns undefined for internal IDs (runner-mermaid)", () => {
    const mermaid = getUserFacingCapability("runner-mermaid");
    expect(mermaid).toBeUndefined();
  });

  test("returns undefined for unknown IDs", () => {
    expect(getUserFacingCapability("unknown" as CapabilityId)).toBeUndefined();
  });
});

describe("PI_RUNNER_CAPABILITY_CATALOG structural regressions", () => {
  test("all user-facing entries expose structural capability metadata", () => {
    for (const capabilityId of PI_RUNNER_CAPABILITY_IDS) {
      const entry = PI_RUNNER_CAPABILITY_CATALOG[capabilityId];
      expect(entry.capabilityId).toBe(capabilityId);
      expect(entry.section).toMatch(/runner-(capabilities|ui-visual-helpers)/);
      expect(entry.runnerScope).toMatch(/^(all|pi|opencode)$/);
      expect(entry.installKind).toMatch(/^(pi-package|external|pending)$/);
      expect(entry.detector).toBeTruthy();
    }

    expect(PI_RUNNER_CAPABILITY_CATALOG["context-mode"]).toEqual(
      expect.objectContaining({ capabilityId: "context-mode", toolId: "context-mode", source: "npm:context-mode" }),
    );
    expect(PI_RUNNER_CAPABILITY_CATALOG.rtk).toEqual(
      expect.objectContaining({ capabilityId: "rtk", toolId: "rtk", source: "rtk-ai/rtk", installKind: "external" }),
    );
  });

  test("pi-hud remains optional Pi-only pending helper", () => {
    const piHud = PI_RUNNER_CAPABILITY_CATALOG["pi-hud"];

    expect(piHud.runnerScope).toBe("pi");
    expect(piHud.requirementLevel).toBe("optional");
    expect(piHud.installKind).toBe("pending");
    expect(piHud.source).toBe("TBD");
  });
});

// Type for test helper
type CapabilityId = "rtk" | "context-mode" | "codebase-memory" | "pi-hud" | "runner-mermaid";