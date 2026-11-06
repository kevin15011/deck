# Implementation work

- [x] Record user-authorized product policy and initiating OpenCode evidence.
- [x] Review first cross-runner inventory and correct project-scope/fence-recovery exclusions.
- [x] Complete inventory supplement for project generators, shared installers and safe metadata recovery.
- [x] Implement shared managed-target authority, canonical postimage accounting, private backup and drift primitives with focused tests.
- [x] Apply policy to OpenCode install/refresh and reproduce original incident in hermetic fixtures.
- [x] Apply policy to Codex, Pi and Claude installation/update paths.
- [x] Apply policy to shared tools, instructions, skills, project-generated artifacts and retirement.
- [x] Reconcile existing contracts and tests: invert managed-edit preservation; retain foreign-content and launch-authentication guarantees.
- [ ] Complete independent review, final checks and real-upgrade qualification; record exact coverage and any remaining gaps.

Lead owns these OpenSpec files. Apply owns source/tests/product docs. Progress is not completion until every inventory row is implemented or shown already compliant with evidence.

WP1 implementation delivered by Apply Deep task-3996560e-97cc-4baf-8758-75c9f99c5310 attempt 7 (92613/92614): opt-in managed inventory, canonical receipt verification, bounded private backups and receipt-based drift. Focused 26 tests/types passed on host Bun 1.3.11; pinned-runtime qualification pending. Lead reviewed integration diff; independent core boundary review pending. Adapter callers still use legacy behavior until wired. Evidence and API handoff: `/tmp/deck-managed-artifact-authority-wp1.md`.

## Open core review blockers

Quality task-308e00a4-3244-446b-8a48-7d9306f32555 attempt 1 (96519/96520), accepted by Lead:
- MA-WP1-01 (P1): pending-journal recovery can publish receipts before trusted inventory/canonical expectation validation. Preserve unproven journals and bind recovery to trusted target scope.
- MA-WP1-02 (P1): malformed inherited ownership can skip managed canonical verification. Derive authority from validated managed inventory and verify every target.
- MA-WP1-03 (P2): interrupted project transactions recover as global. Preserve and validate scope across journal publication/recovery.

These block acceptance; prior 26 passing tests do not cover them. Same Apply Deep owner must add red/green reproductions and obtain same-reviewer recheck before closure. Project work may proceed independently but must not treat current core as approved.

Project registry slice task-cb21a1f1-800c-4a96-9e31-cfb66724ce6a attempt 2 (98802/98803) implements authorized regeneration/backups/newer-schema preservation and bootstrap updates; reported 55 focused tests plus backup-failure test/types pass. Acceptance pending: establish cross-process serialization required by shared backup retention and verify provider-dependent project repair classification. No real project registry repaired.

Project registry attempt 3 (99725/99726) made no changes: the preparation Map does not serialize independent processes, and injected stateRoot is not propagated by preparation. Lead confirmed the gap and continued the same owner with explicit ownership of a registry-specific transaction helper and cross-process regression. Attempt 2 is still unaccepted. Shared core files remain frozen for the independent attempt-9 repair review; adapter integration continues separately.

Quality attempt 2 (101505/101506) independently supports the MA-WP1-02 ownership and MA-WP1-03 scope repairs on unchanged core hashes. MA-WP1-01 remains blocking: downgraded/stripped journal mode, forged preimage or empty targets can trigger context-free journal deletion before authority is required. No receipt publication bypass was found. Reviewer real-filesystem test loading failed with EPERM; in-memory production probes reproduced the residual. Lead confirmed the source path and redirected the same Apply Deep owner to repair and add real-filesystem regressions before continuing adapters. Attempt-10 adapter edits are preserved but unverified; no global acceptance or installation.

Project registry attempt 4 (102443/102444): Lead reviewed stateRoot propagation and isolated fixture changes; 27 continuation tests reportedly pass. Cross-process lease remains unimplemented, so acceptance stays blocked. Same owner continued with bounded exclusive-lock design: canonical project identity, owned-token release, fail-safe contention, no uncertain stale-lock stealing, deterministic child-process coverage. The owner reported a red test may have created fixture backups in default user state; read-only exact attribution requested, no blanket deletion authorized. Typecheck reported concurrent Pi-test errors; final gate pending.

Project registry attempt 5 (103704/103705) implements canonical-project cross-process serialization, owned lock release and fail-safe contention. Lead matched three reported file hashes and reviewed lease/writer cleanup and focused log (49 pass, 0 fail, 984ms). Adopted for distinct independent registry review; not final acceptance. Default-state inspection found no attributable registry backups, and none were removed. Full gate remains pending.

Apply Deep attempt 11 (104791/104792) repairs context-free recovery settlement with trusted context, exact target inventory and independently captured rollback preimages; OpenCode caller migrated. Lead reviewed source/report and 97-pass focused log; same-reviewer recheck requested before MA-WP1-01 closure. Codex/Pi generated-file repair and drift wiring progressed. Claude, shared configs/skills/tools, retirement and OpenCode preparation sysctl failure remain outstanding; same owner continued implementation with core/OpenCode recovery files frozen for review. No global acceptance.

Registry Quality attempt 1 (105689/105690) identified REG-01 (release error overrides committed result and leaves lock without owner evidence) and REG-02 (session-service production composition omits configured backup stateRoot). Lead reviewed source and accepted both blockers; same registry owner continued with production composition added to scope and deterministic failure tests. Existing 49 passing cases do not close these findings. No global acceptance.

Quality attempt 3 (107599/107600) approves the bounded core recovery repair and recommends resolution of MA-WP1-01/02/03. Lead confirmed all 21 scoped hashes still match attempt 11 and accepted the review: 25 independent recovery probes plus 5 OpenCode rollback probes passed. Reviewer real-filesystem execution remains unavailable (EPERM), not a green test result; owner focused evidence remains separate. These defects were recorded only in prose: host structured closure returned finding-unknown, so no host finding closure is claimed. Core repair is accepted; registry blockers REG-01/02 and remaining global implementation/qualification remain open.

Registry attempt 6 (107919/107920) preserves transaction outcome across cleanup failures, reports cleanup diagnostics, retains lock-owner evidence and wires production stateRoot. Lead reviewed source/diff and 51-pass log; same registry reviewer recheck requested for REG-01/02. Typecheck was not green (concurrent Claude test errors). Global acceptance remains pending.

Registry Quality attempt 2 (109464/109465) accepts REG-02 and transaction outcome preservation, but REG-01 remains blocking: late replacement can redirect lock removal/token restoration, and removeOwnedFile swallows cleanup errors. Lead confirmed source and continued the same owner with late-interleaving and temp/backup removal-failure regressions. No final registry acceptance.

