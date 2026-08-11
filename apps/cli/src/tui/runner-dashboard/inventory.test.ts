import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOpenCodeRunnerAdapter } from "@deck/adapter-opencode";
import { createPiRunnerAdapter } from "@deck/adapter-pi";
import { validateDeckConfig } from "@deck/core";
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

  test("accepts the real OpenCode adapter inventory for disabled and enabled Web Search", async () => {
    const home = mkdtempSync(join(tmpdir(), "deck-dashboard-opencode-"));
    const projectRoot = join(home, "project");
    mkdirSync(projectRoot, { recursive: true });
    const adapter = createOpenCodeRunnerAdapter({
      developerTeamConfigDir: join(home, ".config", "opencode"),
      toolsReview: () => ({ installedPackages: [], tools: [], toolStatuses: [] }),
    } as never);

    try {
      for (const enabled of [false, true]) {
        const deckConfig = validateDeckConfig({ webSearch: enabled ? { enabled: true, provider: "tavily" } : { enabled: false } });
        const inventory = await adapter.getCapabilityInventory({
          projectRoot,
          runnerId: "opencode",
          environmentId: "opencode-development",
          deckConfig,
        });

        expect(normalizeDashboardCapabilityInventory(inventory, "opencode", "opencode-development")).toMatchObject({ ok: true });
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  test("accepts the real Pi adapter inventory with canonical labels for disabled and enabled Web Search", async () => {
    const home = mkdtempSync(join(tmpdir(), "deck-dashboard-pi-"));
    const projectRoot = join(home, "project");
    mkdirSync(projectRoot, { recursive: true });
    const adapter = createPiRunnerAdapter({
      homeDirectory: home,
      requiredToolsReview: () => ({ installedPackages: [], requiredTools: [], tools: [] }),
    });

    try {
      for (const enabled of [false, true]) {
        const deckConfig = validateDeckConfig({ webSearch: enabled ? { enabled: true, provider: "tavily" } : { enabled: false } });
        const inventory = await adapter.getCapabilityInventory({
          projectRoot,
          runnerId: "pi",
          environmentId: "pi-development",
          deckConfig,
        });

        expect(inventory.capabilities).toEqual(expect.arrayContaining([
          expect.objectContaining({ label: expect.any(String), description: expect.any(String), requirementLevel: expect.any(String) }),
        ]));
        expect(inventory.capabilities.every((entry) => entry.label.length > 0 && entry.description.length > 0)).toBe(true);
        expect(normalizeDashboardCapabilityInventory(inventory, "pi", "pi-development")).toMatchObject({ ok: true });
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
