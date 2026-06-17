# Exploration: Enforce English-only Orchestrator → Sub-agent Prompts and Generated Artifacts

## Goal
Ensure Deck-generated/installed orchestrator and sub-agent instructions, and the artifacts those agents produce, are in English only, while allowing the orchestrator to respond to the end user in the user's language.

## Outcome
**success** — investigation found concrete non-English strings in generated prompt content and identified the minimal Deck-owned surfaces to change.

## Scope Confirmation
Findings are **Deck-owned only**. No edits are proposed for local OpenCode files, runner config files, or any other runner-specific installed files outside this repository. The implementation target is Deck as a product/installer/generator (the `@deck/core` content registry and the runner adapters that materialize it).

## Current Architecture Summary

Deck's Developer Team prompts are produced by a **runner-agnostic content layer** in `@deck/core` and materialized by two adapter packages:

1. **`@deck/core/teams/developer/content-registry.ts`** — canonical source of agent bodies, skill bodies, and orchestrator session instructions. All adapters consume `getAgentContent()` / `getTeamSessionInstructions()`.
2. **`@deck/core/teams/developer/*-content.ts`** — per-agent static prompt strings (agent body + skill body). These are the literal text that ends up in installed runner files.
3. **`@deck/core/teams/developer/instruction-bundles/`** — optional capability instructions (Serena, codebase-memory, etc.) composed into prompts by the registry.
4. **`packages/adapter-opencode/src/prompt-generation.ts`** + **`packages/adapter-opencode/src/developer-team-install.ts`** — build OpenCode prompt/skill files from the registry and write them to `~/.config/opencode/`.
5. **`packages/adapter-pi/src/developer-team-install.ts`** — builds Pi agent/skill files from the registry and writes them to `<projectRoot>/.pi/`.

There is **no existing central language policy**. The only language-related text found is a reactive check in the orchestrator prompt: it tells the orchestrator to reject sub-agent outputs that use the "wrong or non-requested language." There is no positive instruction that sub-agent prompts and artifacts must be English-only, and no guard against non-English leaking into the generated prompt text itself.

## Concrete Findings: Non-English in Generated Prompts

Spanish word `herramienta` ("tool") is present in four Deck-owned prompt sources that get installed into runner configurations:

- `packages/core/src/teams/developer/instruction-bundles/serena.ts:143`
- `packages/core/src/teams/developer/apply-general-content.ts:290`
- `packages/core/src/teams/developer/apply-backend-content.ts:284`
- `packages/core/src/teams/developer/apply-frontend-content.ts:287`

These appear in the Serena fallback message: `"Serena tools unavailable. Using fallback: [herramienta]."`

Root cause: a previous fix (`openspec/archive/serena-agent-usage-enforcement/apply-progress.md:263`) replaced Spanish phrasing `"Serena seleccionado pero..."` with the current message, but the placeholder `[herramienta]` was left behind in both the capability bundle and the duplicated apply-agent skill-body text.

## Relevant Files