Registry attempt 7 (110246/110247) made no changes and identifies a genuine primitive/design gap: pathname rechecks do not bind removal to directory identity. Lead requested a bounded lock-protocol decision from the existing Architect; original registry owner continues independently with swallowed cleanup-error correction and regressions. Existing ownership is preserved. REG-01 remains open; no new test evidence from attempt 7.

Registry attempt 8 (111349/111350) adds independent cleanup attempts and observable diagnostics without replacing transaction outcome. Lead matched source/test hashes and reviewed 26-pass log (469ms); combined independent review remains pending lock design. Owner again reported an initially unisolated run. Lead found no registry-* backup directories at the default state root, but cannot exclude other roots. Same owner must make fixture-level state isolation mandatory before further test execution; no real-state cleanup requested.

Registry attempt 9 (113179/113180): Lead reviewed mandatory private-state writer helper, child-process environment isolation and shared preparation fixture changes. Focused log: 90 pass across 8 files, 1.96s; owner reports typecheck passed. Isolation delta accepted. Lease source and cleanup implementation unchanged; REG-01 lock race still awaits Architect revision before same-owner implementation and combined review.

Apply Deep attempt 12 (113742/113743) delivered Claude canonical repair, Codex/Pi shared selector reconciliation and bounded retirement, plus credential-safe duplicate Tavily span repair. Reported 179 affected passes with final Pi55-test rerun/types. Lead reviewed full coverage report; Claude/shell slices sent to independent review, other remaining implementation continued with same owner. Acquired-tool repair, legacy project paths, collision health, interruption durability and OpenCode preparation failure remain explicit requirements. No global completion.

Registry attempt 10 (116441/116442) introduced partial SQLite lease/writer integration but left old test APIs and failing typecheck; Lead did not accept it. Same owner continued to complete migration and real subprocess verification. Pi generation requires pinned Bun1.4.0 while host is1.3.11; this is a separate artifact qualification gap, not a reason to stop independent implementation/tests. No runtime pin bypass or global runtime mutation authorized.

Quality attempt 4 (117793/117794) accepts Tavily bounded scope (48 independent checks) and blocks Claude with MA-CLAUDE-01 refresh bypassing admission/fences, MA-CLAUDE-02 semantic-selection versus canonical-byte mismatch, and MA-CLAUDE-03 incomplete in-place rollback. Lead read source/report and redirected original Apply Deep owner; attempt13 shared-tool edits preserved, not yet accepted. Claude freeze lifted for repair, registry ownership unchanged. Independent filesystem checks were unavailable to reviewer (EPERM).

Registry attempt 11 (118920/118921) completes SQLite source/tests with reported82 registry and34 preparation/composition passes, including Node/Bun contention and crash release. Lead reviewed logs/hashes/source; same reviewer rechecks REG-01. Typecheck still had concurrent Claude test errors. Pi generated bundle remains stale because pinned Bun1.4.0 is unavailable in bounded local paths; Linux/full gate/live qualification remain open. This is not final registry acceptance.

Registry Quality attempt 3 (120583/120584) supports resolution of the old release race and cleanup diagnostics, but REG-01 remains open for unsafe ancestor replacement permissions. Leaf validation is insufficient when a foreign-owned/writable ancestor can move the private lock root. Same owner continued with trusted-chain checks before mkdir/open and negative ownership/mode tests. No chmod or live environment repair. REG-02 stays accepted; Pi artifact/runtime/full qualification remain pending.

### Lead review — Claude attempt 14

- Read the complete handoff and verified the three changed Claude/admission source and test hashes against the report. Adopted the bounded repair for independent recheck; MA-CLAUDE-01/02/03 are not closed by this adoption.
- Reported evidence: 26 affected, 6 protected targeted and 49 preserved tool/planner tests pass; typecheck passes. Full global qualification remains pending.
- Same Quality owner is rechecking Claude with those files frozen. Same Apply Deep owner continues independent remaining inventory, starting with OpenCode public repair/preparation and Pi legacy/durable transaction gaps.
- OpenCode preparation still reproduces a process-identity child failure; no baseline exemption or bypass accepted. Registry attempt 12 has completed and awaits separate review.

### Lead review — registry attempt 12

- Read ancestor validation and matched source/test hashes to the complete report. Adopted bounded trusted-owner and writable-ancestor checks for same-reviewer recheck; REG-01 remains open pending that result.
- Implementation reports 84 isolated registry tests and typecheck passing. Registry files remain frozen for review. Pi bundle regeneration and pinned-runtime, Linux and full-candidate qualification remain outstanding.

### Lead acceptance — registry review attempt 4

- Accepted the independent recommendation resolving the bounded REG-01 ancestor source defect. Current source/test hashes match the reviewed candidate; prior REG-02 and release/cleanup recommendations stand. These are document-level dispositions, not host finding-state closure.
- Independent evidence: 56 source-evaluated fake-backed scenarios passed across both backend branches. Real filesystem test startup failed with reviewer sandbox EPERM; no independent real SQLite/process/crash rerun is claimed.
- Registry source review is complete within this scope. Pi bundle regeneration, shipped Node behavior, pinned Bun, Linux, full gates and isolated live canary remain pending. Global implementation continues under the existing Apply Deep task.

### Lead review — Claude attempt 5

- Accepted MA-CLAUDE-02 bounded selection normalization resolution. MA-CLAUDE-01 remains blocking: native launch invokes the unguarded adapter closure despite direct refresh interception. MA-CLAUDE-03 remains blocking: corrupt-manifest normalization is outside tracked rollback effects, leaving synchronous failed repair unretryable.
- Reviewed original independent production-function probes and corresponding source. Reviewer real-filesystem execution remains unavailable (EPERM).
- Redirected the same Apply Deep task to these concrete defects, preserving its in-progress OpenCode RTK work and all global inventory obligations. Claude freeze lifted. No global completion or live installation claimed.

### Lead adoption — implementation attempt 16

- Read full report and matched six changed source/test hashes. Adopted residual Claude public-launch and corrupt-manifest rollback candidate for independent recheck, including bounded native-tool repair planning. Findings remain open until reviewed.
- Owner evidence: 68 affected tests, 8 protected rechecks, types and diff check pass. OpenCode refresh now passes with unchanged process identity code; earlier transient root cause is not established.
- Same reviewer rechecks frozen attempt-16 files. Same implementation owner proceeds with independent Pi legacy writer retirement and durable/CAS transaction gaps. Legacy AGENTS output retirement remains global implementation ownership, not registry-only ownership. Global qualification remains pending.

### Lead acceptance — Claude review attempt 6

- Accepted bounded MA-CLAUDE-01/03 resolution recommendations and native RTK/Codebase repair review; prior MA-CLAUDE-02 and core/Tavily dispositions stand. Current six changed hashes match the reviewed candidate. These are document dispositions, not host finding-state transitions.
- Independent production-function probes: 169 assertions with filesystem/process fakes pass. Real filesystem test preload blocked by EPERM; owner real-FS evidence remains separate.
- Explicit apply after recovery must replan because its captured fence changed; automatic preparation retry succeeds. No permanent recovery blockage reproduced. Global restart recovery, remaining inventory, pinned-runtime and live-canary qualification remain pending.

