import { describe, expect, test } from "bun:test";
import { ModelInventoryCache } from "./model-inventory-cache";
import { discoverModelInventory } from "./model-inventory";
import { createHermeticOpenCodeDiscoveryDependencies, loadOpenCodeModelsVerboseFixture } from "./__tests__/opencode-models-cli-test-helpers";

describe("runner-only OpenCode inventory", () => {
  test("keeps runner-only membership and variants while allowing matching presentation enrichment", async () => {
    const { dependencies } = createHermeticOpenCodeDiscoveryDependencies({ transcript: loadOpenCodeModelsVerboseFixture("v1-valid"), now: 100 });
    const result = await discoverModelInventory({ dependencies, projectRoot: "/workspace", metadataById: {
      "opencode/openai/gpt-5.3-codex": { displayName: "Metadata name", supportsTools: true },
      "cache/only": { displayName: "must not appear" },
    } });
    expect(result.state).toBe("ready");
    if (result.state === "ready") {
      expect(result.inventory.modelsByProvider.cache).toBeUndefined();
      expect(result.inventory.modelsByProvider.opencode?.[0]?.variants).toEqual(["minimal", "maximum-plus"]);
      expect(result.inventory.modelsByProvider.opencode?.[0]?.metadataSource).toBe("runner+cache");
    }
  });

  test("returns stale only from an eligible matching LKG and otherwise blocks command failure", async () => {
    const { dependencies } = createHermeticOpenCodeDiscoveryDependencies({ transcript: "", now: 24 * 60 * 60_000 });
    dependencies.commandRunner.run = async () => ({ exitCode: 1, signal: null, stdout: "", stderr: "credentials never surface" });
    const snapshot = { providers: [], modelsByProvider: {}, diagnostics: ["runner-returned-no-models"] };
    const stale = await discoverModelInventory({ dependencies, projectRoot: "/workspace", fingerprint: "same", readLastKnownGood: async () => ({ inventory: snapshot, discoveredAt: 0 }) });
    expect(stale.state).toBe("stale");
    const blocked = await discoverModelInventory({ dependencies, projectRoot: "/workspace", fingerprint: "other", readLastKnownGood: async () => undefined });
    expect(blocked).toMatchObject({ state: "blocked", inventory: null });
  });

  test("returns a valid ready empty result", async () => {
    const { dependencies } = createHermeticOpenCodeDiscoveryDependencies({ transcript: "", now: 1 });
    const result = await discoverModelInventory({ dependencies, projectRoot: "/workspace", cache: new ModelInventoryCache({ now: dependencies.now }) });
    expect(result).toMatchObject({ state: "ready", source: "live" });
    if (result.state === "ready") expect(result.inventory.providers).toEqual([]);
  });
});
