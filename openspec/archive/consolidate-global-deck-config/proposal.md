# Proposal: Consolidate Global Deck Configuration

## Problem

Deck is distributed as a global standalone binary, but production paths currently couple user and runner preferences to a target project's `.deck/config.json`. Workspace detection changes config behavior, adapters re-read project-local files, and running Deck can create preference files inside arbitrary repositories. This conflicts with the existing XDG storage contract and runner-agnostic binary model.

## Outcome

Make `$XDG_CONFIG_HOME/deck/config.json` (default `~/.config/deck/config.json`) the only active source for Deck user and runner preferences. Project roots remain execution/materialization targets, never preference roots. Existing local and legacy configs are preserved as migration inputs and are never silently overwritten or deleted.

## Scope

- Canonical global config store and atomic persistence.
- Production reader/writer migration across TUI, launch, adapters, upgrade, and sync.
- Explicit legacy migration/conflict handling.
- No automatic creation of `<project>/.deck/config.json`.
- Documentation and standalone multi-project verification.

## Non-goals

- A generic layered configuration platform.
- Moving runner-native project artifacts such as `.codex/` or OpenSpec artifacts.
- Deleting legacy project files automatically.
- Redesigning model assignment or project identity.

## Rollback

Restore previous production readers/writers and the canonical XDG preimage. Legacy sources remain untouched, so rollback cannot lose user preferences.
