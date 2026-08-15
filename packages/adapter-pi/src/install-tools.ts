import type { TechnicalActionKind } from "./capability-catalog";
import type { InstallablePiTool } from "./installation-plan";
import type { InternalRunnerPackageInstallAction } from "./internal-runner-packages";
import { spawn as nodeSpawn } from "node:child_process";
import {
  bootstrapSerena,
  isSuccessfulSerenaBootstrapResult,
  validateSerenaOperationAuthorization,
  checkSharedBinaryUsability,
  type SerenaBootstrapAuthorization,
  type SerenaBootstrapEffects,
  type SerenaBootstrapRequest,
  type SerenaBootstrapResult,
  type SerenaOperationIdentity,
  type SerenaReadinessEvidence,
} from "@deck/core";

export type PiToolInstallResultStatus =
  | "installed"
  | "manual"
  | "failed"
  | "reused"
  | "blocked"
  | "cancelled"
  | "partial"
  | "manual-verified";

export type PiToolInstallResult = {
  tool: string;
  success: boolean;
  /** Review Plan-compatible action kind that produced this result. */
  actionKind: Extract<TechnicalActionKind, "install-pi-package" | "manual-external-install">;
  /** Machine-readable result status. External/manual tools are `manual`, not failed installs. */
  status: PiToolInstallResultStatus;
  message?: string;
  /** Install kind that was used for this result (for logging/diagnostics) */
  installKind?: string;
  /** Exit code if a command was run */
  exitCode?: number;
  /** Fresh Core-owned readiness evidence for a successful Serena result. */
  serenaReadiness?: SerenaReadinessEvidence;
  /** Core outcome retained for cancellation/partial handoff. */
  serenaBootstrapOutcome?: SerenaBootstrapResult["outcome"];
  /** Fixed stage associated with a Serena outcome, when applicable. */
  serenaStage?: "preparing-uv" | "installing-serena" | "validating-serena";
};

/**
 * Result of a shared binary installation/reuse attempt.
 * Used for capabilities like rtk, codebase-memory-mcp, context-mode.
 */
export type SharedBinaryInstallResult = {
  capabilityId: string;
  command: string;
  status: "reused" | "installed" | "manual-verified" | "blocked" | "missing";
  version?: string;
  message?: string;
};

type InstallCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type RunInstallCommand = (command: string, args: string[]) => Promise<InstallCommandResult>;

/**
 * Install Pi tools with dispatch based on installKind.
 * 
 * Dispatches to:
 * - shared-binary, shared-binary-plus-mcp: check/reuse via checkSharedBinaryUsability
 * - managed Serena: delegate to Core's controlled bootstrap
 * - npm-package-plus-mcp: use npx -y @upstash/context7-mcp
 * - pi-package: use pi install <source>
 * - external, manual: return manual status
 */
type SharedBinaryUsabilityProbe = typeof checkSharedBinaryUsability;

type PiToolInstallDependencies = Readonly<{
  runInstallCommand: RunInstallCommand;
  checkSharedBinaryUsability: SharedBinaryUsabilityProbe;
  sharedBinaryUsabilityTimeoutMs: number;
  bootstrapSerena: (request: SerenaBootstrapRequest) => Promise<SerenaBootstrapResult>;
  serenaAuthorization?: SerenaBootstrapAuthorization;
  serenaOperation?: SerenaOperationIdentity;
  currentOperation?: SerenaOperationIdentity;
  serenaBootstrapEffects?: SerenaBootstrapEffects;
  serenaSignal?: AbortSignal;
  onSerenaStage?: (stage: "preparing-uv" | "installing-serena" | "validating-serena") => void;
  existingSerenaExecutablePath?: string;
}>;

type PiToolInstallDependencyOverrides = Partial<PiToolInstallDependencies>;

const defaultPiToolInstallDependencies: PiToolInstallDependencies = {
  runInstallCommand: runDefaultInstallCommand,
  checkSharedBinaryUsability,
  sharedBinaryUsabilityTimeoutMs: 5_000,
  bootstrapSerena: (request) => bootstrapSerena(request),
};

