export type LegacyAssignmentMigrationResult = Readonly<{
  assignments: Readonly<Record<string, string>>;
  migratedAgentIds: readonly string[];
  conflicts: readonly string[];
}>;

const LEGACY_ASSIGNMENT_GROUPS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  "deck-lead": ["deck-developer-orchestrator"],
  "deck-investigate": ["deck-developer-explorer"],
  "deck-architect": [
    "deck-developer-proposal",
    "deck-developer-spec",
    "deck-developer-design",
    "deck-developer-task",
  ],
  "deck-apply-fast": ["deck-developer-apply-general"],
  "deck-apply-deep": ["deck-developer-apply-backend", "deck-developer-apply-frontend"],
  "deck-quality": ["deck-developer-verify", "deck-developer-review"],
  "deck-setup": ["deck-init"],
});

/**
 * Projects persisted role assignments onto the seven-role catalog without
 * guessing among conflicting many-to-one values.
 */
export function migrateLegacyDeveloperTeamAssignments(
  input: Readonly<Record<string, string>>,
): LegacyAssignmentMigrationResult {
  const assignments: Record<string, string> = { ...input };
  const migratedAgentIds: string[] = [];
  const conflicts: string[] = [];

  for (const [targetId, sourceIds] of Object.entries(LEGACY_ASSIGNMENT_GROUPS)) {
    if (assignments[targetId]) continue;
    const values = sourceIds
      .map((sourceId) => input[sourceId])
      .filter((value): value is string => typeof value === "string" && value.length > 0);
    if (values.length === 0) continue;
    const distinct = [...new Set(values)];
    if (distinct.length !== 1) {
      conflicts.push(targetId);
      continue;
    }
    assignments[targetId] = distinct[0];
    migratedAgentIds.push(targetId);
  }

  const canonicalAssignments = Object.fromEntries(
    Object.entries(assignments).filter(([agentId]) => agentId in LEGACY_ASSIGNMENT_GROUPS),
  );
  return Object.freeze({
    assignments: Object.freeze(canonicalAssignments),
    migratedAgentIds: Object.freeze(migratedAgentIds),
    conflicts: Object.freeze(conflicts),
  });
}
