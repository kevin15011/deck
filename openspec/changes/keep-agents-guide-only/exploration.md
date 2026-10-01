# Exploration: Root AGENTS.md Responsibility

## Question

Should Deck continue to materialize Developer Team and capability/provider instructions into the repository's root `AGENTS.md`, or should that file remain a stable architecture and contribution guide?

## Evidence

- `packages/adapter-codex/src/developer-team-install.ts` writes a managed marker block to `AGENTS.md` while separately composing the same capability bundle into native roles and skills.
- The checked-in block became stale after the Adaptive Memory instruction renderer changed, demonstrating that repository guidance and runtime installation state have different freshness lifecycles.
- `.codex/deck-manifest.json` currently owns the whole `AGENTS.md` hash, so removing it from desired outputs without a migration exemption could trigger generic stale-file deletion.
- Codex new-session launch already bootstraps the native Deck Lead role/skill path; resume behavior does not depend on creating a new root instruction file.
- `docs/architecture.md`, `docs/runners.md`, and `CONTRIBUTING.md` already own the detailed package, runner, and development-command references that root guidance should navigate.

## Conclusion

Use `AGENTS.md` only for stable repository guidance. Preserve runtime instructions on native role and skill surfaces, and migrate old marker blocks only with matching ownership evidence and operation-scoped verification.
