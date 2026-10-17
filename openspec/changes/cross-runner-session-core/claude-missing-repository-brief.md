# Claude launch without repository identity

## Intent
Fix the reported Claude-only startup failure in a project without a configured repository: `Canonical Git repository identity is required for a shared Supermemory session.` Working without a repository must not unnecessarily block the runner.

## Acceptance and constraints
- Reproduce the failing Claude launch path and align it with the existing policy for that launch mode.
- Preserve configured preferences and other projects; any memory disablement is scoped to the launch.
- Preserve canonical repository isolation and reject invalid/ambiguous identity rather than treating it as proven absence.
- Do not invent a new global-memory fallback. Managed session global scope and standalone launch behavior are distinct existing contracts and must be traced before changes.
- Verify absent Git repository, repository without origin, canonical identity, and invalid identity with mocked credentials/effects. No real memory traffic or user settings mutation.

## Trace
Exact error originates at `packages/adapter-claude/src/runner-adapter.ts` buildLaunchPlan. Standalone canonical launch credential and managed-session credential resolvers differ in `apps/cli/src/claude-supermemory-launch.ts`. Codex standalone launch has a session-local no-memory fallback in `apps/cli/src/runner-launch-command.ts`. Graph tools unavailable; bounded source fallback, with no graph coverage claim.

## Ownership and verification
Implementation: apply-fast task-1a0fd74b-2ba0-47f8-9ea4-e29e160efab8. Lead owns this record. Authentication/scope boundary requires independent review before installation. No commit requested. Worktree was clean at d7c8426.

## Status
Investigation and focused implementation in progress.

## Candidate result
The standalone Claude adapter checked official plugin readiness before repository scope, then blocked every missing canonical identity. The fix distinguishes proven absence using the shared session scope resolver and disables Deck memory only for this standalone launch before readiness/credential checks. It does not adopt the managed session explicit-default global mode. Canonical launches retain the existing credential/scope checks; invalid, ambiguous or mismatched identity remains blocked. Inspection diagnostics now describe the no-memory launch behavior. Saved settings and managed sessions are unchanged.

Owner evidence: original failure reproduced (RED); 63 focused tests passed after a timeout retry, with no-repository/no-origin production launch regression checks. The unrelated known `pi-client-proof.ts:187` type error remains. No real provider calls or user configuration writes. Independent review task-17646d16-1c99-4dab-a539-2e2c09589779 is pending.

## Review and delivery
Independent quality review passed with no blockers: 71 tests passed, zero failures, diff check passed. Actual CLI composition strips inherited SUPERMEMORY_* variables and omits the official plugin/credential overlay for the disabled launch. Team instructions/readiness do not re-enable or block the integration; external-plugin and static-compatible limitations remain explicit. No provider calls were made. Canary installation follows; no daemon restart is needed for testing a fresh standalone Claude launch. No commit requested.

## Completion
Canary installation succeeded. The user requested committing this candidate and preparing the next release. Implementation and independent review are complete.
