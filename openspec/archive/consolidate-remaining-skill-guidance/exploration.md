# Exploration: consolidate-remaining-skill-guidance

## Goal

Analyze redundancy between 15 external skills (Phase 3F + no-op candidates) and Developer Team inline instructions, producing a per-skill/per-agent consolidation matrix with concrete replace/keep/add/no-op recommendations.

## Current State

Phases 3A–3C completed. Current inline references in content modules:

- `using-agent-skills` → referenced in all 10 apply/plan/verify/review agents (3A)
- `cognitive-doc-design` → referenced in explorer/proposal/spec/design/task/review/verify (3B)
- `code-review-and-quality` → referenced in Review Agent (3C)
- `api-and-interface-design` → referenced in apply-backend, apply-general, design, spec, review (3D)
- `documentation-and-adrs` → referenced in apply-backend, apply-frontend, apply-general, explorer, proposal, design, review (3E)

Remaining skills to evaluate:

1. `frontend-ui-engineering`
2. `test-driven-development`
3. `debugging-and-error-recovery`
4. `security-and-hardening`
5. `performance-optimization`
6. `deprecation-and-migration`
7. `idea-refine`
8. `interview-me`
9. `git-workflow-and-versioning`
10. `doubt-driven-development`
11. `ci-cd-and-automation`
12. `code-simplification`
13. `comment-writer`
14. `shipping-and-launch`
15. `judgment-day`

Target agents: apply-frontend, apply-backend, apply-general, explorer, proposal, spec, design, task, verify, review, archive, orchestrator.

## Relevant Files

- `docs/skills-integration-roadmap.md` — Phase 3F scope and intended targets/overlap
- `.opencode/skills/*/SKILL.md` — external skill sources of truth
- `packages/core/src/teams/developer/*-content.ts` — inline agent/skill bodies
- `packages/core/src/teams/developer/review-content.ts` — Phase 3C survivor, shows canonical reference pattern

## Constraints

- Must preserve artifact-specific output templates, return contracts, and registry behavior.
- Must not add references to interactive-only skills into autonomous agent bodies where the interaction model is impossible.
- Must follow roadmap targets where they make sense; flag mismatches rather than mechanically obey.
- Must not remove prior phase references (3A–3E).
- Git safety rule is non-negotiable and already centralized in `git-safety.ts`.

## Risks

- **Interaction-model mismatch**: Some skills (`interview-me`, `idea-refine`) require live user dialogue. Autonomous agents cannot use them; adding references would be dead guidance.
- **Scope creep**: Adding a skill reference where overlap is low inflates prompts without value.
- **Contract dilution**: Replacing too much inline guidance with a generic skill reference could weaken agent identity or artifact contracts.
- **Test fragility**: Adding new canonical reference lines requires updating structural tests; missed tests would fail in Verify.

## Options and Tradeoffs

1. **Mechanical blanket-reference** — Add every skill to every roadmap-targeted agent.
   - Pros: Fast, uniform.
   - Cons: Wastes tokens on mismatched skills, violates interaction-model constraints, weakens contracts.
   - Effort: Low

2. **Selective reference with contract preservation** — Add skill references only where overlap is substantial and the agent can actually use the skill; preserve inline contracts.
   - Pros: Reduces redundancy where it exists, keeps agent identity sharp.
   - Cons: Requires careful per-skill/per-agent analysis.
   - Effort: Medium

3. **No-op for all Phase 3F** — Treat roadmap as aspirational and skip.
   - Pros: Zero risk.
   - Cons: Misses real consolidation opportunities (frontend-ui-engineering, security-and-hardening, performance-optimization, test-driven-development).
   - Effort: Low

## Recommendation

Adopt **Option 2 (Selective reference with contract preservation)**. Add references for skills with genuine methodological overlap, preserve all inline contracts, and explicitly no-op skills where the interaction model mismatches or overlap is negligible.

## Open Questions

- Should `test-driven-development` also be referenced by Task Agent (it defines per-task Verification fields) or only Apply agents?
- Should `git-workflow-and-versioning` be referenced by Apply agents (they commit code) despite the roadmap targeting Orchestrator?

## Ready for Proposal

Yes. The matrix below provides sufficient evidence to write a scoped Proposal.

## Registry

- **Artifact Path**: `openspec/changes/consolidate-remaining-skill-guidance/exploration.md`
- **State Path**: `openspec/changes/consolidate-remaining-skill-guidance/state.yaml`
- **Events Path**: `openspec/changes/consolidate-remaining-skill-guidance/events.yaml`
- **Recorded**: phase `explore`, status `completed`, event `exploration-completed`
- **Registry Blocker**: none

