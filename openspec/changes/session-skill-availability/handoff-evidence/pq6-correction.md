> Preserved historical report. Current official spec/design/tasks and source take precedence. Original source: /tmp/deck-pq6-correction/report.md

# PQ6 bounded correction

Implemented PQ6 only. PQ3 remains pending the genuine user contract decision; no pairing or optional Codebase behavior was changed. Lead retains finding disposition and broader parity acceptance.

## Exact delta

- `packages/adapter-claude/src/runner-adapter.ts:593`: review now inspects effective native search using the dashboard project root, selected Lead model, adapter environment and flags, matching materialization/launch. Inspection occurs only when semantic web search is selected. The existing fallback predicate (native unavailable/unknown and web authority not denied) gates credential/provider validation and executable verification/install planning. Semantic capability selection and native role grants remain intact.
- `packages/adapter-claude/src/review-search.int.test.ts`: five hermetic cases. Real temporary native generation, actual inventory ready and actual launch ready without provider/credential/executable; review must be ready with no credential read or Tavily executable lookup/install. Bedrock fallback controls cover absent credential, absent provider, absent executable (reviewed installation), and verified executable (no installation).

`source.patch` is the exact production delta against this attempt's saved starting source. The new test file is the complete test delta. Existing potentially mixed worktree changes were preserved. No OpenSpec, configuration, commits, paid probes, user installations or broad suites were performed.

## Evidence

- RED: `bun test packages/adapter-claude/src/review-search.int.test.ts`, exit 1: 4 pass, native review expected true/received false after actual inventory/launch readiness passed. `red.log`.
- Final focused: `bun test packages/adapter-claude/src/review-search.int.test.ts packages/adapter-claude/src/runner-adapter.int.test.ts --test-name-pattern 'review search route|missing Serena proxy/bootstrap|failed reviewed shared-tool'`, exit 0: 7 pass, 0 fail, 26 filtered, 31 assertions. `final-focused.log`.
- Scoped `git diff --check`: exit 0.
- Final typecheck result recorded separately in `typecheck-result.json`; output in `typecheck-final.log`.

## Binding and limits

SHA-256 of final changed paths:

- runner-adapter.ts: `85a861c55f32318614ce9295822749a24ab7e522a69417f04d3e14f0086acb58`
- review-search.int.test.ts: `08e8950834dd948f7619e50356906b10b42b3bb2cc5479a918424ae2469d812f`

Tests use temporary owned files and real Deck planning/inventory/launch composition with fake credential/executable effects; they invoke no external model or installation. This is bounded PQ6 evidence, not full parity acceptance or live Claude enforcement proof. Earlier RQ/PQ evidence is reused, not re-executed wholesale.

OFFICIAL CONTEXT: current source, implementation route and immutable task handoff. Skill discovery context absent/indeterminate; directly exposed deck-apply-deep and codebase-memory skills loaded. Adaptive memory disabled/not loaded. Graph Verify: deck root confirmed; generation 2026-08-20T17:25:00Z stale. Targeted symbol query had zero rows, fully paginated. Coverage checked seven paths in two complete batches: adapter/native-search/capabilities/existing test untracked, dashboard metadata changed, new test missing, provider descriptor metadata match. Exact source fallback supports claims; no inference of code absence or graph completeness. No reindex or registry mutation.
