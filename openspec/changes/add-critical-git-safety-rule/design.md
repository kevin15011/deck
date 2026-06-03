# Design: Add Critical Git Safety Rule

## Source

- Proposal: `add-critical-git-safety-rule` proposal artifact (2026-06-02)
- Capabilities affected: `developer-team-git-discard-protection` (new), `developer-team-agent-prompts` (modified), `skills-integration-roadmap` (modified)
- Spec status: not yet available (Spec runs in parallel with Design)

## Current Architecture Context

Developer Team agent prompts are emitted by TypeScript content modules under `packages/core/src/teams/developer/`. Each module exports two string constants — `<NAME>_AGENT_BODY` and `<NAME>_SKILL_BODY` — which are written into runtime agent/skill files by `content-registry.ts`. The 12 affected files in scope are:

| File | Exports |
|---|---|
| `orchestrator-content.ts` | `ORCHESTRATOR_AGENT_BODY`, `ORCHESTRATOR_SKILL_BODY` |
| `explorer-content.ts` | `EXPLORER_AGENT_BODY`, `EXPLORER_SKILL_BODY` |
| `proposal-content.ts` | `PROPOSAL_AGENT_BODY`, `PROPOSAL_SKILL_BODY` |
| `spec-content.ts` | `SPEC_AGENT_BODY`, `SPEC_SKILL_BODY` |
| `design-content.ts` | `DESIGN_AGENT_BODY`, `DESIGN_SKILL_BODY` |
| `task-content.ts` | `TASK_AGENT_BODY`, `TASK_SKILL_BODY` |
| `apply-backend-content.ts` | `APPLY_BACKEND_AGENT_BODY`, `APPLY_BACKEND_SKILL_BODY` |
| `apply-frontend-content.ts` | `APPLY_FRONTEND_AGENT_BODY`, `APPLY_FRONTEND_SKILL_BODY` |
| `apply-general-content.ts` | `APPLY_GENERAL_AGENT_BODY`, `APPLY_GENERAL_SKILL_BODY` |
| `verify-content.ts` | `VERIFY_AGENT_BODY`, `VERIFY_SKILL_BODY` |
| `review-content.ts` | `REVIEW_AGENT_BODY`, `REVIEW_SKILL_BODY` |
| `archive-content.ts` | `ARCHIVE_AGENT_BODY`, `ARCHIVE_SKILL_BODY` |

Every module has a sibling `*.test.ts` that asserts string-content invariants (placeholder detection, header presence, runtime neutrality, methodology sections). This is the established presence-check pattern — see `design-content.test.ts` and the cross-file comparison block at the end of the same file (`Design vs Proposal/Spec differentiation`).

There is precedent for canonical shared rules: `orchestrator-invariants.ts` defines `ORCHESTRATOR_INVARIANTS[]` (critical/high/standard tiers, surfaces, conditions, required actions) and a `verifyOrchestratorInvariantPresence()` helper. This same tiered invariant pattern is the strongest existing analogue for the Git safety rule.

Current state of Git safety guidance (per exploration):

- `orchestrator-content.ts` Post-Archive Git Suggestions line 242: advisory "NEVER automatically commit, push, change branches…" — does **not** block destructive discard operations.
- `orchestrator-content.ts` Recovery Rule (line 282): post-incident only.
- `docs/skills-integration-roadmap.md` (line 1–2, reconstructed 2026-06-02): flagged as "Reconstructed after working-tree reset/loss" — direct evidence that the very gap this change addresses has already caused data loss in this repository. There is no current Git safety section in the roadmap.

## Proposed Architecture

Add **one canonical, deduplicated rule text** (exported as a shared constant) and embed it in both `AGENT_BODY` and `SKILL_BODY` of each of the 12 Developer Team content modules. The rule is also embedded in the `AGENT_BODY` of the orchestrator so that user-facing prompts see it. Additionally, add a new section to the skills-integration roadmap documenting the rule, plus a centralized presence test that fails if any required surface omits the rule.

### Component / Module Boundaries

