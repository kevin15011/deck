# Specification — Adaptive Developer Team Redesign

## Requirements

### REQ-001 — Canonical inventory

Deck MUST expose exactly seven canonical Developer Team agents in this order: Lead, Investigate, Architect, Apply Fast, Apply Deep, Quality, Setup. Their IDs MUST NOT contain `developer`. Renaming MUST NOT alter the responsibilities defined in `working-definition.md`.

**Scenario:** Given a fresh runner plan, when the canonical catalog is materialized, then only the seven canonical agent IDs and their paired skills are installed.

### REQ-002 — Proportional activation

Lead MUST remain the user-facing owner and MAY implement a clear, low-risk reversible delta directly. Investigate, Architect, Apply, Quality, and Setup MUST activate only from the signals in the approved definition. File or line count alone MUST NOT select a route.

**Scenario:** Given a conversational visual delta with unchanged scope and risk, when Lead classifies it, then it continues the same candidate without restarting exploration, planning, Full SDD, or independent QA.

### REQ-003 — Apply and TDD

Apply Fast and Apply Deep MUST be selected by cognitive implementation complexity. Apply MUST use RED/GREEN/refactor for new behavior or bugs, characterization for behavior-preserving refactors, and appropriate non-artificial validation for visual, configuration, and documentation changes.

**Scenario:** Given a localized bug, when Apply starts, then it reproduces the defect before fixing it and retains vertical ownership through a functional candidate.

### REQ-004 — Quality and safety

Quality MUST be read-only and MUST run for protected changes, public contracts, effects, material cross-boundary changes, release/readiness, uncertain coverage, contradictory evidence, or explicit user request. It MUST NOT become a universal per-delta gate. Canonical Git discard protection MUST remain unchanged.

**Scenario:** Given a low-risk cosmetic delta, when no protected signal exists, then independent Quality is not required.

### REQ-005 — OpenSpec persistence

OpenSpec MUST remain the official session/change memory. Lead MUST select delta, Working Brief, or Full SDD persistence proportionally and remain the centralized registry writer. Full SDD MAY be selected when project policy requires it or no equally safe smaller route exists.

**Scenario:** Given a seconds-scale change, when it completes, then Lead records outcome, targets, evidence, and status without requiring the Full SDD artifact chain.

### REQ-006 — Capability preservation

All seven agents MUST retain the configured capability composition. Serena write tools MUST remain limited to modifying roles, while read-only discovery tools remain available to non-modifying roles. Capability packages MUST be selected when relevant rather than invoked as a checklist.

**Scenario:** Given Serena is enabled, when Apply Fast or Apply Deep is materialized, then it receives symbolic read/write tools; Quality receives read-only tools.

### REQ-007 — Setup readiness

Setup MUST replace Init as the project-readiness agent. A once-per-session deterministic preflight MUST avoid writes for ready projects and delegate Setup only for missing, stale, invalid, or indeterminate components requiring repair. Optional unavailable tooling MUST NOT block unrelated work.

**Scenario:** Given a ready project, when session preparation runs, then Setup is not invoked and no project artifact is rewritten.

### REQ-008 — Safe runner reconciliation

OpenCode and Pi MUST promote and verify the new inventory before retiring legacy Deck-managed agents. Obsolete active files MUST be removed from runner discovery and preserved in backup/quarantine. Unknown ownership MUST NOT be deleted. Reinstall MUST be idempotent, and verification MUST reject active legacy inventory.

**Scenario:** Given an existing fourteen-agent installation, when upgrade succeeds, then the active runner exposes only the seven agents, retained standalone skills, and configured packages, while legacy files remain recoverable outside active discovery paths.

### REQ-009 — Model migration

The TUI MUST display the seven new roles. Legacy assignments MUST migrate only through deterministic unambiguous mappings. Conflicting assignments from merged roles MUST remain unconfigured for user review. Deck MUST NOT infer model strength.

**Scenario:** Given identical Backend and Frontend Apply assignments, when legacy configuration is read, then the value is presented for Apply Deep; given different values, Apply Deep is unconfigured.

### REQ-010 — Compatibility and generated outputs

Historical legacy IDs MAY be interpreted through an in-memory compatibility map but MUST NOT be installed as physical aliases. Generated runner assets MUST be regenerated from their TypeScript sources and MUST NOT be edited by hand.

**Scenario:** Given an archived artifact naming `deck-developer-explorer`, when compatibility lookup occurs, then it resolves to `deck-investigate` without creating a legacy agent file.
