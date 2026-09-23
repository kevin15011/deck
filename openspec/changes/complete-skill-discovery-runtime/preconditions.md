# Preconditions: Complete Skill Discovery Runtime

- User authorization for source modification: granted on 2026-09-22.
- Worktree baseline: branch `main` is one commit ahead of `origin/main`; `.serena/project.yml` contains a pre-existing unrelated modification and MUST NOT be edited.
- Archived `agent-skill-registry-discovery` artifacts are read-only historical authority.
- `canonical-deck-managed-session-runtime` is the current session-runtime dependency; this change is additive and MUST NOT create a second runtime owner.
- `developer-team-execution-convergence` remains active; implementation MUST preserve its public runtime contracts and avoid generated-output edits.
- No commit, push, installation, user-home mutation, or registry refresh is authorized by this change.
- Strict TDD applies: new behavior requires observed RED evidence before production edits.
- The current shell exposes Bun 1.3.11 while canonical runner-asset generation requires Bun 1.3.12. Source implementation and tests may proceed, but generated/built acceptance remains blocked until a verified pinned binary is available; the guard MUST NOT be bypassed and generated assets MUST NOT be hand-edited.
