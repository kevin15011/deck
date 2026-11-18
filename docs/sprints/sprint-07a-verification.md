# Sprint 7a — Runner management candidate

Status: corrected candidate `d9d409cd…`/binary `1cccd497…` is accepted and installed. Quality 21 is integrated at 186567; S7A-Q01 is resolved on both production and review tasks. Lead's independent protected and actual browser/native evidence supports the repair. Interactive third-party sign-in, S1-Q07 and S7b remain outstanding. Historical candidate `0019c6dd…` and its blocking review are preserved below; the final [acceptance record](#acceptance-and-installation) applies to the corrected candidate.

## Identity and scope

- Candidate: `unborn-head:implementation-sha256:0019c6dd6c0e08f4581de7a141c48806cbd831954de561f863f424844af21d32`.
- Binary: `e46ea8dffbdbfc86849ae295c09ff79e9ad2ab251e3b606de446de0cb654dbdc`.
- API 5; persistence schema 8; 123 implementation inputs and 22 embedded assets.
- Frozen directory: `target/review-s7a-0019c6dd/`; manifest SHA-256 `cfdd5b8c71033d3cda986b5c624d9fb348150916d489e90a94bbe3bd406ea43e`.
- Owner report: events 182034/182035; SHA-256 `5314682dfc176c26ab8031634293f0232421f4a8d5006b2bc8ab643f8364a351`. Full evidence handoff: `target/s7-verification/handoff.json`.

The [S7a brief](../../openspec/changes/sprint-07-runner-management/working-brief.md) defines one Linux x86-64 musl Codex 0.166.0 management journey. Configuration → Runners offers bounded inspection, a reviewed installation into Deck-owned storage, native authentication handoff, reviewed model policy and operation recovery. External installations remain externally owned. OpenCode 1.19.1 is inspectable for its existing scoped Investigator assignment; its administration is not included.

Installation validates the fixed official archive, full companion inventory and notices, publishes an immutable package and separately activates the selected binding. Native configuration and credentials remain native-owned. The configuration selected for new work is distinct from the immutable executable/model binding recorded for admitted work, continuation and later Quality. Native acknowledgement must match the requested model; missing acknowledgement or an altered executable blocks dispatch without fallback.

Ordinary fresh conversations may retain native model selection or request the qualified `gpt-6.1-sol` policy. Team, Developer and Quality keep their existing fixed model assignment. Other advertised models are visibly unqualified. Model listing and artifact acquisition are management operations, not message-admission prerequisites.

## Verification

Lead reviewed the full handoff and material artifact publication, runner operation/login, native preparation, admission, configuration, persistence and frontend paths. All current and frozen inputs/assets/binaries were rematched after execution; installed S6 preservation is recorded in [candidate-match.json](../../target/lead-s7a-verification/candidate-match.json).

| Check | Evidence and result |
| --- | --- |
| Owner's final gates | Formatting, Clippy, 112 Rust tests, 13 frontend tests, TypeScript/build and affected packaged regressions passed. Four Rust tests were explicitly ignored; they are not counted as passes. Recorded total wall time: 87.645 s. `target/s7-verification/final/`. |
| Lead protected runner checks | `cargo test --locked -p deck2 runner_management -- --nocapture`: 13 passed, one acquired-package manual test ignored; 5.703 s wall time. [Command/result](../../target/lead-s7a-verification/protected-run.json). |
| Lead actual browser/native journey | Exact frozen binary; actual HTTPS acquisition and managed executable, already-authenticated native inspection and useful provider execution; 75.445 s wall time, 73.080 s harness interval. [Command/result](../../target/lead-s7a-verification/browser-run.json), [journey](../../target/lead-s7a-verification/browser/journey.json). |
| Lead persistence compatibility | Six packaged startup runs: actual accepted S6 creates schema 7, candidate migrates to 8, S6 rejects schema 8 without changing database bytes/records, supported reopen preserves state and an injected late migration failure rolls back. [Result](../../target/lead-s7a-verification/schema/schema-boundary.json). |
| Lead authentication UI boundary | Real Chromium with an explicitly fake native protocol: closing during a delayed handoff prevents hidden codes returning, no code/URL in browser or durable projection, cancellation rechecks native account state, no thread/provider turn. [Result](../../target/lead-s7a-verification/login-browser/result.json). This is not third-party login qualification. |

