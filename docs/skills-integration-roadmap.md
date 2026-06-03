# Skills Integration Roadmap

> **Status**: Reconstructed after working-tree reset/loss  
> **Last reconstructed**: 2026-06-02  
> **Scope**: External skills silent installation + Developer Team prompt consolidation roadmap

---

## 1. Context and Objective

Se agregaron 17 external skills bajo `packages/core/src/skills/external/` con la intención de instalarlas silenciosamente como skills standalone reutilizables, igual que `judgment-day`, `cognitive-doc-design` y `comment-writer`.

Objetivos:

1. **Instalación silenciosa completa**
   - Registrar todas las skills externas.
   - Bundlear cada skill como paquete completo, no solo `SKILL.md`.
   - Preservar archivos auxiliares como referencias, ejemplos y scripts.

2. **Reducir redundancia entre skills y prompts/agentes**
   - Las skills deben ser la fuente canónica de metodología general.
   - Los agentes deben conservar identidad, límites, contratos SDD y output formats.
   - Donde haya solapamiento, reemplazar conocimiento inline con referencias explícitas a la skill.

3. **Ejecutar en fases pequeñas**
   - Cada fase debe poder completarse, verificarse y archivarse independientemente.

---

## 2. Current Known Baseline

### 2.1 Skills standalone existentes originalmente

Al inicio, solo estaban instaladas/registradas:

- `judgment-day`
- `cognitive-doc-design`
- `comment-writer`

Archivos relevantes:

- `packages/core/src/skills/external/index.ts`
- `packages/core/src/skills/external/content.generated.ts`
- `scripts/generate-skill-bundle.ts`
- `packages/core/src/skills/external/__tests__/content.test.ts`
- `packages/core/src/skills/external/index.test.ts`

### 2.2 Skills nuevas a instalar

Las 17 skills pendientes de instalación silenciosa:

1. `api-and-interface-design`
2. `ci-cd-and-automation`
3. `code-review-and-quality`
4. `code-simplification`
5. `debugging-and-error-recovery`
6. `deprecation-and-migration`
7. `documentation-and-adrs`
8. `doubt-driven-development`
9. `frontend-ui-engineering`
10. `git-workflow-and-versioning`
11. `idea-refine`
12. `interview-me`
13. `performance-optimization`
14. `security-and-hardening`
15. `shipping-and-launch`
16. `test-driven-development`
17. `using-agent-skills`

Total esperado tras instalación: **20 standalone skills**.

---

## 3. Bundle Strategy

### 3.1 Preferred package model

El usuario confirmó explícitamente que prefiere las skills como **bundle completo**:

> Si tienen referencias, scripts, ejemplos, quiero la skill completa en un paquetico, así como están en `packages/core/src/skills/external`.

Por tanto, el bundle no debe limitarse a `SKILL.md`.

### 3.2 Proposed bundle type

El formato recomendado:

```ts
export type StandaloneSkillBundle = {
  SKILL: string;
  files: Record<string, string>;
};
```

`content.generated.ts` debería exponer:

```ts
export const SKILL_CONTENT: Record<string, StandaloneSkillBundle> = {
  "skill-id": {
    SKILL: "...SKILL.md...",
    files: {
      "examples.md": "...",
      "scripts/foo.sh": "..."
    }
  }
};
```

Para skills de un solo archivo, `files` debe existir como objeto vacío:

```ts
files: {}
```

Esto evita `undefined` y mantiene el contrato estable.

### 3.3 Backward compatibility

Preservar:

```ts
getStandaloneSkillBody(skillId): string
```

Nuevo accessor:

```ts
getStandaloneSkill(skillId): StandaloneSkillBundle
```

`getStandaloneSkillBody(skillId)` debe delegar internamente a:

```ts
getStandaloneSkill(skillId).SKILL
```

### 3.4 Multi-file skill known case

`idea-refine` incluye archivos adicionales:

```txt
idea-refine/
├── SKILL.md
├── examples.md
├── frameworks.md
├── refinement-criteria.md
└── scripts/
    └── idea-refine.sh
```

El generador debe usar `readdirSync(dir, { withFileTypes: true })`, recorrer directorios, y excluir artefactos del sistema como:

- `:Zone.Identifier`
- archivos que empiecen con `._`

---

## 4. Roadmap Phases

### Phase 1 — Silent installation of all external skills

**Goal**: instalar 17 skills nuevas, total 20 standalone skills disponibles.

Expected files:

- `scripts/generate-skill-bundle.ts`
- `packages/core/src/skills/external/index.ts`
- `packages/core/src/skills/external/content.generated.ts`
- `packages/core/src/skills/external/index.test.ts`
- `packages/core/src/skills/external/__tests__/content.test.ts`
- 17 skill directories under `packages/core/src/skills/external/`

Acceptance criteria:

- `getStandaloneSkills().length === 20`
- `getStandaloneSkillBody("judgment-day")` returns string.
- `getStandaloneSkill("judgment-day")` returns `{ SKILL, files: {} }`.
- `getStandaloneSkill("idea-refine")` contains:
  - `examples.md`
  - `frameworks.md`
  - `refinement-criteria.md`
  - `scripts/idea-refine.sh`
- Unknown skills throw `SkillLookupError`.
- Tests under `packages/core/src/skills/external/` pass.

Notes from prior attempt:

- A syntax error was introduced when this was attempted directly; SDD was then used.
- The correct approach was to preserve `getStandaloneSkillBody` and add `getStandaloneSkill`.
- Single-file generated entries must include `files: {}`.

---

### Phase 3A — `using-agent-skills` consolidation

**Goal**: canonicalize generic operating behavior guidance to `using-agent-skills`.

Target source files:

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

Canonical line:

```md
Follow the using-agent-skills skill for operating behaviors and failure mode guidance.
```

Rules:

- Replace only `SKILL_BODY` `## Rules` block bodies.
- Preserve `AGENT_BODY` byte-identical.
- Preserve `Serena Enforcement` sections in apply agents.
- Exclude:
  - `orchestrator-content.ts`
  - `explorer-content.ts`
  - `visual-explanations-content.ts`
  - `using-agent-skills/SKILL.md`
  - `content.generated.ts`

Important framing:

- This is **forward-canonicalization**, not literal duplicate removal.
- The old rules were Deck-specific prose, but now the meta-skill becomes the canonical source.

Expected verification:

- Each of 10 source files has exact canonical line once.
- No bullet-wrapped/indented version.
- Tests honestly assert canonical reference.
- Developer-team test suite passes.

Prior final known result before reset:

- `587 pass / 0 fail`
- Review: APPROVE

---

### Phase 3B — `cognitive-doc-design` consolidation

**Goal**: canonicalize generic documentation/artifact-structure guidance to `cognitive-doc-design`.

Target content files:

- `explorer-content.ts`
- `proposal-content.ts`
- `spec-content.ts`
- `design-content.ts`
- `task-content.ts`
- `review-content.ts`
- `verify-content.ts`

Canonical line:

```md
Follow the cognitive-doc-design skill for artifact structure and documentation patterns.
```

Guidance:

- Add reference in relevant `AGENT_BODY` instructions.
- Add reference in required `SKILL_BODY` surfaces.
- Replace duplicate generic documentation guidance in Proposal/Design.
- Preserve artifact-specific output templates/contracts.

Must preserve inline:

- output templates
- artifact contracts
- registry instructions
- return formats
- tables/matrices that are part of downstream contracts

Excluded:

- Orchestrator
- Apply agents
- Archive
- Visual explanations
- `content.generated.ts`
- `cognitive-doc-design/SKILL.md`

Prior final known result before reset:

- `597 pass / 0 fail`
- Review: APPROVE

---

### Phase 3C — `code-review-and-quality` → Review Agent

**Goal**: canonicalize core review methodology in Review Agent toward `code-review-and-quality`.

