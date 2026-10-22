# Continuity implementation progress

## Authority and current scope

User approved design and implementation on 2026-10-22 with four amendments now reflected in acceptance.md/design.md. This supersedes prior design-only status; historical lifecycle entries are preserved.

- Operator-interrupted/cancelled active attempts can qualify for automatic native resume under the same limits, with explicit provenance and settled ownership. Failures and queued-only cancellation remain fresh.
- Lead explicitly resolves/reopens identified findings with evidence, optionally at integration; no implicit closure. Only open findings enter the handoff.
- No new reviewer tool or first-finding metric. Reviews retain their normal reports and are measured through completion.
- Approved160000 configured ceiling is further limited below the verified runner/model/config native compaction boundary. Unknown means fresh.

## Ownership

- Implementation: apply-deep `task-9fd1215b-b617-48f7-bf0c-2396f251751a`, attempt 1, complete vertical production/test slice.
- Native-bound evidence: architect `task-0830556f-c081-4a66-87f0-5a86986980fa`, attempt 2, read-only; official result will be recorded in compaction-bounds.md after Lead review.
- Lead owns OpenSpec and integration/review. No native path may be called verified based on an unreviewed report.

## Current evidence

Direct host read confirms explicit Lead stop currently uses `deck_task_cancel` and may finish as `cancelled`; user interrupt uses `turn.interrupt`. Terminal state alone does not encode trusted stop origin. Implementation must persist provenance rather than relax all cancelled/interrupted states.

Implementation attempt 1 has returned a candidate; the review outcome and required delta are recorded below. No build/install/restart has been requested from the implementation owner. Steering remains separately parked.

## Native-bound research reviewed

Architect attempt2 (result/end51091/51092) reviewed against tagged Codex source and installed Claude/OpenCode snippets. Official compaction-bounds.md now distinguishes verified formulas from still-unverified runtime observations. Lead additionally recovered OpenCode's exact capped-output function: the standard200k-context/128k-output example defaults to168k with Q32k, not72k. Claude's100k auto-window example gives a67k conditional threshold. Codex needs effective model/config and optional post-turn limits, not only a window counter.

The suggested fixed8192 slack is not accepted as proof of a cross-runner bound. Every enabled native path requires verified accounting/config evidence; unavailable evidence forces fresh. Implementation owner was instructed at delegation to reread compaction-bounds.md before enabling paths and before final verification. Publication does not prove the owner has consumed or implemented these findings. Production implementation remains running, with no candidate completion or latency result claimed.

## Candidate attempt 1: changes requested

Original result/end events: 53038/53039. Lead retrieved the report and reviewed the policy/request-input modules, launch selection, bounded handoff/projection, CLI composition and terminal callback guards. Graph generation 2026-08-20T17:25:00Z did not track these paths; direct source was used. Original handoff: `/tmp/delegated-continuity-implementation.md`.

The candidate implements structured acceptance/findings, fresh handoffs, task edit attribution, launch-time selection, replay and offline metrics. Lead inspected the recorded successful test summaries: 386 host tests, 477 contract/adapter/CLI tests and 49 affected contract checks; the reported final typecheck log has no diagnostics. These checks are evidence, not independent acceptance of all behavior.

**F-001 (open, blocking): terminal event rejected by its own fence.** In `session-manager.ts`, `io.emit` sets `nativeEnded` before calling `driverEvent` for `turn.completed` and `claude-steering-ended`. The newly broadened `driverEvent` guard then rejects the legitimate boundary. The same implementation owner is continuing as attempt 2 to add a failing regression, preserve each boundary exactly once, and retain stale callback protection. Attempt 1 was recorded as blocked by Lead integration command `continuity-impl-a1-review-terminal-fence` (event 53286). Independent quality review follows the corrected functional candidate.

Production native reuse is not enabled for any runner: CLI supplies no verified compaction-bound resolver. Native branches currently have fixture evidence only. Unknown bounds correctly select fresh, but native eligibility and interrupted native reuse are not yet verified production behavior. No live before/after performance comparison or activation has occurred. Runtime-bound enablement remains unfinished; do not mark all acceptance criteria complete.

## Candidate attempt 2: F-001 resolved; independent review started

Lead reviewed original result/end 53945/53946, current `io.emit`/`driverEvent` source and the new regression assertions. Admission validates ownership/native identity, closes the native-ended latch before synchronous append subscribers, and returns explicit success. The first boundary reaches consumers; reentrant/late callbacks remain fenced. Host finalization still waits for outcome/drain. F-001 is resolved by Lead integration `continuity-a2-boundary-fix-reviewed` (event 54075); this is not whole-candidate or release approval.

Inspected evidence: `41-boundary-red.log` reproduces four failures; `45-boundary-host-regressions.log` has 55 passing tests; `46-boundary-consumers.log` has 27 passing tests; final typecheck log `47-boundary-typecheck.log` has no diagnostics. Files are under `/tmp/delegated-continuity-logs/`. Source coverage for manager and both changed test files is untracked in the graph; direct source supplied the evidence.