function resolvePiToolInstallDependencies(
  input: RunInstallCommand | PiToolInstallDependencyOverrides | undefined,
): PiToolInstallDependencies {
  if (typeof input === "function") {
    return { ...defaultPiToolInstallDependencies, runInstallCommand: input };
  }
  return {
    runInstallCommand: input?.runInstallCommand ?? defaultPiToolInstallDependencies.runInstallCommand,
    checkSharedBinaryUsability: input?.checkSharedBinaryUsability ?? defaultPiToolInstallDependencies.checkSharedBinaryUsability,
    sharedBinaryUsabilityTimeoutMs: input?.sharedBinaryUsabilityTimeoutMs ?? defaultPiToolInstallDependencies.sharedBinaryUsabilityTimeoutMs,
    bootstrapSerena: input?.bootstrapSerena ?? defaultPiToolInstallDependencies.bootstrapSerena,
    serenaAuthorization: input?.serenaAuthorization,
    serenaOperation: input?.serenaOperation,
    currentOperation: input?.currentOperation,
    serenaBootstrapEffects: input?.serenaBootstrapEffects,
    serenaSignal: input?.serenaSignal,
    onSerenaStage: input?.onSerenaStage,
    existingSerenaExecutablePath: input?.existingSerenaExecutablePath,
  };
}

export function installPiTools(
  command: string | undefined,
  plan: InstallablePiTool[],
  onResult: (result: PiToolInstallResult) => void,
  runInstallCommand?: RunInstallCommand,
): Promise<PiToolInstallResult[]>;
export function installPiTools(
  command: string | undefined,
  plan: InstallablePiTool[],
  onResult: (result: PiToolInstallResult) => void,
  overrides?: PiToolInstallDependencyOverrides,
): Promise<PiToolInstallResult[]>;

export async function installPiTools(
  command: string | undefined,
  plan: InstallablePiTool[],
  onResult: (result: PiToolInstallResult) => void,
  dependencyInput?: RunInstallCommand | PiToolInstallDependencyOverrides,
): Promise<PiToolInstallResult[]> {
  const dependencies = resolvePiToolInstallDependencies(dependencyInput);
  const results: PiToolInstallResult[] = [];

  for (const tool of plan) {
    const result = await dispatchInstallByKind(tool, command, dependencies);
    results.push(result);
    onResult(result);
  }

  return results;
}

/**
 * Dispatch installation based on installKind.
 * Each installKind has specific handling:
 * - shared-binary/shared-binary-plus-mcp: check existing binary, reuse if ready
 * - managed Serena: use the Core bootstrap projection
 * - npm-package-plus-mcp: run npx -y @upstash/context7-mcp
 * - pi-package: run pi install <source>
 * - external/manual: return manual status
 */
async function dispatchInstallByKind(
  tool: InstallablePiTool,
  command: string | undefined,
  dependencies: PiToolInstallDependencies,
): Promise<PiToolInstallResult> {
  const { id: toolId, name, source, installKind } = tool;

  // Serena is the only Pi capability projected into Core's controlled bootstrap.
  // It must never fall through to the legacy command/manual paths.
  if (toolId === "serena" || tool.capabilityId === "serena") {
    return installSerenaProjection(tool, dependencies);
  }

  if (installKind === "external" || installKind === "manual") {
    return {
      tool: name,
      success: true,
      actionKind: "manual-external-install",
      status: "manual",
      message: `Manual external install required from ${source}.`,
      installKind,
    };
  }

  if (!command) {
    return {
      tool: name,
      success: false,
      actionKind: "install-pi-package",
      status: "failed",
      message: "Pi install command is unavailable.",
      installKind,
    };
  }

  switch (installKind) {
    case "shared-binary":
    case "shared-binary-plus-mcp": {
      const binaryName = getSharedBinaryCommand(toolId);
      const sharedResult = await installSharedBinaryWithDependencies(
        toolId,
        binaryName,
        async () => {},
        dependencies,
      );
      const statusMap: Record<SharedBinaryInstallResult["status"], PiToolInstallResultStatus> = {
        reused: "reused",
        installed: "installed",
        "manual-verified": "manual-verified",
        blocked: "blocked",
        missing: "failed",
      };
      return {
        tool: name,
        success: sharedResult.status === "reused" || sharedResult.status === "installed",
        actionKind: "install-pi-package",
        status: statusMap[sharedResult.status],
        message: sharedResult.message,
        installKind,
      };
    }

    case "npm-package-plus-mcp": {
      try {
        const packageName = source.replace(/^npm:/, "");
        const { stdout, stderr, exitCode } = await dependencies.runInstallCommand("npx", ["-y", packageName]);
        const success = exitCode === 0;
        return {
          tool: name,
          success,
          actionKind: "install-pi-package",
          status: success ? "installed" : "failed",
          message: success ? `MCP package ${packageName} ready` : (stderr || stdout).trim(),
          installKind,
          exitCode,
        };
      } catch (error) {
        return {
          tool: name,
          success: false,
          actionKind: "install-pi-package",
          status: "failed",
          message: error instanceof Error ? error.message : "Failed to install npm MCP package",
          installKind,
        };
      }
    }

    case "pi-package":
    default: {
      try {
        const { stdout, stderr, exitCode } = await dependencies.runInstallCommand(command, ["install", source]);
        const success = exitCode === 0;
        return {
          tool: name,
          success,
          actionKind: "install-pi-package",
          status: success ? "installed" : "failed",
          message: success ? undefined : (stderr || stdout).trim(),
          installKind,
          exitCode,
        };
      } catch (error) {
        return {
          tool: name,
          success: false,
          actionKind: "install-pi-package",
          status: "failed",
          message: error instanceof Error ? error.message : "Unable to run installation command.",
          installKind,
        };
      }
    }
  }
}

