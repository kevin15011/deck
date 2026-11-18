# Startup continuation compatibility repair

Status: **accepted and installed** as a6205298. Quality30 integrated243439 and Lead resolved STARTUP-Q01 on both tasks after the already-recorded independent copy replay. S8c may resume. Original user state and personal runners remain untouched by the installation. Earlier checkpoint evidence below retains its original attribution.

## Failure and correction

The previous admission path copied a prior native-thread policy snapshot into a differently requested execution mode. Native preparation rejected the incompatible content before thread preparation or turn dispatch; persisting that failure then made strict startup inspection reject the whole store. The user's schema8 copy reproduced this failure; SQLite quick_check passed.

Candidate `ecb7fff2eb9047dabf112d9c3b5b28d7d098568729c0bb3895b54ff9c123ba0a`, binary `a620529877223bd918344d72ee5a92a4232a65812bee4e266ddf9c8e9998eebd`, rejects new cross-mode non-fresh continuation before durable effects. Immutable retries remain before this check; explicit fresh execution selects the requested mode. A second check protects the prior receipt selection.

Historical compatibility recognizes only the known failed read-only/reviewed-edit continuation shape: exact pre-content-check failure, no dispatch/output/decisions/images, matching prior completed native receipt and preserved selection/ownership/content integrity. It retains historical bytes rather than changing the recorded mode or claiming that a different policy ran. Other mismatch shapes and future schemas still reject. No new schema or general repair facility was added. Existing schema8 state follows the normal migration to schema10, with API7/service schema3 retained.

## Evidence

Lead read the full Production34 report, handoff, all four source/test deltas, new private-copy browser fixture and actual predecessor/fixed HTTP records. All164 inputs,22 assets and current/frozen binaries matched before and after independent checks. Native production image-lifetime code and frontend assets are unchanged. Unfinished S8c files are preserved separately outside this candidate.

| Independent check | Result | Wall time |
|---|---|---:|
| `source scripts/env.sh`; `nice -n 10 cargo test --locked -p deck2 --test configuration continuation_mode_change_is_rejected_before_admission -j 2 -- --nocapture` |Both directions, immediate/queued, unchanged rejection, same-mode retry and explicit fresh selection pass |7.238s |
| Same environment; `nice -n 10 cargo test --locked -p deck2 --lib legacy_failed_continuation_reopens_without_rewriting_history -j 2 -- --nocapture` |Production native pre-dispatch failure, narrow compatibility, negative variants and exact history preservation pass |6.295s |
| `DECK2_EVIDENCE_DIR=target/lead-startup-ecb7fff2/browser node scripts/startup-configuration-regression.cjs` |Private historical copy opens, authenticates in browser, reloads/restarts and preserves draft plus all26 receipts/2 conversations byte for byte |4.434s |

The browser fixture blocks command submissions and substitutes a version-only native sentinel. Two version probes occurred; no replay/provider call, page exception or command request occurred. Original DB and source-copy hashes remained unchanged. No screenshots, user messages or native identifiers were exported. Compilation completed before browser measurement.

Exact full-gate candidate matched:158 Rust tests passed with7 existing opt-in ignored;20 frontend tests/132 assertions, formatting, Clippy, typecheck and packaging passed. Full gates were reused, not repeated by Lead. Owner's actual predecessor HTTP matrix reproduced startup refusal in both directions with immediate and queued input; fixed matrix rejected before admission and accepted explicit fresh execution. Lead inspected those logs and the harness, but did not claim an independent red rerun.

[Candidate/handoff](../../target/review-startup-ecb7fff2/handoff.json), [Lead review](../../target/lead-startup-ecb7fff2/review.json), [independent checks](../../target/lead-startup-ecb7fff2/checks.json), [browser result](../../target/lead-startup-ecb7fff2/browser/result.json). Historical-state fixtures are private and must not be published. Production34 integrated242701; same Quality task accepted fresh bounded review with STARTUP-Q01 open and Production34 as source. Lead acceptance and installation remain pending; S1-Q07 is unaffected.


## Acceptance and installation

Lead read Quality30's complete1944-byte report (SHA256 `b0f21455c95285b57cf06a62c82c6cba152309bba4f6a0a7f733302c3647e8df`) and rematched164 inputs,22 assets and current/frozen a6205298. The requested independent historical-copy replay was already completed and recorded in integration242701: two focused tests plus packaged browser migration/restart preserved26 receipt bodies and2 conversation bodies byte for byte with no replay/provider calls. Quality independently ran the admission regression and reviewed the remaining evidence. Integration243439 accepts this bounded correction and explicitly resolves STARTUP-Q01 on both tasks. No unchanged check was rerun; S1-Q07 remains open.

At2026-11-12T01:31:19Z the frozen executable atomically replaced `/home/kevin15011/.local/bin/deck2`; prior8a966675 was backed up. Installed SHA256, `--version` and `--help` passed. [Installation receipt](../../target/deck2-startup-install-evidence.json). The original DB remains byte-identical to the incident capture. No user host was started/restarted and no personal tools or profiles changed. The next ordinary serve invocation opens the existing directory and performs the qualified normal schema8→10 migration; no reset or special repair command is needed. Binary backup alone cannot downgrade migrated state. Changing a conversation's execution mode requires explicit Start new execution.
