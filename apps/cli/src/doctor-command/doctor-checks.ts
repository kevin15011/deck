/**
 * Doctor diagnostic checks by domain.
 *
 * Each helper returns DoctorCategoryResult with redacted messages.
 * All helpers are pure functions with injectable dependencies for testability.
 */

import { existsSync, statSync, accessSync, constants } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { spawn as spawnImpl } from "node:child_process";
import { redact, validateSupermemoryPiMcpConfig } from "@deck/adapter-pi";
import { validateSupermemoryOpenCodeMcpConfig } from "@deck/adapter-opencode";

import { readManifest, detectManifestDrift } from "../upgrade-command/manifest-store";
import { readState } from "../upgrade-command/state-store";
import { getDeckXdgPaths } from "../runtime/paths";
import type { DoctorCategoryResult, DoctorCheckItem, DoctorStatus } from "./types";

// ---------------------------------------------------------------------------
// Types for injectable dependencies
// ---------------------------------------------------------------------------

export type DoctorCheckDeps = {
  /** File system exists check */
  exists: (path: string) => boolean;
  /** File system stat check */
  stat: (path: string) => ReturnType<typeof statSync> | null;
  /** File system access check (R_OK | X_OK) - returns true if accessible, false on EACCES/ENOENT */
  access: (path: string) => boolean;
  /** Spawn command for version detection */
  spawn: (
    command: string,
    args: string[],
    options: { timeout: number; cwd?: string },
  ) => Promise<{ stdout: string; stderr: string; code: number | null }>;
  /** Get current Deck version (for defaults) */
  getDeckVersion: () => string;
  /** Redact function */
  redact: (msg: string) => string;
  /** Redact path (fold home-relative paths) */
  redactPath: (msg: string) => string;
};

/** Default dependencies using Node.js built-ins */
const MAX_OUTPUT_BYTES = 4096; // 4 KiB cap per stream

function defaultRedactPath(msg: string): string {
  // Fold home directory and temp paths to prevent leaking user info
  const home = homedir();
  const tmp = tmpdir();
  let result = msg;
  if (home) {
    // Replace absolute home paths with ~, being careful with regex
    const homeEscaped = home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(homeEscaped, "g"), "~");
    // Also handle /home/<username> pattern
    result = result.replace(/\/home\/[^\/]+/g, "~");
  }
  if (tmp) {
    const tmpEscaped = tmp.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    result = result.replace(new RegExp(tmpEscaped, "g"), "{tmp}");
  }
  return result;
}

