/**
 * Canonical team catalog — runtime-neutral.
 *
 * Each development environment can offer a set of selectable teams.
 * Today only the Developer Team exists. Future teams add entries here.
 *
 * Adapters consume these definitions to build environment-specific UIs
 * and configuration. The canonical source of truth lives here, not in
 * any adapter.
 */

export type TeamId = string;

export type TeamEntry = {
  /** Unique team identifier, e.g. "developer-team" */
  id: TeamId;
  /** User-facing name, e.g. "Developer Team" */
  displayName: string;
  /** Brief description shown in the selection UI */
  description: string;
};

export const DEVELOPER_TEAM: TeamEntry = {
  id: "developer-team",
  displayName: "Developer Team",
  description: "Full development workflow from exploration to archive.",
};

export const ALL_TEAMS: readonly TeamEntry[] = [DEVELOPER_TEAM];

/**
 * Returns teams available for a given environment ID.
 *
 * This is a pure data lookup — adapters own which environment IDs they support.
 * Callers pass the environment ID they are querying for, and this function
 * returns all teams registered for that environment (currently all teams are
 * available in all environments).
 *
 * In the future, if environments have different team availability, this function
 * would filter accordingly. Today it returns the full catalog since there is
 * only one team.
 */
export function getTeamsForEnvironment(
  _environmentId: string,
  catalog: readonly TeamEntry[],
): readonly TeamEntry[] {
  return catalog;
}

export function getTeamById(teamId: string): TeamEntry | undefined {
  return ALL_TEAMS.find((t) => t.id === teamId);
}
