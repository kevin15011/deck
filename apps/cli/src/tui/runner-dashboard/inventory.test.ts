import { describe, expect, test } from "bun:test";
import type { CapabilityInventory } from "@deck/core";
import { normalizeDashboardCapabilityInventory } from "./inventory";

const validInventory: CapabilityInventory = {
  runnerId: "codex",
  environmentId: "codex-development",
  capabilities: [{
    capabilityId: "context7",
    label: "Context7",
    description: "Current documentation",
    section: "shared-tools",
    requirementLevel: "optional",
    installKind: "external",
    isInstalled: false,
    isBlocked: false,
    diagnostics: [],
  }],
};

describe("normalizeDashboardCapabilityInventory", () => {
  test("retains the complete core inventory contract for the selected runner", () => {
    const result = normalizeDashboardCapabilityInventory(validInventory, "codex", "codex-development");

    expect(result).toEqual({ ok: true, inventory: validInventory });
  });

  test("rejects record projections, mismatched runner identities, and malformed entries", () => {
    expect(normalizeDashboardCapabilityInventory({ context7: validInventory.capabilities[0] }, "codex", "codex-development")).toMatchObject({
      ok: false,
      diagnostic: { code: "dashboard-inventory-invalid" },
    });
    expect(normalizeDashboardCapabilityInventory({ ...validInventory, runnerId: "pi" }, "codex", "codex-development")).toMatchObject({
      ok: false,
      diagnostic: { code: "dashboard-inventory-invalid" },
    });
    expect(normalizeDashboardCapabilityInventory({ ...validInventory, capabilities: [{ capabilityId: "context7" }] }, "codex", "codex-development")).toMatchObject({
      ok: false,
      diagnostic: { code: "dashboard-inventory-invalid" },
    });
  });
});