### Lead adoption — Pi attempt 17

- Read full report and verified all ten changed hashes. Adopted legacy writer suppression, exact project retirement, CAS rollback and durable interruption evidence for independent review; no global completion. Owner reports 94 affected tests and types pass.
- Same reviewer checks frozen Pi scope. Same implementation owner continues shared npm and generic skill/MCP reconciliation; prior Claude freeze released following accepted bounded review.
- Automatic Pi restart restoration/completion remains unimplemented. Durable detection and evidence retention do not satisfy that requirement. Shared npm, generic collision health, legacy AGENTS, Claude generation/restart and final qualification remain pending.

### Lead review — Pi attempt 7

- Accepted MA-PI-01: stale preimages/backup failure before proof registration strand a pending writer fence even on same-process retry. Accepted MA-PI-02: rollback recreates retired private files without restoring modes, while proof incorrectly succeeds. Original independent report and source reviewed.
- Other 46 fake-backed production assertions pass; independent real-FS preload remains EPERM-limited. No Pi acceptance yet.
- Same implementation owner redirected to both defects with Pi freeze lifted, preserving ongoing generic MCP/skill reconciliation from attempt18. All remaining global inventory obligations persist.

### Lead adoption — attempt 19

- Full report read and eight hashes matched. Adopted Pi no-effect proof/retry and permission-aware rollback candidate for same-reviewer recheck. Preserved OpenCode generic MCP/skill reconciliation is included in review. No finding closure inferred.
- Owner reports 115 affected tests and typecheck pass. Same reviewer checks eight frozen files; implementation owner continues shared npm repair and remaining inventory in other paths. Automatic restart recovery and final global qualification remain incomplete.

### Lead review — attempt 8

- Accepted original MA-PI-02 permission-restoration resolution. Residual MA-PI-01 pre-registration project-symlink validation still strands retries; new MA-PI-03 exposes temporary private replacement bytes before chmod; MA-OC-01 overlaps JSONC deletion ranges for multiple obsolete fields. Original report and source reviewed.
- Same implementation owner redirected to these concrete cases, preserving shared npm work from attempt20; relevant freeze lifted. Independent review used 54 fake-backed assertions with real-FS preload EPERM. Global acceptance remains open.

### Lead adoption — attempt 21

- Full report read; 15 hashes match. Adopted Pi/JSONC fixes and shared npm wiring for independent review. Owner evidence comprises 126 unique affected tests and types; final test-only delta rerun separately.
- Same reviewer checks frozen 15-file scope. Architect continues original design task on narrow canonical restart-recovery authority; implementation owner continues independent legacy AGENTS and remaining inventory.
- Automatic restart recovery, generation retirement, wider runner coverage and final qualification remain open. No global completion or deployment claimed.

### Lead review — restart design attempt 7

- Canonical regeneration direction is compatible with user scope but proposal not adopted as written. Exclusive lease proves exclusion, not prior process death. Missing fence/malformed journal does not establish legacy compatibility. Missing project context cannot certify unresolved project effects.
- Same Architect task requested a bounded revision preserving unknown/newer states, complete trusted scope, normal launch verification, bounded references and archive confidentiality. No recovery implementation authorized from this draft; existing independent implementation/review work continues.

### Lead review — attempt 9

- Accepted bounded MA-PI-01/03 and MA-OC-01 resolution recommendations. MA-NPM-01 remains blocking: receipt publication overwrites concurrent manifest replacement, losing unrelated receipts while reporting success. Original report and unchecked publication source reviewed.
- Independent evidence: 201 fake-backed production assertions including three npm reproductions; real-FS preload EPERM limitation retained. Same implementation owner redirected to receipt CAS with public adapter interleavings, preserving ongoing legacy AGENTS/Codex foreign bundle work. Review freeze lifted. Restart architect revision pending; global acceptance remains open.

### Restart protocol revision 8 review

- Improved exclusion, newer/unknown-state and launch verification constraints retained as design direction. Protocol not adopted yet: takeover drops old journal binding before archive, making a crash at that boundary unretryable; malformed Pi journals cannot prove complete project scope.
- Same Architect requested concise correction preserving bounded durable bindings and scope across each crash boundary. Legacy Claude compatibility checks must precede mutating core recovery. Existing implementation work continues independently.

### Lead adoption — attempt 23

- Complete report read; nine hashes matched. Receipt preimage repair and legacy AGENTS/Codex collision scope adopted for independent review, not closure. Public receipt/legacy checks and types pass.
- Affected Claude cleanup test still fails on Darwin because reference inspection is Linux-only. Same implementation owner proceeds with safe supported-platform generation retirement; nine review paths frozen. No full passing gate claimed. Restart design remains pending.

### Lead adoption — attempt 24

Reviewed the Darwin process inspector and matched all three handoff hashes; the affected log records 170 passing tests in 27.59s. Adopt the conservative retirement candidate pending independent review: flattened or unreadable native arguments preserve generations, and apply rechecks references. The live read-only probe observed uncertainty, not a successful collection. Evidence: task-3996560e-97cc-4baf-8758-75c9f99c5310 attempt 24, events 142318/142319, /tmp/ma-attempt24-report.md. Pinned toolchain, restart recovery and global qualification remain open.

Architect revision 9 retains scope and journal binding across takeover, but directory durability ordering and archive retention under repeated failed publications remain unresolved (141325/141326). Revision 10 is limited to those corrections; no restart implementation is authorized from the rejected drafts.

### Independent review — attempt 10

Accept bounded MA-NPM-01 resolution: reviewer exercised all three public npm paths with simulated filesystem/process effects and verified concurrent manifest preservation plus rollback behavior. Legacy AGENTS exact-span, admission and composition checks passed within that scope. Evidence: task-308e00a4-3244-446b-8a48-7d9306f32555 attempt 10, 143511/143512; 109 assertions, 2.52s; independent real-filesystem run blocked by EPERM.

MA-CODEX-BUNDLE-01 remains blocking: without SKILL.md, a foreign declared resource allows surrounding files to publish, verification reports success, and the next install overwrites the resource. Lead checked the entry-only condition and verifier. The existing Apply Deep owner must next classify every existing declared bundle member before any publication, preserve an ambiguous bundle as a whole, report unmet capability, and prove protection across repeated installs. Established Deck-generated bundles must still regenerate edited members. Queue this repair after the currently running isolated OpenCode qualification; do not interrupt or discard that work. Darwin candidate remains frozen for independent review.

### Darwin independent review accepted

