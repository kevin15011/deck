# Codex Developer Team task naming

## Outcome

Persist the user's role-and-purpose subagent naming preference in Codex's adapter-local Deck Lead bootstrap. New interactive and exec Developer Team sessions receive `deck_<role>_<purpose>` lowercase snake_case guidance and explicit native `agent_type` selection. This remains instruction-level guidance; task names do not select roles or enforce an allowlist. Existing resumed histories retain their instructions.

## Scope and evidence

Only `packages/adapter-codex/src/runner-adapter.ts` bootstrap text and its existing launch composition test change. Shared Core/skills are unaffected. Graph generation 2026-08-20 is stale; previous targeted coverage identified changed source metadata and an unrelated partial range at line1166. Current bootstrap and launch test were read directly before modification. Existing working-tree changes are preserved.

## Verification

The focused bootstrap test failed before implementation because the naming convention was absent. Final adapter/launch verification passed all 37 tests; TypeScript reported no errors and git diff --check passed. Rebuilt and installed deck-canary from the current worktree. The convention is available to subsequent new sessions; model compliance with the naming instruction has not yet been observed in a new session.
