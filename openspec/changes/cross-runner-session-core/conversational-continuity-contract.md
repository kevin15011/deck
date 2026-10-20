# Conversational continuity contract

## Active increment: Claude Code and OpenCode steering parity

The user authorized bringing Claude Code and OpenCode to current-turn messaging parity with Codex. On 2026-10-19 Lead fetched origin and verified HEAD and origin/main have zero divergence before starting. Preserve the current dirty worktree and approved Codex/continuity/UI behavior. This increment does not include voice notes or human Web terminals.

The same Apply Deep owner (`task-99bf98b7-ec98-4ead-9000-9f1937389df4`, next attempt 12) owns capability validation and implementation as one vertical slice. Prior research did not establish safe Claude streaming-input or OpenCode busy-session semantics; verify actual installed versions and official protocols with bounded isolated native fixtures before enabling either capability. Minimal native calls for that verification are authorized; runtime upgrades, global configuration changes and live-daemon restarts are not part of the spike.

Parity means delivering genuine input to the active native execution without silent interruption, replacement or an extra turn; preserving the immutable admission, evidence, FIFO, uncertainty, recovery and post-timeout refusal rules already established. Acknowledgement is not model consumption. Unsupported/unknown paths must remain truthful. Generalize runner-specific contracts and UI attribution only where supported by evidence. A material native limitation requires an evidence-backed design checkpoint, not a fabricated capability.

Acceptance requires per-runner native correlation fixtures, focused adapter and actual host-path regressions, unchanged Codex behavior, browser status/selection isolation, and independent review of lifecycle and authority changes. Lead owns official persistence; implementation progress is at `/tmp/deck-runner-steering-parity-progress.md`. Build/install and the canonical canary restart follow a reviewed candidate, preserving the user's existing end-to-end completion instruction.

## Latest installed status — 2026-10-19

Lead verified `/private/tmp/deck-ui-canary-_a4q2mgi/result.json`: the canonical canary restart replaced PID 91841 with PID 1355, nonce `ea37ef15-40f0-402d-bd1c-4af59953566a`, using payload SHA-256 `64012372f4787e71e7e2154bee0e58f427f4e2518b44737078e04e19dd4ee303`. Current daemon status matches that identity and reports version 0.12.0. The user confirms subagents are visible. All delegated tasks are completed. Earlier installation-pending checkpoints below are historical.

Stages 1-3 and the compact Decisions/tab indicator fixes are implemented and installed in canary. Source, isolated browser, native capability spike and packaged checks remain distinct evidence: a complete native scenario through this installed Web UI after main synchronization is not yet claimed. Repository delivery remains uncommitted with staged and unstaged changes, including user integration work. No stable release or push is claimed. Voice and terminal feasibility studies remain separate research-only scopes.

## Active UI feedback delta

The user requested compact Decisions presentation after observing two empty panels on mobile, then additionally requested a working indicator directly in the Subagents tab title. Preserve existing theme tokens and status primitives. Healthy empty decisions must not consume a panel; unresolved decisions must remain discoverable through a compact accessible expandable presentation. Preserve errors, reply targeting and history access. Confirm any duplicate against the current merged UI rather than assuming duplicate call sites.

The Subagents tab must indicate current delegated work even while Chat is selected, on desktop and mobile. Derive activity from the selected session's current task state, not Lead state, stale attempts, unread markers or historical events. Reuse existing working indicators, accessible status text and reduced-motion behavior; clear activity when no delegated task is working and on session changes. Queued/blocked states must not be mislabeled as executing.

The existing Apply Deep owner (`task-99bf98b7-ec98-4ead-9000-9f1937389df4`, attempt 10) is implementing the Decisions delta. The tab-indicator request arrived while that attempt was running and must be handed to the same owner at its next checkpoint before final closure. Lead verified HEAD and origin/main agree after fetch before this UI work. Preserve the user's staged and unstaged conflict-resolution changes; no daemon change is part of the current implementation attempt.

Decisions delta checkpoint: attempt 10 completed. Healthy empty presentation now occupies zero space, and unresolved questions use a 42px collapsed row in the mobile fixture. A real sibling-key collision between queue, decisions and composer was reproduced during session switching and repaired using unique namespaced session keys. The screenshot's exact initial two-card installed state was not reproduced; do not claim a second source mount. Owner evidence includes 21 focused passing tests, six composed-browser groups, typecheck and canonical asset parity; staged index and HEAD were preserved. Lead inspected the report, component and Cyberpunk mobile capture. Evidence: `/tmp/deck-decisions-compact-progress.md` and `/tmp/deck-decisions-compact-evidence/`.

The same owner continues in attempt 11 with the requested Subagents tab activity indicator. No build, install or daemon restart has occurred for these UI deltas; previously validated packages do not contain them.

The user explicitly requested daemon restart while attempt 11 was still running. After that attempt completes and its delta is verified, compile/install the current canary and execute the canonical `deck-canary daemon restart` when idle, without another permission prompt. Do not compile a moving candidate, interrupt the active implementation, or substitute stop/start. At request time the daemon was PID 91841, nonce `d6c6153e-23ff-47cf-8dd2-9121fe863ae0`, reporting running work. Recheck identity/readiness before activation.

UI completion: Apply Deep attempt 11 implemented the title-adjacent working indicator and lifecycle-only task projection. Lead reviewed source/tests and the mobile capture; 171 Web tests, eight browser groups, typecheck and asset parity passed per owner evidence. Investigate attempt 8 confirmed the installed reducer merged all task events: integration of old attempt 10 overwrote attempt 11's member with Lead and hid it through the Subagents filter. The candidate regression covers historical accounting during a newer running attempt.

Both UI deltas were rebuilt and installed through the canonical canary installer. A detached bounded helper will execute only `deck-canary daemon restart` once this Lead turn and other work are idle, verifying original daemon identity and installed payload digest first. No manual stop/start is used. Evidence: `/private/tmp/deck-ui-canary-_a4q2mgi/install.log`, `candidate.json`, `restart.log` and post-action `result.json`. Compilation/installation are confirmed; inspect the result after reconnect before claiming restart completion.

Status: Stages 1, 2 and 3 implemented, verified and independently approved, with the limits below. Isolated packaged validation and installer-delta review are complete. Live installed activation has not been performed because replacement-build/state compatibility remains unresolved.

## Intent and authority

The user accepted the direction in [the proposal](conversational-continuity-proposal.md), authorized defining the concrete contract before coding, then authorized Stage 1 and Stage 2 implementation in successive continuations. This document is the implementation reference for those increments; both source results below are complete. Native steering, installed activation and release remain pending. The existing parent change's release approval is historical and does not constitute activation of these increments.

The outcome is a Lead that yields after justified delegation, resumes integration when results arrive, and retains unresolved decisions when the user changes topics or returns later. A single bounded contract is sufficient at this stage; no parallel roadmap store or changes to historical Pi artifacts are needed.

## Verified production trace

- `packages/session-host/src/session-manager.ts`: `promptSend` persists the FIFO inbox, `pumpPrompts` waits for the Lead, `admitLeadInput` fences actual delivery, and `scheduleWake` admits outcome-driven continuations. User messages take precedence over new wake reservations; an already reserved wake may finish.
- `packages/core/src/session/driver.ts`: `DriverTaskHandle` supports follow-up `send`, `interrupt` and completion. It has no mid-turn steering operation.
- `packages/adapter-pi/src/pi-team-profile.ts`: the Pi suffix instructs prompt yielding after delegation, answer-last ordering and separate outcome-driven continuations. These are model instructions, not a guaranteed response-time limit.
- `packages/adapter-pi/src/pi-extensions/subagents/recap.ts`: Pi constructs bounded recap data from original answer and task-resolution sources, distinguishes integration from execution, and flags truncation.
- [Pi recap brief](../pi-cumulative-completion-recaps/working-brief.md): genuine user input ends a recap block, not a read receipt. Recap-only wakes, unread UI and full-answer replay are excluded.
- [Queue contract](prompt-queue-brief.md) and [session lifecycle contract](session-release-brief.md): queue durability, cancellation/admission fences, pause semantics and same-ID release/reprepare remain binding.

Readiness for implementation: notice maps and result acknowledgements are currently in memory, with a durable delivery diagnostic at admission. The full recovery path must be confirmed in a focused test before changing it; this design does not claim a proven production data-loss bug. Native steering support remains unverified. No live session reproduction or provider calls were performed for this design.

## Required behavior

