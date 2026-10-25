# Bounded runner transport correction

Status: implementation authorized by the user after reviewing the live incident. Git diff/layout remains paused in session-git-diff/proposal.md.

## Outcome and acceptance

1. Legitimate command output matching the observed >1 MiB incident must not fail the Codex turn merely because its final envelope includes that output. Preserve completion, exit status, native identity and RPC correlation. Verify through the driver, not only the parser.
2. Keep explicit resource limits. Preserve permission requests and other actionable messages. Do not silently discard oversized envelopes, automatically replay actions or erase the native thread. Remaining resource-limit failures must be explicit and diagnosable.
3. Bound diagnostic metadata; never include output, credentials, command text or arbitrary native prose in transport diagnostics. Report exact versus lower-bound byte counts truthfully.
4. Cover chunk boundaries, UTF-8/JSON escaping, malformed frames, subsequent valid frames, pending response correlation and containment/cleanup. Validate supported resume response handling with synthetic data without inspecting native databases/history.
5. Inspect Claude and OpenCode production ingestion paths for analogous failure or silent loss. Report verified differences. Apply targeted fixes only where evidence supports them, through the same implementation owner; avoid creating a new generic transport framework.
6. No full payload persistence, model calls for diagnosis, native history parsing, automatic canary activation or daemon restart. Reusable synthetic fixtures and supported protocol schemas are sufficient where live reproduction is unavailable.

## Decision constraints

The prior diagnosis is in rpc-frame-incident.md. The investigator's generic skip-frame recommendation is rejected because it can lose lifecycle and correlation. Prefer the smallest maintainable bounded correction using verified native options where available, otherwise a justified transport admission strategy. A finite larger transport bound may be considered if justified by protocol evidence and memory tests; it must be documented as a bounded capacity fix, not arbitrary-size support. Do not build a custom streaming JSON projection system without first assessing simpler safe options. Existing downstream output limits remain in effect.

## Ownership and verification

One Apply Deep owner implements the transport slice and targeted regression tests. The existing investigator audits other runners read-only and returns evidence to Lead. Lead writes OpenSpec and coordinates any findings into the same candidate. Independent quality review covers protocol integrity, data exposure, cleanup and cross-runner claims before delivery. No live activation is claimed until separately verified.

Active ownership: apply-deep task-bac377a6-fe9f-4d0f-aa33-e491a01a19e1 (new transport implementation); investigate task-1cf2011b-0318-4587-84f5-47cef713f609 (continuation for cross-runner audit). Both delegations were accepted. Initial source evidence: OpenCode SSE defaults to 1 MiB and its stream error path fails/terminates; Claude splitter drops oversized lines with an overflow flag and checks string length against an 8 MiB-named limit. Driver-level effects and necessary corrections remain under audit; no other-runner fix is claimed yet.

## Reviewed cross-runner audit — investigate attempt 11

Lead read the original report (seq66902/66903), inspected /tmp/rpc-repro/runners.test.ts, reran all five parser probes successfully, and checked Claude driver ingestion/outcome plus OpenCode parser/stream error paths. Exact-path coverage for both runners was not_tracked at graph generation2026-08-20; direct source is the evidence.

- OpenCode: the 1 MiB SSE bound is real; overflow reaches readStream failure/termination and is classified as inferred network failure. This is a local transport-limit failure and must not be presented as a network/provider problem. request() also materializes an unbounded response.text(), whereas the catalog reader is separately bounded. Native tool-output reachability is unverified; these tests exercise parsers, not the native producer or full driver.
- Claude: the 8 MiB-named limit measures UTF-16 code units rather than UTF-8 bytes. Complete or partial oversized lines can be discarded, and the driver emits only a post-exit diagnostic. A missing result can produce a generic missing-result failure. The report's claim of losing "at most a message" is not established: multiple overlong lines can be lost. No evidence proves native output always reaches this cap.
- Reject "immediate diagnostic is enough" as a complete Claude fix: losing terminal, tool or permission-bearing messages must not produce false success or leave pending state unresolved. Do not infer a dropped message type from an arbitrary prefix. The owner must choose a conservative, explicit lifecycle response and test it.
- No verified Codex native suppression option was found within the inspected schema; this is limited evidence, not proof that none exists.

