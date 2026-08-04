# Design — Adaptive Developer Team Redesign

## Vertical trace

```text
TUI/model configuration
  → canonical core catalog and content registry
  → runner adapter install plan
  → OpenCode config/prompts/skills or Pi agents/skills/profile
  → execution hook bindings for Apply, Quality, and Setup
  → verify exact active inventory
  → retire legacy files into runner-local quarantine
```

## Decisions

1. `DEVELOPER_TEAM_AGENTS` is the desired-state authority and contains seven entries only. A separate legacy map exists for reading history, migration, and cleanup; adapters never iterate it as desired agents.
2. Compact installed content is replaced by one concise adaptive team contract plus role-specific instructions. Legacy prompt exports may remain source-compatible but are not materialized.
3. Existing proportional leadership/runtime decisions are reused. New IDs are bound to direct Apply, protected Quality, and Setup authorization paths; the old fourteen-role phase chain is not recreated.
4. `deck-onboard` and `deck-archive` are standalone bootstrap skills. `deck-setup` is an agent with its paired skill and owns former `deck-init` readiness behavior.
5. Capability instruction bundles remain the composition mechanism. Target lists change to the two Apply roles; all other roles receive relevant read-only guidance through existing composition.
6. Model migration is a pure reader transformation. One-to-one mappings migrate directly. Many-to-one mappings migrate only when all configured legacy values agree; otherwise no target assignment is produced.
7. OpenCode removes legacy agent keys atomically as part of its backed-up config merge. Both adapters write the new candidate first, verify expected bytes, then move exact legacy managed paths to a deterministic quarantine root. Backup manifests include new and legacy paths for rollback.
8. Verification checks both expected content and absence of legacy active paths. Fresh and upgraded plans therefore converge on the same observable inventory.

## Safety boundaries

- No historical OpenSpec artifact is rewritten.
- No generated JavaScript asset is hand-edited.
- No non-Deck-namespaced file is retired.
- User-visible model conflicts are left unresolved rather than guessed.
- Canonical Git discard confirmation remains authoritative.
- Installer tests use temporary roots and fake configuration only.

## OpenSpec persistence shapes

- Delta: `delta.md` containing outcome, targets, evidence, and status.
- Working Brief: `working-brief.md` containing intent, acceptance, decisions, relevant trace, risks, non-goals, progress, and result.
- Full SDD: normal Proposal, Spec, Design, Tasks, lifecycle registry, and apply/verify evidence.

The lightweight shapes are Lead-owned persistence, not mandatory agent-per-artifact phases.