Quality attempt 11 (145851/145852) found no new blocker in the frozen Darwin retirement candidate. Lead recomputed the three hashes and matched the handoff. Accept bounded approval: 239 independent production-function assertions with filesystem/process fakes (128ms), alongside the owner's 170 affected tests. Independent real-filesystem preload failed with EPERM; native inspection was incomplete. This does not qualify native collection, pinned runtime or the full candidate. MA-CODEX-BUNDLE-01 and restart implementation remain open; current Apply Deep OpenCode qualification continues.

### OpenCode effective policy candidate — attempt 25

Lead reviewed config enumeration and role validation and matched all seven hashes in /tmp/ma-attempt25-report.md. Adopt for independent review: ancestor configuration, pure-mode retained configuration, Markdown role aliases and legacy modes now participate in preflight. Owner reports 21 focused checks and types pass; 12 isolated native scenarios pass on available 1.19.5, not pinned 1.18.31. The package gate remains red (312 pass, 7 fail): three stale content-preservation expectations, two Darwin /tmp fixtures and two RTK plan expectations need reconciliation, not waiver. Evidence 146685/146686. Freeze these seven paths during review. Next Apply Deep work: MA-CODEX-BUNDLE-01, then accepted restart design. Native pinned/global qualification remains open.

### Codex repair candidate and OpenCode review — Lead 68

Apply Deep26 (148031/148032): both hashes match; member-level recognition now prevents a recognized or absent entry from granting authority over foreign resources. Repeated public installs and exact-history repair pass in 12 focused tests; types pass. Adopt for independent recheck, not closure of MA-CODEX-BUNDLE-01. Four wider Codex failures remain explicit (/tmp/ma-attempt26-report.md).

Quality12 (148870/148871): accept MA-OC-02 ordered-load deduplication and MA-OC-03 raw-versus-normalized directory identity blockers. Six unsafe admissions reproduced with fake filesystem/glob boundaries; no independent native pass. Scanner unbounded/symlink traversal remains an advisory availability concern. Existing Apply Deep owner fixes these next while Quality rechecks frozen Codex26. Restart and eleven diagnosed package failures remain unfinished; no final acceptance.

### Codex member authority independent review accepted

Quality13 (150389/150390): Lead accepts bounded MA-CODEX-BUNDLE-01 source resolution and matched both frozen hashes. Independent production-boundary probes passed 129 assertions (3.674s + 0.972s), including foreign partial bundles across retries, truthful verification, exact member receipt/history repair, wrong-root/ID rejection and no sibling authority. Filesystem/admission/publication were simulated; independent real-FS preload failed with EPERM. Existing owner real-FS evidence remains separate. Missing explicit protects annotations in added tests are a documentation follow-up for the same owner, not an identified runtime defect. OC02/03 repairs remain active; package failures, restart recovery and final qualification remain open. Release Codex26 freeze after this recorded review for any necessary later lifecycle integration, which must identify invalidated evidence.

### OpenCode repairs and package reconciliation — attempt 27

Lead reviewed the full report, normalized Markdown selection/bounded scanner and guard ordering; all fourteen hashes match /tmp/ma-attempt27-report.md. Adopt candidate for independent recheck, not closure of MA-OC-02/03. Owner reports 324 OpenCode, 223 Codex and 12 CLI guard tests pass, with types green. Eleven prior package failures were resolved through canonical fixture roots, authorized refresh-contract assertions and the missing selected-native-RTK planning branch. Eight isolated native diagnostics used 1.19.5 only. Evidence 151051/151052.

Recovery now takes the mutation reservation before adapter assessment and checks committed compatibility, but full scope/marker/archive/canonical restart remains unimplemented. Freeze attempt27 inputs for Quality while the same Apply Deep owner implements isolated core recovery primitives; defer touching frozen guard integration until review completes. Missing Codex protects annotations remain a minor follow-up. Final assembled suite/pinned/native/canary gates remain open.

### OpenCode resolution and version blocker — Quality 14

Accept bounded MA-OC-02/03 resolution from 152699/152700; Lead recomputed all fourteen frozen hashes unchanged. Independent probes covered policy/scanner (62 assertions), guard (61) and native RTK routing (13) with simulated effects. No independent filesystem or pinned pass. Previous package passes remain separate owner evidence.

MA-RECOVERY-VERSION-01 is blocking: validBuildIdentity accepts 2.0.0+build.1, while compareReleaseVersions rejects the plus suffix and returns equality against 1.0.0. Lead confirmed both regular expressions in current source. Both committed and pending newer writers can reach recovery effects. Existing Apply Deep owner must align accepted version syntax and comparison, refuse unsupported identities before callbacks, and add public guard regressions for both positions (plus metadata, malformed versions and supported prerelease compatibility). This must be fixed before completing current core recovery work. No runtime deployment or final acceptance while open. Release the prior fourteen-file review freeze for necessary integration after this review; identify invalidated checks. Do not interrupt ongoing isolated core edits solely for notification; include this blocker in the next same-owner continuation.

### Core restart candidate — attempt 28

Lead read full report and core orchestration/comparator source; all eleven hashes match /tmp/ma-attempt28-report.md. Adopt core candidate for independent review: durable directory barriers, bounded hard-link archive, retained scope/references and rotated markers. Core callback tests cover 18 actual child-kill cases and repeated failed retries; they do not establish actual Pi/Claude recovery. Owner reports 111 affected tests and 20 final-delta tests plus types. The +build comparator repair is present but MA-RECOVERY-VERSION-01 needs independent public guard recheck. Evidence 153358/153359.

Next: same owner wires canonical Pi/Claude replan, scope registration and CLI integration, with review freeze limited to core implementation/tests. Prior fourteen-path freeze is released. Independent review must distinguish the frozen core from changing adapter integration. No full recovery or final global pass claimed.

### Core review — Quality 15

Lead reviewed 155067/155068 and confirmed all ten core hashes unchanged. No additional frozen recovery protocol blocker found in 253 independent fake-boundary assertions. Real-FS execution hit EPERM and changing Pi/CLI wiring remains unqualified.

MA-RECOVERY-VERSION-01 remains blocking beyond the fixed ordinary +build case: malformed 1.0.0+. is accepted, numeric components beyond precise Number range compare incorrectly, and valid prerelease-plus-build is rejected. Use one validated representation; reject unsupported numeric ranges or compare exactly. Require refusal before committed/pending recovery callbacks and both public-guard/core-entry regressions. Preserve the deliberate release-triple channel convergence policy; do not accidentally order commits/channels/build metadata. Existing Apply Deep owner receives this on next continuation after active adapter work. Core review freeze is now released for that fix and necessary integration; identify invalidated checks. Full recovery/global acceptance remains pending.

### Production recovery candidate — attempt 29

