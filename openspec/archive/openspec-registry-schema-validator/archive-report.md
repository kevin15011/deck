# Archive Report: OpenSpec Registry Schema Canonical + Validator Read-Only

## Change Summary

**Change**: openspec-registry-schema-validator
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/openspec-registry-schema-validator/`

### Lifecycle
- **Proposal**: 2026-06-12 — Schema canónico y validator read-only para OpenSpec Registry
- **Spec + Design**: 2026-06-12 — Paralelo, ambos completados
- **Tasks**: 2026-06-12 — 13 tasks creadas
- **Apply**: 2026-06-12 — 13 tasks completadas + múltiples fix batches (MAJOR-1 a MAJOR-6, CLI summary fields, MINOR-1)
- **Verify**: 2026-06-12 — PASS
- **Review**: 2026-06-12 — APPROVE WITH WARNINGS (5 MAJORs corregidos + MAJOR-6 + CLI summary fields, MINOR-1 pre-archive fix)
- **Archive**: 2026-06-12 — archived

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-schema-001 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-schema-002 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-schema-003 | Task 1, 3 | ✅ | ✅ PASS | ✅ Strong |
| REQ-schema-004 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-schema-005 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-schema-006 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-schema-007 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-schema-008 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-schema-009 | Task 5 | ✅ | ✅ PASS | ✅ Strong |
| REQ-schema-010 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-schema-011 | Task 1 | ✅ | ✅ PASS | ✅ Strong |
| REQ-val-001 | Task 5 | ✅ | ✅ PASS | ✅ Strong |
| REQ-val-002 | Task 5 | ✅ | ✅ PASS | ✅ Strong |
| REQ-val-003 | Task 5, 9 | ✅ | ✅ PASS | ✅ Strong |
| REQ-val-004 | Task 2 | ✅ | ✅ PASS | ✅ Strong |
| REQ-val-005 | Task 3, 5 | ✅ | ✅ PASS | ✅ Strong |
| REQ-val-006 | Task 5 | ✅ | ✅ PASS | ✅ Strong |
| REQ-val-007 | Task 5 | ✅ | ✅ PASS | ✅ Strong |
| REQ-val-008 | Task 5 | ✅ | ✅ PASS | ✅ Strong |
| REQ-val-009 | Task 5 | ✅ | ✅ PASS | ✅ Strong |
| REQ-val-010 | Task 5 | ✅ | ✅ PASS | ✅ Strong |
| REQ-val-011 | Task 5 | ✅ | ✅ PASS | ✅ Strong |
| REQ-val-012 | Task 3 | ✅ | ✅ PASS | ✅ Strong |
| REQ-val-013 | Task 5 | ✅ | ✅ PASS | ✅ Strong |
| REQ-cli-001 | Task 9 | ✅ | ✅ PASS | ✅ Strong |
| REQ-cli-002 | Task 9 | ✅ | ✅ PASS | ✅ Strong |
| REQ-cli-003 | Task 7, 9 | ✅ | ✅ PASS | ✅ Strong |
| REQ-cli-004 | Task 9 | ✅ | ✅ PASS | ✅ Strong |
| REQ-cli-005 | Task 9 | ✅ | ✅ PASS | ✅ Strong |
| REQ-cli-006 | Task 9 | ✅ | ✅ PASS | ✅ Strong |
| REQ-cli-007 | Task 9 | ✅ | ✅ PASS | ✅ Strong |
| REQ-cli-008 | Task 9 | ✅ | ✅ PASS | ✅ Strong |
| REQ-cli-009 | Task 9 | ✅ | ✅ PASS | ✅ Strong |
| REQ-cli-010 | Task 7 | ✅ | ✅ PASS | ✅ Strong |
| REQ-doc-001 | Task 12 | ✅ | ✅ PASS | ✅ Strong |
| REQ-doc-002 | Task 12 | ✅ | ✅ PASS | ✅ Strong |

## Verification

**Result**: PASS
**Critical Findings**: 0
**Warnings**: 1 (pre-existing typecheck errors in pi-launch-command.ts - unrelated)

## Review

**Rating**: APPROVE WITH WARNINGS
**Blockers**: 0
**Major Findings**: 0 (6 previous MAJORs all fixed)
**Minor Findings**: 2 (MINOR-1 fixed pre-archive, MINOR-2 carried as documented deferrals)

## Follow-ups

- **Priority: Medium**: Integrate `deck openspec validate` into `deck doctor` — suggested owner: deck-developer-design
- **Priority: Medium**: Add auto-reconciliation between events.yaml, state.yaml, and artifacts on disk — suggested owner: deck-developer-proposal
- **Priority: Medium**: Add CI gate to validate registry in pull requests — suggested owner: deck-developer-proposal
- **Priority: Low**: Define extended lifecycle for explorations (`diagnosed`, `deferred`, `converted-to-change`) — suggested owner: deck-developer-spec
- **Priority: Low**: Implement canonical-strict mode flag for future CI gating — suggested owner: deck-developer-design
- **Priority: Low**: Add YAML parser unit tests to improve coverage — suggested owner: deck-developer-apply-general

> Change is fully closed. All MAJOR findings were corrected during Apply. MINOR-1 was corrected pre-archive. MINOR-2 items are documented deferrals in review-report.md and do not affect the core validation contract.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- Schema canonical constants (`spec-registry-v1`, `spec-registry-events-v1`) enable forward-compatible evolution
- Read-only validator guarantee is essential — never mutate registry data
- Legacy tolerance via warnings avoids turning historical debt into immediate blockers
- Agent-first CLI design with `--json` flag enables stable programmatic consumption
- YAML parser encapsulation isolates dependency and normalizes diagnostics

## Main Files Changed

| File | Action | Description |
|---|---|---|
| packages/core/src/spec-registry/schema.ts | create | Canonical schema constants, phase/status enums, rule codes |
| packages/core/src/spec-registry/yaml.ts | create | Tolerant YAML parser adapter with duplicate key detection |
| packages/core/src/spec-registry/types.ts | modify | Added validator DTOs |
| packages/core/src/spec-registry/validator.ts | create | Core validation logic |
| packages/core/src/spec-registry/validator.test.ts | create | 11 unit tests |
| packages/core/src/spec-registry/index.ts | modify | Barrel export |
| packages/core/package.json | modify | Added spec-registry export |
| apps/cli/src/cli-args.ts | modify | Parse openspec validate command |
| apps/cli/src/openspec-validate-command.ts | create | CLI adapter |
| apps/cli/src/openspec-validate-command.test.ts | create | 7 CLI tests |
| apps/cli/src/main.tsx | modify | Route openspec-validate command |
| openspec/registry-schema.md | create | Public schema reference |
| package.json | modify | Added yaml dependency |

## Test Summary

- **Core validator tests**: 11/11 pass ✅
- **CLI adapter tests**: 7/7 pass ✅
- **CLI parser tests**: 46/46 pass ✅
- **Total**: 64 tests pass