Target files:

- `packages/core/src/teams/developer/review-content.ts`
- `packages/core/src/teams/developer/review-content.test.ts`

What to add/reference:

- `code-review-and-quality` for:
  - five-axis review methodology
  - severity philosophy
  - honesty/evidence guidance

Must preserve inline:

- Review scopes: `general`, `backend`, `frontend`, `integration`
- `review-report.md` artifact contract
- registry behavior (`state.yaml`, `events.yaml`)
- output template
- ratings/findings structure
- severity labels: `BLOCKER | MAJOR | MINOR | NIT`
- backend/frontend/integration criteria

Important technical note:

- Avoid raw backticks when editing TypeScript template literals.
- Previous apply failed because raw backticks inserted in `review-content.ts` broke parsing.

Prior current state:

- This appears to be the only phase still present in working tree after reset.
- Review: APPROVE
- Focused tests: `20/20 pass`
- Developer-team suite: `611/611 pass`

---

### Phase 3D — `api-and-interface-design`

**Status**: blocked until Phase 1 restored, because skill directory/registry is currently missing.

Expected targets after skill exists:

- `apply-backend-content.ts`
- `apply-general-content.ts`
- `design-content.ts`
- `spec-content.ts`
- `review-content.ts`

Expected canonical topics:

- stable APIs/interfaces
- contract-first design
- validation at boundaries
- consistent error semantics
- REST/resource patterns
- TypeScript input/output type separation
- backward compatibility

Expected approach:

- Add references where agents discuss contracts, validation, API design, shared schemas.
- Preserve Deck SDD output tables/contracts:
  - API / Contract Implications table in Design
  - Validation Rules and Error Contracts in Spec
  - Apply-progress formats
  - Review report structure

---

### Phase 3E — `documentation-and-adrs`

Expected targets:

- Apply Backend
- Apply Frontend
- Apply General
- Explorer
- Proposal
- Design
- Review

Primary overlap:

- inline commenting guidance
- alternatives/tradeoffs tables
- ADR-style rejected alternatives rationale
- documentation for future agents

Approach:

- Reference `documentation-and-adrs` for why-vs-what comments and ADR alternatives documentation.
- Preserve artifact-specific templates.

---

### Phase 3F — Remaining lower-priority consolidations

#### `frontend-ui-engineering`

Targets:

- Apply Frontend
- Review
- Verify

Overlap:

- accessibility
- loading/error/empty states
- UI performance

#### `test-driven-development`

Targets:

- Apply Backend
- Apply Frontend
- Apply General
- Verify
- Task

Overlap:

---

### Phase 3Z — Cross-cutting Git safety rule

**Rule**: Critical Git Discard Protection Rule

**Scope**: All 12 Developer Team agents

**Canonical Rule Text Location**: `packages/core/src/teams/developer/git-safety.ts` (`GIT_DISCARD_PROTECTION_RULE`)

**Surfaces**: Both `*_AGENT_BODY` and `*_SKILL_BODY` in each content module

**Verification**: `git-safety.test.ts` centralized presence + structural test

**Rationale**: Addresses data-loss gap identified after working-tree reset incident. All Developer Team agents must refuse destructive Git commands (reset, clean, stash drop, rebase) unless user confirms in a separate new message with exact command.

**Status**: Implemented

**Note**: The rule supersedes all other agent instructions including role definitions, skill content, and delegated task descriptions.

---

- test-running instructions
- test strategy and verification expectations

#### `debugging-and-error-recovery`

Target:

- Verify

Overlap:

- failure triage for test/build failures

#### `security-and-hardening`

Target:

- Review

Overlap:

- OWASP/security checklist
- input validation
- auth/secrets/injection/data exposure

#### `performance-optimization`

Targets:

- Review
- Verify

Overlap:

- performance review checks
- Lighthouse/bundlesize/performance budgets

#### `deprecation-and-migration`

Targets:

- Proposal
- Design
- Task

