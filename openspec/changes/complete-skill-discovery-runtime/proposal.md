# Proposal: Complete Skill Discovery Runtime

## Intent

Make Deck and Developer Team specialists able to discover and use relevant project and user skills through the active runner while preserving native permissions, untrusted-metadata boundaries, and agent-owned selection.

## Problem

The current descriptor parser rejects normal nested metadata because it measures YAML AST representation depth rather than logical map/sequence depth. Since refresh is intentionally fail-closed, one rejected descriptor prevents a complete registry candidate. Separately, the registry and specialist instructions do not form a production path from task terms to an exact verified native skill load.

## In scope

1. Correct logical YAML collection-depth accounting while retaining all hostile-input checks.
2. Add real compatibility and regression fixtures for project and OpenCode user skills.
3. Provide bounded task-scoped candidate search over a ready registry or bounded direct discovery fallback.
4. Bind selection to an observation identity and reverify it before native loading.
5. Complete one production OpenCode path for Lead-owned work and independently delegated specialists.
6. Report unsupported runner capability honestly; do not infer Codex parity.

## Out of scope

- Installing, updating, copying, or synchronizing discovered skills.
- Automatically loading every discovered skill.
- Trust scores, source precedence, or same-name winner selection.
- Injecting registry records or skill bodies into system prompts.
- Watching skill roots or refreshing the registry implicitly.
- Editing archived OpenSpec history or generated outputs directly.

## Success criteria

- Ordinary `metadata.author/version` descriptors no longer make discovery partial.
- Hostile or genuinely over-deep frontmatter remains rejected.
- A task can obtain bounded relevant candidates, select one observation, reverify it, and load that exact candidate through OpenCode's native mechanism.
- Lead and child specialist contexts do not share false load evidence.
- Missing, invalid, or stale registries fall back safely and do not block unrelated work.
- Duplicate names never silently substitute another observation.

## Dependencies and compatibility

This is a successor to archived `agent-skill-registry-discovery`. It consumes the current canonical session runtime and Developer Team composition without modifying their historical artifacts. Registry V1 and its persistence/fingerprint semantics remain compatible.

## Risks

- Weakening YAML safety while fixing compatibility.
- Substituting a same-name skill at the native loader boundary.
- Treating discovery as authorization or successful preparation as successful loading.
- Leaking absolute user paths into prompts, diagnostics, or registries.

## Rollback

The parser repair can be reverted independently. The runtime capability is additive and SHALL remain behind explicit capability availability; removing its composition restores the existing prompt-guided fallback without changing registry V1 or stored files.

## Approval

The user approved the proposed phased implementation on 2026-09-22 and authorized proceeding with source changes.