### CC-1: Conversational availability

The Lead SHOULD delegate suitable work once scope and authority are clear. After acceptance it MUST finish necessary coordination and yield, rather than poll solely to keep the turn open. Independent work that materially advances the outcome may continue. The substantive answer MUST be the last action of that turn.

Yielding MUST NOT abandon the assignment. Actual background outcomes use existing admission and wake paths to resume review and integration. The host MUST retain one active native Lead turn per session and preserve task ownership, FIFO, pauses, cancellation and recovery barriers. A new user topic MUST NOT implicitly cancel previous work.

This is instruction-level availability with host scheduling guarantees. Long Lead-owned calls can still delay new messages. No response-time guarantee or implicit interruption is introduced.

### CC-2: Separate execution, integration and decisions

Existing `(taskId, attempt)` identifies execution. Lead integration records whether an outcome was reviewed and integrated, blocked or discarded, with a bounded note and evidence references. Result retrieval is a separate fact; retrieving a child report MUST NOT make it verified or integrated. Observer reads MUST NOT acknowledge work.

A decision is the only new durable entity. It MAY exist before a child task exists. It contains a stable session-owned ID, revision, question, originating Lead turn, source user prompt or outcome, optional related task IDs and optional bound OpenSpec reference. No new general-purpose work-item or project roadmap entity is required.

The host MUST validate identity, same-session references, current Lead ownership and mutation evidence. The Lead remains responsible for interpreting language and evaluating evidence; the host cannot prove that an arbitrary answer resolves a product question.

### CC-3: Decision lifecycle

| State | Meaning | Allowed progression |
|---|---|---|
| `pending` | A decision is still needed | Answered, deferred, cancelled, superseded, or a revised question |
| `deferred` | Intentionally postponed, still unresolved | Return to pending, or explicitly answered/cancelled/superseded |
| `answered` | Lead recorded a resolution backed by admitted user input | Terminal; changed requirements open a linked new decision |
| `cancelled` | User abandoned this decision | Terminal; not permission to execute the dependent plan |
| `superseded` | An explicit replacement or changed scope made this question obsolete | Terminal; replacement and rationale remain linked |

A queued or admitted reply is orthogonal to these states. Decisions MUST NOT resolve because time passed, a child finished, the page was viewed, the session was closed, or the user sent an unrelated message. Deferred decisions MUST remain discoverable and retain dependencies.

Supersession MUST record a reason and a replacement or explicit admitted user scope-change reference. A child outcome alone MUST NOT supersede a decision in this first implementation. Recommendations and child reports are data, not authority. Cancelling a decision MUST NOT automatically cancel running work or authorize its dependent action; dependent work remains held until an explicit user-backed replan removes/replaces the dependency or cancels that work.

### CC-4: Reply correlation and stale input

The UI MAY target an existing decision when sending a normal queued prompt, preserving its ID and expected revision. Acceptance means only that the answer is queued. Admission records a reply reference; it MUST NOT resolve the decision or release a dependency. Cancelling the queued message leaves the decision unresolved.

At admission, a stale target/revision MUST remain identifiable. Preserve and deliver the user's accepted text with a stale-target notice rather than discard it or apply it to a different question. No stale reply automatically resolves the current revision.

For free-text answers, the Lead explicitly resolves each applicable decision using the current turn's admitted genuine user prompt as evidence. Evidence MUST postdate the question revision; queued input, synthetic wakes, foreign prompts and earlier turns cannot resolve it. A prompt that clearly answers several questions MAY support separate explicit resolutions. Ambiguous answers require clarification and retain the unresolved state.

All mutations MUST use durable command identity and optimistic revision checks. Identical retries return the original outcome, including after receipt eviction; reused identity with changed content is rejected. Opening a decision is idempotent on the opening Lead task/attempt and caller key. Only a substantive question revision invalidates already-targeted question versions; multiple reply receipts do not silently rewrite the question.

### CC-5: Dependencies and authority

Opening a decision MUST NOT pause the session inbox or unrelated work. A declared dependency is satisfied only by a resolution compatible with the authorized action, not merely by receiving an answer. An answer such as "do not proceed" MUST NOT launch that action.

The host can refuse new delegation and continuation when declared `dependsOn` decisions remain unresolved. Linked dependencies persist for `continueTaskId`. Linking a decision to a running task does not interrupt it; the Lead must explicitly pause/cancel affected work when necessary. Fresh undeclared delegations and the Lead's native edits/tools are outside this gate. Instructions require correct dependency declaration, but the UI MUST NOT imply universal enforcement.

Removing or replacing a dependency requires an explicit Lead replan backed by admitted user input. Deferral, cancellation and supersession MUST NOT silently release blocked execution. No automatic launch occurs merely because a decision changes state. Existing runner tool approvals remain separate and are never synthesized from product decisions.

### CC-6: Bounded durable continuity

An admitted genuine user prompt begins a recap block. Enqueueing, cancelled queued messages, synthetic wakes and tool outputs MUST NOT reset that block. Durable decisions are session-owned and survive block boundaries.

Build continuity context from original records: the initial completed Lead answer to a genuine user turn, attempt-specific results and integration notes, unresolved decisions, and durable delivery/retrieval references. Never build it by copying previous cumulative replies. A retry MUST preserve earlier attempt history; a newer unverified result cannot replace an earlier integration fact.

Unintegrated terminal outcomes MUST remain discoverable in subsequent Lead context across genuine user-block changes, regardless of delivery/retrieval or receiving-turn completion. Blocked integration records remain outstanding until explicitly revisited. Bound their representation with truthful omission counts; retention does not create another wake. Retrieval and turn completion are never implicit resolution.

Initial implementation limits: at most 16 unresolved decisions (pending plus deferred); question length 2,000 characters; resolution/reason notes 512 characters; at most 32 outcome entries and 1,024 characters of the original answer in a bounded recap. A new decision exceeding capacity is rejected visibly, never evicting an existing unresolved decision.

Reserve up to 4,096 characters within the existing 8,192-character notice context for continuity. Current outcome delivery retains priority. Include counts and retrieval references for omitted decisions/results; do not truncate JSON or silently mark omitted records delivered. Overflow remains queryable. These are context bounds, not retention limits. All excerpt/truncation signals must be explicit when material.

Actual outcome-driven replies SHOULD include the new verified result, concise earlier integrated results and the essential prior recommendation when relevant. Ordinary topic changes need not repeat every pending question. No timers, wakes or model calls exist solely to recap. Internal continuity context is data, never authorization or executable instructions.

### CC-7: Recovery and lifecycle

The existing per-session event log is the durable source. New projections MUST replay decisions, replies, integration and notice accounting. Persist accepted changes before acknowledging them. JSONL multi-event appends are not crash-atomic: test every relevant committed prefix, especially queue/receipt, dispatch/reply and resolution/receipt.

Never automatically replay uncertain native execution. Reconstruct eligible undelivered terminal outcomes from durable records only after ownership settles. Delivery admitted before a crash is not proof of model consumption; uncertain cases remain visible and can be included in the next eligible genuine turn, without automatically replaying that uncertain turn. Deduplicate by task, attempt and delivery identity. Do not promise exactly-once provider execution.

| Action | Continuity behavior |
|---|---|
| Interrupt, failure pause, Resume | Decisions and history persist; existing queue barriers still apply |
| Web Close / `session.release` | Same session retained; queued replies remain paused; no decision is resolved |
| Prepare | Reopens the same retained context; queued work follows existing explicit Resume rules |
| Remove | Existing catalog tombstone; no history deletion; refuse mutations and preserve existing authenticated known-ID read policy |
| Legacy terminal stop | Retain decisions as history; no implicit resolution or execution |
| Explicit successor flow, if applicable | Carry bounded references in the existing handoff; never silently migrate or mutate predecessor decisions |
| Lead reassignment | Supply retained unresolved context through the existing handoff, without bypassing existing assignment barriers |

### CC-8: Web behavior

Show a compact list of unresolved decisions with pending/deferred status and links to their origin. Targeted replies expose queued, delivered-awaiting-resolution and resolved states truthfully. Defer/cancel actions express user intent; they do not represent read acknowledgement. Deferred items stay accessible. Initial UI work follows existing styling and accessibility patterns; no visual redesign is included.

The composer MUST distinguish queued follow-up from explicit interruption. No runner is labeled as supporting mid-turn messages until a capability spike verifies that behavior. No unread counters, read receipts, mandatory approval of every completed task, or reminder-only turns are added.

