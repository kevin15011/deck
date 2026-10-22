# Delegated task continuity policy — design for review

Status: approved for implementation, 2026-10-22, with the user's four final amendments incorporated. This document supersedes the architect's temporary candidate wherever they differ. Documentation approval does not itself change current runtime behavior.

## First-delivery amendment — accepted limitation and interruption handling

The user's latest instruction accepts the measured-availability limitation and excludes reading internal Codex databases or histories. First delivery is fresh-only for Codex and OpenCode; Claude is also fresh-only because effective native control/precompute/accounting evidence remains unverified (compaction-bounds.md sections2/6). Do not add a resolver or native-history parser. The previously designed native selection contract remains fail-closed and fixture-tested; production native support is deferred rather than required for this delivery.

For operator-interrupted active predecessors, generate a mandatory interrupted/no-final-report notice, bounded last available agent message labeled as partial evidence, task-attributed file references and an instruction to inspect their current state before continuing. Keep the new Lead instruction explicit. Missing messages/files are disclosed. Reuse current projections/artifacts and byte budgets, without model summaries or native transcript reads. A partial assistant message must never be described as a final report.

Offline metrics add a distinct interrupted-continuation cohort with trusted predecessor provenance, frequency and an explicit admitted-continuation denominator, plus the existing per-sample first-edit step/token cost. Queue-only cancellation, failures, unknown origins and infrastructure retries must not inflate operator-interruption frequency. Preserve missing/partial/censored data and separate review endpoints. If the measured recovery cost is high, prioritize P-014 member steering; Codex native resume is not the fallback mitigation. No steering implementation or new numeric cost target is added here.

## 1. Outcome and boundaries

Keep the logical task and assigned owner while choosing native continuity at launch. Prefer fresh native context with an explicit bounded handoff. Permit narrowly eligible automatic resume and an audited override below a hard input cap. Review roles always start fresh.

The rationale is measured compaction cost, rework and review independence. Neither the historical baseline nor this design establishes that per-call latency grows with context. Member steering remains in the separate deferred change.

## 2. Configuration and selection

Proposed `crossRunner.continuity` configuration:

| Field | Initial value | Validation / meaning |
| --- | ---: | --- |
| `mode` | `policy` | `policy` or `fresh`; no legacy mode that bypasses invariants |
| `autoNativeMaxAgeMs` | 300000 | Integer 0..3600000; zero disables automatic reuse |
| `autoNativeMaxInputTokens` | 80000 | Nonnegative safe integer, at most the hard cap |
| `nativeHardCapInputTokens` | **160000** | Approved initial ceiling; effective cap additionally constrained below verified native compaction boundary, even for overrides |
| `handoffMaxBytes` | 32768 | UTF-8 bytes, 32768..131072; mandatory sections checked against actual encoded size |

The 160,000-token ceiling is approved. It is not a universal safe native threshold. At launch, resolve a version/model/config-specific auto-compaction boundary and its accounting basis; derive an input-equivalent safe bound, then use the lower of that bound and the configured ceiling. The effective cap itself must be strictly below the native trigger (integer boundaries require at least one token of separation). Unknown threshold, accounting conversion, effective config or last-request input forbids native reuse, including override. Capacity alone or a guessed percentage is not threshold evidence. Disabled auto-compaction is a separately verified configuration state; it does not imply unlimited model capacity.

Native threshold validation is a required implementation precondition per enabled runner/model path. Reviewed formulas, effective-configuration requirements and Lead corrections are in [compaction-bounds.md](compaction-bounds.md). Formula verification alone does not establish a runtime path: effective model/settings/accounting evidence and fixtures remain required. Until a path is verified, it must remain fresh-only. A next instruction or later generated output can still cause compaction; this is a conservative selection bound, not a promise that future work never compacts.

`selectContinuity()` is a pure core policy function; the host supplies evidence and time. The order is:

1. Validate policy configuration; invalid updates are rejected with the existing actionable config errors. If no valid policy is available at launch, fail preparation rather than silently allow reuse.
2. Resolve the task's assigned role. Review role always fresh; unknown role defaults fresh and cannot use native override.
3. Forced-fresh policy or explicit `fresh` selects fresh. Conflicting explicit native requests receive a recorded refusal and run fresh if otherwise admissible.
4. Require a confirmed eligible prior native identity, a settled prior execution and reliable latest-request input. Otherwise fresh. Existing ownership/dependency/permission gates still block execution where applicable.
5. A failed predecessor, unknown native compaction bound, or input at/above the effective hard cap selects fresh, recording a refused native override if one was requested.
6. Explicit `native` with a valid justification selects native below the hard cap. It may bypass integration, age and the automatic 80k threshold; it cannot bypass reliability or safety gates.
7. Automatic native selection requires the prior attempt to have completed OR been explicitly interrupted by the user/Lead after launch with settled ownership, its latest integration state not to be `integrated`, `0 <= launchTime - previousAttemptEnd < maxAgeMs`, and input strictly below the automatic threshold and effective cap. Otherwise fresh.

