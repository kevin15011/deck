/**
 * CLI argument parser for `deck` commands.
 *
 * Supports:
 * - `deck` (no args) → TUI mode
 * - `deck pi developer` → launch Pi with Developer Team
 * - `deck pi developer --continue` → continue Developer Team session
 * - `deck pi developer --resume` → resume picker for Developer Team session
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
    }
  | {
      command: "error";
      message: string;
    };

/**
 * Known team slugs mapped to canonical team IDs.
 */
const TEAM_SLUGS: Record<string, string> = {
  developer: "developer-team",
};

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

  if (first !== "pi") {
    return { command: "tui" };
  }

  // `deck pi ...`
  if (rest.length === 0) {
    return {
      command: "error",
      message: "Usage: deck pi <team> [--continue | --resume]\nAvailable teams: developer",
    };
  }

  const [teamSlug, ...flags] = rest;
  const teamId = TEAM_SLUGS[teamSlug];

  if (!teamId) {
    const available = Object.keys(TEAM_SLUGS).join(", ");
    return {
      command: "error",
      message: `Unknown Pi team: ${teamSlug}. Available teams: ${available}`,
    };
  }

  // Parse flags
  let shouldContinue = false;
  let shouldResume = false;

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
    }
  }

  // --continue and --resume are mutually exclusive
  if (shouldContinue && shouldResume) {
    return {
      command: "error",
      message: "Error: --continue and --resume are mutually exclusive. Use one or the other.",
    };
  }

  return {
    command: "pi-launch",
    teamId,
    flags: {
      ...(shouldContinue ? { continue: true } : {}),
      ...(shouldResume ? { resume: true } : {}),
    },
  };
}