## Candidate API and ownership

Names below are design targets, not existing APIs. Reconcile them with canonical validators/schema generation during implementation without weakening the requirements above.

| Surface | Contract |
|---|---|
| Lead tools | `deck_decision_open`, `deck_decision_list`, `deck_decision_revise`, `deck_decision_resolve`; `deck_task_integrate` records attempt-specific integration |
| User input | Extend `prompt.send` with optional `{decisionId, revision}` correlation; preserve all existing callers and queue semantics |
| User decision actions | `decision.defer`, `decision.cancel`, `decision.reopen`, with command identity and expected revision |
| Delegation | Optional `dependsOn: decisionId[]`; retain linked dependencies for continuations; explicit user-backed dependency replacement/removal |
| Events | `decision.opened`, `decision.revised`, `decision.reply`, `decision.state`, `task.integration`; durable delivery/retrieval records keyed by attempt |
| Read model | Session-scoped decisions query/snapshot with `seq`, unresolved states, reply progress, source references and bounded terminal history; read-only calls have no acknowledgement effect |

Core owns types, validation, canonical Lead guidance and MCP contracts. Session-host owns evidence/ownership checks, lifecycle, durable projection, scheduling and context assembly. Adapters materialize shared guidance and translate verified native capabilities. Web renders host state and sends correlated intent. Pi native behavior remains unchanged; shared guidance must not duplicate or conflict with its existing suffix.

```mermaid
sequenceDiagram
    participant U as User / Web
    participant H as Session host
    participant L as Lead
    participant C as Child A
    L->>H: Delegate A
    H->>C: Start owned attempt
    L-->>U: Finish coordination and yield
    U->>H: Send B
    H->>L: Admit B in the same native session
    L-->>U: Answer B; A remains tracked
    C-->>H: Terminal outcome for A
    H->>L: Eligible outcome continuation + durable context
    L->>H: Review/integrate A; open decision D
    L-->>U: Concise result and question; yield
    U->>H: Targeted reply to D
    H->>L: Admit reply; D remains unresolved
    L->>H: Resolve D only with applicable user evidence
    L-->>U: Confirm decision and next authorized action
```

## Acceptance and verification plan

Each row is a required Given/When/Then scenario, not a claim that a test already exists or passes.

| ID | Given / When / Then |
|---|---|
| A1 | Given delegated A, when the Lead yields and B is admitted, then B can be answered before A ends while A retains its owner/scope. |
| A2 | Given decision A, when the user discusses B or a synthetic result arrives, then A stays unresolved. |
| A3 | Given a targeted queued reply, when it is cancelled before admission, then no reply/resolution is recorded and FIFO cancellation retains one winner. |
| A4 | Given an admitted clarification, when the Lead asks a follow-up, then the reply is visible but the decision and its dependencies remain unresolved. |
| A5 | Given old, foreign, queued or synthetic evidence, when resolution is attempted, then the host rejects it; an unrelated admitted reply is covered by Lead guidance, not claimed as semantically host-verified. |
| A6 | Given a revised/terminal decision, when an accepted old reply reaches admission, then its text is retained with stale-target context and never silently applied. |
| A7 | Given retries, conflicting revisions or evicted receipts, when commands repeat, then original identity is preserved and conflicting mutations are rejected. |
| A8 | Given declared dependencies, when a decision is deferred/cancelled/superseded or answered negatively, then dependent execution never launches implicitly; independent work remains available. |
| A9 | Given multiple outcomes while the user is away, when an actual completion continuation runs, then recap uses original bounded sources, shows omissions and never schedules a recap-only turn. |
| A10 | Given a new genuine admitted prompt, when the block changes, then prior unresolved decisions persist; synthetic and cancelled queued input do not reset the block. |
| A11 | Given an earlier integrated attempt and a retry, when the new attempt reports completion, then the old integration record remains intact and the new result remains unverified until reviewed. |
| A12 | Given a child completion and a crash before/after delivery fences, when the host recovers, then undelivered work is discoverable, uncertain execution is not replayed and deduplication prevents known duplicate delivery. |
| A13 | Given a crash at any multi-event committed prefix, when replay runs, then no queued/admitted reply is fabricated or lost and no resolution is acknowledged without durable evidence. |
| A14 | Given unresolved decisions and a queued answer, when Web Close/Prepare/Resume runs, then same-ID context survives and reply admission follows the existing queue pause rules. |
| A15 | Given Remove or legacy stop, when history is accessed or mutation attempted, then existing tombstone/read/terminal policies hold without deletion or implicit decision resolution. |
| A16 | Given a result retrieval or observer query, when context is rebuilt, then retrieval is distinct from integration and observer reads have no side effects. |
| A17 | Given a runner without verified steering, when a busy-user message is sent, then the UI describes queued delivery and retains explicit interruption semantics. |

## Implementation sequence and gates

1. **Availability and recap parity.** Confirm notice recovery with a focused failing test where needed; add durable attempt-specific delivery/retrieval/integration context and shared guidance. Verify A1, A9-A13 and A16, plus existing FIFO, pause, admission and ownership regressions. Scripted drivers prove scheduling; they do not prove real-model instruction compliance.
2. **Decisions and Web continuity.** Implement the decision contract and correlated input as one functional slice across Core, host and Web. Verify A2-A8 and A14-A17, schema compatibility, stale-client behavior and browser interaction/reload tests. Keep undeclared/native-tool enforcement limits visible in guidance.
3. **Native mid-turn capability spike.** Verify each adapter independently; retain queued fallback. Record supported versions, acceptance versus delivery semantics, cancellation/ownership behavior and evidence before selecting an implementation. No parity promise until verified.

Use one vertical implementation owner through each functional candidate, with Lead maintaining OpenSpec. Run affected unit/integration and browser checks; independent Quality is warranted for durable recovery, authority and public contract changes. Generate schemas/assets through canonical scripts. Installation, daemon restart and publication are separate from this design stage.

Rollback: retain the append-only event history and disable new behavior through a compatibility-aware forward change if needed. Never roll back to a binary that cannot read the new event kinds without verifying reader compatibility. Do not delete decisions or reset the inbox to recover from a defect. Stage 1 must not require Stage 2 records to operate; native steering remains independently gated.

## Design evidence and remaining implementation checks

Architect task `task-175b1a78-ab24-40ae-be43-50d18cc455b9`, attempts 1-2, supplied the trace and design review. Lead corrected lifecycle against the current release contract and tightened reply/resolution, cancellation and dependency semantics. Candidate API names and numeric limits above are design decisions, not claims about current runtime.

Before implementation, confirm the full notice-recovery trace, expose current admitted `promptId` in the Lead tool context where required, and verify the existing schema generator/event-reader compatibility path. These are bounded engineering checks, not unresolved product questions. No runtime tests were run for the documentation-only stage.

## Stage 1 implementation tracking

The user's subsequent instruction to continue authorized the Stage 1 source implementation and affected verification. One Apply Deep owner owned the functional vertical slice; Lead owns official artifacts and independent review coordination. Stages 2/3, installation, daemon restart and publication are not included in this implementation slice.

- Implementation owner: `apply-deep`, task `task-99bf98b7-ec98-4ead-9000-9f1937389df4`.
- Independent review owner: `quality`, task `task-1ba3a6ce-ed63-4fa8-a841-9d36d73e4f81`.
- Initial RED evidence: undelivered completion notices were not recovered after restart; result retrieval had no durable attempt record. Additional focused regressions exposed legacy diagnostic spoofing, reseeded answer provenance, internal-message answer replacement, wait persistence-failure settlement and release/reprepare notice refresh. These were repaired before final verification.
- Independent review initially requested changes: context selection hid old unintegrated outcomes after new user admission when they had been retrieved or their receiving Lead turn completed. Owner attempt 2 repaired retention independently of wake deduplication, covering delivery-only, retrieved, interrupted-consumption and blocked cases. The contract above makes that continuity requirement explicit. Quality attempt 2 approved the repaired candidate with no remaining blocker.

### Final Stage 1 implementation

Core now defines managed cross-runner yield/answer-last guidance, `deck_task_integrate` and host-only `task.delivery`, `task.retrieval`, `task.integration` accounting events with canonical generated schema support. Session-host materializes this guidance for managed Lead turns; Pi native behavior is unchanged.

Delivery, retrieval and integration persist separately per task/attempt. Lead result retrieval supports an explicit attempt; observer reads remain inert. Integration validates live Lead ownership, a terminal retrieved attempt, bounded notes/evidence and durable command identity. Integration records remain Lead review claims, not independent proof. Retry history is preserved.

