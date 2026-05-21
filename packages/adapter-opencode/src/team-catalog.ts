/**
 * OpenCode adapter team catalog — bridges canonical teams from @deck/core
 * to the OpenCode adapter's environment-specific view.
 *
 * The canonical team definitions live in @deck/core.
 * This module provides OpenCode-specific lookup functions.
 */

import { ALL_TEAMS } from "@deck/core/team-catalog";
import type { TeamId } from "@deck/core/team-catalog";

export type { TeamId };

export { ALL_TEAMS as OPENCODE_DEVELOPMENT_TEAMS } from "@deck/core/team-catalog";

export function getTeamsForEnvironment(environmentId: string): readonly import("@deck/core/team-catalog").TeamEntry[] {
  if (environmentId === "opencode-development") {
    return ALL_TEAMS;
  }
  return [];
}