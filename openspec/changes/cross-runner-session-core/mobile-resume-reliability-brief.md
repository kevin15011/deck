# Mobile resume and background notification reliability

Status: client repair independently reviewed and canary installed; full gate has a timing failure; daemon activation and phone diagnosis pending, 2026-11-02 UTC.

## Intent
Resolve the user's recurring mobile failures after switching apps and returning to Deck: `Failed to fetch`, `Connection timed out. Retrying…`, prolonged reconnecting, and background notifications apparently stopping until Deck is reopened. Screenshots are evidence of the connection symptoms; conversation contents are outside scope.

## Acceptance
- Recover from suspended connections and requests on mobile resume without losing drafts or disturbing the historical reading window.
- Fence stale asynchronous work and avoid reconnect churn from duplicate lifecycle hints.
- Distinguish transient connection recovery from persistent actionable failures.
- Trace actual background push delivery and suppression; fix reproduced defects without claiming physical-device/provider delivery from simulated tests.
- Preserve notification opt-in, revocation, privacy, attention identity and existing runtime boundaries.

## Evidence and routing
Initial worktree is clean. The graph project is `deck`, generation `2026-08-20T17:25:00Z`; relevant web paths are untracked in freshness metadata, so current source fallback is required. Existing push and continuity briefs remain authoritative context.

Read-only investigation owner: `investigate`, task `task-ff19f644-2373-49fb-a67c-9617d232118b`. Lead owns OpenSpec updates. Implementation and proportional regression verification follow the reproduced cause; independent review is required for material push/protocol changes.

## Investigation adoption and implementation
Investigation attempt 1 (result 1360, ended 1361) reviewed against current resume/deadline source and push delivery gate. An apparently open socket or pending hydration survives resume without liveness validation; this is a code-supported failure mode pending regression reproduction, not proof of the phone incident. Push uses a separate provider/service-worker path; current acknowledgment gating bounds unseen-event deferral, so no speculative push rewrite is accepted.

Implementation owner: `apply-fast`, task `task-dc46192d-8cc2-41c3-8f5c-9f9e6e970ee6`. Scope is genuine foreground-transition recovery, lifecycle hint coalescing, stale callback fencing, preserved reading/draft state and meaningful transient-error handling. Require red-first lifecycle regressions, relevant existing fake-provider checks and bounded browser acceptance. Ordinary focus changes must not churn healthy connections. Physical-device/provider delivery remains unverified.

Attempt 1 (result 2436, ended 2437) is an incomplete candidate, not verified: eight existing unit tests pass, but lifecycle browser setup failed before the target scenario and the final edit postdated typechecking. Same owner continues with isolated behavioral lifecycle coverage and final-candidate checks. No installation or user-device fix is claimed.

Attempt 2 (result 3554, ended 3555) reports isolated actual-hook browser red/green coverage for stale open/connecting sockets, stalled hydration, lifecycle hints and stale callbacks. Lead inspected source and fixture; real scroll-anchor preservation and fake-provider acknowledgment behavior are still missing. Same owner attempt 3 completes those tests. Independent read-only runtime review: `quality`, task `task-7bb7d5e7-7478-4ce3-acc9-1f2e35c5f415`. Source acceptance and installation remain pending; actual phone/provider delivery is not inferred from browser simulation.

Attempt 3 (result 4879, ended 4880) reports green actual-hook browser checks including a 40-row reading anchor, scroll position and draft preservation, with no further runtime edits. Added hermetic push service regression proves unseen attention proceeds after the acknowledgment deadline while acknowledged attention suppresses. Lead inspected that test and independently reran the two focused suites: 9 passed in 1.06s. Owner reports final types and diff checks passed. Runtime SHA-256: `096effe926b750302fddb947ed43ceb03040fcb609f7159707d4dde1a47ef87e`; fixture: `c4d775a84616be49eb8dcae0ee8efad8362d7942609c5cf13de5c445ed3f98fc`; push regression: `14cd8e578aca50008132348af62ecde3a4d8e1aa2af25b1157239c9aa98bdf68`. Independent review remains running. No push runtime change or real-device delivery verification.

Quality attempt 1 (result 5387, ended 5388) reproduced a blocking pagination race: resume fences connection callbacks immediately, but pagination remains active until the deferred connect. A pending `around(99)` can replace the historical window before that timer executes. Lead accepted the finding after source review; same Apply owner attempt 4 must synchronously abort/detach pagination and reset pending/loading state with an ordering regression. Six other independent lifecycle/failure scenarios passed. Fixed-height fixture evidence does not establish production scroll-anchor restoration; physical-device/provider delivery remains unverified. No installation.

