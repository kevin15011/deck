# Recreate Deck as a Rust web-first product

Current technology decision: following rejection of the initial UI, the user approved a Rust backend/launcher with React + TypeScript + GSAP presentation reuse. This supersedes the historical Rust-browser proposals below while retaining product recreation, original visual design and all AI-control contracts. Active implementation and acceptance are tracked in [the Sprint 1 brief](../sprint-01-deck2/working-brief.md).

## Intent and authorization

The user requests a separate project, a catalog of Deck as a product, and a roadmap with functional sprints for recreating it in Rust. Preserve the current web design but reimplement its technology in Rust. Do not copy the old architecture as the new architecture. The product continues to be called Deck.

Lead selected `/home/kevin15011/deck-next` as a reversible provisional workspace name and initialized an independent local Git repository. This is planning scaffolding only; no application code, framework scaffold, release, old-product mutation or remote publication is authorized by these artifacts.

## Acceptance

- Catalog cross-runner web behavior, AI authority contracts, capabilities, skills, agents, Code Economy and operational lifecycle.
- Separate existing evidence from new desired capabilities and unconfirmed interpretation.
- Preserve current visual design as the baseline for a Rust implementation, including behavior and accessibility states.
- Compare suitable Rust web approaches using current primary evidence and recommend proportionally.
- Produce functional sprint slices with explicit user value, demo, acceptance, dependencies and catalog traceability.
- Address coexistence and safe later data/content transition without assuming runtime or historical-format reuse.

## Evidence baseline

Source repository: `/home/kevin15011/deck`; the worktree has unrelated ongoing codebase-freshness changes and must be preserved. Earlier evaluation reports remain evidence, not constraints on the new solution.

Graph project: `home-kevin15011-deck`, full generation `2026-11-11T00:19:29Z`, coverage recorded `2026-11-11T00:30:15Z`. Parent exact-symbol search returned 4/4 results: developer role catalog, standalone skill catalog, SessionCommand and DriverHostIo. Five candidate paths were coverage-checked with metadata matches and no recorded issue: `packages/core/src/teams/developer/catalog.ts`, `packages/core/src/skills/external/index.ts`, `packages/core/src/session/commands.ts`, `packages/core/src/session/driver.ts`, `apps/web/src/main.tsx`.

Parent read README and developer-team guidance plus bounded configuration/skill docs. No named low-code surface was identified by the bounded symbol/doc searches; this is not an exhaustive absence claim. Its intended scope remains open.

## Status

Product direction recorded; planning repository created. Existing investigation and architecture owners are continuing their logical tasks with the new product-recreation scope:

- Investigate `task-76e6fa3d-3149-4331-a9b0-c73eacd44679`, attempt 2: product catalog, behavior guarantees and visual reference inventory.
- Architect `task-8d131b71-89c0-402b-aac3-a8d9521e3134`, attempt 2: Rust web technology options, new product architecture, roadmap and functional sprints.

Lead owns catalog, roadmap and OpenSpec writing; specialists return evidence and recommendations. Prior attempt-1 integration does not verify these new reports.

## Catalog result

Investigate attempt 2 was retrieved in full and integrated after Lead source/coverage and visual-reference review (events 15934/15935). Initial artifacts: `docs/product-catalog.md` (45 stable entries), `docs/product-contracts.md` (12 observable invariants), and `docs/design-baseline.md`. Source presence is explicitly distinguished from release maturity and live acceptance. Decision lifecycle descriptions preserve terminal-state semantics and distinguish structural host checks from model interpretation.

Architect attempt 2 completed and was retrieved for roadmap synthesis; its earlier low-code alternatives are superseded by the clarification below. Combined review follows synthesis.

## Code Economy clarification

