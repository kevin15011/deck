import type { InstallableOpenCodeTool } from "./installation-plan";
import { spawn as nodeSpawn } from "node:child_process";

export type OpenCodeToolInstallResult = {
  tool: string;
  success: boolean;
  message?: string;
};

type InstallCommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

type RunInstallCommand = (command: string, args: string[]) => Promise<InstallCommandResult>;

export async function installOpenCodeTools(
  command: string | undefined,
  plan: InstallableOpenCodeTool[],
  onResult: (result: OpenCodeToolInstallResult) => void,
  runInstallCommand: RunInstallCommand = runDefaultInstallCommand,
): Promise<OpenCodeToolInstallResult[]> {
  if (!command) return [];

  const results: OpenCodeToolInstallResult[] = [];

  for (const tool of plan) {
    if (tool.installKind === "external") {
      const result = {
        tool: tool.name,
        success: false,
        message: `Manual install required from ${tool.module}.`,
      };
      results.push(result);
      onResult(result);
      continue;
    }

    try {
      const { stdout, stderr, exitCode } = await runInstallCommand(command, ["plugin", tool.module, "--global"]);
      const result = {
        tool: tool.name,
        success: exitCode === 0,
        message: exitCode === 0 ? undefined : (stderr || stdout).trim(),
      };
      results.push(result);
      onResult(result);
    } catch (error) {
      const result = {
        tool: tool.name,
        success: false,
        message: error instanceof Error ? error.message : "Unable to run installation command.",
      };
      results.push(result);
      onResult(result);
    }
  }

  return results;
}

async function runDefaultInstallCommand(command: string, args: string[]): Promise<InstallCommandResult> {
  return new Promise((resolve) => {
    const process = nodeSpawn(command, args, { stdout: "pipe", stderr: "pipe" });
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
