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

export function getTeamById(teamId: string): TeamEntry | undefined {
  return ALL_TEAMS.find((t) => t.id === teamId);
}
