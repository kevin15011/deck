/** Runner-qualified assignments for cross-runner sessions (XR-1.6, D-4). Pure helpers; the flat type is unchanged. */
import type { DeveloperTeamModelAssignments } from "../runner-adapter";

export type RunnerQualifiedAssignment = { runnerId: string; modelId: string; thinking?: string };
export type CrossTeamAssignments = Record<string, RunnerQualifiedAssignment>;

/** Tag flat per-runner assignments with a runner id (and optional per-member thinking level). */
export function qualifyAssignments(
  runnerId: string,
  flat: DeveloperTeamModelAssignments,
  thinking: Readonly<Record<string, string>> = {},
): CrossTeamAssignments {
  const out: CrossTeamAssignments = {};
  for (const [memberId, modelId] of Object.entries(flat)) {
    out[memberId] = thinking[memberId] ? { runnerId, modelId, thinking: thinking[memberId] } : { runnerId, modelId };
  }
  return out;
}

/** Project cross assignments back to the flat shape a single runner understands. */
export function projectForRunner(runnerId: string, cross: Readonly<CrossTeamAssignments>): DeveloperTeamModelAssignments {
  const out: DeveloperTeamModelAssignments = {};
  for (const [memberId, a] of Object.entries(cross)) if (a.runnerId === runnerId) out[memberId] = a.modelId;
  return out;
}
