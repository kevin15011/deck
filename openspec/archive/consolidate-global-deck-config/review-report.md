# Review Report: Consolidate Global Deck Configuration

## Verdict

Approved after iterative independent review.

## Confirmed Boundaries

- XDG config is the only active preference source.
- Project roots no longer choose preference scope.
- Production contracts require caller-resolved normalized config and fail closed when absent.
- Adapters do not activate project-local legacy preferences.
- Migration candidates are explicit migration-only APIs and never active fallbacks.
- Config reads/writes enforce bounded trust, ownership, containment, atomicity, serialization, CAS, and rollback.
- Concurrent unrelated preference patches are preserved.
- Doctor, direct launch, TUI, upgrade, sync, and standalone composition agree.
- The user-authorized cleanup removed the no-longer-needed legacy project/global files only after canonical XDG verification and private backup creation.

## Final Cleanup Review

- `.deck/config.json` is absent, pending tracked deletion, and ignored for future recreation.
- `/home/dev/deck/.deck` and `/home/dev/.deck` are absent.
- Canonical XDG config remains valid, mode `0600`, and carries the authorized Pi/OpenCode/Codex, Supermemory, and Web Search preferences.
- The final 4,502-test suite, typecheck, diff check, and absent-file sentinels passed.
