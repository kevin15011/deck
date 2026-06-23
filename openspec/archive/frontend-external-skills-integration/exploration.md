# Exploration: frontend-external-skills-integration

## Executive Summary

Deck already has the core external-skill bundle architecture from the earlier `external-skills-bundle-install` change: skills live under `packages/core/src/skills/external/`, are registered in `STANDALONE_SKILLS`, are bundled into `content.generated.ts`, and are accessed through `getStandaloneSkill()` with `getStandaloneSkillBody()` preserved for backward compatibility.

The 9 new frontend-focused skill directories are present in the repository, including multi-file packages for `playwright-cli`, `design-lab`, `frontend-design`, and `web-quality-audit`. However, they are not registered in `packages/core/src/skills/external/index.ts`, are not present as top-level generated bundles in `content.generated.ts`, and are not referenced by Developer Team role prompts. The implementation should extend the existing pattern rather than introduce a new skill-loading mechanism.

## Current Architecture Findings

- External standalone skills are declared in `packages/core/src/skills/external/index.ts` via `STANDALONE_SKILLS` entries with `skillId` and `sourcePath`.
- `getStandaloneSkill(skillId)` returns `{ SKILL, files }`, loading from generated bundles in binary mode or falling back to filesystem reads during source execution.
- `getStandaloneSkillBody(skillId)` delegates to `getStandaloneSkill(skillId).SKILL`, preserving older callers that only need `SKILL.md` text.
- `scripts/generate-skill-bundle.ts` is the generator that emits `packages/core/src/skills/external/content.generated.ts`; the prior OpenSpec history requires complete packages, including supporting files and scripts.
- Developer Team roles expose external-skill guidance through role prompt content files in `packages/core/src/teams/developer/*-content.ts`, typically as explicit `Follow the <skill> skill...` lines near the bottom of each skill body.
- Current role prompts already reference earlier external skills such as `using-agent-skills`, `frontend-ui-engineering`, `test-driven-development`, `api-and-interface-design`, `code-review-and-quality`, and `performance-optimization`.

## External Skill Existence and Bundling Status

| Skill | Source folder status | Supporting files | Registered in `STANDALONE_SKILLS` | Generated bundle status |
|---|---:|---|---:|---:|
| `ui-skills-root` | present | `SKILL.md` | no | no |
| `frontend-design` | present | `SKILL.md`, `LICENSE.txt` | no | no |
| `baseline-ui` | present | `SKILL.md` | no | no |
| `fixing-accessibility` | present | `SKILL.md` | no | no |
| `fixing-motion-performance` | present | `SKILL.md` | no | no |
| `fixing-metadata` | present | `SKILL.md` | no | no |
| `web-quality-audit` | present | `SKILL.md`, `scripts/analyze.sh` | no | no |
| `playwright-cli` | present | `SKILL.md`, 10 reference files | no | no |
| `design-lab` | present | `SKILL.md`, `DESIGN_PRINCIPLES.md` | no | no |

`content.generated.ts` currently has 20 top-level bundles for the previous external skills only. Therefore generated bundle/index content is stale relative to the newly added folders.

## Role-Impact Matrix

| Skill | Primary strength | Strongly impacted roles | Secondary / conditional roles | Guidance intent |
|---|---|---|---|---|
| `ui-skills-root` | always for UI-related work | `orchestrator`, `explorer`, `task`, `apply-frontend`, `review`, `verify` | `proposal`, `design`, `spec` when scope includes UI | Router for selecting smaller UI skill context; should not force UI skills for non-UI work. |
| `frontend-design` | conditional / strong for visual creation | `design`, `apply-frontend`, `review` | `explorer`, `proposal`, `spec`, `task` for visual-identity scope | Use for pages/components needing distinctive visual direction, not every frontend tweak. |
| `baseline-ui` | conditional quick-polish | `apply-frontend`, `review`, `verify` | `task`, `design` for polish tasks | Apply for spacing, hierarchy, typography, basic states, and small cleanup. |
| `fixing-accessibility` | conditional targeted | `apply-frontend`, `review`, `verify` | `design`, `spec`, `task` for forms/dialogs/tabs/dropdowns | Use for ARIA, keyboard, focus, forms, interactive controls, and WCAG-sensitive checks. |
| `fixing-motion-performance` | conditional targeted | `apply-frontend`, `review`, `verify` | `design`, `task` for animation-heavy work | Use when animations, transitions, scrolling, or motion performance are in scope. |
| `fixing-metadata` | conditional targeted | `apply-frontend`, `review`, `verify` | `spec`, `task`, `design` for new pages/routes | Use for title/meta, canonical, Open Graph, Twitter cards, JSON-LD, robots. |
| `web-quality-audit` | audit-only / predeploy | `review`, `verify` | `orchestrator`, `task`, `apply-frontend` near release or broad audit | Use for predeploy/global quality review; avoid daily implementation overhead. |
| `playwright-cli` | conditional browser QA | `apply-frontend`, `verify`, `review` | `explorer` for reproductions; `task` for QA tasks | Use for real-browser checks, screenshots, forms, navigation, local state, and UI regression evidence. |
| `design-lab` | exploration-only / heavy | `explorer`, `design` | `orchestrator`, `proposal` for large redesign intake | Use for large redesigns needing variants/interview/temp routes; avoid as default apply guidance. |

