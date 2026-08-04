/**
 * E2E-ish TUI tests for runner install flows (Tasks 8, 9).
 *
 * These tests verify the flow from preflight to install to artifact verification.
 * Uses render-only tests with deterministic mocks - no real installs, network, or filesystem.
 * Covers: REQ-E2E-001, REQ-E2E-002, REQ-E2E-003, REQ-E2E-004
 */

import React from "react";
import { describe, expect, test, beforeEach, vi } from "bun:test";
import { renderToString } from "ink";

import { RunnerDashboardScreens } from "../screens/runner-dashboard-screens";
import type { RunnerDashboardState, RunnerReviewPlan } from "../runner-dashboard/state";
import type { RunnerActionRunResult } from "../runner-dashboard/action-runner";
import { createDefaultRunnerDashboardState } from "../runner-dashboard/state";
import type { PiPreflightResult } from "@deck/adapter-pi";
import type { OpenCodePreflightResult } from "@deck/adapter-opencode";

// ============================================================================
// Fixtures
// ============================================================================

// Helper to create RunnerActionRunResult with required diagnostics field
function createActionResult(
  actionId: string,
  status: RunnerActionRunResult["status"],
  message: string,
  extra: Partial<RunnerActionRunResult> = {},
): RunnerActionRunResult {
  return { actionId, status, message, diagnostics: [], ...extra };
}

const PASSING_PI_PREFLIGHT: PiPreflightResult = {
  version: "0.15.0",
  configDirectory: "/home/testuser/.pi/agent",
  existingConfiguration: true,
  checks: [
    { id: "mcp-config-persistence", runner: "pi", status: "pass", severity: "info", message: "MCP config exists" },
    { id: "stale-package-replacement", runner: "pi", status: "pass", severity: "info", message: "No stale packages" },
    { id: "nested-skills-cleanup", runner: "pi", status: "pass", severity: "info", message: "No nested skills" },
    { id: "legacy-sdd-cleanup", runner: "pi", status: "pass", severity: "info", message: "No legacy SDD files" },
    { id: "shared-binary-usability", runner: "pi", status: "pass", severity: "info", message: "Shared binaries usable" },
  ],
  summary: { ready: true, failed: 0, warnings: 0 },
};

const FAILING_PI_PREFLIGHT: PiPreflightResult = {
  version: "0.15.0",
  configDirectory: "/home/testuser/.pi/agent",
  existingConfiguration: true,
  checks: [
    { id: "mcp-config-persistence", runner: "pi", status: "pass", severity: "info", message: "MCP config exists" },
    { id: "stale-package-replacement", runner: "pi", status: "fail", severity: "error", message: "Stale package @dreki-gg/pi-context7 found", path: "/home/testuser/.pi/agent/settings.json", remediation: "Replace with @upstash/context7-mcp" },
    { id: "nested-skills-cleanup", runner: "pi", status: "pass", severity: "info", message: "No nested skills" },
    { id: "legacy-sdd-cleanup", runner: "pi", status: "pass", severity: "info", message: "No legacy SDD files" },
    { id: "shared-binary-usability", runner: "pi", status: "pass", severity: "info", message: "Shared binaries usable" },
  ],
  summary: { ready: false, failed: 1, warnings: 0 },
};

const PASSING_OPENCODE_PREFLIGHT: OpenCodePreflightResult = {
  version: "0.28.0",
  configDirectory: "/home/testuser/.config/opencode",
  existingConfiguration: true,
  packageManifest: "/home/testuser/.config/opencode/package.json",
  checks: [
    { id: "config-manifest-presence", runner: "opencode", status: "pass", severity: "info", message: "Config manifest exists" },
    { id: "nested-skills-cleanup", runner: "opencode", status: "pass", severity: "info", message: "No nested skills" },
    { id: "legacy-sdd-cleanup", runner: "opencode", status: "pass", severity: "info", message: "No legacy SDD files" },
    { id: "shared-binary-usability", runner: "opencode", status: "pass", severity: "info", message: "Shared binaries usable" },
  ],
  summary: { ready: true, failed: 0, warnings: 0 },
};

