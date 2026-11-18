# S8c read-only Git Changes verification

Status: bounded S8c accepted at integration255057 and installed as9658968d on2026-11-12T03:28:47Z. The startup correction is retained. No user host was restarted. S1-Q07 and ordinary-workflow parity remain open.

## Candidate and behavior

- Candidate: `d096872c866cc2ea84ac7d52e2bb642d77d2f321b7957de06b109853d03cf148`.
- Binary: `9658968df8429ecb6c960afcf9c3b0250189c9bdc5f751b370ffdc6dff942f77`.
- [Frozen manifest](../../target/review-s8c-d096872c/candidate.json), [complete handoff](../../target/review-s8c-d096872c/handoff.json), [Lead review](../../target/lead-s8c-d096872c/review.json).

The Review tab lists staged HEAD-to-index, unstaged raw index-to-worktree and untracked additions. It supports explicit refresh, file selection, inline/side-by-side desktop comparison and inline mobile comparison. Bounded live snapshots are separate from immutable edit evidence. The view performs no stage, reset, commit or project-file write.

Lead matched all170 inputs,22 assets and current/frozen binaries before and after checks. The full-gate candidate90f35187 differs only in the frontend counter label: replacing `entries` with `changes` exactly reproduces that earlier file hash. Rust/build/shared/API inputs match. Required Rust/format/Clippy evidence is reused; current frontend/type/package checks were rerun by the implementation owner. No whole suite or real provider was repeated merely for review.

## Verification evidence

Commands come from Cargo manifests, package.json, scripts/build.sh, the S8c working brief and the packaged browser fixture. Lead records are in [checks.json](../../target/lead-s8c-d096872c/checks.json).

| Check | Owner and result | Elapsed |
|---|---|---:|
| Formatting and Clippy | Production, pass on90f35187; exact unchanged source reused | 1.271s / 8.191s |
| Full Rust workspace | Production,169 passed /0 failed /7 ignored, retained evidence | 76.838s |
| Current frontend suite | Production,20 passed /0 failed /132 assertions | 0.162s |
| Current typecheck/package | Production,pass; package log retained | about133s, estimated |
| `cargo test --locked -p deck2 --lib git_review::tests -- --nocapture` | Lead protected replay,10 passed | 7.803s including preparation |
| `cargo test --locked -p deck2 --lib auth_release -- --nocapture` | Lead protected replay,4 passed | 0.417s |
| `node scripts/s8c-browser-acceptance.cjs target/review-s8c-d096872c/deck2` | Lead exact-package browser,pass | 15.035s |

The handoff says six ignored tests; complete workspace logs show six unit plus one integration test ignored, seven total. No test was retired or newly disabled by this change. Full-gate records/logs and current package evidence are retained under the frozen evidence directory.

Protected replay covers actual temporary Git fixtures, exact comparison bases, missing files, unsupported layouts, path/helper sentinels, resource limits, stale/session/auth routes and uncertain process cleanup retaining private resources/exclusion. The separate auth correction explicitly unlocks only an already-settled reservation, so an incidental forked descriptor cannot prolong its flock; existing active/store/runner ownership checks remain. The recorded cloned-descriptor predecessor failed before repair. This is distinct from the unresolved WSL automatic-opening finding.

The browser used synthetic data and a fake native runner, with zero model dispatch. It verified index/worktree non-mutation, inert HTML, stale and delayed replies, refresh/error recovery, selected-file retention, drafts/images across reload/session navigation, visible-tab keyboard wrapping, reduced motion and mobile layout. Observed automated typing p95 was30.94ms; this is a fixture observation, not a general performance guarantee. No compilation ran during that measurement. Owned browser/host were stopped.

## Visible support limits

Only Linux local normal SHA-1 repositories with a local `.git` directory are qualified. Shared/linked/shallow worktrees, conflicts, symlinks, submodules, sparse or SHA-256 metadata and non-UTF-8 paths/content are unsupported or explicitly unavailable. Renames display as add/delete pairs. Filters/line-ending conversions and global/info excludes are not applied; local `.gitignore` rules are bounded.

The reader copies recognized metadata into an owned private repository and invokes fixed `/usr/bin/git` with a cleared environment. It bounds metadata256MiB/20,000 entries, tracked files4,096, scanned worktree entries16,384, depth64, tracked baseline64MiB, individual content256KiB, retained comparisons8MiB, catalog256entries, diff output512KiB and rendered lines2,000. Capture has a30s deadline; comparisons3s; Git address space512MiB. A refresh is an observed snapshot, not an atomic project-wide transaction. Changed or stale observations require retry.

The owner's separate read of the selected source repository reported55 entries,21 explicitly unavailable, and12.267s capture time with index unchanged. Lead reviewed that evidence but did not repeat the private-source read. It must not be reported as55 confirmed modifications or as full repository support.

## Visual and remaining scope

Lead inspected [desktop](../../target/lead-s8c-d096872c/browser/desktop-dark-split.png) and [mobile](../../target/lead-s8c-d096872c/browser/mobile-light-inline.png) captures and compared the desktop component with the frozen source-projected original. This was not a live private session or full-shell pixel comparison. The flat section/file list differs from original folder disclosure/icon/count navigation; the existing theme/font shell and monospace red/green hunk presentation are retained.

Files browsing, committed branch comparisons, branch beside the session title and full panel parity remain pending. This candidate does not implement the [ordinary-session integration](../../openspec/changes/deck-recreation/ordinary-session-brief.md) or close the [P01–P19 inventory](../migration-parity.md).

## Acceptance and installation

Quality31 independently rematched170 inputs,22 assets and binary9658968d and found no new material defect in the bounded review. Its attempted cleanup test exited101 before assertions because temporary-file creation was denied; this is not a runtime pass. Lead's recorded10 Git/4 auth tests and exact-package browser replay above satisfy the requested independent verification, including uncertain cleanup. Full report SHA256: `03dc10d0e333e14a909e9f08385d1a060c8928610846ac63805394cddc2c6ad9`; result254750/ended254751. Integration255057 accepts this scope, with S1-Q07 and the listed product gaps unchanged.

Lead atomically replaced only `/home/kevin15011/.local/bin/deck2` at2026-11-12T03:28:47Z, retaining the previous a6205298 executable under `target/installed-backups`. Installed hash, version and help checks passed. API7/host schema10/service schema3 remain unchanged. See [installation receipt](../../target/deck2-s8c-install-evidence.json). No personal tool, user state or running host was changed; an existing host loads the new executable on its next restart. The same production owner now proceeds to the ordinary-session correction; installation is not closure of full S8 or migration parity.
