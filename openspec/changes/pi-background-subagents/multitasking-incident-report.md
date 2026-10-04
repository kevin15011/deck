# Pi multitasking incident report and proposed correction

## Subsequent resolution
The user approved direct Lead-only implementation after this report. The recovery is now implemented and verified: see lead-only-recovery.md and verification.md (1,141 passing tests). The paused status and proposed plan below preserve the incident-time record; they are not the current lifecycle state.
## Status and authority
Paused at the user's explicit request. No further subagent launches or code changes are authorized by this report. All observed tasks are terminal: memory implementation, panel refinement and memory review completed; completion-follow-through repair failed after its initial attempt and a same-history continuation. No active subagent remains in the current registry. Existing source changes are preserved, not reverted or treated as ready to ship.
## Observed failures
1. Terminal results arrived after Lead manually inspected completed jobs. This proves delayed delivery in the observed conversation, not universal permanent loss.
2. Stale progress reports and final-text reports arrived after their jobs were already known complete, followed by duplicate terminal outcomes. They consumed chat/Lead turns without advancing work.
3. A failed-attempt notification arrived after the same task had been resumed. Without attempt identity in the visible event, it appeared to contradict the current running state.
4. Completed child work did not reliably produce Lead integration, verification, a next authorized action or a concise final status. User prompts became the practical control loop.
5. The Lead amplified noise by responding repeatedly to stale reports. It also initially queued the independent panel refinement unnecessarily, then failed to immediately synthesize completed results. These are orchestration faults, not solely runtime faults.
6. User reported an apparently frozen panel. Completed-job clocks are intentionally frozen; a new native mixed-completion timer regression passed alone but failed in the combined pinned-runtime run. A real visual freeze is not established and remains unresolved.
7. The original panel exposed IDs, command hints, raw running labels, seconds and hard-clipped text. The quieter HH:MM:SS/wrapped candidate is implemented but was not installed into the live session.
8. Memory initialization consumed/scrubbed its token-file environment field; subsequent initialization ignored the process-local handoff and lost memory tools. This defect was reproduced with native resource reload and repaired in source. The exact live second-initialization trigger remains unconfirmed.
9. The systemic-repair agent failed twice. Its history ends at diagnostic Bash calls with a 10-second timeout. Child containment intentionally ends the entire delegated job on shell abort/timeout, while surfaced job diagnostics were generic or repeated the preceding progress text. Do not assert a network cause or hide the interruption.
10. Local green evidence did not establish the combined candidate: final pinned Bun 1.3.12 verification had 161 passed and six failed across 167 tests. Source-digest failures during simultaneous panel edits were expected integration staleness; subsequent runtime/test failures were not and remain blockers.
11. Installed canary, changing repository source and regenerated distribution bundles were different revisions during the live exercise. This was not communicated consistently, making fixes appear to apply instantly when they did not.
## Source-confirmed vulnerabilities in the old completion path
- A terminal state transition preceded persistence/UI effects; an exception could skip notification, while the catch's live predicate no longer considered the terminal job live.
- Native sendMessage is fire-and-forget: returning from it does not prove model-context admission or Lead integration.
- Progress and terminal messages shared a noisy follow-up path, without a clear durable delivery/admission/integration contract.
- Job identity was stable across retries but emitted events did not sufficiently distinguish attempts.
Partial delivery tracking/acknowledgment code now exists in the worktree. It is not a finished or verified repair.
## Proposed product contract
### Separate three states
Execution: queued/running/interrupted/failed/completed.
Delivery: pending/queued/admitted (not inferred from a void send call).
Integration: pending/being reviewed/closed or explicitly blocked.
A completed process is not a completed user request.
### Structured event handling
Use immutable parent-session + task + attempt + outcome identities. Deliver at least once with idempotent deduplication rather than promise transport exactly-once. Coalesce progress, prioritize terminal/failure events, and ignore obsolete-attempt notices in the live view while preserving their history. Validate structured lifecycle metadata separately from untrusted child text.
### Reliable Lead continuation
Use supported native Pi scheduling to admit a continuation at the next safe boundary when idle or busy. Terminal outcomes remain pending until actual context admission; integration remains pending until Lead produces an explicit result/next action/blocker. No manual user nudge or polling may be required for the healthy path. Never interrupt an active response, adopt another session's work, auto-restart a restored child, or create an unbounded model retry loop.
### Quiet UX
Progress updates the panel in place and does not create chat turns. Exceptions requiring a user decision and concise Lead synthesis belong in chat. Raw untrusted payloads, IDs, diagnostics and command help belong in details. Show task completion versus waiting for Lead distinctly. Keep sticky minimization, full-screen viewport anchoring, regular-mode compact fallback, sensible HH:MM:SS and bounded wrapping.
### Recovery and diagnostics
Persist structured exit/timeout/cancellation reason, attempt identity and last useful checkpoint. Preserve same-history explicit continuation only after proven ownership settlement. Do not blindly relaunch a failure. Keep process containment, but make command/job deadlines deliberate and expose when a command timeout ended the whole job. Do not kill arbitrary persisted PIDs or claim rollback of remote/file effects.
## Recovery plan (proposal only)
1. Freeze the current candidate; inventory changes and reproduce failures without live subagent orchestration.
2. Establish deterministic test isolation and one canonical Bun/Node compatibility baseline. Investigate shared process-global state, native loader caches, timer assumptions and child-handshake stream behavior; these are candidates, not proven common causes.
3. Repair the event/delivery contract and prove idle/busy/simultaneous completion, transient delivery/UI failure, reload, stale attempts, cancellation and timeouts with a fake provider.
4. Apply the approved quiet panel and exercise actual interactive terminal scroll/focus/completion behavior, not just renderer snapshots.
5. Verify the complete combined source, bundles and normal TUI installation path in isolation, including native memory reload/security boundaries.
6. Only after approval and passing gates, perform a controlled canary exercise with one child, then two independent children. No expansion to unrestricted parallel workflows until demonstrated.
## Release gates
- No manual user prompt needed for a completed job to be admitted and acted on.
- No duplicate/progress flood or obsolete-attempt event interpreted as current failure.
- One agent completing cannot stop the other agent's live display.
- New sessions cannot see/adopt previous tasks; native resume restores records without executing.
- Memory tools survive native reload without restoring secrets to environment.
- Timeouts are structured and recovery preserves history without duplicate effects.
- Combined pinned-runtime suite, generated freshness, typecheck and isolated TUI delivery pass; any platform limit is explicit.
## Current deliverables
Memory fix: implemented and scoped security review approved, combined verification pending.
Panel refinement: implemented and focused renderer tests passed, combined timer/live-view evidence pending.
Completion system: partial unverified repair; failed worker stopped.
No personal installation/configuration was changed by this work. Do not instruct the user to reinstall this candidate as a finished fix.