Genuine user prompt `3280e138-1ba2-421f-9ff6-ea40c488c8b7` explains that “low code” refers to the agents' anti-overengineering/minimum-necessary-code instructions. Lead identified the canonical `code-economy` bundle, read its complete source and checked metadata-matched coverage. Decision `decision-402dcdadc608e557e324f9e5a3f56213` is answered at revision 2, disposition informational; its original source prompt `0d591538-f9c9-45e2-862f-12678ba8e588` remains preserved.

C06 now records Code Economy. The contract register has 13 invariants, including advisory code budgets and mandatory quality/completeness overrides. This is not a request for a visual workflow editor, and no such roadmap branch is included. The policy applies both to Deck's agents and to building this new product.

## Roadmap synthesis and review

Architect attempt 2 was reviewed in full and integrated (21831/21832), with the current user clarification applied. Lead checked the linked Leptos/Dioxus/web-sys primary documentation. `docs/technical-direction.md` proposes Leptos client rendering and an independent Rust host; `docs/roadmap.md` provides 12 functional sprint scopes; `docs/sprints/sprint-01.md` bounds the first native-runner conversation. These are proposals, not implementation or validated framework compatibility.

All 45 catalog IDs are mapped in the roadmap. Local links, code fences, whitespace and 13 unique invariant IDs passed validation. Code Economy is cross-cutting and appears in the first agent-writing slice, team definitions, configuration and lifecycle acceptance. Unsupported Git-write additions and visual workflow-editor scope were not adopted.

Quality continues the existing review task `task-c081e37c-4836-43db-89a6-8ee4f93e8753`, attempt 2, against the new planning documents with both source attempt-2 reports linked. Earlier review approval applies only to the superseded evaluation. Combined recreation-plan review is pending.

## Review correction and instruction-audit expansion

Quality attempt 2 returned a conditional pass (events 23761/23762). Lead reviewed the report and cited current sources and adopted the material finding: isolated Deck namespaces do not isolate global native-runner resources. Technical direction and S4/S5 now require verified native isolation or reviewed shared-resource ownership before the first materialization/configuration effect; the untouched-old-product rollback claim is conditional. Correction recheck remains pending.

Genuine user prompt `f72b365e-3594-49d2-aef0-478079dac8fa` requests auditing Deck prompts/instructions for conflicts or discrepancies, especially verification, and resolving them in the new product. This extends the planning scope; it does not request modifying the old product or implementing Rust yet. Investigate continues the same task as attempt 3 with a read-only composition/consistency audit. Lead will synthesize the evidence matrix and roadmap implications in `docs/instruction-audit.md`.

Parent graph evidence: project `home-kevin15011-deck`, generation `2026-11-11T00:51:04Z`, six exact-path coverage checks, five metadata-clean and `session/overlay.ts` partial at line 14 (read source lines 1–145). Four targeted composition functions were returned completely. Installed verification guidance was read and differs from current AGENTS timing policy; applicability and canonical-source reconciliation are delegated, not assumed. No repair, runtime change or test execution was performed.

## Instruction audit baseline and coverage completion

Investigate attempt 3 was retrieved and reviewed (26246/26247). Lead confirmed I01 in canonical skill source, installed content, OpenSpec, executable test budget and CI: 90/120/240-second rules coexist, and the skill's hard per-file threshold conflicts with diagnostic-only behavior. I02–I08 are compatible qualifications or scope/composition safeguards, not seven additional proven contradictions. `docs/instruction-audit.md` records the evidence matrix and limitations.

The report explicitly left bundled skills and prompt surfaces incompletely inventoried. Investigate continues the same logical task as attempt 4 to complete the finite Deck-distributed inventory and contextual conflict checks. Architect continues its existing task as attempt 3 to propose the smallest future composition/inspection policy and sprint acceptance; it does not duplicate the inventory audit. Source task Investigate attempt 3 is linked to Architect. Quality recheck will cover the synthesized candidate and the already corrected coexistence gap together. No production instructions were modified.

## Reliability and non-invasive runner research