Operator interruptions are a first-class correction path until member steering exists. Persist host-authoritative `stopOrigin` (`user|lead|system`), interruption/cancel kind, originating command/Lead attempt and whether execution had launched. User `turn.interrupt` and an active Lead `deck_task_cancel` qualify as operator stops even when the latter's terminal state is `cancelled`. Queued-only cancellation, daemon restart, session release/stop, uncertain provenance and unresolved native close do not qualify. Failed attempts always start fresh, including an override request. Preserve cancellation/ownership fences and wait for a settled terminal attempt before continuing. Historical ambiguous interrupts remain fresh. If interrupted during a request whose input cannot be established, the reliable-input requirement still applies; do not reuse an older request's size. The immediately previous attempt is used, never a more favorable older one.

Missing justification, native requested without a continuation, or native requested for a known reviewer is rejected synchronously. A request that passes syntax validation can still be refused by launch-time evidence; `deck_delegate` success means queued, not that native reuse was granted. The refusal and effective fresh selection are durable and visible in the result.

## 3. Queue-to-launch lifecycle and ledger

`delegate()` keeps current owner, dependency, replan, capacity and running-task checks. It captures structured fields and the continuity REQUEST; it does not select or retain a resume target on the queued turn.

At dequeue, `schedule()` takes an immutable reference to the predecessor attempt, resolves role and current valid policy, and evaluates using the predecessor's terminal `task.state` timestamp. Observer activity, integration/retrieval writes and Lead messages never advance this timestamp. Negative age or unknown end time cannot establish automatic eligibility.

If handoff/diff preparation is asynchronous, the scheduler reserves the slot, prepares bounded evidence, then rechecks time/config/integration immediately before committing the launch record. The final evidence/time snapshot is recorded before `driver.start`; no later asynchronous history reconstruction may silently turn a stale native decision into a launch. Cancel/restart/ownership checks remain in that boundary.

```mermaid
sequenceDiagram
    participant L as Lead
    participant H as Session host
    participant E as Ledger
    participant R as Native runner
    L->>H: delegate(taskId, instruction, structured fields, continuity request)
    H->>E: task.continued: next attempt, selection pending
    H->>E: task.state: queued
    Note over H,E: Existing queue, owner and dependency gates
    H->>E: Read predecessor end, role, input, integration and edit evidence
    H->>H: Evaluate policy at launch; prepare bounded handoff if fresh
    H->>E: Flush task.state running + final selection/provenance
    alt Fresh selected
        H->>R: Existing launch path, handoff, no prior native ID/resume
    else Native selected
        H->>R: Existing launch path, confirmed prior native ID/resume
    end
    R-->>H: Fenced usage, edits, completion
    H->>E: Attempt evidence and terminal timestamp
```

Use existing event kinds with versioned additive data, rather than introducing log kinds an older reader rejects outright:

- `task.created` / `task.continued`: structured fields, role identity, original/current instruction references, requested continuity and requester provenance. New continuations explicitly project selection as pending.
- `task.state` running: `continuitySelection` with effective `native|reseeded`, requested mode, reasons, policy version/values, predecessor attempt/end sequence/time, observed input and provenance, integration snapshot, override outcome, handoff size/flags and new native identity when known.
- Terminal `task.state`: project immutable `endedAtMs` from the event timestamp. Never overwrite it on a duplicate terminal record.
- `diagnostic`: bounded continuity refusal records. Existing `task.integration` can carry explicit Lead finding resolutions; no new reviewer tool/event protocol is introduced.
- `usage` / `tool.completed`: normalized request evidence and successful edit evidence.

Extend the ledger snapshot version (currently 12) and rebuild once on version mismatch. Preserve old record semantics: historical records without new fields have no invented selection; old usage lacking reliability evidence cannot qualify for native. Keep previous-attempt data explicitly referenced because the queued attempt is already the logical task's latest attempt.

