# Candidate progress

## Attempt 1 — incomplete, not ready for migration

Owner: apply-deep `task-a47ce13f-72f3-43c8-ab6c-87593818f50d`. Reviewed original result/ended events 92338/92339. Source report: `/tmp/native-runner-package-retirement-implementation/implementation-report.md`.

Partial candidate includes global Codebase Memory selection, retired content/catalog changes, contribution manifests, cleanup planning/review and managed-turn search resolution. These are not individually certified complete. Build/typecheck are reported passing. Lead inspected the broad log/index: **3448 pass, 180 fail, 1 skip**; failures are not fully classified and must not be dismissed as baseline.

Open requirements:

1. Native developer launches for Codex/Claude/OpenCode lack a proven per-turn effective search recomposition boundary. Do not route through session-host or change lifecycle merely to meet this requirement without approval. Investigate supported native mechanisms while the implementation owner closes independent gaps.
2. Complete A9 accounting and recovery audit across install/update/repair/remove, including external tool effects and shared physical artifacts. Current receipts are evidence of particular paths, not comprehensive proof.
3. Claude immutable plugin generations are preserved until active-reference/replacement safety is implemented. This is temporary incomplete behavior, not the approved final retirement policy.
4. Classify and resolve all affected broad-suite failures, retaining security fixtures under explicit opt-in. No blanket test deletion or snapshot update to manufacture green.
5. Cleanup root resolution must match effective install paths. Direct inspection found `cleanupRoots` ignores `OPENCODE_CONFIG_DIR`; audit other overrides and config-read locations too.
6. Live summaries report successful real tool/search/explicit RTK runs in all four runners. Automatic RTK interception is not verified. The digest covers one module and tests predate later deltas; tie final evidence to a full candidate identity and rerun invalidated checks. Do not claim RTK integration unchanged from executable invocation alone.

Preliminary read-only plan exists at `/tmp/native-runner-package-retirement-implementation/real-installation-plan-lead.json`. It reports thousands of shared Serena installation leaves under Codex and deferred Claude generations. It is neither a verified complete migration plan nor approval to apply. Produce a readable grouped summary plus exact leaf/entry details after root and coverage corrections. No actual installation migration is authorized before presentation/review, and no ambiguous entry is confirmed.

## Follow-up assignments

- Same implementation owner accepted continuation for regression classification/fixes, manifest/recovery completeness, Claude references, effective cleanup roots and final evidence. No scope or live-installation authority expansion.
- Same investigator `task-1cf2011b-0318-4587-84f5-47cef713f609` accepted a bounded read-only continuation on native per-turn APIs. Must distinguish detection from actual tool recomposition and return supported minimal options; no speculative lifecycle reroute.
- Attempt 1 review is recorded as blocked (acceptance incomplete), evidence 92338/92339. Independent final quality review follows a functional candidate; no acceptance checklist is marked complete from these partial reports.

## Native API investigation — attempt 17 not accepted as conclusive

Read investigator result/ended 93510/93511 and `/tmp/native-runner-package-retirement/native-per-turn-feasibility.md`. The statement that none of Codex/Claude/OpenCode supports dynamic tool/MCP composition is not established. The investigator inspected hook signatures and only part of Claude's long reference; no live probe was performed.

