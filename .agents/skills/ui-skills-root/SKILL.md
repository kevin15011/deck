---
name: ui-skills-root
description: Use before UI-related work to select the smallest useful UI Skills context through the ui-skills CLI.
license: MIT
metadata:
  author: ibelick
  version: "1.0.0"
---

# UI Skills Root

You are the routing layer for UI Skills.

This skill is shown by `npx ui-skills start` and is also available in the registry.

Use it when an agent in Codex, Cursor, or Claude Code has a clear UI goal.

If the goal is unclear, ask one short question.

If the goal is clear, choose the right category, load the smallest useful skill context, then implement.

## Protocol

1. decide if the task is UI-related
2. if not, return `no skill needed`
3. identify the likely category
4. inspect that category with the CLI
5. select the smallest useful skill set
6. load only selected skill(s)
7. implement using that context

## CLI

```bash
npx ui-skills start
npx ui-skills categories
npx ui-skills list --category <category>
npx ui-skills get <slug>
```

## Selection Rules

Prefer 1 skill.

Use 2 only when the task needs two clear angles.

Use 3 only for broad review, redesign, or multi-surface work.

Never use more than 3.

Route by topic, then stack, then specificity.

Prefer specific skills over broad skills.

Prefer framework-specific skills when the stack is obvious.

For quick cleanup, prefer the most specific craft, visual, or layout skill available.

If unsure, inspect categories and pick the safest narrow skill.

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
