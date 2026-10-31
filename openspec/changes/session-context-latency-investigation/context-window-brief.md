# P-011: Context visibility

## Intent and authorization

The user authorized proceeding with context-window visibility for the Lead and each subagent. Earlier Web UI restart diagnosis is deferred at the user's request; do not continue that investigation as part of this slice.

## Acceptance

- Evaluate Codex, Claude, and OpenCode using existing native telemetry and locally available protocol evidence.
- Show capacity, used tokens, and percentage only when their meaning and compatibility are supported by evidence. Session totals, billing usage, cached input, and last-request tokens are not automatically current occupancy.
- Distinguish reported, estimated, last-observed/stale, and unavailable information. Missing data must never display as zero.
- Attribute observations to the correct task, attempt, native context, and model. Handle continuation, compaction, completion, model changes, and reconnects without misleading reuse.
- Place compact, accessible information beside Lead status and individual subagent entries, usable on mobile and desktop within existing visual patterns.
- Add no model calls, transcript replay, polling of native history, or custom compaction. Keep storage and UI projection bounded and use existing event flow.

## Current evidence and next step

The earlier investigation established that native usage counters require semantic validation. Parent discovery found Codex `thread/tokenUsage/updated` mapped to `usage`, and Claude result usage mapped to input/output/cache counters. Neither alone proves current occupancy. The graph generation is stale and candidate mapper coverage is untracked; direct source/protocol verification is required.

A bounded investigation will return a runner capability table, exact production data path, uncertainty labels, and the smallest implementable contract/UI proposal. Implementation follows this evidence without requiring another authorization for reversible in-scope work. Lead owns OpenSpec updates; specialists return compact evidence and references.

## Status

Investigator task `task-1cf2011b-0318-4587-84f5-47cef713f609` continued for this bounded investigation. No context meter implemented yet. Existing P001/P012 canary activation is already verified and is separate from this slice.

## Reviewed feasibility and implementation constraints

Investigation attempt 6 identifies Codex `last` counters and nullable `modelContextWindow`, Claude aggregate result counters and per-model capacity, and OpenCode assistant-message counters plus a separate model catalog limit. Lead source checks confirm existing Codex/Claude usage mapping and the absence of usage retention in the inspected CurrentEvents projection. Treat proposed arithmetic and live occupancy claims as provisional: Codex post-compaction totals and OpenCode cache composition need semantic evidence, not merely field types. Claude per-call fields were not established; that is not proof that they do not exist.

Proceed with one vertical implementation owner. Resolve these bounded semantic questions from installed SDK/schema/native implementation or existing sanitized fixtures during implementation. Do not launch inference to discover them. If unresolved, show the last reported counter with its actual basis, capacity alone when attributable, or an explicit unavailable state; do not manufacture an occupancy percentage. A percentage requires a justified compatible numerator/denominator and an estimated/last-observed label rather than a claim of exact current usage.

Use an optional validated normalized context observation while preserving existing usage fields. Retain at most one sanitized observation per task through the existing event/snapshot flow, without raw native bodies. Reject unrelated native threads/turns and stale attempts at producer and projection boundaries. Compaction invalidates freshness until evidence supports a new observation; a late pre-compaction event must not revive freshness. On completion, retaining the final observation as explicitly last-observed is acceptable and useful; clear or invalidate it on incompatible continuation, model/native-context changes, and session end. Live and reconnect behavior must agree.

Unavailable information should be discoverable alongside Lead/subagent status rather than silently represented as zero. Reuse existing typography and layout; no visual redesign. Independent review will verify attribution, arithmetic, bounded retention, and lifecycle behavior after the candidate is functional.

Implementation owner: `apply-deep`, task `task-7774d031-14d9-4c0a-bd3f-1a30b04a6cf6`. Candidate pending; investigate attempt 6 integrated with the qualifications above.

## Candidate review

