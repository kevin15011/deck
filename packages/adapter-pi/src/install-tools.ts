import type { TechnicalActionKind } from "./capability-catalog";
import type { InstallablePiTool } from "./installation-plan";

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
