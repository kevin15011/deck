# Exploration: consolidate-using-agent-skills

## Goal

Investigate target files for Phase 3A — canonicalizing generic operating behavior guidance to `using-agent-skills` skill.

## Phase 3A Definition (from skills-integration-roadmap.md)

**Goal**: canonicalize generic operating behavior guidance to `using-agent-skills`.

**Target source files**:
- `apply-backend-content.ts`
- `apply-frontend-content.ts`
- `apply-general-content.ts`
- `proposal-content.ts`
- `spec-content.ts`
- `design-content.ts`
- `task-content.ts`
- `review-content.ts`
- `verify-content.ts`
- `archive-content.ts`

**Canonical line to insert**:
```md
Follow the using-agent-skills skill for operating behaviors and failure mode guidance.
```

**Rules**:
- Replace only `SKILL_BODY` `## Rules` block bodies.
- Preserve `AGENT_BODY` byte-identical.
- Preserve `Serena Enforcement` sections in apply agents.
- Exclude: `orchestrator-content.ts`, `explorer-content.ts`, `visual-explanations-content.ts`, `using-agent-skills/SKILL.md`, `content.generated.ts`

**Prior known result** (before reset): `587 pass / 0 fail`

## Current State Analysis

### Target Files Identified

All 10 target files exist at `packages/core/src/teams/developer/`:

| File | Has Rules Section | Location |
|------|-------------|---------|
| apply-backend-content.ts | ✅ line 228 | SKILL_BODY |
| apply-frontend-content.ts | ✅ line 232 | SKILL_BODY |
| apply-general-content.ts | ✅ line 226 | SKILL_BODY |
| proposal-content.ts | ✅ line 271 | SKILL_BODY |
| spec-content.ts | ✅ line 365 | SKILL_BODY |
| design-content.ts | ✅ line 326 | SKILL_BODY |
| task-content.ts | ✅ line 397 | SKILL_BODY |
| review-content.ts | ✅ line 306 | SKILL_BODY |
| verify-content.ts | ✅ line 275 | SKILL_BODY |
| archive-content.ts | ✅ line 300 | SKILL_BODY |

### Using-Agent-Skills Skill

Located at `packages/core/src/skills/external/using-agent-skills/SKILL.md`. Contains:

- **Core Operating Behaviors** (section lines 43-111):
  1. Surface Assumptions
  2. Manage Confusion Actively
  3. Push Back When Warranted
  4. Enforce Simplicity
  5. Maintain Scope Discipline
  6. Verify, Don't Assume

- **Failure Modes to Avoid** (lines 112-126): 10 common failure modes

### Current Rules Content

Sample from verify-content.ts Rules (line 275-287):
```ts
## Rules

- Do not review architecture quality, security, or maintainability — that is Review Agent's job.
- Do not implement fixes — report findings and return.
- Do not write specs, designs, or proposals.
- Do not delegate further — you are the terminal verify phase.
- Focus on compliance: does the implementation satisfy the spec and tasks?
- Classify findings clearly: CRITICAL, WARNING, SUGGESTION.
- Run tests, build, and typecheck when available.
- Be specific about failures: include error messages, reproduction steps, and affected files.
- Do not reference runtime-specific launcher behavior. Stay environment-agnostic.
- Preserve uncertainty: flag unclear requirements instead of guessing pass/fail.
```

This pattern repeats across all 10 files with phase-specific variations.

## Relevant Files

- `packages/core/src/teams/developer/*-content.ts` — 10 target files with SKILL_BODY Rules sections
- `packages/core/src/skills/external/using-agent-skills/SKILL.md` — canonical skill source
- `packages/core/src/skills/external/content.generated.ts` — generated bundle (excluded from modification per roadmap rules line 227)
- `docs/skills-integration-roadmap.md` — Phase 3A specification
- `packages/core/src/teams/developer/git-safety.ts` — GIT_DISCARD_PROTECTION_RULE (must be preserved)

## Constraints

1. **Only SKILL_BODY Rules sections** — NOT AGENT_BODY
2. **Preserve GIT_DISCARD_PROTECTION_RULE** — appears before ## Rules, must stay
3. **Preserve Serena Enforcement** — in apply agents only, after ## Rules
4. **Exclude 5 files** — orchestrator, explorer, visual-explanations, using-agent-skills SKILL.md, content.generated
5. **Canonical line must appear exactly once** — no bullet-wrapped/indented variants
6. **Backward compatibility** — contract remains unchanged

## Risks

1. **Template literal escaping** — TypeScript backticks in replacement content must not break the file
2. **Multi-line replacement** — need to handle the entire Rules block, not just single lines
3. **Test assertions** — existing tests may assert specific rule counts or content
4. **Phase 1 dependency** — Phase 1 (external skills bundle install) should be restored before running Phase 3A

## Options and Tradeoffs

### Option A: Replace Entire Rules Block (Recommended)

Replace the entire `## Rules` block (after `${GIT_DISCARD_PROTECTION_RULE}`) with single canonical line.

**Approach**:
```ts
${GIT_DISCARD_PROTECTION_RULE}

## Rules

Follow the using-agent-skills skill for operating behaviors and failure mode guidance.
```

- **Pros**: Clean canonical reference, no duplication, aligns with roadmap spec
- **Cons**: Removes explicit Deck-specific rules that supplement the skill
- **Effort**: Medium — 10 files × edit = 20 edits + tests

### Option B: Append Canonical Line

Keep existing Rules and append canonical line after them.

- **Pros**: Preserves explicit Deck guidance
- **Cons**: Redundant, not what roadmap specifies
- **Effort**: Low

### Option C: Inline Reference Only

Just add a reference in a comment or instruction section.

- **Pros**: Minimal change
- **Cons**: Doesn't fulfill "canonical line in ## Rules" spec requirement
- **Effort**: Low

## Recommendation

**Select Option A** — Replace entire `## Rules` block with canonical line in all 10 target files.

**Rationale**:
1. Follows roadmap spec exactly (line 219: "Replace only `SKILL_BODY` `## Rules` block bodies")
2. Prior result was `587 pass / 0 fail` — proven approach
3. Forward-canonicalization is the intent: make skill the canonical source
4. Existing explicit rules in SKILL_BODY become redundant duplicates

**Key Technical Considerations**:
- Keep `${GIT_DISCARD_PROTECTION_RULE}` before ## Rules (not replaced)
- Preserve Serena Enforcement sections in apply agents (after ## Rules)
- Escape backticks properly (use `\`` in template literal)
- Run tests after: `bun test packages/core/src/teams/developer/`

## Open Questions

1. Should tests verify "exactly one canonical line" or "contains canonical line"?
2. Are there additional test assertions on specific rule list items?
3. Does Phase 1 need to be verified complete before Phase 3A runs?

## Ready for Proposal

**Ready**: Yes — this exploration defines the change scope accurately.

The change targets:
- 10 content files in `packages/core/src/teams/developer/`
- Replace 10 `## Rules` blocks with single canonical line
- Preserve surrounding structures (GIT_DISCARD_PROTECTION_RULE, Serena Enforcement)
- Run developer-team tests afterwards

Provide to user: proceed to Proposal phase.

---