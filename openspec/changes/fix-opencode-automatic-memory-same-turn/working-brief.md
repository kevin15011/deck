# Working Brief: OpenCode Automatic Memory Logical-Turn Repair

## Intent

Ensure every eligible logical user turn in a Deck-managed OpenCode session retrieves bounded project memory at most once and exposes one isolated snapshot to every model inference derived from that turn, including continuations after skill and tool calls.

## Acceptance

- Automatic recall uses the trusted current user message and is evaluated once per eligible logical user turn, not once per native session.
- Relevant project memory reaches the model-visible system context before the first inference and remains available to later inferences in the same turn.
- Skill and tool calls do not trigger additional retrieval and do not consume the active turn snapshot.
- A later user turn replaces the prior snapshot, reevaluates policy, and can recall after an earlier Quick Fix policy skip.
- Automatic retrieval is limited to one logical retrieval per user turn.
- Turn snapshots are isolated by native OpenCode session and logical user turn, with deterministic replacement and deletion cleanup.
- Concurrent sessions cannot cross snapshots.
- Parent delegation cannot place child-role context in the parent session.
- Child sessions derive memory policy from the native `chat.message.agent` value.
- Child sessions apply their own retrieval policy and cannot inherit a parent turn snapshot.
- Compaction cannot consume, duplicate, or make a turn snapshot permanent and does not trigger an additional retrieval.
- Resume preserves correct per-turn behavior without reviving a previous turn snapshot.
- Quick Fix policy can skip profile/search and inject no adaptive context.
- Explicit recall, Deck-owned project scope, raw-MCP exclusion, and automatic capture remain unchanged; capture stays logically exactly-once.
- OpenCode documentation identifies `experimental.chat.system.transform` as the model-visible injection mechanism and `experimental.chat.messages.transform` as a compaction-safe no-op.
- Generated source, installed canary asset, and source hash remain identical.
- Live acceptance after the mandatory `deck-lead` skill call must retain Orion, Nebula Boundary, and the core/adapter policy with Automatic Recall = 1, Explicit Recall = 0, and Context Mode = 0.

## Root Cause

Current main started automatic recall only when a native `sessionID` was first observed, stored one pending advisory by session, and deleted that advisory immediately after the first `experimental.chat.system.transform` injection. A reproduced prompt produced Adaptive Context = YES for inference 1, invoked the mandatory `deck-lead` skill, then produced Adaptive Context = NO for inference 2. A second user message in the same native session did not reevaluate retrieval policy. The implementation therefore had `recall once per session + inject once per inference` semantics instead of `recall once per eligible logical user turn + inject for every inference in that turn`.

Live OpenCode 1.18.18 tracing also established the production message-correlation shape: `chat.message` exposes an `input.messageID` key whose value is `undefined`, while the trusted native ID is `output.message.id` and `output.message.sessionID` matches the hook session. Correlating only from `input.messageID` suppressed automatic recall entirely and reused fallback capture IDs across turns. The repair therefore resolves the native message ID from a valid input value when present, otherwise from a valid output message ID bound to the same native session.

## Decisions

- Keep automatic recall in awaited `chat.message` and model delivery in `experimental.chat.system.transform`.
- Correlate a logical user turn from trusted OpenCode `sessionID` and native message identity: valid `input.messageID` when present, otherwise valid `output.message.id` only when `output.message.sessionID` matches the hook session; never use a process-global queue.
- Keep one instance-local active snapshot per session, tagged with its logical turn identity and protected by generation guards.
- Replace the prior snapshot when a new trusted user message starts, then retain the new snapshot for every system transform belonging to that turn.
- Keep `experimental.chat.messages.transform` as a no-op. Because OpenCode 1.18.18 also reaches `experimental.chat.system.transform` for compaction, synchronously track the latest newly created native assistant request per session from `message.updated`; suppress injection while that marker is the compaction summary, across all provider retries, without consuming the active snapshot.
- Classify only creation events with valid native session/message IDs and `time.created`; compaction requires `mode=compaction`, `agent=compaction`, and `summary=true`. Ignore terminal, same-message, and older/equal creation events. A trusted user turn restores normal injection while preserving the latest assistant creation watermark, so delayed stale/equal compaction events cannot suppress the newer turn; a genuinely newer normal or compaction request can advance the marker.
- Derive child memory role from `chat.message.agent`; do not recall from parent tool execution.
- Use the same resolved native message ID for automatic-recall and capture event IDs/correlation so retries deduplicate without collapsing distinct turns.
- Preserve the current automatic query unchanged; add only sanitized byte-count and SHA-256 metadata.

