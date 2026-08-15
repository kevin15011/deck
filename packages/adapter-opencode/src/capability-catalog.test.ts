import { describe, expect, test } from "bun:test";
import { getCanonicalRunnerCapabilities, getRunnerMappings } from "@deck/core";

import {
  OPENCODE_ADAPTER_CAPABILITY_DISPOSITIONS,
  OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION,
  OPENCODE_RUNNER_CAPABILITY_CATALOG,
  OPENCODE_RUNNER_CAPABILITY_IDS,
} from "./capability-catalog";

describe("OpenCode Serena capability metadata", () => {
  test("owns a mapping for every core and OpenCode canonical capability", () => {
    const canonical = getCanonicalRunnerCapabilities([OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION]);
    const mappings = getRunnerMappings("opencode", [OPENCODE_RUNNER_CAPABILITY_CONTRIBUTION]);
    expect(canonical.every((capability) => mappings.some((mapping) => mapping.capabilityId === capability.id))).toBe(true);
  });

  test("keeps internal package dispositions adapter-owned", () => {
    expect(OPENCODE_ADAPTER_CAPABILITY_DISPOSITIONS).toContainEqual({ capabilityId: "opencode-mermaid-renderer", status: "runner-specific", installKind: "internal-required" });
    expect(OPENCODE_ADAPTER_CAPABILITY_DISPOSITIONS).toContainEqual({ capabilityId: "deck-model-variants", status: "runner-specific", installKind: "internal-required" });
  });

  test("uses serena-agent as the selectable source identity", () => {
    const serena = OPENCODE_RUNNER_CAPABILITY_CATALOG.serena;

    expect(serena).toMatchObject({
      capabilityId: "serena",
      runnerScope: "all",
      requirementLevel: "configurable",
      source: "serena-agent",
    });
    expect(serena.installKind).toBe("serena-agent");
    expect(JSON.stringify(serena)).not.toContain("oraios/serena");
    expect(JSON.stringify(serena)).not.toContain("pipx");
    expect(JSON.stringify(serena)).not.toContain("python-tool");
  });

  test("does not change the public capability IDs or their order", () => {
    expect(OPENCODE_RUNNER_CAPABILITY_IDS).toEqual([
      "context-mode",
      "codebase-memory",
      "rtk",
      "serena",
      "context7",
      "web-search",
    ]);
  });
});
