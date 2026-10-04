# Lead-only recovery

## Authority and outcome
The user approved correcting the multitasking incident with Lead as the sole implementation owner, without delegating to subagents. Scope is Deck's Pi integration only, not core policy or other runners. Preserve existing work and unrelated changes. No personal installation/configuration, release, commits or destructive Git actions.

Acceptance: Lead remains conversational, tracks each task through execution, result admission and integration, automatically follows through at a safe native turn boundary, keeps progress out of chat, rejects obsolete attempts, and provides explicit safe recovery. Completed processes must not masquerade as completed user requests.

## Decisions
- Keep session-isolated child histories, four-slot execution pool and native lifecycle fences.
- Use supported Node-compatible JSON IPC for containment startup proof, retaining nonce/PID validation and fail-closed ownership.
- Add a Pi-only ephemeral task board to native model contexts; no changes to canonical team prompts. Never place raw child text in wake notifications.
- One outstanding native wake coalesces arrivals; progress only updates panel/history. Do not enqueue wakes behind an active response/tool loop: inject current state into natural contexts, otherwise dispatch at native agent_settled or while idle. Actual context admission is separate from integration. Delivery retries are bounded; at most one additional follow-through reminder after admission.
- Add `review` and outcome-fenced `resolve` controls (integrated/blocked with evidence). Titles are distinct from internal assignment prompts. Explicit resume increments attempt identity and clears obsolete results.
- Preserve pending outcomes across exact-session reload; never auto-execute restored children or adopt another parent's records.
- Surface non-durable state rather than claim persistence succeeded; UI/storage failures cannot skip terminal handling or cleanup.

## Reproductions and current progress
- New IPC regression initially failed under pinned Bun 1.3.12; after implementation, 30 execution/containment tests passed, including real packaged child shell tests and allocation pressure.
- Native memory combined failure traced to Bun asset-loader cache collision: materialization imports the original bundle with `type: file`, while the reload test executed the same module identity as JS. Test now uses a separately materialized file, matching installation semantics; no production credentials policy weakened.
- Mixed-completion clock test was assuming that a monotonic interval aligned with the next wall-clock second. Native renderer did refresh. Test now observes bounded actual clock advancement without forcing rendering.
- Six new orchestration regressions were red before implementation, then passed along with existing job/panel tests (22 total). They cover progress silence, batched delivery, persistence/UI faults, admission versus integration, bounded reminders, obsolete outcomes and acceptance rollback.

## Result
Completed by Lead without implementation/review subagents. Full affected verification: 1,141 passed, zero failures, 5,055 assertions across 88 files using pinned Bun 1.3.12 (209.57s). Root TypeScript and diff hygiene pass; generated assets are fresh; core and other runner adapters are unchanged.

Native SDK scenarios prove review -> validation -> resolve -> single synthesis while idle, during text streaming and during Lead tool work. A busy-tool duplicate was reproduced and fixed using native agent_settled; stale attempt callbacks were separately reproduced and fenced. Real interactive Pi PTY probes pass fullscreen and regular, preserving scrolling/editor text and integrating before a second user message. Moving to settled-boundary turns exposed a memory advisory regression; Pi now reuses only the exact parent's existing advisory ephemerally when the system override is absent, with no extra recall/capture or persistence.

An earlier broad run hit its 210-second shell budget after recording 1,096 passes and the then-unfixed memory continuation failure. The complete final run used an appropriate deadline, included all those files, and passed; no failing file was excluded. See verification.md and review.md for current evidence and bounded operational limits. No personal install, live-provider trial, commit or release was performed.
