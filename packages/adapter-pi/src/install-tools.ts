import type { TechnicalActionKind } from "./capability-catalog";
import type { InstallablePiTool } from "./installation-plan";
import type { InternalRunnerPackageInstallAction } from "./internal-runner-packages";
import { spawn as nodeSpawn } from "node:child_process";
import { checkSharedBinaryUsability, type SharedBinaryUsabilityResult } from "@deck/core";

export type PiToolInstallResultStatus = "installed" | "manual" | "failed" | "reused" | "blocked" | "manual-verified";

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
 * - python-tool: use installSerena (uv/pipx)
 * - npm-package-plus-mcp: use npx -y @upstash/context7-mcp
 * - pi-package: use pi install <source>
 * - external, manual: return manual status
 */
export async function installPiTools(
  command: string | undefined,
  plan: InstallablePiTool[],
  onResult: (result: PiToolInstallResult) => void,
  runInstallCommand: RunInstallCommand = runDefaultInstallCommand,
): Promise<PiToolInstallResult[]> {
  const results: PiToolInstallResult[] = [];

  for (const tool of plan) {
    // Dispatch based on installKind
    const result = await dispatchInstallByKind(tool, command, runInstallCommand);
    results.push(result);
    onResult(result);
  }

  return results;
}

/**
 * Dispatch installation based on installKind.
 * Each installKind has specific handling:
 * - shared-binary/shared-binary-plus-mcp: check existing binary, reuse if ready
 * - python-tool: try uv/pipx, fallback to manual-verified
 * - npm-package-plus-mcp: run npx -y @upstash/context7-mcp
 * - pi-package: run pi install <source>
 * - external/manual: return manual status
 */