Primary counter-evidence reviewed by Lead: [OpenCode server reference](https://opencode.ai/docs/server/#lsp-formatters--mcp) documents `POST /mcp` to add a server dynamically. [Plugin reference](https://opencode.ai/docs/plugins/#basic-structure) exposes an SDK client to plugins. This does NOT prove turn-local timing, suppression, safe concurrent-session isolation or compatibility with the installed release. Those are the actual remaining questions; a missing mutation field in hook output is not proof that no native API exists.

Do not implement the report's proxy recommendation: per-call redirection is not the approved per-turn capability selection, preserves duplicate tool exposure, and increases the maintenance the user wants to remove. No criteria are relaxed and no lifecycle reroute is approved. Same investigator will check the omitted dynamic APIs, configuration reload/tool-change contracts and bounded isolated evidence. The implementation owner continues independent previously assigned fixes.

## Native API investigation — attempt 18 partial

Reviewed 94628/94629 and `/tmp/oc-mcp-probe/mcp.js`, startup log and updated feasibility report. The investigator withdrew the blanket impossibility claim. It reports OpenCode 1.19.1 add/disconnect/connect behavior scoped to directory instances, with another directory observing no server. Lead could inspect the fixture but not re-query the stopped server; exact response artifacts and tool-snapshot timing are still needed. Types inspected were 1.18.19, not the installed 1.19.1. This is not yet proof of safe per-turn session isolation.

Codex and Claude native-CLI reachability checks were explicitly not completed. Lead separately checked the official [Codex app-server reference](https://developers.openai.com/codex/app-server): `config/mcpServer/reload` queues refresh for loaded threads and `mcpServerStatus/list` supports a thread ID. This proves a control-plane operation exists, not that an arbitrary native CLI hook can call it safely. Claude's SDK MCP reference and hook reference are distinct surfaces; SDK functionality must not be attributed to native hooks without evidence.

The same investigator is tasked with completing those missing bounded checks, retaining raw sanitized probe results and version-specific source locations. No acceptance relaxation or proxy is approved. Implementation owner remains active on independent corrections.

## Native API investigation — attempt 19 reviewed with limits

Reviewed original result/ended events 95930/95931, `/tmp/native-runner-package-retirement/native-per-turn-feasibility-attempt19.md`, tagged Codex startup/hook source, and `/tmp/oc-mcp-probe/logs/api.log`. Integration is blocked because the full native per-turn criterion remains unproven. This supersedes any categorical impossibility statement from earlier reports.

- Codex 0.162.1 default TUI starts an in-process app-server client; hook commands inherit an environment snapshot. The inspected path exposes no hook control channel for MCP reload. This is source evidence, not a live impossibility proof.
- Claude 2.1.301 evidence remains documentation-only and incomplete. SDK control methods must not be attributed to native CLI hooks. An already-connected MCP server can announce tool-list changes; introducing such a dynamic Deck server is not the approved minimal design.
- OpenCode 1.19.1 retained HTTP responses prove dynamic MCP connection and different permission rules for two newly created sessions. MCP mutation is instance-wide. Existing-session per-turn permission updates and concurrent-session safety remain unverified. A possible solution may suppress only Deck-owned fallback tools, never user/native tools or existing user permission rules. The live probe did not invoke a model or exercise tool execution.

### Pending product decision: direct native CLI boundary

Proposed, NOT approved: select search at launch/reopen for direct native Codex/Claude developer CLI sessions. Changes to effective provider/model/search configuration during an open CLI would require reopening it for search selection to be reevaluated. Keep the approved per-turn requirement for Deck-managed members and other native paths; those paths still require final verification.

This is an explicit acceptance change, proposed to avoid introducing a proxy or changing native CLI lifecycle. It must not be implemented or marked accepted without the user's answer. The original criterion remains authoritative while pending. Independent implementation fixes continue under the existing authorization; no real installation migration is authorized.

Session decision registration was attempted with command `native-retirement-native-cli-boundary-122-v1` and originating user prompt `ed46b7ba-44d7-45d1-9617-84b8d97d6eaa`; the host rejected it as `decision-source-invalid`. This persisted question does not substitute for user approval or claim a successfully registered host dependency.

## Interactive exception approved — 2026-10-23

The user's genuine follow-up explicitly approves and supersedes the pending product question above. A6, design section 6 and tasks 4.4–4.5 now record the exact limits:

- Direct interactive Codex, Claude and OpenCode: launch/reopen selection only.
- Deck-managed cross-runner members: selection every turn. OpenCode starts a serve process per turn, so process-launch selection is sufficient; dynamic MCP APIs and shared-instance isolation are not required for this change.
- If effective configuration changes while an interactive CLI is open, warn at the next doctor or next-session-opening review that the existing CLI must be reopened. This does not require continuously observing or restarting the process. Pi has no new exception.
- Real-installation migration remains unauthorized pending presentation/review of the concrete plan; ambiguous entry deletion still needs individual confirmation.

Implementation owner remains apply-deep task `task-a47ce13f-72f3-43c8-ab6c-87593818f50d`, attempt 2 running when the approval was received. These approved requirements replace the prior native per-turn investigation blocker and are the next candidate delta for that same owner. No new implementation owner or speculative native API investigation is needed. Session decision list is empty because prior registration failed; no host decision resolution is claimed. The user's explicit approval is recorded here as official scope authority.

## Attempt 2 interrupted — activity verified, candidate not accepted

Attempt 2 was interrupted at 2026-10-23 11:42:40 UTC (events 100137/100138). Its saved result is the last progress message, not a final completion report. Ledger events confirm edits to contribution accounting at 11:36:10 UTC (99677), a Pi test at 11:39:34 UTC (99886), and a progress message at 11:42:27 UTC (100097), approximately 13 seconds before interruption. This establishes recent work, not a hung task at that moment.

The progress message claims successful isolated tool/search/RTK runs in all four runners, automatic RTK evidence in Claude/Pi, 706 passing OpenCode tests and 18 accounting checks. Those outcomes have not yet been independently reviewed. The candidate remains incomplete; the approved interactive exception and stale-review behavior must be checked on continuation. Preserve existing edits and reuse the same owner/task if resumed. No automatic restart was issued in response to this interruption notice; real migration remains gated on plan review.

## User-authorized resumption — 2026-10-23

After the user explicitly requested resumption, Deck accepted continuation of the same apply-deep task `task-a47ce13f-72f3-43c8-ab6c-87593818f50d`. Updated structured acceptance NRP1–NRP5 includes the approved direct-interactive exception, cross-runner per-turn selection (OpenCode serve launch), and both stale-configuration review entry points. The owner must first verify interrupted files/processes and reuse valid prior evidence, then finish the same candidate and return the exact read-only migration plan. No native API reinvestigation, new implementation owner, real-installation migration or unrelated lifecycle change is authorized by this resumption.

## Attempt 3 — functional candidate under independent review

Reviewed original report events 102863/102864 and `/tmp/native-runner-package-retirement-implementation/implementation-report-resume.md`. Candidate identity: `561d877e3e472f15a4998597818e8cb3d2ccf1b7d5da72f175e4d4b0219c9420`; detailed hashes and live-evidence reconciliation are beside that report. Lead inspected interactive search review and Claude publication source, and passing log tails (68 search checks, 60 bounded checks, 30 accounting checks; overlapping runs, not additive totals). Exact-path graph coverage was untracked on the new files; direct source was used. Candidate integration is not final acceptance or release approval.

The candidate includes direct-interactive launch/reopen search and stale-configuration diagnostics; managed members retain per-turn selection. Reported broader failure reconciliation closes 179 of 180 initial failures; the remaining continuity-default assertion is claimed unrelated and still requires baseline corroboration. Real Codex/Claude/OpenCode checks were refreshed; Pi/RTK evidence is retained with branch-specific reconciliation. Quality must assess whether retained evidence is sufficient, not equate all checks with final-binary executions.

Read-only plan: `real-installation-plan-resume.json`; grouped review: `migration-review-resume.md` in the same temporary report directory. Proposed removals: Claude 30, Pi 3, Codex/OpenCode 0. Five shared entries need individual confirmation (Codex 3, OpenCode 2). There are 14,146 preserved entries, including 13,015 shared Serena leaves with surviving/unreviewed references and three current Claude generation entries. No claim of complete cleanup or migration permission follows from this plan.

Independent quality task `task-cb998de2-d7fa-4b64-8839-23149762ad88` is accepted for this new package-retirement area. Scope: A1–A12, final interactive exception, ownership/accounting/recovery and live-evidence limits; no source/OpenSpec edits or real installation writes. Original implementation owner remains responsible for any corrections. Real migration remains pending concrete-plan review and separate ambiguity confirmations.

## Independent review 1 — changes required

Reviewed quality events 104535/104536, `/tmp/native-retirement-quality/review.md`, three reproduction logs and exact production source. Accepted five blocking findings, registered as structured blockers on the same implementation task:

| ID | Finding | Required correction |
| --- | --- | --- |
| NRP-Q001 | Adjacent grouped removals leave a trailing comma in strict JSON. | Combined-selection separator handling, strict-format validation and manifest/retry regression. |
| NRP-Q002 | TOML previews expose nested credentials because text bypasses key redaction. | Redact parsed display values independently of exact mutation bytes/hashes; regenerate safe plans. |
| NRP-Q003 | OpenCode interactive composition omits project authority admission and injects fallback despite a trusted project deny. | Consistent effective project/override admission in launch and stale review; check analogous Codex/Claude paths without blindly trusting projects. |
| NRP-Q004 | OpenCode rollback restores files but leaves updated contribution hashes, preventing retry. | Coordinate receipt/file rollback while preserving unrelated receipts and intervening user edits. |
| NRP-Q005 | Claude launches its existing Deck CBM plugin after explicit capability opt-out. | Reconcile global and runner capability intent before launch with verified replacement or actionable block. |

Reproductions used temporary installations and synthetic credentials, not a real denied search or real migration. The candidate and saved migration preview are not approved for delivery/apply. Existing test passes did not cover these cases. Independent isolated HEAD evidence confirms F132 predates this candidate; it remains unresolved but is not added to this scope.

Continuation accepted for the same apply-deep task with all five blockers. Reuse original reproduction scripts, run checks invalidated by repairs, regenerate redacted plan and candidate identity, then return to the same quality owner for independent recheck. No findings are closed yet; no real installation migration or ambiguous-entry removal is authorized.

## Paused at user request — 2026-10-23

The user requested a pause. Lead stopped implementation task `task-a47ce13f-72f3-43c8-ab6c-87593818f50d`; attempt 4 is confirmed cancelled (result/ended 105916/105917). Preserve all current edits. Its last progress message reports partial corrections/tests but is not a final report or independent verification. NRP-Q001–Q005 remain open. No continuation, verification or migration proceeds until the user resumes work.

## Resumed after explicit user instruction

The user explicitly authorized continuation. The pause is lifted and Deck accepted continuation of the same implementation task `task-a47ce13f-72f3-43c8-ab6c-87593818f50d`, preserving inherited acceptance and all five open blockers. The owner must verify interrupted file state, finish remaining corrections, reuse valid evidence and return updated candidate identity and a redacted exact plan. Independent recheck remains with quality task `task-cb998de2-d7fa-4b64-8839-23149762ad88`. The real-installation migration/confirmation boundary is unchanged; resumption does not authorize applying the plan.

## Attempt 5 — correction candidate sent for independent recheck

Reviewed original events 107974/107975 and `/tmp/native-retirement-fixes/report.md`. Candidate `7378c57cee61941701ab3307333037d55d8e31c5befacfc6400080c447776de4` includes the preserved attempt-4 fixes and final deltas. Lead inspected original-reproduction logs showing valid JSON, no synthetic TOML credential in preview, no fallback overlay for the project deny, matching rollback receipts and successful retry, and blocked Claude launch after CBM opt-out. Inspected passing edge (23) and override-review (11) log tails and direct retirement/Claude guard source; graph coverage remains untracked on these new paths.

This accepts the corrections as a candidate, not verified closure of NRP-Q001–Q005. Same quality owner/task accepted continuation to independently re-run original oracles and check affected trust, rollback, JSONC and launch regressions. The report records a pre-existing OpenCode installer JSONC parser limitation separately from retirement JSONC support; quality must assess that boundary. F132 retains the previously established baseline classification.

Regenerated plan and grouped review: `/tmp/native-retirement-fixes/real-installation-plan.json` and `migration-review.md`. Counts remain 33 proposed proven removals, five conditional entries and 14,146 preserved entries. All 14,157 unique preimages reportedly matched at generation. No migration/confirmation occurred; real installation changes remain unauthorized pending plan review. Retained model/RTK evidence is explicitly earlier source-candidate evidence, not new final-binary execution.

## Independent review 2 — four resolved, Q002 residual open

Reviewed original quality events 109631/109632. Independent unchanged repros and 52 affected tests plus one Claude memory regression support closing NRP-Q001, Q003, Q004 and Q005; Lead recorded those four structured resolutions with this review and prior correction evidence. No whole-delivery acceptance follows.

NRP-Q002 remains blocking: a split sensitive flag/value pair in an MCP argument array exposes the value in preview, serialized plan, console and output artifact. Lead checked `redact` array recursion and confirmed the synthetic marker in `/tmp/nrp-quality-cli-secret-gWmvMh/plan.json`; no real credential was used. Nested environment redaction is fixed, but general argument handling is incomplete.

Same implementation owner accepted a narrow correction for contextual secret argument redaction, preserving entry identity and exact mutation bytes/ranges/hashes. Targeted regression tests, regenerated safe read-only plan and candidate identity are required before the same quality owner rechecks Q002. Real migration remains unauthorized, and no unresolved-reference cleanup or full final-binary live-verification claim is made.

## Attempt 6 — narrow Q002 candidate under recheck

Reviewed events 110629/110630 and `/tmp/native-retirement-q002/report.md`, contextual redactor source, 27 passing test log and original-fixture CLI oracle. Source and compiled CLI runs report the synthetic operand absent from console/JSON artifacts while retaining exact mutation identity. Only runtime delta since the prior candidate is the shared display redactor; two affected test files also changed. Candidate `b7f9507edaa0e7231dc6fb055b1644285c591fd0c5b40453ec4cb9738c7d8237` and detailed evidence are in that directory.

Same quality task accepted a narrow independent continuation to rerun the original Q002 oracle and affected regressions. Q002 remains open until that review; Q001/Q003/Q004/Q005 stay resolved. Regenerated read-only plan retains 33 proposed proven removals, five conditional entries and 14,146 preserved entries. No real migration, ambiguous-entry confirmation or new live-model claim was made; retained earlier source-candidate evidence remains explicitly distinguished.

## Independent review 3 — Q002 quoted-fragment residual

Reviewed events 111672/111673, exact redactor source and the isolated `/tmp/nrp-q002-quoted-cli-g37hfyay/source-console.json` artifact. Original split argv reproduction is fixed, but a quoted sensitive option inside a shell script argument leaks its synthetic credential through planner and source/compiled CLI outputs. Q002 remains blocking; prior four closures stand.

Same implementation owner accepted a bounded correction using conservative opaque-shell/code-fragment display, instead of accumulating quote-specific credential regexes. Hide uncertain argument values while retaining nonsecret entry identity and exact raw mutation ranges/selectors/hashes. Require both original split and quoted CLI oracles, focused policy regressions and regenerated safe plan/identity. No new shell parser, model-run suite, real migration or ambiguity confirmation is authorized or necessary for this delta.

## Attempt 7 — conservative display candidate under recheck

Reviewed events 112709/112710, `/tmp/native-retirement-q002-opaque/report.md`, shared redactor source and 43-pass focused log. Argument contents are hidden by default, command arrays retain only a simple executable, and opaque strings with shell/code syntax are hidden completely. This intentionally also hides nonsecret arguments; runner/path/MCP selector/simple executable identity remains for review. Exact mutation identity stays separate. Candidate `8f36c190064b49a496d79960d54ecaae5acbbb03f03dfedc5e60f0fce9fcee22` is accepted for independent recheck, not finding closure.

Same quality owner accepted continuation for both unchanged original CLI oracles and affected display/mutation regressions. Q002 remains open; the other four findings remain resolved. New plan artifacts in the same directory retain 33 proposed removals, five conditional entries and 14,146 preserved entries, with display-only differences. No real migration or new final-binary model verification is claimed.

## Independent review 4 — all reported blockers resolved

Reviewed events 113530/113531, independent 43-pass log and original quoted CLI oracle under `/tmp/nrp-q002-independent-k813oyzp/`. Both unchanged original fixtures pass all eight source/compiled CLI routes with synthetic secrets absent and raw mutation identity preserved. Lead recorded structured closure of NRP-Q002; Q001–Q005 are now resolved. This does not claim exhaustive A1–A12 closure, new final-build model execution, or a completed legacy migration.

The concrete read-only plan presented for user review remains `/tmp/native-retirement-q002-opaque/real-installation-plan.json`, with grouped detail in `migration-review.md`. Its 33 ownership-proven proposed edits remove context-mode, Serena and disabled Codebase Memory MCP entries from ten unselected Claude generation `.mcp.json` files (30 entries) and Pi's `~/.pi/agent/mcp.json` (three entries). Apply must revalidate exact preimages and generation references.

Five ambiguous shared entries remain preserved absent separate individual confirmation: Codex `config.toml` context-mode/Serena/codebase-memory and OpenCode `opencode.json` context-mode/Serena. The current Claude generation and shared Serena installation remain preserved until verified replacement/reference release and a fresh plan. No current proof permits claiming a fully clean installation.

Pending user decision: authorize only the 33 ownership-proven edits in this reviewed plan, leaving all five ambiguous entries and preserved resources untouched. This is a limited cleanup stage, not authorization for replacement publication, canary install, daemon restart or complete migration. The existing user requirement to review the real plan before application is the reason for this confirmation boundary. No migration has been applied.

## Limited real apply approved; new publication gates

The user's next genuine message explicitly authorizes only those 33 removals with revalidation, then individual review of the five ambiguous entries. This answers the pending question above. Permission persists; do not ask again for the same exact stage. The same message forbids migration while daemon sessions/turns execute. `deck_status` confirms this session and Lead attempt 138 are running, so the operation is deferred under that instruction. No mutation, delayed background apply or self-interruption was performed. A race-safe idle boundary must precede real execution.

Recorded A13–A17 and tasks section 6 as mandatory publication conditions. User installation evidence is only one sample. New coverage must generate relevant published historical installations in isolation/CI, cover interactive versus non-interactive/daemon behavior and doctor reporting, enforce active-work deferral, retain public read-only planning/backup/recovery and add changelog guidance.

Read current Claude selection/publication and generation-reference source: selected generations remain protected; replacement selection directs new launches to the new generation, while existing processes/receipts/recovery may retain the old one. A later fresh plan can collect retired contributions only after those references are gone. Generic binary update is not proof of that sequence. This clarification does not authorize publishing a replacement on the user's machine yet.

The exact authorized subset is frozen in `approved-local-removals.json`: 33 entry IDs, paths/selectors, ownership, original preimages/ranges, and source-plan digest. This records consent only, not application. Same implementation owner accepted continuation for A13–A17 with structured acceptance covering historical CI, mode wiring, migration admission, public plan/recovery and changelog. Real-machine changes are explicitly excluded from the active delegated turn; the owner must return a safe idle execution path rather than schedule an unguarded background apply.

## Resumed publication verification — attempt 8 reviewed as partial

The user explicitly requested resumption. Lead retrieved attempt 8 (events 116667/116668), read `/tmp/native-retirement-publication/report.md`, inspected focused verification log tails and the frozen-authorization comparison, and recorded partial/blocked integration 117296. Candidate identity is `6531fb57892fd4f36f7c290e4a5bc9462e3e3b2c172f011b25162ca077255a6e`. A14–A17 have implementation candidates; this is not independent acceptance. A13 remains incomplete: the current matrix exercises historical content installation, not the required full package effects, preservation/recovery and migrated RTK/search proof. Passing focused tests and build do not close those gaps.

Accepted continuation with the same implementation owner/task for A13 historical harness, fixture and CI completion. Accepted continuation with the same quality owner/task for independent A14–A17 runtime review, including admission safety and liveness, update modes, doctor, planning/recovery and Claude/Pi upgrade behavior. Quality is read-only; the implementation owner must identify any concurrent runtime changes for review reconciliation. Lead remains the sole OpenSpec writer.

The real installation remains untouched. The frozen 33-entry authorization still matches the read-only plan and remains valid, but application is deferred during active work; the five ambiguous entries remain individually unapproved. No background migration, restart, canary installation or release publication is authorized by this resumption.

## Quality startup failure — bounded retry

Retrieved quality attempt 5: terminal event 117509 records `codex-startup-failed`, with no native session or review report. This is an execution failure, not a finding against the candidate; the deeper cause is not established by that record. Lead recorded blocked integration and accepted one continuation of the same quality task, explicitly updating structured acceptance to A14–A17. Implementation attempt 9 remains running. No real installation action occurred; publication and active-work migration gates remain unchanged.

## Independent review 6 — A14–A17 corrections required

Lead retrieved events 120264/120265 and checked the cited production source and isolated reproduction scripts. Accepted three findings; prior Q001–Q005 closures stand. Quality reports 53 passing focused tests and stable identity across 1,232 runtime files, but those tests do not cover the following failing scenarios:

- **NRP-Q006 (P1, open):** public `deck rollback --backup` and automatic orchestrator rollback reach `rollbackBackup`/`restoreBackup` without coordinated idle admission. Runner configuration can be restored while daemon work is active. Guard the actual restore path and preserve recovery/update state when deferred.
- **NRP-Q007 (P1, open):** cleanup checks contribution `.pending` before user review, but confirmation mutates without rechecking it inside admission. A different operation can leave recovery pending during review. Revalidate pending recovery before every mutation while holding admission. Original reproduction: `/tmp/nrp-a16-pending-repro.ts`.
- **NRP-Q008 (P2, open):** doctor only queries activity when the lock exists; offline history can report OK although mutation admission treats it as unknown. Align read-only diagnostics with that deferral, without starting the daemon or changing state. Rollback/doctor reproductions: `/tmp/nrp-a14-a17-quality-repro.ts`.

Implementation task `task-a47ce13f-72f3-43c8-ab6c-87593818f50d` attempt 9 is still running its A13 historical work. Preserve that execution; the same owner must receive these three structured blockers on its next continuation. Do not create a competing implementation owner or claim the running member has consumed this feedback. Independent recheck remains with the same quality task. Publication and real apply remain blocked; no user installation was modified.

## Attempt 9 — partial historical evidence; safety corrections dispatched

Reviewed events 122404/122405, `/tmp/native-retirement-publication-a13/report.md`, 62-pass affected log, supplemental npm-layout migration evidence and unchanged frozen33 comparison. Candidate `1cf6001bcee9368c2d3b302093286f37791b20d2cc81134e7ac07517bb812d76`, runtime `0625aeb519f364f326a6a36dc376b0747d76824fb6cf5a7e65934789bd03cf40`. Eight applicable runner/version combinations now have scoped historical exercises, with actual package effects distinguished from content-only or fixture-authorized replacement. The remaining 85 applicable combinations and Serena/CBM variants, legacy native installer effects, OpenCode RTK and remote search evidence remain publication blockers. CI fails closed; this is not A13 acceptance.

Actual npm installation exposed a dangling executable link and package-lock records. The candidate now plans those exact retired contributions inside Deck-owned roots while retaining neighboring dependencies. This narrow runtime delta requires reconciliation in the next independent review; historical snapshots plus supplemental tests are not a full final-candidate matrix pass.

The same implementation task accepted continuation with structured blockers NRP-Q006, Q007 and Q008. Correct these bounded safety/diagnostic issues first and return focused tests and source identity for the same quality owner. A13 remains authorized and pending after that checkpoint; do not rerun the complete matrix until known harness gaps are resolved. Prior Q001–Q005 closures remain intact. Real installations remain unchanged; frozen33 is still deferred during active work and ambiguous5 is still unapproved.

## User-requested pause after current execution

The user requests that the current implementation execution finish, then all work pause so they can restart and test other features. Do not interrupt the running member. On its terminal outcome, retain its report and record the paused state; do not launch further review, correction, matrix runs or continuation until the user explicitly resumes. This restart/testing pause does not authorize migration, installation or configuration changes. The frozen33 and ambiguous5 boundaries remain unchanged.

## Resumed after restart/testing pause — attempt 10 candidate retained

The user explicitly lifted the pause and reported unrelated intervening work. Lead retrieved attempt 10 (124167/124168), read `/tmp/native-retirement-q006-q008/report.md` and original green reproduction logs, and confirmed that all ten correction paths still match `changed-paths.json`. Other workspace changes are preserved; this bounded comparison does not certify the whole tree.

Q006–Q008 have a correction candidate (reported 151 distinct affected tests, typecheck and compiled CLI checks); none is closed yet. Same quality owner/task accepted independent recheck, including the earlier npm link/lock delta and the separate reproducible stale-marker reclamation interleaving. That race remains an A15 risk pending explicit assessment. No new broad matrix run or implementation claim accompanies resumption.

A13 remains incomplete with the previously recorded historical variants, installer/RTK/search evidence and 85 unexercised applicable combinations. The same implementation owner remains responsible for subsequent corrections. Frozen33 remains authorized but deferred during active work; ambiguous5 remains individually unapproved. No real migration, restart, canary installation or release was performed as part of this resumption.

## Independent review 7 — Q006–Q008 closed; Q009 correction dispatched

Reviewed quality events 126840/126841, the original green evidence, current marker source and `/tmp/nrp-stale-marker-startup-repro.ts`. Lead recorded structured closure of Q006–Q008 (integration 127013). The bounded independent review also found no additional blocker in the npm lock/link delta. Quality reports 118 passing affected tests and preserved correction-path hashes; 71 other captured runtime paths differ from the supplied snapshot, so this is not whole-workspace certification.

**NRP-Q009 (P1, open):** a stale reader deletes a replacement owner's live runner-mutation marker. The production-startup reproduction grants maintenance, resumes an older starter, loses the reservation, then accepts new work before the maintenance callback ends (`reservedBefore=true`, `reservedAfter=false`, `newWorkOutcome.ok=true`). Ownership validation/deletion must be serialized against replacement acquisition; a second unprotected read alone does not establish correctness.

Same implementation owner/task accepted a narrow continuation with Q009 as a structured blocker and deterministic startup/admission regression requirements. Preserve prior closures and unrelated edits. A13 historical/functional gaps remain pending and publication remains blocked. Real migration, ambiguous entries, restart/install and release boundaries are unchanged.

## Attempt 11 — Q009 serialized-marker candidate under independent recheck

Reviewed events 128183/128184, `/tmp/native-retirement-q009/report.md`, current guard/acquire/reclaim/release source and original-green/lifecycle evidence. Same quality owner accepted independent recheck. Q009 remains open pending that result; Q001–Q008 stay closed absent regression.

The candidate uses one atomic directory guard across reservation creation, stale-owner validation/deletion and owner-specific release. The original startup oracle now preserves the live reservation and rejects new work. Reported verification is 120 focused cases; the 93 adjacent cases precede the last observed-owner comparison, while the 27 lifecycle cases and startup oracles were rerun afterward. This distinction remains part of review scope.

An interrupted guard fails closed and requires independently established offline recovery; cleanup can also fail after an admitted callback has made effects. Quality must assess those recovery/liveness and diagnostic limits explicitly. Candidate digest `d93a01c80be9f5cb7fb71a37c6d5205476ec6599f81cc26ff5b1121e65ef377f`; only the five paths listed in `changed-paths.json` belong to this correction. Other workspace edits are preserved. A13 remains pending; no real migration or publication is performed.

## Independent review 8 — Q009 closed; recovery follow-ups required

Reviewed events 129675/129676, `/tmp/nrp-q009-quality-residual.ts`, current finalizer/sync catch and doctor guidance. Lead closed Q009 narrowly: the original startup oracle and independent lifecycle checks preserve the live reservation and prevent new work. Quality reports 67 focused passes; unchanged five correction hashes and a stable captured-runtime comparison bound that evidence. Q001–Q009 are now resolved; this does not complete A15/A16 or publication.

Two structured P2 blockers were dispatched to the same implementation owner:

- **NRP-Q010:** cleanup failure after execution is reported as pre-admission deferral; runner sync loses completed file/manifest/backup accounting. Distinguish the phases, retain operation results and original errors, and never replay effects automatically.
- **NRP-Q011:** an orphan guard fails closed but recovery guidance lacks its exact path and an actionable documented offline procedure. Provide explicit quiescence requirements and preserve recovery evidence; elapsed time does not authorize deletion.

The correction remains bounded to recovery semantics, diagnostics/documentation and focused regressions. A13 historical/functional work remains pending. No user installation mutation, ambiguous-entry approval, restart or publication occurred.

## Attempt 12 — Q010/Q011 candidate under independent recheck

Retrieved events 131211/131212; reviewed `/tmp/native-retirement-q010-q011/report.md`, correction delta and lifecycle/typecheck logs. A distinct post-admission cleanup error now carries the settled callback outcome and cleanup error; sync/orchestrator retain completed/partial accounting and recovery references. Doctor/documentation provide exact coordination paths and offline recovery conditions. Same quality owner accepted bounded independent recheck; Q010/Q011 remain open and Q001–Q009 remain closed absent regression.

The implementer reports 94 distinct focused tests passing. Final full typecheck records TS2352 in concurrently edited `packages/session-host/src/__tests__/quota-daemon.test.ts`, outside the correction's eight owned paths. Scoped typecheck excludes that file and passes; this is not a clean full-workspace result. Preserve unrelated work and verify attribution rather than modifying it incidentally. Correction-path digest: `da8965dfb9b036ceec787771b80956bfc47f056d0a9fc906ea991b70bb8c3af6`.

A13 historical and functional coverage remains pending. No broad matrix, real installation operation, migration, restart or publication was performed. Frozen33 remains deferred during active work; ambiguous5 remains unapproved.

## Independent review 9 — Q011 closed; Q010 retry persistence remains blocking

Reviewed events 133038/133039, `/tmp/nrp-q010-quality-retry.ts`, the orchestrator's operation replacement/finalization/retention paths and offline recovery documentation. Lead closed Q011: exact-path guidance is actionable with independent quiescence, empty-directory-only removal and preservation requirements. Q001–Q009 closures stand.

Q010's immediate result/error retention passes the bounded independent recheck, but later updates overwrite its retained active operation. A deferred retry clears the original recovery reference; by the fifth retry retention deletes its backup, while runner writes remain at one and the guard still exists. Same implementation owner accepted continuation of the existing Q010 blocker to preserve unresolved operation/backup state across retries and reloads, without replaying completed effects or permanently preventing legitimate recovery.

Quality reports 90 distinct affected tests passing, with the separate 22-test sync rerun resolving a combined-run error. Current full nonincremental typecheck passes; this supersedes the earlier recorded concurrent failure for that reviewed workspace only. The eight correction hashes remained stable. A13 is still incomplete, and real migration/publication remain deferred.

## Attempt 13 — Q010 persisted-recovery candidate under recheck

Reviewed events 134301/134302 and `/tmp/native-retirement-q010-retry/report.md` plus its two-file exact delta. New updates refuse a persisted backup-bearing active operation before descriptor processing, backup creation or finalization. The original oracle now exits on explicit `UPGRADE_RECOVERY_REQUIRED`; its nonzero exit is not presented as a passing run. Separate assertions and new regressions cover seven persisted refusals, unchanged recovery artifacts and one apply, then explicit admitted recovery and a clean idle retry.

Same quality owner accepted independent recheck. Reported verification is 95 focused tests and full typecheck on Bun 1.4, not pinned release verification. Correction-path digest `2d303e53d3ac5c8033d0fa9945fbd5326b2d97162debd8c805633dbf98dfe3d2`. Q010 remains open; prior closures stand. A13 historical/functional gaps and real migration/publication boundaries are unchanged.

## Independent review 10 — Q010 closed; postimage-preserving recovery required

Reviewed events 135869/135870, `/tmp/nrp-q010-user-edit-recovery.ts`, unconditional whole-file restoration in `restoreBackup`, and design section 8. Lead closed Q010: independent repeated/fresh-process/forced retry cases retain recovery state and backups without replay, and explicit recovery permits a clean retry. Quality reports 95 focused passes and full typecheck on Bun 1.4; no pinned-release or A13 closure follows.

**NRP-Q012 (P2, open):** newly recommended forced recovery reaches pre-existing unconditional restoration, replacing later user edits and clearing the operation. The public isolated repro changes `later user edit` back to `original` and exits successfully. This conflicts with the approved requirement to restore only transaction-owned content matching the applied postimage and preserve newer edits.

Same implementation owner accepted this structured blocker, with bounded postimage-aware recovery, durable trustworthy mutation evidence and preservation of unresolved state for drift/unknown cases. Reuse existing backup/receipt infrastructure; do not add a parallel migration system or broaden destructive force. Q001–Q011 remain closed absent regression. A13 and real migration/publication gates remain open; no user installation was changed.

## Attempt 14 — Q012 postimage-aware recovery under independent recheck

Reviewed events 137620/137621, `/tmp/native-retirement-q012/report.md`, original public GREEN and regression delta. The unchanged public oracle preserves the later edit, exits with a conflict and retains the original recovery operation/backup. Same quality owner accepted review of the postimage capture, admitted post-retirement snapshots, partial writes/restoration, path checks, real adapter composition and recovery-state boundaries. Q012 remains open; prior Q001–Q011 closures stand absent regression.

The candidate reuses backup entries for planned output and file/path identity evidence, refuses unknown/drifted recovery and accounts completed restoration for retries. Nine owned paths are identified in `source-identities.json`; exact delta SHA256 `8d72380c10205b87b75d414fc72a9bb2d516a50ac87aecd1df7724e00e106e63`. Implementer reports 301 distinct passing tests across combined and separate runs plus typecheck; the combined command still has a reproduced baseline generated-asset loader failure and is not called green. A13 and pinned release checks remain pending. No real installation operation or new migration authority follows.

## Independent review 11 — Q012 actual-adapter recovery gaps

Reviewed events 139246/139247, the runner-sync capture list and isolated real-adapter evidence in `/tmp/nrp-q012-quality-{opencode,codex,claude,pi-manifest,pi-after-plan}.json`. The original later-user-edit overwrite is corrected, but Q012 remains blocking: Codex/OpenCode capture relative plan paths at the wrong physical location; Claude selection metadata and Pi ownership receipts are omitted from recovery. Public rollback can report success while retaining updated files, selecting a deleted Claude generation, or causing Pi ownership conflicts on the next plan.

The same implementation owner accepted a bounded continuation covering physical targets and consistent transaction-owned content/metadata restoration through existing backup/adapter mechanisms. Require actual adapters with backupId and public rollback, subsequent readiness/replan, drift preservation and unrelated-contribution preservation. Quality reports 120 focused passes across separate runs; these do not establish the missing composition behavior. No new live-model, final-binary or pinned Bun verification follows. Q001–Q011 remain closed; A13 remains incomplete. Frozen33 is unapplied and ambiguous5 remains unapproved. No real installation, migration, restart or publication occurred.

## Resume after user pause — attempt 15 retained, Q012 still open

User explicitly resumed work. Reviewed cancelled attempt 15 (events 141162/141163): its last progress reports passing four-adapter failure-after-apply recovery, absolute backup source paths and typecheck, but cancellation interrupted the final evidence handoff. These claims are not independent acceptance. Same implementation owner resumed to verify the retained workspace/artifacts and finish the bounded Q012 delta, reusing valid checks. Independent review follows the completed candidate. A13 historical coverage remains pending; frozen33 remains unapplied, ambiguous5 unapproved, and publication is not authorized by resumption.

## Attempt 16 — retained Q012 composition candidate under independent review

Reviewed events 142538/142539, `/tmp/native-retirement-q012-composition/resumed-report.md`, physical-target/metadata capture in runner-sync, and completed verification receipts. No additional source edits were needed after resumption. Four actual adapters are exercised through backupId and public rollback in isolated roots: 14 tests pass, including clean restoration, later-edit refusal, failure after apply, and OpenCode receipt/legacy cases; typecheck passes. These are source CLI/Bun 1.4 fixtures, not live-model, historical A13, final-binary or pinned-release evidence.

Same quality owner accepted bounded independent recheck of the original physical-target and metadata/receipt failures plus affected preservation boundaries. Q012 remains open; Q001–Q011 closures stand absent regression. Source identity manifest SHA256 `b2d800ee65f3e2cdab6bb7d624c226cee88caf68cefed2c270122e8d22140b4c`; complete correction patch SHA256 `6ae89c2ab47115f4f9a69a1022b54093b536e3c19705fab96c87b516a0792563`. A13 remains pending. Frozen33 is unapplied, ambiguous5 unapproved; no real installation changes or publication occurred.

## Independent review 12 — Q012 closed; central recovery inventory remains

Reviewed events 144052/144053, rollback state finalization, orchestrator inventory publication, and `/tmp/nrp-q012-review12-inventory{,-claude}.json`. Lead closed Q012: independent original probes and four-adapter public composition verify physical targets, selection and receipts, readiness/replan, later-edit refusal and partial recovery. Quality reports 60 passing focused tests and stable identities; source CLI/Bun 1.4 fixtures only. Prior Q001–Q011 closures stand.

**NRP-Q013 (P2, open):** public rollback leaves the central Deck inventory at upgraded receipt hashes, or referencing a newly created receipt removed by rollback. Doctor then reports changed receipts for OpenCode/Codex/Pi or a missing receipt for legacy Claude although rollback exits successfully and clears recovery. This concerns existing rollback bookkeeping, not exclusively the preceding ten-file correction. Same implementation owner accepted a bounded transaction-owned inventory reconciliation with preservation of unrelated/later changes, failure/retry accounting and public rollback-to-doctor regression coverage. Do not mask drift by globally recalculating hashes.

A13 remains incomplete. Frozen33 remains unapplied, ambiguous5 unapproved; no real installation changes, restart or publication occurred.

## Attempt 17 — Q013 central inventory candidate under independent recheck

Reviewed events 145385/145386, `/tmp/native-retirement-q013-inventory/report.md`, exact inventory before/after capture and reconciliation source, and passing composition/retry/unit logs. The candidate records per-entry transaction evidence, reconciles only matching entries before clearing recovery, preserves unrelated/later inventory, and persists recovery on conflict/failure. Older backups require matching owner/postimage/checksum evidence before deriving a narrow delta; unknown evidence is refused.

Same quality owner accepted bounded independent recheck. Reported verification comprises 19 distinct public composition scenarios and 71 distinct focused cases across overlapping runs; production doctor manifest checks are exercised, not full external-readiness doctor CLI. Q013 remains open; Q001–Q012 remain closed absent regression. Six-file identities are in `source-identity.json`. A13 historical coverage and release checks remain pending. Frozen33 remains unapplied, ambiguous5 unapproved; no real installation or publication effects occurred.

## Independent review 13 — Q013 closed; A13 historical work resumed

Reviewed events 146660/146661 and independent public rollback/doctor and conflict/retry evidence. Lead closed Q013: original inventory probes now report no drift; exact prior-entry restoration, unrelated/later entries and top-level metadata survive; retry does not replay physical restoration. Quality reports 58 passing tests (19 composition and 39 backup/rollback), with six correction hashes matching and stable review snapshots. Reviewed digest `c63cbca31dfaa671cc6deba48237d1c42f4ef2a6e0ee0c8240310885e3d1c475`. Q001–Q013 are closed absent regression; this is bounded fixture/source-CLI acceptance, not full doctor readiness or release certification.

The same implementation owner resumed A13 from `/tmp/native-retirement-publication-a13/report.md`: remaining historical package variants, legacy installer effects, functional RTK/search and applicable version coverage. Acceptance permits explicit reproducible equivalent-version grouping, not silent coverage reduction. Verify current harness and identity, resolve known gaps before broad execution, and retain precise distinction between historical effects, synthetic fixtures and live functionality. A13 remains open until evidence is reviewed. Frozen33 remains unapplied, ambiguous5 unapproved; no real installation/restart/publication effects occurred.

## Resume after daemon stop — A13 attempt 18 incomplete

User explicitly requested resumption. Reviewed interrupted events 160231/160232: reason `daemon-stopped`, no final report. Last progress describes older Codex project-install epochs, an intermediate Pi physical-path mismatch, and a legacy Deck-owned Codebase Memory executable surviving opt-out. These are partial investigation claims pending verification against retained source and run artifacts; no historical acceptance follows.

The same implementation owner resumed A13, beginning with current attributed-file/process/artifact verification and reuse of valid completed evidence. Preserve concurrent/committed work and Q001–Q013 protections; do not restart from scratch or count interrupted runs as passing. Runtime cleanup changes discovered by historical fixtures require focused review. Frozen33 remains unapplied and ambiguous5 unapproved; real installation changes, restart and publication remain outside this delegated execution.

## User-authorized assignment replacement for A13 closure

User explicitly authorized a new logical task after changing the member model/reasoning settings. Source confirms continuation pins previous runner/model/thinking; old task `task-a47ce13f-72f3-43c8-ab6c-87593818f50d` remains cancelled at attempt 19. Same implementation member now owns replacement `task-c8ce6be1-3c47-402b-a4ac-d47799b81b69`, with compact artifact-based handoff and fresh task context.

Reviewed attempt19 report (167748/167749): 74 base component passes, two exercised historical failures,17 incomplete and47 unsupported. Selected variants, final candidate consistency and CI evidence remain additional gates. No A13 acceptance follows. The report also discloses an excluded early global Codebase fixture whose extra runtime namespace was not isolated; unchanged pre-existing process IDs do not prove absence of every side effect. New work explicitly requires private namespaces and must not repeat that acquisition. No real migration is authorized by this replacement.

Closure work is bounded to exact residual classes, valid evidence reuse and approved reproducible version grouping. Do not repair historical upstream releases or repeatedly rerun impossible installers; surface exact external/acceptance blockers. Q001–Q013 remain closed absent demonstrated regression. Frozen33 remains unapplied; ambiguous5 unapproved.

## Replacement attempt 1 — concrete A13 residual and closure decision

Reviewed events171139/171140 and durable `a13-publication-continuation-20261025/report.md`, A13 acceptance and strict/focused logs. Four actionable base gaps are closed:78 base component passes,2 historical package failures,13 incomplete,47 unsupported;10 selected component passes,2 attempted incomplete,81 unexecuted applicable pairs. These are mixed frozen-candidate component results, not release certification. Four harness files changed;25 focused checks and typecheck reported passing. Final same-candidate/CI proof remains missing.

The report identifies original facade/verifier defects in11 Pi and4 early OpenCode releases, and an old OpenCode Serena install command resolving to a package without the required executable. Repeatedly attempting to manufacture healthy historical installs is not an appropriate closure route. Proposed acceptance clarification: test the authentic partial installation residue and require safe ownership-based cleanup, user preservation, explicit diagnostics and safe new-install recovery; do not claim the original release installed successfully. User approval is required before treating that category as satisfying A13.

Management correction: acceptance already permits reproducible equivalence grouping by relevant installation/ownership/configuration transitions. Whole-source hash differences alone do not prove distinct migration formats or justify an unbounded variant matrix. Retain per-version applicability inventory but demonstrate relevant equivalence before reducing executions. Do not fabricate equivalence or hide the81 execution gaps. No further broad run dispatched pending the historical partial-install decision. Frozen33 remains unapplied; ambiguous5 unapproved; Q001–Q013 closures remain.

## User-approved closure scope — new installations

After approving authentic partial-install coverage, the user further narrowed delivery: few existing users will receive personal cleanup; guarantee new installations are clean. Explicit confirmation authorizes this supersession. A13 historical matrix is no longer a delivery/publication gate; historical outcomes remain incomplete, not passes. Local33 and ambiguous5 are outside this execution. Acceptance/design/tasks now carry a precedence notice preserving existing safety while limiting closure to fresh-install correctness, real manifests, explicit CBM opt-in and working RTK/search across supported runners/paths.

Same current apply owner/task continues with bounded fresh-install validation and necessary CI/docs alignment. Reuse relevant identity-matched evidence, fix only concrete fresh-path failures, then independent review of the final delta. Do not restart broad migration work.

## Fresh closure attempt 2 — contract candidate; two functional evidence gaps

Reviewed events173489/173490, durable `fresh-closure-szit0dz6/report.md`, isolated verification script and required release workflow wiring. CI/docs now reflect fresh scope; historical checks are optional diagnostics. Four real adapters materialize/reapply fresh default content with granular hash checks;143 isolated source contracts, typecheck and direct compilation pass. Fixture version/spawn seams and copied RTK execution are not fresh package acquisition or native model-session proof.

Two existing acceptance gaps remain: actual fresh package acquisition/explicit CBM startup, and A12 real four-runner tool/search/RTK sessions. Prior underlying A12 raw evidence/source hashes are missing, so no reconciliation claim is made. Same apply owner accepted bounded replacement checks and only necessary fresh-path fixes. Reuse valid contracts; no further historical expansion or prolonged artifact reconstruction. Keep durable per-runner evidence for final independent review. Real-user environments and local33/ambiguous5 remain untouched; no publication.

## Fresh live attempt 3 — candidate under bounded final review

Reviewed events176057/176058, durable `fresh-live-attempt3/report.md` and four-file task delta. Real package acquisition and native tool/search/RTK evidence are reported for all four runners. Explicit CBM acquisition/stdio startup passes all four; native model calls pass Claude/OpenCode/Pi, while Codex exposes17 tools at corrected native startup but model discovery remains unresolved. Do not claim a Codex model-level CBM call. Initial Codex probes lacked runtime environment forwarding and are excluded from safe-isolation evidence; no blanket absence-of-side-effects assertion follows.

The runtime delta fixes a credential-pattern false positive for task paths and trailing-comment TOML receipt instability.94 affected checks/type/build pass according to retained evidence; overlap with prior143 checks is not additive. Final source identity `39a5db2bc56e1179c4b47b0378f4c5a4e7743c7150d04ac9b575de3c0e7e3dc0`, task patch `920b5b13dc3066e7a54cd744e545e368b2cad579661e25060ab32b437b9a1f59`. Same quality owner accepted bounded final fresh-scope review including these qualifications and preceding CI/docs delta. Historical A13 stays superseded; Q001–Q013 protections stand. No real cleanup, canary, restart or publication.

## Final fresh review 14 — one Codex environment correction

Reviewed events177402/177403 and the generated Codex CBM branch against retained probe details. **NRP-Q014 (P2, open):** opt-in CBM config omits native env_vars forwarding; the successful private inventory probe supplied a command-line override. Add required runtime/cache variable names via existing rendering and verify actual generated-config startup without that override. Native connected-tool inventory suffices for the approved startup criterion; no further model-level discovery experiment is required.

Other bounded fresh evidence supports acceptance:35 independently rerun tests,4279 receipt hashes,8 acquired binary hashes and retained four-runner tool/search/explicit RTK transcripts; automatic RTK evidence only Claude/Pi. Same apply owner accepted this narrow correction and affected checks. Initial unforwarded probes remain excluded; shared-runtime effects are unproven. Q001–Q013 remain closed; historical A13 superseded. No real cleanup/restart/publication.

## Fresh scope closure — Q014 resolved by Lead narrow recheck

Reviewed events178204/178205 and durable `q014-final` report, two-file delta, exact source hashes, production generator, recorded argv/environment, native inventory and transcript structure. Lead independently reran Codex MCP and install suites:47 pass,0 fail,1099 assertions (`/tmp/nrp-q014-lead-check.log`). Native startup uses the generated config without overrides and exposes17 CBM tools in private roots. Q014 is resolved; prior independent quality14 acceptance applies to the remaining fresh scope. Q001–Q014 are closed absent regression.

Implementation and local verification are complete for the user-approved NEW-installation scope. Evidence and limits are consolidated in `fresh-verification.md`. This does not certify historical migration, full remote CI or a canonical published release. No further apply/quality task is dispatched. Existing-user cleanup is operator-assisted; local33/ambiguous5 remain unapplied. Initial probes with unproven isolation remain excluded and are not retroactively declared harmless.