Implementation follow-up queued for the SAME owner when attempt1 completes: incorporate OpenCode transport-specific classification and bounded response handling; correct Claude byte accounting and explicit overflow lifecycle/diagnostics. Validate through driver fixtures (terminal loss, subsequent records, pending operations and teardown), preserving accepted-size operation. Do not start a second writer or interrupt the active Codex candidate solely to deliver this audit. Changes are authorized by the user's cross-runner request; no restart or activation is implied.

## Codex candidate reviewed — Apply Deep attempt 1

Lead inspected the four-file Codex diff and reran rpc/driver suites: 136 tests passed. Candidate admits up to 16 MiB per serialized frame with incremental UTF-8 accounting, retains actionable envelopes and emits bounded size metadata on rejection. Driver regressions cover escaped large command completion, subsequent permission correlation, exit status and a large resume-shaped response. This is a finite capacity fix, not support for arbitrary output sizes. Existing mapper limits remain downstream.

The owner reported 165 Codex tests passing and inspected native notification opt-out, which removes whole notifications rather than selectively omitting aggregate output. Lead reviewed the memory artifact: three maximum-sized completions reached about132 MiB total RSS from30 MiB baseline; this is a synthetic process observation, not a heap ceiling or concurrent-session guarantee. Codex candidate accepted for continued work; independent review remains outstanding. No daemon activation.

## Combined candidate — Apply Deep attempt 2

Lead reviewed /tmp/rpc-repro/cross-runner-transport-report.md and production changes. Claude now admits16MiB UTF-8 records and fails explicitly on overflow, resolving pending steering as unconfirmed and awaiting cleanup. OpenCode admits16MiB SSE frames/HTTP bodies, rejects malformed UTF-8/JSON explicitly, cancels readers, fences late controls/results and awaits process cleanup. Limits count serialized input, not total heap; native producer reachability remains unverified.

Owner reports266 focused tests passing and TypeScript/whitespace checks passing. Three broader tests exceeded the default5-second timeout but passed individually with the repository30-second setting. No independent broad-run claim is made yet. Memory fixture totals include producers/assertions and are not production/concurrency guarantees. The web failure wording remains generic; review must assess a small transport-specific user explanation rather than calling this fully delivered.

Next: independent review of protocol integrity, byte/resource bounds, pending controls and teardown, plus user-visible failure attribution. Git diff/layout remains paused and the daemon remains unchanged.

Independent review accepted: quality task-f512eb6f-eedd-4d83-9b80-152e7458f602, attempt1. Findings return to the same Apply Deep implementation owner.

## Independent review — changes required

Quality attempt1 (seq71348/71349) independently passed354 focused tests and reproduced additional failures. Lead reviewed the findings against source, including the host ownership-release boundary. Delivery remains blocked on these findings:

- RPC-Q001 (P1): OpenCode swallows termination rejection and resolves close(), letting the host release ownership although process exit is unconfirmed. Preserve cleanup failure through close(), without unresolved/unhandled task promises. Check equivalent changed cleanup paths as well.
- RPC-Q002 (P2): SSE EOF does not flush the fatal UTF-8 decoder; an incomplete character becomes a generic network failure and bypasses containment. Route decoder finalization failures through transport handling.
- RPC-Q003 (P2): an already-running forced-interruption callback can override a later transport failure after delayed termination. Fence settlement ownership.
- RPC-Q004 (P2): parser array accumulation loses earlier valid frames when a later coalesced frame is malformed. Dispatch completed frames independently of chunk segmentation; fence events after failure.
- RPC-Q005 (P2): actual terminal/startup outcomes still render raw codes or generic wording. Propagate only allowlisted structured transport evidence and render fixed oversized/malformed explanations, noting possible partial work and manual review before retry. No automatic replay or raw payload exposure.

These are in-scope corrections to the current candidate. Same implementation owner, followed by delta review with the same quality task. New registry findings use the IDs above and remain open until Lead explicitly closes them with verified evidence.

## Correction candidate — Apply Deep attempt 3

