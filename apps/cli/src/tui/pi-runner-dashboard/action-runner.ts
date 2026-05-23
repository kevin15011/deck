/**
 * Runtime-agnostic action runner for the dashboard review plan.
 *
 * Works with any runner (Pi, OpenCode, etc.) via injected dependencies.
 * Each adapter provides its own implementations for runtime-specific actions.
 */

import { readDeckConfig, writeDeckConfig, type NormalizedDeckConfig } from "@deck/core/config/deck-config";
import type { AdaptiveMemoryProvider } from "@deck/core/memory/adaptive-memory";
import type { RunnerAction, RunnerDashboardState, RunnerReviewPlan } from "./state";

export type RunnerActionRunStatus = "executed" | "informational" | "skipped" | "failed";

export type RunnerActionRunResult = {
  actionId: string;
  status: RunnerActionRunStatus;
  message: string;
  diagnostics: string[];
  raw?: unknown;
};

/**
 * Generic package installer function — adapters provide their own.
 */
export type PackageInstallerFn = (
  runnerCommand: string | undefined,
  packages: Array<{ name: string; source: string }>,
  onResult: (result: { success: boolean; message?: string }) => void,
) => Promise<Array<{ success: boolean; message?: string }>>;

/**
 * Generic team bundle installer — adapters provide their own.
 */
export type TeamBundleInstallerFn = (
  projectRoot: string,
  options?: { memoryProvider?: AdaptiveMemoryProvider },
) => Promise<{ results: Array<{ agentId: string; kind: string; status: string }> }>;

/**
 * Generic MCP config writer — adapters provide their own.
 */
export type McpConfigWriterFn = (options: { token: string; serverName?: string }) => { ok: boolean; path: string; diagnostics?: string[] };

/**
 * Generic MCP config validator — adapters provide their own.
 */
export type McpConfigValidatorFn = (options: { token: string; serverName?: string }) => { ok: boolean; diagnostics?: string[] };

/**
 * Dependencies for the action runner.
 * Adapters inject their runtime-specific implementations.
 */
export type RunnerActionRunnerDependencies = {
  projectRoot?: string;
  runnerCommand?: string;
  dashboardState?: RunnerDashboardState;
  supermemoryToken?: string;
  memoryProvider?: AdaptiveMemoryProvider;
  resolvedMemoryProvider?: AdaptiveMemoryProvider;
  installPackages?: PackageInstallerFn;
  installTeamBundle?: TeamBundleInstallerFn;
  writeMcpConfig?: McpConfigWriterFn;
  validateMcpConfig?: McpConfigValidatorFn;
  writeDeckConfig?: typeof writeDeckConfig;
  onActionResult?: (result: RunnerActionRunResult) => void;
  onInstallResult?: (result: { success: boolean; message?: string }) => void;
  // Backward-compatible aliases for Pi-specific tests
  piCommand?: string;
  writeSupermemoryPiMcpConfig?: McpConfigWriterFn;
  validateSupermemoryPiMcpConfig?: McpConfigValidatorFn;
  buildDeveloperTeamInstallPlan?: (projectRoot: string, options?: { memoryProvider?: AdaptiveMemoryProvider }) => import("@deck/adapter-pi").DeveloperTeamInstallPlan;
  applyDeveloperTeamInstall?: (projectRoot: string, options?: { memoryProvider?: AdaptiveMemoryProvider }) => import("@deck/adapter-pi").DeveloperTeamApplyResult;
  installInternalRunnerPackages?: (command: string | undefined, actions: Array<{ packageId: string; name: string; source: string; installKind: string; reason: string }>, onResult: (result: { success: boolean; message?: string }) => void) => Promise<Array<{ success: boolean; message?: string }>>;
  resolveAdaptiveMemoryProvider?: (options: { provider: string; supermemoryToken?: string; projectRoot?: string }) => AdaptiveMemoryProvider | undefined;
};

