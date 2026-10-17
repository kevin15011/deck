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
