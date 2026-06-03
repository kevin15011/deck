# Design: Consolidate Using-Agent-Skills Guidance

## Source

- Proposal: `consolidate-using-agent-skills` proposal artifact (Phase 3A)
- Capabilities affected: `developer-team-prompt-canonicalization` (modified)
- Spec status: not yet available (Design runs in parallel with Spec)

## Current Architecture Context

### Target File Structure (verified)

All 10 target files in `packages/core/src/teams/developer/` share a structurally identical shape:

```
import { GIT_DISCARD_PROTECTION_RULE } from "./git-safety";

export const {NAME}_AGENT_BODY = `
  ...
  ${GIT_DISCARD_PROTECTION_RULE}      ← appears once in AGENT_BODY
  ...
`;

export const {NAME}_SKILL_BODY = `
  ...
  ${GIT_DISCARD_PROTECTION_RULE}      ← appears once in SKILL_BODY (just before ## Rules)
  ## Rules

  - {bullet 1}
  - {bullet 2}
  ...
  - {bullet N}                        ← 8-12 phase-specific bullets
`;
```

Verified anchor points (`## Rules` line numbers and `## Serena Enforcement` presence):

| File | `## Rules` line | Has `## Serena Enforcement` |
|---|---|---|
| `apply-backend-content.ts` | 228 | yes (line 243) |
| `apply-frontend-content.ts` | 232 | yes |
| `apply-general-content.ts` | 226 | yes |
| `proposal-content.ts` | 271 | no |
| `spec-content.ts` | 365 | no |
| `design-content.ts` | 326 | no |
| `task-content.ts` | 397 | no |
| `review-content.ts` | 306 | no |
| `verify-content.ts` | 275 | no |
| `archive-content.ts` | 300 | no |

Each `## Rules` block contains between 8 and 12 phase-specific bullets whose semantic content is **duplicated across files** and overlaps with the generic operating-behaviors and failure-mode guidance in `packages/core/src/skills/external/using-agent-skills/SKILL.md`.

### Existing Test Surface

- `packages/core/src/teams/developer/git-safety.test.ts`:
  - Line 104 — `each surface contains exact canonical GIT_DISCARD_PROTECTION_RULE text` iterates exported body constants and asserts the rule text appears verbatim. This test continues to pass because `${GIT_DISCARD_PROTECTION_RULE}` interpolation is preserved immediately before the new minimal `## Rules` block.
  - Lines 130-151 — "completeness" test iterates `*.ts` files in the directory and asserts each imports the rule. All 10 target files already import; no import changes required.
- Per-content `*-content.test.ts` files assert against `AGENT_BODY` and `SKILL_BODY` headings, terminal behavior, and presence of method-specific keywords. **None** assert against the SKILL_BODY `## Rules` bullets, so removing the bullets is test-safe.

### Canonical Source

- `packages/core/src/skills/external/using-agent-skills/SKILL.md` is the canonical source for the operating-behaviors and failure-mode guidance (sections: *Core Operating Behaviors* lines 43-111; *Failure Modes to Avoid* lines 112-126). It is excluded from modification per the proposal.

## Proposed Architecture

### Approach (chosen — Option A from exploration)

Replace the body of every `SKILL_BODY` `## Rules` block across the 10 target files with the **exact canonical line**:

```
Follow the using-agent-skills skill for operating behaviors and failure mode guidance.
```

The replacement is byte-precise. No bullet wrapping, indentation, or trailing punctuation is added. The line is placed immediately after the existing `## Rules` heading and immediately after the preserved `${GIT_DISCARD_PROTECTION_RULE}` interpolation.

For the three apply agents (`apply-backend`, `apply-frontend`, `apply-general`), the `## Serena Enforcement` block follows the canonicalized Rules block **unchanged**.

### Component / Module Boundaries

| Component | Responsibility | Change Type |
|---|---|---|
| `packages/core/src/teams/developer/apply-backend-content.ts` | Apply-backend SKILL_BODY `## Rules` body | modified |
| `packages/core/src/teams/developer/apply-frontend-content.ts` | Apply-frontend SKILL_BODY `## Rules` body | modified |
| `packages/core/src/teams/developer/apply-general-content.ts` | Apply-general SKILL_BODY `## Rules` body | modified |
| `packages/core/src/teams/developer/proposal-content.ts` | Proposal SKILL_BODY `## Rules` body | modified |
| `packages/core/src/teams/developer/spec-content.ts` | Spec SKILL_BODY `## Rules` body | modified |
| `packages/core/src/teams/developer/design-content.ts` | Design SKILL_BODY `## Rules` body | modified |
| `packages/core/src/teams/developer/task-content.ts` | Task SKILL_BODY `## Rules` body | modified |
| `packages/core/src/teams/developer/review-content.ts` | Review SKILL_BODY `## Rules` body | modified |
| `packages/core/src/teams/developer/verify-content.ts` | Verify SKILL_BODY `## Rules` body | modified |
| `packages/core/src/teams/developer/archive-content.ts` | Archive SKILL_BODY `## Rules` body | modified |
| `packages/core/src/teams/developer/*-content.test.ts` (10 files) | New test case asserting canonical line presence and absence of bullet/duplicate variants | modified (additive) |
| `packages/core/src/teams/developer/git-safety.ts` | `GIT_DISCARD_PROTECTION_RULE` constant | unchanged |
| `packages/core/src/skills/external/using-agent-skills/SKILL.md` | Canonical guidance source | unchanged (out of scope) |
| `packages/core/src/teams/developer/orchestrator-content.ts` | Orchestrator agent/skill body | unchanged (out of scope) |
| `packages/core/src/teams/developer/explorer-content.ts` | Explorer agent/skill body | unchanged (out of scope) |
| `packages/core/src/teams/developer/visual-explanations-content.ts` | Visual explanations | unchanged (out of scope) |
| `packages/core/src/skills/external/content.generated.ts` | Generated bundle | unchanged (generated artifact) |

### Data Flow

Not applicable. This change is a prompt-text refactor that does not alter runtime data flow, agent invocation, skill loading, or registry behavior. The Developer Team orchestrator continues to inject agent/skill bodies into runtime prompts unchanged; the `using-agent-skills` skill is loaded by runtimes that resolve `Skill:` discovery at session start (existing behavior).

### API / Contract Implications

| Endpoint / Interface | Change | Backward Compatible |
|---|---|---|
| Exported `{NAME}_AGENT_BODY` constants (10 files) | None — bodies unchanged | yes |
| Exported `{NAME}_SKILL_BODY` constants (10 files) | `## Rules` body replaced with canonical line; no signature or surrounding section changes | yes (text-level; contract unchanged) |
| `GIT_DISCARD_PROTECTION_RULE` export | None | yes |
| `assertGitSafetyRulePresent` helper | None | yes |
| Per-agent prompt contract (orchestrator ↔ apply/spec/...) | None | yes |
| Spec Registry artifact paths and event schema | None | yes |

### State / Persistence Implications

None. No data model, schema, storage, or state-management change. The change is bounded to two template literals per file (10 files × 1 body = 10 template-literal edits + 10 test additions).

### Migration / Backward Compatibility

None required. The change is non-breaking:

- All `AGENT_BODY` outputs are byte-identical to current state.
- All `SKILL_BODY` outputs retain the section structure (`## Rules` heading + body) and downstream consumers that scan for the heading continue to find it.
- Consumers that previously parsed the bullet list of generic rules are expected to consult `using-agent-skills` (the canonical source) instead — a documentation-level migration that does not require code changes elsewhere because no in-tree consumer parses these bullets.
- No feature flag, version bump, or phased rollout needed.

## File Impact Estimate

| File / Path | Action | Rationale |
|---|---|---|
| `packages/core/src/teams/developer/apply-backend-content.ts` | modify | Replace `SKILL_BODY` `## Rules` body (lines ~229-241) with canonical line; keep `## Serena Enforcement` (line ~243) intact |
| `packages/core/src/teams/developer/apply-frontend-content.ts` | modify | Same pattern, Serena Enforcement preserved |
| `packages/core/src/teams/developer/apply-general-content.ts` | modify | Same pattern, Serena Enforcement preserved |
| `packages/core/src/teams/developer/proposal-content.ts` | modify | Replace `## Rules` body only |
| `packages/core/src/teams/developer/spec-content.ts` | modify | Replace `## Rules` body only |
| `packages/core/src/teams/developer/design-content.ts` | modify | Replace `## Rules` body only |
| `packages/core/src/teams/developer/task-content.ts` | modify | Replace `## Rules` body only |
| `packages/core/src/teams/developer/review-content.ts` | modify | Replace `## Rules` body only |
| `packages/core/src/teams/developer/verify-content.ts` | modify | Replace `## Rules` body only |
| `packages/core/src/teams/developer/archive-content.ts` | modify | Replace `## Rules` body only |
| `packages/core/src/teams/developer/apply-backend-content.test.ts` | modify (additive) | Add test asserting canonical line present exactly once and bullet count is 0 in SKILL_BODY Rules |
| `packages/core/src/teams/developer/apply-frontend-content.test.ts` | modify (additive) | Same |
| `packages/core/src/teams/developer/apply-general-content.test.ts` | modify (additive) | Same |
| `packages/core/src/teams/developer/proposal-content.test.ts` | modify (additive) | Same |
| `packages/core/src/teams/developer/spec-content.test.ts` | modify (additive) | Same |
| `packages/core/src/teams/developer/design-content.test.ts` | modify (additive) | Same |
| `packages/core/src/teams/developer/task-content.test.ts` | modify (additive) | Same |
| `packages/core/src/teams/developer/review-content.test.ts` | modify (additive) | Same |
| `packages/core/src/teams/developer/verify-content.test.ts` | modify (additive) | Same |
| `packages/core/src/teams/developer/archive-content.test.ts` | modify (additive) | Same |

Total: **10 modified content files + 10 modified test files = 20 files**. No creates, no deletes.

## Testing Strategy

Two complementary test layers, both additively added to existing `*-content.test.ts`:

1. **Per-file canonical-line test** (added in each `*-content.test.ts`):
   - Assert `{NAME}_SKILL_BODY` contains the exact canonical line.
   - Assert the canonical line appears **exactly once** (catches accidental duplicates from copy-paste).
   - Assert no bullet-wrapped, indented, or trailing-punctuation variants exist (regex sweep).
   - Assert `{NAME}_AGENT_BODY` does **not** contain the canonical line (preserves AGENT_BODY non-goal).

2. **Per-file structural-preservation test** (extend the canonical-line test):
   - Assert `{NAME}_SKILL_BODY` still contains `## Rules` heading (heading preserved).
   - Assert the substring between `${GIT_DISCARD_PROTECTION_RULE}` and the closing backtick of `## Rules` body is the canonical line only (no leftover bullets).

3. **Apply-agent Serena-preservation test** (added to the 3 apply tests):
   - Assert `## Serena Enforcement` heading and the `Symbolic editing priority` bullet are still present.

4. **Existing `git-safety.test.ts`**:
   - Unmodified; must continue to pass because `${GIT_DISCARD_PROTECTION_RULE}` is preserved at every occurrence (verified by reading the test, lines 104-151).

5. **Exclusion verification** (one focused test added to the directory or to a single representative content test):
   - Assert `orchestrator-content.ts`, `explorer-content.ts`, `visual-explanations-content.ts` are **unchanged** in their `## Rules` body content (snapshot or hash the bullet list, or assert they still contain the existing rule text).

Verification command (Developer Team focused tests, Bun):

```
bun test packages/core/src/teams/developer/
```

## Observability / Error Handling

None specific to this change. The replacement is a text-only refactor; runtime behavior, error paths, and logging are unchanged. No new metrics, no new error types.

## Security / Performance / Accessibility Considerations

- **Security**: The git-safety rule remains in every file at the same position, so REQ-GDP-001 through REQ-GDP-008 (per the `git-safety.ts` comment) remain satisfied. No new code paths, no new permission surface.
- **Performance**: No runtime impact — the body string becomes slightly shorter, reducing token volume marginally per agent invocation.
- **Accessibility**: Not applicable (prompt-text content, not user-facing UI).

## Tradeoffs

| Decision | Chosen | Rejected Alternative | Rationale |
|---|---|---|---|
| Replace `## Rules` body with canonical line | Option A — full body replacement | Option B — append canonical line after existing bullets | Option A matches the Phase 3A roadmap ("Replace only `SKILL_BODY` `## Rules` block bodies") and eliminates duplication. Option B keeps redundant inline rules. |
| Replace body only, preserve `## Rules` heading | Heading preserved | Drop the heading entirely | The heading is the structural anchor consumers look for; keeping it preserves test-ability and forward-compatibility for any future per-agent rule addendum. |
| Keep `${GIT_DISCARD_PROTECTION_RULE}` immediately before `## Rules` | Rule stays where it is | Move rule into the body of the canonical line | The rule is a critical safety invariant with its own scope; mixing it with the canonical reference would weaken the contract that `git-safety.test.ts` enforces. |
| New per-file canonical-line test (additive) | Additive | Modify existing per-file tests | Additive tests isolate Phase 3A assertions from existing test scope; failures pinpoint canonicalization regressions without conflating with pre-existing assertions. |
| `apply-backend` / `apply-frontend` / `apply-general` keep `## Serena Enforcement` after `## Rules` | Serena block preserved in place | Move Serena into a separate file or merge into canonical line | Serena enforcement is apply-agent-specific and orthogonal to generic operating behaviors; the roadmap explicitly excludes it. |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Removing phase-specific bullets drops a non-generic rule that should have remained inline | Medium | Medium | The Spec phase must enumerate any phase-specific guardrails that must remain in `## Rules` before Apply. If any are identified, the design allows keeping them above the canonical line; the canonical line remains the closing statement. |
| Template-literal escaping breaks TypeScript parsing | Low | High | The canonical line contains no backticks, `${`, or `\`; sed/Edit operations on the file are mechanical. The TypeScript build (`bunx tsc --noEmit`) catches any syntax error at apply time. |
| Pre-existing focused tests regress because they assume bullet count or specific rule text | Low | Low | Verified by `grep` that no existing test asserts against SKILL_BODY Rules bullets; if a regression does appear, the additive test is independent and unaffected. |
| Unrelated baseline test failures obscure verification | Low | Low | Focused Developer Team suite (`bun test packages/core/src/teams/developer/`) is the verification target; unrelated failures are documented separately per the proposal's acceptance direction. |
| Accidental `AGENT_BODY` mutation | Low | High | Apply agent must read each file's `AGENT_BODY` before and after edit and diff against `HEAD`; the additive AGENT_BODY-must-not-contain-canonical-line test enforces this at the test layer. |
| `using-agent-skills` skill absent at runtime in a downstream consumer | Low | Medium | Out-of-scope per proposal; tracked as a dependency in the proposal's *Dependencies* section. |
| `content.generated.ts` becomes stale relative to the 10 source files | Low | Low | Generated bundle is regenerated by existing build steps; not modified by this change. |

## Open Decisions

- **Snapshot vs. targeted test for `AGENT_BODY` byte identity**: the proposal's open question on hash-based AGENT_BODY identity. Recommendation: defer hash-based snapshotting; the additive `AGENT_BODY` test (asserting the canonical line is absent in `AGENT_BODY`) plus a manual diff against `HEAD` is sufficient for Phase 3A. Resolved by Task Agent only if a regression appears.

## Dependencies

- `packages/core/src/skills/external/using-agent-skills/SKILL.md` must remain present as the canonical guidance source (Phase 1 dependency).
- `packages/core/src/teams/developer/git-safety.ts` `GIT_DISCARD_PROTECTION_RULE` export must remain unchanged.
- Developer Team tests must be runnable under Bun (`bun test packages/core/src/teams/developer/`).

## Next Steps

Ready for Task (`deck-developer-task`) to break this design into implementation tasks, combined with Spec.

## Mermaid Summary Source

```mermaid
flowchart TD
  Proposal[proposal.md Phase 3A] --> Design[design.md]
  Design --> Targets[10 Developer Team SKILL_BODY ## Rules blocks]
  Targets --> Canonical[Replace body with single canonical line]
  Canonical --> PreserveGit[Keep ${GIT_DISCARD_PROTECTION_RULE} before ## Rules]
  Canonical --> PreserveSerena[Keep ## Serena Enforcement in 3 apply agents after ## Rules]
  Canonical --> PreserveAgent[Keep AGENT_BODY byte-identical]
  Targets --> Exclude[Excluded: orchestrator / explorer / visual-explanations / using-agent-skills SKILL.md / content.generated.ts]
  Design --> Tests[10 additive per-file canonical-line tests + 3 apply-agent Serena-preservation tests]
  Tests --> Verify[bun test packages/core/src/teams/developer/]
  Verify --> GitSafety[git-safety.test.ts continues to pass: rule preserved at every occurrence]
```
