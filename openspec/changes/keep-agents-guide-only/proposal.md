# Proposal: Keep AGENTS.md as a Repository Guide

## Intent

Keep the root `AGENTS.md` focused on stable repository architecture, contribution boundaries, and navigation. Stop using that shared file as a Codex session-instruction sink.

## Outcome

Deck continues to materialize Developer Team roles, skills, and applicable capability guidance through runner-native role and skill surfaces. Fresh installs do not create or append a Deck block in `AGENTS.md`; upgrades conservatively retire an owned legacy block without deleting user-authored content.

## In scope

- Root architecture and workflow guidance for core, SDD runtime, adapters, capabilities, CLI composition, verification, and `deck-canary`.
- Codex install, repair, content-sync, verification, ownership, and legacy marker retirement behavior.
- Documentation corrections for the current Pi, OpenCode, and Codex adapter model.
- Focused regression and documentation-governance coverage.

## Out of scope

- Changes to Adaptive Memory behavior, provider configuration, or project isolation.
- Changes to Developer Team roles, skills, prompts, or launch bootstrap behavior.
- Pi or OpenCode materialization redesign.
- Resolution of unrelated failed findings in `add-first-class-codex-runner-support`.

## Compatibility and rollback

Older Deck versions may reintroduce the legacy marker block during Codex materialization. Rollback reverts this change's source, documentation, and ownership delta; it must not delete user-authored `AGENTS.md` content or modify remote state.

## Relationship to existing changes

This change supersedes only the root `AGENTS.md` marker-materialization requirements in `add-first-class-codex-runner-support` (`REQ-CDX-MAT-003`, `REQ-CDX-MAT-004`, and their instruction-precedence scenario). It does not resolve that change's unrelated failed review findings. Documentation edits are coordinated with, but do not close or rewrite, `deck-product-documentation`.
