# Sprint 5b — Managed RTK update verification

Status: corrected candidate `c92e75b7…` is **accepted and installed** as `71f4deb0…`, following Quality 17 and Lead review. S5B-Q01 is resolved. S1-Q07, S5c and S6–S12 remain outstanding. The earlier candidate and failure evidence below remain historical records; final disposition is in [acceptance and installation](#acceptance-and-installation).

## Candidate and scope

Apply Deep attempt 13 reported at events 138038/138039. Lead integrated the bounded implementation/evidence review at 139693 and the completed native replay at 140310. Quality attempt 16 reported at 139687/139688 and is integrated at 140295. Integration does not accept this candidate.

- Candidate: `70d3f9f17846960a0c7a8964e9afbf4f52306cd902a0d343aff41e7150e349b3`.
- Packaged binary: `397f4498f41258531fc5e7a339dcf8411cca622b5474be7d22a63396e0f31873`.
- Frozen review copy: `target/review-s5b-70d3f9f1/`, with 102 implementation/build/test inputs and 22 embedded browser assets.
- Manifest: `target/s5b-verification/final-4/candidate.json`; full implementation handoff: `target/s5b-verification/handoff.json`.
- Recipe: SHA-256 of the compact, sorted JSON path-to-file-hash map. Lead recomputed the map digest and matched every frozen input, asset and binary after verification. The live tree may advance under the correction owner.

The finite slice adds optional RTK compaction of an authorized captured Rust source file, exact captured-source retrieval, recorded per-attempt tool/artifact selection, and a reviewed browser install of 0.50.0 followed by an update to 1.2.0. It does not provide unrestricted RTK commands, automatic updating, arbitrary package installation or full capability/skill parity.

Artifacts belong to a private shared Deck store, defaulting to `~/.local/share/deck2-managed-v1`, independently of project state; `--artifact-store` selects another owned store. Publication retains immutable verified versions and notices. Each project activates its own selection in a transaction with its operation receipt. Existing admitted work retains its selection. Matching bytes in an external installation do not transfer ownership to Deck. There is no artifact garbage collection in this slice.

Source review covered bounded HTTPS acquisition/extraction, descriptor-based ownership checks and non-replacing publication; activation/receipt transactions; pinned executable identity; captured-source authorization and exact retrieval; cancellation and unresolved process ownership; native tool selection; browser authorization and pending-operation recovery. The graph has no indexed `deck-next` project, confirmed again with exact-path coverage queries; source reads were used rather than treating the old Deck graph as evidence.

## Verification completed

Owner final-gate evidence reports 77 Rust tests passed, two ignored, 12 frontend tests passed, formatting/lint/type/build checks passed, and packaged recovery/origin regressions passed. Rust tests took 22.622 s; the browser build/type gate took 33.837 s. Lead reused those matching gates and independently exercised the protected boundaries below.

| Lead check | Result | Wall time | Evidence |
| --- | --- | --- | --- |
| `cargo test --locked -p deck2 --lib managed_tools::tests::` | Six tests passed: activation/receipt consistency, stale/cancel/revocation, legacy restart, lock/ownership, extraction and redirect boundaries | 1.581 s | `target/lead-s5b-checks/management-tests.log` |
| `cargo test --locked -p deck2 --lib rtk::tests::` | Five tests passed: snapshot identity/scope, lossy delivery, captured-byte fallback, cancellation/fault and uncertain cleanup | 3.391 s | `target/lead-s5b-checks/snapshot-tests.log` |
| Packaged two-project management journey | Passed with real artifact downloads/publication and browser recovery | 52.849 s | `target/lead-s5b-checks/management/management-boundaries.json` |
| Packaged real Codex/OpenCode browser journey | Passed retained-selection and actual helper invocation checks | 204.121 s | `target/lead-s5b-checks/native/browser-journey.json` |

Commands, environment, candidate and durations are recorded in `target/lead-s5b-checks/checks.json`; adapted harness identities are in `script-identities.json`. The management harness substitutes only native startup and uses real helper acquisition/publication. It covers two independent project hosts, stable/conflicting operation identities, a lost acknowledgment surviving another tab's stale response and reload, retained old project selection, exact notices, and an injected activation failure that leaves a published artifact unselected. The same operation then recovers after restart; cancellation from recovery does not select it.

The native journey used the frozen binary and owned fixture `target/lead-s5b-checks/native/journey-c6aTqi/`. A legacy queued root retained read/search after both helper activations. A queued root and same-owner follow-up actually used RTK 0.50.0; later work used 1.2.0. Lead inspected the retained native databases: three completed compact-read/exact-snapshot call pairs and one completed legacy read/search pair were present. Helper invocation measurements were 217 ms, 203 ms and 273 ms. The browser install measurements were 2,399 ms and 3,594 ms. These are observations for this fixture, not general speed guarantees. The owned host/native processes were no longer running after the harness completed.

Lead inspected the resulting desktop/mobile captures. Existing Deck shell, typography, configuration navigation and mobile focus treatment are retained. Quality reviewed GSAP usage and owner interaction evidence; this is not acceptance of full original-app visual or feature parity.

Quality independently ran five protected tests using the existing gate-named executable in 0.079 s and inspected actual native calls and supplied recovery evidence. Its Cargo rebuild was unavailable because the environment returned `Read-only file system (os error 30)`. It did not independently rerun browser motion or writable filesystem fault fixtures. Lead's separate real browser and writable-fixture checks cover those stated scenarios, without converting reviewed evidence into independently executed evidence.

The owner disclosed and corrected initial defects in lossy delivery, restart inspection and publication staging. The wire-delivery regression prevents embedding the original source in the compact response; exact retrieval remains explicit. Not every new test had a failing predecessor run. S5B-Q01 below has an independent reproducible failure against the submitted candidate.

## S5B-Q01 — Predecessor can corrupt new persisted selection

**Original finding: major; blocked acceptance and installation. Now resolved by the correction below.** The original S5b candidate identified state as schema 5 while adding helper selection and attempt provenance that S5a cannot preserve. The accepted S5a binary could open such state, ignore new fields during deserialization and write older representations back.

Lead reproduced this using a SQLite backup of a stopped, owned management fixture, never user state. The old binary opened successfully, omitted the helper from its configuration response, then applied a reviewed team toggle. The resulting configuration had lost the previously selected RTK 1.2.0 identity. The exact reproduction and result are `target/lead-s5b-checks/old-reader-probe.py` and `old-reader-fixed-auth.json`. An earlier harness attempt failed to exchange the launch fragment for authentication; that 403 was a harness error, corrected before the successful reproduction.

Quality independently confirmed the related startup path in frozen source: S5a rewrites active root receipts and every task during recovery, dropping unknown helper/attempt fields. Returning to S5b can then fail its selection-consistency check. Quality did not execute that downgrade scenario; its report is source evidence, alongside Lead's executed configuration-loss reproduction.

Apply Deep's same task accepted attempt 14 with structured S5B-Q01. Required correction: an explicit incompatible schema boundary and transactional migration preserving prior selections, configuration history, operation state, snapshots and admitted authority. The predecessor must reject new state before writable opening. Regressions must cover legacy state without helpers, existing helper-bearing state, rollback on migration failure, actual predecessor rejection without persisted-state mutation, and successful reopening by the new binary. The correction must requalify affected state/restart/publication/activation paths and a meaningful packaged journey. A binary backup alone is not a state downgrade strategy.

## S5B-Q01 correction candidate

Apply Deep attempt 14 reported at events 140910/140911. Candidate `c92e75b7630724003452cdc23adbe8d286bf0d8a5daa48b958b4b04b5e09b8c9` builds binary `71f4deb0845172f1cedeeaf929a10c85a1a6a860ea7fbb7a8f9507df2232c3dd`. Lead matched and froze all 104 inputs and 22 assets under `target/review-s5b-c92e75b7/`, then rematched both the live candidate and frozen copy after its checks. Full handoff and manifest: `target/s5b-corrections/handoff.json` and `final/candidate.json`.

The correction uses schema 6 for every new or migrated helper-capable store, including stores with no selected helper. Recognized schemas 1–5 migrate in one outer transaction encompassing legacy transformations, configuration initialization, queue pause and snapshot tables. Configuration initialization uses a savepoint; schema 6 is published and the complete state validated before commit. Existing state is inspected read-only before writable opening. Schema 5 accepts genuine S5a with no snapshot tables or complete pre-boundary S5b tables; schema 6 requires all three snapshot tables. Partial tables, invalid captured-source identities/hashes and future versions are rejected. Normal conservative restart settlement follows the migration. There is no automatic downgrade.

Lead read all three production diffs, five new persistence tests, the packaged harness and both legacy-fixture corrections. The latter remove post-version tables and configuration fields from synthetic schema-1/2 fixtures, retaining their protected assertions. Recorded initial tests had three failures and one pass against the old production boundary; corrected tests pass. This provides red-first evidence for the incompatibility and late-transaction failure, while operation-phase retention remains a characterization test.

Lead independently ran:

- `cargo test --locked -p deck2 --lib persistence_tests`: five tests passed, 6.114 s wall time. This covers incompatible version publication, configuration/history and queued/running/child-follow-up retention, exact captured source, ten helper-operation phases, late migration rollback and read-only rejection of incomplete/future state.
- `python3 scripts/schema-boundary-regression.py` with explicit frozen new/old binaries and a copied owned helper-state seed: seven actual launches passed, 0.921 s. The real accepted S5a binary created a genuine legacy store; the correction migrated it, S5a then refused it without changing database bytes or logical rows, and the corrected binary reopened it. Rejection/reopening also preserved selected RTK 1.2.0 state. No provider turn was dispatched and no user state was opened.

Exact commands, durations and candidate are in `target/lead-s5b-correction-checks/checks.json`; results are in `packaged/schema-boundary.json`. The implementation-owner full gates passed 82 Rust tests, two ignored, and 12 frontend tests, with formatting, Clippy, type/build and packaged recovery/origin checks. Its rebuilt real browser/two-project publication and restart-recovery journey also passed against `71f4deb0…`; that journey's separate duration was not instrumented.

Evidence reuse is bounded: 97 previous inputs, all 22 assets and the entire original RTK Store/transformation/execution suffix are byte-identical. The native adapters, schemas and process-control paths used by the previously executed real native journeys are unchanged. Those earlier native measurements are reused for those paths; they are not described as a newly executed provider journey on this correction. Migration and predecessor behavior have new independent execution evidence. Quality's same task accepted attempt 17 for the correction, including the startup provenance-loss path from its prior review. At that handoff, S5B-Q01 remained open and installation had not occurred; final acceptance follows below.

## Limits and next acceptance step

Only the exact two reviewed Linux x86-64 musl artifacts and qualified OpenCode path are covered. The full notice bodies are retained; their preparation does not assert eligibility for every redistribution or hosted use. Source compaction is optional and lossy, with exact recovery; the fixture does not establish general token savings.

The MCP `tool_connection_ms` observation is cumulative elapsed time to acknowledgment during preparation, not an isolated handshake measurement. Owner responsiveness evidence compares an ordinary request with a deliberately stalled external helper download, but does not establish broad latency guarantees. S5c's stateful Codebase Memory service maintenance and automatic updates remain separate work.

The correction's exact candidate and compatibility boundary were independently checked by Lead. Follow-up Quality review is now complete, as recorded below. Existing live user hosts were not restarted.

## Acceptance and installation

Quality attempt 17 reported at 141984/141985, report SHA-256 `ea4347db4fbf20f584654b043a44c59265e80e74d223338575d187e034e287a0`. Lead read its full recommendation and again matched all 104 current/frozen inputs, 22 assets and binary `71f4deb0…`. At integration 142458, Lead accepted bounded S5b and structurally resolved S5B-Q01 on both implementation and review tasks.

Quality independently passed three focused executable tests in 0.037 s: incompatible version, activation/receipt rollback and snapshot ownership/hash. Four writable persistence tests were blocked by its read-only environment; they are not independent passes. Lead's previously executed five persistence tests and seven real predecessor/migration/reopen launches cover those fixture boundaries. Matching 82 Rust/12 frontend gates, rebuilt browser recovery and bounded unchanged native evidence are reused as described above. No new blocking finding remains within this slice; S1-Q07 stays open.

At **2026-11-11 10:40:58 UTC**, Lead atomically installed the verified frozen binary at `/home/kevin15011/.local/bin/deck2`. Version/help checks passed. Installation evidence: `target/deck2-s5b-install-evidence.json`. The prior S5a executable is preserved at `target/installed-backups/deck2-449f6240ab4c5b11fef03fce0ddec22eb5926ae759b2cedc3a2c345c846022e6`.

Installation replaced only the executable: no live host was stopped/restarted and no user state was opened or migrated. An already running process retains its prior binary. Starting the new host migrates recognized older state to schema 6; S5a cannot reopen it. A binary backup alone cannot reverse that migration. S5c and the remaining functional sprints are still required.
