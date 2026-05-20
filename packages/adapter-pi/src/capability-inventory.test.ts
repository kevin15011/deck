import { describe, expect, test } from "bun:test";

import { buildPiRunnerCapabilityInventory } from "./capability-inventory";
import type { PiRequiredToolsReview } from "./required-tools";
import { createToolStatus } from "./tool-status";

function review(installedPackages: string[] = []): PiRequiredToolsReview {
  const names = ["sub-agents", "MCP packages", "context-mode", "codebase-memory", "RTK", "Context7", "Engram memory"];
  return {
    installedPackages,
    requiredTools: names.map((name) => ({ name, installed: installedPackages.some((pkg) => normalize(pkg) === normalize(name)) })),
    tools: names.map((name) => {
      const installed = installedPackages.some((pkg) => normalize(pkg) === normalize(name));
      return createToolStatus(name, installed ? "found" : "missing", installed ? "configured" : "missing");
    }),
  };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

describe("buildPiRunnerCapabilityInventory", () => {
  test("maps installed package capabilities to ready and missing external capabilities to manual", () => {
    const inventory = buildPiRunnerCapabilityInventory(review(["context-mode"]), undefined, { runnerScope: "pi" });

    expect(inventory["context-mode"]?.status).toBe("ready");
    expect(inventory["context-mode"]?.installed).toBe(true);
    expect(inventory.rtk?.status).toBe("manual");
    expect(inventory.rtk?.installed).toBe(false);
    expect(inventory["codebase-memory"]?.status).toBe("manual");
  });

  test("maps runner Mermaid to pending pi-mermaid for Pi and blocked TBD for OpenCode", () => {
    const piInventory = buildPiRunnerCapabilityInventory(review(), undefined, { runnerScope: "pi" });
    const opencodeInventory = buildPiRunnerCapabilityInventory(review(), undefined, { runnerScope: "opencode" });

    expect(piInventory["runner-mermaid"]?.status).toBe("pending-source");
    expect(piInventory["runner-mermaid"]?.implementationId).toBe("pi-mermaid");
    expect(piInventory["runner-mermaid"]?.diagnostics.join(" ")).toContain("pi-mermaid");

    expect(opencodeInventory["runner-mermaid"]?.status).toBe("blocked");
    expect(opencodeInventory["runner-mermaid"]?.implementationId).toBe("TBD");
  });

  test("keeps pi-hud pending-source for Pi and omits it for OpenCode", () => {
    const piInventory = buildPiRunnerCapabilityInventory(review(), undefined, { runnerScope: "pi" });
    const opencodeInventory = buildPiRunnerCapabilityInventory(review(), undefined, { runnerScope: "opencode" });

    expect(piInventory["pi-hud"]?.status).toBe("pending-source");
    expect(piInventory["pi-hud"]?.installed).toBe(false);
    expect(opencodeInventory["pi-hud"]).toBeUndefined();
  });

  test("does not infer ready for capabilities without confirmed detector/source", () => {
    const inventory = buildPiRunnerCapabilityInventory(review(["pi-mermaid", "pi-hud"]), undefined, { runnerScope: "pi" });

    expect(inventory["runner-mermaid"]?.status).toBe("pending-source");
    expect(inventory["runner-mermaid"]?.installed).toBe(false);
    expect(inventory["pi-hud"]?.status).toBe("pending-source");
    expect(inventory["pi-hud"]?.installed).toBe(false);
  });
});
