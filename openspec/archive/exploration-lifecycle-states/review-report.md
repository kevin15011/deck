# Review Report: Exploration Lifecycle States

## Summary

**Overall Rating**: APPROVE
**Scope**: general
**Files Reviewed**: 4 (fix scope), 10+ (full change)
**Review Type**: Final quick re-run — pre-archive fix validation (2026-06-16)

## Fix Under Review

**Pre-Archive Fix (2026-06-16)** addressed two validation noise issues:

1. **Validator event-name pattern too strict** — valid registry event names (`spec.repaired`, `design.repaired`, `preconditions.created`, `apply.general.fix_completed`, etc.) triggered false `events.event.name_mismatch` warnings because the validator only accepted exact `<phase>.<status>` matches.

2. **Archived change lookup missed archive** — `deck openspec validate --change <id>` only searched `openspec/changes/` by default, so archived changes like `openspec-registry-schema-validator` returned `change.not_found`.

## Fix Assessment

### 1. Event-Name Pattern Acceptance — NOT Too Broad ✅

The new `isKnownRegistryEventName()` function uses three well-bounded acceptance paths:

| Path | Pattern | Constraint |
|---|---|---|
| Phase-event | `<phase>.<status>` | Exactly 2 segments (`extra === undefined`), phase in `VALIDATOR_PHASES`, status in `{completed, started, repaired, failed, passed, approved}` |
| Apply-owner | `apply.<owner>.<terminal>` | Regex: `^apply\.[a-z][a-z0-9-]*\.(started\|completed\|fix_completed)$` — anchored, lowercase, bounded terminal set |
| Known-exact | Set lookup | Exact match against `{preconditions.created, precondition_gate.passed, precondition_gate.blocked, exploration.lifecycle_decided}` |

**Why it is safe**:
- Path 1 rejects 3+ segment names (`extra === undefined` guard prevents `spec.repaired.foo`).
- Path 2 regex is anchored (`^...$`), requires lowercase alpha start, bounded terminal alternatives. Cannot match `apply..started` or `apply.FOO.started` or `apply.foo.bar.started`.
- Path 3 is an exact `Set.has()` — no ambiguity.
- Negative test confirms unknown names still produce warnings.

### 2. Archived Change Lookup — Safe ✅

**Change**: `includeArchive` default changed from `changeId ? false : true` to `true`.

**Why it is safe**:
- Lookup order preserves active-first precedence: `changes/<id>` → `archive/<id>`.
- Result `location` field clearly indicates `"changes"` vs `"archive"`.
- `includeArchive: false` still available as explicit opt-out.
- Type doc updated to match behavior: *"searches active changes first, then archive"*.
- Both validator-level and CLI-level tests confirm archived lookup.

## Verification Evidence

| Check | Result |
|---|---|
| Validator tests | 27/27 pass |
| CLI validate tests | 8/8 pass |
| Smoke: active change (`exploration-lifecycle-states`) | 0 errors, 0 warnings, location `changes` |
| Smoke: archived change (`openspec-registry-schema-validator`) | 0 errors, 5 warnings (pre-existing), location `archive`, no `change.not_found` |
| Typecheck | pass |

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Three-path acceptance is clean separation; archive fallback respects active-first precedence |
| Security | ✅ Strong | No user input surfaces; internal registry validation only |
| Scalability | ✅ Strong | O(1) Set lookup + single regex test per event; archive fallback is one extra `fs.access` |
| Maintainability | ✅ Strong | Named constants, clear function decomposition, doc comments aligned with behavior |
| Code Quality | ✅ Strong | Consistent style, well-typed, tests cover both positive and negative paths |
| Backend | ✅ Strong | Validator follows existing patterns; additive change, no breaking behavior |
| Frontend | N/A | No frontend surface |
| Integration | ✅ Strong | Types.ts doc aligned; CLI and core validator behavior consistent |

## Findings

### BLOCKER

None.

### MAJOR

None.

### MINOR

None new. Previous MINOR (dead rule codes) was resolved in the 2026-06-15 fix.

### NIT

- **Code Quality — Test describe block name references `decision_required`**
  - **File**: `packages/core/src/spec-registry/validator.test.ts`
  - **Evidence**: Test name `"diagnosed without decision_required emits warning"` references a field that was removed from the schema. The test itself correctly validates `next_action`.
  - **Recommendation**: Rename to `"diagnosed without next_action emits warning"`. Non-blocking.

- **Architecture — MAY-level warnings intentionally not implemented**
  - **Evidence**: REQ-REGISTRY-008/009 deferred due to false-positive risk. Correct decision.
  - **Recommendation**: Add a code comment near lifecycle validation in `validator.ts` documenting the intentional deferral. Non-blocking.

## Design Fidelity

- **Aligned**: Yes
- **Deviations**: None. The fix stays within the design's "warning-level validator behavior" scope and does not introduce new lifecycle states, phases, or gates.

## Previous Review Findings Status

| Finding | Status |
|---|---|
| MINOR: Dead rule codes in schema | ✅ Resolved (2026-06-15 fix) |
| NIT: Test name references `decision_required` | Open (cosmetic) |
| NIT: Diff includes unrelated peripheral changes | N/A (historical) |
| NIT: MAY-level warnings undocumented | Open (advisory) |

## Open Questions

None.

## Conclusion

The pre-archive fix is clean, well-scoped, and well-tested. The event-name pattern is appropriately bounded (not too broad). The archived change lookup is safe (active-first, clearly labeled). No new blockers or majors. The change is ready to archive.
