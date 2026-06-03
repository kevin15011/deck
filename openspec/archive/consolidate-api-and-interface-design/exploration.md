# Exploration: consolidate-api-and-interface-design

> **Change**: consolidate-api-and-interface-design
> **Phase**: explore
> **Date**: 2026-06-03
> **Scope**: Phase 3D from docs/skills-integration-roadmap.md — canonicalize `api-and-interface-design` skill methodology in Developer Team prompts

---

## Goal

Investigate the current state of `api-and-interface-design` skill and its existing references in Developer Team prompt content files to determine consolidation approach.

---

## Current State

### Skill Existence

The `api-and-interface-design` skill is **already installed and registered**:

- **Location**: `packages/core/src/skills/external/api-and-interface-design/SKILL.md`
- **Registered in index.ts**: Line 50 shows `{ skillId: "api-and-interface-design", sourcePath: "api-and-interface-design/SKILL.md" }`
- **20 skills total**: Phase 1 is already complete

### Skill Content Summary

The skill covers:
- Hyrum's Law (observable behaviors become commitments)
- One-Version Rule (avoid diamond dependencies)
- Contract First design
- Consistent error semantics (REST status codes + structured error body)
- Validation at boundaries (trust internal, validate external)
- Prefer addition over modification
- Predictable naming conventions (REST, query params, response fields)
- REST API patterns (resource design, pagination, filtering, PATCH)
- TypeScript patterns (discriminated unions, input/output separation, branded types)

### Existing Prompt References

Found **87 matches** in content files referencing contracts, validation, API design:

| File | Reference Type | Current Text |
|------|-------------|------------|
| `apply-backend-content.ts` | AGENT_BODY § | "APIs and contracts", "Do not silently change frontend-facing contracts" |
| `apply-backend-content.ts` | SKILL_BODY § | "Handle errors, validation, and edge cases" |
| `apply-general-content.ts` | AGENT_BODY § | "Shared packages and contracts", "Keep shared types/schemas stable" |
| `apply-general-content.ts` | SKILL_BODY § | "Keep shared types/schemas stable" |
| `apply-frontend-content.ts` | AGENT_BODY § | "Do not invent, mock, or reshape backend contracts" |
| `design-content.ts` | SKILL_BODY § | "Define technical architecture decisions: component/module boundaries, data flow, API/contract implications" |
| `design-content.ts` | SKILL_BODY § | Table: API/Contract implications |
| `spec-content.ts` | SKILL_BODY § | "Define contracts, states, validation rules, error conditions" |
| `spec-content.ts` | SKILL_BODY § | "externally observable behavior, contracts" |
| `task-content.ts` | SKILL_BODY § | "Identify shared/contracts work" |
| `task-content.ts` | SKILL_BODY § | "API contracts" in task routing table |
| `review-content.ts` | SKILL_BODY § | "API design: RESTful, consistent, versioned?" |
| `review-content.ts` | SKILL_BODY § | "Are API changes backward compatible?" |
| `review-content.ts` | SKILL_BODY § | "Are error contracts consistent?" |

---

## Relevant Files

### Target Prompt Files (from roadmap)

According to docs/skills-integration-roadmap.md Phase 3D, target files are:

- `packages/core/src/teams/developer/apply-backend-content.ts`
- `packages/core/src/teams/developer/apply-general-content.ts`
- `packages/core/src/teams/developer/design-content.ts`
- `packages/core/src/teams/developer/spec-content.ts`
- `packages/core/src/teams/developer/review-content.ts`

**Missing from roadmap but potentially relevant:**

- `packages/core/src/teams/developer/task-content.ts` (contract routing)
- `packages/core/src/teams/developer/proposal-content.ts` (risk assessment)
- `packages/core/src/teams/developer/apply-frontend-content.ts` (contract consumption)

### Skill Source

- `packages/core/src/skills/external/api-and-interface-design/SKILL.md` (294 lines)

### Registration

- `packages/core/src/skills/external/index.ts` (line 50)

---

## Consolidation Approach

### Canonical Topics to Reference

Expected canonical topics from roadmap (lines 351-359):

1. **Stable APIs/interfaces** — Hyrum's Law, contract-first design
2. **Contract-first design** — define interface before implementation
3. **Validation at boundaries** — trust internal, validate external
4. **Consistent error semantics** — REST status codes + structured error body
5. **REST/resource patterns** — plural nouns, no verbs
6. **TypeScript input/output type separation**
7. **Backward compatibility** — prefer addition over modification

### Reference Pattern (per Phase 3A/3B precedent)

Similar to Phase 3A/3B consolidation, add canonical reference in SKILL_BODY surfaces:

```md
Follow the api-and-interface-design skill for stable API and interface design guidance.
```

### What to Preserve

Must preserve inline (per roadmap line 364-368):
- API / Contract Implications table in Design
- Validation Rules and Error Contracts in Spec
- Apply-progress formats
- Review report structure

---

## Constraints

1. **Phase 1 already complete** — skill exists and registered (no blocker)
2. **Minimal edit surface** — per Phase 3A precedent, only SKILL_BODY surfaces (not AGENT_BODY)
3. **Preserve artifact-specific contracts** — output templates, tables, registries remain inline
4. **Git safety** — no destructive commands; edits are to content files only

---

## Risks

1. **No test baseline** — unlike Phase 3C, this may not have focused tests yet
2. **Overlapping with code-review-and-quality** — Review Agent also checks API design; avoid duplicate canonical references
3. **Partial redundancy with cognitive-doc-design** — if already consolidated, overlapping reference not needed

---

## Recommendation

**Proceed with Phase 3D** since Phase 1 is complete (skill installed).

### Target Files

Consolidate in priority order:

1. ~~`apply-backend-content.ts`~~ — Already has strong contract language; minimal change needed
2. ~~`apply-general-content.ts`~~ — Has contract stability language; verify
3. `design-content.ts` — Has API/Contract table; add canonical reference
4. `spec-content.ts` — Has validation/contract guidance; add reference
5. `review-content.ts` — Has API review checks; add reference if aligned

### Canonical Lines

Potential insertion points (matching Phase 3A pattern):

| File | Surface | Insert After |
|------|---------|--------------|
| `apply-backend-content.ts` | SKILL_BODY | "Handle errors, validation..." |
| `apply-general-content.ts` | SKILL_BODY | "Keep shared types/schemas stable..." |
| `design-content.ts` | SKILL_BODY | Section on API/contract implications |
| `spec-content.ts` | SKILL_BODY | Section on contracts/validation |
| `review-content.ts` | SKILL_BODY | Section on API design checklist |

### Exact canonical line to add (following Phase 3A precedent):

```md
Follow the api-and-interface-design skill for stable API and interface design guidance.
```

---

## Open Questions

1. Should `task-content.ts` be included as target? (contract routing affected)
2. Should `proposal-content.ts` be included? (risk assessment discusses contracts)
3. Should `apply-frontend-content.ts` be excluded like Phase 3A excludes apply agents for Serena? Or is its "do not invent contracts" redundant with this skill's guidance?
4. Are there existing tests that verify this canonical reference? (Phase 3D may need new tests)

---

## Ready for Proposal

**Yes** — skill exists, targets identified, approach clear.

Recommend adding after Phase 3C verification to chain completes. This is Phase 3D in the roadmap sequence.