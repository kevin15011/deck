# Sprint 6 — Developer lifecycle candidate

Status: corrected candidate `cdfd5229…` is accepted and installed as `9c1917cd…`, API 4/schema 7. Lead resolved S6-Q01/Q02 after reviewing Quality 19 and independently reproducing the original queue defect, passing the corrected protected/history checks and actual native/browser journey. Historical findings and evidence are retained below. S1-Q07 (actual Windows browser opening/authentication), S5c, broader role/skill parity and S7–S12 remain outstanding.

## Candidate and scope

Apply Deep attempt 15, events 162999/163000, report SHA-256 `71396c8846003bc5e7482daa599c940cadc3c2feac47066173e340f4a50ce5b4`, is integrated at 165677. The full implementation/evidence handoff is `target/s6-verification/handoff.json`.

- Candidate: `unborn-head:implementation-sha256:5431255b6bb1e7de4694a5c5eb791fbf07d0c0a3fe6263382faeb7bbd1e732ec`.
- Binary: `1ba1de41f295156e8abdc23559270a8410a86c8e8b4e4fd90443aa7a17bf3e2b`.
- API 4; persistence schema 7.
- Lead recomputed the sorted compact JSON input-map digest, all 110 implementation inputs, 22 packaged assets and binary; the matching snapshot is `target/review-s6-5431255b/`. `target/lead-s6-verification/candidate-match.json` also records the unchanged installed S5b binary.

The browser records scoped intent, acceptance, permitted existing paths and a project-derived Python check. Codex Lead proposes individually reviewed edits; a separate fresh Codex Quality session inspects a captured candidate and runs the check. Native command start/terminal events supply command, working directory, thread/turn/item, duration and result. Lead must treat the exact review and request completion. Successful model execution alone cannot complete a change: current evidence, finding dispositions and process settlement are required.

Failed checks and findings remain visible across correction attempts. Successful completion creates a historical receipt bound to requirements, candidate and review. Finite Lead-only OpenSpec artifact operations persist intent, check expected bytes and reconcile observed effects after interruption; database and filesystem updates are not represented as one atomic transaction.

The route is deliberately bounded: Codex 0.166.0 / requested `gpt-6.1-sol`, Lead plus independent Quality; dependency-free `/usr/bin/python3 -I -B <existing-script.py>` selected from an existing project command source; at most 32 ordinary UTF-8 inputs, each at most 64 KiB. `.git` and managed OpenSpec artifacts are excluded from the candidate. Requirements are sealed at revision 1; different requirements use another change/conversation. Broader role execution, other check formats, dependency installation, network/build writes, project-only read confinement and full OS/runtime hermeticity are not qualified.

Managed fragments expose applicability and delivery; targeted Code Economy applies to Quality. They preserve necessary tests and use project verification requirements rather than obsolete Deck-specific timing rules. These fragments do not establish full standalone-skill/catalog parity or prove model compliance.

## Verification

The implementation owner's matching final gates record 97 passing Rust tests (3 ignored), 13 frontend tests, formatting, Clippy, packaged build/type checks, affected recovery/origin regressions and predecessor/schema checks. Command sources are Cargo/package manifests, `scripts/build.sh`, the S6 brief and `scripts/s6-verify.py`. Logs and exact commands are in `target/s6-verification/final/gates.json`; the full gate was reused after identity checks rather than duplicated.

Lead inspected material lifecycle, native execution, artifact, configuration, persistence and UI paths. All new-project paths are outside graph project `home-kevin15011-deck`, full generation `2026-11-11T01:38:54Z`; coverage was checked and exact-source fallback used. This was task-directed review, not an exhaustive source audit.

| Independent Lead check | Result | Duration |
| --- | --- | --- |
| `cargo test --locked -p deck2 lifecycle::` | 11 passed | 3.683 s |
| `cargo test --locked -p deck2 s6_operation_contracts` | 4 passed | 2.879 s |
| `cargo test --locked -p deck2 persistence_tests` | 5 passed | 4.341 s |
| `python3 scripts/s6-schema-boundary.py --binary target/review-s6-5431255b/dist/deck2 --output target/lead-s6-verification/schema` | Six actual packaged launches passed | 0.819 s |
| Packaged browser/native success, failure and correction | Passed | 173.824 s |

The protected cases cover current scoped authority, stale/foreign/native evidence rejection, finding retention, cleanup-bound completion, artifact conflicts/recovery and persistence compatibility. Their oracles come from the [working brief](../../openspec/changes/sprint-06-developer-lifecycle/working-brief.md). The owner records red-first failures for missing intent support, unknown ownership acceptance and lost review-derived findings; Lead's independent runs are in `target/lead-s6-verification/protected.json`.

