# Sprint 5a candidate verification

Status: bounded S5a is accepted at 135831 and installed as `449f6240…` from repaired candidate `cbd5535c…`. S5A-Q01 is resolved; S1-Q07 remains open. The original and correction evidence below remain scoped to their exact candidates.

## Candidate and behavior

Apply Deep attempt 11 (127570/127571), integrated at 128075, supplied candidate `unborn-head:implementation-sha256:1de1e2c9b08c1022197701cbd660f297a3dcf56b6c20485cc8a515cb988ebe1f`, binary SHA-256 `949d22c27169251138fe37c55ca63f468e1285903f63139a9824b1c6c2318b41`. Lead matched all 90 implementation inputs, 22 assets and the binary, then froze `target/review-s5a-1de1e2c9/`. The authoritative manifest is `target/s5a-verification/final/candidate.json`; the older top-level manifest describes an earlier candidate.

Configuration separates selection for new work from the recorded selection of an execution. Exact instruction bodies and tool schemas load by digest, with ownership, applicability and requested/observed delivery information. Historical absent records remain unknown. Reviewed team enable/disable changes future admissions; queued/running roots and their descendants/follow-ups retain the old snapshot. Missing or mismatched native identity/content blocks dispatch without substituting current defaults.

Management plans bind configuration revision, qualification, host/project ownership and trust facts. Applying a plan records activation and operation receipt atomically. Stable operation identities support retry; stale plans and conflicting reuse fail. The browser retains ambiguous operations and releases them only on an exact receipt or authoritative non-application proof. Native tools receive no management authority, and file-edit grants do not authorize these changes.

## Evidence

Owner handoff and records are under `target/s5a-verification/`. Lead reviewed material configuration/storage, native delivery, task admission, HTTP management and browser content/recovery paths using source fallback; the new repository remains unindexed.

| Verification | Evidence |
|---|---|
| Owner formatting / Clippy / build | Passed, 0.249 / 1.788 / 20.353 s; build includes typecheck |
| Owner Rust / API tests | 65 / 7 passed; one opt-in native test ignored |
| Owner packaged regressions | Six suites passed, including reviewed answers/snapshots, session behavior and motion |
| Owner real Codex/OpenCode browser | Passed; 69.206 s journey, 18 ms admission, 5.580 s preparation and 3.127 s tool connection |
| Lead focused checks | Four configuration contract tests, four storage/migration/content tests and one descendant/follow-up snapshot test passed |
| Lead real packaged replay | Passed, 64.185 s including fixture shutdown; journey 49.983 s and observed admission 16 ms |

The full-gate producer `a9c3f5bc…` and final candidate differ only in `scripts/session-acceptance.cjs`. Lead verified identical production/build/Rust/API inputs, assets and binary. That corrected fixture was syntax-checked and rerun; unchanged gates are reused rather than misrepresented as executions against another input set.

The real replay demonstrated that a queued root admitted at revision 3 executes after disabling new team work at revision 4; that root and its real OpenCode child retain revision 3 after re-enabling at revision 5; a later real root uses revision 5. Exact content hashes, stale-plan rejection, ordinary admission while team selection is disabled, mobile keyboard/reduced motion, dark/light layouts, project sentinel and absence of page exceptions passed. Lead inspected matching desktop/mobile captures. Inputs/assets/binary rematched afterward; bounded `/proc` cwd sampling found no remaining fixture process. Records: `target/lead-s5a-checks/{focused-checks,browser-replay,browser-journey,identity-cleanup}.json`.

## Regression and fixture interpretation

The missing-native-identity regression first completed when failure was required; the corrected implementation rejects that dispatch. SQLite fault tests verify rollback of both management activation and schema migration. New APIs absent from S4 are feature-absence evidence, not proof of a prior product defect.

Two old fixture failures were reproduced on both accepted S4 and the candidate. The answer fixture sent API 2 to the API 3 host; it now uses the host API while retaining byte-limit, identity and lost-ack/proof assertions. This does not qualify recovery of legacy API-2 retained payloads. The session fixture cancelled before native preparation, then expected a saved native context; its existing awaited polling helper now waits for dispatch/terminal state before cancellation. All original session/release/restart assertions remain, and corrected fixtures also passed accepted S4. Original failures are preserved.

## Remaining limits

- Schema 5 adds configuration state; older binaries cannot open it. Preserve stopped-state backups for backward recovery. Installing an executable alone does not migrate live state.
- Unknown legacy admission content/native identity is not reconstructed and cannot silently dispatch. Historical inspection remains unknown.
- This slice exposes seven managed definitions and one future-team-selection switch. Full external skills/developer-role selection, arbitrary runner/model changes and S5b/c helper maintenance remain outstanding. Configuration plan history is currently bounded to 256 records.
- Managed policy fragments are not loaded standalone skills. Hidden provider/native prompts and model compliance remain unobservable; disabling future selection is not cancellation/revocation.
- Existing runner/model/platform, S1-Q07, interrupted-initialization and in-flight-read limitations remain. The timing samples are not general performance guarantees.

## Independent review and required correction

Quality 14 (128964/128965), integrated at 129099, identifies **S5A-Q01: cross-tab loss of an unresolved management identity**. Every tab writes a single host-wide local-storage key. Tab A can apply successfully but lose its acknowledgment; tab B then overwrites that pending entry while applying a stale plan and clears it after rejection. Reloading A loses its operation ID and receipt-recovery controls. The durable server receipt survives; this is a browser recovery defect, not demonstrated duplicate activation or server-data loss.