Lead reviewed the full handoff and CLI composition; all fifteen hashes match /tmp/ma-attempt29-report.md. Adopt Pi/Claude canonical recovery wiring for independent review. Owner reports 135 affected tests, 24 settled-delta tests and types; 12 actual adapter/CLI SIGKILL cases cover three composition boundaries. This is not native runner/pinned qualification.

Full gate failed four files in 98.75s: provider-specific recovery archive/fixture identifiers in core purity audit; provider npm metadata in generic core acquisition; OpenCode detection timeout; manual migration identity/timeout failures. Aggregate test counts are unreliable due to wrapper diagnostic matching; use per-file outcomes. Residual MA-RECOVERY-VERSION-01 remains blocking. Same owner fixes version representation and gate failures without audit weakening, timeout-only waivers or real toolchain/config changes. Quality reviews settled adapter integration; core28 freeze released, adapter29 paths frozen while reviewed unless a necessary provider composition move explicitly invalidates a hash. Final full gate follows fixes.

### Recovery integration review — Quality 16

Read full report 157803/157804. No new Pi/Claude/CLI recovery blocker in 135 independent assertions using simulated filesystem/storage and leases. Reviewer reran after concurrent contribution/adapter/precheck edits; the prior owner29 tests are historical, not proof for those changes. Retain bounded review disposition only. Settled version representation, provider-neutral archive delta and current full gate require explicit qualification; no independent real-FS/native/pinned/canary pass. Existing Apply Deep30 remains responsible for those repairs and final-candidate evidence.

Lead current fifteen-path digest is 18c79aca643f7e825d7785c36e043522e05bd5c66b0cd446599fb8a4190757b0, different from review's 0cdbaece27f5382bee11bcd6dcfc75eb6ba394da558cc25560a6b7607db92eec. Do not claim unchanged-candidate approval; reconcile settled owner30 hashes and rerun invalidated review boundaries after its handoff.

### Lead76 — settled attempt30 gate and review handoff

Read the full attempt30 report and version parser/comparator; all 24 scoped hashes match. `/tmp/ma30-full-gate.log` confirms 497/497 files, 4,626 passing tests, zero failures, one skip, 62.05s within the 120s budget. Typecheck is reported passing in 13.57s. Adopt the candidate for independent review; this is not release approval. Four attempt29 integration paths changed, so Quality continues its same task to revalidate version authority, provider-neutral archive/npm composition, indexed inventory semantics and invalidated adapter boundaries. Evidence: task result 158512/158513; integration 158657. Pinned/native qualification and Lead live canary remain open. No live configuration changes or toolchain installations performed.

### Lead77 — independent final-delta disposition

Quality17 found no new blocker and recommends resolving MA-RECOVERY-VERSION-01. Lead accepts that bounded resolution: all 24 attempt30 hashes still match; 797 independent assertions cover version grammar/precision/admission, inventory semantics, recovery/archive and provider composition with simulated storage/FS/leases. Invalidated attempt29 paths were reconciled. Evidence 159665/159666; integration159772. Full gate/types evidence remains attributable to unchanged source. Same implementation owner continues isolated pinned/native qualification and remaining coverage assessment, and prepares a concrete Lead canary check. No global acceptance or live installation claimed.

### Lead78 — pinned qualification and live canary attempt

Reviewed attempt31 report and matched all24 prior plus4 generated hashes. Pinned Bun1.4.0 final gate:4626pass0fail1skip55.46s wrapper; types reported12.99s. Adopt generated refresh pending bounded review. Pinned OpenCode20 policy diagnostics passed but canonical package-plugin startup times out; minimal baseline succeeds, so full native admission remains blocked. Evidence160956/160957; integration161089. Lead executed isolated canary prepare successfully at `/private/tmp/deck-ma31-lead-canary.OOLfKt` (deck0.14.0 commit47ec17b darwin-arm64 channeldev). Actual PTY launch stopped with `DeckConfigReadinessError: Canonical global Deck config is required.` No prompt submitted. This is a failed fixture/readiness check, not successful native admission. Same owner continues plugin startup root cause/repair and canonical isolated fixture preparation; no real user configuration or daemon changes.

### Lead79 — plugin delivery candidate and remaining upgrade defects

Read attempt32 report, native results and full-gate footer;17 hashes match. Adopt candidate for independent review: local model-variant delivery/receipt authentication and native prompt expansion parity;4629pass0fail1skip57.40s pinned gate. Warmed native Investigate/Quality admit with matching hooks/prompts and read-only permissions. First fresh dependency bootstrap still times out;17MB legitimate generated preimage exceeds16MiB backup serialization cap and blocks upgrades. Neither is waived. Evidence162475/162476. Same Quality task reviews plugin/generated delta; same Apply Deep owner repairs backup capacity and cold bootstrap lifecycle. Lead canary remains pending successful reviewed candidate.

### Lead80 — JSONC rollback blocker queued for same owner

Quality18 reproduced MA-OC-PLUGIN-ROLLBACK-01: install-rollback.ts uses JSON.parse on forward-preserved JSONC comments, so public verification-failure rollback throws and leaves migrated config. Lead read implicated source and accepts blocker (164405/164406). Required repair preserves comments, unrelated entries and concurrent edits; parse+stringify is insufficient.85 other assertions pass with simulated effects; generated execution hash drift during owner33 invalidates earlier freshness/current fullgate claims. Owner33 is actively repairing backup/bootstrap; do not interrupt that useful work. On its outcome, continue SAME apply-deep task with this rollback finding before final qualification, then same Quality reviewer on settled candidate. Lead live canary and global acceptance remain open.

### Lead81 — large-backup candidate and rollback handoff

Read attempt33 report/source and matched scoped hashes. Adopt bounded gzip/base64 inert backup schema2 candidate for independent review:64MiB raw aggregate, existing16MiB stored budget/five transactions. Actual isolated837-file upgrade reportedly preserves17MB preimage in5.34MB private backup. Evidence165077/165078. Cold bootstrap is diagnosed, not integrated into production lifecycle. Same owner now repairs accepted Quality18 JSONC rollback and production dependency preparation; same reviewer checks frozen backup boundary independently. Global acceptance and Lead canary remain open.

### Lead82 — bounded backup approval

Read Quality19 and recomputed four frozen backup hashes: unchanged. Accept bounded backup repair approval,58 independent assertions542ms with simulated filesystem against production core, covering exact UTF-8/binary preimages,64MiB raw boundary,16MiB stored/five-transaction retention and failure/evidence preservation. Evidence166586/166587. This does not approve durability/native/global candidate; whole workspace changed during owner34 work. JSONC rollback, production cold dependency preparation and Lead live canary remain open. Same owner continues existing assignment; no interruption or duplicate task.

### Lead83 — rollback and automatic preparation candidate

