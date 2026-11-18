# Sprint 2 — Review and authorize project changes

## Outcome and authority

The user has authorized implementation of all planned sprints. Deliver the next useful journey: request a bounded change, inspect its proposed effect, allow once or deny, and inspect the observed result from the web. The host remains Rust; React/TypeScript/GSAP preserves the actual Deck UI reference. The command remains `deck2`.

This brief refines [S2](../../../docs/roadmap.md#s2--review-and-authorize-project-changes), without removing its project trust, questions/decisions, scoped grants, revocation, cancellation or diff requirements. Begin with an existing ordinary text file inside a disposable project; broaden only after the authority boundary is demonstrated. No publishing, arbitrary shell escalation, external writes or persistent native permission amendments belong in this increment.

## Baseline and coexistence

S1 candidate `46277cab…` is preserved under `target/review-wsl-46277cab/`, including all 66 inputs, embedded assets and binary `c1bd9c4c…`. Lead independently passed its packaged opener/auth tests and integrated Apply Deep attempt 5 at 94531. Quality subsequently reviewed that immutable snapshot; the exact recovery binary is installed with a backup while S2 advances in the main workspace. Neither the old Deck host nor the user's current deck2 host is restarted or mutated.

S1's Linux and explicit private-link authentication have execution evidence. Actual automatic Windows browser entry remains unqualified: Explorer returned a non-success status and S1-Q07 stays open. That does not authorize bypassing browser authentication or block independent implementation/testing through a qualified browser path. Report this platform limitation separately from S2 completion.

## Minimal implementation

Reuse the existing Store, native transport, shared DTOs, HTTP boundary and React workspace. Add small focused modules only where useful. Do not create a generic policy engine, framework of adapters or workflow language.

Persist the owning session/command/attempt/native connection and exact native request identities, the complete proposed effect, relevant preconditions and reviewed revision. Bind a decision to that action. A question answer is information, not an authorization grant. Keep trust in a project separate from permission for a particular effect. The browser returns an expected revision, response and durable response-command identity; it cannot replace the authoritative action or native request ID.

Serialize approval release, cancellation and revocation through the owning attempt. Persist grant consumption and response-dispatch intent before sending a native response. The operation is not complete merely because the user approved or the response was sent. A failed write or crash across that boundary remains uncertain and is never replayed automatically. Cancellation/revocation before authorization prevents release; after release it requests interruption and reports possible partial effects without promising rollback. Native session grants remain unavailable until their revocation semantics are proven.

Show pending decisions, proposed diff, observed result and clear failure/recovery states. Render file/diff content inertly. Reject stale reviewed content; preserve concurrent user changes and pre-existing diffs. No automatic reset/revert is implied. Keep Code Economy's completeness and necessary-verification overrides in the admitted instruction revision.

## Native qualification before enabling effects

The installed Codex schema is evidence of protocol shapes, not proof of enforcement. Qualify exact Codex 0.166.0 behavior in an owned isolated project: complete effect description before approval, deny prevents the effect, allow once does not silently permit later effects, stale target handling, cancellation/revocation and no bypass through other enabled tools. Explicitly select and verify user approval routing. Workspace-write alone is not evidence of per-edit interception.

If the exact native boundary cannot satisfy the product contract, leave it unavailable and return the minimal counterexample. A host-owned edit tool is a possible later narrow design delta, not permission to silently substitute unrestricted native execution. Progress on independent DTO/store/UI pieces may continue behind a disabled mode, but an unqualified mode cannot be advertised as working.

## Acceptance

1. A real native proposal is completely reviewable before the admitted effect; allow once yields that bounded effect and deny leaves target bytes unchanged.
2. Wrong action, stale revision, old attempt/connection and conflicting response identity release no permission. Identical retries return the persisted result without a second native response.
3. Cancel/revoke races have one durable winner. Disconnection/restart cannot resurrect an expired grant or replay ambiguous response delivery.
4. Questions and approvals remain distinct; an informational response never grants an effect. Project trust does not silently approve all later work.
5. Proposed and observed diffs are distinguished; stale targets, partial application and unavailable comparisons remain explicit. User changes are preserved.
6. Existing read-only conversation, authentication, idempotency, drafts and cancellation still work. Recognized state migrations are transactional; unknown/corrupt schemas remain untouched.
7. Browser keyboard/reconnect/reduced-motion paths work and the relevant live Deck design is preserved. Add real controls only when their backend behavior exists.

Use deterministic boundary tests and a real native allow/deny demo on a disposable fixture. Record exact candidate, commands/durations and native versus fake evidence. Run the manifest-derived format/static/test/build gate once per final candidate, plus independent targeted authority verification. Do not run the old repository's unrelated full suite.

## Ownership and sequence

Apply Deep task `task-181d5e85-7817-4dbd-bc81-849132576baf` retains the complete implementation ownership. Lead owns docs/OpenSpec/integration and local install coordination. Preserve the frozen S1 review snapshot. Quality task `task-c081e37c-4836-43db-89a6-8ee4f93e8753` retains independent review ownership. No commits or publication are requested.

Architect attempt 5 (94175/94176, integrated 94535) supplies the accepted minimal contracts and subsequent S3 transition: actual persisted sessions, one project execution slot, durable queue states, explicit queue resume after restart, qualified native continuation/steering and stable draft identity. Implement S2 first, then continue S3 under the same owner when its dependency is accepted. The larger [execution ledger](../deck-recreation/execution.md) preserves the all-sprint objective.

Primary visual references: [actual running Deck](../../../docs/design-reference/live-20261111/README.md). Existing components may be reused/adapted as presentation, with no dependency on the old TypeScript host. Capture approval and conversation states separately when needed; home/settings screenshots do not qualify those states.

## Candidate review

Apply Deep attempt 6 delivered candidate `73566323…`, binary `47f89d4a…`, with reviewed edits, durable decisions, informational questions and inert proposed/observed diffs. Lead matched its 71 inputs, 22 assets and five bound evidence records and retained `target/review-s2-73566323/`. The [verification record](../../../docs/sprints/sprint-02-verification.md) distinguishes owner evidence, independent review and remaining limits. Quality is reviewing this candidate; installation and S2 acceptance are pending. The [S3 brief](../sprint-03-sessions-recovery/working-brief.md) is prepared for continuation after this dependency is accepted.

Quality 10 is integrated at 104027 with two required corrections: S2-Q01 must recover from definitively rejected question answers while preserving uncertain response identity; S2-Q02 must distinguish native completion from an unavailable post-edit comparison. Lead confirmed the material source paths and unchanged candidate. Return these corrections to the same Apply Deep owner, preserve the frozen predecessor and capture counterexample failures before repair. Lead will execute independent focused Rust/native and counterexample checks after repair, since the reviewer could not create the required filesystem fixtures. S2 acceptance and installation remain pending; the S3 brief stays prepared.

## Acceptance

Apply Deep 7's corrected candidate `183edadf…` is accepted and integrated at 105655 after Lead read the correction source, matched 72 inputs/22 assets/binary, independently passed eight reviewed-edit tests, both affected native contracts, both packaged counterexamples and a real Codex informational-question canary. S2-Q01/Q02 are structurally resolved. The [verification record](../../../docs/sprints/sprint-02-verification.md) preserves commands, durations, scope, RED evidence, review responsibility and limits. Binary `3d2efe82…` is installed with a prior-binary backup; no live hosts or user state were opened/restarted during installation. S1-Q07 remains open and separate. This accepts the bounded single-existing-file S2 journey and permits the authorized same-owner S3 continuation, not full product parity.
