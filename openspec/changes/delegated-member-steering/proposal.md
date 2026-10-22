# Deliver corrections to active delegated members

Status: separately registered and deferred on 2026-10-22 at the user's request. No design, implementation or delegated execution is authorized by this registration.

## Problem and evidence

`SessionManager.delegate()` currently rejects continuation of an active/queued task with `task-running`. Native steering eligibility and target selection are restricted to the Lead. In the prior UX flow, feedback could not be sent to the active implementation owner; formulas were ready approximately 16 minutes before that attempt ended.

Source evidence: `packages/session-host/src/session-manager.ts:622`, `:1385`, `:1595`, verified by direct reads after stale graph coverage. Historical refusal: session `20261022T003008-6f199c`, seq 37443. This identifies a distinct delivery problem, not a native-session selection rule.

## Requested outcome for future work

Allow corrections to reach a running delegated member, preserving owner/task/attempt attribution and exposing distinct pending, delivered and incorporated states. Delivery acceptance alone MUST NOT be treated as proof of incorporation. Future design must define what evidence can establish incorporation for each runner, handling unsupported capabilities, retries, stale attempts and cancellation without duplicating actions or creating authorization from historical messages.

## Boundary

This is separate from [delegated continuity policy](../delegated-task-continuity-policy/proposal.md). It must not expand that change, block its acceptance, or be implemented incidentally alongside reseeding. The present delivery only records the pending change. Detailed acceptance criteria and design await a separate user instruction.
