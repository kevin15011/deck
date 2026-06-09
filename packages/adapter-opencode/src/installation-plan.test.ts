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
      {
        id: "rtk",
        name: "RTK",
        module: "rtk-ai/rtk",
        required: false,
        installKind: "shell-script-plus-mcp",
        capabilityId: "rtk",
        shellInstallUrl: "https://raw.githubusercontent.com/rtk-ai/rtk/refs/heads/master/install.sh",
        postInstallCommand: ["rtk", "init", "-g", "--opencode"],
      },
      {
        id: "codebase-memory",
        name: "codebase-memory",
        module: "DeusData/codebase-memory-mcp",
        required: false,
        installKind: "shell-script",
        capabilityId: "codebase-memory",
        shellInstallUrl: "https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh",
      },
      { id: "context7", name: "Context7", module: "@upstash/context7-mcp", required: false, installKind: "mcp-server", capabilityId: "context7" },
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