The latest genuine user message adds actionable errors, error handling/logs/debugging, stability and cross-version compatibility. It requests research into plug-and-play execution that supplies globally/shared tools and skills without installing Deck content inside runners, while protecting startup and message-to-Lead responsiveness. This authorizes analysis and planning only; no native configuration mutation, installation or live performance experiment is requested.

Investigate attempt 4 was retrieved (29465/29466) and adopted as another explicitly partial report: 59 bundled bodies scanned, contextual/active-route coverage still incomplete. It adds conditional I09–I13 observations, including routing wording and Pi review capability mismatch; a keyword scan is not audit completion. The same owner continues as attempt 5 with per-runner non-invasive feasibility and completion of the finite instruction inventory. Quality continues its same task as attempt 3 for source-backed reliability/supportability review and the coexistence correction. Architect attempt 3 completed instruction design; its report remains to be reviewed and is not yet integrated.

Lead recorded scope and acceptance hypotheses in `docs/reliability-runner-research.md`, linked the charter/roadmap and added initial error/diagnostic acceptance to S1. Parent graph generation `2026-11-11T00:54:05Z`, metadata `00:59:41Z`: complete targeted searches returned 11 launch/driver/logger symbols and two recovery functions. Ten exact paths were checked; nine metadata-clean, overlay parse gap 14 already read directly. Full snippets for Codex/OpenCode launch and daemon logger support investigation entry points only, not feasibility or measured performance conclusions. No old Deck runtime changes were made.

## Managed helper-binary update requirement

The user explicitly adds update management for binaries Deck uses, naming Codebase Memory and RTK, through a web UI option and/or automatic behavior to evaluate. Lead added C15 to the catalog (now 46 entries), mapped version inspection/manual updates to S5 and evaluated optional automatic policy to S10, and recorded lifecycle/compatibility/latency acceptance in `docs/reliability-runner-research.md`. No automatic default, installation or update is authorized by these planning artifacts. Earlier 45-item validation records remain historical evidence for the earlier candidate.

Architect attempt 3, Investigate attempt 5 and Quality attempt 3 reports have been retrieved; the complete architecture and quality report artifacts were read. Their integration and synthesis are tracked separately from retrieval. Investigate still reports incomplete instruction-inventory coverage, and no report establishes measured non-invasive latency parity.

Lead subsequently reviewed and integrated Architect3 (31488/31489), Quality3 (37743/37744) and Investigate5 (33377/33378), preserving their limits. Current Codex startup mapping, outer HTTP catch and browser failure rendering were directly checked with metadata-clean coverage at graph generation `2026-11-11T01:10:34Z`. The native-resource coexistence correction is accepted; later C15 changes were outside that review. Source-qualified instructions and attempt receipts are adopted as a proposed small design, not host enforcement proof. Non-invasive support remains conditional, with no latency certification.

Investigate continues as attempt 6 solely to close the finite instruction inventory; Architect continues as attempt 4 to reconcile instructions, reliability, non-invasive shared tools and C15 updates, with Investigate5 and Quality3 linked as source reports. Lead validated the 11 Markdown documents and all 46 unique catalog-to-roadmap mappings after the C15 addition. Production code, native profiles, installations and Git commits remain untouched.

## Instruction coverage batching

Investigate attempt 6 (39401/39402) returned I14 and again explicitly incomplete inventory coverage. Lead verified Code Economy's stale opt-in/default-off header against current always-on metadata/normalization and role targets, then integrated only the bounded finding. Current graph generation `2026-11-11T01:13:15Z`, exact metadata-clean coverage for core config, Code Economy bundle and standalone catalog. The audit acceptance remains unmet; this is not an external blocker or completed comprehensive review.

Lead enumerated all 59 shipped main skill bodies (781,988 characters) and changed the work breakdown instead of repeating the whole-scope assignment. Investigate attempt 7 owns exactly eight bodies: api-and-interface-design, ci-cd-and-automation, code-simplification, debugging-and-error-recovery, deprecation-and-migration, documentation-and-adrs, frontend-ui-engineering and performance-optimization. Subsequent contextual batches and complete per-runner source composition remain to schedule with the same owner. Architect attempt 4 has completed and awaits report review. No source changes or runtime checks were made.