Read attempt34 report/preparation source/fullgate footer;four changed hashes match. Adopt for same-reviewer recheck: JSONC rollback preserves comments/order/foreign concurrent edits; same leased native server initializes dependencies with a separate bounded60s GET /agent before unchanged10s ordinary admission. Fullgate4639pass0fail1skip57.93s. Real cold driver reportedly reaches intercepted session boundary after full admission without manual bootstrap; no inference/session request. Evidence167154/167155. Candidate frozen while Quality checks remaining rollback/preparation/plugin/generated dispositions; Lead live canary follows review. Backup19 remains bounded approved on unchanged inputs.

### Lead84 — review closure and live smoke discrepancy

Read Quality20;29 scoped hashes unchanged. Accept bounded MA-OC-PLUGIN-ROLLBACK-01 resolution and native preparation approval;172 independent assertions plus6/6 generation. Evidence168465/168466, integration168566. Lead ran `/bin/zsh /tmp/ma34-lead-canary.sh launch` on candidate37 in PTY: Launching OpenCode Developer Team, native1.18.31 UI reached empty Ask anything prompt, emitted `deck-preparation: session-start-context-unverified`, selected generic Build. Terminal query responses enabled rendering. No prompt submitted; Ctrl-C exited0. Record startup smoke only, not full Developer Team readiness. Same owner diagnoses intended pre-session behavior versus canonical fixture deficiency versus product defect, without weakening authorization. Final acceptance remains open pending disposition.

### Lead85 — explicit root agent selection

Read attempt35 report and launch args;both hashes match. Confirmed launcher omitted explicit role; adopt developer-team-only --agent deck-lead for bounded independent review. Owner native warmed repeat shows Deck-Lead with no prompt. Original cold session-start-context-unverified is not proven fixed: catch loses exception and warmed non-reproduction is insufficient. Evidence169612/169613. Same reviewer checks localized selection and diagnostic disposition; owner idle, candidate frozen. Lead rerun/global acceptance remain open.

### Lead86 — selected-agent search mismatch

Read Quality21 and preflight source. Accept MA-OC-LAUNCH-SEARCH-01: search inspection uses default_agent while actual developer-team argv selects deck-lead, allowing false rejection or missing fallback when agent providers differ. Evidence170753/170754. Same owner repairs selection propagation with both-direction public regressions. Also adopt allowlisted reason/stage diagnostic recommendation for original cold readiness warning; no raw error/context disclosure or weakened validation. Prepare fresh isolated canonical profile for Lead; warmed candidate37 repeats cannot close cold warning. All prior bounded approvals remain unchanged; final acceptance open.

### Lead87 — selected-agent and cold generation repair

Read attempt36 report and source;seven hashes match. Adopt for review: search uses same agent args as launch; startup diagnostics allowlist stage/reason; canonical config initializes missing native schema. Reported fresh reproduction showed native first-run schema insertion alone changed readiness generation, correctly causing rejection; repair avoids that mutation without relaxing validation. Evidence171883/171884. Final gate4644pass0fail1skip63.10s/types reported. Same Quality reviewer rechecks frozen delta; distinct candidate36-lead-fresh remains unlaunched for Lead. No global acceptance yet.


### Lead89 — final acceptance and fresh native canary

Accepted Quality22's bounded review (173476/173477; integration173579): all seven frozen hashes match; 287 independent assertions and canonical bundle freshness passed. MA-OC-LAUNCH-SEARCH-01 is resolved at the document level. Earlier entries above are chronological evidence, not the current outstanding-work list.

Lead launched `/bin/zsh /tmp/ma36-lead-canary.sh launch` against the previously unlaunched `candidate36-lead-fresh` fixture. Native OpenCode1.18.31 rendered the empty prompt with Deck-Lead selected and no session-start-context-unverified warning. Only terminal capability responses were sent; no prompt or inference request. Ctrl-C exited0. The fixture used isolated HOME/XDG directories and pinned temporary tooling; the user's installation was not replaced.

Implementation and scoped verification are accepted. Reused unchanged final evidence: pinned Bun1.4.0 full suite 4,644 passed, zero failed, one skipped, 63.10s; TypeScript passed. No additional implementation blocker remains in the reviewed inventory. Qualification is bounded to the recorded automated checks and macOS OpenCode live smoke; it does not claim native execution on every supported OS/runner, authenticated inference, release publication or installation into the user's live profile.


### Reopened — real OpenCode Setup upgrade failure

The user reported that the installed canary fails capability.rtk.install (safe pinned installation failure) and team.developer-team.apply (api-and-interface-design, ci-cd-and-automation and code-review-and-quality classified custom/ambiguous, followed by rollback). This contradicts completion of the user outcome; the earlier fresh-profile smoke remains valid only for that clean fixture. Final acceptance is reopened. Same Apply Deep owner must inspect actual state read-only, reproduce its upgrade shape privately, and repair the specific product causes without weakening foreign-content or pinned-artifact guarantees. No project readiness repair or live configuration deletion is authorized by this report.


### Lead95 — reproduced historical upgrade repair

Read attempt37 report and recognition source; all five hashes match (175813/175814; integration176040). Four exact historical preimages now enter existing backed-up regeneration, without granting executable trust or ownership by basename. Same Quality owner performs targeted review. Lead independently reran /tmp/ma37-real-upgrade.ts with pinned Bun and canonical TMPDIR: real pinned RTK acquisition executed and ready=true; default team valid=true, diagnostics empty, retry mutations=0, personal config preserved; exit0. Disposable fixture /private/tmp/deck-ma37-real-upgrade-E3WX7s. This verifies historical public upgrade APIs, not the user's Dashboard retry. Full gate4647pass0fail1skip/types is owner evidence on matching source. Rebuilt canary and targeted review remain pending; do not claim final completion yet.


### Lead96 — bounded upgrade review and rebuilt installed canary

Quality23 accepted attempt37 with no blocking findings (176717/176718; integration176820); Lead matched all five hashes. Independent88 assertions cover historical reconstruction, path-scoped recognition and integrity rejection. Lead95 real-download/default-team historical upgrade evidence remains valid. Recompiled and installed canary through canonical bun run canary:install with pinned Bun1.4.0, exit0, at ~/.local/bin/deck-canary. The rebuilt installed binary launched in the existing isolated native profile and rendered Deck-Lead; no prompt submitted, Ctrl-C exit0. This warmed launch is only a binary smoke, distinct from the historical public API upgrade reproduction. User's live Dashboard retry remains unobserved; no claim that live configuration has already migrated.


### Reopened — Pi Setup inventory failure

User reports Pi Dashboard codebase-memory-integrity-failed followed by invalid capability inventory and zero repair actions. Same Apply Deep owner continues targeted actual-state diagnosis and public Dashboard repair. Lead confirmed Pi owned Codebase command accessor throws on conflict/unusable; whether inventory incorrectly invokes it is under investigation. Launch integrity refusal must remain, while authorized Setup must be able to plan verified replacement of owned drift. No live user mutation or unrelated context7 readiness repair is authorized by this diagnostic. Previous OpenCode historical migration evidence remains bounded and unchanged.