The ledger tracks genuine admitted input boundaries and the original public answer, including reseeding. `continuity.ts` builds bounded nonrecursive context, flags omissions, retains unintegrated/blocked outcomes across topic changes, and drops old recap entries only after explicit integrated/discarded disposition. Retention itself does not schedule new wakes.

Notice reconstruction uses durable accounting, respects release/pause/ownership barriers and does not automatically replay uncertain native execution. Admission-prefix and retrieval-write-failure tests cover conservative recovery and settling failed waits. Snapshot version 5 reconstructs older snapshots from retained logs. The operational guide in `docs/cross-runner-sessions.md` describes the scope and limits.

### Verification evidence

- Initial affected Core/host/CLI suite: **569 passed, 0 failed across 37 files** (`/tmp/deck-stage1-affected.log`).
- Subsequent host/lifecycle delta: **156 passed, 0 failed** (`/tmp/deck-stage1-final-host.log`). This overlaps and updates the corresponding initial-suite coverage.
- P1 retention repair: **9 RED failures with 2 passing disposition controls**, then **11 focused GREEN**; final invalidated continuity/host suite **170 passed, 0 failed across 3 files** (`/tmp/deck-stage1-p1-{red,green,affected}.log`). The 170-test run supersedes the earlier affected host/continuity evidence; counts are not additive.
- Final `bunx tsc --noEmit`: exit 0 (`/tmp/deck-stage1-p1-typecheck.log`). Canonical session schema generation, idempotence and validator parity passed before the retention-only repair; the repair did not invalidate those gates.
- Independent Quality final re-review: **19 passed, 0 failed**, including the three original P1 cases, blocked retention, overflow, actual next-turn delivery, no duplicate wake, admission prefixes, wait/flush and release/prepare. Earlier unaffected review checks remain valid.
- Lead checked the actual source/diff, verification log footers, OpenSpec links/fences/whitespace and `git diff --check`. No source changes followed final Quality approval.

Tests used **Bun 1.3.11**, while the repository pins **1.3.12**; no runtime installation was performed. Scripted drivers and isolated process tests verify host behavior and instruction materialization, not real-model compliance. Old-binary downgrade compatibility is unverified; retain event history and use compatible readers. No live provider execution, canary installation, daemon restart, commit or publication was performed.

### Stage 1 handoff (historical)

Stage 1 source was ready for the subsequent Stage 2 slice documented below. Installed activation remains a separate operation; do not describe the user's running daemon as upgraded. Stage 3 requires native capability evidence before implementation.

## Stage 2 implementation tracking

The user's next instruction to continue authorizes Stage 2 durable decisions and Web continuity. Continue with the same implementation owner/task and independent review owner/task listed above. Preserve the approved Stage 1 candidate; Lead remains the centralized OpenSpec writer. Stage 3, installed activation, daemon restarts and publication remain outside this slice.

### Visual agreement

Audience: the existing personal cross-runner workspace user. Preserve the current compact workspace, typography, palette, density, light/dark styling and responsive behavior. Add a small decisions section near the conversation/composer with explicit pending/deferred and reply-progress states, origin links and targeted reply/defer/cancel/reopen actions. Use existing components and CSS tokens; do not introduce a new visual identity, dependencies, animations, read receipts or notification counters. Keyboard access, focus handling and narrow-screen usability are required.

Skill responsibilities: `deck-frontend-design` selects the existing-project direction; the implementation owner loads `frontend-ui-engineering` for component/state behavior and `fixing-accessibility` for interactive controls. Existing project design is the authority for layout/type/color. Validate the actual browser interaction and visual result with isolated test fixtures; do not infer visual quality from schema tests.

### Candidate review tracking

Implementation continues in Apply Deep task `task-99bf98b7-ec98-4ead-9000-9f1937389df4`, attempt 3. Independent Quality task `task-1ba3a6ce-ed63-4fa8-a841-9d36d73e4f81`, attempts 3-4, identified five candidate findings pending repair: child-only replacement supersession without user authority; command identity collision between decision and integration effects; control-character schema/runtime disagreement; stale targeted input accepted for dependency removal; and child-origin navigation substituting the latest attempt for the referenced attempt.

Remaining acceptance evidence includes delayed query/mutation responses across session switches, exact origin identity/focus, decision/replan write-failure recovery and unchanged continuation dependency inheritance. Initial isolated browser smoke covers the normal HTTP/WebSocket reply/queue/reload flows and desktop/mobile light/dark layouts, but does not close those remaining cases. Stage 2 is not approved while these findings remain open.

Lead interrupted implementation attempt 3 after the functional/browser candidate to deliver the accumulated review findings and continued the same owner in attempt 4; no source was discarded or ownership changed. A cached Bun **1.3.12** executable was found and version-checked locally, so final repaired verification can use the pinned runtime without installation. Earlier Bun 1.3.11 results remain historical evidence, not the final runtime gate.

Quality attempt 5 additionally reproduced an authority-boundary defect through the authenticated host API with a scripted driver: a same-prompt native reseed overwrote dispatch sequence and made previously rejected old input eligible as newer decision evidence. Current adapters normally classify missing native sessions before model execution; no natural provider occurrence is claimed. Repair must compare authority against immutable first genuine admission, while retaining separate dispatch/attempt tracking. Reseeding MUST NOT promote old user input into new authorization.

### Final Stage 2 result

Completed by the same Apply Deep owner through attempts 3-5. Quality attempts 6-7 closed all six confirmed findings and approved the final Stage 2 candidate. The initial findings above remain as review history, not open blockers.

- Core provides durable decision types, command/event validation and canonical schemas, plus `deck_decision_open`, `deck_decision_list`, `deck_decision_revise` and `deck_decision_resolve`. User defer/cancel/reopen commands use optimistic revisions and durable command identity. A shared mutation-identity projection fences collisions across decision, integration, replan and general commands even after receipt eviction/replay.
- `revision` guards state mutations; `questionRevision` identifies substantive question changes. `prompt.send.decisionTarget` retains the selected decision/revision, with accepted question-version provenance. Admission records a reply without resolving the question. Cancelled queued replies remain unreceived; stale accepted text is delivered with its original reference and cannot supply authority for resolution or replanning.
- The host validates live Lead ownership and applicable current genuine user evidence. Resolutions carry `allow`, `deny` or `informational` disposition; an allow disposition satisfies only a declared matching action. User-language interpretation remains the Lead's responsibility. Supersession through either a replacement or scope change requires user evidence and records its provenance.
- Explicit `dependsOn` links persist for delegated continuations. Explicit `relatedTaskIds` at decision opening link future continuations without interrupting current execution; a `source` reference alone is navigation/provenance and does not create a gate. Omitted continuation dependency/action fields inherit their prior values. Removing/replacing dependencies or actions requires an explicit user-backed replan. Negative answers and deferred/cancelled/superseded decisions do not silently permit execution.
- The original genuine user admission is immutable in `firstAdmissionSeq`; current dispatch/attempt are tracked separately. Native reseeding cannot turn an older prompt into newer authority. Snapshot v8 reconstructs older projections from retained log records; missing genuine admission provenance fails closed.
- The Web Decisions section displays pending/deferred items, queued versus delivered-awaiting-resolution replies, and bounded resolved history. Reply targets the existing composer; stale selection preserves drafts. Origin navigation displays the exact historical prompt/attempt or explicit unavailability. Delayed query/mutation responses cannot leak state, errors, targets or drafts across sessions or release/reprepare. Existing design tokens, responsive layout and keyboard/focus behavior are preserved.
- Unresolved decisions survive topic changes and contribute bounded continuity context with omission/retrieval information. Release/reprepare, terminal history, removal tombstones, FIFO and uncertain-execution recovery retain their existing boundaries. No reminder-only turn, read receipt, new roadmap entity or mid-turn steering was added.

### Final Stage 2 verification

All repaired final verification used the already-cached **Bun 1.3.12**, matching the repository pin. No installation/download was needed. Earlier Bun 1.3.11 runs are historical, not the final runtime gate.