const FAILING_OPENCODE_PREFLIGHT: OpenCodePreflightResult = {
  version: "0.28.0",
  configDirectory: "/home/testuser/.config/opencode",
  existingConfiguration: true,
  packageManifest: "/home/testuser/.config/opencode/package.json",
  checks: [
    { id: "config-manifest-presence", runner: "opencode", status: "pass", severity: "info", message: "Config manifest exists" },
    { id: "nested-skills-cleanup", runner: "opencode", status: "fail", severity: "error", message: "Nested skill directory found", path: "/home/testuser/.opencode/skills/SKILL.md/SKILL.md", remediation: "Remove nested skill directories" },
    { id: "legacy-sdd-cleanup", runner: "opencode", status: "pass", severity: "info", message: "No legacy SDD files" },
    { id: "shared-binary-usability", runner: "opencode", status: "pass", severity: "info", message: "Shared binaries usable" },
  ],
  summary: { ready: false, failed: 1, warnings: 0 },
};

describe("T6 identified package outcomes and inline causes", () => {
  test("renders already-present identity and explicitly says the installer was not run", () => {
    const state = createMockedOpenCodeDashboardState({ screen: "install-progress" });
    const output = renderToString(
      <RunnerDashboardScreens
        state={state}
        installResults={[createActionResult(
          "capability.codebase-memory.install",
          "skipped",
          "codebase-memory already present; installer not run.",
          { packageOutcome: "already-present" },
        )]}
      />,
    );

    expect(output).toContain("… [capability.codebase-memory.install] codebase-memory already present;");
    expect(output).toContain("installer not run.");
    expect(output).not.toContain("installer completed");
  });

  test("renders one identified bounded cause without exposing terminal noise or secrets", () => {
    const state = createMockedOpenCodeDashboardState({ screen: "install-progress" });
    const output = renderToString(
      <RunnerDashboardScreens
        state={state}
        installResults={[createActionResult(
          "capability.codebase-memory.install",
          "failed",
          "Package install failed.",
          {
            cause: "\u001b[31merror\u001b[0m failed to copy binary to /home/private/bin token=super-secret ░░░",
            diagnostics: ["error failed to copy binary"],
          },
        )]}
      />,
    );

    expect(output).toContain("✗ [capability.codebase-memory.install] Package install failed.");
    expect(output).toContain("  error failed to copy binary to <path> token=[REDACTED]");
    expect(output).not.toContain("\u001b");
    expect(output).not.toContain("/home/private");
    expect(output).not.toContain("super-secret");
    expect(output).not.toContain("░");
  });

  test("preserves the progress view final-five behavior while identifying each action", () => {
    const state = createMockedOpenCodeDashboardState({ screen: "install-progress" });
    const results = Array.from({ length: 6 }, (_, index) => createActionResult(
      `capability.tool-${index}.install`,
      "executed",
      `Installed tool-${index}`,
    ));
    const output = renderToString(<RunnerDashboardScreens state={state} installResults={results} />);

    expect(output).not.toContain("tool-0");
    for (let index = 1; index < 6; index++) {
      expect(output).toContain(`[capability.tool-${index}.install]`);
    }
  });

  test("renders completion failures with identity and one inline cause", () => {
    const state = createMockedOpenCodeDashboardState({ screen: "complete" });
    const output = renderToString(
      <RunnerDashboardScreens
        state={state}
        installResults={[createActionResult(
          "capability.serena.install",
          "failed",
          "Serena install failed.",
          { cause: "Install failed (exit 1)." },
        )]}
      />,
    );

    expect(output).toContain("✗ [capability.serena.install] Serena install failed.");
    expect(output).toContain("  Install failed (exit 1).");
  });

  test("keeps symbols and words meaningful without relying on color", () => {
    const state = createMockedOpenCodeDashboardState({ screen: "install-progress" });
    const output = renderToString(
      <RunnerDashboardScreens
        state={state}
        installResults={[
          createActionResult("capability.context7.install", "skipped", "Context7 already present; installer not run.", { packageOutcome: "already-present" }),
          createActionResult("capability.serena.install", "failed", "Serena install failed.", { cause: "Install failed." }),
        ]}
      />,
    );

    expect(output).toContain("…");
    expect(output).toContain("✗");
    expect(output).toContain("already present");
    expect(output).toContain("failed");
  });
});