export function getRunnerReviewPlanRunBlockDiagnostics(
  state?: RunnerDashboardState,
  options: { supermemoryToken?: string } = {},
): string[] {
  if (state?.adaptiveMemory.provider !== "supermemory") return [];

  const setup = state.adaptiveMemory.supermemory;
  const diagnostics: string[] = [];
  if (!setup?.configured) diagnostics.push("Supermemory setup is not configured for Review & Install.");
  if (!setup?.userId) diagnostics.push("Supermemory userId is required before Review & Install.");
  if (!setup?.hasToken) diagnostics.push("Supermemory token must be provided ephemerally for Review & Install.");
  if (setup?.hasToken && !options.supermemoryToken?.trim()) diagnostics.push("Supermemory credential was marked ready but the ephemeral credential is no longer available; re-enter setup before Review & Install.");
  diagnostics.push(...(setup?.diagnostics ?? []).filter(isBlockingSetupDiagnostic));
  return redactDiagnostics(diagnostics);
}

export async function runRunnerReviewPlan(
  plan: RunnerReviewPlan,
  dependencies: RunnerActionRunnerDependencies = {},
): Promise<RunnerActionRunResult[]> {
  const runBlockDiagnostics = getRunnerReviewPlanRunBlockDiagnostics(dependencies.dashboardState, {
    supermemoryToken: dependencies.supermemoryToken,
  });
  if (runBlockDiagnostics.length > 0) {
    const blockedResult: RunnerActionRunResult = {
      actionId: "review-plan.preflight",
      status: "failed",
      message: "Review & Install is blocked until Supermemory setup is complete.",
      diagnostics: runBlockDiagnostics,
    };
    dependencies.onActionResult?.(blockedResult);
    return [blockedResult];
  }

  const results: RunnerActionRunResult[] = [];
  const runAndRecord = async (action: RunnerAction, deps: RunnerActionRunnerDependencies = dependencies) => {
    const result = await runRunnerAction(action, deps);
    results.push(result);
    dependencies.onActionResult?.(result);
    return result;
  };

  // Security boundary: visible config writes happen first.
  for (const action of plan.groups.configWrites) {
    const result = await runAndRecord(action);
    if (action.kind === "write-mcp-config" && result.status === "failed") return results;
  }

  for (const action of [...plan.groups.automaticInstalls, ...plan.groups.manualSteps]) {
    await runAndRecord(action);
  }

  const memoryResolution = resolveMemoryProviderAfterConfigWrite(dependencies);
  if (memoryResolution.blocker) {
    results.push(memoryResolution.blocker);
    dependencies.onActionResult?.(memoryResolution.blocker);
    return results;
  }

  const teamDependencies = {
    ...dependencies,
    resolvedMemoryProvider: memoryResolution.provider,
  };

  for (const action of plan.groups.teamApplications) {
    await runAndRecord(action, teamDependencies);
  }

  for (const action of plan.groups.validations) {
    await runAndRecord(action);
  }

  return results;
}

export async function runRunnerAction(
  action: RunnerAction,
  dependencies: RunnerActionRunnerDependencies = {},
): Promise<RunnerActionRunResult> {
  if (action.status === "blocked" || action.status === "pending" || action.kind === "pending-source" || action.kind === "noop") {
    return informationalResult(action, action.status === "blocked" ? "Blocked action requires follow-up before execution." : "Pending/no-op action recorded without execution.");
  }

  if (action.kind === "manual-external-install") {
    return informationalResult(action, "Manual external install required; no command was executed.");
  }

  try {
    switch (action.kind) {
      case "install-pi-package":
      case "install-opencode-plugin":
        return await runPackageInstall(action, dependencies);
      case "write-deck-config":
        return writeDeckConfigAction(action, dependencies);
      case "write-pi-mcp-config":
      case "write-mcp-config":
        return writeMcpConfigAction(action, dependencies);
      case "apply-team-bundle":
        return await applyTeamBundleAction(action, dependencies);
      case "validate":
        return validateAction(action, dependencies);
      default:
        return informationalResult(action, "Action kind is informational for the dashboard runner.");
    }
  } catch (error) {
    return {
      actionId: action.id,
      status: "failed",
      message: redact(error instanceof Error ? error.message : String(error)),
      diagnostics: redactDiagnostics(action.diagnostics ?? []),
    };
  }
}

