import { join } from "node:path";
import { sanitizeRunnerEnv } from "@deck/core";
import { piAgentPaths } from "./agent-dir";
import { deckPiSessionEnv } from "./pi-activation-guard";
import { getDeveloperTeamCatalog } from "./developer-team-catalog";
import { readDeveloperTeamModelConfigAssignments } from "./developer-team-install";
import { resolveThinkingForModel, supportsDeveloperTeamModel, type PiThinkingLevel } from "./model-config";
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
  /** Packaged runner-native execution extension loaded by Pi */
  extensionPath: string;
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
  /**
   * Resolved Pi agent directory. When set, the plan uses the Deck-managed GLOBAL layout: the lead profile lives
   * under `<agentDir>/deck/profiles`, the registered Deck package is also passed as `--extension <package>` so its skills win name collisions,
   * and no project-local `.pi` / `.deck/pi/profiles` path is referenced. Without it, the deprecated
   * project-local layout is used (kept only for the legacy launch module and its tests).
   */
  agentDir?: string;
};

const DEVELOPER_ORCHESTRATOR_AGENT_ID = "deck-lead";

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
  const globalPaths = options.agentDir ? piAgentPaths(options.agentDir) : undefined;
  const profileDir = globalPaths ? join(globalPaths.profilesRoot, teamId) : buildTeamProfileDir(projectRoot, teamId);
  const extensionPath = globalPaths
    ? join(globalPaths.packageRoot, "extensions", "developer-team-execution", "index.js")
    : join(profileDir, "extensions", "developer-team-execution.js");

  // Get canonical agent IDs from the team catalog
  const catalog = getDeveloperTeamCatalog();
  const agentIds = catalog.map((agent) => agent.id);

  // Build args — Pi CLI flags for session isolation and system prompt
  const args: string[] = [
    "--session-dir", sessionDir,
    "--system-prompt", join(profileDir, "system-prompt.md"),
    // Global layout: the Deck package is registered in settings.json, and is ALSO passed as a temporary CLI source.
    // Pi merges CLI package sources before auto-discovered `<agentDir>/skills` and `~/.agents/skills`, and the first
    // skill with a name wins, so the package skills beat stale legacy or other-runner copies in Deck sessions only.
    // Pi dedupes the same package path against the settings entry (extensions load once).
    ...(globalPaths ? ["--extension", globalPaths.packageRoot] : ["--extension", extensionPath]),
  ];

  const assignments = globalPaths
    ? readDeveloperTeamModelConfigAssignments(projectRoot, { agentsDir: join(globalPaths.packageRoot, "agents") })
    : readDeveloperTeamModelConfigAssignments(projectRoot);
  const orchestratorModel = assignments.modelAssignments[DEVELOPER_ORCHESTRATOR_AGENT_ID];
  if (orchestratorModel && supportsDeveloperTeamModel(orchestratorModel)) {
    args.push("--model", orchestratorModel);
    const hasThinkingAssignment = Object.prototype.hasOwnProperty.call(assignments.thinkingAssignments, DEVELOPER_ORCHESTRATOR_AGENT_ID);
    const thinking = hasThinkingAssignment ? resolveThinkingForModel(orchestratorModel, assignments.thinkingAssignments[DEVELOPER_ORCHESTRATOR_AGENT_ID] as PiThinkingLevel | undefined) : undefined;
    if (thinking) args.push("--thinking", thinking);
  }

  if (isContinue) {
    args.push("--continue");
  }

  if (isResume) {
    args.push("--resume");
  }

  // Pi 1.0 ignores PI_SESSION_DIR; the session directory is passed only through --session-dir above.
  const env: Record<string, string> = {
    ...sanitizeRunnerEnv(process.env),
    ...(globalPaths ? deckPiSessionEnv("lead") : {}),
  };
  // A lead launch must never inherit a subagent-child marker from an outer Deck session.
  if (globalPaths) delete env.DECK_PI_CHILD;

  return {
    command: piCommand,
    args,
    env,
    cwd: projectRoot,
    sessionDir,
    profileDir,
    extensionPath,
    isContinue,
    isResume,
    agentIds,
  };
}