The actual browser journey recovered a lost install acknowledgement after reload, rejected a stale second-tab review without effects, selected the explicit model and read the owned fixture's waypoint through one real native tool call. Requested and acknowledged model were both `gpt-6.1-sol`; the receipt bound the exact Deck-managed executable. Restart with a conflicting missing startup executable retained the browser-selected package and the same receipt without replay. Unpaired management requests returned 403; an incompatible API request returned 409. No personal login/logout, credential copying or account replacement was performed.

## Presentation

The packaged journey exercised keyboard and rapid disclosure reversals with normal and reduced motion, captured desktop/mobile and checked horizontal overflow and page errors. Its screenshots are retained alongside the journey. Lead also captured a foreground settled disclosure after restart and recorded equal client/scroll heights, opacity 1 and no residual inline motion style at three intervals: [state](../../target/lead-s7a-verification/visual-state.json), [desktop](../../target/lead-s7a-verification/runners-settled.png), [mobile](../../target/lead-s7a-verification/runners-mobile-settled.png).

Visual inspection preserves the existing shell's brand, surfaces, typography and navigation against the [live reference](../design-reference/live-20261111/README.md). This new management view has no identical old home-screen counterpart; these captures do not establish pixel parity or completion of S8's daily-workspace fidelity work.

## Remaining boundaries

- Independent Quality review and Lead acceptance preceded local installation. No live user host was restarted and no live state was opened or migrated by installation or these fixtures.
- Successful new interactive third-party sign-in remains unobserved. The real journey uses existing native authentication; protocol fakes establish only their stated deterministic boundaries.
- Actual Windows/WSL automatic browser authentication remains S1-Q07. Manual authenticated private-link recovery remains available.
- S7b must qualify genuine cross-version update/recovery, removal, additional supported runners and model/platform tuples. This candidate does not complete all S7.
- Native-scope locks coordinate cooperating live Deck hosts; they do not confer ownership over independent native clients. Native authentication/cache can refresh normally.
- The S6 binary cannot read schema 8. Keeping the old executable alone cannot restore migrated state; preserve paired state when backward recovery is needed. Local installation itself does not migrate state.
- S5c's [Rust integration brief](../../openspec/changes/sprint-05c-managed-codebase-memory/working-brief.md) is ready for the same production owner after S7a acceptance; the tested CBM service prototype is not yet the production feature.

## S7A-Q01 — Admission versus authentication reservation release

Quality attempt 20, events 183384/183385, report SHA-256 `86c3e4800a8969d11181492ffdd34f226d89012c76fd2ef3ca1aa918bac81e9b`, recommends blocking acceptance on one major finding. Lead rematched all 123 inputs, 22 assets and binary `e46ea8df…`, then confirmed the following source interleaving in the exact candidate:

1. `server.rs:255–263` (`clear_active`) or `server.rs:661–669` (cancellation) observes no affected work while holding a temporary Store guard.
2. The guard expires before the separate `auth_scope.take()` call. A concurrent admission can acquire Store, reuse the existing shared reservation and register new work.
3. Cleanup releases that reservation. Another cooperating Deck host can acquire exclusive native-login ownership during the new execution. Queue pumping does not repair the gap when an active process is already registered.

The required correction serializes settled-state validation and release with admission, preserving the `active → Store → auth_scope` order and reservations for active processes and uncertain login ownership. Deterministic regression evidence must reproduce the original loss and show exclusive login remaining rejected until genuine settlement in the corrected candidate. Other release paths, including failed admission, must obey the same ownership invariant.

