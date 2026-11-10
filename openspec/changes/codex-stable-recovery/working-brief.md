# Codex stable setup recovery

## Outcome
Make Codex stable setup recover from incomplete prior runner operations through the normal installation flow, without requiring end users to collect diagnostic logs or delete state manually.

## Authority and workspace
The user authorized the fix and explicitly requires work in `/home/kevin15011/deck`, on the existing worktree. Do not use the separately created worktree. Preserve pre-existing session-driver edits and its untracked startup test. Local main is cad2614; origin/main is 2ff95a7. A fast-forward was safely refused because driver.ts has local changes. Preserve and reapply those changes when advancing main; never discard them.

## Evidence
At stable 2ff95a7, decideRunnerWrite rejects any pending fence. Both Context7 and model writes use runner-mutation-admission. Codex recoverPendingMutation requires journal evidence. previewExplicitCodexRecovery has test/fixture callers but no production caller found in apps/packages. The user confirms the incident uses the same stable release. Exact affected-host pending contents are unknown; reproduce representative supported failure states rather than claiming that state is known.

## Acceptance
- Reproduce the installer recovery dead end with a regression test before fixing it.
- Provide a production installation recovery path preserving original evidence and user-owned data; verify before clearing pending state.
- Prevent avoidable incomplete-operation states where supported by evidence.
- Cover interruption, missing proof, retries, and concurrency/version protection relevant to the change.
- Run focused checks, the repository full suite and typecheck, followed by independent review and a Lead isolated live canary.
- No release publication or live user-state recovery is included.

## Status
Implementation pending. Lead owns this artifact. Rollback is the bounded code diff; retained recovery archives must remain intact.

## User evidence and acceptance refinement
The user supplied an external investigation reporting Linux stable 0.15.1 / 2ff95a7 with pending.epoch = 2 and pending.journals = []. Treat this as the concrete reported incident, while its original trigger remains unknown. Contrast the suggestion with source and executable evidence before endorsing it.

- Investigate the interruption interval between fence reservation and journal-reference persistence, including exceptions before effects.
- Explicit recovery MUST be reachable through Review & Install with a meaningful change preview and user confirmation, preserved historical evidence, and verification before clearing the new pending operation.
- Correct circular advice that recommends a flow unable to recover the current state.
- Exercise interrupted recovery, empty and damaged journals, retries and concurrency while preserving foreign configuration, credentials and user edits.
- Reproduce the exact legacy state in isolation, recover through the production interface, complete both Context7 and Codex team, and run Review & Install again to verify idempotence.
- External reports of permission failures in sandbox and timeouts outside are unverified. Reproduce/classify applicable failures; do not count inconclusive runs as passing.
- Latest user AGENTS sets a 240-second hard full-suite wall budget, replacing 120 seconds. Slow-file warnings remain diagnostic.
- Lead live canary and independent review remain required. Prepare release readiness and blocked-user instructions; latest request is to contrast and validate the proposal, not an instruction to publish immediately.

The current worktree has now advanced to 2ff95a7; pre-existing driver/test edits remain present. A continuation conveying these refinements to the running implementation task was rejected with task-running; Lead must convey them again on its next continuation and verify them before acceptance.

## Independent investigation review
Investigation attempt 2 supports the proposed production recovery path, without identifying the incident's original trigger. Lead reviewed baseline reservation and explicit-recovery code. Empty references do not prove absence of effects: runAction is also guarded, so installer-only assumptions cannot justify clearing every empty pending fence. Review must cover archival durability, adoption and active-journal removal interruption points, stale previews, missing/damaged journals, private archive permissions and revalidation under the exclusive lease. Investigator did not execute tests; external sandbox/timeout reports remain unverified. Production interface and live canary evidence are still outstanding. Source report: task-11f6abf8-0837-4c12-b3ac-662e316ca51e attempt 2, result sequence 6202.

## Implementation handoff review
Apply attempt 1 delivered recovery wiring and early plan validation. Reported candidate: 2ff95a7:9b94801e6886f9a8bc964ae1c97834e3aedb2d10. Reported focused checks and typecheck passed; final full suite failed with 4773 passes and 3 dictation failures, despite an earlier passing run. Lead reviewed the diff and handoff but has not accepted completion. Quality task task-9dc88f64-97e5-4824-861e-eec986abc579 independently reviews protected behavior and whether TUI displays the recovery plan before confirmation. Apply task task-105ca837-e772-448e-ac77-36550440dfc0 attempt 2 diagnoses suite failures read-only and prepares concrete canary instructions. No production recovery or publication performed. Lead live canary remains pending.