/**
 * Map toolId to the command name for shared binary healthcheck.
 */
function getSharedBinaryCommand(toolId: string): string {
  const commandMap: Record<string, string> = {
    "context-mode": "context-mode",
    "codebase-memory-mcp": "codebase-memory-mcp",
    "rtk": "rtk",
    "serena": "serena",
  };
  return commandMap[toolId] ?? toolId;
}

// ---------------------------------------------------------------------------
// Shared Binary Installation with Reuse
// ---------------------------------------------------------------------------

/**
 * Install or reuse a shared binary.
 * 
 * Logic:
 * 1. Check if binary is usable (checkSharedBinaryUsability)
 * 2. If "ready" → return { status: "reused" } - NO reinstall
 * 3. If "missing" → execute installFn, then re-verify
 * 4. If "unusable" → return { status: "blocked", reason }
 * 
 * This ensures we NEVER reinstall a binary that is already ready in PATH.
 * 
 * @param capabilityId - The canonical capability ID (e.g., "rtk", "codebase-memory-mcp")
 * @param command - The command to check/install
 * @param installFn - Async function to install the binary if missing
 */
async function installSharedBinaryWithDependencies(
  capabilityId: string,
  command: string,
  installFn: () => Promise<void>,
  dependencies: PiToolInstallDependencies,
): Promise<SharedBinaryInstallResult> {
  const probeOptions = {
    healthcheckArgs: ["--version", "--help"] as [string, string],
    timeoutMs: dependencies.sharedBinaryUsabilityTimeoutMs,
  };
  const usabilityResult = await dependencies.checkSharedBinaryUsability(command, probeOptions);

  if (usabilityResult.status === "ready") {
    return {
      capabilityId,
      command,
      status: "reused",
      version: usabilityResult.version,
      message: `Reusing existing ${command} (${usabilityResult.version ?? "unknown version"})`,
    };
  }
  if (usabilityResult.status === "unusable") {
    return {
      capabilityId,
      command,
      status: "blocked",
      message: usabilityResult.reason ?? `${command} exists but failed healthcheck`,
    };
  }

  try {
    await installFn();
    const postInstallResult = await dependencies.checkSharedBinaryUsability(command, probeOptions);
    if (postInstallResult.status === "ready") {
      return {
        capabilityId,
        command,
        status: "installed",
        version: postInstallResult.version,
        message: `Installed ${command} (${postInstallResult.version ?? "unknown version"})`,
      };
    }
    return {
      capabilityId,
      command,
      status: "blocked",
      message: postInstallResult.status === "unusable"
        ? (postInstallResult.reason ?? `${command} exists but failed healthcheck`)
        : `${command} installed but not usable`,
    };
  } catch (error) {
    return {
      capabilityId,
      command,
      status: "blocked",
      message: error instanceof Error ? error.message : `Failed to install ${command}`,
    };
  }
}

