# Apply Progress: Deck Human-Facing Product Documentation

## Status

The documentation candidate is implemented and independently accepted. Lifecycle closure remains pending because the repository broad suite has candidate-independent, unrecorded drift outside this documentation scope.

## Authorized targets

- `README.md`
- `docs/README.md`
- New human-facing product guides under `docs/`
- New product references under `docs/reference/`
- Cross-links in existing maintained documentation when required
- `tests/documentation-governance.test.ts`
- This change's OpenSpec lifecycle records

## Protected boundaries

- Do not modify runtime behavior, generated files, historical OpenSpec artifacts, or release metadata.
- Do not add a documentation framework or dependencies.
- Do not create placeholder image assets or broken asset references.
- Do not convert known gaps into product promises.

## Evidence

### Implemented

- Reframed `README.md` as a product landing page with a direct installation path, current support boundary, product loop, and curated next actions.
- Added the task-oriented product documentation hub and complete guides for getting started, runners, configuration, Developer Team, skills, adaptive memory, operations, project workflows, and troubleshooting.
- Added parser-backed CLI and support-matrix references.
- Added the supplied Deck hero, responsive light/dark horizontal marks, stacked marks, and reusable panel background under `docs/assets/brand/`; integrated the hero into the product README and the responsive wordmark into the documentation hub.
- Cataloged all seven Developer Team roles, both lifecycle skills, and all 29 bundled external skills from current source.
- Added runner-specific Supermemory guidance and fail-closed release-descriptor behavior after independent review.
- Extended documentation governance with maintained-page, link, command-shape, source-catalog, generated-boundary, and honest-support checks.

### Verification

- `bun test tests/documentation-governance.test.ts`: 15 passed, 0 failed, 653 assertions after brand-asset integration.
- `bunx tsc --noEmit`: passed.
- Relevant parser, update, Supermemory, configuration, and catalog tests: 197 passed.
- `git diff --check`: passed.
- Independent Quality review: candidate PASS after two bounded repair deltas.

### Remaining repository evidence

The broad suite previously reported 4203 passing tests and six failures caused by the absent ignored development artifact `apps/cli/src/runtime/build-info.generated.ts`. The documentation candidate did not create, remove, or depend on that file. These fingerprints are not recorded in `openspec/baseline-health.yaml`, so this change does not claim broad pass or pass-with-warning. Repairing the unrelated tests or reconciling the baseline requires separate authorization.
