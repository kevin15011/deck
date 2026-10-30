# Decision history composer cleanup

## Intent

User reports the persistent resolved decision-history bar above the composer obstructs writing. Remove that permanent bar when there are no unresolved decisions, selected reply targets, or errors. Preserve durable decision records and make history available on demand through a secondary existing session control where feasible.

## Acceptance

- Terminal-only decisions do not reserve a panel above the composer by default.
- Pending/deferred decisions remain discoverable and actionable; selection and errors remain visible.
- History remains accessible on demand without restoring a permanent composer row.
- Session switching and keyboard focus work correctly; preserve existing decision authority and resolution semantics.
- Use current visual conventions; no broad redesign. Add behavioral regression coverage, not prose/style snapshots.

## Scope and status

UI implementation only, independent of session-overlay-history-recovery. Shared worktree has unrelated web edits; preserve them. Lead owns OpenSpec. Focused UI tests first; final repository gates must account for both changes. Implementation pending.

## Implementation and final review

Terminal-only history no longer reserves composer space; it opens in existing secondary session controls. Pending decisions, errors and selected reply targets remain visible. Exact-origin retrieval rejects ambiguous attempt attribution and traverses at most eight pages per activation, retaining only cursor/attempt state and allowing explicit resumption.

Lead resolves the UI attribution and unbounded traversal findings based on Quality attempt 4, resultSeq 20855: independent production three-attempt, bounded search, resume, cancellation and stalled-cursor probes passed. Candidate: c5cbea838930139ec1f1b09ef209a255f9ab5a82:e5dee18e294eda1c2cb8b27f68e06ffda4bfb1ab; runtime inputs unchanged by this documentation update.

Verification: 18 focused tests passed; three browser harnesses passed (35.02s, 22.37s, 7.47s), including mobile/desktop keyboard, focus, draft preservation and history continuation; typecheck passed (56.93s). Evidence: /tmp/deck-origin-validation.md and apply-fast attempt 3 resultSeq 17058. Repository-wide gates remain failed for the reasons recorded in session-overlay-history-recovery; no release approval, installation or deployment is claimed.