- Original five-finding repair: explicit RED/GREEN cases for cross-kind command collision, stale replanning and exact-origin selection. The affected pinned run recorded **318 passing checks** with three packaging/JSX failures caused by in-process build resolution. The existing production-generator subprocess pattern repaired test isolation while preserving exact asset digest assertions; the invalidated packaging/UI files then passed **10/10**. See `/tmp/deck-stage2-pinned-{affected,packaging-ui}.log`.
- Final focused identity **3/3**, decision/replan append/flush failure and retained-prefix recovery **4/4**, schema/generator parity **5/5** passed (`/tmp/deck-stage2-{identity-final,write-failures-final,schema-final}.log`). No dependent launch or success acknowledgement occurs on failed persistence; retry/replay remains idempotent.
- Isolated real HTTP/WebSocket/Chromium acceptance passed **8 groups**, including targeted reply/queue cancellation, defer/reopen, stale selection/admission, resolution, reload, exact historical origins after retry, held query/mutation responses across switching and release/reprepare, draft retention, keyboard/focus and 320/390px plus desktop light/dark layouts (`/tmp/deck-stage2-browser-final-pinned.log`). No live provider was used.
- Reseed repair: **3 RED to 3 GREEN** followed by **203 affected tests passing across 3 files** (`/tmp/deck-stage2-reseed-authority-{red,green,affected}.log`). Production-path tests preserve rejection of both resolution and dependency removal after same-prompt reseeding; replay and old-snapshot reconstruction preserve the original admission.
- Workspace typecheck exited 0 after the final repair (`/tmp/deck-stage2-reseed-authority-typecheck.log`). Canonical schema and Web assets were regenerated through their scripts. No UI/schema changes followed the reseed-only repair.
- Independent Quality: original five findings closed with **16 host/schema and 7 packaging/UI tests** plus browser-harness inspection; final reseed review passed **3/3**, approved Stage 2 and found no remaining blocker. These focused counts overlap owner suites and are not additive totals.
- Lead inspected desktop-dark, mobile-light and mobile historical-origin captures, final source/test evidence, OpenSpec links/fences and `git diff --check`. Operational documentation in `docs/cross-runner-sessions.md` now covers decisions and their limits.

### Limits and next action

Stages 1 and 2 are ready in source. No user daemon restart, canary installation, commit, publication or live-provider execution occurred. Scripted host and isolated browser checks establish structural behavior, not semantic model compliance or universal gating of native tools. Old-binary downgrade compatibility remains unverified; preserve logs and use compatible readers.

The user authorized the per-runner native mid-turn capability investigation on 2026-10-18. Investigation completed under the original Investigate owner, task `task-5913e085-4348-4b61-92cf-ba90375b48fb`, attempts 2-3. It must establish supported behavior before implementation. Installed activation of the verified candidate remains a separate operation and has not been claimed.

### Stage 3 capability findings

Scope: inspect the actual Codex, Claude Code and OpenCode cross-runner drivers, installed protocol surfaces and official upstream evidence; use Pi as prior art. No provider calls, installation, daemon restart or production changes are included in this investigation. This targeted capability review does not establish a complete release interval or advance runner-evolution review/runtime cursors.