## Implementation Touch Points

- `packages/core/src/skills/external/index.ts` — add 9 entries to `STANDALONE_SKILLS`; expected total rises from 20 to 29.
- `packages/core/src/skills/external/content.generated.ts` — regenerate with all 29 bundles and supporting files.
- `scripts/generate-skill-bundle.ts` — likely no architecture change needed if current multi-file bundling still handles the new folders; verify executable/script file handling for `web-quality-audit/scripts/analyze.sh` and reference-file preservation for `playwright-cli`.
- `packages/core/src/skills/external/index.test.ts` — update expected count and add representative assertions for new frontend skills.
- `packages/core/src/skills/external/__tests__/content.test.ts` — add bundle-file assertions for multi-file skills (`playwright-cli`, `design-lab`, `frontend-design`, `web-quality-audit`).
- `packages/core/src/teams/developer/*-content.ts` — add role-specific guidance, strongest in `apply-frontend-content.ts`, `review-content.ts`, `verify-content.ts`, `design-content.ts`, `explorer-content.ts`, `task-content.ts`, and `orchestrator-content.ts`; lighter conditional mention in `proposal-content.ts` and `spec-content.ts`.
- `packages/core/src/teams/developer/*-content.test.ts` and `no-op-skill-absence.test.ts` — update tests that assert skill guidance presence/absence or prompt content invariants.
- `docs/skills-integration-roadmap.md` — optional documentation update if the team wants the roadmap to reflect the second frontend-focused skill wave.

## Testing Strategy Candidates

1. Targeted external skill tests: `bun test packages/core/src/skills/external/`.
2. Developer Team prompt tests: `bun test packages/core/src/teams/developer/` or specific `*-content.test.ts` files.
3. Typecheck after generated file update: `bun run typecheck` or the repository's canonical TypeScript check.
4. Generator idempotence check: run the skill bundle generator, then verify `content.generated.ts` is deterministic and includes all supporting files.
5. Optional full suite if prompt/content snapshots or generated bundle changes are broad.

## Risks and Open Questions

- Role prompt bloat: adding every frontend skill everywhere would weaken routing discipline; use conditional guidance and reserve `design-lab`/`web-quality-audit` for heavy/audit phases.
- Generated artifact churn: `content.generated.ts` is large and should be regenerated, not hand-edited.
- Multi-file bundle completeness: `playwright-cli` references and scripts under `web-quality-audit` must survive bundling.
- Test expectations currently assume 20 standalone skills; these will fail until updated to 29.
- Open question: whether `docs/skills-integration-roadmap.md` should be updated as part of the implementation or left historical.
- Open question: whether the role prompts should mention `ui-skills-root` as a router only, or require it before every UI-related role action. The safer recommendation is router-only, conditional on UI scope.

## Recommendation for Proposal Phase

Proceed with change ID `frontend-external-skills-integration`.

Proposal scope should include two implementation tracks:

1. **Bundle registration track** — register the 9 skills, regenerate `content.generated.ts`, preserve complete package files, and update external skill tests.
2. **Developer Team role-awareness track** — add targeted prompt guidance so frontend-heavy roles receive the new capabilities without making heavy exploratory/audit tools default for routine work.

Out of scope for this change: changing runtime skill-loading semantics, adding new Developer Team roles, rewriting the generator beyond what is needed for complete bundle verification, or modifying the external skill source content itself unless a packaging defect is found.

## Actionable Diagnosis

Yes. The new skill source folders exist, but Deck's registry, generated bundle, and role prompts do not yet expose them. The next phase should formalize a proposal to register, bundle, and route these skills across the Developer Team.