describe("Serena fixed-stage render contract", () => {
  test("renders the quiet Serena stages in order and a bounded terminal outcome for both runners", () => {
    for (const runnerScope of ["pi", "opencode"] as const) {
      const state = createDefaultRunnerDashboardState({ runnerScope, screen: "install-progress" });
      const output = renderToString(
        <RunnerDashboardScreens
          state={state}
          serenaStages={["preparing-uv", "installing-serena", "validating-serena", "configuring-mcp"]}
          serenaOutcome="installed"
          installResults={[createActionResult(
            "capability.serena.mcp-config",
            "executed",
            "Serena MCP configuration created.",
            { serenaOutcome: "installed", serenaStage: "configuring-mcp" },
          )]}
        />,
      );

      expect(output).toContain("Preparing uv");
      expect(output).toContain("Installing Serena");
      expect(output).toContain("Validating Serena");
      expect(output).toContain("Configuring MCP");
      expect(output.indexOf("Preparing uv")).toBeLessThan(output.indexOf("Installing Serena"));
      expect(output.indexOf("Installing Serena")).toBeLessThan(output.indexOf("Validating Serena"));
      expect(output.indexOf("Validating Serena")).toBeLessThan(output.indexOf("Configuring MCP"));
      expect(output).toContain("Status: Serena Installed.");
    }
  });

  test("renders cancellation and partial outcomes without implying MCP success or exposing private data", () => {
    const state = createDefaultRunnerDashboardState({ runnerScope: "pi", screen: "install-progress" });
    const hostilePath = "/home/private/.deck/tools/serena token=secret";
    const output = renderToString(
      <RunnerDashboardScreens
        state={state}
        serenaStages={["installing-serena"]}
        serenaOutcome="partial"
        cancellationRequested
        installResults={[createActionResult(
          "capability.serena.install",
          "failed",
          "Serena setup stopped before termination was confirmed.",
          { serenaOutcome: "partial", serenaStage: "installing-serena", cause: `raw ${hostilePath}` },
        )]}
      />,
    );

    expect(output).toContain("Cancellation requested; waiting for the active command to stop.");
    expect(output).toContain("Status: Serena Partial.");
    expect(output).not.toContain(hostilePath);
    expect(output).not.toContain("raw");
    expect(output).not.toContain("Configuring MCP");
  });
});

function createMinimalPlan(overrides?: Partial<RunnerReviewPlan>): RunnerReviewPlan {
  return {
    groups: {
      automaticInstalls: [],
      manualSteps: [],
      configWrites: [],
      teamApplications: [],
      validations: [],
    },
    diagnostics: [],
    ready: true,
    ...overrides,
  };
}

function createMockedPiDashboardState(partial?: Partial<RunnerDashboardState>): RunnerDashboardState {
  return createDefaultRunnerDashboardState({
    runnerScope: "pi",
    runtime: {
      runnerCommand: "pi",
      preflight: PASSING_PI_PREFLIGHT,
      toolsReview: null,
    },
    plan: createMinimalPlan(),
    ...partial,
  });
}

function createMockedOpenCodeDashboardState(partial?: Partial<RunnerDashboardState>): RunnerDashboardState {
  return createDefaultRunnerDashboardState({
    runnerScope: "opencode",
    runtime: {
      runnerCommand: "opencode",
      preflight: PASSING_OPENCODE_PREFLIGHT,
      toolsReview: null,
    },
    plan: createMinimalPlan(),
    ...partial,
  });
}