async function runPackageInstall(
  action: RunnerAction,
  dependencies: RunnerActionRunnerDependencies,
): Promise<RunnerActionRunResult> {
  if (action.internalPackageId) {
    // Internal package — handled by the adapter's installer
    return await runInternalPackageInstall(action, dependencies);
  }

  if (!dependencies.runnerCommand) {
    return skippedResult(action, "Runner command is required to install packages; run preflight or provide dependencies.runnerCommand before installation.");
  }

  const packageName = action.source ?? action.toolId ?? action.id;
  const runner = dependencies.installPackages;
  if (!runner) {
    return skippedResult(action, "Package installer not provided; install requires adapter-specific package installer.");
  }

  const installResults = await runner(
    dependencies.runnerCommand,
    [{ name: packageName, source: action.source ?? "" }],
    dependencies.onInstallResult ?? (() => undefined),
  );

  if (installResults.length === 0) {
    return {
      actionId: action.id,
      status: "failed",
      message: `Package installer returned no result for ${packageName}; installation outcome is unknown.`,
      diagnostics: redactDiagnostics(action.diagnostics ?? []),
      raw: redactRaw(installResults),
    };
  }

  const failed = installResults.some((result) => !result.success);

  return {
    actionId: action.id,
    status: failed ? "failed" : "executed",
    message: failed ? "Package install reported a failure." : `Installed ${packageName}.`,
    diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...installResults.flatMap((result) => result.message ? [result.message] : [])]),
    raw: redactRaw(installResults),
  };
}

async function runInternalPackageInstall(
  action: RunnerAction,
  dependencies: RunnerActionRunnerDependencies,
): Promise<RunnerActionRunResult> {
  const packageName = action.internalPackageId ?? action.id;

  // Primary: use installInternalRunnerPackages if provided
  if (dependencies.installInternalRunnerPackages) {
    const runner = dependencies.installInternalRunnerPackages;
    const installActions = [{ packageId: packageName, name: packageName, source: action.source ?? "", installKind: "pi-package", reason: action.title }];

    const installResults = await runner(
      dependencies.piCommand,
      installActions,
      (result) => {
        dependencies.onActionResult?.({
          actionId: action.id,
          status: result.success ? "executed" : "failed",
          message: result.success ? `Installed ${packageName}.` : `Failed to install ${packageName}.`,
          diagnostics: result.message ? redactDiagnostics([result.message]) : [],
          raw: redactRaw(result),
        });
      },
    );

    const result = installResults[0];
    if (!result) {
      return {
        actionId: action.id,
        status: "failed",
        message: "Internal package installer returned no result.",
        diagnostics: redactDiagnostics(action.diagnostics ?? []),
      };
    }

    return {
      actionId: action.id,
      status: result.success ? "executed" : "failed",
      message: result.success ? `Installed ${packageName}.` : `Failed to install ${packageName}.`,
      diagnostics: result.message ? redactDiagnostics([result.message]) : [],
      raw: redactRaw(result),
    };
  }

  // Fallback: use installPackages if provided (backward compatibility)
  const runner = dependencies.installPackages;
  if (!runner) {
    return skippedResult(action, "Internal package installer not provided.");
  }

  const installResults = await runner(
    dependencies.runnerCommand,
    [{ name: packageName, source: action.source ?? "" }],
    (result) => {
      dependencies.onActionResult?.({
        actionId: action.id,
        status: result.success ? "executed" : "failed",
        message: result.success ? `Installed ${packageName}.` : `Failed to install ${packageName}.`,
        diagnostics: result.message ? redactDiagnostics([result.message]) : [],
        raw: redactRaw(result),
      });
    },
  );

  const result = installResults[0];
  if (!result) {
    return {
      actionId: action.id,
      status: "failed",
      message: "Internal package installer returned no result.",
      diagnostics: redactDiagnostics(action.diagnostics ?? []),
    };
  }

  return {
    actionId: action.id,
    status: result.success ? "executed" : "failed",
    message: result.success ? `Installed ${packageName}.` : `Failed to install ${packageName}.`,
    diagnostics: result.message ? redactDiagnostics([result.message]) : [],
    raw: redactRaw(result),
  };
}

