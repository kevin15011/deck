import { expect, test } from "bun:test";
import { getCanonicalRunnerCapabilities, getRunnerMappings, resolveRunnerParity, validateRunnerCapabilitySemantics } from "@deck/core";
import { CODEX_CAPABILITY_CATALOG, CODEX_RUNNER_CAPABILITY_CONTRIBUTION } from "./capability-catalog";

test("Codex adapter capability semantics match the core parity registry", () => {
  expect(validateRunnerCapabilitySemantics("codex", CODEX_CAPABILITY_CATALOG, [CODEX_RUNNER_CAPABILITY_CONTRIBUTION])).toEqual([]);
  expect(CODEX_CAPABILITY_CATALOG).toContainEqual(expect.objectContaining({ capabilityId: "codebase-memory", runtimeReadiness: "binary+mcp+index" }));
  expect(CODEX_CAPABILITY_CATALOG).toContainEqual(expect.objectContaining({ capabilityId: "pi-mermaid", status: "not-applicable", provisionMode: "pi-internal" }));
  expect(CODEX_CAPABILITY_CATALOG).toContainEqual(expect.objectContaining({ capabilityId: "opencode-mermaid-renderer", status: "not-applicable", provisionMode: "opencode-internal" }));
  expect(CODEX_CAPABILITY_CATALOG).toContainEqual(expect.objectContaining({ capabilityId: "deck-model-variants", status: "not-applicable", provisionMode: "opencode-internal" }));
  expect(CODEX_CAPABILITY_CATALOG).toContainEqual(expect.objectContaining({ capabilityId: "pi-hud", status: "not-applicable", provisionMode: "pi-user-optional" }));
  for (const capabilityId of ["trusted-runner-host-bridge", "invocation-authorization", "execution-dossier", "controlled-effects", "registry-coordination", "bound-verification"]) {
    expect(CODEX_CAPABILITY_CATALOG).toContainEqual(expect.objectContaining({
      capabilityId,
      status: "gap",
      provisionMode: "static-compatible-gap",
      reviewDisposition: "static-compatible-gap",
    }));
  }
});

test("Codex contributes an explicit disposition for every generic core capability", () => {
  const canonical = getCanonicalRunnerCapabilities().map((capability) => capability.id).sort();
  const mappings = getRunnerMappings("codex", [CODEX_RUNNER_CAPABILITY_CONTRIBUTION]);
  expect(canonical.every((capabilityId) => mappings.some((mapping) => mapping.capabilityId === capabilityId))).toBe(true);
  const report = resolveRunnerParity("codex", undefined, [CODEX_RUNNER_CAPABILITY_CONTRIBUTION]);
  for (const capabilityId of ["trusted-runner-host-bridge", "invocation-authorization", "execution-dossier", "controlled-effects", "registry-coordination", "bound-verification"]) {
    expect(report.capabilities).toContainEqual(expect.objectContaining({ capabilityId, status: "gap" }));
  }
});

test("Codex parity exposes neutral context-mode, RTK, Serena, MCP, and index diagnostics", () => {
  const report = resolveRunnerParity("codex", {
    binariesInPath: ["context-mode", "codebase-memory-mcp"],
    mcpServersConfigured: ["codebase-memory"],
    projectIndexVerified: false,
  }, [CODEX_RUNNER_CAPABILITY_CONTRIBUTION]);

  expect(report.capabilities.find((entry) => entry.capabilityId === "context-mode")?.code).toBe("capability-mcp-not-configured");
  expect(report.capabilities.find((entry) => entry.capabilityId === "rtk")?.code).toBe("capability-binary-not-usable");
  expect(report.capabilities.find((entry) => entry.capabilityId === "serena")?.code).toBe("capability-binary-not-usable");
  expect(report.capabilities.find((entry) => entry.capabilityId === "codebase-memory")?.code).toBe("capability-index-unverified");
  const mcpReport = resolveRunnerParity("codex", {
    binariesInPath: ["context-mode", "codebase-memory-mcp"],
    mcpServersConfigured: [],
  }, [CODEX_RUNNER_CAPABILITY_CONTRIBUTION]);
  expect(mcpReport.capabilities.find((entry) => entry.capabilityId === "codebase-memory-mcp")?.code).toBe("capability-mcp-not-configured");
  for (const entry of report.capabilities.filter((candidate) => candidate.code)) {
    expect(entry.code).not.toMatch(/^pi-/);
    expect(entry.message).toContain(`Runner codex capability ${entry.capabilityId}`);
  }
});

test("Codex semantic validation rejects missing and mismatched provision, executable, and MCP metadata", () => {
  const withoutContext7 = CODEX_CAPABILITY_CATALOG.filter((entry) => entry.capabilityId !== "context7");
  expect(validateRunnerCapabilitySemantics("codex", withoutContext7, [CODEX_RUNNER_CAPABILITY_CONTRIBUTION])).toContainEqual(expect.stringContaining("context7: parity mapping is missing"));

  const mismatched = CODEX_CAPABILITY_CATALOG.map((entry) => entry.capabilityId === "context-mode"
    ? { ...entry, provisionMode: "invented", executable: "wrong", mcpServerName: "wrong" }
    : entry);
  const issues = validateRunnerCapabilitySemantics("codex", mismatched, [CODEX_RUNNER_CAPABILITY_CONTRIBUTION]);
  expect(issues).toContainEqual(expect.stringContaining("context-mode: provision mode"));
  expect(issues).toContainEqual(expect.stringContaining("context-mode: executable"));
  expect(issues).toContainEqual(expect.stringContaining("context-mode: MCP server"));
});
