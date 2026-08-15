# Exploration: Canonical Supermemory Conversation Memory

## Outcome sought

Deck must use Supermemory as a coherent project memory layer that improves cross-session continuity without mixing repositories, multiplying low-value writes, or adding installation choices after the user selects Supermemory.

## Repository findings

- OpenCode is the only runner that currently emits `x-sm-project`.
- OpenCode derives the value from `process.cwd()` and only strips `github.com`; the current `git@github-p:kevin15011/deck.git` remote therefore produces the malformed `sm_project_git-github-p-kevin15011-deck` scope.
- Pi uses the deprecated `https://supermemory-new.stlmcp.com` endpoint with an API-key header and no project scope.
- Codex uses native OAuth at `https://mcp.supermemory.ai/mcp` and no project scope.
- Authentication identifies the account; project scope is a separate boundary.
- `maxMemoriesPerSession` is prompt-level guidance rather than an enforced production limit because agents call provider MCP tools directly and the adapter's governed `commit()` path has no production callers.
- The adaptive-memory package repeats immediate-save triggers and mandatory session summaries across session, agent, and skill surfaces.
- Observed Supermemory spaces are fragmented and contaminated: `sm_project_default`, `sm_project_kevin15011-deck`, `sm_project_deck`, `p:deck`, and the malformed current OpenCode scope contain overlapping or unrelated repository records.

## Official Supermemory evidence

Evidence retrieved from official Supermemory documentation on 2026-08-11:

- `containerTag` is the hard isolation boundary and must be present on every write and search.
- Production applications should ingest conversation turns, often the full session, under one stable `customId` instead of pushing isolated one-line facts.
- `dreaming: "dynamic"` is the production default; it groups related material for higher graph quality and lower cost. `instant` is for tests or paths that require immediately available memories.
- One ingested document yields raw chunks, extracted memories, and a profile in the same container.
- Profiles provide broad always-on context; query search retrieves specific relevant context; document search provides source grounding; hybrid combines memories and chunks.
- Supermemory performs extraction, temporal updates, relationship building, and deduplication. Deck should not duplicate that learning model with prompt-authored topic keys or an arbitrary semantic memory quota.

Sources:

- https://supermemory.ai/docs/concepts/how-it-works
- https://supermemory.ai/docs/quickstart
- https://supermemory.ai/docs/concepts/filtering
- https://supermemory.ai/docs/concepts/user-profiles
- https://supermemory.ai/docs/recall/search

## Product decisions

Approved by the user on 2026-08-11:

1. Selecting and installing Supermemory enables its recommended conversation capture behavior by default.
2. Deck must not add another capture opt-in, mode selector, or installation step.
3. The fixed seven-memory semantic limit is not part of the target model.
4. All other isolation, runner-parity, migration-safety, retrieval, privacy, and observability recommendations remain approved.

## Constraints

- OpenSpec remains official context; adaptive memory is advisory.
- Deck must not store provider credentials in project or global Deck configuration.
- Automated tests must not call external networks, perform real installations, or write to the real user home.
- Migration is copy-only and dry-run-first. Deletion of legacy remote data is out of scope without a separate explicit confirmation.
- Existing user-managed MCP entries must not be silently deleted or overwritten.
