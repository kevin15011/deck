# Sprint 4 — A useful task across two native runners

Status: corrected candidate `830524cb…` is accepted at 125556 and installed, binary `6bed34b2…`. S4-Q01 is resolved; S1-Q07 and documented bounded-scope limitations remain. The same Apply Deep owner proceeds to S5a.

## User outcome

A Codex Lead delegates a bounded project investigation to an OpenCode specialist. The browser shows its owner, progress, exact attempts, report and the Lead's explicit treatment. Follow-up retains ownership and produces distinct evidence. Preserve the approved Rust host/launcher, React/TypeScript/GSAP interface, `deck2` command and actual Deck design references.

This is the next dependency-ready slice of the user's authorized [roadmap](../../../docs/roadmap.md#s4--delegate-across-two-native-runners), not a reduction of the remaining product scope. Example: trace how queued cancellation prevents execution, identify a race risk, and recommend the smallest correction. The specialist reads; any later edit still uses the S2 action-bound approval path.

## Starting evidence

- S3 candidate `1992f2e93e1848fe0849c61cbbbcff390ce756e2faabc93eba83ae21d8f7ed38`, binary `86ac96f094c3c9783a6624089ff8a03c6660377749ac12b71a90fe2326b7e718`, is accepted at 109925. Lead rematched all 78 implementation inputs and the built/installed binaries before this handoff. Frozen source/evidence: `target/review-s3-1992f2e9/`.
- Architect 6 report: events 112250/112251, SHA-256 `b20a2587b7b896c7e3a43400d469c58bdc8bbd27e822ad9bb20f62b81dc1c1ca`. Lead reviewed the report and material source. Adopt the small host task module and concrete native transports, with the instruction-applicability refinement below.
- OpenCode 1.19.1 startup, authenticated loopback HTTP/SSE and empty inventory passed a bounded fixture probe and independent replay. [Qualification evidence](../../../docs/sprints/sprint-04-runner-qualification.md) does not establish real provider authentication, model work, tool enforcement or cancellation.
- Verify-tier graph lookup lists 22 projects, none for `deck-next`; exact-path coverage returns unindexed. Direct source fallback was used for `sessions.rs`, `server.rs`, `native.rs`, `decisions.rs`, shared contracts and the browser API. No graph repair/indexing is implied.

## Implementation decisions

Keep the existing SQLite store, project queue, browser authentication and native approval boundaries. Use one root project execution slot, at most one live read-only specialist beneath it, and depth one. Parent and child can remain connected concurrently, but unrelated queued work must not start while either owns unsettled work. Never hold storage locks over native waits.

Persist task identity, session/root/parent lineage, logical owner, bounded scope and acceptance revision before launch. Each attempt records requested/observed runner and model, executable/integration identity, instruction/tool revisions, native generation/session/message identity, dispatch certainty and settlement. Terminal reports are immutable and bind their producing attempt and digest. Treatment records bind an exact report, treating Lead attempt, disposition and reason. Retrieval, adoption and independent verification remain separate facts; report text confers no authority.

Prefer the captured Codex dynamic-tool protocol for a small delegation channel: delegate, retrieve an exact result, treat a report, follow up with the same owner, and cancel an exact attempt. Derive authority from the owning native connection and recorded root identity, never model-supplied owner/project claims. Persist mutation identity and payload before responding: duplicates return the original outcome, conflicting reuse fails, and a lost response cannot create another child. Bounded result waiting must keep cancellation and native control responsive.

The start schema exposes `dynamicTools`; the resume schema does not establish registration persistence. Qualify actual calls and continuation. Until qualified, require an explicitly new team execution; preserve ordinary S3 conversations and make unavailable team continuation actionable. Extend native-context provenance beyond thread/mode before runner reuse: runner, integration/protocol revision, executable identity, storage namespace and relevant content/capabilities. Do not invent missing historical fingerprints or silently cross runner/context boundaries.

On restart, pause definitely undispatched child work and mark potentially delivered work uncertain. Retry creates a new attempt and never silently replays uncertain input. Root cancellation propagates to owned children; parent completion/failure must settle descendants or retain ownership visibly. Release/removal cannot discard active or uncertain descendant evidence. Storage failure stops further dispatch/effect release.

## OpenCode qualification and coexistence

Use a concrete HTTP/SSE adapter and a dedicated default-deny investigator role. Qualify positive project reads and negative writes, shell, outside-path/traversal/symlink, network-tool and alternate-tool cases. Native `plan`/`explore` names are not enforcement boundaries. If native read tools cannot enforce the selected scope, disable them and supply only scoped Deck-owned read/search tools through a small runtime endpoint. Do not introduce unrestricted shell or global plugins to make the demo pass.

The source-backed authentication candidate preserves native data resolution so OpenCode itself reads its existing authentication, while `OPENCODE_DB` and discovery/configuration/cache/state/temp locations use Deck-owned resources. It is not yet demonstrated: database-backed accounts may be unavailable, authentication may require built-in plugins, and managed/well-known configuration can alter startup. Account for these paths before useful work; a post-start empty inventory cannot prove harmless startup. Never copy credentials, mutate native profiles, reuse personal sessions or silently select another provider. Ordinary native authentication refresh must be disclosed as native behavior, not described as zero native writes.

Pin explicit provider/model assignments after sanitized availability checks. Missing credentials, incompatible binaries/models and unsupported restrictions fail before model dispatch with safe phase/correlation/recovery details. Separate cold preparation, warm admission, native acknowledgment, first output, tool connection and cancellation timings; compare ordinary-message behavior with S3. Keep reusable preparation outside the Lead message hot path while revalidating current identity and authority.

## Instruction applicability and interface

