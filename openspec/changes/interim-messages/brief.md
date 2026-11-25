# Interim (progress) messages for Claude and Codex Lead replies

## Intent
Lead replies currently mix mid-turn narration ("Checking X…", "Building…") with the final answer.
Codex floods the chat with commentary messages; Claude glues interim text into one block while running,
then replaces everything with the SDK final text and shows the first-output time instead of the
final answer's time. Show interim messages as a distinct, self-replacing progress block and keep only the
final answer as the main message.

## Acceptance
1. Each Lead reply segment carries a kind: `progress` or `answer`, for both Claude and Codex.
2. While a turn runs, all progress segments render in ONE progress block (different background, smaller,
   muted text) under the Lead header showing only the LATEST progress segment and its time; each new
   progress segment replaces the previous one (same feel as the live tool-activity line).
3. The final answer renders as the normal Lead message with the time it was written (its segment `at_ms`).
4. After the turn ends, progress segments stay available collapsed under the answer behind a toggle such as
   "Show 7 updates", which expands them with their individual times. Nothing is discarded.
5. Interrupted/failed turn without an answer: the last progress segment remains visible (plus the collapsed list).
6. Legacy receipts (segments without kind, or no `message_times`) render exactly as today.
7. Claude no longer loses interim text at completion and no longer shows the first-output time on the final answer.

## Design
### Shared model (`crates/shared/src/lib.rs`, `MessageTime`)
Add `kind: Option<MessageKind>` with `#[serde(default, skip_serializing_if = "Option::is_none")]`;
`enum MessageKind { Progress, Answer }`, `rename_all = "snake_case"`. Update all constructors
(`crates/host/src/native.rs` ~3193, `message_times.rs` backfill, tests). Frontend type in
`frontend/src/api.ts:16` and its validator at `api.ts:58` must accept the optional `kind`.

### Codex (`crates/host/src/native.rs`, Lead reply loop ~2599-3230)
- `item/started` agentMessage (~3140): read `item.phase` (`MessagePhase`): `commentary` -> Progress;
  `partial_answer` | `final_answer` -> Answer; null/absent -> Progress, remembered as "unphased".
- First non-empty delta (~3192) pushes `MessageTime { start, at_ms, kind }` as today, plus kind.
- `item/completed` agentMessage: if it carries a phase and a segment was pushed for this item, update that
  last segment's kind (phase may only be final at completion).
- `turn/completed` with status completed: if no Answer segment exists and the last segment was unphased,
  promote the last segment to Answer (legacy models without phase).
- Codex member path (`codex_member.rs`) is out of scope.

### Claude (`crates/host/bridge/claude.ts`, `crates/host/src/claude.rs`, `crates/host/src/server.rs`)
- Bridge: on main-thread (`!parent_tool_use_id`) `stream_event` `content_block_start` with
  `content_block.type === 'text'`, emit `{type:'text_start', session_id: thread}` before its deltas.
- Host delta loop (`claude.rs` ~1244): a `text_start` marks the next delta as a new segment.
  `append_claude_delta` (`server.rs:391`) gains a `new_segment` flag: when set and the text is non-empty,
  push "\n\n" if `r.text` is non-empty, then push `MessageTime { start: utf16 len, at_ms: now, kind: Progress }`.
  The coalescing loop already breaks on non-delta events.
- Finalization: both `r.text = text` sites (`claude.rs` ~901 and ~952) call one helper instead:
  - no segments, or any segment without kind -> legacy: `r.text = text`.
  - empty final text -> keep segments as progress.
  - otherwise find the shortest suffix of segments whose whitespace-normalized text equals the
    whitespace-normalized final text; mark those segments Answer and keep `r.text`.
  - no match -> append "\n\n" + final text as a new Answer segment at now.
  - Segment `start` values are UTF-16 offsets; convert to byte indices carefully.
- `claude_member.rs` is out of scope.

### Frontend (`frontend/src/lead-replies.tsx` `LeadReplyText`, plus CSS)
- Partition segments by kind. Legacy (any missing kind) -> current rendering unchanged.
- Live: progress block shows only the latest progress segment (text + time), then answer segments as
  normal message parts. Header/answer time comes from the first answer segment's `at_ms`.
- Settled: answer segments as the main message; a collapsed toggle lists all progress segments with times.
- Keep `DisplayedReply` / `displayStart` behavior attached to the answer content; copy button copies the answer.
- Follow existing visual language (see `frontend/src/style.css`, `activity.css`); reduced-motion safe.

## Verification
- Rust unit tests: Claude finalize helper (match single/multi-segment suffix, mismatch append, legacy,
  empty final, UTF-16 offsets with non-ASCII); Codex phase classification incl. unphased promotion.
- Fake-runner integration where an existing harness exists (`crates/host/tests/fake_claude_sdk.py`).
- Frontend: pure partition function tested with bun (`frontend/src/*.test.ts` style); `bun run typecheck`.
- Focused cargo tests while iterating; full `cargo test --locked -p deck2` once at handoff (must stay <= 5 min).
- Toolchain: cargo is not on PATH; use `PATH=$HOME/.rustup/toolchains/1.92.0-x86_64-unknown-linux-gnu/bin:$PATH`.
- Follow `AGENTS.md` build/test/cleanup rules. Do not publish `dist/deck2`, do not commit.

## Non-goals
Member/subagent conversation rendering; changing tool-activity UI; publishing.

## Status
Implemented (apply-fast b6495c04). Lead full gate on final tree: cargo test 616 passed / 0 failed (68 s); typecheck and 128 bun tests pass. Browser visual check pending; not committed or published.

## Related
Claude model catalog probe deadline raised to 20 s (auth/version/quota stay 5 s), apply-fast baa0234e; flaky test fixed in attempt 2.

## Visual agreement v2 (user feedback 2026-11-25: progress block feels flat; must read as live, in-process, not the final answer)
Targeted adjustment; keep the existing calm workspace aesthetic, palette tokens and typography.
- Live state (turn running): the block must clearly read as "working".
  - Header row inside the block: animated live indicator reusing the existing `.lead-progress-dot` visual language
    (accent `--action`, same size), a short label such as "Working" plus the update time (and optionally "Update N").
  - Left accent rail or border in `--action` with a slow, subtle breathing/shimmer (opacity/gradient sweep, ~2-3 s loop).
  - Body text muted; a soft one-pass shimmer or fade-in when new text arrives is allowed, never continuous flashing.
  - Replacement transition: when a newer update replaces the previous one, the old text exits up/fades and the new
    enters from below (~180-240 ms, ease-out). Streaming growth of the same update must not retrigger the transition.
- Settled state (turn finished or interrupted): indicator and rail stop and become static; the block collapses into the
  existing "Show N updates" details. Expanded updates are static, quieter (no motion), with their times.
- Clear contrast with the final answer: the answer stays the normal message; the progress block must never look like it.
- Motion via the existing GSAP usage (see `frontend/src/processing-progress.tsx`, `view-motion.ts`, `motion.tsx`) or CSS
  keyframes; respect `prefers-reduced-motion` (no loops/slides; static indicator, label remains). Keyboard/a11y: the live
  block uses a polite live region only for the label change, not every streamed token.
- Selected skills: `gsap-core` (motion implementation, reduced motion), `apple-design` (restraint, feedback, spatial consistency).
- Class names must not collide with existing ones (`.lead-progress*` belongs to the composer status bar; use `.lead-update*`).