Independent review for this new continuity area: quality `task-50b2cdbf-317f-4827-9e27-7282c779b0b8`, attempt 1. Scope includes lifecycle/permission/replay, structured finding state, handoff/attribution budgets, request evidence, metrics and remaining production native eligibility gaps. Implementation owner remains unchanged. No production activation or measured speed improvement is claimed.

## Independent review attempt 1: changes requested

Lead reviewed original result/end 54870/54871, `/tmp/delegated-continuity-quality.md`, current affected source and the four failing focused reproduction logs. Review accepted as evidence in integration `continuity-quality-a1-findings-reviewed` (54998), not as candidate approval. Same implementation owner continues as attempt 3; same quality owner will review the resulting deltas.

| ID | Priority | State | Required correction |
| --- | --- | --- | --- |
| F-002 | P1 | Open | Restore bounded prior user request/result in Lead missing-native recovery; current-only prompt regresses protected Lead continuity. |
| F-003 | P2 | Open | Preserve substantive predecessor report, integration and retrieval identity across the separately accounted failed native-resume attempt. |
| F-004 | P2 | Open | Fence Codex tool edit attribution and policy-input mutation by matching active native thread and turn, including missing-identity rejection. |
| F-005 | P2 | Open | Mark metrics totals incomplete when request usage is missing; retain observed lower bounds and allow correlated later reconciliation. |
| A-001 | Advisory | Open | Distinguish aggregate edit artifact capture attempt from actual source attempts. |

Reproductions are retained under `/tmp/delegated-continuity-quality-{repro,attribution,metrics}.test.ts` with corresponding logs. F-001 remains resolved. Runtime native-bound availability is unchanged: production defaults to fresh for all runners. Review confirmed this is the approved unknown-evidence fallback, while automatic/override native behavior remains unavailable and acceptance incomplete. No activation or live improvement claim.

## Implementation attempt 3: corrective candidate awaiting re-review

Lead retrieved result/end 56178/56179 and reviewed bounded Lead recovery, persisted substantive-predecessor identity, Codex attribution admission, request-coverage metrics and capture/source manifest changes. Integration `continuity-a3-quality-delta-reviewed` (56302) accepts the candidate for independent verification, not release or official finding closure. F-002 through F-005 and A-001 remain pending verification.

The four original independent reproductions pass unchanged (`63-reviewer-fixtures-green.log`); affected ledger/metrics checks have 43 passes (`60-ledger-metrics-final.log`); final typecheck has no diagnostics (`72-corrective-typecheck-final.log`). Full commands and intermediate failed checks with their focused corrections are retained in `/tmp/delegated-continuity-implementation.md`; no claim is made that those intermediate suite runs were entirely green.

Lead recovery now retains bounded attributed history through append/replay projection (snapshot version 14). Delegated recovery carries an explicit substantive attempt reference. Metrics distinguish observed lower bounds from complete request totals and can reconcile delayed usage. All production native paths remain fresh-only; no runtime-bound or performance acceptance is newly established.

Same quality task `task-50b2cdbf-317f-4827-9e27-7282c779b0b8` is continuing as attempt 2 for focused verification of these corrections and their regressions. Implementation ownership is unchanged. No build/install/restart performed.

## Quality attempt 2: original findings resolved, metrics delta remains

Lead reviewed result/end 56891/56892, updated independent report, current prefix/coverage source and focused reproduction evidence. Integration `continuity-quality-a2-prefix-reviewed` (57016) accepts the findings. Lead now records **F-002, F-003, F-004, F-005 and A-001 resolved** based on implementation attempt 3 and independent verification; F-001 remains resolved. The original four probes pass unchanged, and both focused Codex attribution tests pass. This supersedes their open rows above while preserving historical review state.

**F-006 (P2, open):** first-edit acquisition metrics omit the edit's identified request when its usage arrives after the edit and no prior request observation exists. The smaller prefix is incorrectly labeled complete/request-aligned. Reproduction: r1 input10, edit naming r2, then r2 input20 gives one step/input10 instead of two/input30. The edit must establish membership at its boundary; missing usage stays partial until reconciled, and unrelated later requests remain excluded.

**A-002 (advisory, open):** attempt-wide uncertainty from post-edit compaction invalidates an already complete earlier prefix. This is conservative loss of precision, not an additional blocker. A localized sequence-scoped uncertainty correction is included with F-006.

Same implementation owner continues as attempt 4, limited to metrics and relevant tests. Evidence probes: `/tmp/delegated-continuity-quality-prefix.test.ts` and corresponding log (two failing assertions for F-006/A-002). Subsequent review is limited to that delta. Production native runtime gates and activation status remain unchanged.

## Implementation attempt 4: narrow metrics candidate reviewed

Lead retrieved result/end 57554/57555 and reviewed first-edit membership and sequence-scoped uncertainty source. Integration `continuity-a4-prefix-delta-reviewed` (57662) accepts the correction for independent recheck; F-006/A-002 remain pending closure. The first edit now establishes its identified request at the cutoff, delayed usage reconciles it, and missing usage keeps totals partial. Later uncertainty does not invalidate an earlier complete prefix.

