# Session recovery after divergent canary and stable histories

## Intent and authority

The user authorized integrating current remote main with all uncommitted work, preserving that work, and building a compatible canary to restore the web session named `Bakcground tasks` (`20261018T000442-486471`). Lead owns live daemon activation and this record. No commits or pushes are requested.

## Evidence and acceptance

The original checkout was `6ea6674` (0.11.2); remote main was `2ceacd8` (0.12.0). The installed stable daemon rejected the target history at sequence 34792 (`task.delivery`, unknown kind). The older canary rejected events in other stable histories. The missing session remains on disk; recovery must preserve events rather than filter unsupported kinds.

Acceptance: preserve modified and untracked work; integrate both contracts; validate and replay copies of all nine persisted histories without anomalies; pass affected tests and type checking; build the canonical canary; activate only after live work and approvals settle, with a state backup; confirm the target and current session remain listed.

## Progress

- Owner: apply-deep, task `task-612969d4-1485-4e03-8554-a81ab4e29107`.
- The owner reports a backup of 52 modified/untracked files, index, patches, HEAD and status, and a retained stash before fast-forwarding main by 61 commits.
- Candidate validation and replay succeeded for nine copied histories, including 34,866 target events; integration tests are in progress.
- Activation script is prepared outside the repository, but has not been armed or executed. It checks daemon identity, waits for idle, verifies candidate digest, stops gracefully, backs up state, starts the candidate and checks required session IDs.

## Risks and boundaries

This session itself depends on the live daemon. Activation must occur after this turn completes, and final reporting must distinguish scheduled activation from confirmed recovery. No force stop, history rewrite, stash deletion, destructive Git command, or automatic downgrade is authorized by this plan. Restored session visibility does not prove native model continuation has succeeded.

## Integration verification

The implementation owner completed the fast-forward to `2ceacd8` and resolved 21 conflicts. Backup: `/Users/kevinlondono/deck-integration-backups/20261019T052605Z`; retained stash: `09219230e3810903d5b96128de6ca03155912fa9`. No commits or pushes were made. The adjacent `integration-report.json` contains exact commands and evidence paths.

- Affected suites: 1,080 passed, one optional build smoke skipped; actual canary compilation/install subsequently passed.
- Final snapshot-version delta: 30 ledger tests passed. Snapshot v11 rebuilds stale v10 projections without rewriting event history.
- Final TypeScript check passed.
- Nine copied histories, 45,857 events: zero validator errors or ledger anomalies; event bytes unchanged; cached load equals full replay.
- Isolated production composition lists and serves the target and current session, including chat pages.
- Signed installed canary: 0.12.0, commit `2ceacd8`, dev channel, including uncommitted work; SHA256 `e3db7aea25a0a3768d8089a0e862aafbc9ecf74f387a10d12660e95a185deba6`.

Independent quality task `task-d408e88c-919d-4f6e-a5af-57eea87d4ebd` confirmed source readiness, all 52 backup files matching the retained stash, all 19 originally untracked files byte-identical, and independent replay. Two activation-script findings were corrected: no automatic fallback to stable, and exact-connection identity validation before canonical shutdown plus start-outcome/identity/digest verification. Delta review pending. Live activation has not occurred.

## Cutover scheduling

Quality delta review passed with no material blockers. The detached activation watcher is scheduled and confirmed running, waiting for this turn to finish and the daemon to become idle. This is not confirmation of activation. Runtime outcome will be written to `/var/folders/tn/z_26gcr948v50zmhpkp4pr2w0000gn/T/deck-session-recovery-by_oqa78/result.json`; log: `/var/folders/tn/z_26gcr948v50zmhpkp4pr2w0000gn/T/deck-session-recovery-by_oqa78/activation.log`. The script verifies visibility of target, current, and October 17 sessions after startup. Native model continuation remains untested.

## Confirmed activation

Activation completed at 2026-10-19T05:37:29Z. The watcher confirmed candidate startup and required sessions; Lead independently queried live daemon status and session list afterward. Daemon PID 91841, nonce `d6c6153e-23ff-47cf-8dd2-9121fe863ae0`, version 0.12.0. The target `20261018T000442-486471` is listed as recovered, and the current session remains active. State backup: `/Users/kevinlondono/.local/state/deck-backups/before-main-recovery-20261019T003728`. Live browser rendering and a new native turn in the target session have not been exercised. Integration, build, activation, and server-side session visibility are complete.
