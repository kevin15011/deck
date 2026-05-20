import {
  applyDeveloperTeamInstall,
  buildDeveloperTeamInstallPlan,
  getPiInstallableTool,
  installInternalRunnerPackages,
  installPiTools,
  validateSupermemoryPiMcpConfig,
  writeSupermemoryPiMcpConfig,
  type DeveloperTeamApplyResult,
  type DeveloperTeamInstallPlan,
  type InstallablePiTool,
  type InternalRunnerInstallResult,
  type InternalRunnerPackageInstallAction,
  type PiToolInstallResult,
} from "@deck/adapter-pi";
import { writeDeckConfig, type NormalizedDeckConfig } from "@deck/core/config/deck-config";
import type { AdaptiveMemoryProvider } from "@deck/core/memory/adaptive-memory";
import { resolvePiAdaptiveMemoryProvider, type ResolvedPiAdaptiveMemoryProvider } from "../../pi-launch-command";
import type { PiRunnerAction, PiRunnerDashboardState, PiRunnerReviewPlan } from "./state";

export type PiRunnerActionRunStatus = "executed" | "informational" | "skipped" | "failed";

export type PiRunnerActionRunResult = {
  actionId: string;
  status: PiRunnerActionRunStatus;
  message: string;
  diagnostics: string[];
  raw?: unknown;
};

export type PiRunnerActionRunnerDependencies = {
  projectRoot?: string;
  piCommand?: string;
  dashboardState?: PiRunnerDashboardState;
  supermemoryToken?: string;
  memoryProvider?: AdaptiveMemoryProvider;
  resolvedMemoryProvider?: AdaptiveMemoryProvider;
  resolveAdaptiveMemoryProvider?: typeof resolvePiAdaptiveMemoryProvider;
  piMcpConfigPath?: string;
  piMcpHomeDir?: string;
  installPiTools?: typeof installPiTools;
  installInternalRunnerPackages?: typeof installInternalRunnerPackages;
  writeDeckConfig?: typeof writeDeckConfig;
  writeSupermemoryPiMcpConfig?: typeof writeSupermemoryPiMcpConfig;
  validateSupermemoryPiMcpConfig?: typeof validateSupermemoryPiMcpConfig;
  buildDeveloperTeamInstallPlan?: typeof buildDeveloperTeamInstallPlan;
  applyDeveloperTeamInstall?: typeof applyDeveloperTeamInstall;
  onActionResult?: (result: PiRunnerActionRunResult) => void;
  onInstallResult?: (result: PiToolInstallResult) => void;
};