Inspected logs75/76 show 25 passing metrics tests and both unchanged independent prefix probes passing. Scope log79 reports exactly the metrics module and its test changed among 40 reviewed candidate paths. Final typecheck log77 is reported clean. The same quality owner continues as attempt 3, limited to this delta; earlier accepted closures remain intact. No production activation, native runtime-bound verification or measured performance improvement is claimed.

## Quality attempt 3 accepted: candidate findings closed

Lead reviewed result/end 57986/57987, final report and independent logs (two original probes and 17 focused cases pass). Integration `continuity-quality-a3-final-delta-reviewed` (58118) records acceptance. **F-006 and A-002 are resolved**; F-001–F-005 and A-001 remain resolved. No current review finding remains in the implemented fresh-default candidate. This does not establish production native support or whole-change completion.

The implementation and independent review retain stable owners. No more unchanged metrics review is needed. Native-bound research resumes with the existing architect task `task-0830556f-c081-4a66-87f0-5a86986980fa`, attempt 3: a bounded source-to-runtime proof for one exact runner/version/model/configuration lane, or a precise missing-contract conclusion. The existing conditional formulas must not be rediscovered or treated as runtime proof. No inference calls, live-session changes, build/install/restart or activation are included. Verified native enablement and live comparison remain open acceptance items.

## Native lane outcome reviewed

Architect result/end58786/58787 reviewed against tagged native source; integration `continuity-native-lane-a3-reviewed` accepts the missing-accounting conclusion, not the proposed internal-file resolver. Effective trigger observation is insufficient to prove next-resume counted context from last-request input. No supported complete contract was established. Details and the unverified proposed SQLite/rollout alternative are recorded in compaction-bounds.md section6.

No implementation/review defect remains in the current fresh-default candidate. Native auto/override reuse remains unavailable; therefore full original acceptance is not claimed. Further internal native-history parsing is a material implementation-scope choice, not an automatic consequence of the research. No new delegate or production change is launched for that alternative. Current code has not been activated and no measured performance improvement is claimed.

## User accepts first-delivery limitation and authorizes delivery refinements

The user explicitly accepted fresh Codex/OpenCode, excluded internal Codex DB/history reads, and permitted fresh Claude if founded doubts remain. Lead disclosed Claude's unresolved effective threshold/precompute/input-bound evidence; therefore all three runners remain fresh for first delivery. P-015 records deferred Codex native support. This supersedes the earlier pending scope decision and native-enablement completion prerequisite; no native parser investigation continues.

The user additionally requires interruption/no-final-report labeling, bounded last agent message, attributed edited files and current instruction, plus an instruction to verify current file state before continuing. Separate interruption cohort frequency and first-edit steps/tokens will guide prioritization of P-014 steering if costly. No numerical threshold or steering implementation is added.

Same implementation owner `task-9fd1215b-b617-48f7-bf0c-2396f251751a` continues as attempt 5 for this bounded delivery delta. Acceptance/design/tasks amended before delegation. All previous review findings remain resolved; new requirements require targeted evidence before delivery. No activation yet.

## Delivery candidate attempt 5 reviewed

Lead reviewed result/end60172/60173, source for trusted stop classification, bounded public-message projection, mandatory interrupted/no-final-report/file-inspection handoff and cohort denominators. Integration `continuity-a5-delivery-delta-reviewed` (60309) accepts the new candidate for independent verification. Evidence inspected: 81 projection/replay tests,14 host regressions,11 handoff tests passing; final typecheck log94 reported clean. Snapshot version15 rebuilds older projections to retain available public streaming evidence; no downgrade guarantee.

Handoffs explicitly retain partial public text or unavailable status, task-attributed file references and the current instruction; they require checking current file state before continuing. The instruction is a requirement supplied to the agent, not proof that a future agent has performed the inspection. Metrics include pending admissions and no-edit samples with explicit provenance, denominator and partial/censored semantics. No measured production cost result yet.

Same reviewer `task-50b2cdbf-317f-4827-9e27-7282c779b0b8` continues as attempt4 for this delivery delta only. Fresh-all is accepted first-delivery scope, not a blocker; Codex internal histories/databases remain excluded. Earlier findings remain closed. Delivery/activation awaits this focused check.

## Delivery accepted and canary installed

Quality attempt4 result/end60922/60923 accepted by Lead integration `continuity-quality-a4-delivery-accepted` (61066). All31 focused independent checks pass; no remaining delivery findings. Official verify-report.md/review-report.md summarize evidence and accepted limits. Reviewed production/test hashes matched before commit.

Implementation committed as c1e88ea; canonical canary build/install completed exit0 and installed identity verified. The daemon still reports its previous digest with running work, so activation is pending and explicitly distinguished from installation in delivery.md. No forced restart, provider benchmark or native-history reader was introduced. Existing unrelated dirty activation notes and .bun-cache were preserved outside this commit.
