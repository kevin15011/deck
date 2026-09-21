# Design and working brief

## Decisions
Deck is a Bun-compiled standalone executable; Node is an external tooling compatibility dimension, not its embedded runtime. Reuse the existing build preparation, preserving the canonical Bun version defined in `.github/workflows/release.yml`. Keep one reusable verifier for local builds and CI archives, with injectable subprocess/download seams for offline tests. Provision Node from official distributions into owned temporary paths, never through global version managers.

CI builds candidate archives once, then a native OS/architecture × Node-major matrix verifies downloaded artifacts. Both publishing jobs depend on this matrix. Existing verification/benchmark/provider gates remain. Add PR and manual verification without publishing permission or publish conditions. Reports are separate artifacts from distributable archives.

## Relevant trace
- `package.json` → `scripts/build-binaries.ts`: standalone preparation, target mapping and compilation.
- `scripts/install-canary.ts`: personal canary installation; not reused as a sandbox installation target.
- `.github/workflows/release.yml`: four archive targets and stable/draft publishing paths.
- `scripts/verify-supermemory-compiled-runtime.ts`: existing provider fixture and standalone checks; retain unchanged unless a directly necessary compatibility repair is found.
- Node-dependent boundaries reside in runner adapters and generated Node hook assets; select meaningful offline boundary coverage and label exclusions.

## Readiness
Working tree initially contains an unrelated `.serena/project.yml` modification; preserve it. Skill registry is absent and the installed `deck skill-registry validate --runner opencode` rendered a legacy menu, so it supplied no validation evidence. Use bounded active-runner discovery without repair. Adaptive project memory is disabled. Host Bun is 1.3.14, whereas canonical release generation requires 1.3.12; real build validation must use the pinned runtime or report the blocker.

## Acceptance evidence
Strict red/green tests for harness failures/isolation and publication dependencies, typecheck, focused existing release tests, independent release-boundary review, and a native-host real sandbox run if prerequisites can be provisioned safely. Other OS/architecture cells require remote CI and cannot be claimed locally.
