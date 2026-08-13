---
name: comment-writer
description: "Write warm, direct collaboration comments. Trigger: PR feedback, issue replies, reviews, Slack messages, or GitHub comments."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

Load this skill whenever you write a comment that another human will read.

Use it for:

- GitHub PR or issue comments.
- Review feedback and requested changes.
- Maintainer replies.
- Slack, Discord, or async project updates.

## Voice Rules

| Rule | Requirement |
|------|-------------|
| Be useful fast | Start with the actionable point. Do not recap the whole PR before feedback. |
| Be warm and direct | Sound like a thoughtful teammate, not a corporate bot. |
| Keep it short | Prefer 1 to 3 short paragraphs or a tight bullet list. |
| Explain why | Give the technical reason when asking for a change. |
| Avoid pile-ons | Comment on the highest-value issue, not every tiny preference. |
| Match thread language | Write in the thread/user language. If writing in Spanish, use Rioplatense Spanish/voseo: `podés`, `tenés`, `fijate`, `dale`. |
| No em dashes | Use commas, periods, or parentheses instead. |

## Comment Formula

```text
<Direct observation or request>

<Why it matters, only if needed>

<Concrete next action>
```

## Examples

### Request change

```markdown
Buenísimo el enfoque. Acá separaría este cambio en otro commit porque mezcla la validación con el wiring de UI.

Eso le baja carga al reviewer y hace que el rollback sea más claro si falla la integración.
```

### Approve with a note

```markdown
Está bien encaminado y el scope se entiende rápido.

Dejo aprobado. Para el próximo PR, agregá el link al anterior y al siguiente así la cadena queda navegable.
```

### Ask for split

```markdown
Este PR supera el presupuesto de 400 líneas cambiadas, así que necesitamos dividirlo o justificar `size:exception`.

Mi sugerencia: primero foundation + tests, después integración, después docs. Así cada review tiene inicio y fin claros.
```

## Commands

```bash
# Inspect a PR before writing review feedback
gh pr view <PR_NUMBER> --json title,body,additions,deletions,changedFiles
```

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