Pending selection MUST NOT inherit a prior native identity or be treated as confirmed. Only the final running selection can install the chosen identity/continuity; late old-attempt events are fenced by attempt, live turn and native identity. Role, assignment, dependencies and accounting remain attached to the same task.

## 4. Last-request INPUT evidence by runner

Use a separate normalized field on `usage`, e.g. `requestInput`, not the existing UI `context.tokens`. The UI has different semantics and may intentionally retain an older reading after an error.

```typescript
type RequestInputEvidence = {
  tokens: number | null; // last request INPUT, including cache
  basis: 'codex-last-input' | 'claude-message-input' | 'opencode-verified-input';
  nativeThreadId: string;
  nativeTurnId: string;
  nativeRequestId?: string; // only a real native identifier
  modelId?: string;
  cachedReadTokens?: number;
  cacheWriteTokens?: number;
  unknownReason?: string;
};
```

Host adds task/attempt and event sequence. Validate nonnegative safe integers, overflow, model/native attribution and whether the observation belongs to the final request. No result aggregate, UI percentage, output tokens or older request substitutes for missing final-request input.

| Runner | Extraction | Reliability / fresh fallback |
| --- | --- | --- |
| Codex | `thread/tokenUsage/updated.tokenUsage.last.inputTokens`; cached input is already included, so do not add it again | Accept only correlated native thread/turn and validated last counters. Reject inconsistent totals (`last.totalTokens != input + output`), cached > input, unsupported cache-write semantics, synthetic compaction markers and unknown later requests. Synthetic marker checks must not convert missing values to zero. |
| Claude | Main-thread `assistant.message.usage.input_tokens + cache_creation_input_tokens + cache_read_input_tokens` | Require valid components, main-thread/session/model identity and a real assistant request/message ID. Exclude nested subagents, synthetic/API-error messages and `result.usage` aggregates. Deduplicate repeated snapshots of a message. If the final request failed without reliable usage, mark input unknown even though the UI may keep its previous reading. Current conservative compaction invalidation remains until a later request can be positively identified. |
| OpenCode | Candidate formula for a VERIFIED normalization path: final correlated assistant message `tokens.input + tokens.cache.read + tokens.cache.write` | Existing response is correlated, but provider normalization may undercount input. Default policy evidence is **unknown** for OpenCode until a provider+SDK/runner normalization path is verified by source and fixtures. Only verified combinations may emit reliable policy input; a provider name alone is insufficient. Unknown versions/providers always fresh, including explicit native requests. UI usage display may continue independently. |

Native protocol schemas establish field shapes, not all accounting semantics. Codex/Claude extraction must be covered by version-relevant fixtures before enabling policy reuse. The architect inspected installed Codex 0.162.1, Claude 2.1.301 and OpenCode 1.19.1; existing Claude fixtures include 2.1.296 and require compatibility validation. OpenCode clamp heuristics alone are explicitly insufficient.

Adapters track request ordering/finality. A later unobserved model request or compaction invalidates earlier eligibility. Do NOT blindly invalidate on every later `message.completed` or tool event: those may belong to the SAME measured response. In particular OpenCode's driver currently emits response text after its correlated usage event. Where finality cannot be established, return unknown; do not invent a request ID from a token counter.

## 5. Assigned role, not Lead labels

Add host-owned continuity classification to canonical role metadata (`work|review`). `deck-quality` is review, including canonical legacy mappings. Resolve from the member's actual materialized role assignment, persist that role identity on task creation, and preserve it on continuation alongside runner/model/thinking.

The Lead cannot supply a purpose/role field on `deck_delegate` to change this classification. A cosmetic alias cannot turn a review role into work. A custom member without verifiable role metadata is unknown/fresh until the host's assignment mapping identifies its actual role; it does not default to work. Do not add a second free-form reviewer label list that could disagree with the assigned role.

Reviewer's first and subsequent attempts use the same bounded evidence builder. First attempts have no predecessor report; their `sourceTasks` identify the candidate under review. A missing review target is disclosed, never replaced by a global workspace diff.

## 6. Structured delegation and update semantics

Add optional fields to the existing tool contract and host validator:

```typescript
continuity?: 'auto' | 'fresh' | 'native';
continuityJustification?: string; // trimmed, 1..512 chars; required only for native
acceptance?: {
  items: { id: string; text: string }[];
  refs?: { path: string; anchor?: string }[];
};
findings?: {
  mode?: 'merge' | 'replace';
  items: {
    id: string; state: 'open' | 'blocker' | 'resolved' | 'wontfix';
    severity?: 'blocker' | 'major' | 'minor' | 'info';
    text: string; resolution?: string; evidenceSeqs?: number[];
    source?: { taskId: string; attempt: number; findingId?: string };
  }[];
};
sourceTasks?: { taskId: string; attempt: number }[];
```