Lead reviewed /tmp/rpc-repro/review-corrections-report.md, the relevant production delta and the final648-pass log. Candidate preserves rejecting cleanup barriers for host ownership, finalizes UTF-8 decoding, fences interruption settlement, dispatches valid records before malformed successors and renders fixed allowlisted transport explanations. A local DriverStartupCleanupError contract retains a failed cleanup barrier when initialization cannot return a task handle. No payload/automatic replay is added.

RPC-Q001..005 remain open pending independent delta review by quality task-f512eb6f-eedd-4d83-9b80-152e7458f602. Candidate includes startup and cleanup failure propagation through core/host/web, with no limit change or live activation. Earlier passing counts are separate runs and must not be summed as unique coverage.

## Delta review — Quality attempt 2

Lead accepted closure of RPC-Q002..005 after the independent report (seq74224/74225):44 focused tests and four host/history/render probes corroborate EOF decoding, interruption precedence, ordered delivery and safe user explanations. Findings were explicitly resolved in the task ledger.

RPC-Q001 remains open only for Codex interruption escalation: a pending/already-running escalation callback can create a separate unhandled rejecting promise when termination fails during a transport failure. Observing the transport failure promise alone does not observe that callback. Review reproduced process exit1 despite correct task outcome/close rejection. Lead inspected driver fail()/interrupt() and accepted this remaining defect. OpenCode/Claude cleanup ownership and startup host-binding repairs passed the delta review.

Next same-owner correction is confined to escalation ownership/observation and its focused regression. Do not reopen verified fixes or run unrelated broad suites. No delivery or activation yet.

## Escalation correction candidate — Apply Deep attempt 4

Lead reviewed the two-file Codex delta and /tmp/rpc-repro/codex-escalation-q001/report.md (result seq75096/75097). Transport failure cancels pending escalation; an independently running escalation promise has its rejection observed. The shared termination barrier and repeated close() rejection remain intact. Exact-path graph coverage was not_tracked at the stale August generation; direct source is the evidence.

Owner evidence: four isolated subprocess regressions pass, including pending transport failure, already-running rejected/drained escalation and native interruption. Two failed before the correction. All22 focused tests and TypeScript checks pass; the four regressions overlap that count. A running escalation closes RPC, so the report does not claim a malformed frame can arrive through that closed connection afterward.

RPC-Q001 remains open pending the same quality owner's narrow verification. RPC-Q002..005 remain resolved. No canary activation or daemon restart is included.

## Final delta review — Quality attempt 3

Lead reviewed the complete independent report (seq75763/75764) against the previously reviewed two-file candidate and regression evidence. Quality independently passed22 focused tests, including all four isolated subprocess modes without an unhandledRejection listener, and confirmed the current files match the supplied snapshots and remained unchanged during review. Pending escalation cancellation, running callback rejection observation, original transport failure preservation, repeatedly rejecting cleanup barriers and single terminal settlement are verified. RPC-Q001 is explicitly resolved in the task ledger; RPC-Q002..005 remain resolved. No remaining blocking findings in the transport correction.

Delivery status: implementation and focused verification complete; local build/installation and live activation are pending. The finite16MiB capacity admits the reproduced oversized-message class across the corrected transports; larger messages still fail explicitly with safe explanations. Verification is synthetic, not evidence of live native producer behavior or a concurrent-session heap bound. Earlier broad and delta test counts overlap and are not cumulative coverage totals. No automatic retries, daemon restart or activation occurred. Git diff and shared panel-layout work remain paused in their separate change.

## Local canary installation

User requested compilation and reserved the daemon restart for themselves. `bun run canary:install` completed successfully and installed `/home/kevin15011/.local/bin/deck-canary`. The installed executable's `--version` command succeeded: version0.13.0, commit af82ffe, build date2026-10-23, target linux-x64, channel dev. The build includes the current uncommitted working tree; the embedded commit alone does not identify this correction. Installed SHA-256: `0d19f46684059a64f18adbee76049eb361ac6f94a8827c61a41cc8e4e7daa6ed`.

Compilation and installation are complete. Daemon restart and runtime activation verification remain pending; Lead did not restart it.
