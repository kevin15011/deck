import { describe, expect, it } from "bun:test";
import { readOpenCodeDeveloperTeamModelConfigAssignments } from "../model-config";
import { discoverModelInventory } from "../model-inventory";
import {
  createHermeticOpenCodeDiscoveryDependencies,
  loadOpenCodeModelsVerboseFixture,
} from "./opencode-models-cli-test-helpers";

describe("opencode / cross-cutting runner inventory behavior", () => {
  describe("runner-authoritative inventory", () => {
    it("keeps runner membership independent of cache-only metadata", async () => {
      const { dependencies, calls } = createHermeticOpenCodeDiscoveryDependencies({
        transcript: loadOpenCodeModelsVerboseFixture("v1-valid"),
        now: 100,
      });

      const result = await discoverModelInventory({
        dependencies,
        projectRoot: "/fixture/workspace",
        metadataById: {
          "cache/only": { displayName: "must not appear" },
          "opencode/openai/gpt-5.3-codex": { displayName: "presentation only" },
        },
      });

      expect(result.state).toBe("ready");
      if (result.state !== "ready") throw new Error("expected runner inventory");
      expect(Object.values(result.inventory.modelsByProvider).flat().map((model) => model.id)).toEqual([
        "opencode/openai/gpt-5.3-codex",
        "plugin/acme/model-with-alias",
      ]);
      expect(result.inventory.modelsByProvider.cache).toBeUndefined();
      expect(calls.command).toHaveLength(1);
      expect(calls.command[0]?.args).toEqual(["models", "--verbose"]);
    });

    it("preserves exact final variant keys and zero-variant models", async () => {
      const { dependencies } = createHermeticOpenCodeDiscoveryDependencies({
        transcript: loadOpenCodeModelsVerboseFixture("v1-valid"),
        now: 100,
      });

      const result = await discoverModelInventory({ dependencies, projectRoot: "/fixture/workspace" });

      expect(result.state).toBe("ready");
      if (result.state !== "ready") throw new Error("expected runner inventory");
      expect(result.inventory.modelsByProvider.opencode?.[0]?.variants).toEqual(["minimal", "maximum-plus"]);
      expect(result.inventory.modelsByProvider.plugin?.[0]?.variants).toEqual([]);
    });
  });

  describe("non-destructive config reads", () => {
    it("preserves unavailable native variants instead of sanitizing them from cache data", () => {
      const config = readOpenCodeDeveloperTeamModelConfigAssignments("/fixture/config", {
        exists: () => true,
        readFile: () => JSON.stringify({
          agent: {
            "deck-developer-orchestrator": {
              model: "retired/model",
              variant: "custom-legacy-token",
            },
          },
        }),
      });

      expect(config.modelAssignments["deck-lead"]).toBe("retired/model");
      expect(config.thinkingAssignments["deck-lead"]).toBe("custom-legacy-token");
    });
  });
});
