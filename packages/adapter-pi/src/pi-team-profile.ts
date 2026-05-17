import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getTeamSessionInstructions } from "@deck/core/teams/developer/content-registry";
import { buildTeamProfileDir } from "./pi-team-launch";
import { getTeamsForEnvironment } from "./team-catalog";

// --- Types ---

export type MaterializeTeamProfileOptions = {
  teamId: string;
  projectRoot: string;
  /** Injected fs functions for testability */
  mkdir?: (path: string, options?: { recursive: boolean }) => void;
  writeFile?: (path: string, data: string, encoding?: BufferEncoding) => void;
  readFile?: (path: string, encoding?: BufferEncoding) => string;
  exists?: (path: string) => boolean;
};

// --- System Prompt Builder ---

/**
 * Validates that a team ID is known to the team catalog.
 */
function validateTeamForProfile(teamId: string): void {
  const teams = getTeamsForEnvironment("pi-development");
  if (!teams.some((t) => t.id === teamId)) {
    const available = teams.map((t) => t.id.replace("-team", "")).join(", ");
    throw new Error(`Unknown team: "${teamId}". Available teams: ${available}`);
  }
}

/**
 * Builds the system prompt content for a team.
 *
 * Uses the core registry to get runner-agnostic session instructions,
 * then maps the result to Pi's runtime: the content is written to
 * .deck/pi/profiles/<team>/system-prompt.md and passed via --system-prompt.
 */
export function buildTeamSystemPrompt(teamId: string): string {
  validateTeamForProfile(teamId);

  const instructions = getTeamSessionInstructions(teamId);
  if (instructions) {
    return instructions;
  }

  // Fallback for teams that don't have session instructions yet
  // (future teams that haven't been added to the registry)
  return [
    `# Deck ${teamId} Session`,
    "",
    "You are operating within a Deck team session.",
    "",
  ].join("\n");
}

// --- Profile Materializer ---

/**
 * Materializes the team profile directory and system prompt file on disk.
 *
 * This is called before launching Pi to ensure the profile artifacts exist.
 * The function is idempotent — it won't overwrite unchanged files.
 */
export function materializeTeamProfile(options: MaterializeTeamProfileOptions): void {
  const { teamId, projectRoot } = options;

  const mkdir = options.mkdir ?? mkdirSync;
  const writeFile = options.writeFile ?? writeFileSync;
  const readFile = options.readFile ?? readFileSync;
  const exists = options.exists ?? existsSync;

  const profileDir = buildTeamProfileDir(projectRoot, teamId);
  const systemPromptPath = join(profileDir, "system-prompt.md");

  const content = buildTeamSystemPrompt(teamId);

  // Ensure directory exists
  if (!exists(profileDir)) {
    mkdir(profileDir, { recursive: true });
  }

  // Skip write if content unchanged
  if (exists(systemPromptPath)) {
    const existing = readFile(systemPromptPath, "utf-8");
    if (existing === content) {
      return;
    }
  }

  writeFile(systemPromptPath, content, "utf-8");
}