## Operating-model synthesis

Architect attempt 4 was retrieved completely and integrated (42572/42573). Lead created `docs/operating-model.md`, combining canonical instruction ownership, per-attempt observed tool/content identities, shared immutable Deck artifacts, scoped native exposure, C15 activation/stateful maintenance, typed failures and receipt-based recovery. These remain design recommendations, with exact native auth/history/tool-state support and measured latency unresolved. Manual activation is recommended initially, not recorded as a user-selected default.

The contract register now has 15 invariants: INV14 covers truthful actionable failures/diagnostics and INV15 protects admitted dependencies and compatible update state. INV08 clarifies renewed evaluation under applicable authority rather than an automatic duplicate permission request. The 46-entry roadmap now separates S5a/b/c and S10a/b into functional increments; S6 depends on inspect/configure and necessary preparation, not every optional update path. The first conversation retains a narrow exact-runner gate. Independent review of the new synthesized candidate follows; remaining instruction inventory is explicitly outside any completed-coverage claim.

Lead validation passed 12 Markdown documents, local link/fence/whitespace checks, 46 unique mapped catalog IDs and 15 unique invariants. Quality continues the same review task as attempt 4, with Architect4, Investigate5 and Investigate6 explicitly linked; it reviews the operating-model candidate and functional increments without certifying the unfinished full instruction inventory or runtime compatibility. No application tests were appropriate for these documentation edits.

## Bounded planning review outcome

Quality attempt 4 passed with no blocking findings (44297/44298). Lead retrieved the full report and recomputed the sorted relative-path/NUL/file-SHA256/LF manifest; it exactly matched `7fd2f6ec6d563cc75058c014e7042c5ceaf0d4a916d2a1da168752de28d698d5` across all 12 Markdown files before status edits. The reviewer checked 120 local links, three anchors, 46 catalog IDs and 15 invariants. Lead corrected its sole nonblocking observation: the catalog introduction still said 45 despite containing 46 rows.

Subsequent changes are that count correction and review-status bookkeeping; they do not constitute a new independent runtime verdict. The pass covers planning coherence and boundaries only. The pending contextual instruction batches and native/tool compatibility, visual fidelity and latency acceptance remain separate obligations. No implementation, installation, runtime tests or Git commits occurred.

## First completed contextual skill batch

Investigate attempt 7 completed all eight assigned engineering main bodies (46772/46773). Lead retrieved the full report, checked material verification/workflow/retirement/performance passages and confirmed two absent referenced checklist paths directly after coverage reported missing freshness. I15–I19 are adopted with explicit activation/project-policy conditions. Lead additionally recorded I20: frontend guidance's imperative to split components over 200 lines conflicts conditionally with advisory size/anti-fragmentation guidance.

`docs/instruction-inventory.md` now accounts for all 59 names: eight main bodies completed, 12 workflow/governance bodies assigned to the same owner as attempt 8, 39 pending. Required missing references, installed-copy comparisons and complete runner composition remain separate open coverage. Added a managed-policy-resource validation requirement to the operating model; this audit refinement follows the bounded Quality4 candidate and is not retroactively independently certified. No old source was edited.

## Governance skill batch

Investigate attempt 8 completed the 12 assigned main bodies (49794/49795). Lead reviewed the full report, inspected security approval, interview/meta-skill and UI-routing rules, and confirmed eight additional missing policy references after exact-path coverage reported missing freshness. I21 is retained only as an alias of I01; I22 extends known approval-scope evidence; I23 records conditional workflow/confirmation escalation; I24 is treated as an existing explicit Deck integration override, not an unresolved universal contradiction. Explicit user-invoked workflows remain valid.

