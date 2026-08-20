# Working Brief: OpenCode Automatic Memory Same-Turn Repair

## Intent

Ensure a new Deck-managed OpenCode session can retrieve bounded project memory and expose it to the model on the first turn without explicit recall, Context Mode, repository lookup, OpenSpec lookup, web search, or a second turn.

## Acceptance

- Automatic `session_start` recall uses the trusted current user message.
- Relevant project memory reaches the model-visible system context before inference.
- Pending context is isolated by native OpenCode session and consumed once.
- Parent delegation cannot place child-role context in the parent session.
- Child sessions derive memory policy from the native `chat.message.agent` value.
- Compaction's messages transform cannot consume pending adaptive context.
- Quick Fix policy can skip profile/search and inject no adaptive context.
- Explicit recall, Deck-owned project scope, raw-MCP exclusion, and automatic capture remain unchanged.
- Generated source, installed canary asset, and source hash remain identical.

## Root Cause

The original automatic-memory implementation inserted a synthetic system message through `experimental.chat.messages.transform`. OpenCode 1.18.18 discarded that representation during conversion to model messages, so a successful advisory could be lost before inference. Current main had already moved delivery to `experimental.chat.system.transform`, which is model-visible. The remaining correlation defect performed delegated role recall in the parent `tool.execute.before` hook even though OpenCode creates a child native session; that could leave role context on the wrong session and bypass child role policy.

## Decisions

- Keep automatic recall in awaited `chat.message` and model delivery in `experimental.chat.system.transform`.
- Keep `experimental.chat.messages.transform` as a no-op.
- Use instance-local, session-keyed pending context with generation guards and one-shot consumption.
- Derive child memory role from `chat.message.agent`; do not recall from parent tool execution.
- Preserve the current automatic query unchanged; add only sanitized byte-count and SHA-256 metadata.

## Non-Goals

No provider changes, query rewriting, reranking, profile configuration, budget changes, project-identity redesign, explicit-recall redesign, raw Supermemory MCP, direct-runner bootstrap, daemon, TUI redesign, release, or publication.

## Evidence

- Focused production-path tests: 144 passed, 0 failed.
- TypeScript: passed.
- Generated and installed OpenCode plugin: 302,105 bytes and SHA-256 `bed324a77cf7a54f5fe350fd8a0eb3b1aab8cea204b20a2fc42e3cb102aab22d`.
- Source marker: `dc5f7179172a975b46128bc5711d39f0790ddbc16599d6ff5da6b174f6780bd4`.
- Installed OpenCode version: 1.18.18.
- Live first-turn no-tools run: model output contained Orion, Nebula Boundary, and the core/adapter policy; explicit recall count 0; Context Mode count 0; tool events 0.
- Automatic profile returned 5 bounded items; automatic search returned 5 bounded items and contained Orion, Nebula Boundary, and the core/adapter policy.
- Independent Quality result: GO.

## Status

Implemented and verified. No release or publication performed.
