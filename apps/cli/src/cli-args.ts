/**
 * CLI argument parser for `deck` commands.
 *
 * Supports:
 * - `deck` (no args) → TUI mode
 * - `deck pi developer` → launch Pi with Developer Team
 * - `deck pi developer --continue` → continue Developer Team session
 * - `deck pi developer --resume` → resume picker for Developer Team session
 * - `deck pi developer --memory=engram` → enable Engram memory provider (experimental)
 * - `deck pi developer --memory=supermemory` → enable Supermemory MCP memory provider
 * - `deck pi developer --memory=none` → explicitly disable memory provider (default)
 */

export type ParsedArgs =
  | { command: "tui" }
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
      command: "opencode-launch";
      teamId: string;
      /** Memory provider selection, e.g. "engram". Undefined means no memory. */
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

const OPENCODE_TEAM_SLUGS: Record<string, string> = {
  developer: "developer-team",
};

/**
 * Supported memory provider identifiers for Pi.
 */
export const SUPPORTED_MEMORY_PROVIDERS = ["engram", "supermemory"] as const;
export type SupportedMemoryProvider = (typeof SUPPORTED_MEMORY_PROVIDERS)[number];

/**
 * Supported memory provider identifiers for OpenCode.
 */
export const SUPPORTED_OPENCODE_MEMORY_PROVIDERS = ["engram"] as const;
export type SupportedOpenCodeMemoryProvider = (typeof SUPPORTED_OPENCODE_MEMORY_PROVIDERS)[number];

function parseBooleanFlag(value: string | undefined): boolean | undefined {
  if (value === undefined || value === "") return true;
  if (value === "true") return true;
  if (value === "false") return false;
  return true;
}

/**
 * Parse `deck opencode <team> [--memory=<provider>]`.
 */
function parseOpenCodeCommand(rest: string[]): ParsedArgs {
  if (rest.length === 0) {
    return {
      command: "error",
      message: "Usage: deck opencode <team> [--memory=engram]\nAvailable teams: developer",
    };
  }

  const [teamSlug, ...flags] = rest;
  const teamId = OPENCODE_TEAM_SLUGS[teamSlug];

  if (!teamId) {
    const available = Object.keys(OPENCODE_TEAM_SLUGS).join(", ");
    return {
      command: "error",
      message: `Unknown OpenCode team: ${teamSlug}. Available teams: ${available}`,
    };
  }

  let memoryProvider: string | undefined;
  for (const flag of flags) {
    if (flag === "--memory") {
      memoryProvider = "";
    } else if (flag.startsWith("--memory=")) {
      memoryProvider = flag.slice("--memory=".length);
    }
  }

  if (memoryProvider !== undefined) {
    if (memoryProvider === "" || memoryProvider === "none") {
      memoryProvider = undefined;
    } else if (!SUPPORTED_OPENCODE_MEMORY_PROVIDERS.includes(memoryProvider as SupportedOpenCodeMemoryProvider)) {
      const available = [...SUPPORTED_OPENCODE_MEMORY_PROVIDERS, "none"].join(", ");
      return {
        command: "error",
        message: `Unsupported memory provider: ${memoryProvider}. Available providers: ${available}`,
      };
    }
  }

  return {
    command: "opencode-launch",
    teamId,
    ...(memoryProvider ? { memoryProvider } : {}),
  };
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

  if (first === "opencode") {
    return parseOpenCodeCommand(rest);
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
