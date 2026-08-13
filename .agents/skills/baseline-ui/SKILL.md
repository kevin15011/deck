---
name: baseline-ui
description: Quickly deslop UI code by fixing spacing, hierarchy, typography, and small layout issues. Use when the interface needs a fast cleanup or polish pass.
---

# Baseline UI

Enforces an opinionated UI baseline to prevent AI-generated interface slop.

## How to use

- `/baseline-ui`
  Apply these constraints to any UI work in this conversation.

- `/baseline-ui <file>`
  Review the file against all constraints below and output:
  - violations (quote the exact line/snippet)
  - why it matters (1 short sentence)
  - a concrete fix (code-level suggestion)

## Stack

- MUST use Tailwind CSS defaults unless custom values already exist or are explicitly requested
- MUST use `motion/react` (formerly `framer-motion`) when JavaScript animation is required
- SHOULD use `tw-animate-css` for entrance and micro-animations in Tailwind CSS
- MUST use `cn` utility (`clsx` + `tailwind-merge`) for class logic

## Components

- MUST use accessible component primitives for anything with keyboard or focus behavior (`Base UI`, `React Aria`, `Radix`)
- MUST use the project’s existing component primitives first
- NEVER mix primitive systems within the same interaction surface
- SHOULD prefer [`Base UI`](https://base-ui.com/react/components) for new primitives if compatible with the stack
- MUST add an `aria-label` to icon-only buttons
- NEVER rebuild keyboard or focus behavior by hand unless explicitly requested

## Interaction

- MUST use an `AlertDialog` for destructive or irreversible actions
- SHOULD use structural skeletons for loading states
- NEVER use `h-screen`, use `h-dvh`
- MUST respect `safe-area-inset` for fixed elements
- MUST show errors next to where the action happens
- NEVER block paste in `input` or `textarea` elements

## Animation

- NEVER add animation unless it is explicitly requested
- MUST animate only compositor props (`transform`, `opacity`)
- NEVER animate layout properties (`width`, `height`, `top`, `left`, `margin`, `padding`)
- SHOULD avoid animating paint properties (`background`, `color`) except for small, local UI (text, icons)
- SHOULD use `ease-out` on entrance
- NEVER exceed `200ms` for interaction feedback
- MUST pause looping animations when off-screen
- SHOULD respect `prefers-reduced-motion`
- NEVER introduce custom easing curves unless explicitly requested
- SHOULD avoid animating large images or full-screen surfaces

## Typography

- MUST use `text-balance` for headings and `text-pretty` for body/paragraphs
- MUST use `tabular-nums` for data
- SHOULD use `truncate` or `line-clamp` for dense UI
- NEVER modify `letter-spacing` (`tracking-*`) unless explicitly requested

## Layout

- MUST use a fixed `z-index` scale (no arbitrary `z-*`)
- SHOULD use `size-*` for square elements instead of `w-*` + `h-*`

## Performance

- NEVER animate large `blur()` or `backdrop-filter` surfaces
- NEVER apply `will-change` outside an active animation
- NEVER use `useEffect` for anything that can be expressed as render logic

## Design

- NEVER use gradients unless explicitly requested
- NEVER use purple or multicolor gradients
- NEVER use glow effects as primary affordances
- SHOULD use Tailwind CSS default shadow scale unless explicitly requested
- MUST give empty states one clear next action
- SHOULD limit accent color usage to one per view
- SHOULD use existing theme or Tailwind CSS color tokens before introducing new ones

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
