import { describe, expect, test } from "bun:test";

import { buildPiInstallationPlan } from "./installation-plan";

describe("buildPiInstallationPlan", () => {
  test("includes missing required tools and selected optional tools", () => {
    const plan = buildPiInstallationPlan({
      requiredTools: [
        { name: "sub-agents", installed: false },
        { name: "MCP packages", installed: false },
      ],
      selectedOptionalToolIds: ["rtk", "codebase-memory", "context7", "engram-memory"],
    });

    expect(plan).toEqual([
      { id: "sub-agents", name: "sub-agents", source: "npm:pi-subagents", required: true, installKind: "pi-package" },
      { id: "mcp-packages", name: "MCP packages", source: "npm:pi-mcp-adapter", required: true, installKind: "pi-package" },
      { id: "codebase-memory", name: "codebase-memory", source: "DeusData/codebase-memory-mcp", required: false, installKind: "external" },
      { id: "rtk", name: "RTK", source: "rtk-ai/rtk", required: false, installKind: "external" },
      { id: "context7", name: "Context7", source: "npm:@dreki-gg/pi-context7", required: false, installKind: "pi-package" },
      { id: "engram-memory", name: "Engram memory", source: "Gentleman-Programming/engram", required: false, installKind: "external" },
    ]);
  });
});
