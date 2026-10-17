# Deck v0.12.0 release preparation

## Scope and authority
The user requested committing the Claude missing-repository fix and preparing publication of the accumulated web workspace changes. Root package.json selects 0.12.0. The release procedure is docs/maintainers/releasing.md and .github/workflows/release.yml. Publication requires a separate confirmation after preparation. No tag or push has occurred.

## Candidate
- Claude standalone missing-repository fix: ab27a38, independently reviewed with 71 passing tests.
- Integrated origin/main (including published 0.11.3 and the Pi type correction) through c00fe1f.
- Changelog covers notifications, questions, approvals, themes, progressive history, mobile behavior, trusted Tailscale access, Codex resume and Claude launch behavior.
- Updated stale smoke expectations to require relayed Claude approvals and a valid native Read tool name, preserving production validation.
- Regenerated tracked runner execution assets using isolated Bun 1.3.12, matching the release workflow. The user's global Bun 1.4.0 is unchanged.

## Verification in progress
- TypeScript passes after integrating main.
- Focused release descriptor, preparation and CLI session smoke: 68 passed.
- Memory benchmark and compiled Supermemory checks pass, including compile-only coverage for other architectures.
- Host linux-x64 release archive built; local descriptor validated with the host asset. CI owns the complete four-platform matrix and signed Darwin assets.
- OpenSpec canonical-supermemory-conversation-memory validation passes with zero errors/warnings.
- Full suite under Bun 1.3.12 is running; initial Bun 1.4.0 run was superseded.
- Copied executable/runtime/fixtures with temporary HOME: Landlock denies repository reads for the process and descendants. Memory operations pass against a local mock provider; compiled session/web verification is running. User-namespace isolation was unsuitable because UID remapping changes filesystem ownership trust checks; it is not product failure evidence.

## Delivery constraints
Main worktree contains pre-existing modified generated files and an untracked cache. Preserve those changes. No active daemon restart, real provider calls or configuration changes are required for release verification. Runtime rollout/cohort eligibility is not expanded by this code release.

## Final verification
- Release-gate discovery failures were caused by ambient user skills exhausting the discovery bound before fake runner inventory. Test-only child isolation preserves production validation and all assertions. Owner apply-fast task-1b48a320-8c60-46e3-aab3-a5da466b62f0; committed as d9e9f2b. Full affected file under ambient HOME: 72 passed, zero failures.
- Frozen-lockfile installation with Bun 1.3.12: 306 installs checked, no changes.
- Final full suite with isolated HOME and pinned Bun 1.3.12: **7,150 passed, 3 skipped, zero failed**, 47,788 assertions, 513 files, 1,350.25 seconds. Log: /tmp/deck-release-clean-tests.log. This supersedes interrupted ambient runs; skips are reported by the suite, not removed tests.
- TypeScript passes after the test isolation delta; diff check passes.
- Benchmark, compiled memory verification and OpenSpec validation passed. Runner asset regeneration is repeatable with no further tracked changes.
- Extracted linux-x64 artifact at 9c188ba passed 67 compiled web/session checks plus memory health/profile/search/capture/credential safety with Landlock denying reads from the checkout and user home to it and all descendants. Harness, runtime and fake runner fixture were copied outside the checkout; the negative file-open control passed. No real provider traffic. Subsequent changes affect tests and this evidence record only.
- Local descriptor matches the host archive checksum; the publication workflow must produce all four platform archives, combined checksums and release.json. Darwin execution/signing remains CI-owned.

## Ready for publication confirmation
All local verification gates passed. Final build metadata will be refreshed from this evidence commit before publication. Remote main at 77f358df04db8a5114c13fd6980fa7451f1f2ed6 is an ancestor of the candidate. Push the reviewed candidate to remote main by fast-forward, then create/push v0.12.0 only after the required new user confirmation; observe workflow and verify published assets. Preserve the dirty local main worktree. No tag, push, release publication or active user daemon restart has occurred.

## Published
The user explicitly confirmed publication in a new message. Remote main was fast-forwarded to 531e4b37ec774a1a2f215e703fa2381664ec1eed and annotated v0.12.0 was pushed at that same commit. Release workflow https://github.com/kevin15011/deck/actions/runs/39045725305 completed successfully, including all verification gates, four builds and publication.

Stable release: https://github.com/kevin15011/deck/releases/tag/v0.12.0 (published 2026-10-17T15:44:16Z; neither draft nor prerelease). Confirmed exactly four platform archives plus checksums.txt and release.json. All four descriptor hashes match combined checksums and GitHub asset digests. Downloaded Linux x64 archive SHA-256: fbd10c111a54df3a70908fe738acef9568192da5653855a00d221a2675c04edf. Extracted published executable reports version 0.12.0, commit 531e4b3 and stable channel; version and help succeed with temporary HOME and Landlock denying checkout reads. No active user daemon restart or global binary replacement was performed. Initial transient SSH/API connection timeouts were resolved without changing persistent transport configuration. Publication is complete.
