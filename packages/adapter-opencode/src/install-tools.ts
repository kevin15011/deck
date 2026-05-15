import type { InstallableOpenCodeTool } from "./installation-plan";

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
  runInstallCommand: RunInstallCommand = runInstallCommandWithBun,
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

async function runInstallCommandWithBun(command: string, args: string[]): Promise<InstallCommandResult> {
  const process = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  return { exitCode, stdout, stderr };
}