## Non-Goals

No provider changes, query rewriting, reranking, profile configuration, budget changes, project-identity redesign, explicit-recall redesign, raw Supermemory MCP, direct-runner bootstrap, daemon, TUI redesign, release, or publication.

## Evidence

- Diagnosis on OpenCode 1.18.18 reproduced inference 1 = Adaptive Context YES and inference 2 after the intermediate skill/tool lifecycle = Adaptive Context NO.
- Diagnosis confirmed that a second user message in the same native session did not reevaluate automatic retrieval.
- Live metadata-only hook tracing confirmed `input.messageID = undefined`, trusted `output.message.id`, matching `output.message.sessionID`, and repeated system transforms before and after the skill call.
- Focused OpenCode reachability: 62 passed, 0 failed. Install coverage: 83 passed, 0 failed. Full adapter-opencode directory: 489 passed, 0 failed. Runtime-host capture/dedup: 24 passed, 0 failed. Documentation governance: 15 passed, 0 failed. TypeScript: passed.
- Compaction coverage follows the OpenCode 1.18.18 production event shape (`message.updated` with nested `time.created`): repeated compaction transforms/retries suppress injection, terminal/older events cannot restore it, the unchanged snapshot returns on a later normal request, concurrent/child sessions remain isolated, and deletion/fresh-instance resume clears state.
- Source SHA-256: `a2892bd5a645fa2b8c451dd0cc49b2c952c41c1336f35964364411bb1e91a03f`. Generated and installed plugin SHA-256: `e6eae7da17c85c8bf53150944af06191dce786ec09f3f5cb82bfa201c2c8a7eb`; byte-for-byte comparison passed.
- Executed canary: `/home/dev/.local/bin/deck-canary` -> immutable payload `/home/dev/.local/bin/.deck-canary.payload-b38956008e4ea0ec3a9a245a70b5b9a6d58ca563c2db621d32d2c019263606bf`. Executed OpenCode: `/home/dev/.nvm/versions/node/v24.19.0/lib/node_modules/opencode-ai/bin/opencode.exe`, version 1.18.18 with automatic update disabled for the pinned run.
- Clean final live acceptance session `ses_fe0d722fdffeOaD5ex8RREmYgJ`, user turn `msg_01f28de2b001Mw3B2QspFkUoKm`: one completed `skill` call, no other tools, Automatic Recall = 1, Explicit Recall = 0, Context Mode = 0, and one logical automatic capture. Final answer: Orion; Nebula Boundary; provider-agnostic policy in core; provider-specific technical translation in adapters.
- Repository-wide suite: 4,767 passed and 6 unrelated failures in unchanged Pi, Codex, core-purity, and adaptive-memory bundle-baseline checks. All six reproduce individually and are outside this change's targets; focused affected gates remain green.
- Independent Quality result: GO for the requested Adaptive Memory change, with no blocking candidate finding. Repository-wide release readiness remains separately red because the six unrelated broad-suite failures are not recorded as known in the baseline ledger.

## Status

Implemented and verified through focused tests, generated/install parity, pinned OpenCode 1.18.18 live acceptance, and independent Quality review. Repository-wide release readiness remains separately blocked by six unrelated unledgered failures. No release or publication performed.
