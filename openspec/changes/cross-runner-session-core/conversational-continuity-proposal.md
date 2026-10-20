# Cross-runner conversational continuity

Status: direction accepted by the user; Stages 1 and 2 implemented, verified and independently approved on 2026-10-18 after subsequent implementation authorization. Stage 3 remains pending. Installed runtime activation has not been performed.

Implementation reference: [Conversational continuity contract](conversational-continuity-contract.md). That document refines the proposal, including reply versus resolution, deferred decisions, lifecycle retention and explicit enforcement limits. Existing runtime release/queue contracts remain authoritative until implementation lands.

## Outcome

Keep the Lead available while delegated work proceeds, and preserve unrelated unresolved decisions when the user changes topics or returns after background completions.

## Verified baseline

- `packages/session-host/src/session-manager.ts:1008-1047` durably queues user messages but dispatches only after the Lead turn settles. The existing prompt queue brief records the implemented FIFO, recovery, pause and admission contract.
- `packages/core/src/session/driver.ts:98-106` exposes follow-up send and interruption, but no mid-turn steering operation. Native runner steering support remains unverified.
- `packages/adapter-pi/src/pi-team-profile.ts:131-143` instructs the Lead to yield promptly after delegation, resume on background outcomes, answer last, and preserve bounded cumulative completion context.
- `openspec/changes/pi-cumulative-completion-recaps/working-brief.md` records implemented Pi recaps and explicitly excludes read receipts, unread UI, recap-only turns and full-answer replay. Genuine user input ends a recap block; this is not proof of reading.
- Investigation found no equivalent host-owned model for unresolved user decisions. This is a bounded repository finding, not proof that no historical design exists elsewhere.

## Proposed behavior

1. Port Pi's conversational availability rules into cross-runner materialization: delegate suitable work, finish necessary coordination, then yield. Resume integration through existing outcome wakes. Keep one native Lead turn active at a time and preserve current queue precedence and ownership barriers.
2. Port bounded cumulative completion context using durable source references and outcome identity. Include the original recommendation when relevant, newly verified results and unresolved work; never recursively summarize earlier recaps. Synthetic wakes do not reset the conversation block.
3. Add durable work-item and decision correlation. Execution completion, Lead integration and an unresolved user decision are separate facts. A decision remains pending until the user answers that decision, explicitly defers/cancels it, or an explicit supersession records why it no longer applies. Unrelated messages and background completions cannot silently resolve it. Ambiguous replies require clarification.
4. Project pending decisions in the Web UI as a compact work summary with links to their originating conversation. Do not introduce read acknowledgements or require approval for every completed task. Block only work dependent on a required decision; independent authorized work may proceed.
5. Separately investigate native mid-turn steering for each adapter. Expose only verified capabilities with distinct accepted/delivered semantics. Until supported, keep queued follow-up and explicit interruption behavior; never disguise interruption as steering.

## Boundaries and tradeoffs

Core owns shared policy and typed contracts, session-host owns scheduling and durable projections, adapters translate native capabilities, and Web UI renders state and sends user intent. This is not a second project-management system; retain links to existing OpenSpec outcomes and delegated task IDs.

Yielding after delegation improves availability with the existing scheduler, but cannot make long Lead-owned tool calls immediately conversational. Native steering may reduce that latency but adds runner-specific behavior and needs a capability spike. Concurrent Lead instances are not recommended initially because they would require shared-context, authority and mutation coordination.

Pending decisions are a proposed extension beyond Pi recap semantics. A new message can close a recap block without resolving another work item's decision. Avoid excessive reminders: show durable state, and recap on genuine outcomes only.

## Suggested implementation sequence

1. Availability rules and durable cumulative recap parity, with integration tests for prompt priority, outcome deduplication and reload recovery.
2. Work-item/decision identity, transitions and Web UI projection, with explicit response correlation and durable recovery.
3. Per-runner native steering spike and implementation only where support is verified.

## Acceptance scenarios

- Given delegated work A, when the Lead yields and the user asks about B, B can be handled before A finishes; A retains its original owner and scope.
- Given decision A and a new message about B, A remains pending after B is answered.
- Given several outcomes while the user is away, the latest outcome-driven reply preserves a bounded recap; no timer or extra model call exists solely for reminders.
- Given a reload or supported daemon recovery, unresolved decisions and undispatched messages remain available without replaying uncertain native execution.
- Given a required decision, dependent work waits; unrelated authorized work continues.
- Given a runner without verified steering, the UI truthfully presents queued delivery and explicit interruption.

## Evidence and limits

Initial read-only investigation task: `task-5913e085-4348-4b61-92cf-ba90375b48fb` (investigate). Lead directly checked the queue implementation, driver contract, Pi profile and prior OpenSpec recap/queue records. That initial proposal stage added only this document. Subsequent implementation and verification evidence is recorded in the linked contract; no live provider execution, installed activation or commits were performed.