Lead confirmed the shared key and unconditional overwrite/clear paths against the unchanged frozen candidate. Quality reproduced the sequence by executing the unchanged component handlers with hook/storage/network substitutes, not a real browser. The repair must persist unresolved operations independently, clear only the exact proven operation, preserve existing pending identities and demonstrate two real tabs with lost acknowledgment, stale rejection, reload and receipt retrieval. The prior real journey does not cover this interleaving.

Quality independently passed six protected-boundary tests in 0.544 s and found no additional material visual issue. Four restart/migration/native-identity checks were blocked at temporary-directory creation by its read-only environment. Lead's previous nine tests already cover three; Lead separately passed `missing_admitted_native_identity_never_falls_back_to_later_preparation` in 0.14 s. Record: `target/lead-s5a-checks/native-identity-followup.json`. These tests fill the environment gaps without resolving S5A-Q01.

Apply Deep's same task continues the correction with structured S5A-Q01 open. S1-Q07 and later-sprint limits remain. No installation follows from the earlier passing scenarios.

## S5A-Q01 correction candidate

Apply Deep 12 (134233/134234), integrated at 135188, supplied `unborn-head:implementation-sha256:cbd5535ceae5d4692ac0a3c3c23f32f7c9d2824838c876c4070798c68d8d6e8f`, binary `449f6240ab4c5b11fef03fce0ddec22eb5926ae759b2cedc3a2c345c846022e6`. Lead matched all 93 inputs and 22 assets, then froze `target/review-s5a-cbd5535c/`. Authoritative owner evidence: `target/s5a-corrections/{handoff.json,final/candidate.json}`.

The repair stores each host/operation identity independently. Exact receipt or HTTP-409 non-application proof releases only that operation. The UI discovers multiple pending operations and lets the user select one without dispatch. Legacy entries are copied and verified before removal; malformed, foreign or conflicting bytes stay preserved with recovery feedback. A failed storage write prevents HTTP dispatch. Another tab resolving the same operation is idempotent and cannot clear a different pending entry.

Only `frontend/src/configuration.tsx` changed among existing inputs; the pending-operation helper, its five tests and public browser regression were added. All Rust/shared/native/API source, build configuration and existing tests remain identical; only `app.js` changed among packaged assets. Reuse the earlier matched Rust/native/migration evidence for unchanged boundaries. The owner passed 12 frontend tests, syntax checking, packaged typecheck/build (21.879 s), the new two-tab browser regression (6.414 s) and existing browser regressions (8.263 s).

Lead reviewed all four changed files and the complete handoff, then independently executed:

| Check | Result |
|---|---|
| 12 affected frontend tests | Passed in 0.033 s |
| New regression against frozen predecessor | Failed at the expected missing receipt-recovery control after reload, 8.711 s; server receipt remained intact |
| Same regression against repaired package | Passed in 6.092 s, including lost acknowledgment, stale second tab, reload/retrieval, exact proof matching, multiple/legacy identities, same-operation cleanup, storage failure before dispatch and malformed-byte preservation |
| Settled desktop/mobile captures | Passed in 6.241 s; evidence-only harness adds a panel-settlement wait and scroll-to-top before screenshots, preserving every behavioral assertion |

Records are under `target/lead-s5a-correction-checks/`. The first desktop screenshot captured the existing crossfade between panels; it is not a settled visual baseline. Lead inspected the subsequent settled desktop/mobile captures. Inputs/assets/binary rematched after the behavioral replay and installed S4 remained unchanged. Bounded `/proc` cwd sampling found no remaining first-replay fixture processes; this is not exhaustive descendant proof.

Owner diagnostic attempts remain preserved: an early repair interrupted the disclosure's height tween by animating its parent; final feedback animates an inner node. The public fixture was also corrected to await routed acknowledgment state and foreground the tab before user interaction. These are disclosed iterations, not final-candidate failures. Malformed/unreadable retained data still requires explicit inspection/restored storage and blocks new management changes; it is never silently discarded.

Quality's same task is reviewing this frozen correction as attempt 15. S5A-Q01 is not yet resolved, no new executable is installed, and S1-Q07 plus the prior native/platform/catalog/S5b/c limits remain.

## Acceptance and installation

Quality 15 (135514/135515), report SHA-256 `e3795872f6b34c9e90aab8165d6ac92f448042acd610ce353beb12cb1bac8f85`, recommends acceptance with no blocking findings. It independently passed all 12 affected frontend tests (17 ms) and script syntax checking, and rematched the 93 inputs, 22 assets and binary before/after review. Its browser and motion assessment reused recorded evidence in a read-only environment; it did not claim another browser execution or a settled screenshot.

Lead re-read the complete review, rematched current and frozen candidate identities, and reused the independent predecessor-failure/corrected-browser passes and inspected settled captures above. At integration 135831, Lead accepted this bounded S5a scope and structurally resolved S5A-Q01 on implementation/review tasks. No broader skill, native, platform or helper-update claim follows from this acceptance.

At **2026-11-11 09:39:20 UTC**, Lead atomically replaced `/home/kevin15011/.local/bin/deck2` with exact binary `449f6240ab4c5b11fef03fce0ddec22eb5926ae759b2cedc3a2c345c846022e6`. Prior S4 binary `6bed34b2…` is preserved at `target/installed-backups/deck2-6bed34b2eea0fdfd871e15b3ef7b43a0cc50c26a228ef086eb7f1e07fd4af271`. Installed hash, `--version` and `--help` passed; version remains `deck2 0.1.0`. Record: `target/deck2-s5a-install-evidence.json`.

Only the executable was replaced. No live host was restarted and no user state was opened/migrated. Existing hosts keep their previous executable until restarted by the user. Schema-5 activation requires compatible stopped-state backup handling for backward recovery; the binary backup alone does not downgrade state. The same implementation owner continues with S5b, preserving S1-Q07 and all stated limits.
