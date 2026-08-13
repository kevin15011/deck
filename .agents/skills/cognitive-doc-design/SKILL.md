---
name: cognitive-doc-design
description: "Design docs that reduce cognitive load. Trigger: writing guides, READMEs, RFCs, onboarding, architecture, or review-facing docs."
license: Apache-2.0
metadata:
  author: gentleman-programming
  version: "1.0"
---

## When to Use

Load this skill when creating or editing documentation that people need to understand quickly, retain, or use during review.

Use it especially for:

- PR descriptions and review notes.
- Contributor or maintainer guides.
- Architecture, workflow, or onboarding docs.
- Any doc that currently feels long, dense, or hard to scan.

## Critical Patterns

| Pattern | Rule |
|---------|------|
| Lead with the answer | Put the decision, action, or outcome first. Context comes after. |
| Progressive disclosure | Start with the happy path, then add details, edge cases, and references. |
| Chunking | Group related information into small sections. Keep flat lists short. |
| Signposting | Use headings, labels, callouts, and summaries so readers know where they are. |
| Recognition over recall | Prefer tables, checklists, examples, and templates over prose that must be remembered. |
| Review empathy | Design docs so reviewers can verify intent without reconstructing the whole story. |

## Documentation Shape

Use this default structure unless the repo already provides a stronger template:

```markdown
# <Outcome-oriented title>

<One paragraph: what changed, who it helps, and why it matters.>

## Quick path

1. <First action>
2. <Second action>
3. <Verification or expected result>

## Details

| Topic | Decision |
|-------|----------|
| <area> | <concise explanation> |

## Checklist

- [ ] <Reader can confirm this>
- [ ] <Reader can confirm that>

## Next step

<Link or action that continues the workflow.>
```

## PR and Review Docs

When documenting a PR, reduce reviewer burnout by making the review path explicit:

- State what to review first.
- State what is intentionally out of scope.
- Link the previous and next PR when work is chained.
- Keep each section focused on one decision or unit of work.
- Use checklists for acceptance criteria and verification.

## Commands

```bash
# Check markdown files changed in the current branch
git diff --name-only -- '*.md'

# Inspect PR changed-line count for cognitive load
gh pr view <PR_NUMBER> --json additions,deletions,changedFiles
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
