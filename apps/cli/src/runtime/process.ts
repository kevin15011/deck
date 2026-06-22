/**
 * Runtime process runner abstraction.
 *
 * Provides async/sync process execution wrappers over `node:child_process`
 * that work identically in both development (`bun run`) and compiled binary modes.
 *
 * @module
 */

import { spawn as nodeSpawn, spawnSync as nodeSpawnSync, SpawnOptions as NodeSpawnOptions, ChildProcess, type SpawnSyncReturns } from "node:child_process";

// ============================================================================
// Types
// ============================================================================

export type ProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type SyncProcessResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
  signal?: string;
};

export type SpawnOptions = {
  /** Current working directory for the spawned process. */
  cwd?: string;
  /** Environment variables to pass to the process. */
  env?: Record<string, string>;
  /** Stdio configuration. "pipe" captures output, "inherit" passes through. */
  stdio?: "pipe" | "inherit";
};

// ============================================================================
// Async Process Spawn
// ============================================================================

/**
 * Spawn a process asynchronously with captured stdout/stderr.
 *
 * @param command - Executable to run
 * @param args   - Command-line arguments
 * @param opts   - Spawn options (cwd, env, stdio)
 * @returns Promise resolving to { exitCode, stdout, stderr }
 */
export async function spawnAsync(
  command: string,
  args: string[],
  opts: SpawnOptions = {},
): Promise<ProcessResult> {
  const { cwd, env, stdio = "pipe" } = opts;

  return new Promise((resolve) => {
    const child = nodeSpawn(command, args, {
      cwd,
      env,
      stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    if (child.stdout) {
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString();
      });
    }

    if (child.stderr) {
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
    }

    child.on("close", (code) => {
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr,
      });
    });

    child.on("error", (error) => {
      resolve({
        exitCode: 1,
        stdout,
        stderr: error.message,
      });
    });
  });
}

// ============================================================================
// Inherited stdio spawn (for pi-launch)
// ============================================================================

/**
 * Spawn a process with inherited stdio (stdin/stdout/stderr pass through to parent).
 * Used for interactive commands like pi-launch where the child process should be
 * fully interactive.
 *
 * @param command - Executable to run
 * @param args   - Command-line arguments
 * @param opts   - Spawn options (cwd, env)
 * @returns ChildProcess instance
 */
export function spawnInherited(
  command: string,
  args: string[],
  opts: SpawnOptions = {},
): ChildProcess {
  const { cwd, env } = opts;

  const child = nodeSpawn(command, args, {
    cwd,
    env,
    stdio: "inherit",
  });

  return child;
}

// ============================================================================
// Sync Process Spawn
// ============================================================================

/**
 * Spawn a process synchronously.
 *
 * @param command - Executable to run
 * @param args   - Command-line arguments
 * @param opts   - Spawn options (cwd, env, stdio)
 * @returns Synchronous result with exitCode, stdout, stderr, signal
 */
export function spawnSync(
  command: string,
  args: string[],
  opts: SpawnOptions = {},
): SyncProcessResult {
  const { cwd, env, stdio = "pipe" } = opts;

  const options: NodeSpawnOptions = {
    cwd,
    env,
    stdio: stdio === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"],
    windowsHide: true,
  };

  try {
    const result = nodeSpawnSync(command, args, options) as SpawnSyncReturns<Buffer>;

    // Handle case where command wasn't found - check result.error for ENOENT
    if (result.error) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: result.error.message,
      };
    }

    // Node's spawnSync uses .status for exit code (number, the process exit code),
    // or undefined when killed by signal (in which case .signal is set).
    const exitCode = result.status ?? (result.signal ? 1 : 0);

    return {
      exitCode,
      stdout: result.stdout?.toString() ?? "",
      stderr: result.stderr?.toString() ?? "",
      signal: result.signal ?? undefined,
    };
  } catch (error) {
    return {
      exitCode: 1,
      stdout: "",
      stderr: error instanceof Error ? error.message : "Unable to run command.",
    };
  }
}

// ============================================================================
// Default instances for backward compatibility
// ============================================================================

/**
 * Default async spawn function using child_process.
 * Provided for dependency injection compatibility.
 */
export const defaultSpawnAsync = spawnAsync;

/**
 * Default inherited stdio spawn function.
 */
export const defaultSpawnInherited = spawnInherited;

/**
 * Default sync spawn function.
 */
export const defaultSpawnSync = spawnSync;