# Working Brief: Calm workspace and settings modal

Status: in progress (not installed). Lead-owned; English only.

## Intent
Make Deck2's web UI modern, minimalist and usable by humans while keeping every existing function reachable.

## Decisions (user-approved, 2026-11-16)
1. Settings is a modal dialog (T3 Code style): search, SVG icon per section, breadcrumb, close button. The "Session" section is removed; its actions live in the session menu.
2. The global "Capabilities" section becomes "Agents & tools". It covers global items only: which agents/runners are available and whether they work. Plain-language summary first; technical content goes in a collapsed "Technical details" disclosure.
3. Project-scoped items (code map / Codebase Memory, team configuration changes) move to per-project "Project settings", opened from the project's "..." menu in the sidebar. The project name is always visible there.
4. Visual redesign follows the structure of /home/kevin15011/deck-redesign-mockup (README.md): conversation-first, slimmer sidebar, row actions on hover or focus, fewer boxes, spacing/type hierarchy, human-readable agent status, technical metadata behind disclosure.
   - KEEP the existing theme system (themes.css) and all its palettes. The mockup palette is rejected; use theme tokens only.
5. Right panel = option C (hybrid):
   - Subagent progress is shown inline in the conversation as compact expandable lines (e.g. "Investigate · investigating credentials · 2 min").
   - Each inline subagent line shows the provider logo of its runner as a small inline SVG mark (Claude → Claude/Anthropic mark; Codex → OpenAI/ChatGPT mark; OpenCode and Pi → their own marks; unknown → neutral generic agent icon). The logo has an accessible label naming the provider. It is monochrome or uses theme tokens so it fits every theme, and it is derived from the existing recorded runner field (no backend change).
   - Activity, Subagents and Git details move to an on-demand floating inspector that overlays the conversation without reserving layout width. It opens from header icons with counters, and opens on its own only when attention is required (e.g. an approval).
6. Motion: GSAP only, Apple-like, interruptible, reduced-motion respected (repo AGENTS.md).

## Candidate
- /home/kevin15011/deck-next-settings-candidate (settings modal + Agents & tools in progress)
- Baseline: installed combined133 / 6ce06c42, UI28 assets; running PID 322212 must not be touched until approved install.

## Non-goals
- No backend API changes unless strictly required and reported.
- No palette changes.

Investigate keyboard-triggered blue transcript edge and repeated connection checks. Both update and retry notices should overlay the workspace without moving the transcript, composer or inspector. Keep genuine disconnects actionable and keyboard focus visible for controls. Verify slow successful polls, offline/recovery, and Space outside the composer. Implementation pending.

Attempt 1 ended with a disconnected session MCP runtime and no terminal report (event 191638). The notice was still in normal layout. The host rejected integration because the report is missing. Continued the same assignment with its owner on attempt 2; verification pending.

Host performance investigation: 5 seconds is the slow-snapshot threshold, not a polling interval. Visible streaming targets 300 ms, otherwise wait 500 ms after completion. The current store contains 276 receipts, 50 tasks and 8 sessions. Three unauthenticated local health probes timed out twice at eight seconds then returned 403 in 1.66 seconds. These observations precede successful application authentication and are not isolated workspace handler timings. Profile host responsiveness and snapshot cost separately before recommending the primary fix.

Approved event-driven workspace delivery. Deck1 streams sequenced chat events over WebSocket after an HTTP bootstrap but separately polls sidebar status/projects. Deck2 currently polls the complete workspace. Use authenticated SSE for server-to-browser changes and existing HTTP for commands. Measure event volume, idle overhead, recovery and snapshot contention on a representative inert host. Investigation efc75e3c was cancelled before dispatch (192591); its measurement objective is included in implementation c775b310. Preserve active work, finish independent reports, and distinguish native reader termination from browser disconnect.

SSE implementation attempt 1 ended during native preparation (200035, Member preparation lease revoked), with no final report or recorded member output. The guard checks preparation phase and cancellation state; the exact revocation trigger remains unconfirmed. Attempt 2 continues the same logical task. No result was adopted and no SSE release exists from attempt 1.

Accepted attempt 2 (211617). The transcript focus edge reproduced in Chromium. Overlay and scoped focus styling passed desktop/mobile geometry, keyboard, draft preservation and stale subagent recovery with isolated host fixtures. Installed binary does not contain the overlay stylesheet. Repeat recovery coverage on the integrated event-stream candidate before publishing.

Installed release (0c0674100e10), pending user restart. The packaged Chromium workspace health check passed idle SSE, recovery, retained draft, and stable geometry. The separate long-history streaming check met its one-second final-fragment deadline but exceeded its 180 ms animation target in two runs (181 and 252 ms).

Workspace latency follow-up: measure command admission, SSE delivery and projection cost under concurrent member output against long history. Keep drafting responsive and queued commands durable during recovery. Prefer cursor replay after transient failure and scope projection work to affected records where verified. Compare before and after with the same workload. Status: implementation in progress.

The disposable 276-receipt, two-member benchmark reduced median command admission from 2245 ms to 72 ms and median native-to-SSE delivery from 6514 ms to 712 ms. Health p95 rose from 4 ms to 195 ms while its maximum fell from 1670 ms to 323 ms. Cursor replay retained drafts, approvals and queued work. Release pending: the new SQLite expression indexes reject the corruption fixture's setup write before the existing startup-integrity assertion runs. Verify both current write integrity and legacy corrupt-state recovery before publication. The denied-turn fixture recorded delivery but timed out waiting for settlement on both builds.

Installed release 78455076ddff atomically; operator restart pending. Pre-index corrupt-open preservation and indexed malformed insert/update rejection passed, including independent focused rerun. Remaining contracts and integration suites passed. Packaged Chromium workspace-health passed replay, recovery, stable geometry and draft retention. No production session or daemon restarted.
Investigate report event 271984 establishes stage boundaries only. Live read-only sample of latest 30 completed non-outcome receipts for this session: median acceptance to dispatch 20.424s (minimum 2.741s), dispatch to first output 8.496s; mixed history, no idle control. Disposable browser benchmark and evidence-driven fix assigned to 52c40135-a6b8-4a43-a33e-0e973658c984. No current click-to-receipt measurement yet.
Installed binary fixture benchmark (task 52c40135 attempt 1, evidence 273821): recomputed raw median click-to-headers 70.5/79.5 ms short/long idle (30 each), 124 ms busy (15). Six concurrent workspace request loops raise median to ~1.15s, not proof of normal SSE contention. Attempt 2 instruments lock waits and unmeasured preparation to attribute ordinary sends; production cause not confirmed.
Diagnostic task 52c40135 attempt 2, event 275802: independently reran cargo test --locked -p deck2 --test latency; connected sends with four SSE clients pass in 0.60s. Bounded metadata attributes instrumented lock waits and separates startup phases. Real user send evidence pending deployment. No throughput or latency improvement claimed; one unrelated library test failed on first run and passed on rerun, cause unknown.