function defaultAccess(path: string): boolean {
  try {
    accessSync(path, constants.R_OK | constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export const defaultDoctorCheckDeps: DoctorCheckDeps = {
  exists: existsSync,
  stat: (path: string) => {
    try {
      return statSync(path);
    } catch {
      return null;
    }
  },
  access: defaultAccess,
  spawn: async (command: string, args: string[], options: { timeout: number }) => {
    return new Promise((resolve) => {
      const proc = spawnImpl(command, args, {
        timeout: options.timeout,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      proc.stdout?.on("data", (chunk) => {
        if (stdout.length < MAX_OUTPUT_BYTES) {
          stdout += chunk.toString();
          if (stdout.length > MAX_OUTPUT_BYTES) {
            stdout = stdout.slice(0, MAX_OUTPUT_BYTES) + "...[truncated]";
          }
        }
      });
      proc.stderr?.on("data", (chunk) => {
        if (stderr.length < MAX_OUTPUT_BYTES) {
          stderr += chunk.toString();
          if (stderr.length > MAX_OUTPUT_BYTES) {
            stderr = stderr.slice(0, MAX_OUTPUT_BYTES) + "...[truncated]";
          }
        }
      });
      proc.on("close", (code) => {
        resolve({ stdout, stderr, code: code ?? -1 });
      });
      proc.on("error", () => {
        resolve({ stdout, stderr, code: -1 });
      });
    });
  },
  getDeckVersion: () => process.env.DECK_VERSION ?? "unknown",
  redact,
  redactPath: defaultRedactPath,
};

// ---------------------------------------------------------------------------
// Helper: Derive category status from items
// ---------------------------------------------------------------------------

function deriveStatus(items: DoctorCheckItem[]): DoctorStatus {
  if (items.some((i) => i.status === "error")) return "error";
  if (items.some((i) => i.status === "warning")) return "warning";
  return "ok";
}

// ---------------------------------------------------------------------------
// Helper: Truncate drift list
// ---------------------------------------------------------------------------

const DEFAULT_TRUNCATE_LIMIT = 10;

/**
 * Truncate a list of items to max N, adding a count of remaining items.
 */
function truncateList<T>(items: T[], limit: number = DEFAULT_TRUNCATE_LIMIT): {
  displayed: T[];
  remaining: number;
} {
  if (items.length <= limit) {
    return { displayed: items, remaining: 0 };
  }
  return {
    displayed: items.slice(0, limit),
    remaining: items.length - limit,
  };
}

// ---------------------------------------------------------------------------
// Check: Manifest (schema v2, drift detection)
// ---------------------------------------------------------------------------

export type CheckManifestResult = DoctorCategoryResult;

export function checkManifest(deps: DoctorCheckDeps = defaultDoctorCheckDeps): CheckManifestResult {
  const items: DoctorCheckItem[] = [];

  try {
    const manifestPath = getDeckXdgPaths().manifestPath;

        // readManifest() returns default empty manifest when file is missing,
    // which would incorrectly report a fresh install instead of missing manifest
    const manifestExists = deps.exists(manifestPath);

    if (!manifestExists) {
      items.push({
        status: "error",
        message: "Manifest file not found",
        suggestion: "Run 'deck install' to generate the manifest or check XDG paths.",
      });
      return {
        category: "Manifest",
        status: "error",
        items,
      };
    }

    // Manifest exists - now read and check for drift
    const manifest = readManifest(deps.getDeckVersion());
    const drift = detectManifestDrift(manifest);

    // Check for missing files
    if (drift.missing.length > 0) {
      const missingArray = [...drift.missing];
      const { displayed, remaining } = truncateList(missingArray);
        const displayedRedacted = displayed.map(p => deps.redactPath(p));
      const remainingText = remaining > 0 ? ` and ${remaining} more` : "";
      items.push({
        status: "error",
        message: `${drift.missing.length} file(s) declared in manifest not found on disk: ${displayedRedacted.join(", ")}${remainingText}`,
        suggestion: "Run 'deck install' to restore missing files or check for manual deletions.",
      });
    }

    // Check for changed files
    if (drift.changed.length > 0) {
      const changedPaths = drift.changed.map((c) => c.path);
      const { displayed, remaining } = truncateList(changedPaths);
        const displayedRedacted = displayed.map(p => deps.redactPath(p));
      const remainingText = remaining > 0 ? ` and ${remaining} more` : "";
      items.push({
        status: "warning",
        message: `${drift.changed.length} file(s) have changed since installation: ${displayedRedacted.join(", ")}${remainingText}`,
        suggestion: "Verify changes are intentional or run 'deck install' to restore original files.",
      });
    }

    // If no drift, report success
    if (drift.missing.length === 0 && drift.changed.length === 0 && drift.ok.length > 0) {
      items.push({
        status: "ok",
        message: `Manifest validated: ${drift.ok.length} files checked, all intact.`,
      });
    } else if (drift.missing.length === 0 && drift.changed.length === 0 && drift.ok.length === 0) {
      items.push({
        status: "ok",
        message: "Manifest is valid (empty, fresh installation).",
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    items.push({
      status: "error",
      message: `Manifest validation failed: ${deps.redact(message)}`,
      suggestion: "Run 'deck install' to regenerate the manifest or check file permissions.",
    });
  }

  return {
    category: "Manifest",
    status: deriveStatus(items),
    items,
  };
}

// ---------------------------------------------------------------------------
// Check: State (coherency with filesystem)
// ---------------------------------------------------------------------------

export type CheckStateResult = DoctorCategoryResult;

export function checkState(deps: DoctorCheckDeps = defaultDoctorCheckDeps): CheckStateResult {
  const items: DoctorCheckItem[] = [];

  try {
    const state = readState(deps.getDeckVersion());

    // Check if state indicates installed but state dir doesn't exist
    const xdgPaths = getDeckXdgPaths();
    const stateDirExists = deps.exists(xdgPaths.stateDir);

    if (!stateDirExists) {
      items.push({
        status: "warning",
        message: `State directory does not exist: ${deps.redact(xdgPaths.stateDir)}`,
        suggestion: "Run 'deck init' to initialize Deck or check XDG configuration.",
      });
    } else {
      // Check install kind
      if (state.installKind === "unknown") {
        items.push({
          status: "warning",
          message: "Installation type is unknown (fresh install or migration pending).",
          suggestion: "Run 'deck init' to set up the installation type.",
        });
      } else {
        items.push({
          status: "ok",
          message: `State validated: installed as ${state.installKind}, version ${state.currentVersion}.`,
        });
      }

      // Check for active operation (lock)
      if (state.lock?.active) {
        items.push({
          status: "warning",
          message: "An upgrade operation appears to be in progress.",
          suggestion: "Wait for the operation to complete or check process status.",
        });
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    items.push({
      status: "error",
      message: `State validation failed: ${deps.redact(message)}`,
      suggestion: "Run 'deck init' to initialize Deck state.",
    });
  }

  return {
    category: "State",
    status: deriveStatus(items),
    items,
  };
}

// ---------------------------------------------------------------------------
// Check: Deck Config (XDG config dir)
// ---------------------------------------------------------------------------

export type CheckDeckConfigResult = DoctorCategoryResult;

export function checkDeckConfig(deps: DoctorCheckDeps = defaultDoctorCheckDeps): CheckDeckConfigResult {
  const items: DoctorCheckItem[] = [];

  try {
    const xdgPaths = getDeckXdgPaths();
    const configDirExists = deps.exists(xdgPaths.configDir);

    if (configDirExists) {
            const isReadable = deps.access(xdgPaths.configDir);

      if (isReadable) {
        items.push({
          status: "ok",
          message: `Config directory exists and is readable: ${deps.redactPath(xdgPaths.configDir)}`,
        });
      } else {
        items.push({
          status: "error",
          message: `Config directory exists but is not readable: ${deps.redactPath(xdgPaths.configDir)}`,
          suggestion: "Check directory permissions - run 'chmod 755' on the config directory.",
        });
      }
    } else {
      items.push({
        status: "warning",
        message: `Config directory not found: ${deps.redactPath(xdgPaths.configDir)}`,
        suggestion: "Run 'deck init' to create the config directory.",
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    items.push({
      status: "error",
      message: `Config directory check failed: ${deps.redact(message)}`,
      suggestion: "Check XDG_CONFIG_HOME environment variable and permissions.",
    });
  }

  return {
    category: "Deck Config",
    status: deriveStatus(items),
    items,
  };
}

// ---------------------------------------------------------------------------
// Check: Binaries (existence, executable, version)
// ---------------------------------------------------------------------------

/** Known binaries to check */
const KNOWN_BINARIES = [
  { id: "deck", label: "Deck CLI", command: "deck" },
  { id: "opencode", label: "OpenCode", command: "opencode" },
  { id: "pi", label: "Pi", command: "pi" },
  { id: "engram", label: "Engram", command: "engram" },
  { id: "supermemory", label: "Supermemory", command: "supermemory" },
  { id: "serena", label: "Serena", command: "serena" },
] as const;

export type CheckBinaryResult = DoctorCategoryResult;

export async function checkBinaries(deps: DoctorCheckDeps = defaultDoctorCheckDeps): Promise<CheckBinaryResult> {
  const items: DoctorCheckItem[] = [];

  const isWindows = process.platform === "win32";
  const suffixes = isWindows ? ["", ".exe"] : [""];

    const binaryChecks = await Promise.all(
    KNOWN_BINARIES.map(async (binary) => {
      try {
        // Find in PATH
        const pathDirs = (process.env.PATH ?? "").split(isWindows ? ";" : ":");
        let foundPath: string | null = null;
        let isExecutable = false;

        for (const dir of pathDirs) {
          for (const suffix of suffixes) {
            const fullPath = `${dir}/${binary.command}${suffix}`.replace(/^\/+/, "/");
            if (deps.exists(fullPath)) {
              foundPath = fullPath;
              // Check executable bit
              const stat = deps.stat(fullPath);
              if (stat) {
                // POSIX: check executable bit
                if (!isWindows) {
                  const mode = stat.mode as number;
                  isExecutable = (mode & 0o111) !== 0;
                } else {
                  // Windows: just check exists (extension check is approximate)
                  isExecutable = true;
                }
              }
              break;
            }
          }
          if (foundPath) break;
        }

                if (!foundPath) {
          return {
            status: "error" as const,
            message: `${binary.label} not found in PATH`,
            suggestion: `Install ${binary.label} or add it to your PATH.`,
          };
        }

        if (!isExecutable) {
          return {
            status: "error" as const,
            message: `${binary.label} found but not executable: ${deps.redact(foundPath)}`,
            suggestion: `Run 'chmod +x ${binary.command}' to make it executable.`,
          };
        }

                let version = "unknown";
        try {
          const versionResult = await deps.spawn(binary.command, ["--version"], { timeout: 2000 });
          if (versionResult.code === 0 && versionResult.stdout) {
            // Use redactPath to fold home/temp paths before processing
            const redactedOutput = deps.redactPath(versionResult.stdout);
            const firstLine = redactedOutput.split("\n")[0].trim();
            // Extract version number if possible
            const versionMatch = firstLine.match(/(\d+\.\d+\.\d+)/);
            version = versionMatch ? versionMatch[1] : firstLine.substring(0, 50);
          }
        } catch {
          // Version check failed - this is just informational
        }

        return {
          status: "ok" as const,
          message: `${binary.label} found and executable (v${version})`,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          status: "error" as const,
          message: `Failed to check ${binary.label}: ${deps.redact(message)}`,
        };
      }
    })
  );

  // Flatten results
  for (const result of binaryChecks) {
    items.push(result);
  }

  return {
    category: "Binaries",
    status: deriveStatus(items),
    items,
  };
}

// ---------------------------------------------------------------------------
// Check: Runner Config (generic validation via existing adapters)
// ---------------------------------------------------------------------------

export type CheckRunnerConfigResult = DoctorCategoryResult;

export function checkRunnerConfig(deps: DoctorCheckDeps = defaultDoctorCheckDeps): CheckRunnerConfigResult {
  const items: DoctorCheckItem[] = [];

    const home = homedir();

    // OpenCode config validation
  try {
    const opencodeConfigPath = `${home}/.config/opencode/opencode.json`.replace(/^\/+/, "/");
    if (deps.exists(opencodeConfigPath)) {
      // Use adapter validation to check actual config content
      const validation = validateSupermemoryOpenCodeMcpConfig({
        configPath: opencodeConfigPath,
        homeDir: home,
      });

      if (validation.ok) {
        items.push({
          status: "ok",
          message: "OpenCode config validated successfully",
        });
      } else {
        // Report specific validation diagnostics (not errors)
        const diagMessages = validation.diagnostics?.join("; ") ?? "Unknown validation issue";
        items.push({
          status: "warning",
          message: `OpenCode config has issues: ${diagMessages}`,
          suggestion: "Run OpenCode to fix configuration or re-initialize.",
        });
      }
    } else {
      items.push({
        status: "warning",
        message: "OpenCode config not found",
        suggestion: "Run OpenCode to initialize configuration.",
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    items.push({
      status: "warning",
      message: `OpenCode config check failed: ${deps.redact(message)}`,
    });
  }

  // Pi config validation (if Pi is installed)
  try {
    const piConfigPath = `${home}/.config/supermemory/pi/config.json`.replace(/^\/+/, "/");
    if (deps.exists(piConfigPath)) {
      // Use adapter validation to check actual config content
      const validation = validateSupermemoryPiMcpConfig({
        configPath: piConfigPath,
        homeDir: home,
      });

      if (validation.ok) {
        items.push({
          status: "ok",
          message: "Pi config validated successfully",
        });
      } else {
        const diagMessages = validation.diagnostics?.map((d: { message: string }) => d.message).join("; ") ?? "Unknown validation issue";
        items.push({
          status: "warning",
          message: `Pi config has issues: ${diagMessages}`,
          suggestion: "Run 'deck doctor' with Pi to fix configuration or re-initialize.",
        });
      }
    }
    // Pi config is optional - no warning if not found
  } catch {
    // Ignore Pi config errors silently
  }

  return {
    category: "Runner Config",
    status: deriveStatus(items),
    items,
  };
}

// ---------------------------------------------------------------------------
// Main: Run all Deck-owned checks
// ---------------------------------------------------------------------------

/**
 * Run all deck-owned diagnostic checks (manifest, state, config, binaries, runner config).
 * Each check runs in isolated try/catch.
 */
export async function runDeckChecks(deps: DoctorCheckDeps = defaultDoctorCheckDeps): Promise<{
  deck: DoctorCategoryResult[];
  binary: DoctorCategoryResult[];
  runnerConfig: DoctorCategoryResult[];
}> {
  const deck: DoctorCategoryResult[] = [];
  const binary: DoctorCategoryResult[] = [];
  const runnerConfig: DoctorCategoryResult[] = [];

  // Deck checks (manifest, state, config)
  deck.push(checkManifest(deps));
  deck.push(checkState(deps));
  deck.push(checkDeckConfig(deps));

  // Binary checks (async)
  binary.push(await checkBinaries(deps));

  // Runner config
  runnerConfig.push(checkRunnerConfig(deps));

  return { deck, binary, runnerConfig };
}
