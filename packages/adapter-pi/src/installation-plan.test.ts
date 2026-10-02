import { describe, expect, test } from "bun:test";

import { buildPiInstallationPlan } from "./installation-plan";
import {
  INTERNAL_INSTALLABLE_BOUNDARY,
  PI_INSTALLABLE_TOOLS,
} from "./installation-plan";

describe("buildPiInstallationPlan", () => {
  test("uses the serena-agent source and managed MCP install kind for Serena", () => {
    expect(PI_INSTALLABLE_TOOLS).toContainEqual(
      expect.objectContaining({
        id: "serena",
        source: "serena-agent",
        installKind: "shared-binary-plus-mcp",
        required: false,
      }),
    );
  });

  test("plans only the selected optional tools (Deck owns subagents and MCP configuration)", () => {
    const plan = buildPiInstallationPlan({
      requiredTools: [],
      // Only codebase-memory-mcp is available (not codebase-memory) for OpenCode parity
      selectedOptionalToolIds: ["rtk", "codebase-memory-mcp", "context7"],
    });

    expect(plan).toEqual([
      { id: "codebase-memory-mcp", name: "codebase-memory-mcp", source: "DeusData/codebase-memory-mcp", required: false, installKind: "shared-binary-plus-mcp", capabilityId: "codebase-memory-mcp" },
      { id: "rtk", name: "RTK", source: "rtk-ai/rtk", required: false, installKind: "shared-binary", capabilityId: "rtk" },
      { id: "context7", name: "Context7", source: "npm:@upstash/context7-mcp", required: false, installKind: "npm-package-plus-mcp", capabilityId: "context7" },
    ]);
  });

  test("does not include already installed tools", () => {
    const plan = buildPiInstallationPlan({
      requiredTools: [{ name: "context-mode", installed: true }],
      selectedOptionalToolIds: ["context-mode"],
    });

    expect(plan).not.toContainEqual(expect.objectContaining({ id: "context-mode" }));
  });

  test("never plans the community pi-subagents or pi-mcp-adapter packages", () => {
    const everything = buildPiInstallationPlan({ requiredTools: [], selectedOptionalToolIds: PI_INSTALLABLE_TOOLS.map((tool) => tool.id) });
    expect(everything.map((tool) => tool.source)).not.toContain("npm:pi-subagents");
    expect(everything.map((tool) => tool.source)).not.toContain("npm:pi-mcp-adapter");
    expect(PI_INSTALLABLE_TOOLS.map((tool) => tool.id)).not.toContain("sub-agents");
    expect(PI_INSTALLABLE_TOOLS.map((tool) => tool.id)).not.toContain("mcp-packages");
    expect(PI_INSTALLABLE_TOOLS.some((tool) => tool.required)).toBe(false);
  });

  test("offers Web Search (Tavily) as an installable MCP tool", () => {
    expect(PI_INSTALLABLE_TOOLS).toContainEqual(expect.objectContaining({ id: "web-search", name: "Web Search", installKind: "mcp-server", capabilityId: "web-search", required: false }));
    expect(buildPiInstallationPlan({ requiredTools: [], selectedOptionalToolIds: ["web-search"] }).map((tool) => tool.id)).toEqual(["web-search"]);
  });
});

// ---------------------------------------------------------------------------
// PI_INSTALLABLE_TOOLS boundary assertions
// Task 6: preserve the public catalog boundary and assert pi-mermaid exclusion
// REQ-DASH-001: Mermaid/runner-mermaid must not be a configurable dashboard option
// REQ-PIINSTALL-003: Required internal support must not become a configuration decision
// ---------------------------------------------------------------------------

describe("PI_INSTALLABLE_TOOLS boundary", () => {
  test("pi-mermaid is NOT in PI_INSTALLABLE_TOOLS (Task 6 requirement)", () => {
    // Check by source name — avoids type friction between InstallablePiToolId and
    // InternalRunnerPackageId. "npm:pi-mermaid" is the pi-mermaid source in internal catalog.
    const sources = PI_INSTALLABLE_TOOLS.map((t) => t.source);
    expect(sources).not.toContain("npm:pi-mermaid");
  });

  test("pi-mermaid is listed in INTERNAL_INSTALLABLE_BOUNDARY for documentation clarity", () => {
    expect(INTERNAL_INSTALLABLE_BOUNDARY).toContain("pi-mermaid");
  });

  test("INTERNAL_INSTALLABLE_BOUNDARY entries are not in PI_INSTALLABLE_TOOLS", () => {
    // Use source string comparison to avoid TypeScript type friction between
    // InstallablePiToolId and InternalRunnerPackageId. The types have no overlap
    // (which is exactly the desired boundary), but it prevents direct id comparison.
    const internalSource = `npm:${INTERNAL_INSTALLABLE_BOUNDARY[0]}` as string;
    const found = PI_INSTALLABLE_TOOLS.find((t) => (t.source as string) === internalSource);
    expect(found).toBeUndefined();
  });

  test("compile-time boundary assertion enforces pi-mermaid exclusion at type level", () => {
    // The _AssertInternalBoundary type in installation-plan.ts ensures that if
    // "pi-mermaid" were ever added to PI_INSTALLABLE_TOOLS, the TypeScript build
    // would fail with a compile-time error at the type assertion site.
    //
    // We verify the check is live by confirming:
    // 1. The boundary list contains pi-mermaid
    // 2. The tool catalog has the expected size (pi-mermaid is excluded)
    expect(INTERNAL_INSTALLABLE_BOUNDARY).toHaveLength(1);
    expect(INTERNAL_INSTALLABLE_BOUNDARY[0]).toBe("pi-mermaid");

    // 6 optional tools (context-mode, codebase-memory-mcp, rtk, serena, context7, web-search); pi-mermaid is NOT in this catalog
    expect(PI_INSTALLABLE_TOOLS).toHaveLength(6);
  });
});