| Component | Responsibility | Change Type |
|---|---|---|
| `packages/core/src/teams/developer/git-safety.ts` (new) | Export `GIT_DISCARD_PROTECTION_RULE` constant — single source of truth, plus an `assertGitSafetyRulePresent()` helper. | new |
| `packages/core/src/teams/developer/orchestrator-content.ts` | Concatenate rule into `ORCHESTRATOR_AGENT_BODY` and `ORCHESTRATOR_SKILL_BODY`. | modified |
| `packages/core/src/teams/developer/explorer-content.ts` | Concatenate rule into both bodies. | modified |
| `packages/core/src/teams/developer/proposal-content.ts` | Concatenate rule into both bodies. | modified |
| `packages/core/src/teams/developer/spec-content.ts` | Concatenate rule into both bodies. | modified |
| `packages/core/src/teams/developer/design-content.ts` | Concatenate rule into both bodies. | modified |
| `packages/core/src/teams/developer/task-content.ts` | Concatenate rule into both bodies. | modified |
| `packages/core/src/teams/developer/apply-backend-content.ts` | Concatenate rule into both bodies. | modified |
| `packages/core/src/teams/developer/apply-frontend-content.ts` | Concatenate rule into both bodies. | modified |
| `packages/core/src/teams/developer/apply-general-content.ts` | Concatenate rule into both bodies. | modified |
| `packages/core/src/teams/developer/verify-content.ts` | Concatenate rule into both bodies. | modified |
| `packages/core/src/teams/developer/review-content.ts` | Concatenate rule into both bodies. | modified |
| `packages/core/src/teams/developer/archive-content.ts` | Concatenate rule into both bodies (highest-risk surface — archive runs after work and may be tempted to "clean up" worktrees). | modified |
| `packages/core/src/teams/developer/git-safety-presence.test.ts` (new) | Iterates over all 12 modules' exports and asserts canonical sentinel strings are present in every `*_AGENT_BODY` and `*_SKILL_BODY`. | new |
| `docs/skills-integration-roadmap.md` | Add new "Phase 3Z — Cross-cutting Git safety rule" subsection documenting rule, scope, and rationale. | modified |

The new `git-safety.ts` module is **not** a runtime-injected skill. It is a TypeScript module that the content files import at compile time, then concatenate into their emitted string constants. This keeps enforcement environment-agnostic (no launcher/shell hook) and avoids creating a new skill that may not load on every runtime adapter.

### Data Flow

```
git-safety.ts (GIT_DISCARD_PROTECTION_RULE constant)
  ↓ imported at compile time
each <name>-content.ts: <NAME>_AGENT_BODY = `${EXISTING}\n\n${GIT_DISCARD_PROTECTION_RULE}`
  ↓ emitted at content-registry composition time
runtime agent file (frontmatter + AGENT_BODY)
  ↓ loaded by agent runtime
agent receives the rule on every session
  ↓ on user request for destructive git op
agent: warn → require new-message confirmation → require exact-command repetition → execute
```

The rule is baked into the agent prompt at composition time. There is no runtime I/O, no per-session state, no telemetry. The data flow is entirely compile-time string composition → runtime prompt delivery.

### API / Contract Implications

| Endpoint / Interface | Change | Backward Compatible |
|---|---|---|
| `<NAME>_AGENT_BODY` / `<NAME>_SKILL_BODY` string exports | Append canonical rule text. All consumers in `content-registry.ts` continue to receive a string; the type is unchanged. | yes (string contract preserved) |
| `ORCHESTRATOR_INVARIANTS[]` / `verifyOrchestratorInvariantPresence()` | Unchanged. Git safety is **not** added to orchestrator invariants because the rule must be per-agent, not orchestrator-only. Adding to `ORCHESTRATOR_INVARIANTS` would create a single point of failure and contradict the proposal's "every agent" coverage decision. | n/a (no contract change) |
| New `git-safety.ts` module exports | New public surface: `GIT_DISCARD_PROTECTION_RULE: string`, `assertGitSafetyRulePresent(body: string): void` (throws on absence). | n/a (additive) |
| `docs/skills-integration-roadmap.md` | New section appended. No removals. | yes (additive) |

### State / Persistence Implications

None. The rule is content-only — no schema, no database, no session state, no migration.

### Migration / Backward Compatibility

None. The change is purely additive to content strings and the roadmap document. The rule is appended after the existing `## Non-Goals` block in each `AGENT_BODY` and after `## Rules` in each `SKILL_BODY`, preserving all prior text byte-identical (per the precedent set by `Phase 3A` in the roadmap, line 218–220: "Preserve `AGENT_BODY` byte-identical" for `SKILL_BODY`-only canonicalizations — but for this change we modify both bodies, since the rule must be visible in both).

> **Note on prior-canonicalization precedent**: Phase 3A in the roadmap restricted itself to `SKILL_BODY` only. The current change deviates intentionally because the safety rule has *visibility* requirements, not just *methodology* requirements. The proposal explicitly requires the rule to appear "in a consistent high-visibility safety section near existing role constraints/non-goals" — which sits in the agent body.

## File Impact Estimate

