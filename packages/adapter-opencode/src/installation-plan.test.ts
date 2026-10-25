import { describe, expect, test } from "bun:test";

import { buildOpenCodeInstallationPlan, getSelectableOpenCodeTools } from "./installation-plan";

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
        installKind: "deck-owned-native",
        capabilityId: "codebase-memory",
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

  test("keeps the adaptive-memory-owned Supermemory package out of generic tool selection", () => {
    expect(getSelectableOpenCodeTools().map((tool) => tool.id)).not.toContain("opencode-supermemory");
  });

  test("ignores retired Serena selection", () => {
    const plan = buildOpenCodeInstallationPlan({
      tools: [{ name: "Serena", installed: false }],
      selectedToolIds: ["serena"],
    });

    expect(plan).toEqual([]);
    expect(getSelectableOpenCodeTools().some(tool => tool.id === "serena" || tool.id === "context-mode")).toBe(false);
  });
});