| File | Purpose | Why it matters |
|---|---|---|
| `packages/core/src/teams/developer/orchestrator-content.ts` | Canonical orchestrator system prompt, agent body, skill body | Must contain the rule: "sub-agent prompts and artifacts are English only; user-facing responses must use the user's language" |
| `packages/core/src/teams/developer/content-registry.ts` | Composes invariants, context-authority guidance, and capability instructions into all agent/skill/session content | Best place to append a universal English-only composition layer to every generated prompt |
| `packages/core/src/teams/developer/explorer-content.ts` | Explorer agent/skill body and return contract | Artifacts it writes (`exploration.md`) must be English-only |
| `packages/core/src/teams/developer/proposal-content.ts` | Proposal agent/skill body and return contract | `proposal.md` artifacts must be English-only |
| `packages/core/src/teams/developer/spec-content.ts` | Spec agent/skill body and return contract | `spec.md` artifacts must be English-only |
| `packages/core/src/teams/developer/design-content.ts` | Design agent/skill body and return contract | `design.md` artifacts must be English-only |
| `packages/core/src/teams/developer/task-content.ts` | Task agent/skill body and return contract | `tasks.md` artifacts must be English-only |
| `packages/core/src/teams/developer/apply-general-content.ts` | General Apply agent/skill body and return contract | Contains `[herramienta]`; `apply-progress.md` artifacts must be English-only |
| `packages/core/src/teams/developer/apply-backend-content.ts` | Backend Apply agent/skill body and return contract | Contains `[herramienta]`; `apply-progress.md` artifacts must be English-only |
| `packages/core/src/teams/developer/apply-frontend-content.ts` | Frontend Apply agent/skill body and return contract | Contains `[herramienta]`; `apply-progress.md` artifacts must be English-only |
| `packages/core/src/teams/developer/verify-content.ts` | Verify agent/skill body and return contract | `verify-report.md` artifacts must be English-only |
| `packages/core/src/teams/developer/review-content.ts` | Review agent/skill body and return contract | `review-report.md` artifacts must be English-only |
| `packages/core/src/teams/developer/archive-content.ts` | Archive agent/skill body and return contract | `archive-report.md` artifacts must be English-only |
| `packages/core/src/teams/developer/instruction-bundles/serena.ts` | Serena capability instruction bundle | Contains `[herramienta]`; injected into apply-agent prompts when Serena is enabled |
| `packages/adapter-opencode/src/prompt-generation.ts` | Builds OpenCode prompt files from registry content | Final materialization surface; should inherit any language policy from core |
| `packages/adapter-opencode/src/developer-team-install.ts` | Builds and applies OpenCode skill/agent/config files | Final materialization surface; verification should catch language drift |
| `packages/adapter-pi/src/developer-team-install.ts` | Builds and applies Pi agent/skill/profile files | Final materialization surface for Pi; verification should catch language drift |
| `packages/core/src/teams/developer/orchestrator-invariants.ts` | Invariant text prepended to orchestrator surfaces | Could host an invariant-like language rule, but it is orchestrator-only |

## Existing Tests and Test Gaps

### Existing coverage
- `packages/core/src/teams/developer/content-registry.test.ts` — asserts presence of registry instructions, invariants, capability composition, etc.
- `packages/core/src/teams/developer/orchestrator-content.test.ts` — asserts structure of orchestrator prompts.
- `packages/core/src/teams/developer/apply-general-content.test.ts`, `apply-backend-content.test.ts`, `apply-frontend-content.test.ts` — structure/content tests.
- `packages/adapter-opencode/src/prompt-generation.test.ts` — tests prompt generation and provider filtering.
- `packages/adapter-opencode/src/developer-team-install.test.ts` and `packages/adapter-pi/src/developer-team-install.test.ts` — test install plan generation, application, verification, and runner isolation.

### Gaps
- No test scans generated agent/skill/prompt content for non-English strings.
- No test asserts that orchestrator instructions require English-only sub-agent communication.
- No test asserts that each sub-agent return contract requires English-only artifacts.
- No test asserts that user-facing orchestrator responses are allowed to match the user's language.
- Adapter install tests do not verify that final installed files contain only English in agent-facing sections.

## Recommended Change Points (ranked by confidence)

### 1. Fix concrete Spanish leak (highest confidence, immediate)
- Replace `[herramienta]` with `[tool]` in:
  - `packages/core/src/teams/developer/instruction-bundles/serena.ts:143`
  - `packages/core/src/teams/developer/apply-general-content.ts:290`
  - `packages/core/src/teams/developer/apply-backend-content.ts:284`
  - `packages/core/src/teams/developer/apply-frontend-content.ts:287`
- Add regression tests that scan these four content sources for `herramienta` and fail if found.

### 2. Add universal English-only composition layer (high confidence)
- In `packages/core/src/teams/developer/content-registry.ts`, append a `LANGUAGE_POLICY` block to every `agentBody`, `skillBody`, and session instructions surface.
- The policy should state:
  - All communication from this agent to other Deck agents and all generated artifacts must be in English.
  - User-facing explanations (only the orchestrator, and only when directly addressing the user) must use the user's language.
  - Literal foreign terms that are part of domain vocabulary (e.g., file paths, brand names, quoted user input) are allowed.
- This automatically covers all current and future Developer Team agents without editing 12 individual files.

