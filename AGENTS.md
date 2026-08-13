# Deck Agent Guide

> **Audience:** AI agents working in this repository.
> **Authority:** explanatory navigation and safety map; OpenSpec and source remain authoritative.
> **Maintainer:** Deck maintainers.
> **Evidence:** [contributor guidance](CONTRIBUTING.md), [OpenSpec configuration](openspec/config.yaml), [registry schema](openspec/registry-schema.md), and [Git safety source](packages/core/src/teams/developer/git-safety.ts).

## Authority order

Use active/promoted OpenSpec artifacts and registry records for requirements and lifecycle. Use source, tests, package metadata, workflows, scripts, schemas, and generated outputs for runtime and volatile facts. Treat this file as navigation, not a competing procedure.

## Safe editing

Never hand-edit generated outputs such as `packages/core/src/skills/external/content.generated.ts` or `apps/cli/src/runtime/build-info.generated.ts`. Preserve historical `openspec/changes/**` and `openspec/archive/**` content unless the normal OpenSpec lifecycle explicitly authorizes it.

Git-discard operations require the canonical protection workflow in [git-safety.ts](packages/core/src/teams/developer/git-safety.ts): explain the irreversible effect and require a new message containing the exact command before execution.

## Navigate

Read [CONTRIBUTING.md](CONTRIBUTING.md) for commands and contribution procedure, [architecture](docs/architecture.md) for stable boundaries, and [OpenSpec configuration](openspec/config.yaml) for SDD context. Symbol and graph tools are optional navigation aids; repository sources and OpenSpec artifacts are the authority.
<!-- deck:developer-team:start -->
## Deck Developer Team (static-compatible)
Use the Deck-provided native roles and skills for collaboration.
Protected invocation authorization, controlled effects, centralized registry writes, and bound verification are not host-enforced on this launch route.

## Package Instructions (configured)

These instructions are enabled by the runner's native package instruction system.

Adaptive memory is provided by the runner's configured memory system. Supermemory conversation capture is not production-wired on current the active runner, Pi, or Codex static-compatible paths because no trusted authenticated MCP execution boundary is exposed to Deck hooks.

### Conversation Capture

- Selecting Supermemory remains the only memory provider decision; do not add or ask for a second capture toggle, consent screen, quota, or mode selector.
- Supermemory token or OAuth credentials identify the account; Deck supplies project isolation through one Deck-materialized canonical project scope.
- Automatic scoping contract: once a real executing transport exists, one runner session must be captured as one conversation document with a stable customId and canonical project scope.
- Supermemory owns extraction, profiles, graph updates, ranking, temporal updates, and deduplication.
- Agents must not manually extract routine facts, create topic keys, fill a semantic memory quota, or write mandatory session summaries.

### Project Scope Binding

- Adaptive-memory project operations are disabled because Deck detected configured scope missing.
- Fail closed for memory and fail open for coding work: do not save, search, list, document, graph, or use save equivalents for project memory.
- Do not use a default container, active space, or an agent-derived replacement scope.
- Account-only readiness checks may still be used for authentication/status when exposed by the runner.

### Retrieval

- Load bounded project-profile context once on start/resume when healthy.
- Search only when prior context is materially relevant or the user requests recall.
- Keep recall advisory, scoped to the canonical project container, limited to five results and about 1,500 tokens by default.
- Keep query rewriting and reranking disabled unless benchmark evidence enables them.

### Privacy and Authority

- Reject or redact credentials, private keys, authorization headers, and raw environment dumps before ingestion.
- Do not automatically ingest OpenSpec artifacts, provider responses, web content, tool output, or raw logs merely because they appear in conversation.
- OPENSPEC IS OFFICIAL CONTEXT — ADAPTIVE MEMORY IS ADVISORY. OpenSpec artifacts, source, tests, and current runner evidence win.
- Fail-open: memory errors must not block coding work, continue working normally, and diagnostics must be redacted.

### Provider: Supermemory

Use the runner-exposed Supermemory tools only for bounded recall, account readiness, and explicit user forget requests. Do not pass arbitrary containerTag values; Deck owns the canonical project scope. Do not claim automatic conversation capture on unsupported/static-compatible runners.
<!-- deck:developer-team:end -->