Bounds: at most 32 acceptance items, 64 ACTIVE findings and 8 source-task references. Acceptance and active findings are EACH at most 8 KiB serialized; merged active state must also fit, not merely each incoming patch. IDs <=64 characters, item text <=1024, resolution <=512; evidence references are bounded existing same-session event sequences and artifact references are bounded project-relative paths. Reject duplicate IDs and invalid/cross-session references. Closed transitions persist in ledger history, not the active handoff budget. `sourceTasks` require exact existing attempts, preventing a future continuation from silently changing review scope.

- Absent fields inherit explicitly recorded structured state; if never supplied, render `not supplied`. No parsing of prose to populate either field.
- Present acceptance replaces the previous acceptance revision. An empty list records `explicitly none` and the revision that cleared it.
- Findings default to merge/upsert by ID; omitted findings remain. Empty merge is a no-op, not a clear operation.
- Replace must include every unresolved ID, with explicit resolution when closing it. Omission of an open/blocker finding is rejected. Empty replace means `explicitly none` only if no unresolved finding would be erased.
- `resolved` / `wontfix` require a resolution and evidence references. Lead is the sole structured-state writer: the reviewer recommends closure in its normal report, and Lead records the explicit transition through a structured continuation update or optional `findingResolutions` on existing `deck_task_integrate`. Each resolution names source task/finding ID, reason and evidence sequences, and records actor, Lead attempt and transition sequence. Integration alone never closes findings. Reopening the same ID requires an explicit open/blocker transition and reason; closing/reopening is idempotent under the existing command receipt rules. These are attributed Lead claims, not independent proof.
- Missing `sourceTasks` inherits; explicit `[]` clears review targets with an explicit empty marker. No guessing targets from prompt text.
- `null` is invalid. No array or merged-state overflow is silently truncated at admission.

Update tool/role instructions to say that the SAME logical task/owner is continued while native context is policy-selected. Existing sessions' runtime instructions do not change until this code ships.

## 7. Shared handoff builder and byte budget

Replace the fallback's current last-eight-message `taskSummary()` with one deterministic builder used by policy-fresh continuations, first reviews and the existing missing-native-session recovery. Keep the current launcher and once-only fallback guard. Fresh selection launches directly without a probe resume; native-session-not-found recovery retains its separately recorded failure/next-attempt accounting and uses the same builder.

The ledger keeps bounded projections and sequence references for the original task, current scope instructions, structured active findings, report/integration and task edits. Closure history remains in the ledger and can be paged by reference; it is not accumulated in the handoff or its active projection. No whole-log scan on each continuation; log lookup/index initialization is a one-time replay/readback concern. No new model call, summary inference or native transcript query.

At 32 KiB, sections are ordered:

1. Provenance/authority and missing-evidence markers.
2. Structured acceptance and active structured findings.
3. Original task and recorded continuation instructions/scope corrections, each clearly attributed; the current instruction is passed separately.
4. Previous report and its review/integration status, plus explicitly referenced review reports.
5. Task-attributed files/diff evidence.

Reserve up to 8 KiB each for effective acceptance and findings and a bounded header; render deterministically and check ACTUAL UTF-8 bytes. Do not claim that a 16 KiB handoff can contain two 8 KiB fields plus overhead. Reject a structured update that cannot fit mandatory content under the active minimum budget. Diff is excerpted first, then reports and prior instructions; omissions include byte/count totals and usable evidence references. Missing original task or report is explicit.

For overflow, write a private, task/attempt-scoped immutable handoff artifact with sanitized source excerpts and exact ledger references, available through the runner's existing file-read capability. Record artifact digest and capture sequence in the ledger. Never point an omitted original instruction at `deck_task_result`, which currently retrieves results rather than the original instruction. Keep the artifact independently bounded (proposed 256 KiB); beyond that retain references and explicit missing/omission state rather than copy a transcript. If a required section cannot fit and no usable retrieval route exists, fail preparation clearly instead of launching with silently lost criteria.

Only structured open/blocker findings enter the findings section. Resolved/wontfix history stays out. The previous report remains separately labeled historical text and is never parsed to resurrect closed findings or manufacture structured state. Overflow is surfaced before launch. The host never upgrades report text into authorization. Criteria/structured directives retain their actual Lead-provided provenance; embedded report/diff text is evidence, not new user instructions.

