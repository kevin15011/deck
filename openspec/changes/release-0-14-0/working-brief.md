# Release 0.14.0 preparation

## Intent and authority

The user requests commits for pending Review work and preparation for a new stable release. Proposed product version: 0.14.0, reflecting new functionality since v0.13.0. Root package metadata is authoritative. Follow docs/maintainers/releasing.md and the release-publish skill. Publication confirmation is requested only after a concrete verified candidate is prepared; no tag, push or publication has occurred.

## Progress

- Committed project Files browsing, safe media previews, pagination/reveal and folder Git colors as c5d5c54; original Review implementation is d9da30b.
- Updated package metadata and drafted CHANGELOG for 0.14.0, including earlier branch features and compatibility limits.
- Pinned Bun 1.3.12: descriptor/helper tests pass (64 tests), memory benchmark passes, compiled memory/runtime verification passes, host build dry run passes.
- Full suite is running; confirmed documentation-governance and Web Codebase-readiness failures are assigned to the existing implementation owner for meaningful repair. Logs: /tmp/deck-release-checks/.
- Canonical builds regenerated runner execution assets; retain generated provenance and review before committing release preparation.
- Independent release review covers latest folder status delta and native qualification requirements. GD-002 still requires Linux arm64 and Darwin x64/arm64 execution evidence; compiling target artifacts is not proof.

## Acceptance and pending work

Resolve confirmed release gate failures; rerun affected checks and full suite after repair. Complete typecheck, fresh retirement verification, generated freshness and compiled checkout-independence evidence. Review final version/changelog, working tree and descriptor contract; record commits and exact outcomes. Confirm publication only after required verification and a reviewable release candidate. Never restart the user's daemon automatically.

Release metadata committed as bccb51f. Initial typecheck found a too-narrow inferred Map key type in folder-status lookup; Lead widened the map key to string without changing behavior. Typecheck rerun is pending in /tmp/deck-release-checks/types-fixed.log. Full-suite run remains active; do not treat partial logs as final results.

## Gate repair acceptance and native qualification work

Deep attempt 13 (36110/36111) repaired explicit Codebase activation fixtures, guard HOME isolation and cleanup-command governance. Lead inspected the diffs, corrected the documentation backup placeholder and independently passed 38 governance/readiness tests (1102 assertions). Committed as 3bea506.

Quality attempt 8 (37037/37038) confirmed folder aggregation behavior and retained prior safety repairs, but requires native reader execution on all four architectures and extracted-artifact checkout-denial evidence before stable publication. Existing workflow architecture skips and version-only smoke are insufficient. Deep continues the same task to implement required native CI qualification and a nonpublishing validation route, run full suite to completion and run fresh retirement checks. No remote execution or publication has occurred.

GD-020 rename-source-folder presentation advisory is repaired locally: both source and destination ancestors reflect renames, while copy source ancestors remain neutral. Lead passed 13 UI tests (103 assertions). Included the Map key typing correction; committed as bd9beca. Generated runner execution assets remain pending final build/freshness review. Earlier incomplete full-suite output is not a pass.

Deep attempt 14 (44500/44501) delivered native four-platform release gates, manual nonpublishing dispatch and extracted-artifact checkout-read-denial verification. Lead inspected workflow and production diffs and admitted the candidate for independent Quality review. Linux x64 source/compiled qualification and all ten fresh-retirement suites pass. Latest complete suite: 8,375 passed, 11 skipped, 2 failed; both final fixture failures have targeted passing repairs, but no zero-exit full-suite run exists yet. Prior qualified artifact predates production repairs. Same owner continues full-suite confirmation and fresh final-artifact qualification; Quality reviews new workflow/confinement and production changes. Native Linux arm64 and Darwin x64/arm64 evidence remains required. No tag, push, publication or daemon restart occurred.

Quality attempt 9 (47309/47310) recommends proceeding to remote qualification: 99 independent tests/596 assertions passed, with no blocking implementation defect in workflow, confinement, digest caching, Claude opt-in or repaired fixtures. Lead accepts this bounded recommendation, not publication readiness. GD-021 is deferred test-coverage debt: the young-file fixture does not establish cache eviction; no production cache-bound defect was found. Do not expand this release round for that advisory. The closed acceptance list remains: completed zero-exit final suite, fresh final artifact qualification and native Linux arm64/Darwin x64/arm64 results. Existing owner attempt 15 is running local final validation; no new review or test round was launched by this outcome.

User explicitly stopped all work to disconnect internet. Lead cancelled active implementation attempt 15; no automatic continuation is authorized until the user resumes. Preserve existing commits and uncommitted changes. Release remains unpublished; final verification is incomplete.

## Resume and final local acceptance

User explicitly resumed release preparation and requested reconsideration of test-suite cost. Lead retrieved cancelled attempt 15 (53425/53426) and reviewed its completed evidence: tests-settled.log has 8,378 pass, 11 skip, zero failures and exit 0 (2,033.51 seconds). Typecheck, build and generated freshness exit successfully; 11 generated outputs are unchanged. Native Linux x64 qualification passed against final extracted artifact SHA-256 fa47ed58483b374004becc69b837e8ef39279fdcfd828356cc03dc9111088054. Compared current binary diff and untracked hashes to candidate-settled snapshot: only this progress document differs. No full-suite repetition is justified by documentation or commit-only changes.

Remote native Linux arm64 and Darwin x64/arm64 qualification is still required. Next external action is pushing the prepared branch and running nonpublishing CI, subject to the release skill confirmation gate; stable tagging/publication follows successful required CI and explicit authorization. No release has been published.

## Follow-up: test feedback cost

Keep test-policy redesign separate from the frozen 0.14.0 implementation. Existing final log identifies 70 tests over five seconds, including native runner launch/installation, real process timeout and recovery tests; raw test count alone is not sufficient prioritization. Proposed follow-up: inventory elapsed cost by suite; define fast unit/contract checks, isolated integration lanes and native release qualification; select relevant checks for local deltas, parallelize only isolated lanes, reuse artifacts by exact source/runtime identity, and run the complete gate once per settled release candidate. Fix unstable fixture isolation/timing before broad reruns. Preserve security and cross-platform coverage, and measure feedback-time improvements before changing required CI gates.

User explicitly authorized branch push and nonpublishing remote qualification. Branch fix/session-pending-issues was pushed successfully via personal SSH. Workflow dispatch failed with HTTP 403: active GitHub CLI account kevinlondono-gco has pull-only repository permissions (push/admin false). No workflow run was created. A repository-authorized GitHub login or manual dispatch is required. No stable tag or publication occurred.
