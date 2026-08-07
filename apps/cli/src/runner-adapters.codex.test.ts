import { describe, expect, test } from "bun:test";

import { createDefaultAdapterRegistry } from "./runner-adapters";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("default AdapterRegistry", () => {
  test("is the authoritative composition path for Pi, OpenCode, and Codex", () => {
    const registry = createDefaultAdapterRegistry();
    expect(registry.list().map((adapter) => adapter.runnerId)).toEqual(["pi", "opencode", "codex"]);
    expect(registry.get("codex").buildLaunchPlan).toBeFunction();
  });

  test("construction and innocuous inspection do not create runner home/config paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "deck-registry-no-write-"));
    const openCodeConfig = join(root, "opencode-config");
    const piHome = join(root, "pi-home");
    const codexJournal = join(root, "codex-journal");
    try {
      const registry = createDefaultAdapterRegistry({
        pi: { homeDirectory: piHome },
        opencode: { developerTeamConfigDir: openCodeConfig, skillDiscoveryHomeDir: join(root, "skills-home") },
        codex: { journalRoot: codexJournal, preflight: { probe: async () => ({ found: false }) } },
      });
      registry.list().forEach((adapter) => adapter.getCapabilityIds());
      await registry.get("codex").inspectProject?.(root);
      expect(existsSync(openCodeConfig)).toBe(false);
      expect(existsSync(piHome)).toBe(false);
      expect(existsSync(codexJournal)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