## 8. Edit evidence, scoped diff and concurrency

Normalize only successful, attributable edits into existing events:

- Codex: successful native `fileChange.changes` with path/op and bounded native diff evidence.
- Claude: successful `Edit`, `Write`, `NotebookEdit` tool results correlated to validated path inputs; fixtures must establish each mapping.
- OpenCode: correlated edit/write tool completion or patch-part evidence only after session/request attribution is established. Unfenced SSE patch records do not qualify.

Per-attempt projection keeps at most 256 validated project-relative paths, source event references and an overflow flag. Validate rename source/destination, prevent path escape and do not treat reported paths as executable arguments. Shell-only edits without attributable file evidence remain unknown; disclose that the file set may be incomplete. Never discover extra files from global `git diff` to fill gaps.

For implementation continuations, file membership comes from that logical task's recorded edit attempts. For review roles, it comes from explicit `sourceTasks` attempts, preserving their identity. Prefer immutable diff excerpts already captured in those events. Optionally obtain CURRENT diffs ONLY for that allowlisted path set through an injected read-only provider from CLI composition; session-host stays adapter-independent.

The provider uses bounded, noninteractive Git operations with external diff/text conversion disabled and literal path handling, a 5-second deadline and byte cap. It records base HEAD, capture time and index/worktree status. New/untracked, deleted, moved or binary paths must be handled explicitly from recorded edits; unavailable content is disclosed, not presented as an empty change. This is a scoped CURRENT workspace diff, not an exact historical per-task patch or proof of exclusive ownership.

Mark `potentiallyMixed: true` whenever another task overlapped the selected source attempt in the same session OR canonical project, or changed its paths before capture. Include readonly task overlap conservatively. Track local-daemon project activity in a bounded index and persist relevant overlap evidence; do not scan every session ledger on each continuation. Incomplete historical/unloaded-session or external-process visibility is `concurrency unknown` AND potentially mixed, never exclusive. No native calls are added to discover other editors.

## 9. Reviewer behavior and completion metrics

Do NOT add `deck_task_finding` or another required reviewer reporting call. Reviewers keep their existing report workflow; Deck does not infer structured findings from prose. Lead supplies and resolves structured finding state explicitly as defined in section 6.

For reviews and re-reviews, measure steps, input/output/reasoning tokens where supported, and duration through normal completion using existing native/lifecycle events, then compare to the baseline. Mark interrupted/failed review attempts separately. This avoids changing reviewer behavior to produce the metric. There is no first-finding metric in this change. For implementation work, retain the first-successful-edit metric to reveal acquisition overhead after reseeding.

## 10. Metrics and comparison

Record minimal bounded evidence on the hot path; compute comparisons with an offline projector over the same ledger format.

| Metric | Definition |
| --- | --- |
| Initial input | First reliable native request-input observation, labeled post-response if that is when available; do not fabricate prelaunch tokens |
| Eligibility input | Last request input of the predecessor, with basis, native identity and source sequence; native compaction trigger/basis, effective settings evidence and lowered effective cap |
| Override rates | Requests / valid continuation admissions; granted / requests; refused / requests, with reasons. Report synchronous invalid/rejected requests separately so denominators cannot be confused |
| Steps | Distinct tools by native tool-call ID; model steps only with reliable response identity/counter deltas. Neither substitutes for the other |
| Duration | Queue, preparation, native turn and total attempt with explicit event boundaries; preserve actual selection time |
| Compaction | Paired native start/end by attempt and native identity; unmatched intervals are incomplete |
| Rework | Continuations linked to unresolved structured findings from reviewed attempts, with explicit source; not all retries/continuations |
| Acquisition / review cost | Implementation: launch to first successful recorded edit. Review roles: launch through normal completion. Include elapsed time, supported model-step count and input/output/reasoning tokens with cached input separately |

For first-edit tokens, align the response that caused the edit even when usage arrives afterward. Include it only with identifiable request correlation; otherwise report a partial/lower-bound prefix or unavailable, not a false exact count. Input already includes cache; do not add it twice. Missing first-edit endpoint is censored as `no edit evidence`; failed/interrupted reviews have their observed partial cost and terminal status, not a completed-review sample. OpenCode step-level costs are unavailable while only final response usage is correlated. Claude output/reasoning counts are unavailable where only partial snapshots exist. Record gaps rather than invent zeros.

