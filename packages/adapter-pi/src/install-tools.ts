import type { TechnicalActionKind } from "./capability-catalog";
import type { InstallablePiTool } from "./installation-plan";
import type { InternalRunnerPackageInstallAction } from "./internal-runner-packages";

export type PiToolInstallResultStatus = "installed" | "manual" | "failed";

export type PiToolInstallResult = {
  tool: string;
  success: boolean;
  /** Review Plan-compatible action kind that produced this result. */
  actionKind: Extract<TechnicalActionKind, "install-pi-package" | "manual-external-install">;
  /** Machine-readable result status. External/manual tools are `manual`, not failed installs. */
  status: PiToolInstallResultStatus;
  message?: string;
};

type InstallCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type RunInstallCommand = (command: string, args: string[]) => Promise<InstallCommandResult>;

export async function installPiTools(
  command: string | undefined,
  plan: InstallablePiTool[],
  onResult: (result: PiToolInstallResult) => void,
  runInstallCommand: RunInstallCommand = runInstallCommandWithBun,
): Promise<PiToolInstallResult[]> {
  const results: PiToolInstallResult[] = [];

  for (const tool of plan) {
    if (tool.installKind === "external") {
      const result = {
        tool: tool.name,
        success: true,
        actionKind: "manual-external-install" as const,
        status: "manual" as const,
        message: `Manual external install required from ${tool.source}.`,
      };
      results.push(result);
      onResult(result);
      continue;
    }

    if (!command) {
      const result = {
        tool: tool.name,
        success: false,
        actionKind: "install-pi-package" as const,
        status: "failed" as const,
        message: "Pi install command is unavailable.",
      };
      results.push(result);
      onResult(result);
      continue;
    }

    try {
      const { stdout, stderr, exitCode } = await runInstallCommand(command, ["install", tool.source]);

      const result = {
        tool: tool.name,
        success: exitCode === 0,
        actionKind: "install-pi-package" as const,
        status: exitCode === 0 ? "installed" as const : "failed" as const,
        message: exitCode === 0 ? undefined : (stderr || stdout).trim(),
      };
      results.push(result);
      onResult(result);
    } catch (error) {
      const result = {
        tool: tool.name,
        success: false,
        actionKind: "install-pi-package" as const,
        status: "failed" as const,
        message: error instanceof Error ? error.message : "Unable to run installation command.",
      };
      results.push(result);
      onResult(result);
    }
  }

  return results;
}

async function runInstallCommandWithBun(command: string, args: string[]): Promise<InstallCommandResult> {
  const process = Bun.spawn([command, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  return { exitCode, stdout, stderr };
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
  runInstallCommand: RunInstallCommand = runInstallCommandWithBun,
): Promise<InternalRunnerInstallResult[]> {
  // Convert internal install actions to InstallablePiTool format for the executor.
  const tools: InstallablePiTool[] = actions.map((action) => ({
    id: action.packageId as "sub-agents" | "mcp-packages" | "context-mode" | "codebase-memory" | "rtk" | "context7" | "engram-memory",
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