function writeDeckConfigAction(
  action: RunnerAction,
  dependencies: RunnerActionRunnerDependencies,
): RunnerActionRunResult {
  const projectRoot = dependencies.projectRoot;
  if (!projectRoot) {
    return skippedResult(action, "Project root is required to write .deck/config.json.");
  }

  const state = dependencies.dashboardState;
  const provider = state?.adaptiveMemory.provider ?? "none";
  const supermemory = state?.adaptiveMemory.supermemory;

  // Read existing config to preserve OTHER runner's packageInstructions
  const existingConfig = readDeckConfig(projectRoot);

  // Determine current runner scope (defaults to "pi" for backward compatibility)
  const currentRunner: "pi" | "opencode" = (state?.runnerScope ?? "pi") as "pi" | "opencode";

  // Build packageInstructions: preserve other runner's config, update current runner's toggles
  const currentPackageInstructions = state?.packageInstructions ?? {};
  const piInstructions = currentRunner === "pi"
    ? { ...existingConfig.packageInstructions.pi, ...currentPackageInstructions }
    : { ...existingConfig.packageInstructions.pi };
  const opencodeInstructions = currentRunner === "opencode"
    ? { ...existingConfig.packageInstructions.opencode, ...currentPackageInstructions }
    : { ...existingConfig.packageInstructions.opencode };

  const updatedPackageInstructions: NormalizedDeckConfig["packageInstructions"] = {
    pi: {
      "codebase-memory": piInstructions["codebase-memory"] ?? false,
      "context-mode": piInstructions["context-mode"] ?? false,
      rtk: piInstructions.rtk ?? false,
      "adaptive-memory": piInstructions["adaptive-memory"] ?? false,
    },
    opencode: {
      "codebase-memory": opencodeInstructions["codebase-memory"] ?? false,
      "context-mode": opencodeInstructions["context-mode"] ?? false,
      rtk: opencodeInstructions.rtk ?? false,
      "adaptive-memory": opencodeInstructions["adaptive-memory"] ?? false,
    },
  };

  const config: NormalizedDeckConfig = {
    version: 1,
    adaptiveMemory: provider === "supermemory"
      ? {
          activeProvider: "supermemory" as const,
          supermemory: {
            userId: supermemory?.userId,
            teamId: supermemory?.teamId,
            orgId: supermemory?.organizationId,
          },
        }
      : provider === "engram"
        ? { activeProvider: "engram" as const }
        : { activeProvider: "none" as const },
    packageInstructions: updatedPackageInstructions,
  };

  const writer = dependencies.writeDeckConfig ?? writeDeckConfig;
  writer(projectRoot, config);

  return {
    actionId: action.id,
    status: "executed",
    message: `Wrote .deck/config.json with adaptive memory provider: ${provider}.`,
    diagnostics: redactDiagnostics(action.diagnostics ?? []),
  };
}

function writeMcpConfigAction(
  action: RunnerAction,
  dependencies: RunnerActionRunnerDependencies,
): RunnerActionRunResult {
  const token = dependencies.supermemoryToken;
  if (!token?.trim()) {
    return skippedResult(action, "Supermemory token is required for MCP config write.");
  }

  const writer = dependencies.writeMcpConfig;
  if (!writer) {
    return skippedResult(action, "MCP config writer not provided; requires adapter-specific implementation.");
  }

  const result = writer({ token: token.trim(), serverName: "supermemory" });
  if (!result.ok) {
    return {
      actionId: action.id,
      status: "failed",
      message: `MCP config write failed at ${result.path ?? "unknown path"}.`,
      diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...(result.diagnostics ?? [])]),
    };
  }

  return {
    actionId: action.id,
    status: "executed",
    message: `Supermemory MCP config written successfully at ${result.path}.`,
    diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...(result.diagnostics ?? [])]),
  };
}

async function applyTeamBundleAction(
  action: RunnerAction,
  dependencies: RunnerActionRunnerDependencies,
): Promise<RunnerActionRunResult> {
  const projectRoot = dependencies.projectRoot;
  if (!projectRoot) {
    return skippedResult(action, "Project root is required to apply team bundle.");
  }

  const installer = dependencies.installTeamBundle;
  if (!installer) {
    return skippedResult(action, "Team bundle installer not provided; requires adapter-specific implementation.");
  }

  const memoryProvider = dependencies.resolvedMemoryProvider ?? dependencies.memoryProvider;
  const installerResult = await installer(projectRoot, memoryProvider ? { memoryProvider } : undefined);

  const result = installerResult as { results?: Array<{ agentId?: string; kind?: string; status?: string }> };
  const count = result?.results?.length ?? 0;

  return {
    actionId: action.id,
    status: "executed",
    message: `Developer Team bundle installed: ${count} agent(s).`,
    diagnostics: redactDiagnostics(action.diagnostics ?? []),
    raw: redactRaw(result),
  };
}

