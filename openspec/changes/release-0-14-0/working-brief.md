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