export async function installSharedBinary(
  capabilityId: string,
  command: string,
  installFn: () => Promise<void>,
): Promise<SharedBinaryInstallResult> {
  return installSharedBinaryWithDependencies(
    capabilityId,
    command,
    installFn,
    defaultPiToolInstallDependencies,
  );
}

async function installSerenaProjection(
  tool: InstallablePiTool,
  dependencies: PiToolInstallDependencies,
): Promise<PiToolInstallResult> {
  const operation = dependencies.currentOperation ?? dependencies.serenaOperation;
  const authorization = validateSerenaOperationAuthorization(
    dependencies.serenaAuthorization,
    operation,
  );

  if (!authorization.valid || !operation || operation.runner !== "pi") {
    return {
      tool: tool.name,
      success: false,
      actionKind: "install-pi-package",
      status: "blocked",
      message: "Serena setup requires explicit selection in the current Pi operation.",
      installKind: tool.installKind,
      serenaBootstrapOutcome: "failed",
      serenaStage: "preparing-uv",
    };
  }

  const request: SerenaBootstrapRequest = {
    authorization: authorization.authorization,
    runner: "pi",
    operationId: operation.operationId,
    operation,
    currentOperation: operation,
    existingSerenaExecutablePath: dependencies.existingSerenaExecutablePath,
    signal: dependencies.serenaSignal,
    onStage: dependencies.onSerenaStage,
    effects: dependencies.serenaBootstrapEffects,
  };

  let result: SerenaBootstrapResult;
  try {
    result = await dependencies.bootstrapSerena(request);
  } catch {
    return {
      tool: tool.name,
      success: false,
      actionKind: "install-pi-package",
      status: "failed",
      message: "Serena setup failed (bootstrap-exception).",
      installKind: tool.installKind,
      serenaBootstrapOutcome: "failed",
      serenaStage: "preparing-uv",
    };
  }

  if (isSuccessfulSerenaBootstrapResult(result)) {
    return {
      tool: tool.name,
      success: true,
      actionKind: "install-pi-package",
      status: result.outcome,
      message: result.outcome === "reused" ? "Serena is ready and was reused." : "Serena was installed and is ready.",
      installKind: tool.installKind,
      serenaReadiness: result.evidence,
      serenaBootstrapOutcome: result.outcome,
      serenaStage: "validating-serena",
    };
  }

  if (result.outcome === "cancelled") {
    return {
      tool: tool.name,
      success: false,
      actionKind: "install-pi-package",
      status: "cancelled",
      message: "Serena setup was cancelled.",
      installKind: tool.installKind,
      serenaBootstrapOutcome: result.outcome,
      serenaStage: result.stage,
    };
  }

  if (result.outcome === "partial") {
    return {
      tool: tool.name,
      success: false,
      actionKind: "install-pi-package",
      status: "partial",
      message: "Serena setup stopped before termination was confirmed.",
      installKind: tool.installKind,
      serenaBootstrapOutcome: result.outcome,
      serenaStage: result.stage,
    };
  }

  return {
    tool: tool.name,
    success: false,
    actionKind: "install-pi-package",
    status: "failed",
    message: `Serena setup failed (${result.code}).`,
    installKind: tool.installKind,
    serenaBootstrapOutcome: result.outcome,
    serenaStage: result.stage,
  };
}

/**
 * Compatibility entry point retained as a non-mutating wrapper. Serena setup
 * is authorized only through the current-operation projection above.
 */
export async function installSerena(): Promise<SharedBinaryInstallResult> {
  return {
    capabilityId: "serena",
    command: "serena-agent",
    status: "blocked",
    message: "Serena setup requires explicit selection in the current Pi operation.",
  };
}

/**
 * Install RTK using installSharedBinary.
 * RTK is a shared binary that should be reused if already available.
 */
export async function installRtk(): Promise<SharedBinaryInstallResult> {
  return installSharedBinary("rtk", "rtk", async () => {
    // RTK installation - typically via npm global or direct binary
    // This is a placeholder - actual implementation depends on RTK distribution
    throw new Error("RTK installation not implemented - use existing binary or install manually");
  });
}

/**
 * Install codebase-memory-mcp using installSharedBinary.
 * This is a shared binary that backs the codebase-memory MCP.
 */
