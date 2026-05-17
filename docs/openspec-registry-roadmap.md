# OpenSpec + Spec Registry Roadmap

This document describes the phased roadmap for Deck's artifact management and workflow control plane.

## Core Direction

- **OpenSpec** is the visible, versionable artifact format. All SDD artifacts are persisted as OpenSpec files — this is required and non-optional.
- **Spec Registry** is the operational authority and control plane for Deck's SDD workflow. It tracks change lifecycle, artifact state, and events.
- **Memory systems** are auxiliary only: preferences, feedback patterns, conventions, session learnings. They must not replace or overwrite official specs/artifacts. Concrete adapters (memory adapter, graph adapter) may be integrated later via the neutral sync model.

## Phase 1: OpenSpec + Minimal Spec Registry + Events

**Status: In progress**

- Runtime-neutral type definitions for the Spec Registry model:
  - `ChangeStatus`, `ChangePhase` — change lifecycle tracking
  - `ArtifactKind`, `ArtifactStatus` — artifact identification and state
  - `SyncStatus` — future-neutral sync state (no adapter-specific names)
  - `SpecRegistryEntry`, `SpecRegistryArtifact` — registry data models
  - `SpecRegistryEvent` — event log entries with provenance (`actor`, `evidence`, `metadata`)
- Path helpers for OpenSpec directory layout:
  - `openspec/registry/` — registry index
  - `openspec/changes/{name}/` — one directory per change with `state.yaml`, `events.yaml`, and artifact files
  - `openspec/schemas/developer-team/` — custom schemas
- Event types covering core workflow and future-neutral sync:
  - Core: `change.created`, `change.phase_transition`, `artifact.updated`, `artifact.approved`, `artifact.rejected`, `human.approved`, `human.rejected`
  - Sync (future-neutral): `sync.targeted`, `sync.completed`, `sync.failed`
- Developer Team content refactored to require OpenSpec artifacts and remove `engram | openspec | hybrid | none` mode selection

## Phase 2: Custom Schema + Templates

**Status: Planned**

- Define JSON schemas under `openspec/schemas/developer-team/` for:
  - Change state (`change-state.schema.json`)
  - Artifact metadata (`artifact.schema.json`)
  - Event log entries (`event.schema.json`)
- Provide starter templates for each artifact kind:
  - `proposal-template.md`, `spec-template.md`, `design-template.md`, `tasks-template.md`
- Runtime validation of OpenSpec artifacts against schemas
- Schema versioning strategy

## Phase 3: Semantic/Lexical Index over OpenSpec

**Status: Planned**

- Build a local index over OpenSpec artifacts for fast lookup:
  - Full-text search across all changes and artifacts
  - Cross-reference resolution (e.g., which spec covers this requirement, which tasks derive from it)
  - Change history and diff queries
- Index should be derivable from the filesystem (no external state required)
- Consider SQLite-backed index for complex queries (deferred in technology decisions)

## Phase 4: Memory Adapter + Graph Adapter (Deferred)

**Status: Deferred — design extension fields only**

This phase integrates external knowledge systems as sync targets. The Spec Registry's sync model is designed neutrally to support future adapters without hardcoding their names.

### Candidate adapters (not committed dependencies)

Candidate memory and graph adapters may be evaluated in the future. The sync model is designed neutrally so that any adapter can integrate via `sync.targeted` / `sync.completed` events using generic `syncTarget` keys like `"memory-adapter"` or `"graph-adapter"`. Specific product names will appear only in adapter installation code and configuration, not in core types or roadmap docs.

### Extension design

The current types already include extension fields for Phase 4:

- `SpecRegistryArtifact.syncStatus` — tracks sync state (`local_only`, `syncing`, `synced`, `error`)
- `SpecRegistryArtifact.syncTarget` — neutral integration key (e.g., `"graph-adapter"`, `"memory-adapter"`)
- `SpecRegistryArtifact.syncedAt` — timestamp of last successful sync
- `SpecRegistryEvent` with `sync.*` event types — provenance-tracked sync events
- Event `metadata` field can carry adapter-specific payloads without polluting core types

### Integration pattern

All adapters will follow an event-driven pattern:

1. Spec Registry emits `sync.targeted` event with target adapter key
2. Adapter reads artifact from filesystem
3. Adapter processes and persists to its backend
4. Spec Registry records `sync.completed` or `sync.failed` event with evidence

This ensures strong provenance: every sync operation is logged with actor, timestamp, and evidence.

## Phase 5: UI/Dashboard/AI Notes/Team Learning (Deferred)

**Status: Deferred**

- Web-based dashboard for browsing changes, artifacts, and events
- Team learning aggregation from project AI notes
- Visual workflow progress tracking
- Integration with Console (deferred per technology decisions)

## Architecture Decisions

1. **OpenSpec is required, not a mode.** The `engram | openspec | hybrid | none` artifact store selection has been removed. All agents write OpenSpec artifacts to the filesystem.
2. **Memory is auxiliary.** Agents may optionally save concise summaries to memory if a memory adapter is available, but memory never replaces or overwrites official artifacts.
3. **Neutral integration keys.** Sync targets use generic keys (`"graph-adapter"`, `"memory-adapter"`) rather than specific product names. Adapter names appear only in documentation as candidate examples.
4. **Custom schema path.** Developer Team schemas live under `openspec/schemas/developer-team/`, not under any external source naming.
5. **Orchestrator scope is coordination only.** The orchestrator focuses on workflow coordination, artifact persistence, and delegation. It does not manage delivery strategy or review workload.
6. **Event-driven sync.** All future integrations will follow an event-driven pattern with strong provenance tracking.