Apply attempt 4 failed at runner startup (`codex-mcp-server-not-connected`, ended 5752), without an implementation report. Same logical task and owner retry the bounded pagination repair. Earlier review blocker remains unresolved; no newer verification is claimed.

Apply attempt 5 (result 6771, ended 6772) repairs immediate pagination cancellation/detachment and pending/loading reset. Lead verified exact source and fixture hashes: runtime `e13a984e6b6852a1337d8104fd811b986c80d63267a8df1d9d41a6fcd520b6d5`, fixture `1a7794a2208b1e18f6973b9a2d8184eb53d8cdfd378f7263a0b4a1d9eba15e40`. Owner reports red-first pagination regression, then green lifecycle browser, focused nine tests, types and diff checks. Same Quality task attempt 2 independently rechecks the original race before acceptance. Lead final full suite and types launched; logs `/tmp/deck-mobile-resume-full-test.log` and `/tmp/deck-mobile-resume-types.log`. Prior partial-candidate acceptance is superseded; installation remains pending.

## Final bounded review and verification
Quality attempt 2 (result 7625, ended 7626) independently reproduced the previous race in memory and passed five repaired cases: late success, rejection, timeout rejection, queued latest and old cleanup while newer pagination owns loading. Lead reviewed the report and matching before/after source hashes; the documented P2 pagination finding is resolved. No remaining findings in the bounded client review.

The initial Lead full/type processes had no recoverable exit result after turn release; empty or partial logs are not passes. Repeated final checks on unchanged runtime/test inputs:

- `bunx tsc --noEmit`: exit 0, no errors.
- `git diff --check`: exit 0.
- `bun run test`: exit 1, 512/512 files, 4811 passed, one failed, no skipped, 86.09 seconds. The failure is `benchmarks/memory-live/supervision.test.ts` / `attached supervisor process and authority boundaries`: its Python subprocess exceeded the local 1500ms limit. Log: `/tmp/deck-mobile-resume-full-test-final.log`.
- `bun test benchmarks/memory-live/supervision.test.ts`: isolated diagnostic recheck exit 0, five passed in 3.35 seconds; failing case completed in 762.40ms. Log: `/tmp/deck-mobile-resume-supervision-recheck.log`. This is evidence of timing sensitivity, not a passing full gate or a pre-existing ledger exemption.

Candidate captured during final checks: `6bf3b6cff5f9cad0a45989b0f94acf86378b7618:58e4c1060c634e748adc36da989580b738e37a02`. Only this subsequent evidence documentation changes that tree; runtime, browser fixture and push regression hashes remain identical to the verified inputs. Test command sources: AGENTS.md, CONTRIBUTING.md and package.json; current scripts/test.ts enforces the 120-second run budget.

The client repair is complete in source and independently reviewed, but the full gate is not green. No commit, installation, restart or phone/provider delivery claim. Production scroll-anchor restoration is outside the fixed-height fixture's proof. Background notification root cause on the user's phone remains unconfirmed; current fake-provider regression verifies bounded acknowledgment deferral without a push runtime rewrite.

## User-requested canary build
On 2026-11-02 UTC the user requested compilation of the canary. `bun run canary:install` exited 0, rebuilt the web bundle and linux-x64 binary, and installed `/home/kevin15011/.local/bin/deck-canary`. Lead smoke checks `deck-canary --version` and `deck-canary --help` exited 0; version reports 0.14.0, commit 6bf3b6c, build date 2026-11-02, channel dev. This supersedes the earlier no-installation status. The existing daemon was not restarted, no commit was made, and full-suite timing failure/phone-delivery limitations remain disclosed.

## Commit checkpoint
The user reported restarting the daemon and asked about commits. This confirms restart, not phone-delivery success. Runtime, browser fixture and push test hashes still match the reviewed candidate, so prior focused/browser/TypeScript evidence is reused.

Precommit `bun run test` completed 512/512 files in 74.73s: 4811 passed, one failed, zero skipped. The prior supervision case passed; this run timed out at 5000ms in `benchmarks/memory-live/shared-account.test.ts` / `cleanup deletion needs recorded writes or a complete absent-at-start preflight receipt`. Log: `/tmp/deck-mobile-resume-precommit.log`. A targeted isolated rerun of that exact case passed in 2.35s (one passed, zero failed). This diagnostic does not turn the full gate green or establish a baseline-ledger exemption. No benchmark source, timeout or quarantine was changed. Commit records the reviewed mobile fix and tests with this unresolved repository-wide verification limitation; full lifecycle closure and confirmed phone notification diagnosis remain pending.

## Constraints
No daemon restart, deployment, live subscription mutation, test push, commit or unrelated readiness repair is authorized by this diagnostic work. No claim that mobile operating systems preserve an open foreground transport in background. Real-device confirmation remains separate from simulated lifecycle checks.
