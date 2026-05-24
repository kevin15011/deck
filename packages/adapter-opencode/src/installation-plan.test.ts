import { describe, expect, test } from "bun:test";

import { buildOpenCodeInstallationPlan } from "./installation-plan";

describe("buildOpenCodeInstallationPlan", () => {
  test("includes only selected missing OpenCode tools", () => {
    const plan = buildOpenCodeInstallationPlan({
      tools: [
        { name: "RTK", installed: false },
        { name: "context-mode", installed: true },
        { name: "codebase-memory", installed: false },
      ],
      selectedToolIds: ["rtk", "context-mode", "codebase-memory", "context7"],
    });

    expect(plan).toEqual([
      { id: "rtk", name: "RTK", module: "rtk-ai/rtk", required: false, installKind: "external" },
      { id: "codebase-memory", name: "codebase-memory", module: "DeusData/codebase-memory-mcp", required: false, installKind: "external" },
      { id: "context7", name: "Context7", module: "@upstash/context7-mcp", required: false, installKind: "opencode-plugin" },
    ]);
  });

  test("returns no plan when no OpenCode tools are selected", () => {
    const plan = buildOpenCodeInstallationPlan({
      tools: [{ name: "RTK", installed: false }],
      selectedToolIds: [],
    });

    expect(plan).toEqual([]);
  });
});