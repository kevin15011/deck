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