Codex model-step counting requires distinct monotonic usage updates excluding synthetic compaction observations. Claude uses distinct main-thread message IDs with snapshot deduplication. Counter resets or unalignable partial data yield unknown/partial metrics. Report role, runner/model/thinking, context, output volume, handoff bytes and truncation alongside time. Historical baseline steps have the reliability limitations documented in evidence.md; new structured rework/finding metrics cannot be retroactively inferred as exact historical facts.

## 11. Compatibility, rollout and rollback

Extend existing event data/snapshot projection and keep historical records readable in the NEW binary. Unknown event kinds currently corrupt old-reader replay, so avoid new kinds; nevertheless additive data is NOT proof that downgrade is semantically safe. In particular old code interprets any non-reseeded continuity value as native and ignores launch-time selection updates. Do not describe a pending-selection field as harmless to old binaries.

Supported policy fallback is `mode: fresh`, preserving hard caps, assigned-role review independence and all accounting. There is NO legacy bypass mode. Config updates affect future launch decisions; current attempts keep their recorded selection. A binary downgrade requires separate tested compatibility handling, draining active tasks and removing unsupported config; it is not an automatic action or a claimed supported rollback in this change.

Use local canary first after implementation authorization and tests. Compare equivalent work with the same runner/model/thinking, reporting acquisition overhead and correctness as well as compaction/rework. Do not promise a fixed duration reduction. Existing permissions, ownership-unsettled recovery and queued-attempt interruption on daemon restart remain authoritative. Do not silently resume or rerun a queued attempt after restart.

## 12. Implementation boundaries and verification plan

One vertical implementation owner; design approval and implementation authorization are now recorded:

- Core: pure policy, validated request/compaction-bound evidence, bounded structured delegation/integration contracts, role classification metadata and strict config.
- Session host: queue selection, operator interruption provenance, reseed builder reuse, ledger/replay projections, explicit finding closure and result visibility, edit/concurrency attribution, credential fencing.
- Adapters: request-input extraction/finality and positively attributable edit events only.
- CLI composition: optional bounded read-only diff provider and offline metric projection.
- Developer-role/tool instructions: logical ownership continuity and structured handoff inputs; no new reviewer reporting behavior, member steering or unrelated UI work.

Verification uses deterministic clocks and mock drivers. Cover automatic boundaries 299999/300000 ms and 79999/80000 input; override 159999/160000 and LOWER native caps; unknown threshold/input, effective config changes, genuine zero, cache inclusion and cumulative/output exclusion; operator interrupt/active cancel versus failure/queued cancellation/restart; queue aging and re-evaluation after preparation; integrated newest versus older attempts; review/alias/unknown-role precedence; config errors; declined native requests; structured merge/replace/absent/empty, explicit closure/reopen and Unicode byte budgets; artifact retrieval; task-scoped edits, shell gaps and project overlaps; pending selection replay; stale native events; same-task native-ID replacement; first-edit and review-completion metrics; bounded missing-session fallback. Codex/Claude/OpenCode fresh/resume driver inputs are tested without real inference.

Required review gates: no new model requests for handoff construction; no global diff file discovery; no silent missing criteria/findings; no hard-cap or native-compaction-bound bypass; no dependency/permission weakening; no speculative repeat of successful side effects. Performance checks must demonstrate bounded projections and no per-continuation full-history scan. Full criteria coverage maps to AC-01..AC-11; the user has reviewed the design and authorized implementation with these final amendments.

## 13. Evidence and Lead review

Architect task `task-0830556f-c081-4a66-87f0-5a86986980fa`, attempt 1, result/end sequences 48561/48562 supplied the source-backed candidate. Lead read the candidate and material source boundaries and corrected unsafe legacy rollback, budget arithmetic, role classification, OpenCode certainty, same-response finality and omitted-instruction retrieval.

Primary source references: `packages/session-host/src/session-manager.ts` delegate/schedule/taskSummary/missing-session fallback; `ledger.ts` task state/continuation and snapshot v12; `mcp-bridge.ts` current tool schema; `recovery.ts` queued restart interruption; `packages/core/src/session/events.ts`, `context-window.ts`, `teams/developer/catalog.ts`, `config/deck-config.ts`; the three adapter `session-driver/mapper.ts` files and OpenCode `session-driver/driver.ts` correlated response handling.

Graph project deck generation 2026-08-20T17:25:00Z was stale for session-host/adapters (`not_tracked`), config metadata changed; material claims use direct reads. Installed-binary/schema observations from the architect are supporting evidence, not proof of all provider normalization paths. Missing native fixtures remain explicit implementation verification gates, with fresh behavior until verified.