This finding is established by source inspection; the reviewer could not construct its runtime interleaving fixture under its read-only restrictions. Its independently executed startup-selection test passed but does not test this race. Lead therefore retains the earlier actual 75.445-second journey as valid bounded evidence, not evidence of race freedom.

Production continuation 18 accepted S7A-Q01 as a structured blocking finding. Its repair, final manifest, relevant regression and actual packaged checks precede another independent review and Lead acceptance. No installation occurred. The transient internet interruption did not invalidate the persisted candidate or reports.

## Corrected candidate and protected verification

Apply Deep attempt 18, events 184926/184927, delivered candidate `unborn-head:implementation-sha256:d9d409cd27ed2d7bbc0c634a3cd59f91ba862da999772d32ea0599ff7ff7fcbb`; binary SHA-256 `1cccd49760bc33ee14a7a64dfec6bbf7ab52d029cd2c03af5da844f0f8f81c0a`. API 5/schema 8 are unchanged. Frozen directory `target/review-s7a-d9d409cd/` contains 123 inputs and 22 assets; manifest SHA-256 `124044b414293395d1af32c68d34e7fa80cc6b4bf408e56fd455a953d6384d40`. Report SHA-256 is `1bbdfbcdef2d01945398bb16f3ea1134af6d3756e285594068881e50b98c5e91`; full handoff is `target/s7-verification/repair-handoff.json`.

Only `server.rs`, `runner_management.rs` and `runner_management_tests.rs` changed. Completion and cancellation now retain the active and Store locks through the settled-state check and authentication-reservation release. The same guarded helper handles rejected admission. It requires no active process, affected durable work or pending/uncertain login; read errors retain the reservation. Test-only scheduling hooks are excluded from the production build.

The original completion and cancellation paths both failed the deterministic `auth_release_` boundary checks with “cleanup lost new admission reservation” (`target/s7-verification/race-red-both.log`, exit 101). The scheduler probe tries actual admission locks and Store admission immediately before release, then attempts exclusive scope acquisition through a separate kernel file description. Corrected code blocks admission during cleanup and allows it afterward with a new reservation. Tests additionally retain ownership for terminal-but-live processes, uncertain receipts, rejected admission and uncertain login. This is deterministic boundary scheduling, not a claim of simultaneous OS-thread or provider execution.

Lead inspected the complete diff and independently passed the three `auth_release_` checks plus uncertain-login restart and two-host scope coordination: five tests in 4.842 s summed command wall time. [Commands/results](../../target/lead-s7a-repair/protected.json) retain individual timings and logs. The oracle is that exclusive login stays rejected while execution/process/uncertain ownership remains and succeeds after genuine settlement.

Owner final gates passed 115 Rust tests (four ignored), 13 frontend tests, formatting, Clippy, TypeScript/package build and affected packaged regressions in 106.921 s recorded total. Owner actual frozen browser/native replay passed in 155.853 s after one interrupted-download attempt. Lead inspected the failed fixture: durable failure, `published=false`, no selected runner and zero execution receipts, recorded in [failed-acquisition-review.json](../../target/lead-s7a-repair/failed-acquisition-review.json). A fresh owned retry succeeded; this does not claim automatic user-operation retry. The owner’s final real evidence is `target/s7-verification/repair-browser-retry/journey.json`.

Unchanged frontend/assets and API/schema behavior reuse their matched prior evidence. The existing verifier refreshed fixed `schema-final`, `login-browser-final` and `queue-final` summaries for the repaired binary; predecessor-specific claims use the retained Lead run directories. Quality 21 reviews this exact repair; S7A-Q01 stays structurally open until Lead disposition. Installed S6 and all interactive/S7b limits remain unchanged.

### Lead actual execution and acquisition limits

On the repaired frozen binary, Lead's fresh acquisition attempt ended after 93.609 s with `Release stream interrupted`. The durable operation was failed with `published=false`, no selected runner and zero provider receipts: [record](../../target/lead-s7a-repair/independent-download-failure.json). This run did not pass the acquisition journey.

