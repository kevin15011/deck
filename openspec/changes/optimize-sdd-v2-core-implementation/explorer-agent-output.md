# Explorer Agent Output: optimize-sdd-v2-core-implementation

## Exploration: SDD v2 Core Implementation — Source Architecture Investigation

**Goal:** Investigate the actual source architecture so the next implementation targets the correct files — not `.pi/` (the generated adapter output layer).

---

## Completion Evidence

| Check | Result |
|---|---|
| `exploration.md` exists | ✅ `openspec/changes/optimize-sdd-v2-core-implementation/exploration.md` (19,857 bytes, 374 lines) |
| `state.yaml` updated | ✅ phase `explore` → status `completed`, artifact reference merged |
| `events.yaml` updated | ✅ `explore.completed` event appended, prior events preserved |
| Prior registry history intact | ✅ state and events files contain all prior entries plus new ones |

---

## Architecture Summary

### Three-Layer Architecture (CONFIRMED)

```
packages/core/src/teams/developer/   ← SOURCE (edit here)
        ↓
packages/adapter-pi/                ← ADAPTER (materializes to .pi/)
        ↓
.pi/agents/ + .pi/skills/           ← OUTPUT (gitignored, generated)
```

### Key Finding

**All 7 needs from the prior change are implemented as content updates in `packages/core/src/teams/developer/`**. The adapter (`packages/adapter-pi/`) only wraps source content with frontmatter and writes to `.pi/`. No adapter changes are required for the 7 needs unless a need involves frontmatter/model/thinking configuration.

---

## Source File Map

### Primary File

| File | Role |
|---|---|
| `packages/core/src/teams/developer/orchestrator-content.ts` | All 7 needs touch this file. Contains `ORCHESTRATOR_SYSTEM_PROMPT`, `ORCHESTRATOR_AGENT_BODY`, `ORCHESTRATOR_SKILL_BODY` — all SDD phase sequence, apply routing, triage, delegation, persistence policy, execution config respect, and Mermaid summary guidance lives here as text. |

### Supporting Core Files

| File | Needs |
|---|---|
| `visual-explanations-content.ts` | Need 7 — Mermaid phase summaries (expanded fragment for Orchestrator skill) |
| `archive-content.ts` | Need 2 — post-Archive Git suggestions (prepare diff context) |
| `proposal-content.ts` | Need 7 — provide Mermaid in proposals |
| `spec-content.ts` | Need 7 — provide Mermaid in specs |
| `design-content.ts` | Need 7 — provide Mermaid in designs |
| `task-content.ts` | Need 7 — provide Mermaid in tasks |
| `catalog.ts` | Agent definitions (IDs, names, descriptions) |
| `content-registry.ts` | `getAgentContent()` and `getTeamSessionInstructions()` |

### SDD Runtime (Pipeline Utilities)

| File | Role |
|---|---|
| `artifact-state-manager.ts` | Need 5 — CAS, idempotency, event/lock guarantees for registry hardening |
| `orchestrator-pipeline.ts` | Audit → risk → quality → loop breaking (no phase sequence hard-coding) |
| `runner-pipeline.ts` | Transport → budget → state management |

### Adapter (No Changes Needed)

| File | Role |
|---|---|
| `developer-team-install.ts` | Materializes core → `.pi/`. No changes required unless Need 6 needs explicit config preservation. |

---

## Implementation Guidance by Need

| # | Need | Primary Source File | Supporting Files | Effort |
|---|---|---|---|---|
| 1 | Apply batching optimization | `orchestrator-content.ts` (Apply Routing section) | — | Low |
| 2 | Post-Archive Git suggestions | `orchestrator-content.ts` + `archive-content.ts` | — | Low |
| 3 | Explorer-before-Proposal triage | `orchestrator-content.ts` (SDD Triage Gate) | — | Low |
| 4 | Role-based delegation outside SDD | `orchestrator-content.ts` (Delegation Rules) | — | Low |
| 5 | Artifact/registry persistence hardening | `orchestrator-content.ts` + all phase content files | `artifact-state-manager.ts` | Medium |
| 6 | Execution config respect | `orchestrator-content.ts` | `developer-team-install.ts` (read-only) | Low |
| 7 | Mermaid-backed Orchestrator summaries | `visual-explanations-content.ts` + `orchestrator-content.ts` | `proposal-content.ts`, `spec-content.ts`, `design-content.ts`, `task-content.ts` | Medium |

---

## Tests

- `packages/core/src/teams/developer/*.test.ts` — one test file per content module
- `packages/sdd-runtime/src/**/*.test.ts` — pipeline, contracts, state manager tests
- `packages/adapter-pi/*.test.ts` — adapter tests

Run: `bun test packages/core/src/teams/developer/ && bun test packages/sdd-runtime/ && bun test packages/adapter-pi/`

---

## Ready for Proposal

**Yes.**

- Architecture is confirmed: source → adapter → output
- All 7 needs map to specific source files in `packages/core/`
- No adapter changes required
- Tests exist for all content files
- Prior planning artifacts from `optimize-sdd-apply-and-commit-suggestions` remain valid and should be reused

The Orchestrator should advance to the Proposal phase, reusing the valid artifacts from the prior change and targeting `packages/core/src/teams/developer/orchestrator-content.ts` as the primary implementation file.

---

## Registry

- **Artifact Path:** `openspec/changes/optimize-sdd-v2-core-implementation/exploration.md`
- **State Path:** `openspec/changes/optimize-sdd-v2-core-implementation/state.yaml`
- **Events Path:** `openspec/changes/optimize-sdd-v2-core-implementation/events.yaml`
- **Recorded:** phase `explore`, status `completed`, event `explore.completed`
- **Registry Blocker:** none