The inventory now records 20/59 main bodies reviewed, ten exact missing policy-reference paths, 12 visual-foundation bodies assigned to the same owner in attempt 9, and 27 other bodies pending. Main-body completion does not fill missing references or certify native materialization. No old-product or runtime changes occurred.

## Visual-foundation skill batch

Investigate attempt 9 completed the 12 assigned main bodies (52689/52690). Lead reviewed the full report, checked material source passages and adopted I25–I29 with explicit qualifications: project/user/accessibility precedence governs motion and stack recipes; real-person testing is not proven to be an enforced gate; template destinations must respect existing content; inconsistent gradient permissions do not make every possible output unsatisfiable. Better UI's referenced files exist at its skill root, and no new missing policy reference was established. All cited main bodies and five material reference paths had metadata-matched coverage at generation `2026-11-11T01:38:54Z`.

The inventory now records 32/59 main bodies reviewed, 10 UI implementation/verification bodies assigned to the same Investigate task in attempt 10, and 17 other bodies pending. Complete runner composition and installed-copy comparisons remain separate open work. These findings refine the recreation plan; the old Deck source, runner profiles and runtime remain unchanged.

## UI implementation and verification skill batch

Investigate attempt 10 completed its ten main bodies (55065/55066). Lead reviewed the full report and material activation, installation, feedback, cleanup and motion-review passages, then directly confirmed five unavailable sibling skill targets linked by web-quality-audit. I18 now records 15 exact unavailable paths, distinguishing optional background references from required dependencies. I30 addresses broad live-annotation activation; motion, authorization and ownership observations extend existing causes. No report establishes actual blocking or effects merely from instruction prose.

The inventory records 42/59 main bodies reviewed, ten document/diagram/chart bodies assigned to the same Investigate task in attempt 11, and seven large visual-workflow bodies pending. Main-body and five policy-reference coverage matched graph generation `2026-11-11T01:38:54Z`; missing targets were checked directly. Complete runner routes and installed-copy comparisons remain open. No audited tool was activated, no feedback was submitted and no runtime/source change was made.

## Document and diagram skill batch

Investigate attempt 11 completed its ten main bodies (57438/57439). Lead reviewed the full report and checked dependency disclosure, table-to-HTML activation, onboarding exceptions, canvas recovery and the optional html-plan reference. I31/I32 add conditional offline-dependency and artifact-escalation concerns; other observations extend existing authority findings. The absent optional design-artifact path brings the recorded unavailable relative targets to 16. Full templates, remote API/schema correctness and portions of long references remain explicitly excluded.

The inventory records 52/59 main bodies reviewed and the seven remaining visual workflows assigned to the same Investigate task in attempt 12. All cited main bodies and five policy-reference paths had metadata-matched coverage at generation `2026-11-11T01:38:54Z`; the missing path was directly checked. No other main body awaits assignment, while complete runner composition and installed-copy coverage remain open. No generated diagram, installation, external submission or runtime change occurred.

## External main-body review complete

Investigate attempt 12 completed the remaining seven bodies (60235/60236). Lead read the full report and checked image-first requirements/exceptions, directory cleanup/ownership safeguards and proof/placeholder wording. Adopted conditional I33–I35 and existing-cause extensions. Design Lab's required template reference is unresolved at both checked local interpretations; this is one additional reference issue, not two independent defects. All 59 external main bodies now have contextual dispositions; reference implementation and external API correctness remain bounded exclusions.

The same Investigate task continues as attempt 13 for a source-composition matrix across canonical roles/capabilities, host/session guidance and four runner routes. Parent graph search returned seven composition/launch entry points with exhausted paging; the capability-bundle both-direction depth-one trace returned 16 callers and no graph callees, while the source dynamically invokes builders. This graph limitation is explicit. Exact paths were metadata-matched at generation `2026-11-11T01:38:54Z`, except the known overlay parse gap at line 14, read directly. Bundle source confirms package-ID deduplication, not whole-context prose deduplication. Installed-copy comparison follows separately; no runtime activation or native profile changes occurred.