Preliminary evidence: the current Core `DriverTaskHandle` exposes follow-up `send` and `interrupt`, but no steering method. The official [Codex App Server documentation](https://learn.chatgpt.com/docs/app-server#steer-an-active-turn), retrieved 2026-10-18, documents `turn/steer` for appending input to an active turn with a matching `expectedTurnId`, without creating another turn. This establishes a documented integration candidate, not verified support in Deck or proof of model consumption. Installed-version protocol checks and the other runners' findings remain pending.

The original Investigate owner completed attempts 2-3. Lead checked the generated Codex schema and integrated the qualified conclusions below. The preceding preliminary note records the earlier checkpoint. No runtime delivery test was performed; schema generation is an offline protocol check, not model execution evidence.

| Runner observed by investigation | Evidence and current Deck boundary | Disposition |
|---|---|---|
| Codex 0.162.1 | Official App Server documentation exposes `turn/steer`. Locally generated `TurnSteerParams` requires `expectedTurnId`, `input`, `threadId`, with optional `clientUserMessageId`; the response contains `turnId`. `packages/adapter-codex/src/session-driver/driver.ts` currently rejects concurrent `send`, retains the active native turn ID and supports interruption separately. | Candidate for the first steering implementation. Native delivery timing, rejection mapping and reconciliation need a focused spike before capability activation. |
| Claude Code 2.1.296 | [Streaming input documentation](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode) describes queued input. Installed binary strings concerning priorities and mid-turn delivery are internal clues, not established public semantics. `packages/adapter-claude/src/session-driver/driver.ts` writes one message and closes stdin for each turn. | Keep durable queued delivery. A separate streaming lifecycle spike is required; do not advertise steering based on binary strings. |
| OpenCode 1.18.31 | [Server documentation](https://opencode.ai/docs/server/) and installed SDK types expose `prompt_async`, without establishing busy-session steering semantics. The investigation inspected [tagged prompt source](https://raw.githubusercontent.com/sst/opencode/v1.18.31/packages/opencode/src/session/prompt.ts), but did not establish the underlying concurrent runner behavior or binary parity. `packages/adapter-opencode/src/session-driver/driver.ts` rejects concurrent `send` and uses the blocking message endpoint. | Keep durable queued delivery. Do not infer supported steering from an asynchronous endpoint or loop history reload. |

These are observed versions and scoped findings, not a stable-release survey or support certification. No runner-evolution release or runtime cursor advances.

#### Recommended next slice and required safeguards

Design a capability-gated Codex-only vertical slice across Core, the adapter, host ledger and Web composer. Preserve the existing queue for other runners. An optional steering operation must distinguish native acceptance, definitive non-acceptance and unknown outcome; acceptance is not model consumption or task completion.

- Fall back automatically to the existing queue only after proven non-acceptance. A timeout, closed transport or unknown response may follow successful native acceptance: retain uncertainty and reconcile rather than blindly resend. Correlation via `clientUserMessageId` is a candidate, not a verified idempotency guarantee.
- Persist one user command identity across queue and steering routes, with a durable admission boundary and immutable original sequence. Cover completion races, pre-ID submission, cancellation, crash recovery, pause/release and reseeding. Do not overwrite the original active prompt's authority with later input.
- Mid-turn input may change topics or answer questions. It requires its own genuine-user provenance and explicit association with the live Lead attempt before it can become decision/replan evidence. An RPC receipt alone supplies neither semantic resolution nor authorization. Preserve CC-4 free-text resolution as well as explicit `decisionTarget` correlation; absence of a target does not forbid an explicitly evidenced free-text resolution.
- Validate decision revisions at admission, retain stale text with its provenance, and keep decisions unresolved until the Lead explicitly resolves them. Native acceptance must not automatically release dependencies. Unknown delivery must not be presented as cancellable queued input or confirmed delivery.
- Verify exact-turn targeting and definitive refusal cases with a scripted RPC peer; test unknown outcomes, duplicate-route fencing, immutable authority and recovery through the real host paths. A focused opt-in native delivery spike is required before enabling the capability in production; review the authority and lifecycle changes independently.

Research conclusion: Codex has the strongest documented and locally exposed integration surface. Claude and OpenCode lack sufficient verified evidence for equivalent support in this investigation. The recommended next step is the Codex delivery/admission design and capability spike, not immediate activation. No additional product choice is required to preserve the already approved continuity rules.

### Stage 3 design and capability spike authorized

The user authorized proceeding with the proposed design and Codex integration test. Work continues with the existing Architect owner (`task-175b1a78-ab24-40ae-be43-50d18cc455b9`) for the durable delivery/admission design and the existing Apply Deep owner (`task-99bf98b7-ec98-4ead-9000-9f1937389df4`) for an isolated capability spike. Lead remains the official artifact writer. Production integration and installed activation are not claimed by this checkpoint.

The design must resolve accepted, definitively not accepted and unknown delivery; durable identity across delivery routes; multiple genuine inputs in one Lead attempt; immutable authority; decision correlation; ordering, cancellation and recovery. The spike may use a minimal isolated native Codex turn, with a temporary working directory, read-only sandbox and no repository mutation, native delegation or MCP access. It must bound execution, preserve user processes and report native evidence separately from offline tests. No daemon restart, installation, upgrade or capability activation is included.

Completion evidence must identify exact native version, request/event correlation, observed rejection cases, history reconciliation limits and tests performed. A successful RPC alone must not be described as model consumption. Findings will feed the concrete design and subsequent independent review of authority/lifecycle changes.

#### Design review checkpoint

Architect attempt 3 proposed an optional driver steering operation, a durable pre-write fence, explicit accepted/not-accepted/unknown outcomes, FIFO-head eligibility, per-attempt genuine input membership and evidence-backed reconciliation. This is a candidate design, not an implemented contract. Apply Deep attempt 6 continues the isolated native spike.

Lead identified a chronology defect in assigning authority sequence at delayed native acknowledgement or reconciliation: a message sent before a decision revision could appear newer than that revision. Architect attempt 4 is refining the design to retain immutable pre-write admission ordering while keeping evidence ineligible until positive native acceptance is established. Reconciliation must never refresh that order. Target revision changes during delivery must preserve stale-input protections.

The revision also addresses completion-before-acknowledgement: late acceptance must settle against the original attempt's outcome and must not authorize an ended or replacement attempt. Unknown delivery remains visible and cannot trigger automatic resend; any manual retry affordance must explain that the original message may already have arrived. Final design acceptance awaits these corrections and the native spike evidence.

#### Corrected design candidate

Architect attempt 4 closes the proposed authority-order defect at design level. The following rules are accepted as design constraints; runtime behavior and final event shapes remain subject to the native spike and implementation review.

- Flush `prompt.steering` before writing to the runner. Its immutable sequence is `steeringSeq`. Positive acceptance can make the input eligible as evidence, but `firstAdmissionSeq` must use the original fence sequence, never the later acknowledgement or reconciliation sequence. Uncertain or merely fenced input supplies no decision/replan authority.
- Capture targeted decision provenance at the fence and recheck it on acceptance. Substantive question changes and incompatible lifecycle changes invalidate authority; bookkeeping-only revision increments must not silently invalidate the question, consistent with Stage 2 `questionRevision`. A pre-write stale notice can travel with the input. A change detected only after writing cannot retroactively change the transmitted text: retain a stale record in the host and reject invalid evidence regardless of what the model saw.
- Preserve the original turn prompt. Track additional accepted genuine inputs by original Lead task and attempt, with independent immutable provenance. Only a live matching attempt may cite eligible input; synthetic wakes remain ineligible, though genuine input added during one can independently qualify. Free-text resolution remains explicit and supported.
- Completion while a steering response is pending must not imply refusal. Retain a bounded pending-outcome barrier; after the outcome or timeout, later queued work may proceed without resending uncertain input. A late acceptance is historical delivery evidence only, never authority for an ended or replacement attempt. A definitive refusal restores original queue order. Refine terminal delivery presentation against the actual native evidence before implementation.
- Preserve message chronology using the original fence, including reconciliation. Reconciliation must not mint newer authority or reconstruct a different target. A crash with only a fence is uncertain, not safe to replay. No automatic resend or provider exactly-once guarantee is introduced.
- Uncertainty must say that Codex may already have received the message. Do not offer an unqualified resend; copying to the composer must disclose duplication risk. Unsupported runners and unverified configurations retain ordinary queued delivery.

Required regression scenarios include a question revised between fence and acceptance, reconciliation after revision, completion before acknowledgement, original plus multiple steered inputs, cancellation around the fence, recovery from each persisted prefix, uncertainty without authority or resend, and capability-disabled queue behavior. Native spike results must still establish the observable request/item correlation and bound any supported reconciliation. This checkpoint does not enable a production capability or introduce an additional user-approval requirement for routine authorized work.

#### Completed Codex capability spike and design disposition

Apply Deep attempt 6 completed the isolated spike using Codex **0.162.1** and Bun **1.3.12**. One native turn ran against an empty temporary workspace with read-only sandbox, network disabled for tools, no repository context, no MCP or native delegation, and a controlled in-memory fixture tool. The native wire interval was 7.083 seconds. Reported usage was 12,835 tokens (12,764 input, including 6,144 cached, and 71 output). Owned processes exited, the temporary authentication copy was removed and the workspace remained empty. These observations apply to this fixture, not all runtime conditions.

Observed native behavior:

- Steering with the exact active `expectedTurnId` returned that same ID. There was exactly one `turn/started` notification. The model emitted the steered nonce instead of the initial requested response, establishing consumption in this fixture beyond an RPC acknowledgement.
- `clientUserMessageId` appeared as `userMessage.clientId`, with matching thread, turn and exact text. The acceptance receipt preceded the user-item completion; the fixture tool then completed before the final answer and turn completion.
- Idle and post-completion requests returned code `-32600` with `no active turn to steer`. A mismatched active turn returned `-32600` with an expected-versus-actual turn diagnostic. Rejected client keys did not enter the observed history. A generic `-32600` alone is not sufficient to classify other errors as definitive refusal.
- `thread/read(includeTurns=true)` contained the accepted input both during the turn and after completion. A fresh app-server process also read the retained history without a new model turn. Live item UUIDs differed from synthesized history item IDs: reconciliation must match thread, turn, client ID and exact transmitted content, not item ID alone. Duplicate or conflicting matches remain uncertain.
- Twelve offline tests with 34 assertions passed. They covered receipt versus consumption, lost receipt, absent/mismatched/ambiguous history, conflicting evidence, definitive versus opaque errors, completion/receipt reordering, timeout and closed transport. These tests used a local protocol peer and do not establish live crash-race behavior.

The native spike supports the corrected Codex-only design constraints. Positive exact history correlation may establish acceptance; absence of history cannot establish refusal. Reconciliation preserves the pre-write authority sequence, and late confirmation after the original attempt ends supplies history only. Neither client correlation nor a single successful fixture establishes deduplication, exactly-once delivery or general model compliance.

Keep these paths conservative during implementation: native non-steerable review/compaction refusal was not induced; classify unverified errors as unknown. Actual crash timing, history flush windows, concurrent completion races under load, reconnect behavior and paginated history remain unverified. The offline tests cover defensive behavior for these uncertainties, not their native timing. Image steering remains outside the initial slice.

Evidence: `/tmp/deck-codex-steer-spike.2CSfpR/REPORT.md` contains exact commands and scope; `native-report.json`, `native-wire.jsonl`, `reconcile-report.json`, `offline-final.log`, `evidence.test.ts`, `versions.txt` and schema digests retain the detailed scratch evidence. Lead read the full report and incorporated the durable findings here. Scratch files are local evidence, not shipped test infrastructure. No release-review or broad runtime-support cursor is advanced by this targeted spike.

Next implementation scope: one Codex-only Core/adapter/host/Web vertical slice, owned by the existing Apply Deep task, with the corrected immutable admission rules, explicit uncertainty, conservative refusal classification and capability-gated UI. Port relevant scratch checks into reproducible repository tests and independently review the authority, delivery and recovery boundaries before declaring production readiness. Stages 1 and 2 remain preserved; no production code, installed daemon or public capability changed during this spike.

#### Stage 3 implementation authorized and started

The user's subsequent instruction to proceed authorizes the production Core/adapter/host/Web implementation and verification. Apply Deep task `task-99bf98b7-ec98-4ead-9000-9f1937389df4` continues as the single vertical implementation owner, preserving the Stage 1/2 candidate. Lead owns OpenSpec updates and will continue the existing Quality owner for independent review of the functional candidate. Installed activation, daemon restart and publication remain separate and unperformed.

Acceptance includes repository regressions for authority, durable command identity, delivery races, reconciliation, recovery and unsupported-runner fallback; canonical schema/asset generation; and isolated browser checks for sending/status, keyboard focus, mobile/desktop layouts, session switching, reload and drafts. Use the verified Codex version conservatively and keep unverified configurations on the existing queue. The native spike supplies evidence without requiring additional live provider calls for routine implementation tests.

Visual agreement: extend the existing compact composer and status presentation for Developer Team users. Preserve project typography, palette, density, light/dark themes and responsive layout; add no redesign, imagery or motion. The explicit current-turn action must reflect actual capability and distinguish queued, sending, accepted and uncertain delivery without implying consumption. `frontend-ui-engineering` owns component implementation guidance and `fixing-accessibility` owns keyboard, focus and status accessibility. Existing project styles remain the visual authority.

#### End-to-end continuation mandate

The user explicitly requested continuing until all work is finished, without further stage-by-stage proceed prompts. Continue implementation, independent review, necessary repairs, acceptance and documentation autonomously. Prepare the concrete local activation path after approval and assess the current controlling session before any restart. Do not interrupt active work or claim an installed upgrade without evidence. Public publication and destructive Git operations are not implied. The original Investigate owner is checking activation mechanics read-only while the same Apply Deep owner implements the candidate.

Activation investigation checkpoint: the live daemon hosts this controlling session and reports running work. Restarting it during implementation is not an activation test. The installed stable binary reports 0.12.0 while the checkout package reports 0.11.2; this discrepancy and state compatibility require investigation before any live replacement. The supported canary installer can build into a separate directory without replacing the running daemon. Prefer isolated packaged acceptance after candidate approval; confirm separate state and web-port isolation first. Investigation continues under the same owner to close these details. No live restart or install has occurred.

#### Independent design pre-review

Quality attempt 8 found the corrected authority constraints consistent with the native evidence and identified one ordering ambiguity, resolved here. This is not a functional candidate approval; the implementation is still in progress.

Late-refusal rule: automatic return to the original queue position is permitted only while the bounded steering barrier still holds and no later queued work has been admitted. Once timeout releases that barrier, a later definitive refusal is recorded as historical non-delivery, with no automatic requeue or execution. It cannot retroactively restore FIFO order ahead of work already admitted. A later acceptance is likewise historical delivery evidence only, without authority for an ended or replacement attempt. This qualification supersedes broader references above to restoring original queue order.

Required regression: A is steering, its original turn ends, the barrier times out, B is admitted, and A's definitive refusal arrives. A must not be dispatched again or appear reordered ahead of B. Before barrier expiry, a definitive refusal may return A to the queue while preserving its order. Candidate review must verify this alongside the previously required immutable chronology, stale-target, multiple-input, failed-flush, recovery, correlation and capability tests. Lead will carry this clarification into the next implementation-owner checkpoint without interrupting ongoing edits.

#### Activation evidence and remaining boundary

Investigate attempt 5 traced the checkout to `main` at `6ea6674` (package 0.11.2), while the installed daemon reports 0.12.0 at `531e4b3`. The installed commit is absent from this local repository, so this candidate has not been established as a superset of the running build. Do not equate a successful canary build with safe replacement of that daemon. Existing checked snapshots were v4; the Stage 2 candidate reads v8 and reconstructs older projections from the event log. Compatibility with additional unknown-build event fields and a rollback reader remains unverified.

After functional approval, build the canary into a unique temporary binary directory using the canonical installer and pinned runtime. Validate with a separate temporary home/config/state, absent credentials and an explicitly distinct `crossRunner.web.port`. Verify daemon PID, state path, executable/version and web endpoint belong to that isolated instance before any shutdown. Use scripted fixtures and synthetic older-ledger data rather than modifying live sessions. The installer `--dir` option is not a daemon option; daemon commands must invoke the intended binary by its full path.

A plain restart does not inherently discard native context: compatible confirmed native sessions can resume, with bounded reseeding only when the native session is confirmed missing. Uncertain already-started work is not replayed. This corrects the initial investigation's stronger claim about universal native-context loss.

Live activation remains a separate completion boundary: this daemon hosts the controlling session and ongoing work, and replacement-build/state compatibility is unresolved. Complete isolated packaged acceptance and a concrete state-preserving migration/backup plan first. Do not automatically replace the live binary, stop its daemon, or advertise rollback safety based solely on version labels. The final handoff must explicitly distinguish the tested candidate from the still-running installed build.

#### Stage 3 functional candidate under review

Apply Deep attempt 7 completed the Core, Codex adapter, host and Web vertical slice. The candidate provides explicit text steering for the verified Codex 0.162.1 configuration, immutable pre-write authority, additional accepted input membership, conservative refusal classification, bounded exact-history reconciliation, recovery and delivery states. Snapshot version is now 9; downgrade compatibility remains uncertified. Other runners, unsupported configurations and attachments retain queued delivery.

Owner verification on pinned Bun 1.3.12: 561 affected tests across 40 files passed; 76 final delta tests across 14 files passed after the final chronology changes (overlapping counts, not additive). Eight isolated real HTTP/WebSocket/browser groups passed with scripted native drivers, covering ordinary Enter, explicit keyboard sending, focus, uncertainty, switching/drafts, reload, late receipt chronology, responsive light/dark layouts and release/reprepare. Typecheck, canonical schema/Web generation parity and diff whitespace checks passed. Evidence is indexed in `/tmp/deck-continuity-stage3-progress.md`, including `/tmp/deck-stage3-{affected-final,final-delta,final-typecheck,browser-final}.log`.

Lead inspected desktop-dark and mobile-light screenshots and updated operational documentation. Quality attempt 9 is independently reviewing the functional candidate, including the late-refusal rule from the pre-review. No final Stage 3 approval or installation is claimed at this checkpoint. No additional native provider call occurred during implementation.

#### Stage 3 review repair in progress

Quality attempt 9 requested changes for one confirmed P1: a refusal arriving after the steering barrier expired returned the old message to the queue and eventually executed it after newer input. An existing passing test asserted that incorrect behavior. The independent reviewer reproduced this on the production host path and traced unconditional refusal fallback in the ledger. Stage 1/2 approvals remain intact; Stage 3 is not approved.

Apply Deep attempt 8 owns the bounded repair. Historical post-timeout non-delivery must remain non-executable through projection, replay and snapshot recovery; pre-expiry definitive refusal still permits normal fallback. Replace the incorrect test with no-requeue/no-third-turn assertions and verify both paths. Reviewer evidence: 21 focused host and 5 adapter/Web tests passed, with the identified host test encoding the defect; browser harness and eight-group log inspected, not independently rerun. These counts do not substitute for the pending repair.

Repair candidate: Apply Deep attempt 8 reproduced two failing regressions, then added explicit durable `queueFallback` permission. Only a definitive refusal under the still-held original barrier may fall back. Timeout or unknown outcomes remove that permission; later refusal is terminal historical non-delivery with no admission authority. Snapshot v10 rebuilds older cached projections, and unmarked legacy refusal records conservatively do not authorize fallback. The Web retains a truthful terminal not-accepted status after reload without a resend action.

Repair verification on Bun 1.3.12: 288 tests passed across 11 invalidated files; nine focused checks overlap that run. Append/flush retained-prefix recovery, duplicate command retry, current snapshots, v9 rebuild, pre-expiry fallback and post-expiry no-third-turn behavior are covered. The isolated browser delta passed for late refusal, reload status, no resend, session-switch drafts and no additional native execution. Typecheck, schema/Web parity and diff checks passed. Evidence: `/tmp/deck-stage3-late-refusal-{red,focused,affected,browser,typecheck}.log`. Quality attempt 10 is reviewing the repaired candidate; approval and packaged validation remain pending.

#### Stage 3 independent approval and packaged validation

Quality attempt 10 approved the repaired functional candidate and closed the P1. Independent verification passed eight focused recovery/ordering/Web regressions, four schema checks, the isolated late-refusal browser delta and diff whitespace checks on Bun 1.3.12. Prior Stage 1/2 approvals and the earlier Stage 3 reviewed scope remain valid. Historical review checkpoints above are superseded by this approval; approval applies to source readiness for packaged validation, not live replacement or unknown-build downgrade compatibility.

Apply Deep attempt 9 continues with the canonical canary build/install into a fresh temporary binary directory and credential-free isolated daemon acceptance. Verify actual packaged start/status/web/assets and state isolation, preserve the approved source, and clean up only owned processes. Retain the payload and evidence for a concrete handoff. No global binary alias or currently running daemon is to be replaced during this check.

#### Isolated packaged acceptance result

Apply Deep attempt 9 passed six packaged acceptance groups: daemon lifecycle/isolation, embedded asset digest parity, HTTP schema/authentication boundaries, Unix control transport, WebSocket replay and synthetic v9-to-v10 ledger reconstruction. The actual compiled daemon served the checks; source imports constructed fixtures and the protocol client, not a substitute service. No packaged native-provider end-to-end execution is claimed. Existing source/browser and native spike evidence remain separate.

Retained executable: `/private/tmp/dpk-ti0lgjox/bin/deck-canary`, with immutable payload SHA-256 `fd39b94d3d54991b6c4cc4ca967338de2601fe6c783177b4c6db841c664f32de`. Build metadata: 0.11.2, checkout `6ea6674`, darwin-arm64, dev, build date 2026-10-19; this is the dirty candidate, not a clean committed release. The payload passed strict macOS signature verification. Evidence and reproducible commands are under `/private/tmp/dpk-ti0lgjox`, indexed in `/tmp/deck-continuity-stage3-progress.md`.

The owned isolated daemon used PID 75366 and alternate loopback port 49409 with a credential-free temporary home/config/state. It stopped cleanly through its absolute-path CLI; socket, lock and discovery records were removed. The live daemon retained PID 20564, its original nonce and version 0.12.0. No global alias, live state or live process was replaced.

Canonical installation exposed one packaging-only defect: argument parsing did not recognize the cached pinned runtime's `bun.exe` basename. A two-file fix in `scripts/install-canary.ts` and its test recognizes exact `bun`/`bun.exe` basenames case-insensitively. The regression failed before repair; 20 installer tests then passed with one existing opt-in compile test skipped, followed by successful actual canonical compilation/installation, typecheck and whitespace checks. The 45 recorded Stage 1-3 source hashes remained unchanged. Quality attempt 11 is reviewing only this installer delta and packaged evidence; functional approval remains valid.

Final review: Quality attempt 11 approved the installer delta and isolated packaged candidate. Three independent argument-planning checks passed; all 45 approved source hashes and both installer hashes matched. The reviewer verified payload digest, alias, permissions, strict signature and cleanup evidence, and inspected the six packaged acceptance groups. No remaining source/package blocker was found. Implementation, tests, operational documentation and isolated packaging are complete. Live replacement is not certified: the unknown-lineage running 0.12.0 build remains unchanged, and state compatibility plus a concrete backup/migration plan must be established before replacing it. No commit or publication occurred.

### Explicit live canary activation authorization

On 2026-10-19 the user explicitly instructed rebuilding canary and restarting the daemon with it, correcting Lead's earlier restart of the stable executable. The canonical installer rebuilt the current checkout and installed `~/.local/bin/deck-canary`; its payload digest exactly matches the isolated approved package (`fd39b94d3d54991b6c4cc4ca967338de2601fe6c783177b4c6db841c664f32de`). Version metadata remains 0.11.2/dev because this checkout's package version was not changed.

A bounded detached activation helper waits for current daemon PID 81437/nonce `3ec07827-b22c-4401-a695-7eee6ce62c8b` to become idle, then uses supported graceful stop, copies the stopped state into a private `~/.local/state/deck-backups/before-continuity-canary-*` directory, and starts the exact digest-named canary payload. It aborts on identity change or prolonged work, preserves the stable executable, and does not automatically downgrade after candidate startup failure. Results are written to `/private/tmp/deck-live-canary-2_q7oyyv/activation-result.json` and `activation.log`. Scheduling and installation are confirmed; live activation must be verified from those results on reconnection. This does not certify every unknown-build compatibility path.


## Push notification audit — 2026-10-19

User requested validation, not notification behavior changes. Investigation attempt 9 (result event 40020, ended 40021) found no confirmed regression. Lead reviewed the currentness gate, wake/notices lifecycle, stale-job drop, and the web-service diff (a decisions GET route). Lead reran the four push suites with pinned Bun 1.3.12: 35 passed, 0 failed, 162 assertions. Transport was simulated; real browser/provider delivery was not exercised.

Existing tests cover suppression while delegated work runs and notification after the resumed Lead finishes, questions/approvals, queued follow-ups, viewing acknowledgement, and reload without replay. Pending decisions do not have a dedicated push producer. Steering-specific push coverage and blocked-wake combinations remain gaps, not confirmed defects. Delivery/retrieval is distinct from integration; generic readiness text is not proof of reviewed outcomes. The investigator statement that Stage 3 is unreleased is not used as evidence: Codex canary activation was recorded earlier. No runtime/configuration changes or real pushes were made. Claude/OpenCode parity remains independently in progress.


## Runner parity capability checkpoint — 2026-10-19

Apply Deep attempt 12 (result 41568, ended 41569) characterized installed Claude Code 2.1.296 and OpenCode 1.18.31 against isolated deterministic loopback providers. Report: /private/tmp/deck-runner-steer-5uawapa7/REPORT.md. Reported evidence: 8 characterization tests, 62 assertions, pinned Bun 1.3.12; no external inference or production changes. Claude next queued a second execution; now aborted the original execution. OpenCode legacy busy input was consumed, but a stale-target input after idle launched another execution; noReply persisted context without proving captured execution membership. These observations do not establish parity and do not prove all native paths impossible.

Lead reviewed the report and retained existing behavior. Same owner continues with bounded OpenCode v2 native characterization and the remaining Claude tool-boundary hypothesis. No silent interruption, context-only substitution or runner migration is authorized by this checkpoint. Canary installation/restart is deferred until there is an implemented, verified candidate. Push recommendations remain proposals, not implemented behavior.


## Runner parity second checkpoint — 2026-10-19
Apply Deep attempt 13 (result 44615, ended 44616) found a positive Claude tool-boundary path with shouldQuery=false, exact caller UUID/folded attachment ancestry, and no extra provider execution across completion. Transcript-only inputs can remain in future context; this must not be confused with selected-execution acceptance or fresh authority. The same owner proceeds with guarded Claude implementation and host/browser verification. Evidence: /private/tmp/deck-runner-steer-paths-iigs8tpl/REPORT.md (14 characterization tests, 105 assertions, local providers only).

OpenCode v2 busy steering works, but late pending input survives restart and is consumed by a future prompt; its history differs from the legacy driver projection. No v2 production migration is approved by this checkpoint. The existing runner architect continues a bounded design to determine a safe conditional/cancellation path and retained-session policy. Existing OpenCode queue remains. Push implementation continues with Apply Fast; shared ledger/session-manager edits must preserve both increments. No activation or parity completion is claimed.


## OpenCode v2 design disposition — 2026-10-19
Architect attempt 5 (result 45927, ended 45928), report /tmp/deck-opencode-v2-parity-design.md: retain the legacy queue; no v2 migration. Lead checked frozen v1.18.31 protocol create/prompt schemas against the current driver: v2 request schemas lack the per-turn system/variant fields used by the legacy driver. Existing role/continuity authority will not be weakened to user text. Native evidence also shows separate history and late pending input carry-over; MCP/control/recovery parity remains unverified.

The architect suggestion that automatic next-attempt native-pending delivery needs no semantic change is NOT adopted: captured-turn membership, immutable admission and late-refusal/no-resend rules remain authoritative. Promotion alone is not proof of provider consumption or exact execution membership. A future v2 proposal must establish those guarantees before activation. OpenCode steering parity remains unmet with the assessed protocol; existing queue/background-task behavior remains available. Claude guarded implementation and push implementation continue independently. No user approval is required merely to retain the safe existing behavior.


## Claude guarded functional candidate — review pending
Apply Deep attempt 14 (result 50834, ended 50835) reports a Core/Claude/host/Web candidate with exact 2.1.296 gating, original execution identity, no-query completion protection, positive folded-history ancestry proof, and truthful transcript-only uncertainty with no automatic resend/fresh authority. Report/source hashes: /tmp/deck-claude-guarded-candidate/. Reported verification: 530 affected tests, then 132 overlapping delta tests, seven isolated browser groups, typecheck and canonical schema/assets parity. Actual native executable used only deterministic loopback providers; real-provider and installed-daemon E2E remain unverified.

Lead reviewed handoff and assigned independent Quality review of Claude separately from ongoing push repairs. OpenCode remains on legacy queue. No installed activation is claimed, and no passing-test count substitutes for candidate review.


## Claude independent source approval — 2026-10-19
Quality attempt 14 (result 52244, ended 52245) approves the Claude guarded source candidate, with no blocking defect. Independent verification: 116 focused tests/775 assertions plus 10 negative history-proof probes, pinned Bun 1.3.12. Review covered readiness/version gates, original result versus zero-turn receipt, folded ancestry, immutable authority, stale questions, FIFO/release/recovery and no autoresend; browser assertions/captures inspected.

All 23 manifest entries initially matched; 22 remained unchanged at completion. Concurrent generated Web bundle changed to d450882ce3fd9e6096baf774d23d073834d67ea92a08b5ca208e24b0a400ddbc and independently matched canonical generation; browser evidence covers the earlier bundle. Shared manager unchanged; ledger hash db2a0fd7e3ef63254aa8daaefaba2d5e573d728326905ee50f4d44d178563d9c preserves snapshot 12 and push fields.

Evidence correction: native fixture used --bare, restricted tools and no MCP. It validates exercised folding/result protocol against a deterministic provider, not full production permission/MCP composition, real-provider E2E or model compliance. No installed activation is approved by this source review. Push remains in repair; compiling the shared working tree now would include an unapproved push candidate, so combined canary activation waits for that review and final artifact checks. Original review is inline in task result 52244 (no separate report file).