### Lead98 — Pi Setup candidate

Read attempt38 report; three hashes match (177878/177879; integration178015). Actual owned Codebase release directory is empty; shared binary differs from pin. Strict command accessor throws before Setup inventory can offer existing pinned repair. Adopt Setup-only exact-sentinel catch for independent review; all other errors and launch verification remain strict. Reported full4652pass0fail1skip/types. Same Quality owner reviews the three-file delta; Lead real-acquisition public Dashboard inventory/plan/action reproduction is running. Rebuilt interactive Dashboard qualification remains pending.


### Lead99 — rebuilt Pi Dashboard qualification

Quality24 accepted bounded repair (178717/178718; integration178830); three hashes unchanged. Lead rebuilt/installed canary with pinned Bun1.4.0, exit0. On actual local profile, navigated Start installation > Pi > existing Pragmatic personality > Dashboard: integrity exception absent. Selected Codebase Memory in the in-memory review and opened Review & Install: eight planned actions, one automatic, five config, two validation; topology pending/degraded instead of invalid inventory. Did not execute installation; Ctrl-C exited. Actual defaults also expose a separate enabled Web Search conflicting MCP entry diagnostic; do not claim all Setup selections are unblocked. User's reported Web Search was disabled. Lead98 private real pinned acquisition ended executed/ready. Report scoped Pi Codebase inventory repair as verified, not completed live tool migration.


### Reopened — incomplete selected-content upgrade and Pi Web Search

User reports three additional OpenCode skill collisions (code-simplification, cognitive-doc-design, comment-writer) and Pi Web Search MCP conflict. Lead confirmed attempt37 enumerates only previous three skill preimages; default-subset reproduction did not qualify the user's selected catalog. Pi conflict was observed by Lead99 and left unresolved; disabling Web Search is not acceptance of the intended enabled configuration. Same owner must address applicable historical renderer/catalog recognition and actual provider entry migration, preserving truly foreign data, then validate complete selected plans/apply on sanitized real-state mirrors. Prior narrow tests remain valid but do not establish completed outcome.


### Lead101 — expanded installed-state qualification candidate

Reviewed attempt39 report and recognition/receipt planning source; nine hashes match. Adopt historical catalog/body-renderer recognition and Pi receipt-backed reconciliation for targeted Quality review (180667/180668; integration180877). Owner reports29/29 installed known historical names recognized,28 currently selectable. Pi actual legacy entry has matching receipt but shape-only inspection rejected historical empty environment keys. Full4657pass0fail1skip/types reported. Lead reruns sanitized actual-state mirror with all installed selectable skills and enabled Web Search; rebuilt live Dashboard qualification remains pending. No live install or full outcome completion claimed.


### Lead102 — accepted repair and installed canary

Read Quality25 (181733/181734), matched nine hashes, accepted bounded repair via181834. Independent historical provenance655 assertions and Pi planning52 assertions passed; prior Lead sanitized real-state mirror applied/verified all28 installed selectable OpenCode skills and Pi Web Search with stable retry. Full4657/types remains valid. Canonical pinned Bun canary:install completed exit0. Lead opened rebuilt actual-profile Pi Dashboard with Tavily enabled and credential detected: Review & Install now offers Run install (six actions), without the prior MCP conflict. No install action executed; exited with Ctrl-C. This proves live planning unblocked, not completed live migration; actual OpenCode apply evidence remains sanitized-mirror qualification. User may restart canary and apply the reviewed update.


### Reopened — internal skills, Codex apply and session preparation

User reports OpenCode deck-onboard/deck-archive collisions, Codex generic unknown model-configuration apply failure, missing Context7 in Codex/Pi and failed canary session preparation. Prior28 external-skill qualification omitted internal workflow skills and did not establish full multi-runner user outcome. Same implementation owner now owns internal-skill authority/full Codex TUI transaction repair. Existing Investigator performs read-only Context7/preparation diagnosis separately; stable installation must remain untouched. No further completion claim or canary delivery until integrated selected Setup paths are qualified.


### Lead104 — Context7 partial diagnosis

Reviewed Investigator4 (183202/183203), Pi capability evidence and Codex command materialization. Pi package listing lacks matching MCP server entry; Codex has an entry but execution/session exposure is unverified. Neither establishes how the state arose. Current canary preparation failure remains unattributed. Same investigator continues read-only production-path diagnosis; Apply Deep40 remains active on internal skills/Codex transaction. No readiness repair or stable installation mutation.


### Lead105 — Context7 trace and missing preparation evidence

Investigator5 reviewed (184066/184067): Pi package acquisition and MCP materialization are separate production steps; package presence alone cannot qualify selected Setup completion. Codex command exists but managed preparation also checks owned entry/verified executable. No attributable latest canary preparation diagnostic found. On Apply40 outcome, carry this evidence into same-owner full selected Context7 transaction coverage and availability repair as required; do not interrupt current internal-skill/Codex exception tracing. Ask user only for exact preparation error; other repair work remains active. No live changes.


### Lead106 — internal provenance and Codex capacity candidate

Reviewed attempt40 (184902/184903), eight hashes match. Bootstrap source recognition now includes installed historical onboard/archive bodies. Codex private actual-state probes reproduce7399 records exceeding prior4096 history limit and3.8MiB manifest exceeding role reader1MiB; bounded history16MiB/16384slots and manifest-specific16MiB candidate sent to same Quality reviewer. Full4659/types reported. Same Apply owner continues full TUI and selected Context7 transaction/preparation evidence using Investigator5 trace; latest reported preparation diagnostic remains pending user. No new canary delivered or live configuration changed.

### Lead 107 — bounded attempt40 review

- Reviewed Quality attempt26 (result 189288, end 189289); independently matched all eight current hashes in `/tmp/ma40-hashes.json`.
- Accepted internal-skill provenance and Codex history/native-manifest capacity repairs within reviewed scope. Independent evidence: 679 assertions and exact fixture regeneration from immutable snapshots.
- Full selected TUI transaction, Context7 materialization/preparation and reported prepare-session failure remain open under Apply attempt41. Prior full-suite evidence does not qualify concurrent changes. No new canary delivery or completion claim.

### Lead 108 — selected Pi transaction repair

- Reviewed attempt41 (189816/189817), source team forwarding, five changed and eight frozen hashes, and the full gate footer (4,661 passed, zero failed).
- Accepted the bounded Pi team-selection forwarding and safe capacity diagnostics. Context7 backend mirror evidence uses hermetic acquisition and does not establish native exposure.
- Continued the same implementation owner for mounted selected Setup flows, isolated preparation diagnostics and functional canary qualification. Global completion remains open; stable configuration is untouched.

