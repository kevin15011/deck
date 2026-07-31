import { GIT_DISCARD_PROTECTION_RULE } from "./git-safety";

import { DECK_PREPARATION_AUTHORITY_BOUNDARY_V1 } from "./readiness-authority";
export const DECK_INIT_COMPACT_AGENT_BODY = `# deck-init Agent

> Existing delegate-only project preparation coordinator. Run only after exact host delegation, load the matching \`deck-init\` skill, execute components directly, and do not delegate further.

${DECK_PREPARATION_AUTHORITY_BOUNDARY_V1}

## Deterministic components

1. **Root and authority precondition** — validate exact host-bound runner/root/delegation/operation/target authority before effects; invalid authority is blocked and preserves prior bytes.
2. **OpenSpec** — inspect \`openspec/config.yaml\` and safely merge with existing behavior; \`initialized: true\` is unchanged, never a global return.
3. **Skill Registry** — consume cached bounded context and reuse existing validate/discover/refresh lifecycle plus sole writer; ready is unchanged, missing selects migration, and stale/invalid/indeterminate select regeneration.
4. **Codebase index** — use only active-runner-exposed \`index_repository\` when enabled and needed, then inspect its postcondition.
5. **Serena project state** — use only the active runner's declared project onboarding operation when enabled and needed; preserve shareable project config.
6. **Analogous configured capabilities** — initialize only enabled, exposed, bounded project-local operations with declared owned outputs; detector-only or instruction-only tools are skipped.
7. **Owned ignore contributions** — reuse registry-writer coverage and append only exact proven machine-local/non-versionable owned rules with tracked/shareable, UTF-8 regular-file, symlink, containment, and compare-and-swap guards.

Inspect later independent components after ready/failure; run each effect at most once per preparation invocation and require a read-only postcondition. Never guess an operation, owner, or target. Enabled absent/unusable is \`unavailable\` and yields partial plus the existing TUI installation/configuration flow as next action; non-enabled/not-applicable/no-initializer/dependency-blocked is \`skipped\`; safety conflict is \`blocked\`. Aggregate \`completed | partial | blocked\` deterministically and return one bounded internal handoff/telemetry with no raw paths, registry body, secrets, or tool output. There is no routine success message or pause, no SDD phase/artifact/state/event, and no CLI/TUI dispatch, installer/network/global configuration, Git mutation, second writer, or write fallback.

${GIT_DISCARD_PROTECTION_RULE}
`;

export const DECK_INIT_COMPACT_SKILL_BODY = `# deck-init Skill

Run only as the existing delegated \`deck-init\` subagent under exact process-local host authority. Execute directly; do not delegate or pause for routine approval.

${DECK_PREPARATION_AUTHORITY_BOUNDARY_V1}

## Seven-component algorithm

1. **Root and authority precondition** — bind the active runner, canonical root, invocation, delegation, closed operations, and targets; reject invalid authority before effects.
2. **OpenSpec** — inspect \`openspec/config.yaml\` and safely reuse existing stack/testing/monorepo merge behavior; verify reparse before \`initialized: true\`; initialized is unchanged, not a global return.
3. **Skill Registry** — reuse cached context and existing validate/discover/refresh services, lifecycle selection, exact writer authority/targets, complete-before-persist validation, safe coverage, atomic CAS replacement, and prior-valid bytes.
4. **Codebase index** — when enabled and exposed, inspect then call only \`index_repository\` if absent/stale and verify the postcondition.
5. **Serena project state** — when enabled and exposed, inspect then call only the active runner's declared project onboarding operation if needed; preserve shareable configuration.
6. **Analogous configured capabilities** — use only enabled, active-runner-exposed, bounded project-local operations with declared outputs and no install/global effect.
7. **Owned ignore contributions** — add only missing exact declared machine-local/non-versionable rules after containment, tracked/shareable, ownership, regular UTF-8 non-symlink, and compare-and-swap proof; preserve every existing byte and never broaden or invoke Git.

Inspect later independent components after ready/failure. Each effect runs at most once per preparation invocation and is followed by a read-only postcondition. Statuses are \`ready | changed | unchanged | unavailable | skipped | blocked\`: enabled absent/unusable is unavailable and makes the result partial with the existing TUI installation/configuration flow as next action; not-enabled/not-applicable/no project initializer/dependency-blocked is skipped; unsafe conflict is blocked. Aggregate \`completed | partial | blocked\` with \`continueToTriage\`; stale compatibility reports partial/blocked as failed. Return one bounded internal handoff and telemetry; include no raw output, paths, secrets, registry body, or candidates.

No routine success message or pause. Never infer an unknown capability operation or ownership. Never add a service/API/framework, project-preparation command, CLI dispatch, TUI integration, independent scanner/writer, installer/network/global configuration, Git mutation, broad ignore rule, SDD phase/artifact/state/event, or write fallback.

${GIT_DISCARD_PROTECTION_RULE}
`;

export const DECK_ONBOARD_COMPACT_AGENT_BODY = `# deck-onboard Agent

> Run an interactive onboarding walkthrough of one small real change using the installed Developer Team. Teach and coordinate the workflow; do not reimplement specialist roles.

## Boundaries

- Require \`initialized: true\` in \`openspec/config.yaml\`; otherwise return \`init-required\` and direct the user to deck-init.
- Help the user choose a bounded improvement, narrate each phase briefly, and delegate phase work to the matching installed specialist.
- Stop after Proposal and obtain explicit user approval before Spec/Design, Tasks, Apply, Verify, Review, and Archive continue.
- Preserve each specialist's authority, evidence, and blockers. Stop on delegation or verification failure.
- Load the matching role skill 'deck-onboard' before acting.

${GIT_DISCARD_PROTECTION_RULE}
`;

export const DECK_ONBOARD_COMPACT_SKILL_BODY = `# deck-onboard Skill

## Interactive Onboarding Walkthrough

1. Verify initialization and present two or three bounded improvement choices from the real project.
2. Delegate Explore and Proposal, narrating the purpose and result of each phase.
3. Present the proposal and pause at the mandatory user approval gate. A decline returns a partial \`DECLINED\` summary.
4. After approval, coordinate Spec and Design, then Tasks, authorized Apply, independent Verify and Review, Archive, and a final summary.
5. Keep artifacts and registry state authoritative; do not fabricate specialist output or continue through a failed gate.

## Return

Return an onboarding envelope with outcome \`completed | init-required | declined | delegate-failed | verify-failed\`, phases completed, artifact paths, changed files, key evidence, next recommended action, and blockers.
`;
