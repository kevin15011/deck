import { describe, expect, test } from "bun:test";

import {
  PI_RUNNER_CAPABILITY_CATALOG,
  PI_RUNNER_CAPABILITY_IDS,
} from "./capability-catalog";

describe("PI_RUNNER_CAPABILITY_CATALOG", () => {
  test("contains only dashboard capability entries and excludes legacy packages/context7", () => {
    expect([...PI_RUNNER_CAPABILITY_IDS].sort()).toEqual([
      "codebase-memory",
      "context-mode",
      "pi-hud",
      "rtk",
      "runner-mermaid",
    ]);

    const serialized = JSON.stringify(PI_RUNNER_CAPABILITY_CATALOG);
    expect(serialized).not.toContain("@juicesharp/rpiv-todo");
    expect(serialized).not.toContain("@juicesharp/rpiv-ask-user-question");
    expect(serialized.toLowerCase()).not.toContain("context7");
    expect(serialized).not.toContain("engram-memory");
  });

  test("models Mermaid as required runner capability with Pi implementation pi-mermaid", () => {
    const mermaid = PI_RUNNER_CAPABILITY_CATALOG["runner-mermaid"];

    expect(mermaid.requirementLevel).toBe("required");
    expect(mermaid.runnerScope).toBe("all");
    expect(mermaid.installKind).toBe("pending");
    expect(mermaid.source).toBe("TBD");
    expect(mermaid.implementations?.pi?.id).toBe("pi-mermaid");
    expect(mermaid.implementations?.pi?.installKind).toBe("pending");
    expect(mermaid.implementations?.opencode?.id).toBe("TBD");
  });

  test("models pi-hud as optional Pi-only pending helper", () => {
    const piHud = PI_RUNNER_CAPABILITY_CATALOG["pi-hud"];

    expect(piHud.runnerScope).toBe("pi");
    expect(piHud.requirementLevel).toBe("optional");
    expect(piHud.installKind).toBe("pending");
    expect(piHud.source).toBe("TBD");
  });
});

describe("PI_RUNNER_CAPABILITY_CATALOG structural regressions", () => {
  test("all entries expose structural capability metadata without legacy providers", () => {
    for (const capabilityId of PI_RUNNER_CAPABILITY_IDS) {
      const entry = PI_RUNNER_CAPABILITY_CATALOG[capabilityId];
      expect(entry.capabilityId).toBe(capabilityId);
      expect(entry.section).toMatch(/runner-(capabilities|ui-visual-helpers)/);
      expect(entry.runnerScope).toMatch(/^(all|pi|opencode)$/);
      expect(entry.installKind).toMatch(/^(pi-package|external|pending)$/);
      expect(entry.detector).toBeTruthy();
      const structuralEntry = entry as { toolId?: string; source?: string };
      expect(structuralEntry.toolId).not.toBe("engram-memory");
      expect(structuralEntry.toolId).not.toBe("context7");
      expect(structuralEntry.source?.toLowerCase() ?? "").not.toContain("context7");
    }

    expect(PI_RUNNER_CAPABILITY_CATALOG["context-mode"]).toEqual(
      expect.objectContaining({ capabilityId: "context-mode", toolId: "context-mode", source: "npm:context-mode" }),
    );
    expect(PI_RUNNER_CAPABILITY_CATALOG.rtk).toEqual(
      expect.objectContaining({ capabilityId: "rtk", toolId: "rtk", source: "rtk-ai/rtk", installKind: "external" }),
    );
    expect(PI_RUNNER_CAPABILITY_CATALOG["runner-mermaid"].implementations?.pi).toEqual(
      expect.objectContaining({ id: "pi-mermaid", source: "TBD", installKind: "pending" }),
    );
  });
});