async function dispatchInstallByKind(
  tool: InstallablePiTool,
  command: string | undefined,
  runInstallCommand: RunInstallCommand,
): Promise<PiToolInstallResult> {
  const { id: toolId, name, source, installKind } = tool;

  // Note: No console.log here - output leaks into Ink TUI. Use debug file or caller-provided logger.

  // Handle external/manual without requiring pi command
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

  // If no pi command available, fail for non-manual kinds
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

  // Dispatch based on installKind
  switch (installKind) {
    case "shared-binary":
    case "shared-binary-plus-mcp": {
      // For shared binaries, check if already usable and reuse
      const binaryName = getSharedBinaryCommand(toolId);
      const sharedResult = await installSharedBinary(
        toolId,
        binaryName,
        async () => {
          // Installation function - currently throws as binary install is manual
          // In the future, this could install the binary via npm/pip
          // Note: No console.log here - output leaks into Ink TUI
        },
      );

      // Map shared-binary result status to PiToolInstallResultStatus
      // reused/installed/manual-verified are SUCCESS, not failed
      const statusMap: Record<SharedBinaryInstallResult["status"], PiToolInstallResultStatus> = {
        "reused": "reused",
        "installed": "installed",
        "manual-verified": "manual-verified",
        "blocked": "blocked",
        "missing": "failed",
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

    case "python-tool": {
      // For python tools, try uv/pipx
      const serenaResult = await installSerena();

      const statusMap: Record<SharedBinaryInstallResult["status"], PiToolInstallResultStatus> = {
        "reused": "reused",
        "installed": "installed",
        "manual-verified": "manual-verified",
        "blocked": "blocked",
        "missing": "failed",
      };

      return {
        tool: name,
        success: serenaResult.status === "reused" || serenaResult.status === "installed" || serenaResult.status === "manual-verified",
        actionKind: "install-pi-package",
        status: statusMap[serenaResult.status],
        message: serenaResult.message,
        installKind,
      };
    }

    case "npm-package-plus-mcp": {
      // For npm packages with MCP (e.g., @upstash/context7-mcp)
      try {
        // Extract package name from source (e.g., "npm:@upstash/context7-mcp" -> "@upstash/context7-mcp")
        const packageName = source.replace(/^npm:/, "");
        const { stdout, stderr, exitCode } = await runInstallCommand("npx", ["-y", packageName]);

        // For npx, we just verify it runs (the MCP server runs on demand)
        // Exit code 0 means the package was fetched successfully
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
      // Default: use pi install <source>
      try {
        const { stdout, stderr, exitCode } = await runInstallCommand(command, ["install", source]);

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
export async function installSharedBinary(
  capabilityId: string,
  command: string,
  installFn: () => Promise<void>
): Promise<SharedBinaryInstallResult> {
  // Step 1: Check if binary is usable
  const usabilityResult = await checkSharedBinaryUsability(command, {
    healthcheckArgs: ["--version", "--help"],
    timeoutMs: 5000,
  });

  // Binary is ready - reuse it!
  if (usabilityResult.status === "ready") {
    return {
      capabilityId,
      command,
      status: "reused",
      version: usabilityResult.version,
      message: `Reusing existing ${command} (${usabilityResult.version ?? "unknown version"})`,
    };
  }

  // Binary exists but unusable
  if (usabilityResult.status === "unusable") {
    return {
      capabilityId,
      command,
      status: "blocked",
      message: usabilityResult.reason ?? `${command} exists but failed healthcheck`,
    };
  }

  // Binary is missing - try to install
  try {
    await installFn();
    
    // Re-verify after installation
    const postInstallResult = await checkSharedBinaryUsability(command, {
      healthcheckArgs: ["--version", "--help"],
      timeoutMs: 5000,
    });

    if (postInstallResult.status === "ready") {
      return {
        capabilityId,
        command,
        status: "installed",
        version: postInstallResult.version,
        message: `Installed ${command} (${postInstallResult.version ?? "unknown version"})`,
      };
    }

    // Installation succeeded but binary still not usable
    return {
      capabilityId,
      command,
      status: "blocked",
      message: `${command} installed but not usable`,
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

/**
 * Install Serena as a Python tool.
 * 
 * Tries:
 * 1. uv tool install serena
 * 2. pipx install serena
 * 
 * If prerequisites (uv/pipx) are not available, returns manual-verified status
 * with instructions.
 */
export async function installSerena(): Promise<SharedBinaryInstallResult> {
  const serenaCheck = await checkSharedBinaryUsability("serena", {
    healthcheckArgs: ["--version", "--help"],
    timeoutMs: 5000,
  });

  // Already installed
  if (serenaCheck.status === "ready") {
    return {
      capabilityId: "serena",
      command: "serena",
      status: "reused",
      version: serenaCheck.version,
      message: `Reusing existing serena (${serenaCheck.version ?? "unknown version"})`,
    };
  }

  if (serenaCheck.status === "unusable") {
    return {
      capabilityId: "serena",
      command: "serena",
      status: "blocked",
      message: serenaCheck.reason ?? "serena exists but failed healthcheck",
    };
  }

  // Try uv tool install serena
  try {
    const uvResult = await runDefaultInstallCommand("uv", ["tool", "install", "serena"]);
    if (uvResult.exitCode === 0) {
      const postUvCheck = await checkSharedBinaryUsability("serena", {
        healthcheckArgs: ["--version", "--help"],
        timeoutMs: 5000,
      });
      if (postUvCheck.status === "ready") {
        return {
          capabilityId: "serena",
          command: "serena",
          status: "installed",
          version: postUvCheck.version,
          message: `Installed serena via uv (${postUvCheck.version ?? "unknown version"})`,
        };
      }
    }
  } catch {
    // uv not available, try pipx
  }

  // Try pipx install serena
  try {
    const pipxResult = await runDefaultInstallCommand("pipx", ["install", "serena"]);
    if (pipxResult.exitCode === 0) {
      const postPipxCheck = await checkSharedBinaryUsability("serena", {
        healthcheckArgs: ["--version", "--help"],
        timeoutMs: 5000,
      });
      if (postPipxCheck.status === "ready") {
        return {
          capabilityId: "serena",
          command: "serena",
          status: "installed",
          version: postPipxCheck.version,
          message: `Installed serena via pipx (${postPipxCheck.version ?? "unknown version"})`,
        };
      }
    }
  } catch {
    // pipx not available either
  }

  // Neither uv nor pipx available - manual verification required
  return {
    capabilityId: "serena",
    command: "serena",
    status: "manual-verified",
    message: "Serena requires manual installation: run 'uv tool install serena' or 'pipx install serena'",
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
    id: action.packageId as "sub-agents" | "mcp-packages" | "context-mode" | "codebase-memory-mcp" | "rtk" | "context7" | "engram-memory",
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