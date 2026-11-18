# Sprint 3 — Sessions, pending work and recovery

Status: bounded S3 candidate `1992f2e9…` accepted at 109925 and installed as binary `86ac96f0…`. The user's all-sprint authorization continues; S4 is the next dependency-ready scope.

## User outcome

Reopen a conversation, keep distinct drafts, queue or cancel input that has not been dispatched, and understand what can safely continue after disconnection or host interruption. Preserve the approved Rust host, React/TypeScript/GSAP interface and `deck2` command. Follow [S3 acceptance](../../../docs/roadmap.md#s3--return-to-work-and-recover-honestly) and the existing product contracts.

## Starting point

S2 provides action-bound decisions and conservative uncertain outcomes. Its current Store still holds one session in metadata, one project execution slot and at most 256 receipts. Native threads are ephemeral; reconstructing a transcript is not native continuation. Do not relabel the existing replayed history as resumed native context. Architect attempt 5 and Apply Deep attempt 6 identify the existing Store/native/HTTP/UI seams; use those rather than introducing a scheduler framework.

## Smallest complete implementation

- Introduce persisted sessions inside the existing project store. Migrate recognized state transactionally, preserving receipt and decision ownership. Keep unknown/corrupt state untouched. Namespace drafts and pending command identity by stable host/project/session, including old-draft adoption only when ownership is unambiguous.
- Keep one project execution slot initially. Persist queued, definitely undispatched input separately from dispatching/running/terminal or uncertain work. Queue admission grants no native effect. Revalidate session, trust, compatibility and authority at dequeue; cancelling an undispatched entry prevents native launch.
- Preserve stable command identity across retry/reconnect. Persist dispatch intent before sending input. Lost acknowledgment is uncertain and cannot trigger silent redelivery. Unresolved ownership blocks conflicting work across sessions, not just the selected conversation.
- After restart, expose pending work and require an explicit resume action for the queue. Expire old pending decisions and never resurrect consumed grants. Recovery explains what was observed, what remains unknown and the next available action.
- Qualify exact Codex continuation and steering behavior before exposing it. Persist only native references created/owned by Deck. Bind steering to the expected current turn and give it a durable command identity. If context is missing or the path is unsupported, offer a clearly new execution with explicit user action; do not silently substitute a fresh run.
- Distinguish stop/interruption, release of live native ownership and removal of local session history. Removing a session must not delete project files or claim the native process stopped. Preserve evidence needed by active or uncertain work.

The UI needs functional session selection/history, queued input/cancellation, drafts and recovery controls. Use the actual Deck reference and GSAP for transitions, with immediate keyboard/control access and reduced motion. Do not add inactive decorative controls or expose internal protocol details unless they help recovery.

## Acceptance and evidence

1. Two sessions retain separate history, drafts and command identities; selection and reload do not dispatch input.
2. Queued work survives restart, waits for explicit resume, and is rechecked at dispatch. Cancelled undispatched work never starts. One project slot and uncertain ownership remain enforced.
3. Crash or lost acknowledgment at dispatch/steering boundaries cannot cause duplicate invocation. Stale decisions cannot authorize effects after restart or native-generation change.
4. A real supported native continuation path preserves context, and missing context offers an explicitly new run. Unsupported steering remains unavailable with a reason rather than being simulated.
5. Stop, release and local removal have distinct effects and truthful UI outcomes. Active/uncertain evidence and unrelated files/resources are preserved.
6. Recognized migrations succeed atomically or roll back; prior read-only and reviewed-edit, authentication and cancellation contracts remain intact.

Use intent-derived boundary/fault tests, then a real owned-fixture native/browser continuation and recovery demonstration. Capture RED for specified new logic before implementing where practical; record any deviation honestly. Reuse unchanged evidence; run the manifest-derived required gates once per candidate and an independent targeted protected check. No old Deck full suite, live profile mutation, credential copying or production session reuse is needed.

## Ownership

Apply Deep task `task-181d5e85-7817-4dbd-bc81-849132576baf` retains implementation ownership after S2 review. Quality retains independent protected-boundary review. Lead owns all documentation, installation and acceptance. Existing live hosts remain untouched; no commit, publication or old Deck retirement is implied. The [execution ledger](../deck-recreation/execution.md) retains S4–S12 as outstanding authorized work.

## Candidate delivery

Apply Deep 8 delivered persisted sessions, API 2/schema 3, durable queues, owned native continuation and conservative recovery. Lead rematched all 78 implementation inputs, 22 assets and binary `86ac96f0…`, froze `target/review-s3-1992f2e9/`, reviewed the material source and independently passed session/approval tests, packaged recovery/origin checks and the real two-context browser journey. Candidate integration is 108427; [verification details](../../../docs/sprints/sprint-03-verification.md) separate owner and Lead evidence.

Quality 11 is evaluating the frozen candidate. Live steering remains unavailable pending once-only ambiguous-acknowledgment qualification; its disabled state is part of this candidate's explicit scope. S1-Q07 is still open. Architect is preparing the minimal S4 transition from these actual seams and the completed OpenCode startup probe, without accepting S3 or implementing the next adapter prematurely.

## Acceptance

Quality 11 returned a conditional pass without a blocking defect, requiring only an owned occupied-port failure check. Lead rematched the 78 inputs/22 assets/binary and executed that check in 0.089 s: failed startup was actionable, kept the launcher record unchanged and did not choose another origin. Review integration and bounded S3 acceptance are recorded at 109925. The [verification record](../../../docs/sprints/sprint-03-verification.md) includes independent runtime/fault evidence, the installed binary backup and schema/API limits. No live hosts or user state were opened/restarted by installation. Live steering remains explicitly unavailable and S1-Q07 stays open. The S4 handoff may now build on this accepted dependency.
