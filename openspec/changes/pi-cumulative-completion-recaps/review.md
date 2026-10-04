# Cumulative recap boundary review

## Historical first review: changes required
The focused independent reviewer identified three blocking source-derived findings. Lead inspected the relevant hooks in `subagents/extension.ts` and reconstruction in `subagents/recap.ts` and confirmed the paths require repair. These are not claims of reproduced live-provider failures.

1. Original-answer capture uses mutable `genuineInput`/`recapTurn` flags. An extension-origin input can clear genuine provenance while the initial response is running, and a result arriving during its tool loop can activate recap mode before its original answer is anchored. Bind capture to the actual genuine input/response identity, without anchoring subsequent cumulative replies.
2. `completionRecap` collects all current jobs before branch-local evidence. Session-wide execution ownership must remain monotonic, but results from later/unrelated conversation blocks must not be imported into a selected earlier block after tree navigation. Establish separate block membership for recap data.
3. Native admission is durable, whereas recap eligibility is an in-memory flag gated by `!admitted`. Reload between admission and resolution can suppress recap context on a legitimate unfinished integration reminder. Restore eligibility for unfinished work without reviving already-resolved stale wakes.

## Required repair evidence
Native regression cases for synthetic input before initial answer completion, outcome arrival during the initial tool loop, earlier-branch navigation with later integrated/pending results, and reload after admission before resolution. Demonstrate failures on the first candidate, then repair. Preserve exact history, ownership, bounded context and no recap-only scheduling/provider calls.

Lead separately ran recap unit/profile/generated-asset checks: 38 passed, 0 failed, 151 assertions. Passing checks do not cover or override the above gaps. Quality's read-only role had no command runner and did not execute tests. Initial Apply report's 128 affected and 29 final-delta passes remain candidate evidence, not release approval.

## Scope
Same Apply Deep implementation owner repairs this existing candidate. No new architecture/workflow, Core/other-runner changes, personal installation, private-transcript inspection or live providers. The local Neon Grid theme is unrelated and must remain untouched. Focused re-review follows the repaired boundary changes only.

## Current disposition: repaired and verified
Focused independent re-review found all three blockers closed in the repaired source and native regression tests. Genuine input is bound to native user-message/answer identities; branch-local task/attempt membership limits recap data without rolling back session execution ownership; unfinished outcomes remain eligible after admission/reload. Existing-anchor checks prevent cumulative replies becoming new originals. No recap-specific scheduler or provider-call path was found. The reviewer did not execute tests; Lead supplied execution evidence.

Lead reran the boundary regressions, profile, registry and generated-asset checks: 51 passed, 0 failed, 222 assertions. Lead then ran the complete Pi adapter plus generator tests on pinned Bun 1.3.12: **1,022 passed, 0 failed, 4,394 assertions across 83 files** (151.92 seconds). Log: `/tmp/deck-recap-verified-edH59N.log`. Root TypeScript and `git diff --check` passed.

The earlier broad-run registry-consumption failure was an obsolete exact Core-only prompt expectation: the authorized Pi profile now deliberately appends native continuation guidance. Lead changed that test to assert the exact unchanged canonical prefix, a single Pi-only suffix, and absence of that suffix from Core. No production contract was weakened or failing file excluded. An initial context-mode full-suite request exceeded its 60-second transport deadline; its result was not claimed. The final ordinary-shell run above retained a log and completed successfully.

Limits: native fixtures use scripted offline providers, not live model adherence tests. Runtime provides provenance, scope and bounded context; concise wording and answer-last behavior remain model instructions. Stale-wake tests prove no recap context for handled outcomes, not suppression of manually forced native turns. No personal installation, real provider traffic or local-theme changes.
