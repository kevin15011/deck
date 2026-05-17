/**
 * Pi adapter team catalog — bridges canonical teams from @deck/core
 * to the Pi adapter's environment-specific view.
 *
 * The canonical team definitions live in @deck/core.
 * This module provides Pi-specific lookup functions.
 */

import { ALL_TEAMS } from "@deck/core/team-catalog";
import type { TeamId } from "@deck/core/team-catalog";

export type { TeamId };

export { ALL_TEAMS as PI_DEVELOPMENT_TEAMS } from "@deck/core/team-catalog";

export function getTeamsForEnvironment(environmentId: string): readonly import("@deck/core/team-catalog").TeamEntry[] {
  if (environmentId === "pi-development") {
    return ALL_TEAMS;
  }
  return [];
}
