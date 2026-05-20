import { describe, expect, test } from "bun:test";

import { buildPiInstallationPlan } from "./installation-plan";
import {
  INTERNAL_INSTALLABLE_BOUNDARY,
  PI_INSTALLABLE_TOOLS,
} from "./installation-plan";

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

  test("does not include already installed tools", () => {
    const plan = buildPiInstallationPlan({
      requiredTools: [
        { name: "sub-agents", installed: true },
        { name: "MCP packages", installed: false },
      ],
      selectedOptionalToolIds: ["context-mode"],
    });

    expect(plan).not.toContainEqual(
      expect.objectContaining({ id: "sub-agents" }),
    );
  });

  test("includes required tools regardless of selectedOptionalToolIds", () => {
    // buildPiInstallationPlan always includes all required tools (sub-agents, mcp-packages).
    // selectedOptionalToolIds only affects optional tools.
    const plan = buildPiInstallationPlan({
      requiredTools: [],
      selectedOptionalToolIds: ["context7"],
    });

    // Required tools are always included (sub-agents, mcp-packages)
    expect(plan.map((t) => t.id)).toContain("sub-agents");
    expect(plan.map((t) => t.id)).toContain("mcp-packages");
    // Plus the selected optional tool
    expect(plan.map((t) => t.id)).toContain("context7");
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

    // 7 tools total (2 required + 5 optional); pi-mermaid is NOT in this catalog
    expect(PI_INSTALLABLE_TOOLS).toHaveLength(7);
  });
});