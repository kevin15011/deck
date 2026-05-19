import { join } from "node:path";
import { getDeveloperTeamCatalog } from "./developer-team-catalog";
import { readDeveloperTeamModelConfigAssignments } from "./developer-team-install";
import { resolveThinkingForModel, supportsDeveloperTeamModel } from "./model-config";
import type { TeamId } from "./team-catalog";
import { getTeamsForEnvironment } from "./team-catalog";

// --- Types ---

export type PiTeamLaunchFlags = {
  continue?: boolean;
  resume?: boolean;
};

export type PiTeamLaunchPlan = {
  /** The Pi binary to invoke */
  command: string;
  /** Arguments to pass to Pi */
  args: string[];
  /** Environment variables to set/forward */
  env: Record<string, string>;
  /** Working directory for the Pi process */
  cwd: string;
  /** Directory where session data will be stored */
  sessionDir: string;
  /** Directory containing profile artifacts (system-prompt.md, etc.) */
  profileDir: string;
  /** Whether this is a continuation of an existing session */
  isContinue: boolean;
  /** Whether this is a resume-picker session */
  isResume: boolean;
  /** Canonical agent IDs from the team catalog */
  agentIds: string[];
};

export type BuildPiTeamLaunchPlanOptions = {
  /** Team identifier, e.g. "developer-team" */
  teamId: TeamId;
  /** Project root directory */
  projectRoot: string;
  /** Launch flags */
  flags?: PiTeamLaunchFlags;
  /** Pi command binary name/path (default: "pi") */
  piCommand?: string;
};

const DEVELOPER_ORCHESTRATOR_AGENT_ID = "deck-developer-orchestrator";

// --- Helpers ---

/**
 * Returns the session directory path for a team under the project's `.deck/pi/sessions/` tree.
 */
export function buildTeamSessionDir(projectRoot: string, teamId: string): string {
  return join(projectRoot, ".deck", "pi", "sessions", teamId);
}

/**
 * Returns the profile directory path for a team under the project's `.deck/pi/profiles/` tree.
 */
export function buildTeamProfileDir(projectRoot: string, teamId: string): string {
  return join(projectRoot, ".deck", "pi", "profiles", teamId);
}

// --- Plan Builder ---

/**
 * Resolves a human-friendly team slug (e.g. "developer") to its canonical team ID.
 */
function resolveTeamId(rawTeamId: string): TeamId | null {
  // Direct match
  const teams = getTeamsForEnvironment("pi-development");
  if (teams.some((t) => t.id === rawTeamId)) {
    return rawTeamId as TeamId;
  }

  // Slug match: "developer" -> "developer-team"
  const bySlug = teams.find((t) => t.id.replace("-team", "") === rawTeamId);
  if (bySlug) {
    return bySlug.id as TeamId;
  }

  return null;
}

/**
 * Validates that a team ID is known and has an agent catalog.
 */
function validateTeamId(teamId: string): asserts teamId is TeamId {
  const resolved = resolveTeamId(teamId);
  if (!resolved) {
    const teams = getTeamsForEnvironment("pi-development");
    const available = teams.map((t) => t.id.replace("-team", "")).join(", ");
    throw new Error(`Unknown team: "${teamId}". Available teams: ${available}`);
  }
}

/**
 * Builds a complete Pi launch plan for a given team.
 *
 * The plan includes the command, args, env, cwd, and session/profile paths
 * needed to launch a Pi interactive session pre-shaped for the team.
 *
 * The launch plan does NOT spawn Pi — it only describes what to run.
 * This makes it testable without actually launching Pi.
 */
export function buildPiTeamLaunchPlan(options: BuildPiTeamLaunchPlanOptions): PiTeamLaunchPlan {
  const { projectRoot, flags } = options;
  const teamId = resolveTeamId(options.teamId) ?? options.teamId;
  validateTeamId(teamId);

  const piCommand = options.piCommand ?? "pi";
  const isContinue = flags?.continue === true;
  const isResume = flags?.resume === true;

  const sessionDir = buildTeamSessionDir(projectRoot, teamId);
  const profileDir = buildTeamProfileDir(projectRoot, teamId);

  // Get canonical agent IDs from the team catalog
  const catalog = getDeveloperTeamCatalog();
  const agentIds = catalog.map((agent) => agent.id);

  // Build args — Pi CLI flags for session isolation and system prompt
  const args: string[] = [
    "--session-dir", sessionDir,
    "--system-prompt", join(profileDir, "system-prompt.md"),
  ];

  const assignments = readDeveloperTeamModelConfigAssignments(projectRoot);
  const orchestratorModel = assignments.modelAssignments[DEVELOPER_ORCHESTRATOR_AGENT_ID];
  if (orchestratorModel && supportsDeveloperTeamModel(orchestratorModel)) {
    args.push("--model", orchestratorModel);
    const hasThinkingAssignment = Object.prototype.hasOwnProperty.call(assignments.thinkingAssignments, DEVELOPER_ORCHESTRATOR_AGENT_ID);
    const thinking = hasThinkingAssignment ? resolveThinkingForModel(orchestratorModel, assignments.thinkingAssignments[DEVELOPER_ORCHESTRATOR_AGENT_ID]) : undefined;
    if (thinking) args.push("--thinking", thinking);
  }

  if (isContinue) {
    args.push("--continue");
  }

  if (isResume) {
    args.push("--resume");
  }

  // Forward essential env vars + add PI_SESSION_DIR
  const env: Record<string, string> = {
    ...Object.fromEntries(
      Object.entries(process.env).filter(([, v]) => v !== undefined),
    ) as Record<string, string>,
    PI_SESSION_DIR: sessionDir,
  };

  return {
    command: piCommand,
    args,
    env,
    cwd: projectRoot,
    sessionDir,
    profileDir,
    isContinue,
    isResume,
    agentIds,
  };
}