---

## Appendix: Per-Skill / Per-Agent Consolidation Matrix

### How to read the matrix

- **Inline Overlap**: What the agent currently says that mirrors the external skill.
- **Add Reference?**: `Yes` / `Conditional` / `No`
- **Preserve Inline Contract?**: `Yes` (artifact templates, return formats, registry rules must stay).
- **Action**: `Replace` (remove overlapping inline prose, add canonical line) / `Add` (insert canonical line alongside existing) / `Keep` (leave as-is) / `No-op`
- **Rationale**: Why this decision was made.

---

### 1. `frontend-ui-engineering`

| Agent | Inline Overlap | Add Reference? | Preserve Contract? | Action | Rationale |
|---|---|---|---|---|---|
| apply-frontend | Accessibility, error/loading/empty states mentioned in Step 2. | Yes | Yes | Add | High overlap. Skill provides canonical component architecture, design-system adherence, accessibility (WCAG 2.1 AA), responsive design, loading patterns. Agent’s inline guidance is too thin. Add canonical line in SKILL_BODY `## Rules`. Preserve implementation steps and return format. |
| review | Frontend Best Practices dimension covers accessibility, state, performance, component design. | Yes | Yes | Add | Overlap in review criteria. Skill provides deeper methodology. Add reference in SKILL_BODY `## Rules` or alongside Frontend Best Practices. Preserve dimension ratings and findings format. |
| verify | None. Verify checks compliance (tests/build/typecheck), not UI engineering quality. | No | Yes | No-op | Verify does not assess UI quality; it maps requirements to pass/fail. Adding reference would be out of scope. |
| All others | None. | No | Yes | No-op | No overlap with backend/general/planning agents. |

### 2. `test-driven-development`

| Agent | Inline Overlap | Add Reference? | Preserve Contract? | Action | Rationale |
|---|---|---|---|---|---|
| apply-backend | Step 3 says "run backend tests" with no methodology. | Yes | Yes | Add | High overlap. Skill defines RED-GREEN-REFACTOR, Prove-It pattern, test pyramid, DAMP over DRY, real-over-mocks. Agent currently just says "run tests." Add canonical reference in SKILL_BODY `## Rules`. Preserve verification step and artifact format. |
| apply-frontend | Step 3 says "run frontend tests" with no methodology. | Yes | Yes | Add | Same as backend. Skill covers browser testing with DevTools, subagent testing patterns. Add reference. Preserve artifact format. |
| apply-general | Step 3 says "run unit tests" with no methodology. | Yes | Yes | Add | Same rationale. Add reference. Preserve artifact format. |
| task | Task format includes `Verification` field per task, but no test authoring guidance. | Conditional | Yes | Keep | Task routes work; it does not write tests. Minimal overlap. No reference needed unless we want Task to recommend TDD to Apply owners in task descriptions — that would be an invasive change. Keep as-is. |
| verify | Runs tests but does not author them. | No | Yes | No-op | Verify executes and records results; TDD is about authoring. No meaningful overlap. |
| All others | None. | No | Yes | No-op | No overlap. |

### 3. `debugging-and-error-recovery`

| Agent | Inline Overlap | Add Reference? | Preserve Contract? | Action | Rationale |
|---|---|---|---|---|---|
| verify | Runs tests/build; when they fail, classify findings. | No | Yes | No-op | The roadmap lists Verify as target, but Verify does not debug — it reports compliance. Debugging is an Apply-agent responsibility. Adding reference here would misplace the skill. Recommend no-op; if needed, target Apply agents instead. |
| apply-backend / apply-frontend / apply-general | Step 3 says "If verification fails, fix the issue or report it as a blocker." | Conditional | Yes | Keep | These agents are the ones who would actually debug. However, their current instructions are intentionally minimal to stay focused. Adding a full debugging skill reference might bloat their context. The roadmap did not explicitly target Apply agents. Keep as-is unless a future phase decides otherwise. |
| All others | None. | No | Yes | No-op | No overlap. |

### 4. `security-and-hardening`