### 3. Strengthen orchestrator prompt (high confidence)
- In `packages/core/src/teams/developer/orchestrator-content.ts`, add an explicit "Language Policy" section to `ORCHESTRATOR_SYSTEM_PROMPT` and `ORCHESTRATOR_SKILL_BODY`:
  - When delegating to sub-agents, send prompts and receive artifacts in English only.
  - When synthesizing results for the user, use the user's language.
  - Reject sub-agent outputs that violate the English-only rule.
- This makes the requirement visible in the installed orchestrator prompt and aligns with the existing "wrong or non-requested language" repair rule.

### 4. Add content-level regression test (high confidence)
- Add a test in `content-registry.test.ts` (or a new `language-policy.test.ts`) that:
  - Calls `getAgentContent()` for every Developer Team agent.
  - Calls `getTeamSessionInstructions("developer-team")`.
  - Scans the combined strings for a curated deny-list of non-English words (starting with `herramienta`).
  - Asserts each surface contains the English-only policy text.
- Keep the deny-list small and focused on known leak points; the policy text is the primary enforcement.

### 5. Add adapter-level verification (medium confidence, follow-up)
- Extend `packages/adapter-opencode/src/developer-team-install.test.ts` and `packages/adapter-pi/src/developer-team-install.test.ts` to assert that installed skill/agent/prompt content contains the English-only policy and does not contain `herramienta`.
- This ensures the policy survives adapter-specific formatting.

## Options and Tradeoffs

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| A. Central policy in `content-registry.ts` only | One change covers all agents/surfaces; future-proof | Less explicit in individual agent prompts | Low |
| B. Policy repeated in every `*-content.ts` return contract | Very explicit per agent | Duplicated text; easy to miss new agents | Medium |
| C. A + B combined | Strongest signal; central enforcement + per-agent reminder | Slightly more text | Low-Medium |
| D. New optional capability instruction package | Reuses existing composition infra | Language is not an optional package; wrong semantic layer | Medium |

**Recommendation: C** — add the central composition layer in `content-registry.ts` for guaranteed coverage, plus a concise "Language Policy" section in the orchestrator prompt and each sub-agent return contract for clarity. This is the lowest-risk, highest-signal path.

## Risks

- **Over-enforcement**: A blanket "English only" rule could accidentally forbid legitimate foreign text in specs, error messages, or quoted user requirements. The policy must explicitly allow domain literals and quoted user input.
- **Duplication drift**: If the policy lives in both `content-registry.ts` and individual `*-content.ts` files, they could diverge. The central composition layer should be the authoritative copy; per-agent text can be a brief pointer.
- **Runner-specific escapes**: Pi uses a stub agent file plus a separate `system-prompt.md` profile. The policy must be present in the profile (via `getTeamSessionInstructions`) and not rely solely on the stub.
- **Capability instructions**: Optional bundles like Serena can inject text that bypasses `*-content.ts`. The central registry composition catches these because `composeCapabilityInstructions()` is called after the base content.
- **Test maintenance**: A deny-list test requires curation. Prefer asserting the presence of the positive policy text and scanning only for known leak words.

## Open Questions

1. Should the English-only rule apply to **all** Deck teams (not just Developer Team), or is this change scoped to the Developer Team only? The current content registry is team-specific.
2. Should the orchestrator's user-facing synthesis use the **session language** detected by the runner, or is the personality layer sufficient to guide tone without specifying language?
3. Are there other known non-English strings besides `herramienta`? A broader audit (e.g., scanning all `*-content.ts` files with a language detector) may be worthwhile before implementation.
4. Should the fix include a one-time scan of the `README.md` and archived OpenSpec artifacts? These are Deck-owned but are not installed into runner prompts, so they are out of scope for this change.

## Recommended Next Action
Proceed to **Proposal** with change id `enforce-english-agent-artifacts`. The proposal should specify the central `content-registry.ts` composition layer, the orchestrator prompt section, the four `[herramienta]` replacements, and the regression tests.

## Actionable Diagnosis
**yes** — the investigation identified a concrete, reproducible issue (non-English `herramienta` in generated prompts) and a clear set of minimal Deck-owned files to change.

## Suggested Lifecycle Outcome
**propose** — move to Proposal phase to formalize scope, approach, and acceptance criteria.

## Ready for Proposal
**Yes**. The orchestrator should communicate to the user that the issue is confirmed, the leak points are identified, and the fix can be implemented entirely within Deck-owned source files without touching local runner configuration.