## Partial source-route matrix and focused follow-through

Investigate attempt 13 returned a partial matrix (62134/62135), adopted with its explicit limits. Lead checked canonical mapping, Pi's Setup-only cross-runner guard, Codex Lead selection and host context append. Parent literal/source fallback located the missing delegation constructor in apps/cli/src/session-service.ts41–49 and readiness callers in native-project-readiness.ts37/internal-project-readiness.ts23. The overlay's zero-caller graph result is contradicted by these source calls; no absence conclusion is drawn.

Attempt 14 continues the same owner/task for exactly four gaps: production delegation co-delivery, Codex root/child transport, startup caller/consumer route and repository/distributed operational skills outside the 59 external bodies. It reuses completed adapter work; installed-copy comparison remains the next phase. Parent checked 19 exact paths at generation `2026-11-11T01:38:54Z`, with known parse gaps retained in the handoff. No new conflict ID or runtime certification was adopted from attempt 13, and no source/native state was modified.

## Bounded source follow-through completed

Investigate attempt 14 addressed the four named gaps (63917/63918). Lead checked sessionRolePrompt wiring at session-service102, host input2160 and Codex driver209–211, which combines descriptor instructions with rolePrompt/local context. I09 is now source-confirmed as co-deliverable: adaptive low-risk direct-work permission competes with the session's seconds-scale/trivial-only rule when applicable role guidance is loaded. The Codex root selector remains an instruction to load the Lead skill, not proof of actual loading or native root role enforcement.

Readiness startup was distinguished from OpenSpec workflow content, and five additional operational bodies were reviewed with their scoped gates preserved. Parent exact coverage checked 19 paths at generation `2026-11-11T01:38:54Z`; native readiness parse lines19–20 were read directly. The same Investigate task continues as attempt15 for a finite installed-copy comparison, preserving expected wrapper/capability differences, shared-copy identity and unknown provenance. No current-product source, runner installation or configuration was changed.

## Installed-copy base-text comparison

Investigate attempt 15 returned a partial comparison (65473/65474). Lead independently reproduced all four 59-file manifests, all canonical-prefix matches, exact Claude equality and distinct device/inode identities. Current canonical source manifest is `9a4d238af4e873ddbeffbbca82502f6d55f2ffc91b4fe8d20916b4e1c7a8bdcb`, avoiding reliance on Git HEAD alone. The inventory records every inspected root, manifest and scope limit.

Parent additionally found that leading-CR/LF normalization of suffixes leaves exactly one appended text per shared/OpenCode/Pi root. Attempt16 therefore owns three representative suffix comparisons plus role/bootstrap renderings, OpenCode prompts, receipt metadata and Claude bootstrap delivery, without repeating the 59-body scan. A pure formatter may be evaluated only after inspection rules out mutations; no installer/runtime invocation or profile changes are authorized. No new drift finding was inferred from expected whole-file differences.

## Installed capability divergence and remaining render comparison

Investigate attempt 16 reported the absence of current Codebase Memory freshness/source-fallback guidance in all three common appendices (67136/67137). Lead read the source paragraph and directly checked each representative installed suffix, adopting I36 as snapshot divergence with unknown provenance. Matching receipts do not prove current-source freshness, and difference from current development source does not by itself prove an installation defect. The inventory also records reported bootstrap prefixes, Codex selector equality and scoped receipt digest correspondence (17/17, 16/16, 16/16, 14/14).

The actual role/prompt and complete appendix rendering comparison remained unperformed. Attempt17 is narrowed to that single deterministic comparison, with explicit permission for inspected pure in-memory formatting and no installer, native launch, mutation or secret reads. Parent supplied exact composer/registry/translator entry points and current source evidence. Coverage at generation `2026-11-11T01:38:54Z` is metadata-matched; OpenCode runner-capabilities517 and Pi runner-capabilities608 retain parse gaps outside the identified manifest function ranges. No current-product files or installed instructions were changed.

