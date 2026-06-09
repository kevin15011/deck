/**
 * Shared Binary Usability Helper
 *
 * Checks if a shared binary is usable (exists in PATH and passes healthcheck).
 */

import { spawn } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(require("node:child_process").exec);

/** Result of checking shared binary usability */
export type SharedBinaryUsabilityResult = {
  status: "ready" | "missing" | "unusable" | "blocked";
  command: string;
  version?: string;
  reason?: string;
};

/** Options for binary usability check */
export type SharedBinaryUsabilityOptions = {
  healthcheckArgs?: readonly string[];
  timeoutMs?: number;
};

/**
 * Check if a command exists in PATH
 */
async function commandExistsInPath(command: string): Promise<boolean> {
  try {
    // Use 'which' on Unix-like systems
    const { stdout } = await execAsync(`which ${command}`, { timeout: 5000 });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Execute a healthcheck command and get version info
 */
async function runHealthcheck(
  command: string,
  args: readonly string[],
  timeoutMs: number
): Promise<{ success: boolean; output: string }> {
  return new Promise((resolve) => {
    const proc = spawn(command, [...args], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs,
    });

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code) => {
      resolve({
        success: code === 0,
        output: stdout + stderr,
      });
    });

    proc.on("error", () => {
      resolve({ success: false, output: "" });
    });

    proc.on("timeout", () => {
      proc.kill();
      resolve({ success: false, output: "timeout" });
    });
  });
}

/**
 * Check if a shared binary is usable
 *
 * Logic:
 * 1. Check if command exists in PATH (including .local/bin)
 * 2. If exists, run healthcheck (--version or --help)
 * 3. Exit 0 → ready, exit !=0 → unusable, not found → missing
 *
 * @param command - The command to check
 * @param options - Options for healthcheck
 * @returns Usability result with status
 */
export async function checkSharedBinaryUsability(
  command: string,
  options?: SharedBinaryUsabilityOptions
): Promise<SharedBinaryUsabilityResult> {
  const healthcheckArgs = options?.healthcheckArgs ?? ["--version", "--help"];
  const timeoutMs = options?.timeoutMs ?? 5000;

  // Step 1: Check if command exists in PATH
  const exists = await commandExistsInPath(command);
  if (!exists) {
    // Also check in .local/bin
    try {
      const { stdout } = await execAsync(`which ${command}`, { timeout: 5000 });
      if (stdout.trim().length === 0) {
        return {
          status: "missing",
          command,
          reason: `Command '${command}' not found in PATH`,
        };
      }
    } catch {
      return {
        status: "missing",
        command,
        reason: `Command '${command}' not found in PATH`,
      };
    }
  }

  // Step 2: Run healthcheck
  // Try each healthcheck arg until one works
  for (const arg of healthcheckArgs) {
    const result = await runHealthcheck(command, [arg], timeoutMs);
    if (result.success) {
      // Extract version if present
      let version: string | undefined;
      const versionMatch = result.output.match(/(\d+\.\d+\.\d+)/);
      if (versionMatch) {
        version = versionMatch[1];
      }

      return {
        status: "ready",
        command,
        version,
      };
    }
  }

  // If we get here, command exists but healthcheck failed
  return {
    status: "unusable",
    command,
    reason: `Command '${command}' exists but failed healthcheck`,
  };
}

/**
 * Synchronous check for testing purposes (mockable)
 */
export async function checkSharedBinaryUsabilitySync(
  command: string,
  _options?: SharedBinaryUsabilityOptions
): Promise<SharedBinaryUsabilityResult> {
  // This is a simplified version that just checks existence
  // Used for testing where we don't want to spawn actual processes
  try {
    const { stdout } = await execAsync(`which ${command}`, { timeout: 5000 });
    if (stdout.trim().length > 0) {
      return {
        status: "ready",
        command,
        reason: "Found in PATH (sync check)",
      };
    }
    return {
      status: "missing",
      command,
      reason: "Not found in PATH",
    };
  } catch {
    return {
      status: "missing",
      command,
      reason: "Not found in PATH",
    };
  }
}