| File / Path | Action | Rationale |
|---|---|---|
| `packages/core/src/teams/developer/git-safety.ts` | create | Single source of truth for the canonical rule text + presence-check helper. |
| `packages/core/src/teams/developer/git-safety-presence.test.ts` | create | Centralized test that fails if any of the 24 surfaces (12 files × 2 bodies) omits the rule or a sentinel keyword. |
| `packages/core/src/teams/developer/orchestrator-content.ts` | modify | Import and append `GIT_DISCARD_PROTECTION_RULE` to both bodies. |
| `packages/core/src/teams/developer/explorer-content.ts` | modify | Same. |
| `packages/core/src/teams/developer/proposal-content.ts` | modify | Same. |
| `packages/core/src/teams/developer/spec-content.ts` | modify | Same. |
| `packages/core/src/teams/developer/design-content.ts` | modify | Same. |
| `packages/core/src/teams/developer/task-content.ts` | modify | Same. |
| `packages/core/src/teams/developer/apply-backend-content.ts` | modify | Same. |
| `packages/core/src/teams/developer/apply-frontend-content.ts` | modify | Same. |
| `packages/core/src/teams/developer/apply-general-content.ts` | modify | Same. |
| `packages/core/src/teams/developer/verify-content.ts` | modify | Same. |
| `packages/core/src/teams/developer/review-content.ts` | modify | Same. |
| `packages/core/src/teams/developer/archive-content.ts` | modify | Same (highest-risk — sees completed work). |
| `docs/skills-integration-roadmap.md` | modify | New "Phase 3Z — Cross-cutting Git safety rule" subsection. |
| `openspec/changes/add-critical-git-safety-rule/design.md` | create (this file) | Required Design artifact. |

**Total**: 2 new files, 14 modifications.

## Testing Strategy

Three test layers, all environment-agnostic and runtime-free:

1. **Per-file content tests** (modifications to existing `*.test.ts` files): each existing test file already imports its `*_AGENT_BODY` and `*_SKILL_BODY`. Add one or two assertions to each: e.g., `expect(BODY).toContain("CRITICAL SAFETY RULE — Git Discard Protection")` and `expect(BODY).toContain("git reset --hard")` (sentinel for command coverage). This pattern matches the existing `does not contain old artifact-store mode selection` test style at `design-content.test.ts:160-165`.

2. **Centralized cross-agent presence test** (new `git-safety-presence.test.ts`): imports the new `assertGitSafetyRulePresent()` helper from `git-safety.ts`, iterates over a static list of all 12 modules' 24 body exports, and asserts the rule is present. This is a *fail-fast single test* that catches any missed file or body. Mirrors the cross-file comparison block at `design-content.test.ts:208-239`.

