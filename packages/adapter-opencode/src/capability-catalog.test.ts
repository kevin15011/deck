import { describe, expect, test } from "bun:test";

import {
  OPENCODE_RUNNER_CAPABILITY_CATALOG,
  OPENCODE_RUNNER_CAPABILITY_IDS,
} from "./capability-catalog";

describe("OpenCode Serena capability metadata", () => {
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
    ]);
  });
});