## Common instruction rendering compared

Investigate attempt 17 completed the three appendix comparisons, 28 normalized role-skill bodies and seven Codex role instruction bodies under its package-selection assumptions (68617/68618). Lead reproduced both source hashes and all three current expected appendix hashes by inserting exactly the missing freshness paragraph; all matched. I36 extends to the current agent-surface freshness/reconciliation guidance. The 21 non-Codex native files contain their expected common bodies, but their wrappers were not compared.

Attempt18 is therefore restricted to those 21 runner-specific wrappers and clarifying inferred versus verified Code Economy/package selection. An expected bundle chosen from installed headings cannot alone prove package completeness. Lead added a compact resolution-to-sprint handoff covering all I01–I36 identifiers (including I21 as an alias), with representative acceptance scenarios and no implementation claims. Independent final planning review follows completion of the remaining bounded comparison; no runtime or native-profile changes occurred.

## Wrapper dispositions and final synthesis candidate

Investigate attempt 18 inspected all 21 remaining wrapper families (69976/69977), but did not prove exact rendered wrapper or tool-allowlist equality. Lead adopted those bounded dispositions and I37 after checking source applicability, support-scoped defaults, Claude selection/building, Pi's unfiltered Lead stub and all four installed role-skill sets. In particular, the report's universal always-on interpretation is qualified: Claude's allowlist excludes Code Economy and core defaults consider supported IDs. This establishes a common-baseline coverage gap, not a proven installer/normalizer failure. Shared/Codex historical package selection remains unknown.

The planning synthesis now accounts for every enumerated content/wrapper family and maps I01–I37 to proposed remedies (I21 remains an alias). The exact installed-render comparison remains partial. Its remaining byte/tool conformance and runtime delivery checks belong to exact-version native qualification in S1/S4; no claim of universal equivalence is needed for the product roadmap. This is an explicit research boundary, not a retroactive claim that the comparison succeeded. Final independent Quality review must assess whether that boundary leaves any material product-planning conclusion unsupported. The existing Quality owner will review the consolidated candidate; earlier passes do not certify these later additions.

No application code, current Deck instructions, runner profiles, installed tools or runtime state was changed. Lead retains centralized documentation ownership.

## Final independent planning review

Quality attempt 5 completed at events 71416/71417 with a pass for the bounded planning synthesis and no material findings or required corrections. Lead retrieved the full report and independently recomputed the same 13-document manifest before integration: `cd289b481ad5c5762f233ddd8cf488a029bb19cca6b220c700c82a2f8b4b30e6`. Manifest recipe: sorted relative Markdown paths, each followed by NUL, SHA-256 of file bytes and LF, then SHA-256 of the concatenation. The independent reviewer confirmed this identity both before and after review.

The reviewer accepted the explicit evidence boundary, source qualifications in I37, resolution mapping and preserved coexistence condition. Independent read-only Python validation passed for 268 local link targets, paired fences/whitespace, 46 unique catalog entries mapped to the roadmap, 15 invariants, 59 inventory names and all I01–I37 resolution identifiers. Review validation took approximately 0.06 seconds. The three source-generator hashes matched. No application tests were appropriate to the documentation-only candidate.

Lead integrated the review as event 71530. Subsequent edits only update review/status statements and this evidence record; they do not alter product requirements, technical recommendations or acceptance scenarios. The reviewed hash above identifies the pre-status-update candidate, not the final administrative bytes. Documentation structure is revalidated after those edits.

The planning request is fulfilled within the published research scope: product catalog, contracts, visual baseline, Rust direction, functional roadmap/Sprint 1, instruction conflict remedies, reliability/non-invasive runner research and helper-update lifecycle. The work does not claim implemented fixes, exact historical installation reproduction, native compatibility, observed loading/enforcement, visual fidelity or latency. Automatic-update default remains a product decision for implementation, not an assumed user choice. No native/runtime changes or application implementation were performed.