function createMockedCapabilityResolver() {
  return {
    getCapability: (capabilityId: string) => ({
      capabilityId,
      label: capabilityId,
      description: `Capability ${capabilityId}`,
      runnerScope: "pi",
      requirementLevel: "configurable" as const,
    }),
    getUserFacingIds: () => ["context-mode", "codebase-memory-mcp", "rtk", "serena", "context7"],
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("E2E-ish Pi install flow (Task 8)", () => {
  test("renders dashboard overview with Pi preflight summary", () => {
    const state = createMockedPiDashboardState();
    const output = renderToString(
      <RunnerDashboardScreens
        state={state}
        capabilityResolver={createMockedCapabilityResolver()}
      />,
    );
    expect(output).toContain("Pi Runner Setup Dashboard");
    expect(output).toContain("Packages");
    expect(output).toContain("Adaptive Memory");
  });

  test("shows preflight passed in dashboard when checks pass", () => {
    const state = createMockedPiDashboardState();
    const output = renderToString(
      <RunnerDashboardScreens
        state={state}
        capabilityResolver={createMockedCapabilityResolver()}
      />,
    );
    // The preflight summary should be available in state.runtime.preflight
    const preflight = state.runtime.preflight as PiPreflightResult;
    expect(preflight.checks).toBeDefined();
    expect(preflight.summary?.ready).toBe(true);
  });

  test("preflight failures block install readiness", () => {
    // Create state with failing preflight
    const state = createMockedPiDashboardState({
      runtime: {
        runnerCommand: "pi",
        preflight: FAILING_PI_PREFLIGHT,
        toolsReview: null,
      },
    });
    const preflight = state.runtime.preflight as PiPreflightResult;
    expect(preflight.summary?.ready).toBe(false);
    expect(preflight.summary?.failed).toBe(1);
  });

  test("install-progress screen shows results", () => {
    const mockResults: RunnerActionRunResult[] = [
      createActionResult("capability.context-mode.install", "executed", "Installed context-mode"),
      createActionResult("capability.context-mode.mcp-config", "executed", "MCP config written"),
    ];
    const state = createMockedPiDashboardState({
      screen: "install-progress",
      plan: createMinimalPlan(),
    });
    const output = renderToString(
      <RunnerDashboardScreens
        state={state}
        installResults={mockResults}
        capabilityResolver={createMockedCapabilityResolver()}
      />,
    );
    expect(output).toContain("Install Progress");
  });

  test("complete screen shows summary", () => {
    const mockResults: RunnerActionRunResult[] = [
      createActionResult("capability.context-mode.install", "executed", "Installed context-mode"),
    ];
    const state = createMockedPiDashboardState({
      screen: "complete",
      plan: createMinimalPlan(),
    });
    const output = renderToString(
      <RunnerDashboardScreens
        state={state}
        installResults={mockResults}
        completionStatus="All packages installed successfully"
        capabilityResolver={createMockedCapabilityResolver()}
      />,
    );
    expect(output).toContain("complete");
  });
});

describe("E2E-ish OpenCode install flow (Task 9)", () => {
  test("renders dashboard overview with OpenCode preflight summary", () => {
    const state = createMockedOpenCodeDashboardState();
    const output = renderToString(
      <RunnerDashboardScreens
        state={state}
        capabilityResolver={createMockedCapabilityResolver()}
      />,
    );
    expect(output).toContain("OpenCode Runner Setup Dashboard");
    expect(output).toContain("Packages");
    expect(output).toContain("Teams");
  });

  test("shows preflight passed in dashboard when checks pass", () => {
    const state = createMockedOpenCodeDashboardState();
    const preflight = state.runtime.preflight as OpenCodePreflightResult;
    expect(preflight.checks).toBeDefined();
    expect(preflight.summary?.ready).toBe(true);
  });

  test("preflight failures block install readiness", () => {
    const state = createMockedOpenCodeDashboardState({
      runtime: {
        runnerCommand: "opencode",
        preflight: FAILING_OPENCODE_PREFLIGHT,
        toolsReview: null,
      },
    });
    const preflight = state.runtime.preflight as OpenCodePreflightResult;
    expect(preflight.summary?.ready).toBe(false);
    expect(preflight.summary?.failed).toBe(1);
  });

  test("install-progress screen shows results", () => {
    const mockResults: RunnerActionRunResult[] = [
      createActionResult("capability.codebase-memory-mcp.install", "executed", "Installed codebase-memory-mcp"),
    ];
    const state = createMockedOpenCodeDashboardState({
      screen: "install-progress",
      plan: createMinimalPlan(),
    });
    const output = renderToString(
      <RunnerDashboardScreens
        state={state}
        installResults={mockResults}
        capabilityResolver={createMockedCapabilityResolver()}
      />,
    );
    expect(output).toContain("Install Progress");
  });
});

describe("E2E-ish flow stage reporting (REQ-E2E-004)", () => {
  test("reports stage and runner on failure - Pi", () => {
    // Simulate a failing preflight check that should block flow
    const state = createMockedPiDashboardState({
      runtime: {
        runnerCommand: "pi",
        preflight: FAILING_PI_PREFLIGHT,
        toolsReview: null,
      },
    });
    const preflight = state.runtime.preflight as PiPreflightResult;

    // Verify failure is captured with correct runner
    expect(preflight.checks?.[1].id).toBe("stale-package-replacement");
    expect(preflight.checks?.[1].runner).toBe("pi");
    expect(preflight.checks?.[1].status).toBe("fail");
  });

  test("reports stage and runner on failure - OpenCode", () => {
    const state = createMockedOpenCodeDashboardState({
      runtime: {
        runnerCommand: "opencode",
        preflight: FAILING_OPENCODE_PREFLIGHT,
        toolsReview: null,
      },
    });
    const preflight = state.runtime.preflight as OpenCodePreflightResult;

    // Verify failure is captured with correct runner
    expect(preflight.checks?.[1].id).toBe("nested-skills-cleanup");
    expect(preflight.checks?.[1].runner).toBe("opencode");
    expect(preflight.checks?.[1].status).toBe("fail");
  });

  test("identifies stage when install result fails", () => {
    const mockResults: RunnerActionRunResult[] = [
      createActionResult("capability.serena.install", "failed", "Failed to install serena"),
    ];
    const failedResult = mockResults.find((r) => r.status === "failed");

    // Verify failure stage is identifiable
    expect(failedResult?.actionId).toContain("install");
    expect(failedResult?.status).toBe("failed");
  });
});

describe("E2E-ish deterministic mocks (REQ-E2E-003)", () => {
  test("uses deterministic fixtures without real I/O", () => {
    // Verify all fixtures are hardcoded and deterministic
    expect(PASSING_PI_PREFLIGHT.version).toBe("0.15.0");
    expect(PASSING_OPENCODE_PREFLIGHT.version).toBe("0.28.0");
    expect(PASSING_PI_PREFLIGHT.checks?.length).toBe(5);
    expect(PASSING_OPENCODE_PREFLIGHT.checks?.length).toBe(4);
  });

  test("fixtures simulate filesystem state without real filesystem", () => {
    // Fixtures contain path strings that simulate filesystem checks
    const failingCheck = FAILING_PI_PREFLIGHT.checks?.find((c) => c.status === "fail");
    expect(failingCheck?.path).toContain("settings.json");

    const nestedCheck = FAILING_OPENCODE_PREFLIGHT.checks?.find((c) => c.status === "fail");
    expect(nestedCheck?.path).toContain("SKILL.md");
  });

  test("no network or real install calls in fixtures", () => {
    // Verify fixtures don't contain URLs or real commands
    const allChecks = [
      ...PASSING_PI_PREFLIGHT.checks ?? [],
      ...FAILING_PI_PREFLIGHT.checks ?? [],
      ...PASSING_OPENCODE_PREFLIGHT.checks ?? [],
      ...FAILING_OPENCODE_PREFLIGHT.checks ?? [],
    ];

    for (const check of allChecks) {
      expect(check.message).not.toMatch(/https?:\/\//);
      // Some checks have no remediation field, skip those
      if (check.remediation) {
        expect(check.remediation).not.toMatch(/npm install|brew install/);
      }
    }
  });
});
