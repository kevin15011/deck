# Preconditions: Agent Skill Registry Discovery

## Preconditions Status

- **Change ID:** `agent-skill-registry-discovery`
- **Phase:** Tasks
- **Mode:** Interactive
- **Provenance:** `deck-developer-task` / `atlascloud/zai-org/glm-5.2`, Interactive mode.

## Unresolved External Apply Conditions

**None.**

## Rationale

The repository's `apply` rules (`openspec/config.yaml`) do not treat source modification authorization as an unresolved *external* precondition — they list coding conventions and TDD only. The feature requires no network access, no external credentials, no third-party services, and no real user-filesystem writes during verification (temporary repositories only). The runtime and toolchain (Bun, TypeScript) are present in the environment.

## Authorization Note (handled in tasks.md, not here)

Explicit implementation modification authorization for the Apply phase has not yet been requested after Tasks. Because the repository convention does not classify this as an external precondition, it is recorded as an explicit **Apply Authorization Gate** in `tasks.md` (a runtime/contract boundary owned by the central coordinator), not as a precondition in this file. Apply may begin only after the coordinator records that user modification authorization; until then, all tasks are planned but not authorized to edit source.

No other blockers are invented.