export function getPiRunnerReviewPlanRunBlockDiagnostics(
  state?: PiRunnerDashboardState,
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

export async function runPiRunnerReviewPlan(
  plan: PiRunnerReviewPlan,
  dependencies: PiRunnerActionRunnerDependencies = {},
): Promise<PiRunnerActionRunResult[]> {
  const runBlockDiagnostics = getPiRunnerReviewPlanRunBlockDiagnostics(dependencies.dashboardState, {
    supermemoryToken: dependencies.supermemoryToken,
  });
  if (runBlockDiagnostics.length > 0) {
    const blockedResult: PiRunnerActionRunResult = {
      actionId: "review-plan.preflight",
      status: "failed",
      message: "Review & Install is blocked until Supermemory setup is complete.",
      diagnostics: runBlockDiagnostics,
    };
    dependencies.onActionResult?.(blockedResult);
    return [blockedResult];
  }

  const results: PiRunnerActionRunResult[] = [];
  const runAndRecord = async (action: PiRunnerAction, deps: PiRunnerActionRunnerDependencies = dependencies) => {
    const result = await runPiRunnerAction(action, deps);
    results.push(result);
    dependencies.onActionResult?.(result);
    return result;
  };

  // Security boundary: visible config writes happen first. Supermemory credentials
  // are persisted only by the write-pi-mcp-config action inside Review & Install.
  for (const action of plan.groups.configWrites) {
    const result = await runAndRecord(action);
    if (action.kind === "write-pi-mcp-config" && result.status === "failed") return results;
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

export async function runPiRunnerAction(
  action: PiRunnerAction,
  dependencies: PiRunnerActionRunnerDependencies = {},
): Promise<PiRunnerActionRunResult> {
  if (action.status === "blocked" || action.status === "pending" || action.kind === "pending-source" || action.kind === "noop") {
    return informationalResult(action, action.status === "blocked" ? "Blocked action requires follow-up before execution." : "Pending/no-op action recorded without execution.");
  }

  if (action.kind === "manual-external-install") {
    return informationalResult(action, "Manual external install required; no command was executed.");
  }

  try {
    switch (action.kind) {
      case "install-pi-package":
        return await runPiPackageInstall(action, dependencies);
      case "write-deck-config":
        return writeDeckConfigAction(action, dependencies);
      case "write-pi-mcp-config":
        return writePiMcpConfigAction(action, dependencies);
      case "apply-team-bundle":
        return applyTeamBundleAction(action, dependencies);
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

async function runPiPackageInstall(
  action: PiRunnerAction,
  dependencies: PiRunnerActionRunnerDependencies,
): Promise<PiRunnerActionRunResult> {
  // Fix #1: Detect internal package install actions BEFORE the piCommand check.
  // These actions are routed through installInternalRunnerPackages() (not buildInstallableTool()).
  if (action.internalPackageId) {
    return await runInternalPackageInstall(action, dependencies);
  }

  if (!dependencies.piCommand) {
    return skippedResult(action, "Pi command is required to install Pi packages; run preflight or provide dependencies.piCommand before installation.");
  }

  const tool = buildInstallableTool(action);
  if (!tool) {
    return {
      actionId: action.id,
      status: "failed",
      message: action.toolId ? "Install action references an unknown Pi installable tool." : "Install action is missing required toolId metadata.",
      diagnostics: redactDiagnostics(action.diagnostics ?? []),
    };
  }

  const runner = dependencies.installPiTools ?? installPiTools;
  const installResults = await runner(
    dependencies.piCommand,
    [tool],
    dependencies.onInstallResult ?? (() => undefined),
  );

  if (installResults.length === 0) {
    return {
      actionId: action.id,
      status: "failed",
      message: `Pi package installer returned no result for ${tool.name}; installation outcome is unknown and was not reported as success.`,
      diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...installResults.flatMap((result) => result.message ? [result.message] : [])]),
      raw: redactRaw(installResults),
    };
  }

  const failed = installResults.some((result) => !result.success);

  return {
    actionId: action.id,
    status: failed ? "failed" : "executed",
    message: failed ? "Pi package install reported a failure." : `Installed ${tool.name} with pi install ${tool.source}.`,
    diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...installResults.flatMap((result) => result.message ? [result.message] : [])]),
    raw: redactRaw(installResults),
  };
}

/**
 * Runs internal runner package install actions via the dedicated executor.
 *
 * Fix #1: Internal package install actions (identified by `internalPackageId`) are routed
 * here instead of through `buildInstallableTool()`, which only handles user-facing
 * `PI_INSTALLABLE_TOOLS` entries. Preserves `visual_support_install_failed` error code
 * on failure.
 */
async function runInternalPackageInstall(
  action: PiRunnerAction,
  dependencies: PiRunnerActionRunnerDependencies,
): Promise<PiRunnerActionRunResult> {
  // Build the internal install action from plan metadata.
  // The plan action has internalPackageId + source (no toolId).
  // source is typed as `npm:${string}` in the plan so this cast is always valid.
  const installAction: InternalRunnerPackageInstallAction = {
    packageId: action.internalPackageId!,
    name: action.title,
    source: (action.source as `npm:${string}`) ?? `npm:${action.internalPackageId}`,
    installKind: "npm-package",
    reason: action.diagnostics?.[0] ?? `${action.internalPackageId} is required but not installed.`,
  };

  const runner = dependencies.installInternalRunnerPackages ?? installInternalRunnerPackages;
  const installResults = await runner(
    dependencies.piCommand ?? undefined,
    [installAction],
    (result: InternalRunnerInstallResult) => {
      dependencies.onActionResult?.({
        actionId: action.id,
        status: result.success ? "executed" : "failed",
        message: result.success
          ? `Installed visual explanation support with pi install ${result.packageId}.`
          : "Visual explanation support install failed.",
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
    message: result.success
      ? "Installed visual explanation support."
      : "Visual explanation support install failed.",
    diagnostics: result.message ? redactDiagnostics([result.message]) : [],
    raw: redactRaw(result),
  };
}

function writeDeckConfigAction(
  action: PiRunnerAction,
  dependencies: PiRunnerActionRunnerDependencies,
): PiRunnerActionRunResult {
  const projectRoot = dependencies.projectRoot;
  if (!projectRoot) {
    return skippedResult(action, "Project root is required to write .deck/config.json.");
  }

  const state = dependencies.dashboardState;
  const provider = state?.adaptiveMemory.provider ?? "none";
  const supermemory = state?.adaptiveMemory.supermemory;
  const config = provider === "supermemory"
    ? {
        version: 1,
        adaptiveMemory: {
          activeProvider: "supermemory",
          supermemory: {
            userId: supermemory?.userId,
            teamId: supermemory?.teamId,
            orgId: supermemory?.organizationId,
          },
        },
      }
    : {
        version: 1,
        adaptiveMemory: { activeProvider: provider },
      };

  const writer = dependencies.writeDeckConfig ?? writeDeckConfig;
  const written = writer(projectRoot, removeUndefinedDeep(config)) as NormalizedDeckConfig;

  return {
    actionId: action.id,
    status: "executed",
    message: `Wrote non-secret Deck config for Adaptive Memory provider '${written.adaptiveMemory.activeProvider}'.`,
    diagnostics: redactDiagnostics(action.diagnostics ?? []),
    raw: redactRaw(written),
  };
}

function writePiMcpConfigAction(
  action: PiRunnerAction,
  dependencies: PiRunnerActionRunnerDependencies,
): PiRunnerActionRunResult {
  const token = dependencies.supermemoryToken;
  if (!token?.trim()) {
    return {
      actionId: action.id,
      status: "failed",
      message: "Supermemory token is required for Pi MCP credential handoff and was not provided.",
      diagnostics: redactDiagnostics(action.diagnostics ?? []),
    };
  }

  const writer = dependencies.writeSupermemoryPiMcpConfig ?? writeSupermemoryPiMcpConfig;
  const result = writer({ token, serverName: "supermemory", configPath: dependencies.piMcpConfigPath, homeDir: dependencies.piMcpHomeDir });

  return {
    actionId: action.id,
    status: result.ok ? "executed" : "failed",
    message: result.ok ? "Configured Supermemory Pi MCP credentials with redacted diagnostics." : "Failed to configure Supermemory Pi MCP credentials.",
    diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...result.diagnostics.map((diagnostic) => diagnostic.message)]),
    raw: redactRaw(result),
  };
}

function applyTeamBundleAction(
  action: PiRunnerAction,
  dependencies: PiRunnerActionRunnerDependencies,
): PiRunnerActionRunResult {
  const projectRoot = dependencies.projectRoot;
  if (!projectRoot) {
    return skippedResult(action, "Project root is required to apply Developer Team bundle.");
  }

  const state = dependencies.dashboardState;
  const team = state?.teams["developer-team"];
  const planBuilder = dependencies.buildDeveloperTeamInstallPlan ?? buildDeveloperTeamInstallPlan;
  const applier = dependencies.applyDeveloperTeamInstall ?? applyDeveloperTeamInstall;
  const installPlan: DeveloperTeamInstallPlan = planBuilder(projectRoot, {
    modelAssignments: team?.modelAssignments,
    thinkingAssignments: team?.thinkingAssignments,
    memoryProvider: dependencies.resolvedMemoryProvider ?? dependencies.memoryProvider,
  });
  const applyResult: DeveloperTeamApplyResult = applier(installPlan);

  return {
    actionId: action.id,
    status: "executed",
    message: `Applied Developer Team bundle (${applyResult.results.length} files checked).`,
    diagnostics: redactDiagnostics([
      ...action.diagnostics ?? [],
      ...installPlan.memoryDiagnostics.map((diagnostic) => diagnostic.message),
    ]),
    raw: redactRaw(applyResult),
  };
}

function validateAction(action: PiRunnerAction, dependencies: PiRunnerActionRunnerDependencies): PiRunnerActionRunResult {
  if (action.id === "adaptive-memory.supermemory.validate") {
    const validator = dependencies.validateSupermemoryPiMcpConfig ?? validateSupermemoryPiMcpConfig;
    const result = validator({ configPath: dependencies.piMcpConfigPath, homeDir: dependencies.piMcpHomeDir });
    return {
      actionId: action.id,
      status: result.ok ? "executed" : "failed",
      message: result.ok ? "Validated Supermemory Pi MCP config." : "Supermemory Pi MCP config validation failed.",
      diagnostics: redactDiagnostics([...action.diagnostics ?? [], ...result.diagnostics.map((diagnostic) => diagnostic.message)]),
      raw: redactRaw(result),
    };
  }

  return {
    actionId: action.id,
    status: "executed",
    message: "Validation action recorded for post-install checks.",
    diagnostics: redactDiagnostics(action.diagnostics ?? []),
  };
}

function resolveMemoryProviderAfterConfigWrite(
  dependencies: PiRunnerActionRunnerDependencies,
): { provider?: AdaptiveMemoryProvider; blocker?: PiRunnerActionRunResult } {
  if (dependencies.memoryProvider) return { provider: dependencies.memoryProvider };

  const state = dependencies.dashboardState;
  if (!state || state.adaptiveMemory.provider === "none") return {};

  const resolver = dependencies.resolveAdaptiveMemoryProvider ?? resolvePiAdaptiveMemoryProvider;
  const resolved: ResolvedPiAdaptiveMemoryProvider = resolver({
    activeProvider: state.adaptiveMemory.provider,
    supermemory: dashboardSupermemoryConfig(state),
    piMcpConfigPath: dependencies.piMcpConfigPath,
    piMcpHomeDir: dependencies.piMcpHomeDir,
    unavailableContext: "install",
  });

  if (resolved.provider) return { provider: resolved.provider };

  if (state.adaptiveMemory.provider === "supermemory" || state.adaptiveMemory.provider === "engram") {
    return {
      blocker: {
        actionId: "adaptive-memory.provider.resolve",
        status: "failed",
        message: "Adaptive-memory provider could not be resolved after config writes; team bundle was not applied.",
        diagnostics: redactDiagnostics(resolved.diagnostics.map((diagnostic) => diagnostic.message)),
      },
    };
  }

  return {};
}

function dashboardSupermemoryConfig(state: PiRunnerDashboardState) {
  const supermemory = state.adaptiveMemory.supermemory;
  if (state.adaptiveMemory.provider !== "supermemory" || !supermemory?.userId) return undefined;
  return {
    mcpServerName: "supermemory",
    userId: supermemory.userId,
    ...(supermemory.teamId ? { teamId: supermemory.teamId } : {}),
    ...(supermemory.organizationId ? { orgId: supermemory.organizationId } : {}),
    searchMode: "memories" as const,
    maxMemoriesPerSession: 7,
  };
}

function buildInstallableTool(action: PiRunnerAction): InstallablePiTool | undefined {
  if (!action.toolId) return undefined;

  const tool = getPiInstallableTool(action.toolId);
  if (tool) return tool;

  if (!action.source) return undefined;

  return {
    id: action.toolId,
    name: action.title,
    source: action.source,
    required: Boolean(action.required),
    installKind: "pi-package",
  };
}

function informationalResult(action: PiRunnerAction, message: string): PiRunnerActionRunResult {
  return {
    actionId: action.id,
    status: "informational",
    message,
    diagnostics: redactDiagnostics(action.diagnostics ?? []),
  };
}

function skippedResult(action: PiRunnerAction, message: string): PiRunnerActionRunResult {
  return {
    actionId: action.id,
    status: "skipped",
    message,
    diagnostics: redactDiagnostics(action.diagnostics ?? []),
  };
}

function isBlockingSetupDiagnostic(diagnostic: string): boolean {
  return !/Supermemory token captured ephemerally for Review & Install; no Pi MCP config was written yet\./i.test(diagnostic);
}

function redactDiagnostics(diagnostics: string[]): string[] {
  return diagnostics.map(redact);
}

function redactRaw(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactRaw);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => {
      if (isSensitiveKey(key)) return [key, "[REDACTED]"];
      return [key, redactRaw(entry)];
    }),
  );
}

function isSensitiveKey(key: string): boolean {
  return /token|secret|password|credential|api[-_]?key|x-supermemory-api-key/i.test(key);
}

function redact(value: string): string {
  return value
    .replace(/sk-sm-[A-Za-z0-9._~+/-]+/g, "[REDACTED]")
    .replace(/(x-supermemory-api-key["'\s:=]+)[^\s\"'}]+/gi, "$1[REDACTED]")
    .replace(/(api[-_]?key["'\s:=]+)[^\s\"'}]+/gi, "$1[REDACTED]")
    .replace(/(token["'\s:=]+)[^\s\"'}]+/gi, "$1[REDACTED]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [REDACTED]");
}

function removeUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(removeUndefinedDeep) as T;
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .map(([key, entry]) => [key, removeUndefinedDeep(entry)]),
  ) as T;
}