| Agent | Inline Overlap | Add Reference? | Preserve Contract? | Action | Rationale |
|---|---|---|---|---|---|
| review | Security dimension asks: input validation, auth, secrets, injection, exposure. | Yes | Yes | Add | High overlap. The Review agent’s security bullets are a summary; the skill provides canonical OWASP guidance, boundary validation, secrets management, rate limiting, audit triage. Add canonical reference in SKILL_BODY `## Rules`. Preserve ratings/findings format and severity labels. |
| All others | None. | No | Yes | No-op | Other agents do not perform security review. |

### 5. `performance-optimization`

| Agent | Inline Overlap | Add Reference? | Preserve Contract? | Action | Rationale |
|---|---|---|---|---|---|
| review | Scalability dimension asks "Will this perform under load?" Frontend Best Practices asks about re-renders, bundle size, lazy loading. | Yes | Yes | Add | High overlap. Skill provides measurement workflow, Core Web Vitals, anti-patterns (N+1, unbounded fetching, image optimization, React.memo misuse), performance budgets. Add canonical reference in SKILL_BODY `## Rules`. Preserve dimension ratings and findings format. |
| verify | None. | No | Yes | No-op | Verify checks compliance, not performance engineering. |
| All others | None. | No | Yes | No-op | No overlap. |

### 6. `deprecation-and-migration`

| Agent | Inline Overlap | Add Reference? | Preserve Contract? | Action | Rationale |
|---|---|---|---|---|---|
| proposal | Alternatives and Tradeoffs section; rollback plan. | Conditional | Yes | Keep | Overlap exists for migration-type proposals, but not all proposals involve deprecation. Adding a blanket reference would be noise. Conditional: add a note in `## Rules` such as "For changes involving replacement or removal of existing systems, follow the deprecation-and-migration skill." Preserve template. |
| design | Migration / Backward Compatibility section in output template. | Conditional | Yes | Add | Design artifact explicitly includes migration. Skill provides canonical patterns (strangler, adapter, feature flags) and decision framework. Add reference in SKILL_BODY `## Rules`. Preserve template. |
| task | None. | No | Yes | No-op | Task routes implementation; it does not plan migrations. |
| All others | None. | No | Yes | No-op | No overlap. |

### 7. `idea-refine`

| Agent | Inline Overlap | Add Reference? | Preserve Contract? | Action | Rationale |
|---|---|---|---|---|---|
| explorer | Step 3 produces Options and Tradeoffs; return format includes Recommendation and Open Questions. | No | Yes | No-op | Roadmap targets Explorer, but `idea-refine` is an **interactive user-dialogue skill** (requires `AskUserQuestion`, 3 phases with user reactions). Explorer is an autonomous delegated agent that cannot engage in live user conversation. The interaction model is incompatible. The Explorer already has its own concise options/tradeoffs format. No-op. |
| All others | None. | No | Yes | No-op | No overlap. |

### 8. `interview-me`

| Agent | Inline Overlap | Add Reference? | Preserve Contract? | Action | Rationale |
|---|---|---|---|---|---|
| explorer | Step 1 says "If the request is too vague, say so clearly and return what clarification is needed." | No | Yes | No-op | `interview-me` is an **interactive user-dialogue skill** requiring live one-question-at-a-time conversation until 95% confidence. Autonomous agents cannot run it. The best they can do is flag vagueness in their return format. Adding a reference would be misleading. |
| proposal | Step 1 says "If the request is too vague, say so clearly..." | No | Yes | No-op | Same interaction-model mismatch. |
| spec | "If the proposal is unclear... flag it as a blocker." | No | Yes | No-op | Same interaction-model mismatch. |
| All others | None. | No | Yes | No-op | No overlap. |

### 9. `git-workflow-and-versioning`

| Agent | Inline Overlap | Add Reference? | Preserve Contract? | Action | Rationale |
|---|---|---|---|---|---|
| orchestrator | Post-Archive Git Suggestions section (conventional commits, PR suggestions). | No | Yes | Keep | Roadmap explicitly says "Likely keep inline for Orchestrator post-archive git suggestions." The Orchestrator only makes **advisory** suggestions; it does not execute git workflows. The skill covers trunk-based development, atomic commits, branching, worktrees, pre-commit hygiene — all of which are execution guidance, not coordination guidance. Keep inline as-is. No reference needed. |
| apply-backend / apply-frontend / apply-general | None. | No | Yes | No-op | These agents write code but do not have git workflow guidance inline. However, the roadmap does not target them. If a future phase wants to add git discipline to Apply agents, this skill would be the source. For now, no-op. |
| All others | None. | No | Yes | No-op | No overlap. |

### 10. `doubt-driven-development`