Overlap:

- build-new vs migrate-old decisions
- removal/migration planning

#### `idea-refine`

Target:

- Explorer

Overlap:

- options/tradeoffs
- divergent/convergent exploration
- Not Doing/out-of-scope framing

#### `interview-me`

Targets:

- Explorer
- Proposal
- Spec

Overlap:

- vague request handling
- asking for clarification
- confidence before planning/spec

#### `git-workflow-and-versioning`

Likely keep inline for Orchestrator post-archive git suggestions.

#### `doubt-driven-development`

Likely keep Orchestrator invariants inline; they are Deck-specific triggers.

#### `ci-cd-and-automation`

Minimal redundancy. Mostly complementary.

#### `code-simplification`

Minimal redundancy. Applies when explicit simplification/refactor task exists.

#### `comment-writer`

No significant Developer Team prompt redundancy; for human-facing comments.

#### `shipping-and-launch`

No significant SDD prompt redundancy; production launch phase.

#### `judgment-day`

No consolidation needed; unique adversarial dual-review workflow.

#### Phase 3F selective no-op decisions

The following skills are intentionally not referenced in Developer Team prompt bodies for this phase. They are either interactive/main-session skills, operational phases outside SDD, execution guidance for future task contexts, or low-overlap with autonomous SDD agents.

| Skill | Decision | Rationale |
|---|---|---|
| `debugging-and-error-recovery` | No-op | Verify reports failures; Apply debugging guidance can be revisited in a future Apply-focused phase. |
| `idea-refine` | No-op | Interactive user-dialogue workflow is incompatible with autonomous Explorer delegation. |
| `interview-me` | No-op | Requires live one-question-at-a-time interview; autonomous agents should flag blockers instead. |
| `git-workflow-and-versioning` | Keep inline/no-op | Orchestrator git suggestions are advisory; critical Git discard protection remains centralized. |
| `doubt-driven-development` | Keep inline/no-op | In-flight adversarial review does not replace post-hoc Review or Deck orchestrator invariants. |
| `ci-cd-and-automation` | No-op | CI/CD setup is outside current Developer Team prompt redundancy. |
| `code-simplification` | No-op | Applies to explicit refactor/simplification tasks, not baseline implementation guidance. |
| `comment-writer` | No-op | Human-facing collaboration comments are outside structured SDD artifacts. |
| `shipping-and-launch` | No-op | Launch operations occur after SDD Archive. |
| `judgment-day` | No-op | Unique standalone dual-review workflow; no prompt consolidation needed. |

---

## 5. Known Test/Verification Patterns

Use targeted tests first:

```bash
bun test packages/core/src/skills/external/
bun test packages/core/src/teams/developer/review-content.test.ts
bun test packages/core/src/teams/developer/
```

Repo-wide `tsc --noEmit` may fail due unrelated pre-existing issues. Treat unrelated typecheck failures as environmental only when affected files are clean.

---

## 6. Current Recovery Status

This document was reconstructed because the working tree was reset and most uncommitted roadmap work disappeared.

Currently known missing from disk:

- this roadmap (now reconstructed)
- 17 external skill directories
- Phase 1 OpenSpec artifacts
- Phase 3A OpenSpec artifacts
- Phase 3B OpenSpec artifacts

Currently known present:

- Phase 3C code-review-quality source changes and archive

Before resuming Phase 3D or later, restore/re-run Phase 1.

---

## 7. Immediate Next Recovery Steps

1. Preserve current surviving work:
   - inspect diff for `review-content.ts` and `review-content.test.ts`
   - decide whether to commit/stash or keep as working tree changes

2. Restore Phase 1:
   - recreate 17 skill directories
   - update generator and registry
   - regenerate bundle
   - update tests

3. Re-run or reconstruct Phase 3A and 3B:
   - using-agent-skills canonicalization
   - cognitive-doc-design canonicalization

4. Only then continue Phase 3D:
   - api-and-interface-design canonicalization
