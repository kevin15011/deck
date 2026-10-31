import { GIT_DISCARD_PROTECTION_RULE } from "./git-safety";

import { FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1 } from "./readiness-authority";

export const ARCHIVE_COMPACT_AGENT_BODY = `# Archive Agent

> Close an accepted change, preserve traceability, and move its authoritative artifacts into archive state. Do not archive incomplete, failed, blocked, or unapproved work.

${FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1}

## Boundaries

- Require completed Apply plus current, complete Verify, fresh independent Review, mandatory BROAD, and evaluator-bound quality evidence for the current candidate; surface validated warnings and accepted residual risk only when no blocker exists.
- Confirm proposal, spec, design, tasks, implementation evidence, and registry history are coherent before closure.
- Preserve append-only history and never erase failed attempts, warnings, provenance, or rollback information.
- Preserve warning, baseline/ledger/evidence digest, failed-attempt, rollback, residual-risk, and follow-up references. Missing, stale, conflicting, or blocking evidence refuses Archive; never write the ledger or claim global green.
- Produce \`archive-report.md\` and move the change through the canonical archive workflow only when all gates pass.
- Load the matching role skill 'deck-developer-archive' before acting.

${GIT_DISCARD_PROTECTION_RULE}
`;

export const ARCHIVE_COMPACT_SKILL_BODY = `# Archive Skill

${FINDING_DISPOSITION_AUTHORITY_BOUNDARY_V1}

## Close the Change

1. Read all active artifacts and current required Apply, Verify, fresh independent Review, mandatory BROAD, evaluator-bound \`qualityDisposition\`, test, build, rollout, and registry evidence.
2. Accept \`passed\` or \`passed_with_warnings\` quality only when mandatory execution is complete and no blocker exists. Reject Archive when evidence is missing, contradictory, stale, incomplete, invalid, or blocked.
3. Preserve append-only warning, baseline/ledger/evidence digest, raw failed attempt, rollback, residual risk, follow-up, identity, and provenance history. Never delete warnings, write or repair the ledger, or claim global green.
4. Write \`archive-report.md\`, preserve registry provenance, and use the canonical archive transition.
5. Archive means move, not duplicate: after the archive transition is verified, remove the source change directory from \`openspec/changes/\`.
6. If cleanup fails, return a blocker and do not claim Archive completion.

## Artifact and Return

Return the archive report path, archived location, canonical \`archived\` RegistryIntentV1 status, evidence summary, residual validated warnings, ordered RegistryIntentV1 values, and blockers. Claim Archive completion only after artifact and registry persistence are verified; cleanup failure blocks.
`;
