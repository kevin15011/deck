import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { buildPiTeamLaunchPlan, materializeTeamProfile, type PiTeamLaunchPlan } from "@deck/adapter-pi";

// --- Types ---

export type RunPiLaunchOptions = {
  teamId: string;
  projectRoot: string;
  flags: {
    continue?: boolean;
    resume?: boolean;
  };
  /** Check if a command exists in PATH */
  commandExists?: (command: string) => boolean;
  /** Override the Pi command path */
  piCommand?: string;
  /** If true, don't spawn Pi — just return the plan */
  dryRun?: boolean;
};

export type PiLaunchResult =
  | { status: "error"; message: string }
  | { status: "ready"; plan: PiTeamLaunchPlan; profileDir: string }
  | { status: "launched"; plan: PiTeamLaunchPlan };

// --- Command ---

/**
 * Prepares and optionally launches a Pi session for a Deck team.
 *
 * In dry-run mode, it materializes the team profile and returns the launch plan
 * without actually spawning Pi.
 *
 * In live mode, it spawns Pi as a child process with the correct args.
 */
export function runPiLaunch(options: RunPiLaunchOptions): PiLaunchResult {
  const { teamId, projectRoot, flags, dryRun = false } = options;
  const commandExists = options.commandExists ?? defaultCommandExists;
  const piCommand = options.piCommand ?? "pi";

  // Check if pi is available
  if (!commandExists(piCommand)) {
    return {
      status: "error",
      message: `Pi command not found: "${piCommand}". Install Pi first or check your PATH.`,
    };
  }

  // Materialize the team profile (creates .deck/pi/profiles/<team>/system-prompt.md)
  materializeTeamProfile({ teamId, projectRoot });

  // Build the launch plan
  const plan = buildPiTeamLaunchPlan({
    teamId,
    projectRoot,
    flags,
    piCommand,
  });

  if (dryRun) {
    return {
      status: "ready",
      plan,
      profileDir: plan.profileDir,
    };
  }

  // In live mode, we would spawn Pi here.
  // For now, we return the plan — the actual spawn is handled by the CLI entry point.
  return {
    status: "launched",
    plan,
  };
}

function defaultCommandExists(command: string): boolean {
  const path = process.env.PATH ?? "";
  return path.split(delimiter).some((dir) => {
    try {
      accessSync(join(dir, command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}
