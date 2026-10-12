# Claude model configuration rollback failure on macOS

## Intent and scope
The user reports that configuring models while installing Deck for Claude on this Mac fails with: "Model configuration failed. Rollback could not be completed. Review the runner files before retrying."
Investigate the primary configuration failure and the separately reported rollback failure. Do not assume either that rollback changed user files or that no changes occurred.

## Evidence and trace
- The exact message originates in apps/cli/src/tui/app.tsx around lines 3486–3516, after model-plan application/verification throws and rollback also fails.
- The preceding Pi repair rebuilt deck-canary but deliberately left the stable deck executable unchanged. The user's current executable is not yet confirmed.
- Existing Pi/setup source modifications and unrelated user work must be preserved.

## Acceptance
Locate the actual contract or runtime cause with bounded evidence; distinguish current source from installed-version behavior; identify a minimal correction and regression coverage if warranted. Any recovery must preserve user models, settings, credentials and unrelated files.

## Boundaries and progress
Read-only investigation completed and source findings checked by Lead. No live Claude installation, rollback, credential modification, real provider calls or source changes occurred during this diagnostic step. Do not retry configuration blindly while rollback state is uncertain. Lead owns persistence and subsequent integration.

## Integrated findings
- Lead read the model handler at app.tsx:3445–3520: it supplies capability instructions but no capabilityIds, does not reject plan.blocked before apply, and discards the apply exception. The quoted message therefore does not expose the primary rejection.
- Lead read Claude planning/apply/rollback at runner-adapter.ts:412–444 and 668–726. Planning retains the current capability selection when no capabilityIds are supplied and can block on enabled instruction fragments outside that selection. Apply can also reject discovery, readiness, stale candidates, or publication conditions.
- Claude backup returns no transaction payload. Rollback reports conflict if any versioned plugin exists, without establishing whether this attempt created it. Thus the generic rollback warning does not prove files changed or suffered damage. Do not turn all conflicts into success: genuine partial publication remains protected.
- The investigator reported existing versioned plugin metadata, but did not establish filesystem integrity or permissions. No tests were executed; this is a source-backed diagnosis, not a reproduced cause for the user's exact attempt.

## Next evidence and correction boundary
The user confirmed deck-canary and both the installation dashboard and Configure Models menu. The correction therefore covers both paths in the canary; it does not mutate existing live Claude plugins or attempt automatic cleanup. The candidate correction should reject blocked plans before apply, preserve bounded sanitized failure reasons, and preserve existing capability selection and ownership safeguards. Do not modify Claude settings or broaden installation scope based on advisory memories.

## Functional candidate
- Lead remains implementation owner. Claude dashboard Finish now stages models and effort until Review & Install, following the existing versioned-plugin workflow; reopening the editor preserves staged choices.
- Menu-only model edits filter instruction packages to the existing Claude receipt rather than adopting globally enabled but unselected tools. They do not pass the legacy injected memory provider to Claude; configured official-memory readiness gates remain intact.
- All model-save paths reject blocked plans before backup, apply or rollback, displaying bounded redacted planner diagnostics. Known static Claude apply errors and safe filesystem error codes are retained separately from rollback warnings; arbitrary exception text is not displayed. Existing conservative rollback behavior was not weakened.
- Claude's optional preparation hook now probes/revalidates already-selected Serena using existing read-only readiness logic, without bootstrap or acquisition. This covers menu editing that did not previously visit inventory/launch preparation.
- Tests reproduced premature dashboard publication and the blocked-plan error masking before the fix. A focused existing Serena fixture initially failed earlier because macOS /var aliases did not match canonical paths; fixture roots now use realpath, including the existing HOME-alias security cases. A fresh adapter explicitly demonstrates blocked planning before readiness preparation and successful preparation afterward.
- Verification: root bunx tsc --noEmit passes. Both complete affected suites pass: 63 tests, 1,363 assertions, zero failures. Covers actual TUI navigation, staged editing/reopening, menu save with a legacy provider and unselected instruction package, blocked-plan no-effects, static apply cause preservation, arbitrary-error redaction, immutable plugin ownership, and selected Serena readiness. No real provider calls or live Claude configuration writes.
- Tool note: Serena symbol insertion could not resolve the existing app.tsx target; exact-text edits were used for that insertion. Bounded Serena replacements were used where available.
- Independent safety review found two remaining dashboard callback defects: the original blocked plan could still reach apply, and rollback could mask the primary cause (verification also attempted rollback twice). Lead confirmed both in source and corrected the same candidate. The dashboard callback now refuses blocked plans before backup/apply/rollback, preserves a bounded primary failure separately from recovery status, and rolls back exactly once. Conservative refusal to delete published plugins remains unchanged.
- Four new full TUI Review-to-install failure scenarios reproduced RED, then passed after the correction: blocked plan (zero backup/apply/rollback calls), known apply failure plus rollback failure, arbitrary apply exception redaction, and verification failure with exactly one rollback. The successful scenario also passes. The staged-model regression now traverses edit, Finish, reopen, Review, explicit install, and actual isolated plugin publication with the selected exact model. Its fixture now supplies production-equivalent inventory, environment and runner-specific capability selection, and waits for fresh frames after Escape.
- Final verification: root bunx tsc --noEmit and git diff --check pass. Complete synthetic TUI, developer-team-flow and Claude adapter suites: 109 tests pass, zero fail, 1,537 assertions. This is directly executed hermetic evidence; the independent reviewer did not rerun these tests or re-review the final callback delta.
- Deployment complete: canonical bun run canary:install rebuilt and codesigned the darwin-arm64 executable, ran its staged smoke checks, and atomically installed the corrected ~/.local/bin/deck-canary. Existing canary payloads remain available for rollback. No live Claude plugin, credential or user settings were altered, and no real provider inference or account calls were made. The stable deck executable remains unchanged.
- User action: exit the already-running old TUI and reopen deck-canary before retrying either model configuration entry point; an already-running process cannot acquire the replacement executable's code. Actual account-specific model entitlement was not asserted.