function validateAction(
  action: RunnerAction,
  dependencies: RunnerActionRunnerDependencies,
): RunnerActionRunResult {
  if (action.id === "adaptive-memory.supermemory.validate") {
    const validator = dependencies.validateMcpConfig;
    if (!validator) {
      return skippedResult(action, "MCP config validator not provided.");
    }

    const token = dependencies.supermemoryToken;
    if (!token?.trim()) {
      return {
        actionId: action.id,
        status: "failed",
        message: "Supermemory token is required for validation.",
        diagnostics: redactDiagnostics(action.diagnostics ?? []),
      };
    }

    const result = validator({ token: token.trim(), serverName: "supermemory" });
    if (!result.ok) {
      return {
        actionId: action.id,
        status: "failed",
        message: "Supermemory MCP config validation failed.",
        diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...(result.diagnostics ?? [])]),
      };
    }

    return {
      actionId: action.id,
      status: "executed",
      message: "Supermemory MCP config validated successfully.",
      diagnostics: redactDiagnostics(action.diagnostics ?? []),
    };
  }

  return informationalResult(action, "Validation action is informational.");
}

function resolveMemoryProviderAfterConfigWrite(
  dependencies: RunnerActionRunnerDependencies,
): { provider?: AdaptiveMemoryProvider; blocker?: RunnerActionRunResult } {
  const state = dependencies.dashboardState;
  if (!state || state.adaptiveMemory.provider === "none") {
    return { provider: undefined };
  }

  if (state.adaptiveMemory.provider === "supermemory") {
    const setup = state.adaptiveMemory.supermemory;
    if (!setup?.configured || !setup?.userId) {
      return {
        blocker: {
          actionId: "adaptive-memory.supermemory.resolve",
          status: "failed",
          message: "Supermemory userId and configuration are required before team bundle installation.",
          diagnostics: ["Supermemory setup is incomplete."],
        },
      };
    }
  }

  const resolver = dependencies.resolveAdaptiveMemoryProvider;
  if (!resolver) {
    return { provider: dependencies.memoryProvider };
  }

  try {
    const resolved = resolver({
      provider: state.adaptiveMemory.provider,
      supermemoryToken: dependencies.supermemoryToken,
      projectRoot: dependencies.projectRoot,
    });
    return { provider: resolved };
  } catch (error) {
    return {
      blocker: {
        actionId: "adaptive-memory.resolve",
        status: "failed",
        message: `Failed to resolve adaptive memory provider: ${error instanceof Error ? error.message : String(error)}`,
        diagnostics: [],
      },
    };
  }
}

function informationalResult(action: RunnerAction, message: string): RunnerActionRunResult {
  return {
    actionId: action.id,
    status: "informational",
    message,
    diagnostics: redactDiagnostics(action.diagnostics ?? []),
  };
}

function skippedResult(action: RunnerAction, message: string): RunnerActionRunResult {
  return {
    actionId: action.id,
    status: "skipped",
    message,
    diagnostics: redactDiagnostics(action.diagnostics ?? []),
  };
}

function isBlockingSetupDiagnostic(diagnostic: string): boolean {
  const lower = diagnostic.toLowerCase();
  return lower.includes("required") || lower.includes("blocked") || lower.includes("failed");
}

function redactDiagnostics(diagnostics: string[]): string[] {
  return diagnostics.map(redact);
}

function redact(value: unknown): string {
  const str = typeof value === "string" ? value : String(value);
  return str
    .replace(/sk-[a-zA-Z0-9]{20,}/g, "[redacted]")
    .replace(/eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/g, "[redacted]");
}

function redactRaw(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactRaw);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = redactRaw(val);
    }
    return result;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Backward-compatible aliases for Pi-specific tests
// ---------------------------------------------------------------------------

export const getPiRunnerReviewPlanRunBlockDiagnostics = getRunnerReviewPlanRunBlockDiagnostics;
export const runPiRunnerAction = runRunnerAction;
export const runPiRunnerReviewPlan = runRunnerReviewPlan;
export type PiRunnerActionRunStatus = RunnerActionRunStatus;
export type PiRunnerActionRunResult = RunnerActionRunResult;
export type PiRunnerActionRunnerDependencies = RunnerActionRunnerDependencies;