export async function installCodebaseMemoryMcp(): Promise<SharedBinaryInstallResult> {
  return installSharedBinary("codebase-memory-mcp", "codebase-memory-mcp", async () => {
    throw new Error("codebase-memory-mcp installation not implemented - use existing binary or install manually");
  });
}

/**
 * Install context-mode using installSharedBinary.
 * This is a shared binary that backs the context-mode MCP.
 */
export async function installContextMode(): Promise<SharedBinaryInstallResult> {
  return installSharedBinary("context-mode", "context-mode", async () => {
    throw new Error("context-mode installation not implemented - use existing binary or install manually");
  });
}

async function runDefaultInstallCommand(command: string, args: string[]): Promise<InstallCommandResult> {
  return new Promise((resolve) => {
    const process = nodeSpawn(command, args, { stdio: ["ignore", "pipe", "pipe"] } as Parameters<typeof nodeSpawn>[2]);
    let stdout = "";
    let stderr = "";

    if (process.stdout) {
      process.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }
    if (process.stderr) {
      process.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    process.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });

    process.on("error", (error) => {
      resolve({ exitCode: 1, stdout, stderr: error.message });
    });
  });
}

// ---------------------------------------------------------------------------
// Internal runner package install
// ---------------------------------------------------------------------------

/**
 * Result of an internal runner package install attempt.
 * Uses the same shape as `PiToolInstallResult` for review-plan compatibility.
 */
export type InternalRunnerInstallResult = {
  /** Internal package identifier. */
  packageId: string;
  success: boolean;
  actionKind: Extract<TechnicalActionKind, "install-pi-package">;
  status: "installed" | "failed";
  message?: string;
  /** Error code per Spec error contracts (REQ-PIINSTALL-004). */
  errorCode?: string;
};

/**
 * Install internal runner packages via the existing Pi package install executor path.
 *
 * Reuses `installPiTools` with the same command runner, using `pi install npm:{packageId}`
 * for each action. This keeps the internal package install execution identical to the
 * user-facing package install path (REQ-PIINSTALL-001, REQ-PIINSTALL-003).
 *
 * @param command       - Path to `pi` executable (passed through to install executor).
 * @param actions       - Internal package install actions from the review plan.
 * @param onResult      - Callback invoked with each result for incremental reporting.
 * @param runInstallCommand - Override for test injection.
 */
export async function installInternalRunnerPackages(
  command: string | undefined,
  actions: InternalRunnerPackageInstallAction[],
  onResult: (result: InternalRunnerInstallResult) => void,
  runInstallCommand: RunInstallCommand = runDefaultInstallCommand,
): Promise<InternalRunnerInstallResult[]> {
  // Convert internal install actions to InstallablePiTool format for the executor.
  const tools: InstallablePiTool[] = actions.map((action) => ({
    id: action.packageId as "sub-agents" | "mcp-packages" | "context-mode" | "codebase-memory-mcp" | "rtk" | "context7",
    name: action.name,
    source: action.source,
    required: true,
    installKind: "pi-package",
  }));

  const results: InternalRunnerInstallResult[] = [];

  for (const tool of tools) {
    if (!command) {
      const result = {
        packageId: tool.id,
        success: false,
        actionKind: "install-pi-package" as const,
        status: "failed" as const,
        message: "Pi install command is unavailable.",
        errorCode: "visual_support_install_failed",
      };
      results.push(result);
      onResult(result);
      continue;
    }

    try {
      const { stdout, stderr, exitCode } = await runInstallCommand(command, ["install", tool.source]);

      if (exitCode === 0) {
        const result = {
          packageId: tool.id,
          success: true,
          actionKind: "install-pi-package" as const,
          status: "installed" as const,
          message: undefined,
        };
        results.push(result);
        onResult(result);
      } else {
        const result = {
          packageId: tool.id,
          success: false,
          actionKind: "install-pi-package" as const,
          status: "failed" as const,
          message: (stderr || stdout).trim(),
          errorCode: "visual_support_install_failed",
        };
        results.push(result);
        onResult(result);
      }
    } catch (error) {
      const result = {
        packageId: tool.id,
        success: false,
        actionKind: "install-pi-package" as const,
        status: "failed" as const,
        message: error instanceof Error ? error.message : "Unable to run installation command.",
        errorCode: "visual_support_install_failed",
      };
      results.push(result);
      onResult(result);
    }
  }

  return results;
}
