# Exploration: external-skills-bundle-install

> **Explorer**: deck-developer-explorer
> **Change**: external-skills-bundle-install
> **Date**: 2026-06-02
> **Status**: Exploration complete — ready for Proposal + Spec

---

## Investigation Summary

Phase 1 from `docs/skills-integration-roadmap.md` involves registering 17 new external skill directories (currently untracked in Git), generating full skill bundles with auxiliary files, adding a `getStandaloneSkill` accessor, and preserving `getStandaloneSkillBody` for backward compatibility.

### Current State

#### 1. Registry infrastructure (intact)
- `packages/core/src/skills/external/index.ts` — defines `STANDALONE_SKILLS` registry and error types
- `packages/core/src/skills/external/content.generated.ts` — generated bundle (only 3 skills: `judgment-day`, `cognitive-doc-design`, `comment-writer`)
- `scripts/generate-skill-bundle.ts` — generator script (single-file only, reads only `SKILL.md`)
- Tests: `index.test.ts`, `__tests__/content.test.ts` (intact, tracked by Git)

#### 2. New untracked skill directories (added by user, 17 skills)
```
packages/core/src/skills/external/
├── api-and-interface-design/
├── ci-cd-and-automation/
├── code-review-and-quality/
├── code-simplification/
├── debugging-and-error-recovery/
├── deprecation-and-migration/
├── documentation-and-adrs/
├── doubt-driven-development/
├── frontend-ui-engineering/
├── git-workflow-and-versioning/
├── idea-refine/          ← multi-file: SKILL.md + examples.md + frameworks.md + refinement-criteria.md + scripts/
├── interview-me/
├── performance-optimization/
├── security-and-hardening/
├── shipping-and-launch/
├── test-driven-development/
└── using-agent-skills/
```

#### 3. Git status
- Branch: `main` (ahead of origin by 1 commit)
- Untracked: 17 skill directories
- Tracked modified: `apps/cli/src/runtime/build-info.generated.ts`
- Archive: `openspec/archive/consolidate-code-review-quality/`

---

## Key Files to Modify

### Files requiring changes (backward compatibility preserved)

| File | Purpose | Change type |
|------|---------|-----------|
| `scripts/generate-skill-bundle.ts` | Generator | Extend to walk directories, include all files, emit new bundle type |
| `packages/core/src/skills/external/index.ts` | Registry + accessors | Add `getStandaloneSkill` function + update `STANDALONE_SKILLS` |
| `packages/core/src/skills/external/content.generated.ts` | Generated bundle | Regenerate with all 20 skills + full files |
| `packages/core/src/teams/developer/` | - | May need type imports |

### Files NOT to modify (preserve as-is)

- `packages/core/src/skills/external/index.test.ts` — existing tests
- `packages/core/src/skills/external/__tests__/content.test.ts` — content tests

---

## Implementation Approaches

### Option A — Incremental extension (recommended)

1. **Extend generator** for multi-file bundle:
   - Walk skill directories with `readdirSync(dir, { withFileTypes: true })`
   - Read all non-system files (exclude `:Zone.Identifier`, `._*`)
   - Emit new `StandaloneSkillBundle` type: `{ SKILL: string; files: Record<string, string> }`

2. **Update index.ts**:
   - Add type `StandaloneSkillBundle`
   - Add `getStandaloneSkill(skillId)` accessor
   - Add 17 new entries to `STANDALONE_SKILLS`
   - Preserve `getStandaloneSkillBody` as delegation to `getStandaloneSkill(skillId).SKILL`

3. **Regenerate bundle**:
   - Run `bun scripts/generate-skill-bundle.ts`
   - Verify: `getStandaloneSkills().length === 20`

#### Pros
- Minimal disruption to existing code
- Preserves all existing contracts
- Clear migration path

#### Cons
- Generator needs rewrite, not just extension

### Option B — Full rewrite

- Replace entire generator + registry + accessors
- Higher risk of breaking existing contracts

#### Cons
- Higher risk of introducing bugs
- More validation needed
- Not recommended given Phase 1 constraints

---

## Effort Estimate

| Task | Effort | Risk |
|------|-------|------|
| Update generator for multi-file | Medium | Low |
| Update index.ts registry + add `getStandaloneSkill` | Low | Low |
| Update STANDALONE_SKILLS with 17 entries | Low | Very Low |
| Regenerate bundle | Low | Low |
| Update existing tests | Very Low | Very Low |
| **Total** | **Low-Medium** | **Low** |

---

## Acceptance Criteria (from roadmap)

- `getStandaloneSkills().length === 20`
- `getStandaloneSkillBody("judgment-day")` returns string
- `getStandaloneSkill("judgment-day")` returns `{ SKILL, files: {} }`
- `getStandaloneSkill("idea-refine")` contains: `examples.md`, `frameworks.md`, `refinement-criteria.md`, `scripts/idea-refine.sh`
- Unknown skills throw `SkillLookupError`
- Tests pass: `bun test packages/core/src/skills/external/`

---

## Risks Identified

1. **Generator single-file limitation** — current script only reads `SKILL.md`, needs directory walking
2. **Multi-file preservation** — `idea-refine` has 5 files including scripts, must bundle all
3. **Backward compatibility** — `getStandaloneSkillBody` must remain functional and delegate correctly
4. **Git safety** — do not discard untracked skill directories (they are user-added, not yet committed)

---

## Remaining Unknowns

None — the roadmap provides sufficient detail for Phase 1 implementation.

---

## Recommendation

Proceed with **Option A** (incremental extension). The approach aligns with roadmap Section 3.3 backward compatibility requirement:

```ts
// New accessor
getStandaloneSkill(skillId): StandaloneSkillBundle

// Old accessor delegates
getStandaloneSkillBody(skillId) → getStandaloneSkill(skillId).SKILL
```

Use targeted tests first, then run full suite:
```bash
bun test packages/core/src/skills/external/
```

---

## Registry Events

Update `openspec/registry/events.yaml`:

```yaml
- name: external-skills-bundle-install
  type: EXPLORATION_COMPLETE
  explorer: deck-developer-explorer
  date: "2026-06-02"
  scope: PHASE_1
  status: READY_FOR_IMPLEMENTATION
  affected:
    - packages/core/src/skills/external/index.ts
    - scripts/generate-skill-bundle.ts
    - packages/core/src/skills/external/content.generated.ts
  untracked_external_skills:
    - api-and-interface-design
    - ci-cd-and-automation
    - code-review-and-quality
    - code-simplification
    - debugging-and-error-recovery
    - deprecation-and-migration
    - documentation-and-adrs
    - doubt-driven-development
    - frontend-ui-engineering
    - git-workflow-and-versioning
    - idea-refine
    - interview-me
    - performance-optimization
    - security-and-hardening
    - shipping-and-launch
    - test-driven-development
    - using-agent-skills
  acceptance_criteria_verified:
    - getStandaloneSkills().length === 20
    - getStandaloneSkillBody() delegates to getStandaloneSkill()
    - getStandaloneSkill() returns full bundle with files
    - Tests pass
```