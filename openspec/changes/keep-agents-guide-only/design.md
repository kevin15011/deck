# Design: Separate Repository Guidance from Runner Instructions

## Decision

Retire `AGENTS.md` as a Codex session-instruction sink. Keep capability instruction composition on native `.codex/agents/*.toml` and `.agents/skills/**` surfaces. Treat the old marker block as migration-only owned content.

## Rationale

`AGENTS.md` is shared repository guidance and is read outside Deck-supervised launches. Injecting runtime role and provider policy there makes volatile installation state appear to be repository architecture, duplicates native role/skill content, and leaves stale instructions behind when the renderer changes.

The change does not replace the instruction bundle pipeline. It removes only the global session-file destination.

## Components

| Component | Responsibility |
|---|---|
| `@deck/core` | Expose a runner-neutral ownership-release field on Developer Team install plans. |
| Codex adapter | Compose roles/skills, inspect prior ownership, plan conservative marker retirement, verify the postimage, and release durable ownership. |
| Upgrade runner sync | Remove released paths from ownership metadata only after successful apply and verification; do not re-add released paths from plan files. |
| Root documentation | Explain stable package and contribution boundaries, not runtime policy. |

## Migration sequence

```text
read prior manifest and AGENTS.md
        |
        v
validate exact markers + matching prior whole-file hash
        |
        +-- invalid/unowned/changed --> preserve file, block cleanup
        |
        v
plan marker-span update with existing transaction semantics
        |
        v
apply -> verify exact postimage -> release ownership metadata
        |
        v
next sync does not touch or reacquire AGENTS.md
```

`AGENTS.md` may appear in an operation-local expected-file set when cleanup is planned so existing apply and verification machinery can validate it. It MUST be excluded from the new Codex ownership manifest and listed in the runner-neutral ownership-release field. Generic stale-file removal MUST explicitly skip this shared file.

The adapter captures one authoritative no-follow `AGENTS.md` path, content, and mode snapshot. Manifest-owned discovery does not reread or overwrite that snapshot. Planner inputs that disagree with the snapshot fail closed. Exact-marker cleanup binds its mutation preimage and expected postimage to this same evidence, so a concurrent user edit is rejected rather than normalized or overwritten.

Ownership-only retirement for a confirmed absent or regular unmarked guide uses operation-bound preconditions without writing the guide. Transaction apply validates those preconditions before native manifest mutation, and adapter verification validates the reviewed post-state. Unsafe, unreadable, symlinked, or non-regular targets block and preserve ownership.

The version-1 Codex ownership manifest carries a narrowly validated `releases: ["AGENTS.md"]` tombstone. The tombstone is not deletion authority; it only re-emits the runner-neutral ownership release during later sync. It remains durable and idempotent so external upgrade ownership can be reconciled after an ordinary install or retried after interrupted persistence.

## Marker validation

- Accept exactly one start marker and one end marker in that order.
- Require a prior `AGENTS.md` manifest hash matching current bytes.
- Remove from the start marker through the end marker only.
- Preserve prefix and suffix bytes exactly; do not normalize whitespace or line endings.
- Keep an empty or whitespace-only resulting file rather than converting cleanup into deletion.

## Installation detection

The durable Codex manifest and native managed artifacts remain the primary installation evidence. An exact legacy marker can identify an installation that requires remediation when no manifest is available, but it does not authorize cleanup. An ordinary unmarked `AGENTS.md` is not installation evidence.

## Documentation ownership

- `AGENTS.md`: stable agent-facing repository map and invariants.
- `docs/architecture.md`: durable package and composition model.
- `docs/runners.md` and support matrix: volatile runner/capability status.
- `docs/adaptive-memory.md`: memory runtime and provider behavior.
- Roles and skills: operational agent behavior.

## Risks

- Generic stale cleanup could delete the shared file if it is not exempted.
- Upgrade sync could re-register an operation-local verification file unless released paths are filtered.
- Older Deck versions can reintroduce the marker block.
- Removing the root block must not remove native Lead bootstrap or capability instructions from roles and skills.