3. **Roadmap presence test** (new or appended in the centralized test): reads `docs/skills-integration-roadmap.md` and asserts a sentinel phrase such as "Critical Git Discard Protection" appears at least once. This prevents roadmap drift from the prompt implementation (one of the proposal's explicit risks, line 60).

4. **Rule-content structural test** (in `git-safety.test.ts`): asserts the canonical rule text contains all required families — `git reset`, `git restore`, `git checkout --`, `git clean`, `git stash drop`, history-rewriting rebase — and contains the four required behavior elements from the proposal acceptance direction (line 85): explicit warning, new-message confirmation, exact-command repetition, supersedence over conflicting instructions.

Test execution: `bun test packages/core/src/teams/developer/git-safety-presence.test.ts` and `bun test packages/core/src/teams/developer/` (full developer-team suite) per the existing pattern in `docs/skills-integration-roadmap.md` Section 5.

No new test framework, no new dependencies, no e2e tests (the change is content-only).

## Observability / Error Handling

None. The rule is content-only; there is no runtime behavior, no logging, no monitoring surface. Failure of the presence test is the only signal, and it surfaces at `bun test` time, not at runtime.

## Security / Performance / Accessibility Considerations

- **Security**: The change *adds* a security control. No new attack surface.
- **Performance**: Negligible — adds ~1.5KB of text to each of 24 string constants. No runtime cost beyond prompt-token budget.
- **Accessibility**: N/A — agent prompts are not user-facing UI.

## Tradeoffs

| Decision | Chosen | Rejected Alternative | Rationale |
|---|---|---|---|
| Rule text source | Single shared `GIT_DISCARD_PROTECTION_RULE` constant in `git-safety.ts`, concatenated at compile time. | Copy-paste identical block into each of the 24 surfaces. | DRY without runtime coupling. Test must still check all 24 surfaces, but a typo in one file no longer drifts from the others. |
| Surface scope | Both `AGENT_BODY` and `SKILL_BODY` of every Developer Team agent. | Only `SKILL_BODY` (per Phase 3A precedent). | The rule has *visibility* requirements, not just methodology. Proposal explicitly requires high-visibility placement. |
| Module location | New `git-safety.ts` sibling to the content modules. | Add to `orchestrator-invariants.ts` as `INV-007`. | The rule must be per-agent, not orchestrator-only. Putting it in `ORCHESTRATOR_INVARIANTS` would create single-point-of-failure. |
| Skill creation | None. | Standalone `git-safety` skill loaded at runtime. | Proposal explicitly rejected this (line 24) — requires new skill/runtime-loading assumptions; risks under-enforcement. |
| Roadmap placement | New "Phase 3Z" subsection documenting the cross-cutting rule. | New "Safety" section above all phases. | Matches the existing phase-numbered structure; a "Phase 3Z" insertion point is unambiguous and avoids renumbering. |
| Test strategy | Centralized presence test + per-file assertions + roadmap assertion. | Single per-file test. | Defense in depth: a centralized test catches missed files immediately; per-file tests localize failures. |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Drift between canonical constant and per-file expectations | Low | Medium | Test asserts both the constant value and its presence in each body. A drift in the constant breaks every per-file assertion, not just the centralized one. |
| Rule text loses required coverage if someone edits the constant | Low | High | Structural test asserts presence of all required destructive-command families inside `GIT_DISCARD_PROTECTION_RULE`. |
| Roadmap drifts from prompt implementation over time | Low | Low | Roadmap presence test asserts the rule name appears in the markdown file. |
| Over-blocking legitimate user operations | Medium | Medium | The rule includes an explicit informed-confirmation exception path (warn → new-message confirmation → exact-command repetition). Proposal line 80: "Require explicit user confirmation in a new message." |
| Test files add maintenance burden (24 surface checks) | Low | Low | Centralized test does the bulk; per-file assertions are 1–2 lines each. |
| Rule appears in `AGENT_BODY` only, missing `SKILL_BODY` (or vice versa) | Low | Medium | Centralized test loops over both bodies explicitly; one of the 24 checks will fail. |

## Open Decisions

- **Exact command enumeration** in the canonical rule: the proposal lists the destructive families (line 16) but does not pin the exact strings. Spec phase will own the exact list and the sentinel test keywords; Design here constrains the test contract to require `git reset --hard` (or equivalent) plus one sentinel from each of the other families to detect partial coverage.
- **Whether Orchestrator's `SYSTEM_PROMPT` surface also receives the rule** (one of the proposal's open questions, line 76). Proposal framing suggests yes; current design adds it to both orchestrator `*_BODY` constants. If Spec decides the orchestrator system-prompt surface also needs the rule injected at session start, Task will add a small augmentation in `content-registry.ts` — flagged here so the decision is tracked.
- **Whether checkout branch switching is scoped to only forms that discard or obscure uncommitted work** (proposal open question, line 78). Decision deferred to Spec.

## Dependencies

- Existing Developer Team prompt source files under `packages/core/src/teams/developer/` (12 files, all listed above).
- Existing roadmap document `docs/skills-integration-roadmap.md`.
- Existing test framework: `bun:test` (assertions only, no new framework).
- `orchestrator-invariants.ts` pattern (referenced as architectural precedent, not modified by this change).

## Next Steps

Ready for Task (`deck-developer-task`) to break this design into implementation tasks, combined with Spec.

## Mermaid Summary Source

```mermaid
flowchart LR
  Constant["git-safety.ts<br/>GIT_DISCARD_PROTECTION_RULE"] --> Compose
  subgraph Compose["compile-time string composition"]
    direction TB
    Compose --> Orchestrator["orchestrator-content.ts<br/>(AGENT_BODY + SKILL_BODY)"]
    Compose --> Specialist["explorer/proposal/spec/design/task/<br/>apply-backend/apply-frontend/apply-general/<br/>verify/review/archive-content.ts<br/>(AGENT_BODY + SKILL_BODY each)"]
  end
  Compose --> Registry["content-registry.ts<br/>emits to runtime agent files"]
  Registry --> Runtime["agent runtime<br/>(enforces rule on every session)"]
  Tests["git-safety-presence.test.ts<br/>(24 surface assertions)"] -.->|asserts| Compose
  Tests -.->|asserts| Constant
  Tests -.->|asserts roadmap mention| Roadmap["docs/skills-integration-roadmap.md<br/>(Phase 3Z subsection)"]
  Roadmap -.->|documents| Constant
```