## Diagnostic follow-up
Apply attempt 2 reports capture passing in isolation (3/3), with original timeout contamination plausible but trigger unproven. It reproduces an integrity-cache failure on tmpfs (10 pass/1 fail) where corrupted bytes retain the same stat identity; ordinary temporary storage passes 11/11. This is reported as a latent defect in unchanged dictation code, not a harmless assertion flake. No full-suite rerun or source edits in this attempt.

Lead independently confirmed three remaining recovery defects/gaps: the TUI builds/applies recovery after confirmation without showing its recovery preview; the old missing-proof message remains; and the Context7 regression invokes only an informational action. The fixture also uses pending epoch5 rather than the reported epoch2. These require implementation follow-up after the active Quality review, followed by real production-interface and canary evidence. Diagnostic report sequence10807 is accepted as investigation, not final validation.

## Quality changes requested
Quality attempt1 result12109 reviewed by Lead; findings remain open:
- Q1 (P1): recovery plan is created/applied after confirmation, before ordinary stale-plan/cancellation checks. Build/display/retain the exact recovery plan during review, validate it and cancellation before mutation.
- Q2 (P1): content-only recovery cannot repair first installation interrupted before config.toml exists; native admission requires that file. Reviewed recovery must include all authorized effects required by its verification postcondition.
- Q3 (P2): tool-only selection skips recovery and repeats the dead end. Provide a reviewed recovery path or clear actionable selection prerequisite; never install an unselected team implicitly.
Also correct the old message and prove actual Context7 installation, exact epoch2 fixture, retry idempotence and relevant interruption boundaries. Quality protected recovery reexecution was inconclusive because its sandbox maps root to UID65534, rejected by private-path ownership checks; this is not a passing test or a reason to weaken ownership protection. The read-only CLI/selection subset passed3/3. Lead will execute real isolated verification outside that reviewer sandbox.

## Repair and live canary evidence
Apply attempt3 reports Q1-Q3 implemented with production review/renderer/executor regressions and interruption tests. Focused checks passed after reexecuting one timed-out fixture; final typecheck passed. Normal full suite timed out at240s after279/523 files, and concurrent web edits changed the workspace tree. Independent Quality attempt2 is pending; Q1-Q3 are not yet closed.

Lead executed `bash apps/cli/src/codex-stable-recovery.canary.sh` in a real PTY, using isolated root `/tmp/deck-recovery-canary.qa63IP`. Built canary from current source; seeded epoch2/empty journals, foreign config and synthetic auth. Production TUI displayed recovery archive/target preview before confirmation. First install reported real Context7 installation verified and Codex setup complete. Fence settled. Second Review & Install also completed; SHA256 comparison of841 Codex/skills files found zero changes. Exact old fence bytes were archived with0600 mode, synthetic auth bytes and foreign config were preserved. Script exited0. No real user home was mutated. Installed Codex0.166.0 was reported static-compatible/degraded by this stable-based build; no model turn/authentication was claimed. Absent-config path remains covered by focused fixtures, not this live run. Final full gate and Quality re-review remain outstanding.

Quality attempt2 (result19796) found no new blocking code findings and recommended resolving Q1-Q3. Lead accepts that recommendation based on reviewed code, unchanged15-file recovery hashes, targeted evidence and live canary: Q1-Q3 are resolved in this working brief. Independent filesystem integration in the reviewer sandbox remains inconclusive and is not counted as passing. Overall acceptance still requires a completed full-suite gate. Shared final candidate waits for the separate ongoing web navigation work.

Final combined verification completed524/524 files in190.85s with justified tmpfs storage after the separately documented model-integrity fix:4788pass1fail. Remaining unchanged OpenCode legacy-upgrade test exceeded5s under suite load and passed isolated. Recovery implementation, independent review and Lead live canary accepted; full-suite gate remains failed and release readiness is not claimed. No commit/publication. Original driver/startup edits preserved.