Implementation attempt 1 is integrated for independent review, not activation. The candidate displays Codex last native total, Claude aggregate input with single-model reported capacity, and OpenCode input from the correlated HTTP response with unavailable capacity. All are explicitly last-reported counters; current occupancy and percentages remain unavailable. Lead inspected contract/projection/UI and adapter/host diffs and the 1,004-pass test log. Browser checks use rendered component fixtures and real CSS at 320/390/1280px, not a live daemon end-to-end scenario. Independent review continues with quality task `task-42242c04-39b4-4a34-a996-c6f54bf9e0c9`. No P011 commit/build/activation yet.

## Independent review: changes requested

Quality attempt 6 found one P2: fresh Codex/OpenCode tasks discover native identity after task creation, but CurrentEvents overwrites the discovery/start records on completion. Replaying its snapshot can then reject the retained usage because the thread fence is not established. Lead checked the source mechanism and accepted the finding. The implementation owner will preserve bounded attribution evidence and add late-discovery completion/reconnect/rebuild regressions without weakening validation.

A related nonblocking efficiency finding is included in the same delta: each card currently rebuilds the entire projection. Share one bounded indexed projection per event set/session instead. The reported 300-task synthetic lookup time is not measured production latency. Prior review found no additional blocker and accepted the truthful last-reported wording. Candidate remains unapproved and inactive until correction and review.

## Correction candidate

Implementation attempt 2 retains at most two sanitized attribution records per task, preserving late-discovered identity across completed snapshots without relaxing validation. A shared memoized event-set/session index replaces per-card full projection. The 300-card structural test reports 900 projection applications rather than 270,000; this is not an end-to-end latency result. Lead inspected the delta and logs: 377 affected tests passed, and component browser checks passed at 320/390/1280px. Quality is re-reviewing the focused delta. No P011 build or activation yet.

## Final verification

Quality attempt 7 approved the candidate with no new blockers. Independent verification passed 39 focused tests across projection/UI/history/Lead progress, TypeScript and whitespace checks. Late-discovered identity, completed snapshot/rebuild, assignment/model/thread changes, compaction/release, and stale index rejection were verified. Prior unaffected adapter findings remain applicable. The 377-test correction suite and component browser evidence remain supporting evidence; counts overlap and must not be summed. P011 is ready for commit and local canary build. Current occupancy/percentage remains unavailable by design; no provider validation or production latency claim.

## UX correction: stable secondary information surfaces

The user rejects the expanding inline MCP/context disclosures because they displace surrounding controls and make the growing interface impractical. This feedback supersedes the inline `details` presentation accepted above; telemetry semantics and lifecycle guarantees remain valid. P011 is active in canary `13ef94f`; this UI correction is not yet implemented.

### Shared visual agreement

- Audience: people working in long agent sessions on desktop and mobile. Character: calm, compact, functional developer workspace.
- Composition: keep conversation, composer, status controls, and subagent cards stationary when opening secondary information. Use one reusable disclosure surface: anchored nonmodal popover on desktop and an appropriate overlaid sheet/dialog on narrow screens. Use existing navigation/overlay conventions where applicable.
- Density and hierarchy: concise stable triggers; clear panel title, short primary facts, then grouped details. Move verbose basis/caveats into the panel without hiding the distinction between last-reported counters and actual occupancy. MCP groups retain runner/member and configured/active/unavailable/conflicting meanings.
- Typography and palette: preserve existing Deck tokens and font system. Consistent spacing, border, restrained elevation, and touch targets. No unrelated branding/layout overhaul, extra dependencies, decorative imagery, or new status arithmetic.
- Interaction: bounded panel width/height, internal scrolling, viewport-edge positioning, no clipping by parent scroll containers, no document reflow or horizontal overflow. Escape/outside dismissal and focus return; mobile background/focus behavior appropriate to modal sheets. Closing a detail must not trigger unrelated session actions. Close stale panels on session/task removal/navigation.
- One secondary detail panel at a time. Preserve other established dialogs and mobile Back behavior rather than layering competing overlays.
- Motion: minimal optional opacity/position transition only, respecting reduced motion; never animate layout dimensions.
- Skill responsibilities: `deck-frontend-design` routes this agreement; `better-ui` supplies component spacing/surface/hit-target polish; `frontend-ui-engineering` owns implementation within existing React/CSS patterns; `fixing-accessibility` validates focus, keyboard, semantics, and touch usability. Do not introduce Tailwind or a new component stack.

