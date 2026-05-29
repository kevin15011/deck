import type { InstallableOpenCodeTool } from "./installation-plan";
import { spawn as nodeSpawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const DEBUG_LOG = "/tmp/deck-install-debug.log";

function debugLog(...args: unknown[]): void {
  if (!process.env.DECK_DEBUG) return;
  const msg = args.map((a) => typeof a === "object" ? JSON.stringify(a) : String(a)).join(" ");
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${msg}\n`;
  try { appendFileSync(DEBUG_LOG, line, "utf-8"); } catch {}
}

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

/** Shell to use for script execution — bash if available (mac/linux compatibility) */
function getShellCommand(): string {
  // mac uses bash as sh, linux often uses dash which lacks pipefail
  return process.platform === "darwin" ? "sh" : (existsSync("/bin/bash") ? "/bin/bash" : "sh");
}

export async function installOpenCodeTools(
  command: string | undefined,
  plan: InstallableOpenCodeTool[],
  onResult: (result: OpenCodeToolInstallResult) => void,
  runInstallCommand: RunInstallCommand = runDefaultInstallCommand,
): Promise<OpenCodeToolInstallResult[]> {
  if (!command) return [];

  const results: OpenCodeToolInstallResult[] = [];

  debugLog("[install-tools] Starting installation of tools:", plan.map((t) => `${t.id} (${t.installKind})`));

  for (const tool of plan) {
    debugLog(`[install-tools] Processing tool: ${tool.name}, installKind: ${tool.installKind}`);

    if (tool.installKind === "external") {
      const result = {
        tool: tool.name,
        success: false,
        message: `Manual install required from ${tool.module}.`,
      };
      debugLog(`[install-tools] ${tool.name}: external, skipping automatic install`);
      results.push(result);
      onResult(result);
      continue;
    }

    if (tool.installKind === "shell-script" || tool.installKind === "shell-script-plus-mcp") {
      // Install binary via shell script (curl -fsSL <url> | sh)
      debugLog(`[install-tools] ${tool.name}: ${tool.installKind} install starting`);
      if (!tool.shellInstallUrl) {
        debugLog(`[install-tools] ${tool.name}: ERROR - missing shell install URL`);
        const result = {
          tool: tool.name,
          success: false,
          message: `Missing shell install URL for ${tool.name}.`,
        };
        results.push(result);
        onResult(result);
        continue;
      }

      debugLog(`[install-tools] ${tool.name}: Downloading from ${tool.shellInstallUrl}`);
      try {
        const { stdout, stderr, exitCode } = await runInstallCommand("curl", ["-fsSL", tool.shellInstallUrl]);
        debugLog(`[install-tools] ${tool.name}: curl exitCode=${exitCode}, stdout.length=${stdout.length}, stderr.length=${stderr.length}`);

        // Pipe stdout to shell
        debugLog(`[install-tools] ${tool.name}: Executing shell script...`);
        const shell = getShellCommand();
        const shellProcess = nodeSpawn(shell, ["-s"], { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
        shellProcess.stdin?.write(stdout);
        shellProcess.stdin?.end();

        let shellStdout = "";
        let shellStderr = "";
        shellProcess.stdout?.on("data", (chunk) => { shellStdout += chunk.toString(); });
        shellProcess.stderr?.on("data", (chunk) => { shellStderr += chunk.toString(); });

        const shellExitCode = await new Promise<number>((resolve) => {
          shellProcess.on("close", (code) => resolve(code ?? 1));
        });

        debugLog(`[install-tools] ${tool.name}: shell exitCode=${shellExitCode}`);
        debugLog(`[install-tools] ${tool.name}: shell stdout (first 500 chars): ${shellStdout.substring(0, 500)}`);
        debugLog(`[install-tools] ${tool.name}: shell stderr (first 500 chars): ${shellStderr.substring(0, 500)}`);

        // Run post-install command if specified
        let postInstallOk = true;
        let postInstallMessage = "";
        if (tool.postInstallCommand && shellExitCode === 0) {
          const [cmd, ...args] = tool.postInstallCommand;
          debugLog(`[install-tools] ${tool.name}: Running post-install: ${cmd} ${args.join(" ")}`);
          const { exitCode: postExitCode, stderr: postStderr } = await runInstallCommand(cmd, args);
          postInstallOk = postExitCode === 0;
          debugLog(`[install-tools] ${tool.name}: post-install exitCode=${postExitCode}`);
          postInstallMessage = postExitCode === 0
            ? ` Post-install '${tool.postInstallCommand.join(" ")}' succeeded.`
            : ` Post-install '${tool.postInstallCommand.join(" ")}' failed: ${postStderr}`;
        }

        const result = {
          tool: tool.name,
          success: shellExitCode === 0 && postInstallOk,
          message: shellExitCode === 0
            ? (postInstallOk ? undefined : postInstallMessage.trim())
            : (shellStderr || shellStdout || `Shell install failed with exit code ${shellExitCode}`).trim(),
        };
        debugLog(`[install-tools] ${tool.name}: FINAL RESULT - success=${result.success}, message=${result.message}`);
        results.push(result);
        onResult(result);
      } catch (error) {
        debugLog(`[install-tools] ${tool.name}: ERROR - ${error instanceof Error ? error.message : String(error)}`);
        const result = {
          tool: tool.name,
          success: false,
          message: error instanceof Error ? error.message : "Shell install failed.",
        };
        results.push(result);
        onResult(result);
      }
      continue;
    }

    if (tool.installKind === "npm-package") {
      // Install npm package globally using `npm install -g <module>`
      debugLog(`[install-tools] ${tool.name}: npm-package install: npm install -g ${tool.module}`);
      try {
        const { stdout, stderr, exitCode } = await runInstallCommand("npm", ["install", "-g", tool.module]);
        debugLog(`[install-tools] ${tool.name}: npm exitCode=${exitCode}`);
        const result = {
          tool: tool.name,
          success: exitCode === 0,
          message: exitCode === 0 ? undefined : (stderr || stdout).trim(),
        };
        results.push(result);
        onResult(result);
      } catch (error) {
        debugLog(`[install-tools] ${tool.name}: npm ERROR - ${error instanceof Error ? error.message : String(error)}`);
        const result = {
          tool: tool.name,
          success: false,
          message: error instanceof Error ? error.message : "Unable to run npm install.",
        };
        results.push(result);
        onResult(result);
      }
      continue;
    }

    if (tool.installKind === "npm-package-plus-mcp") {
      // Install npm package globally + MCP config handled separately (write-mcp-config action)
      // Same as npm-package: execute npm install -g <module>
      debugLog(`[install-tools] ${tool.name}: npm-package-plus-mcp install: npm install -g ${tool.module}`);
      try {
        const { stdout, stderr, exitCode } = await runInstallCommand("npm", ["install", "-g", tool.module]);
        debugLog(`[install-tools] ${tool.name}: npm exitCode=${exitCode}`);
        const result = {
          tool: tool.name,
          success: exitCode === 0,
          message: exitCode === 0 ? undefined : (stderr || stdout).trim(),
        };
        results.push(result);
        onResult(result);
      } catch (error) {
        debugLog(`[install-tools] ${tool.name}: npm ERROR - ${error instanceof Error ? error.message : String(error)}`);
        const result = {
          tool: tool.name,
          success: false,
          message: error instanceof Error ? error.message : "Unable to run npm install.",
        };
        results.push(result);
        onResult(result);
      }
      continue;
    }

    if (tool.installKind === "opencode-plugin") {
      // Install plugin via OpenCode's own plugin system, which registers it in the correct cache
      debugLog(`[install-tools] ${tool.name}: opencode-plugin install (opencode plugin ${tool.module} --global)`);

      // Step 1: Install via opencode plugin command (registers in ~/.cache/opencode/packages/ and adds to global config)
      debugLog(`[install-tools] ${tool.name}: running opencode plugin ${tool.module} --global`);
      try {
        const { stdout, stderr, exitCode } = await runInstallCommand("opencode", ["plugin", tool.module, "--global"]);
        debugLog(`[install-tools] ${tool.name}: opencode plugin exitCode=${exitCode}`);
        if (exitCode !== 0) {
          // Fallback: try npm install -g + manual plugin entry
          debugLog(`[install-tools] ${tool.name}: opencode plugin failed, trying npm fallback`);
          const npmResult = await runInstallCommand("npm", ["install", "-g", tool.module]);
          debugLog(`[install-tools] ${tool.name}: npm install exitCode=${npmResult.exitCode}`);
          if (npmResult.exitCode !== 0) {
            const result = {
              tool: tool.name,
              success: false,
              message: `Failed to install ${tool.module}: ${(npmResult.stderr || npmResult.stdout).trim()}`,
            };
            results.push(result);
            onResult(result);
            continue;
          }
          // Manual plugin entry fallback
          const homeDir = process.env.HOME ?? "/home/user";
          const configPath = join(homeDir, ".config", "opencode", "opencode.json");
          const result = installOpenCodePlugin({ configPath, homeDir, pluginName: tool.module });
          results.push(result);
          onResult(result);
          continue;
        }
        const result = {
          tool: tool.name,
          success: true,
          message: `Installed ${tool.module} via opencode plugin`,
        };
        results.push(result);
        onResult(result);
      } catch (error) {
        const result = {
          tool: tool.name,
          success: false,
          message: `Plugin install error: ${error instanceof Error ? error.message : String(error)}`,
        };
        results.push(result);
        onResult(result);
      }
      continue;
    }

    if (tool.installKind === "mcp-server") {
      // MCP servers are configured via capability-plan.ts, not installed via install-tools.ts
      // The install-tools.ts handles npm and plugin installations only
      debugLog(`[install-tools] ${tool.name}: mcp-server - skipping (handled by write-mcp-config action)`);
      const result = {
        tool: tool.name,
        success: false,
        message: `${tool.name} is an MCP server configured via write-mcp-config action, not install-tools.`,
      };
      results.push(result);
      onResult(result);
      continue;
    }

    debugLog(`[install-tools] ${tool.name}: Unknown installKind "${tool.installKind}", falling through to opencode plugin install`);
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

  debugLog("[install-tools] Installation complete. Results:", results);
  return results;
}

type OpenCodePluginInstallResult = {
  tool: string;
  success: boolean;
  message?: string;
};

/**
 * Adds an OpenCode plugin to the global opencode.json plugin array.
 *
 * OpenCode plugins are in-process modules that run inside the OpenCode runner.
 * The plugin entry in opencode.json is just the plugin name string, e.g.:
 *   { "plugin": ["context-mode", "rtk"] }
 *
 * This does NOT run `opencode plugin install` CLI command - that command is for
 * OpenCode's own plugin registry, not for in-process plugins like context-mode.
 */
function installOpenCodePlugin(options: {
  configPath: string;
  homeDir: string;
  pluginName: string;
}): OpenCodePluginInstallResult {
  debugLog(`[installOpenCodePlugin] configPath=${options.configPath}, pluginName=${options.pluginName}`);
  debugLog(`[installOpenCodePlugin] config exists: ${existsSync(options.configPath)}`);

  let config: Record<string, unknown> = {};
  if (existsSync(options.configPath)) {
    try {
      const content = readFileSync(options.configPath, "utf-8");
      debugLog(`[installOpenCodePlugin] existing config content: ${content.substring(0, 200)}`);
      config = JSON.parse(content) as Record<string, unknown>;
    } catch (error) {
      debugLog(`[installOpenCodePlugin] ERROR parsing config: ${error instanceof Error ? error.message : String(error)}`);
      return {
        tool: options.pluginName,
        success: false,
        message: `Could not parse opencode.json: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  } else {
    debugLog(`[installOpenCodePlugin] config file does not exist, creating new`);
  }

  // Ensure plugin array exists
  if (!Array.isArray(config.plugin)) {
    config.plugin = [];
    debugLog(`[installOpenCodePlugin] created new plugin array`);
  }

  const pluginArray = config.plugin as string[];
  debugLog(`[installOpenCodePlugin] current plugin array: ${JSON.stringify(pluginArray)}`);

  if (!pluginArray.includes(options.pluginName)) {
    pluginArray.push(options.pluginName);
    debugLog(`[installOpenCodePlugin] added ${options.pluginName}, new plugin array: ${JSON.stringify(pluginArray)}`);
  } else {
    debugLog(`[installOpenCodePlugin] ${options.pluginName} already in plugin array`);
  }

  try {
    writeFileSync(options.configPath, JSON.stringify(config, null, 2), "utf-8");
    debugLog(`[installOpenCodePlugin] SUCCESS - wrote config to ${options.configPath}`);
    return {
      tool: options.pluginName,
      success: true,
      message: `Added '${options.pluginName}' to plugin array in opencode.json`,
    };
  } catch (error) {
    debugLog(`[installOpenCodePlugin] ERROR writing config: ${error instanceof Error ? error.message : String(error)}`);
    return {
      tool: options.pluginName,
      success: false,
      message: `Could not write opencode.json: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
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