The schema replay uses the actual S5b binary `71f4deb0…` to create schema 6, then migrates with the candidate. It preserves prior logical rows/history, verifies S5b refuses schema 7 without changing database bytes or rows, reopens successfully with S6, and injects a late migration failure that leaves schema 6 and its bytes intact. No provider turn is dispatched in this check. Evidence: `target/lead-s6-verification/schema/schema-boundary.json`.

The Lead browser command was `DECK2_EVIDENCE_DIR=target/lead-s6-verification/browser node scripts/s6-browser-acceptance.cjs target/review-s6-5431255b/dist/deck2`, after loading `scripts/env.sh`. It uses a disposable project/state, the real installed Codex and packaged Chromium UI. The three stages were:

1. Negative-duration feature: reviewed edits, passing real check, independent review, artifacts and one completion receipt.
2. Intentionally incorrect hours formatting: real failing check, two retained findings and no completion receipt.
3. Correction: same logical Lead owner, fresh independent review, both finding IDs retained/resolved and one completion receipt.

Reload caused no replay. Keyboard, rapid tab reversals and reduced-motion checks passed. Lead visually inspected desktop/mobile captures from `target/lead-s6-verification/browser/journey-ouWrgz/`; this supports the observed workspace and does not establish complete original-app visual parity. Full evidence is `target/lead-s6-verification/browser/journey.json`. The owner's earlier equivalent actual journey took 175.408 seconds. These end-to-end durations are not message-send latency benchmarks.

The owner's separate boundary-browser fixture uses a protocol/effect fake for duplicate calls, scope rejection and artifact-conflict recovery. It is not native-model evidence, and it observed the HTTP response rather than deliberately dropping it; lost-ack coverage is at durable operation boundaries. One early development suite reported an existing managed-tools lock-release assertion; later matching gates passed without a managed-tools production change. Its cause is not established.

## Review findings and correction

Quality attempt 18, events 165683/165684, report SHA-256 `596e60269920cb9ebfb266c82c28221d8988e17bf6387882e2f966965085cdfe`, is integrated at 165995. Lead read the complete report, rematched all 110 inputs, 22 assets and binary, and checked the relevant production paths. Both findings below are confirmed by source tracing; runtime reproductions remain part of the correction task.

| Finding | Trigger and consequence | Required correction/evidence |
| --- | --- | --- |
| **S6-Q01 — major, resolved at 173183** | A developer input queued during Quality review appends its root to the persisted change. Quality later saves its older full `Change` across an await, replacing that record and erasing the queued root. The queued receipt survives, but subsequent lifecycle/edit authority rejects it. | Preserve current concurrent admissions with bounded authoritative updates/CAS rather than stale whole-record replacement. Deterministically queue during the review and verify retained ownership through settlement, restart and correction. |
| **S6-Q02 — major, resolved at 173183** | Removing a settled developer conversation deletes its session and receipts without guarding the retained lifecycle change. Review/treatment references become orphaned and the UI cannot select that history. | Reject removal while lifecycle evidence is retained, consistent with the existing task guard; preserve the session/receipts/change and ordinary non-lifecycle removal behavior. |

Source seams: `lib.rs` developer admission, `native.rs` review saves across awaits, `lifecycle.rs::save_change`, and `sessions.rs::remove_session`. The prior passing fixture did not queue a correction during review or remove a settled developer conversation; those passes do not refute these findings. Quality independently passed the native-command parser test, but its writable completion test was blocked by read-only `/tmp` before assertions, so no runtime pass for either finding is attributed to it.

The same Apply Deep task `task-181d5e85-7817-4dbd-bc81-849132576baf` accepted attempt 16 with both structured findings open. It owns deterministic red-first reproductions, minimal corrections, affected gates and packaged queue/removal evidence. Lead retains finding closure, acceptance and installation authority. No new product binary has been installed, no live user host restarted and no runner profile or credential configuration changed by this review. Native authentication/cache may refresh during authorized real-runner fixtures.

## Corrected candidate and independent comparison

Apply Deep attempt 16, events 168010/168011, report SHA-256 `eaae6341c7952613f31c2ed258f9adcf5b43857bcfe1dcb6af315012ec5fc88b`, is integrated at 170221 for candidate `unborn-head:implementation-sha256:cdfd5229bd53eb8a71939588c5503cf8aa1ef2c3626f591133ff6b74994b2019`, binary `9c1917cdbda6c27009f5df6db1e51bab2ac534c9895a8b9b16950c7e58373689`. API 4/schema 7 are unchanged. Lead recomputed all 112 inputs, 22 assets, binary and candidate recipe, then froze `target/review-s6-cdfd5229/`. The correction changes four host files and adds two controlled fixture scripts; browser assets are unchanged. The previous handoff is preserved as `target/s6-verification/handoff-5431255b.json`.

The new lifecycle update compares the expected non-root state with current persisted state under the Store mutex. It preserves only appended roots with real same-conversation Developer receipts and rejects other concurrent changes or unadmitted root writes. An expected-state cursor spans native awaits and subsequent review, cleanup, artifact and completion saves; no Store lock is held over a native await. Unexpected conflicts use the existing stop/inspect/recover behavior rather than silently overwriting or automatically replaying. This assumes the existing exclusive state-file ownership, not a new multi-process writer protocol.

