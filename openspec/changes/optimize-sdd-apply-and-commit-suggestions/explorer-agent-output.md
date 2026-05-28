## Exploration: optimize-sdd-apply-and-commit-suggestions

### Goal
Investigate where to update SDD workflow guidance for Apply batching, post-Archive commit suggestions, Explorer triage, and role-based delegation outside SDD.

### Current State
- **Apply routing** exists in Orchestrator skill but has no explicit batching criteria — currently implied one-task-per-agent behavior.
- **Task skill** already produces grouped output (Shared/Backend/Frontend) with parallelization guidance — this is the authoritative source for Apply batch grouping.
- **Archive skill** is traceability-focused with no commit/PR suggestion behavior.
- **Explorer triage** in Orchestrator Triage Gate does not explicitly cover internal workflow changes (prompts, agent configs, SDD internals).
- **Agent models** are registered in agent configs (`model:` field) and are non-overridable by Orchestrator.

### Relevant Files
| File | Role |
|------|------|
| `.pi/skills/deck-developer-orchestrator/SKILL.md` | Primary target: Apply batching, Explorer triage, post-Archive behavior |
| `.pi/skills/deck-developer-task/SKILL.md` | Reference: execution-group output format |
| `.pi/skills/deck-developer-apply-*/SKILL.md` | Accept ordered task groups (minor update) |
| `.pi/skills/deck-developer-archive/SKILL.md` | No change needed for commit suggestion |
| `.pi/agents/deck-developer-*.md` | Agent configs (read-only, models registered) |

### Constraints
- Agent models registered in configs — cannot be overridden by Orchestrator.
- Changes are prompt/configuration only — no code changes.
- Apply agents are terminal — batching guidance must come from Orchestrator.
- Archive should not own commit suggestion behavior per its own rules.

### Risks
1. **Launcher coupling unknown** — prompt-only changes may not affect launcher behavior.
2. **Over-grouping** — batching too many tasks makes context too broad.
3. **Under-parallelization** — without explicit fanout criteria, independent work may run sequentially.
4. **Commit suggestion ambiguity** — conventional commit type/scope may be unclear.

### Options and Tradeoffs
1. **Orchestrator skill only** (low effort) — single file update with all changes; post-Archive logic in non-obvious location.
2. **Distributed changes** (medium effort) — coordinated updates across Orchestrator + Task + Apply skills; cleaner separation.
3. **Minimal** (low effort but incomplete) — only Apply batching guidance; leaves Explorer triage and post-Archive for future.

### Recommendation
**Option 2 — Distributed changes.** Orchestrator skill is primary target for: explicit Apply batching criteria, fanout conditions, Explorer triage trigger for internal workflow changes, and post-Archive commit suggestion behavior. Task skill reference clarified, Apply skills updated to accept ordered groups. Commit suggestion belongs in Orchestrator (not Archive), or optionally a future git-workflow skill.

### Open Questions
- Is launcher behavior controlled by prompts alone, or separate configuration?
- Does post-Archive commit suggestion belong in Orchestrator, or a dedicated git-workflow skill?
- Should PR title/body suggestions be conditional on PR workflow detection?
- Is "internal workflow change" explicit enough as Explorer triage trigger?

### Ready for Proposal
**Yes.** Affected files identified, model registration confirmed non-overridable, approach clear.

### Registry
- **Artifact Path**: `openspec/changes/optimize-sdd-apply-and-commit-suggestions/exploration.md`
- **State Path**: `openspec/changes/optimize-sdd-apply-and-commit-suggestions/state.yaml`
- **Events Path**: `openspec/changes/optimize-sdd-apply-and-commit-suggestions/events.yaml`
- **Recorded**: phase `explore`, status `completed`, event `explore.completed`
- **Registry Blocker**: none