| Agent | Inline Overlap | Add Reference? | Preserve Contract? | Action | Rationale |
|---|---|---|---|---|---|
| orchestrator | Delegation triggers, self-verification, orchestrator verification. | No | Yes | Keep | Roadmap explicitly says "Likely keep Orchestrator invariants inline; they are Deck-specific triggers." The Orchestrator’s verification rules are already a form of in-flight quality gate. Doubt-driven is designed for **main-session** use with cross-model escalation; it is not appropriate for the Orchestrator agent body. Keep inline. |
| review | Post-hoc engineering quality review. | No | Yes | Keep | Doubt-driven is **in-flight** adversarial review; Review is **post-hoc** verdict. They are complementary but distinct. The Review agent already references `code-review-and-quality`. Adding doubt-driven would confuse the timeline. Keep as-is. |
| All others | None. | No | Yes | No-op | No overlap. |

### 11. `ci-cd-and-automation`

| Agent | Inline Overlap | Add Reference? | Preserve Contract? | Action | Rationale |
|---|---|---|---|---|---|
| All | None. | No | Yes | No-op | Roadmap says "Minimal redundancy. Mostly complementary." The SDD agents do not set up CI/CD pipelines. This skill is for infrastructure/setup tasks outside the SDD workflow. No inline overlap. |

### 12. `code-simplification`

| Agent | Inline Overlap | Add Reference? | Preserve Contract? | Action | Rationale |
|---|---|---|---|---|---|
| All | None. | No | Yes | No-op | Roadmap says "Minimal redundancy. Applies when explicit simplification/refactor task exists." The Apply agents say "Make minimal changes. Do not refactor unrelated code." They do not simplify as a primary activity. Review checks readability but does not simplify. No reference needed inline. The skill can be injected by the Orchestrator when the task context explicitly calls for refactoring. |

### 13. `comment-writer`

| Agent | Inline Overlap | Add Reference? | Preserve Contract? | Action | Rationale |
|---|---|---|---|---|---|
| All | None. | No | Yes | No-op | Roadmap says "No significant Developer Team prompt redundancy; for human-facing comments." The Review agent produces structured findings, not social comments. No overlap. |

### 14. `shipping-and-launch`

| Agent | Inline Overlap | Add Reference? | Preserve Contract? | Action | Rationale |
|---|---|---|---|---|---|
| All | None. | No | Yes | No-op | Roadmap says "No significant SDD prompt redundancy; production launch phase." The SDD workflow ends at Archive. Shipping is a separate operational phase. No overlap. |

### 15. `judgment-day`

| Agent | Inline Overlap | Add Reference? | Preserve Contract? | Action | Rationale |
|---|---|---|---|---|---|
| All | None. | No | Yes | No-op | Roadmap says "No consolidation needed; unique adversarial dual-review workflow." It is already a standalone skill. No inline overlap with any SDD agent. |

---

## Summary Table (Actionable Changes Only)

| Skill | Agents to Modify | Action |
|---|---|---|
| `frontend-ui-engineering` | apply-frontend, review | Add reference in SKILL_BODY `## Rules` |
| `test-driven-development` | apply-backend, apply-frontend, apply-general | Add reference in SKILL_BODY `## Rules` |
| `security-and-hardening` | review | Add reference in SKILL_BODY `## Rules` |
| `performance-optimization` | review | Add reference in SKILL_BODY `## Rules` |
| `deprecation-and-migration` | design (always), proposal (conditional note) | Add reference in SKILL_BODY `## Rules` / conditional note |

All other skills: **No-op** for all agents.

## Files Potentially Affected

- `packages/core/src/teams/developer/apply-frontend-content.ts` — add `frontend-ui-engineering` reference
- `packages/core/src/teams/developer/apply-backend-content.ts` — add `test-driven-development` reference
- `packages/core/src/teams/developer/apply-general-content.ts` — add `test-driven-development` reference
- `packages/core/src/teams/developer/review-content.ts` — add `frontend-ui-engineering`, `security-and-hardening`, `performance-optimization` references
- `packages/core/src/teams/developer/design-content.ts` — add `deprecation-and-migration` reference
- `packages/core/src/teams/developer/proposal-content.ts` — conditional note for `deprecation-and-migration`
- Corresponding `.test.ts` files — assert canonical reference presence

## Verification Approach

- Structural tests assert exact canonical reference line once per target file.
- No bullet-wrapped/indented versions.
- Developer-team test suite passes (`bun test packages/core/src/teams/developer/`).
- No product code or configuration modified.
