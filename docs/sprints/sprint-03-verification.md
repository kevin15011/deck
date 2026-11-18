# Sprint 3 verification

Status: bounded S3 accepted at 109925 and installed on 2026-11-11 as binary `86ac96f0…`. Quality 11's conditional pass and Lead's remaining occupied-port check support acceptance. Existing live hosts were not restarted. Architect continues the bounded S4 handoff.

## Exact candidate and delivered scope

Apply Deep attempt 8 delivered `unborn-head:implementation-sha256:1992f2e93e1848fe0849c61cbbbcff390ce756e2faabc93eba83ae21d8f7ed38`, binary SHA-256 `86ac96f094c3c9783a6624089ff8a03c6660377749ac12b71a90fe2326b7e718`. Lead matched 78 implementation/build/test inputs and 22 asset hashes before and after independent checks. `target/review-s3-1992f2e9/` preserves the source, binary, assets and handoff. Original gate and acceptance records are under `target/s3-verification/`. Graph coverage for the new project is unavailable; review uses direct source, without an indexed completeness claim.

API 2 requires an explicit conversation identity. Recognized schemas 1/2 migrate transactionally to schema 3, retaining historical receipt/decision ownership without adopting legacy ephemeral native context. Conversations retain separate history, drafts and unresolved input identity. Legacy browser drafts need explicit adoption when ownership is unknown.

A bounded FIFO queue stores definitely-undispatched input; cancellation prevents its native launch. The queue pauses after every host restart and needs explicit resume. Claim rechecks session and project trust; native preparation rechecks compatibility, authentication, configuration and tools. One project execution slot and unresolved ownership span all conversations.

Pinned Codex 0.166.0 supports continuation through Deck-owned persistent native threads; current prompts are sent without transcript replay. Missing, released or incompatible context requires explicitly starting a new execution. Stop interrupts work, release relinquishes Deck's saved continuation reference, and local removal deletes settled local history while preserving project files and native rollouts. Stable loopback origin retains browser drafts across restart; an occupied saved port produces an error.

## Owner evidence

The manifest-bound full gate passed formatting, warning-free Clippy, 38 Rust tests, five browser API tests and the packaged build/typecheck. One opt-in live-native test is excluded from the hermetic gate and separately passed in 11.34 s against unchanged native source. It checked cross-process memory, pinned restrictions/MCP inventory, missing-context rejection and wrong-turn steering rejection.

Ten packaged exercises passed against the final candidate, including real session/restart acceptance (60.231 s), reviewed edits (68.399 s) and informational questions (24.060 s). Fake-edge checks cover recovery, stable origin, question correction, unavailable comparison, authentication, browser regressions and session motion. The handoff distinguishes earlier failures and their repairs; failed readiness/capture runs are not represented as success.

Recorded RED covers initial session/API boundaries, changing origin after restart, retaining unfinished native context after operator recovery and a session indicator failing to follow selection. Recovery RED was against a preserved earlier binary after source edits, not claimed as source-first RED. Additional partitions were added during implementation without individual pre-edit failures. No test retirement is claimed.

## Lead independent evidence

Lead read Store session/queue/removal behavior, the migration/admission/native/server changes and the default production scripts, then ran:

| Command | Boundary | Result / wall time |
|---|---|---|
| `cargo test --locked -p deck2 --test sessions` | Session identity, queue, migration and recovery | Pass, 3.860 s |
| `cargo test --locked -p deck2 --test reviewed_edits reviewed_effect_in_another_conversation` | Approval belongs to the selected receipt's session | Pass, 1.008 s |
| `python3 scripts/recovery-regression.py` | Packaged lost acknowledgment, recovery, paused queue and explicit fresh execution | Pass, 0.979 s |
| `python3 scripts/session-origin-regression.py` | Packaged restart preserves browser origin | Pass, 0.230 s |
| `node scripts/session-acceptance.cjs --real` | Real Codex/browser two-context, queue, restart, release and removal journey | Pass, 52.794 s |

Packaged runs selected the frozen binary through `DECK2_BINARY`; the real-browser run used `DECK2_EVIDENCE_DIR=target/lead-s3-checks/real-browser`. Input-bound records are `target/lead-s3-checks/protected.json` and `real-browser.json`. No installed/live user host was exercised. Desktop/mobile screenshots were inspected, including the explicit missing-context failure and new-execution outcome. These demonstrate the tested flow rather than full original-product visual parity.

## Acceptance and limits

Quality 11 (109472/109473) found no blocking implementation defect. It independently passed five API tests and compiled operator-recovery/explicit-session tests, inspected the source and desktop/mobile captures, and matched the candidate and prior evidence. Its sole remaining verification gap was the occupied saved-port failure path. Integration at 108427 was candidate review only; acceptance followed at 109925 after the check below. Bounds are one project execution slot, 64 conversations, 32 queued inputs and 256 total receipts.

Live steering remains visibly unavailable: wrong-turn rejection is qualified, but once-only delivery after an ambiguous acknowledgment is not. Queue input remains the supported alternative. S1-Q07 actual automatic Windows browser authentication stays open. Native references belong only to this Deck-created Codex context; adding another runner requires explicit runner/version/capability provenance. Schema 3 is not readable by S2, and a binary backup alone is not a state downgrade. No live store was migrated during this evaluation.

Lead's final owned-fixture check started/stopped the frozen host, occupied its saved loopback port, then attempted restart. It passed in 0.089 s: exit code 1, actionable occupied-port error, unchanged launcher record and no fallback origin. `target/lead-s3-checks/occupied-port.json` binds the exact candidate and result. No model turn or user host was involved. This closes the evidence condition; it does not claim new Windows browser qualification.

The exact frozen binary was atomically installed at `/home/kevin15011/.local/bin/deck2`; the prior S2 binary `3d2efe82…` is preserved under `target/installed-backups/`. Installed version/help checks passed, and `target/deck2-s3-install-evidence.json` records hashes and timestamp. Installation itself did not open or migrate user state. Use fresh isolated state for evaluation, or preserve a backup of stopped state before activating a schema migration when backward recovery is needed. The binary backup cannot reopen a schema it does not support.