Conversation removal now rejects every retained lifecycle change, whether incomplete, pending or completed. Releasing saved native context retains the conversation, receipts and lifecycle evidence. Ordinary settled conversations without lifecycle evidence remain removable.

The owner recorded failing Store/native-settlement checks before the production correction and additionally reproduced both API defects against the frozen original executable. Lead independently reran the controlled queue fixture against both binaries: on the original, the assertion failed specifically because roots changed from `first-command, queued-correction` to only `first-command`; on the corrected binary, both remained and the correction completed with both review histories and resolved findings retained.

| Lead check | Result | Command wall time |
| --- | --- | --- |
| `cargo test --locked -p deck2 stale_lifecycle_writer_preserves_admissions_and_rejects_other_mutations` | 1 passed | 0.571 s |
| `cargo test --locked -p deck2 retained_lifecycle_prevents_removal_but_allows_context_release` | 1 passed | 0.971 s |
| `cargo test --locked -p deck2 s6_operation_contracts` | 4 passed | 2.730 s |
| `scripts/s6-queue-regression.cjs` against frozen `5431255b` | Expected failure: admitted root erased | 12.882 s |
| Same fixture against frozen `cdfd5229` | Passed: roots, correction, history retention, restart and reload | 14.141 s |

The fixture's separately recorded journey intervals were 2.341 s and 3.684 s; command wall time also includes browser/process shutdown and pending harness timers. The successful case observed HTTP 409 for retained-history removal, preserved receipts/change on context release, and HTTP 200 for ordinary conversation removal. It then restarted the host and reloaded the browser without changing retained evidence. The FIFO releases Quality only after queue admission; polling does not determine the interleaving. Its native events/verdicts are explicit protocol/effect fakes, not model or project-check execution evidence. Evidence: `target/lead-s6-repair/protected.json`, `queue-red/result.json`, `queue-green/result.json` and their logs.

The owner's matching final gates passed 99 Rust tests (3 ignored), 13 frontend tests, format/static/build checks and affected recovery/schema gates; its real Codex/browser journey passed in a reported 188.111 s. Lead reuses those full gates after identity checks.

Lead's separate actual Codex/browser replay passed with a recorded journey interval of **191.462 s**, five individually approved file proposals and three distinct Quality native sessions. The stages retained completed/incomplete/completed outcomes, zero completion receipts for the intentional failure, and both finding IDs after supported resolution. Command: `DECK2_EVIDENCE_DIR=target/lead-s6-repair/native-browser node scripts/s6-browser-acceptance.cjs target/review-s6-cdfd5229/dist/deck2`, after loading `scripts/env.sh`. Evidence: `target/lead-s6-repair/native-browser/journey.json`. The interval ends after the UI assertions and excludes final harness shutdown; it is not a message-send latency benchmark. Lead rematched current/frozen inputs, assets and binary again and confirmed S5b remains installed. Quality attempt 19 reviews the frozen correction; neither finding is closed and a delegate's recommendation alone does not establish acceptance or installation.

## Acceptance and installation

Quality attempt 19, events 169723/169724, report SHA-256 `8e804cbe53e14698fb243769e45ae12cd02d3ffd580386f57b96a3c62fda8c5f`, is integrated at **173183**. Lead read the full report and rematched the current and frozen 112 inputs, 22 assets, candidate recipe and executable. The reviewer confirms the expected-state cursor across all asynchronous lifecycle saves and retained-history removal guard. Its own runtime attempt stopped at read-only `/tmp` before assertions; no runtime pass is attributed to Quality. Lead’s six passing protection tests, packaged old/new FIFO comparison and real Codex/browser replay satisfy that remaining verification condition. Matching full gates were reused rather than repeated.

S6-Q01 and S6-Q02 are resolved on both implementation and review tasks, with the correction/review event references and independent evidence attached. S1-Q07 remains open. Acceptance is limited to the documented developer journey and qualified runners/check route; it does not certify the remaining catalog or later sprints.

At **2026-11-11T12:17:49.131345+00:00**, Lead atomically replaced `/home/kevin15011/.local/bin/deck2` with binary `9c1917cdbda6c27009f5df6db1e51bab2ac534c9895a8b9b16950c7e58373689`. The exact S5b predecessor is backed up at `target/installed-backups/deck2-71f4deb0845172f1cedeeaf929a10c85a1a6a860ea7fbb7a8f9507df2232c3dd`. A direct `--version` smoke passed. `target/deck2-s6-install-evidence.json` records identities and installation. No live host was restarted or state opened. An already running host keeps its prior executable until restarted; schema-7 state cannot be opened by the older backup, so executable replacement is not a state downgrade mechanism.
