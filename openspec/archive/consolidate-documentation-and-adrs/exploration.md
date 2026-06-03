# Exploration: consolidate-documentation-and-adrs

## Goal
Investigate consolidation of `documentation-and-adrs` skill into Developer Team prompts (Phase 3E of skills-integration-roadmap), targeting comment guidance, alternatives/tradeoffs documentation, and ADR-style rationale in 7 agent content files.

## Current State

### Phase 3E Targets
The roadmap specifies 7 target agents:
- Apply Backend
- Apply Frontend
- Apply General
- Explorer
- Proposal
- Design
- Review

### Current Overlap Areas

#### 1. Comment guidance (Apply agents)
Three apply agents have identical inline guidance:
- `apply-backend-content.ts` (line 126): "Write clean, readable code with appropriate comments for non-obvious decisions."
- `apply-frontend-content.ts` (line 129): Same
- `apply-general-content.ts` (line 125): Same

`documentation-and-adrs` provides detailed "why-vs-what" comment guidance and inline documentation patterns.

#### 2. Alternatives/tradeoffs (Proposal, Design)
- `proposal-content.ts` (line 36, 174-175): Requires alternatives table in output
- `design-content.ts` (line 40, 144): Mandates "rejected alternatives with rationale"

`documentation-and-adrs` provides ADR template with "Alternatives Considered" section structure and rationale capture pattern.

#### 3. Review comment checking
- `review-content.ts` (line 151): "Are comments appropriate (not excessive, not missing for non-obvious decisions)?"

#### 4. Git safety rule
Critical Git safety already implemented:
- `git-safety.ts` exports `GIT_DISCARD_PROTECTION_RULE`
- Present in all agent bodies and skill bodies
- Centralized test: `git-safety.test.ts`

### Already consolidated
- Phase 3A: `using-agent-skills` reference added to all 10 agents
- Phase 3B: `cognitive-doc-design` reference added to relevant agents
- Phase 3C: `code-review-and-quality` integrated into Review Agent

### Missing preconditions
- Phase 1 (silent installation) may not be complete — external skill directories may need restoration

## Relevant Files
- `packages/core/src/skills/external/documentation-and-adrs/SKILL.md` — Source of truth for documentation/ADR methodology
- `packages/core/src/teams/developer/apply-backend-content.ts` — Apply backend prompt
- `packages/core/src/teams/developer/apply-frontend-content.ts` — Apply frontend prompt
- `packages/core/src/teams/developer/apply-general-content.ts` — Apply general prompt
- `packages/core/src/teams/developer/explorer-content.ts` — Explorer prompt
- `packages/core/src/teams/developer/proposal-content.ts` — Proposal prompt
- `packages/core/src/teams/developer/design-content.ts` — Design prompt
- `packages/core/src/teams/developer/review-content.ts` — Review prompt
- `packages/core/src/teams/developer/git-safety.ts` — Git protection rule
- `docs/skills-integration-roadmap.md` — Roadmap specification

## Constraints
- Preserve artifact-specific output templates (Proposal alternatives table, Design rejected alternatives structure)
- Do NOT remove inline requirements that are part of downstream contracts
- Phase 1 must be verified/restore-able before applying consolidation
- Must not break existing tests

## Risks
1. **Precondition risk**: Phase 1 may not be complete (external skill directories missing)
2. **Template preservation risk**: Over-consolidation could remove essential contract structures
3. **Test regression risk**: Breaking changes to content files could fail existing test suite
4. **Parsing risk**: Previous apply attempt failed due to raw backticks in TypeScript template literals

## Options and Tradeoffs

### Option A: Full canonicalization with documentation-and-adrs reference
Add canonical reference lines like other phases:
```
Follow the documentation-and-adrs skill for comment guidance and ADR alternatives documentation.
```

**Pros:**
- Aligns with Phase 3A/B/C consolidation pattern
- Reduces inline duplication
- Provides canonical why-vs-what guidance

**Cons:**
- Requires Phase 1 installation first (circular dependency)
- May lose granular contract-specific nuance in apply agents

**Effort:** Medium

### Option B: Selective reference + inline preservation
Reference only in Explorer/Proposal/Design where alternatives are discussed; preserve apply agent comments inline

**Pros:**
- Safer approach — avoids breaking apply agent contracts
- References placed where they're most relevant

**Cons:**
- Less complete deduplication
- Two-tier standard emerges

**Effort:** Low

### Option C: Blocked until Phase 1 verification
Verify Phase 1 is complete first, then apply Option A or B

**Pros:**
- Correct order prevents working-tree issues
- Ensures skill exists before referenced

**Cons:**
- Delays Phase 3E completion
- Requires Phase 1 recreation if missing

**Effort:** Medium-High (contingent on Phase 1)

## Recommendation

**Block until Phase 1 verified**, then apply **Option B: Selective reference + inline preservation**.

Rationale:
1. The apply agents (Backend/Frontend/General) have minimal comment guidance already inline — adding reference here doesn't provide enough value to justify risk
2. Proposal and Design agents already mandate alternatives/tradeoffs — referencing `documentation-and-adrs` here helps ensure rationale capture quality
3. Explorer could benefit from ADR-style guidance when exploring options
4. Review already checks comments — alignment worthwhile

Git safety is already properly implemented and should remain unchanged.

## Open Questions
- Is Phase 1 (external skills silent installation) currently complete?
- Should Apply agents preserve comment guidance inline or reference the skill?
- What specific canonical line format matches Phase 3A/B precedent?

## Ready for Proposal
Yes — provided Phase 1 preconditions are checked first. Recommend orchestrator verify external skill bundle availability before launching proposal phase.

## Registry
- **Artifact Path**: `openspec/changes/consolidate-documentation-and-adrs/exploration.md`
- **State Path**: `openspec/changes/consolidate-documentation-and-adrs/state.yaml`
- **Events Path**: `openspec/changes/consolidate-documentation-and-adrs/events.yaml`
- **Recorded**: phase `explore`, status `completed`, event `consolidate-documentation-and-adrs-explored`
- **Registry Blocker**: none