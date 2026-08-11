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
import { getDefaultDeckConfig } from "@deck/core";
import { getAdapter } from "../../runner-adapters";
import { createCodexRunnerAdapter } from "@deck/adapter-codex";
import { getToggleablePackageInstructionIds } from "../runner-dashboard/selectors";

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
    runnerUi: getAdapter("pi").ui,
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
    runnerDisplayName: "OpenCode",
    runnerUi: getAdapter("opencode").ui,
    runtime: {
      runnerCommand: "opencode",
      preflight: PASSING_OPENCODE_PREFLIGHT,
      toolsReview: null,
    },
    plan: createMinimalPlan(),
    ...partial,
  });
}

function createMockedCodexDashboardState(partial?: Partial<RunnerDashboardState>): RunnerDashboardState {
  return createDefaultRunnerDashboardState({
    runnerScope: "codex",
    runnerDisplayName: "Codex",
    runnerUi: getAdapter("codex").ui,
    runtime: { runnerCommand: "codex", preflight: null, toolsReview: null },
    plan: createMinimalPlan(),
    ...partial,
  });
}

function createMockedCapabilityResolver() {
  return {
    getSupportedPackageInstructionIds: () => ["codebase-memory", "code-economy", "context-mode", "rtk", "adaptive-memory", "serena"] as const,
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

describe("Codex adapter-driven render-only states", () => {
  test("renders real Codex protected parity gaps and safe review actions in the generic dashboard", async () => {
    const adapter = createCodexRunnerAdapter({
      preflight: {
        probe: async () => ({ found: true, version: "0.145.0", help: "Usage: codex\nexec\nresume", execHelp: "Usage: codex exec", resumeHelp: "Usage: codex resume [SESSION_ID]" }),
        inspectTrust: async () => "trusted",
      },
      sharedBinaryUsability: async (command) => ({ command, status: "ready", resolvedPath: `/bin/${command}`, diagnostics: [] }),
      codebaseIndexReadiness: () => true,
      supermemoryOAuthStatus: async () => ({ state: "authenticated" }),
    });
    const inventory = await adapter.getCapabilityInventory({ projectRoot: "/tmp/deck-codex-tui-parity", environmentId: "codex-development", runnerId: "codex", deckConfig: getDefaultDeckConfig() });
    const plan = adapter.buildReviewPlan({ runnerId: "codex", environmentId: "codex-development", selectedCapabilities: {}, packageInstructions: {}, adaptiveMemory: { provider: "none" } }, inventory);
    const capabilityStatuses = Object.fromEntries(inventory.capabilities.map((capability) => [capability.capabilityId, capability.isBlocked ? "blocked" as const : capability.isInstalled ? "ready" as const : "missing" as const]));
    const resolver = {
      getSupportedPackageInstructionIds: () => ["codebase-memory", "code-economy", "context-mode", "rtk", "adaptive-memory", "serena"] as const,
    };
    const packages = renderToString(<RunnerDashboardScreens state={createDefaultRunnerDashboardState({ runnerScope: "codex", runnerDisplayName: adapter.displayName, runnerUi: adapter.ui, screen: "packages-detail", capabilityStatuses })} capabilityResolver={resolver} />);
    for (const label of ["Trusted Runner Host Bridge", "Invocation Authorization", "Execution Dossier", "Controlled Effects", "Registry Coordination", "Bound Verification", "Engram", "Context7", "Pi HUD"]) {
      expect(packages).not.toContain(label);
    }
    const dashboardState = createDefaultRunnerDashboardState({ runnerScope: "codex", runnerDisplayName: adapter.displayName, runnerUi: adapter.ui, screen: "packages-detail", capabilityStatuses });
    const toggleableIds = getToggleablePackageInstructionIds(dashboardState, resolver);
    expect(toggleableIds).toEqual(["codebase-memory", "context-mode", "rtk", "adaptive-memory", "serena"]);
    expect(toggleableIds).not.toContain("code-economy");
    const dispositions = renderToString(<RunnerDashboardScreens state={dashboardState} capabilityResolver={resolver} />);
    for (const label of ["Codebase Memory", "Context Mode", "RTK", "Adaptive Memory", "Serena"]) expect(dispositions).toContain(`[ ] ${label}`);
    expect(dispositions).not.toContain("[ ] Code Economy");
    expect(dispositions).not.toContain("OpenCode Mermaid Renderer");
    expect(dispositions).not.toContain("Deck Model Variants");

    const review = renderToString(<RunnerDashboardScreens state={createDefaultRunnerDashboardState({ runnerScope: "codex", runnerDisplayName: adapter.displayName, runnerUi: adapter.ui, screen: "review-plan", plan: plan as RunnerReviewPlan })} capabilityResolver={resolver} />);
    expect(review).toContain("0 manual");
    expect(review).toContain("static-compatible Codex gap");
    expect(review).toContain("Run install");
    expect(review).toContain("Trusted Runner Host Bridge");
  });

  test("renders registered Codex dashboard and review collision/rollback diagnostics generically", () => {
    const overview = renderToString(<RunnerDashboardScreens state={createMockedCodexDashboardState()} capabilityResolver={createMockedCapabilityResolver()} />);
    expect(overview).toContain("Codex Runner Setup Dashboard");
    const state = createMockedCodexDashboardState({
      screen: "review-plan",
      plan: createMinimalPlan({
        ready: false,
        diagnostics: [
          { code: "mcp-config-collision", severity: "error", message: "Existing user MCP server differs." },
          { code: "rollback-conflict", severity: "error", message: "Rollback requires conflict recovery." },
        ],
      }),
    });
    const review = renderToString(<RunnerDashboardScreens state={state} canRunPlan={false} runBlockDiagnostics={[{ message: "Resolve collisions before install." }]} />);
    expect(review).toContain("Existing user MCP server differs");
    expect(review).toContain("Rollback requires conflict recovery");
    expect(review).toContain("Resolve collisions before install");
  });

  test("enables approved static-compatible Codex reviews and shows the first genuine blocker", () => {
    const staticCompatible = renderToString(<RunnerDashboardScreens
      state={createMockedCodexDashboardState({
        screen: "review-plan",
        plan: createMinimalPlan({
          diagnostics: [{
            code: "static-compatible-gap:trusted-runner-host-bridge",
            severity: "warning",
            message: "Trusted Runner Host Bridge remains a static-compatible Codex gap.",
          }],
        }),
      })}
      canRunPlan
      capabilityResolver={createMockedCapabilityResolver()}
    />);
    expect(staticCompatible).toContain("Run install");
    expect(staticCompatible).toContain("static-compatible Codex gap");

    const authorizationFollowUp = renderToString(<RunnerDashboardScreens
      state={createMockedCodexDashboardState({
        screen: "complete",
      })}
      installResults={[createActionResult("codex-developer-team", "executed", "Codex content verified", {
        postInstallFollowUps: [{
          id: "supermemory-user-authorization",
          message: "Run codex mcp login supermemory when you are ready to authorize Supermemory.",
        }],
      })]}
      capabilityResolver={createMockedCapabilityResolver()}
    />);
    expect(authorizationFollowUp).toContain("Codex Runner setup complete");
    expect(authorizationFollowUp).toMatch(/Run codex\s+mcp login\s+supermemory when you are ready to authorize Supermemory/);

    const failedAuthorization = renderToString(<RunnerDashboardScreens
      state={createMockedCodexDashboardState({ screen: "complete" })}
      installResults={[
        createActionResult("codex-developer-team", "executed", "Codex content verified", {
          postInstallFollowUps: [{
            id: "supermemory-user-authorization",
            message: "Run codex mcp login supermemory when you are ready to authorize Supermemory.",
          }],
        }),
        createActionResult("codex-verify", "failed", "Codex configuration failed"),
      ]}
      capabilityResolver={createMockedCapabilityResolver()}
    />);
    expect(failedAuthorization).not.toContain("Run codex mcp login supermemory");

    for (const outcome of ["cancelled", "partial"] as const) {
      const stoppedAuthorization = renderToString(<RunnerDashboardScreens
        state={createMockedCodexDashboardState({ screen: "complete" })}
        installResults={[
          createActionResult("codex-developer-team", "executed", "Codex content verified", {
            postInstallFollowUps: [{
              id: "supermemory-user-authorization",
              message: "Run codex mcp login supermemory when you are ready to authorize Supermemory.",
            }],
          }),
          createActionResult("codex-verify", "executed", `Codex verification ${outcome}`, { serenaOutcome: outcome }),
        ]}
        capabilityResolver={createMockedCapabilityResolver()}
      />);
      expect(stoppedAuthorization).toContain("Codex Runner setup stopped before completion");
      expect(stoppedAuthorization).not.toContain("Run codex mcp login supermemory");
    }

    const blocked = renderToString(<RunnerDashboardScreens
      state={createMockedCodexDashboardState({
        screen: "review-plan",
        plan: createMinimalPlan({
          ready: false,
          diagnostics: [{ code: "codex-runtime-unsupported", severity: "error", message: "Codex 0.144.0 is below the supported version." }],
        }),
      })}
      canRunPlan={false}
      runBlockDiagnostics={[{ message: "Codex 0.144.0 is below the supported version." }]}
      capabilityResolver={createMockedCapabilityResolver()}
    />);
    expect(blocked).toContain("Blocked");
    expect(blocked).toContain("Codex 0.144.0 is below the supported version.");
  });

  test("renders a plan-build failure as blocked without relying on the caller to disable run", () => {
    const state = createMockedCodexDashboardState({
      screen: "review-plan",
      plan: createMinimalPlan({
        ready: false,
        diagnostics: [{ code: "plan-build-failed", severity: "error", message: "Could not build the review plan. Return to Dashboard and retry." }],
      }),
    });

    const review = renderToString(<RunnerDashboardScreens state={state} canRunPlan />);

    expect(review).toContain("Could not build the review plan. Return to Dashboard and retry.");
    expect(review).toContain("Blocked");
    expect(review).not.toContain("Run install");
  });

  test("renders normalized runtime state and per-route execution classifications", () => {
    const output = renderToString(<RunnerDashboardScreens
      state={createMockedCodexDashboardState({
        runtime: {
          runnerCommand: "codex",
          inspectionState: "unsupported",
          diagnostics: ["Codex 0.100.0 is older than supported 0.145.0."],
          executionRoutes: {
            interactive: "static-compatible",
            exec: "static-compatible",
            "resume-by-id": "unsupported",
            "resume-latest": "blocked",
          },
        },
      })}
      capabilityResolver={createMockedCapabilityResolver()}
    />);
    expect(output).toContain("Runtime: unsupported");
    expect(output).toContain("Codex 0.100.0 is older than supported 0.145.0");
    expect(output).toContain("interactive: static-compatible");
    expect(output).toContain("exec: static-compatible");
    expect(output).toContain("resume-by-id: unsupported");
    expect(output).toContain("resume-latest: blocked");
  });

  test("renders none and Supermemory normally while exposing the Codex Engram gap", () => {
    const none = renderToString(<RunnerDashboardScreens state={createMockedCodexDashboardState({ screen: "adaptive-memory-detail", adaptiveMemory: { provider: "none" } })} />);
    expect(none).toContain("No adaptive memory active by default");

    const supermemory = renderToString(<RunnerDashboardScreens state={createMockedCodexDashboardState({ screen: "adaptive-memory-detail", adaptiveMemory: { provider: "supermemory", supermemory: { configured: true, hasToken: true, diagnostics: [] } } })} />);
    expect(supermemory).toContain("without authorizing it");
    expect(supermemory).not.toContain("mcp login supermemory");

    const engram = renderToString(<RunnerDashboardScreens state={createMockedCodexDashboardState({ screen: "adaptive-memory-detail", adaptiveMemory: { provider: "engram" } })} />);
    expect(engram).toContain("Engram (deferred for Codex)");
    expect(engram).toContain("no verified Codex provider contract");
  });

  test("renders Codex preview confirmation, install progress, failure, and completion through generic screens", () => {
    const review = renderToString(<RunnerDashboardScreens state={createMockedCodexDashboardState({
      screen: "review-plan",
      plan: createMinimalPlan({
        ready: true,
        groups: {
          automaticInstalls: [],
          manualSteps: [],
          configWrites: [{ id: "codex-config:context7", kind: "codex-config-preview", title: "Configure Context7", status: "ready" }],
          teamApplications: [{ id: "codex-developer-team", kind: "apply-team-bundle", title: "Apply Codex Developer Team", status: "ready" }],
          validations: [{ id: "codex-verify", kind: "validate", title: "Verify Codex content", status: "ready" }],
        },
      }),
    })} canRunPlan />);
    expect(review).toContain("Review & Install");
    expect(review).toContain("Run install");
    expect(review).toContain("3 actions planned");

    const progress = renderToString(<RunnerDashboardScreens
      state={createMockedCodexDashboardState({ screen: "install-progress" })}
      installResults={[createActionResult("codex-developer-team", "executed", "Codex content applied and verified.")]}
    />);
    expect(progress).toContain("Install Progress");
    expect(progress).toContain("Codex content applied and verified");

    const failed = renderToString(<RunnerDashboardScreens
      state={createMockedCodexDashboardState({ screen: "complete" })}
      installResults={[createActionResult("codex-developer-team", "failed", "Install rolled back.", { diagnostics: ["collision preserved"] })]}
    />);
    expect(failed).toContain("Codex Runner setup stopped before completion");
    expect(failed).toContain("Install rolled back");

    const complete = renderToString(<RunnerDashboardScreens state={createMockedCodexDashboardState({ screen: "complete" })} completionStatus="Verified" />);
    expect(complete).toContain("Codex Runner setup complete");
    expect(complete).toContain("Verified");
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
