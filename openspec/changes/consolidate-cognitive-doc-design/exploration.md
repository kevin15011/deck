# Exploration: consolidate-cognitive-doc-design

## Goal

Explore the current state of cognitive-doc-design references in Developer Team content files and determine how to canonicalize generic documentation/artifact-structure guidance while preserving artifact contracts.

## Current State

**Phase 3B of the Skills Integration Roadmap** requires canonicalizing generic documentation guidance to the `cognitive-doc-design` skill.

### Target Files (from roadmap)

1. `explorer-content.ts`
2. `proposal-content.ts`
3. `spec-content.ts`
4. `design-content.ts`
5. `task-content.ts`
6. `review-content.ts`
7. `verify-content.ts`

### Canonical Line (from roadmap)

```md
Follow the cognitive-doc-design skill for artifact structure and documentation patterns.
```

### Current State Analysis

| File | Has cognitive-doc-design ref | Has using-agent-skills ref | Output Template | Other Notes |
|------|---------------------------|---------------------------|----------------|--------------|
| explorer-content.ts | ❌ No | ❌ No | Yes (Step 5) | deck-developer-explorer skill reference at line 64 |
| proposal-content.ts | ❌ No | ✅ Yes (line 273) | Yes | output template in SKILL_BODY |
| spec-content.ts | ❌ No | ✅ Yes (line 367) | Yes | complex structured spec with Given/When/Then |
| design-content.ts | ❌ No | ✅ Yes (line 328) | Yes | architectural design tables |
| task-content.ts | ❌ No | ✅ Yes (line 399) | Yes | task breakdown with tables |
| review-content.ts | ❌ No | ✅ Yes (line 308) | Yes | five-axis review + severity findings |
| verify-content.ts | ❌ No | ✅ Yes (line 277) | Yes | compliance matrix + test results |

**Finding**: NONE of the 7 target files currently reference cognitive-doc-design.

All 7 files have existing `using-agent-skills` references in their SKILL_BODY `## Rules` sections.

## Relevant Files

- `packages/core/src/teams/developer/explorer-content.ts` — exploration methodology + return format
- `packages/core/src/teams/developer/proposal-content.ts` — proposal structure + output template
- `packages/core/src/teams/developer/spec-content.ts` — requirements + acceptance scenarios format
- `packages/core/src/teams/developer/design-content.ts` — technical design output template
- `packages/core/src/teams/developer/task-content.ts` — task breakdown structure
- `packages/core/src/teams/developer/review-content.ts` — review report format + five-axis criteria
- `packages/core/src/teams/developer/verify-content.ts` — compliance matrix + verification format
- `.opencode/skills/cognitive-doc-design/SKILL.md` — skill source (already exists standalone)
- `docs/skills-integration-roadmap.md` — Phase 3B specification

## Constraints

- **Must preserve inline**: output templates, artifact contracts, registry instructions, return formats, tables/matrices
- **Excluded**: orchestrator, apply agents, archive, visual-explanations, content.generated.ts
- **Already exists**: cognitive-doc-design as standalone skill at `.opencode/skills/cognitive-doc-design/SKILL.md`
- **Prior art**: Phase 3A already added using-agent-skills references — follow same pattern

## Risks

- Adding duplicate guidance that conflicts with existing artifact templates
- Breaking return contracts that downstream agents expect
- Creating circular references between skill references

## Options and Tradeoffs

1. **Add to SKILL_BODY Rules only** (like using-agent-skills)
   - Pros: Simple, consistent with Phase 3A pattern, targeted
   - Cons: Less visible during agent instruction reading
   - Effort: Low

2. **Add to both AGENT_BODY and SKILL_BODY**
   - Pros: Maximum visibility, both surfaces see reference
   - Cons: More changes, potential redundancy
   - Effort: Medium

3. **Replace inline doc guidance with canonical reference in Proposal + Design**
   - Pros: Eliminates duplication, cleaner
   - Cons: Risk of losing Deck-specific nuance
   - Effort: High

### Recommendation

Use **Option 1**: Add to SKILL_BODY Rules sections in each target file (follow using-agent-skills pattern).

Reasons:
- All 7 files already follow this pattern with using-agent-skills
- Minimizes blast radius and risk
- Preserves all inline artifact contracts
- Prior Phase 3A precedent validates this approach

## Implementation Notes

Following Phase 3A pattern (using-agent-skills consolidation):
- Each file has `## Rules` section at end of SKILL_BODY
- Adding single line after using-agent-skills reference or as alternative
- Must NOT remove or alter existing output templates

Proposed insertion pattern:
```md
## Rules

Follow the cognitive-doc-design skill for artifact structure and documentation patterns.
```

Files needing insertion (line ranges approximate):
- explorer-content.ts: after line 226 (near end of SKILL_BODY)
- proposal-content.ts: after line 273
- spec-content.ts: after line 367
- design-content.ts: after line 328
- task-content.ts: after line 399
- review-content.ts: after line 308
- verify-content.ts: after line 277

## Open Questions

- Should the reference be placed before or after using-agent-skills in the Rules section?
- Any specific artifact templates that need augmentation with cognitive-doc-design patterns?

## Ready for Proposal

**Yes** — Structured findings ready for design phase. Recommend proceeding with Phase 3B canonicalization using Option 1.

## Prior Final Result (before reset)

From roadmap line 291-295:
- Known result: `597 pass / 0 fail`
- Review: APPROVE