To separate download availability from the repaired execution boundary, Lead copied its already-acquired exact package into a new owned fixture and ran the same browser/runtime assertions. That real packaged/native journey passed in 77.077 s: validated package and reviewed activation, lost-response recovery, two-tab stale review, requested/acknowledged `gpt-6.1-sol`, one actual scoped file read, authority checks and restart preserving the selected binding and single receipt. [Command/result](../../target/lead-s7a-repair/cached-browser-retry-run.json), [journey](../../target/lead-s7a-repair/cached-browser-retry/journey.json). It reuses real package bytes and existing native authentication; it does not prove a fresh HTTPS download or a new personal login. Owner's successful 155.853-second fresh-acquisition run supplies that separate evidence.

The first owned copy used Node's default directory mode 0755 and was correctly rejected by private-store checks before a review plan. The fixture was corrected to preserve source modes; production code was unchanged. [Fixture provenance](../../target/lead-s7a-repair/cached-package-provenance.json) records the exact original/copy script hashes and adaptation. All 123 current/frozen inputs, 22 assets and binary were rematched afterward, with installed S6 unchanged: [manifest check](../../target/lead-s7a-repair/candidate-match.json).

Apply Deep 18 is integrated at 186219 for this reviewed repair candidate. The following final review closes the acceptance work for bounded S7a.

## Acceptance and installation

Quality 21, events 185997/185998, report SHA-256 `7103640c46af7c0fe3875aa9ee77e5d34b457b35a6cf3284a1839b1a2f36e023`, recommends accepting the corrected candidate with no remaining blocking finding in this repair. Lead read the complete review and independently rematched all 123 current/frozen inputs, 22 assets, manifest `124044b4…`, recipe and binary `1cccd497…` before acceptance. Integration **186567** resolves S7A-Q01 on both production and review tasks and accepts only the documented S7a scope.

The review found the release guards consistent across completion, cancellation, rejected admission and login replacement. Its protected replay stopped at read-only temporary-directory creation before behavior was exercised (exit 101, 0.007 s); that is not a passing regression test. Its in-memory selection test passed (0.017 s) but does not establish race freedom. Lead's matching five protected passes and actual 77.077-second native/browser/restart journey satisfy independent execution, alongside the owner's separate 155.853-second fresh-acquisition journey. No unchanged tests were repeated solely to restate acceptance.

At **2026-11-11T14:27:59.380952+00:00**, Lead atomically installed the exact frozen binary at `/home/kevin15011/.local/bin/deck2`, synchronized file/directory writes and verified its hash and `deck2 0.1.0` version output. [Installation evidence](../../target/deck2-s7a-install-evidence.json) records the previous S6 binary `9c1917cd…`, preserved in `target/installed-backups/deck2-9c1917cdbda6c27009f5df6db1e51bab2ac534c9895a8b9b16950c7e58373689`. No host was restarted or state opened. Existing running processes continue their previous build until the operator restarts them.

The installed contract is **API 5/schema 8**. S6 refuses schema-8 state; its executable backup alone cannot downgrade a migrated database. Successful new third-party sign-in, actual Windows automatic authentication (S1-Q07), S7b and later product scopes remain pending. S5c's prepared Rust integration is the next production slice; the accepted prototype does not yet make Codebase Memory available in this installed build.

## Subsequent interface performance correction

The S7a acceptance above remains the historical baseline. On 2026-11-11, Lead accepted and installed isolated candidate `ef86509f…`/binary `c349c815…`, which prevents the entrance observer from repeatedly animating hidden navigation controls. No Rust, API, schema or runner-selection behavior changed. [Independent comparison and installation](performance-regression.md#accepted-correction-and-independent-verification) record the original/repaired browser regression and matching packaged assets. The user's running host needs restart; actual Windows Chrome/Zen confirmation remains pending. Partial S5c is not included.
