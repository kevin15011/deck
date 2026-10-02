# Project-local runner evolution skill

## Intent and acceptance

Maintain Deck alongside stable Codex, OpenCode, and Claude Code releases using a repository-local skill and an auditable version review record. The workflow must examine releases since the last complete review, trace changes into Deck, identify opportunities and regressions, and distinguish research from executed compatibility checks. Do not pin versions or install the skill globally.

## Implementation

Add `.agents/skills/deck-runner-evolution/SKILL.md` and `docs/runner-evolution/` containing the record contract, JSON registry, and initial partial Codex session evidence. Complete-review cursors begin unknown; only the actually observed 0.160.0 launch/delegation smoke check seeds runtime validation. Historical sandbox versions are not support baselines. Lead remains the centralized OpenSpec writer; the skill follows existing routing and permissions.

## Validation

Skill creator validation passed; registry JSON and report/evidence links passed. Documentation governance passed all 18 tests, and git diff --check passed. Independent Deck Quality simulations confirmed that inaccessible intermediate releases block review-cursor advancement and complete research does not advance runtime validation. Its recommendations were applied: revisit previous unresolved findings explicitly and require successful checks for runtime-cursor advancement. Investigate confirmed the generic project-local discovery root from current source; stale graph evidence was not treated as authority. This change is instructional/documentary and does not modify Deck runtime behavior. Full initial upstream reviews remain work for subsequent skill invocations.