### Lead 109 — installed canary qualification

- Reviewed attempt42 (190865/190866), `/tmp/ma42-report.md`, and isolated launch script; all 13 prior source hashes and installed canary SHA256 matched.
- Lead independently navigated installed canary OpenCode Setup in the sanitized mirror through Review & Install and Run install to `OpenCode Runner setup complete` (PTY 56264), then exited.
- Mounted transaction reports cover three runners with explicit Node/Pi fixture seams; native helper admission is not full daemon-session qualification. Existing 4,661-test gate remains applicable to unchanged source.
- Canary installed; stable untouched. Exact reported prepare-session failure and native Context7 exposure remain unconfirmed. No global completion claim.

### User regression — Context7 visibility and Codex rollback

- User reports Context7 absent from both Pi/Codex installation TUI and Codex apply `unknown` with rollback incomplete after attempt42 delivery.
- Prior mounted mirror evidence is insufficient for this observed outcome. Same implementation owner continued to recover actual apply/rollback causes, preserve partial evidence, remove Node fixture seam, and verify package visibility through normal UI selection.
- No live retry or cleanup authorized by this continuation; source correction and isolated reproduction continue. Global outcome remains unresolved.

### Lead 112 — actual Codex refusal identified

- Reviewed attempt43 (193795/193796); all six scoped hashes match. Context7 selector metadata and bounded diagnostics accepted.
- Actual pending epoch5 has no journal references; both apply and rollback are refused by admission. This is not recovered, and absence of references is not proof of no effects.
- Same owner continued evidence reconstruction and private-mirror recovery qualification, or concrete recovery proposal if proof is unavailable. No live fence clearing or retry.

### Lead 114 — OpenCode cross-runner evidence

- Read attempt2 handoff (196239/196240) and redacted captured events; ten scoped hashes match. User message parts were rendered as assistant; upstream retry reports regional hosting policy rejection.
- Candidate includes provider-prefixed labels and message/request correlation; independent protocol review remains underway. Startup fixture canonicalization fixes `/tmp` versus `/private/tmp` mismatch without relaxing production validation; 79 focused checks reported.
- No new canary or native-session success claimed. Browser inspection remains unavailable in the implementation environment; Codex recovery proceeds separately.

### Lead 115 — legacy Codex recovery boundary

- Read attempt44 reconstruction (196571/196572). Exact writer and seventeen matching postimages do not bind legacy pending epoch5; no live recovery achieved.
- Profile relocation is not adopted as default because it changes authentication/session paths and leaves original state blocked.
- Same owner continued a private-mirror explicit canonical recovery candidate with durable preservation of old evidence and newly declared scope; no fabricated historical binding or live fence clearing. Any necessary user adoption must have a concrete preview before approval.

### Lead 116 — OpenCode ordering repair required

- Reviewed Quality27 (197588/197589) and driver filter. Accepted OC-CORRELATION-ORDER-01: pre-identity parts are discarded before mapper classification; synthetic replay loses streaming/reasoning.
- Same owner continued bounded request-scoped buffering/replay with identity checks and lifecycle cleanup. No release approval; captured incident diagnosis and provider-label evidence remain accepted within scope.

### Lead 117 — bounded ordering candidate

- Read attempt3 (198729/198730), diff and handoff; verified driver/test hashes. Bounded turn-scoped replay and terminal cleanup adopted as candidate.
- Independent narrow recheck requested for OC-CORRELATION-ORDER-01. Pinned 86 checks/types reported; no finding closure or new canary delivery yet.

### Lead 118 — ordering review accepted

- Read Quality28 (199819/199820); both current source/test hashes match. Accepted bounded OC-CORRELATION-ORDER-01 resolution recommendation, with seventeen independent pinned checks.
- Same owner continued full-gate and canonical canary delivery qualification; concurrent Codex recovery must not be silently packaged unverified. Lead live smoke remains required. No global completion claim.

### Lead 119 — isolate OpenCode delivery

- Read attempt4 (201051/201052): compiled driver/selector probes passed, but no canary installed. Full gate on snapshot containing unfinished concurrent recovery failed; `/var` boundary failures also require canonical TMPDIR attribution.
- Same owner directed to known pre-recovery candidate tree 997ad45e009aaa03eaeba8bb8320ae382bb835ea in an isolated checkout, with pinned Bun and TMPDIR=/private/tmp. Shared worktree and live state remain untouched; delivery not approved yet.

### Lead 120 — explicit recovery candidate review

- Read attempt45 (201320/201321). Candidate creates a new explicit current scope, archives legacy fence/journal bytes and retires ten active journals. Read-only actual preview reports zero content targets; no live adoption performed.
- Independent review requested before presenting the consequential journal-pool transition for user adoption. Original epoch remains unproven; candidate gate reports 4,686 tests passing. OpenCode delivery continues independently.

### Lead 121 — OpenCode canary delivered; recovery repair continues

- Reviewed delivery5 (203083/203084), approved pre-recovery tree and 4,685-pass gate. Lead independently ran fourteen compiled driver replays, four selector checks and installed isolated daemon start/status/stop; digest eea315efbc26bf9ece675fee9b004e806fd9e1548f1b3c8f927c8f236247d649 matched. Existing sessions untouched; no inference/browser success claimed.
- Reviewed Quality29 (202952/202953). MA-EXPLICIT-RECOVERY-ADMISSION-01 remains blocking: two asynchronous preparation paths need pending-marker revalidation. Same owner continued bounded repair; no live Codex adoption.

### Lead 122 — recovery admission repair candidate

- Read Apply46 (203917/203918); all six candidate hashes match. Two missing rechecks now covered by three admission-race regressions; 49 pinned focused checks/types reported.
- Narrow independent recheck requested. Actual preview remains zero content targets and live fence/journals unchanged. No live adoption; installed OpenCode canary remains the pre-recovery build.

### Lead 123 — recovery ready for explicit adoption decision

- Reviewed Quality30 (204663/204664); six hashes match. Accepted bounded admission-race resolution recommendation.
- Lead independently ran all 49 real-filesystem recovery/guard/core tests on pinned Bun1.4.0: 586 assertions, zero failures, 9.02s including actual child death and admission races. This closes the reviewer's sandbox execution gap.
- Opened explicit user decision for original-root zero-content recovery: durable archive of pending fence/ten journals, retire active old journals, verify new current scope; abort on changed preview. No live adoption performed. Original historical outcome remains unproven.

### Recovery completion verified

- User executed MA50 externally: recovery-completed, epoch 6, ten archived journals, admission admit.
- Lead independently ran MA48 verifier with --require-complete: exit 0, verified-recovery-completed, epoch 6, ten archived journals, mode 0600, canonicalVerified true.
- Pending installation state cleared; evidence archived. Interactive Setup retry remains unverified.
