/**
 * CLI argument parser for `deck` commands.
 *
 * Supports:
 * - `deck` (no args) → TUI mode
 * - `deck doctor` → run doctor diagnostics
 * - `deck rollback` → restore the most-recent backup (REQ-RBK-001)
 * - `deck pi developer` → launch Pi with Developer Team
 * - `deck pi developer --continue` → continue Developer Team session
 * - `deck pi developer --resume` → resume picker for Developer Team session
 * - `deck pi developer --memory=engram` → enable Engram memory provider (experimental)
 * - `deck pi developer --memory=supermemory` → enable Supermemory MCP memory provider
 * - `deck pi developer --memory=none` → explicitly disable memory provider (default)
 */

export type ParsedArgs =
  | { command: "tui" }
  | { command: "doctor" }
  | { command: "version" }
  | {
      command: "upgrade";
      flags: {
        /** Automatic yes mode - skip confirmations */
        yes?: boolean;
      };
    }
  | {
      command: "rollback";
      flags: {
        /** Force rollback even if the backup is referenced by an active operation. */
        force?: boolean;
        /** Optional explicit backup id; defaults to the most recent. */
        backupId?: string;
      };
    }
  | {
      command: "pi-launch";
      teamId: string;
      flags: {
        continue?: boolean;
        resume?: boolean;
      };
      /** Memory provider selection, e.g. "engram" or "supermemory". Undefined means no memory. */
      memoryProvider?: string;
    }
  | {
      command: "error";
      message: string;
    };

/**
 * Known team slugs mapped to canonical team IDs.
 */
const PI_TEAM_SLUGS: Record<string, string> = {
  developer: "developer-team",
};

/**
 * Supported memory provider identifiers for Pi.
 */
export const SUPPORTED_MEMORY_PROVIDERS = ["engram", "supermemory"] as const;
export type SupportedMemoryProvider = (typeof SUPPORTED_MEMORY_PROVIDERS)[number];

function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (value === undefined || value === "") return true;
  if (value === "true") return true;
  if (value === "false") return false;
  return true;
}

/**
 * Parse raw CLI arguments into a structured command.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  // argv[0] is typically the runtime, argv[1] is the script
  // We skip those — the caller should pass only the user args
  const args = argv.slice(0);

  if (args.length === 0) {
    return { command: "tui" };
  }

  const [first, ...rest] = args;

  if (first === "doctor") {
    if (rest.length > 0) {
      return {
        command: "error",
        message: "El comando `deck doctor` no acepta argumentos adicionales.",
      };
    }
    return { command: "doctor" };
  }

  if (first === "version") {
    if (rest.length > 0) {
      return {
        command: "error",
        message: "El comando `deck version` no acepta argumentos.",
      };
    }
    return { command: "version" };
  }

  if (first === "upgrade" || first === "update") {
    // Both `deck upgrade` and `deck update` route to the same handler.
    // `upgrade` is the historical command; `update` is the new alias added
    // by `add-self-update-system` / T2.11. The flag vocabulary is shared.
    // Parse flags for upgrade command
    let yesMode = false;
    for (const flag of rest) {
      if (flag === "--yes" || flag === "-y") {
        yesMode = true;
      } else if (flag.startsWith("--yes=") || flag.startsWith("-y=")) {
        const value = parseBooleanFlag(flag.slice(flag.indexOf("=") + 1));
        yesMode = value === true;
      } else {
        return {
          command: "error",
          message: `Flag desconocido para ${first}: ${flag}. Usa --help para ver el uso.`,
        };
      }
    }
    return {
      command: "upgrade",
      flags: {
        ...(yesMode ? { yes: true } : {}),
      },
    };
  }

  if (first === "rollback") {
    // `deck rollback` restores the most-recent backup (REQ-RBK-001).
    // Accepts `--force` to bypass the "backup referenced by state"
    // protection, and `--backup <id>` to target a specific backup.
    let force = false;
    let backupId: string | undefined;
    for (let i = 0; i < rest.length; i += 1) {
      const flag = rest[i]!;
      if (flag === "--force") {
        force = true;
      } else if (flag === "--backup" || flag === "--backup-id") {
        const value = rest[i + 1];
        if (value === undefined || value.startsWith("--")) {
          return {
            command: "error",
            message: `Flag ${flag} requires a value.`,
          };
        }
        backupId = value;
        i += 1;
      } else if (flag.startsWith("--backup=")) {
        backupId = flag.slice("--backup=".length);
      } else if (flag.startsWith("--backup-id=")) {
        backupId = flag.slice("--backup-id=".length);
      } else {
        return {
          command: "error",
          message: `Flag desconocido para rollback: ${flag}. Usa --help para ver el uso.`,
        };
      }
    }
    return {
      command: "rollback",
      flags: {
        ...(force ? { force: true } : {}),
        ...(backupId ? { backupId } : {}),
      },
    };
  }

  if (first !== "pi") {
    return { command: "tui" };
  }

  // `deck pi ...`
  if (rest.length === 0) {
    return {
      command: "error",
      message: "Usage: deck pi <team> [--continue | --resume] [--memory=engram|supermemory|none]\nAvailable teams: developer",
    };
  }

  const [teamSlug, ...flags] = rest;
  const teamId = PI_TEAM_SLUGS[teamSlug];

  if (!teamId) {
    const available = Object.keys(PI_TEAM_SLUGS).join(", ");
    return {
      command: "error",
      message: `Unknown Pi team: ${teamSlug}. Available teams: ${available}`,
    };
  }

  // Parse flags
  let shouldContinue = false;
  let shouldResume = false;
  let memoryProvider: string | undefined;

  for (const flag of flags) {
    if (flag === "--continue") {
      shouldContinue = true;
    } else if (flag.startsWith("--continue=")) {
      const value = parseBooleanFlag(flag.slice("--continue=".length));
      shouldContinue = value === true;
    } else if (flag === "--resume") {
      shouldResume = true;
    } else if (flag.startsWith("--resume=")) {
      const value = parseBooleanFlag(flag.slice("--resume=".length));
      shouldResume = value === true;
    } else if (flag === "--memory") {
      memoryProvider = "";
    } else if (flag.startsWith("--memory=")) {
      memoryProvider = flag.slice("--memory=".length);
    }
  }

  // --continue and --resume are mutually exclusive
  if (shouldContinue && shouldResume) {
    return {
      command: "error",
      message: "Error: --continue and --resume are mutually exclusive. Use one or the other.",
    };
  }

  // Validate memory provider if specified
  if (memoryProvider !== undefined) {
    if (memoryProvider === "" || memoryProvider === "none") {
      // Explicitly disabled — treat as no provider
      memoryProvider = undefined;
    } else if (!SUPPORTED_MEMORY_PROVIDERS.includes(memoryProvider as SupportedMemoryProvider)) {
      const available = [...SUPPORTED_MEMORY_PROVIDERS, "none"].join(", ");
      return {
        command: "error",
        message: `Unsupported memory provider: ${memoryProvider}. Available providers: ${available}`,
      };
    }
  }

  return {
    command: "pi-launch",
    teamId,
    flags: {
      ...(shouldContinue ? { continue: true } : {}),
      ...(shouldResume ? { resume: true } : {}),
    },
    ...(memoryProvider ? { memoryProvider } : {}),
  };
}