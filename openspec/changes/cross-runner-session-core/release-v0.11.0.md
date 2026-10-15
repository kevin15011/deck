# Deck v0.11.0 release

Status: preparing publication, 2026-10-15. Lead owns this record.

The user explicitly authorized the new release/deployment after reviewing the committed candidate and repository-independence evidence. This is the new-message publication confirmation required by the release skill. The latest published stable release is v0.10.0; v0.11.0 is the next minor release for the new cross-runner workspace. Root package metadata and the dated changelog now agree on 0.11.0, retaining an empty Unreleased heading for future work.

Source starts from a3fd8bd (runtime/UI 6aabf0b plus release-preparation documentation). The branch contains 41 commits beyond origin/main with no remote-only divergence. Earlier Pi supervision/materialization, account validation and Claude blocked-plan fixes are included and explicitly represented in the changelog. Independent bounded release review found no outstanding blocker in these earlier changes; their prior native/focused evidence supplements the full suite.

Fresh baseline gates already passed: 6,693 tests / 3 optional skips / 0 failures, TypeScript, memory benchmark, compiled-memory verification and host build. Final canary session/web 67 and compiled memory checks passed with checkout reads denied on Darwin arm64. See `release-readiness.md` for exact logs and limits. Only release metadata/documentation changes follow that baseline; focused descriptor/build-info/documentation checks and a versioned build verify this delta. The remote release workflow reruns full tests and verification before publishing artifacts.

Sequence: commit metadata, integrate source on main without rewriting history, verify the remote main ref, then create/push the new v0.11.0 tag. Existing tags remain untouched. The canonical Release workflow builds linux-x64, linux-arm64, darwin-x64 and darwin-arm64, signs Darwin artifacts, emits checksums and release.json, and publishes the stable release. Confirm workflow completion, asset inventory, descriptor/version/checksums and an extracted host binary before announcing completion. No claim of expanded automatic runtime-effect cohorts is part of this release.

Release metadata verification passed: 82 focused tests, 938 assertions, no failures. The versioned Darwin arm64 build and signature verification passed; the executable reports 0.11.0. Publication and final downloaded-artifact evidence are pending.