### Acceptance and evidence

Apply this pattern to MCP availability and context in the Lead and subagent list/details as one reversible continuation. Verify actual hydrated browser interaction at narrow and desktop widths, with populated MCP groups, long values, missing context, and viewport-edge triggers. Compare composer/conversation/card bounding boxes and scroll positions before/after opening and closing; assert no displacement. Check focus return, Escape, outside interaction, panel exclusivity, session changes, internal scrolling, and overflow. Existing data/projection tests remain applicable unless invalidated by the UI delta. Lead owns official artifacts; implementation owner remains `task-7774d031-14d9-4c0a-bd3f-1a30b04a6cf6`.

## User refinement: useful context summary, not defensive copy

The user specifically rejects `Context · 148,409 last native total · last reported`: it consumes space while omitting the useful percentage and maximum. This supersedes the verbose trigger and the earlier decision to stop all percentage work at unverified semantics. Prioritize a compact used/capacity/percentage summary, with a small approximation marker where justified, e.g. `≈57% · 148k / 258k` (illustrative only, not this session's measured values). Put basis and freshness explanation inside the overlay, phrased briefly. Display known maximum even if compatible usage is unavailable; never divide aggregate multi-call billing totals by capacity or fabricate missing values.

Investigate runner-native context/status computation, not just field schemas: establish the actual Codex percentage convention from the corresponding implementation, the meaning of post-compaction totals, and feasible existing per-call/capacity evidence for Claude/OpenCode. Do not mistake absence of a previous investigation for impossibility. Reuse passive native events/catalogs; no added inference, transcript polling, or model-name capacity guesses. Implementation remains with the same owner; pending arithmetic refinement follows verified evidence in the same candidate, not a separate redesign. This refinement is not yet implemented or verified.

Coordination: investigator task `task-1cf2011b-0318-4587-84f5-47cef713f609` accepted the native arithmetic follow-up. The attempted refinement delivery to implementation owner returned `task-running`; it was not delivered. Lead must pass this refinement with semantic evidence on the owner's next continuation before accepting the UX slice. Do not cancel current overlay work merely to deliver it.

## Reviewed native arithmetic evidence (investigation attempt 8)

This evidence replaces the previous blanket decision to omit percentages. Lead verified primary sources and the local Claude fixture; native formulas are usable, but availability/attribution of every required field inside Deck still needs implementation verification. The investigator's claim that all three are immediately available is too broad.

- Codex: [protocol at rust-v0.162.1](https://raw.githubusercontent.com/openai/codex/rust-v0.162.1/codex-rs/protocol/src/protocol.rs), symbols `tokens_in_context_window` and `percent_of_context_window_remaining`, and [TUI](https://raw.githubusercontent.com/openai/codex/rust-v0.162.1/codex-rs/tui/src/chatwidget.rs), `context_remaining_percent`, confirm use of `last.totalTokens` and reported window. Native remaining percent is rounded after subtracting a 12,000-token baseline from capacity and clamping used-minus-baseline at zero; used percent is 100 minus remaining. If capacity is at most the baseline, native remaining is zero. Keep full used/max counts; briefly explain the reserved baseline in details since their simple ratio differs from native percentage. The native source itself calls this an estimate; do not advertise exact live occupancy. Never add cached input or use cumulative totals. Investigator reports post-compaction recomputation estimates history; verify that source path before changing the existing compaction freshness fence.
- Claude: [official statusline documentation](https://code.claude.com/docs/en/statusline#context-window-fields) defines usage as latest-response input plus cache creation plus cache read, excluding output. Local `__fixtures__/2.1.296/turn-success.jsonl` indeed carries these fields on assistant `message.usage`. Do not use turn aggregate `result.usage`. Matching that stream field to the native statusline source remains an inference, not a live comparison. Associate any later `modelUsage.contextWindow` capacity with the exact matching native model, never a multi-model aggregate or guessed model-name limit. No new inference run is required.
- OpenCode: [v1.19.1 context sidebar](https://raw.githubusercontent.com/anomalyco/opencode/v1.19.1/packages/tui/src/feature-plugins/sidebar/context.tsx) selects the last assistant message with positive output, sums input/output/reasoning/cache read/cache write, and rounds its ratio to that model's `limit.context`. Missing capacity yields null internally; Deck must not turn it into zero usage. Trace the existing provider catalog access and cache its limit by exact provider/model/server identity without per-event polling. Prefer reusing an existing catalog response; if absent, a bounded local metadata lookup may be added without model inference or blocking the turn. Preserve native request attribution for asynchronous data.

Required next owner continuation: combine compact summary/overlay work with these formulas, meaningful edge-case tests and model/attempt/compaction/reconnect checks. Old stored aggregate observations must remain distinguishable and must not acquire a percentage retroactively. Add only a short estimate/freshness hint where useful; no verbose defensive trigger. At this point owner attempt 3 is still running, so this arithmetic refinement has not yet been delivered or implemented.

## Overlay candidate and arithmetic continuation

Owner attempt 3 implements the shared desktop popover/mobile modal sheet. Lead reviewed portal/focus/dismissal code, a mobile screenshot and hydrated Chromium fixture results at 320/390/1280px: stable boxes/scroll, navigation, exclusivity and dismissal checks pass. This is accepted as a partial candidate, not final UX acceptance. The previously undelivered user refinement and reviewed native arithmetic evidence have now been delivered successfully to the same owner for implementation in attempt 4. User-requested used/max/percentage remains required before this combined candidate is ready for review/activation.

## Combined functional candidate

Owner attempt 4 now implements compact percentage/used/max summaries with the reviewed native formulas, paired with the nonshifting overlays. Claude new observations use latest main assistant response input/cache and exact-model capacity; legacy aggregate observations never gain percentages. OpenCode uses positive-output response totals and one bounded nonblocking authenticated local catalog request (1.5 seconds, 4 MiB, 10,000 validated limits, redirects rejected), falling back to used-only if capacity is late/missing. Conservative compaction fencing remains. Lead reviewed source boundaries, passing logs (343 runner/core/history; 49 UI; final OpenCode 117 overlaps earlier checks), and updated mobile screenshot. Independent quality review of the combined delta is running. No new canary build/activation yet. Exact evidence: `/tmp/p011-summary-handoff.txt`; hydrated fixture screenshots/checks: `/tmp/deck-secondary-info-browser/`.

## Combined review: two corrections required

Quality attempt 8 found two P2 issues, accepted by Lead after source inspection: Claude synthetic API error assistant envelopes can replace valid context with a false zero, and automatic secondary-panel dismissal leaves an inert duplicate browser Back entry. The original owner is correcting both with structured error guards and bounded navigation behavior, preserving ordinary Back/Forward and existing ownership boundaries. Compact presentation, reviewed native arithmetic, bounded OpenCode lookup and legacy handling otherwise passed review. Independent checks: 81 focused tests plus hydrated viewport checks and typecheck; these did not cover the two reproduced edge cases. No new build or activation until delta verification.

## P2 correction candidate

Owner attempt 5 excludes structured Claude synthetic/error envelopes from context measurements while retaining visible errors and the previous valid observation; genuine zero usage is still valid. Navigation consumes route-change transient entries and skips owned automatically dismissed Forward markers without an extra visible Back step; physical browser-history deletion is not claimed. Pending traversal, reload and ownership boundaries have targeted regressions. Lead inspected the delta and 94-pass/real-browser fixture evidence. Focused quality re-review is pending; arithmetic and visual direction remain unchanged. Evidence: `/tmp/p011-p2-handoff.txt`, `/tmp/deck-p011-p2-browser/checks.json`. No new build/activation.

## Combined final approval

Quality attempt 9 approved both P2 corrections with no remaining blockers. Independent checks passed 53 focused tests, hydrated navigation checks at 320/390/1280px, TypeScript and whitespace verification. Earlier arithmetic and compact presentation findings remain applicable. The combined candidate is ready for commit/local canary installation; prior inline canary remains active until separately verified. Fixture-based validation does not establish live provider comparison or production latency improvements.