Use canonical safety, evidence treatment and proportional-routing guidance, with source/revision/digest and actual delivery surface recorded. Inspect the selected content without claiming complete provider-prompt visibility or model compliance. Reconcile [audit findings](../../../docs/instruction-audit.md#proposed-resolution-handoff-by-functional-increment) before first affected use.

Refinement to Architect's suggested delivery to both roles: I14/I37 establish that the canonical Code Economy role bundle targets Architect, Apply Fast, Apply Deep and Quality, excluding Lead and Investigate. Do not append that whole bundle to both S4 roles or infer applicability from global enablement. Preserve the already accepted S2 edit policy and its necessary-code/test overrides; declare role/operation applicability once, show applicable content or the exclusion reason, and qualify each designated role before introducing it. No hard LOC gates or accidental wrapper expansion.

Add compact task/attempt/report views using the original workspace design, with useful empty, unavailable, running, cancelling and uncertain states. Show requested versus observed identity and treatment honestly. All appearance/selection transitions use GSAP, immediate control access, cleanup and reduced motion. No decorative inactive controls, generic workflow language, plugin SDK, credential UI or helper updater belongs in this slice; their planned sprints remain required.

## Acceptance

1. Two real runners complete a useful investigation from the packaged browser; the Lead retrieves and explicitly treats its exact report. Show follow-up with the same owner and distinct attempts.
2. Unsupported assignments fail before dispatch; positive and denied native tool/configuration boundaries are qualified for the exact versions. No global profile installation or credential copying is required.
3. Duplicate delegation and lost responses cannot create duplicate work. Wrong owner/session/attempt calls, stale report treatment and forged authority text are rejected at the host boundary.
4. Root/child cancellation, disconnect, parent completion/failure, storage failure and restart preserve dispatch truth, descendant ownership and the project slot. Uncertain work never silently replays.
5. Native reuse includes honest runner/content/storage provenance; incompatible or unknown context requires explicit fresh execution. Dynamic-tool start/resume behavior is demonstrated or accurately unavailable.
6. Required instruction selection and observed delivery are recorded with correct applicability; Code Economy remains compatible with necessary implementation, testing and accessibility.
7. Existing S2 decisions and S3 conversations/queue/recovery remain intact. Recognized state migrations are atomic; incompatible/corrupt state is untouched, cached incompatible clients cannot dispatch, and backward state compatibility is explicit.
8. Desktop/mobile, keyboard and reduced-motion task journeys preserve agreed visual fidelity. Timing observations distinguish preparation from ordinary messages and do not assert unmeasured performance.

Use intent-derived deterministic boundary/fault tests, then real native/browser qualification in owned fixtures. Capture red-first evidence for specified logic where practical, document deviations, and preserve protected regression tests. Run manifest-derived formatting, Clippy, locked Rust tests, API tests and packaged build once on the final candidate, reusing unchanged evidence. Independent targeted verification follows delivery; fake-only evidence cannot close S4. Produce a reproducible source/asset/binary manifest, sanitized commands/timings, acceptance results and exact limitations.

## Ownership and progress

Correction update: Apply Deep 10 supplied `830524cb…` / binary `6bed34b2…`, integrated at 123907 for review. Lead froze the exact implementation, passed six affected boundary tests and the real packaged browser journey. Quality 13's review is integrated at 125556 with bounded acceptance and S4-Q01 resolution. The preserved startup timeout requires journal recovery, not demonstrated corruption; its cause remains unqualified. See the [verification record](../../../docs/sprints/sprint-04-verification.md#acceptance-and-installation). S4 is installed without restarting live hosts.

Apply Deep task `task-181d5e85-7817-4dbd-bc81-849132576baf` continues implementation. It owns production source, tests, scripts and build artifacts in `deck-next`; Lead alone writes Markdown/OpenSpec, integrates evidence and installs accepted candidates. Quality retains independent review ownership. Do not revert other work, restart live user hosts, mutate the old Deck, publish or commit. S1-Q07 and live steering remain open/unqualified. See the [execution ledger](../deck-recreation/execution.md) for subsequent authorized work.

The continuation was accepted with six structured acceptance groups covering the real journey, authority, lifecycle, compatibility, experience and evidence; it references Architect 6, the startup harness attempt 2 and Quality 11. Lead checked all local link targets in this brief and the updated roadmap/ledger. No production tests were rerun for these planning-only edits.

Apply Deep 9 supplied the real two-runner candidate and owner verification records. Lead matched 84 inputs/22 assets/binary and froze `target/review-s4-ece822af/`. The same Quality task owns independent review; Lead owns an independent packaged browser replay. [Candidate evidence and limitations](../../../docs/sprints/sprint-04-verification.md) distinguish these responsibilities and keep a cleanup/follow-up interleaving question explicit. No installation follows from the owner report alone.

## S4-Q01 correction

Quality 12 is integrated at 117291. Its source trace confirms that a terminal report can admit follow-up before process cleanup, and later cleanup uncertainty does not stop that accepted follow-up from dispatching. Direct root submission also lacks the active-process guard. Retain durable unsettled ownership until process settlement succeeds; recheck conflicting ownership at direct admission and final child dispatch. Preserve report evidence when cleanup fails, without advertising terminal settlement or enabling conflicting work. Demonstrate the delayed/failed-cleanup interleaving deterministically, red before correction, including accepted follow-up, direct root input and queue behavior; then run affected regression and real packaged team/cancel checks. Do not weaken the existing scope or silently recover/replay.

MCP cancellation claims must distinguish denial of newly admitted reads from an already-admitted read completing. No immediate revocation of in-flight filesystem reads has been qualified. S1-Q07 and all existing limitations remain recorded; no new user approval is required for this authorized correction.
