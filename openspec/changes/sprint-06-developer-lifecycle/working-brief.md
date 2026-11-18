# Sprint 6 — A complete bounded developer change

Status: corrected S6 candidate `cdfd5229…` (binary `9c1917cd…`, API 4/schema 7) is accepted and installed. Quality 19 is integrated at 173183 and S6-Q01/Q02 are resolved on both implementation and review tasks. [Acceptance and evidence](../../../docs/sprints/sprint-06-verification.md#acceptance-and-installation) record Lead’s protected tests, original-failure/corrected-pass queue comparison and successful 191.462-second actual native/browser replay. The executable was replaced atomically with a backup; no live host was restarted or state migrated. S1-Q07, S5c, broader capability/role parity and later sprint work remain outstanding.

## Outcome

From the existing browser workspace, carry a small existing-project feature through explicit intent/acceptance, reviewed implementation, real verification, independent review and completion. Also demonstrate failed verification followed by correction: a finished model turn must leave the change incomplete until current evidence supports completion. Keep all prior attempts and unresolved findings visible.

The first supported developer composition has Codex Lead as implementation owner and a separate fresh Codex Quality attempt. OpenCode investigation remains optional. This implements proportional routing for simple changes; it does not advertise unimplemented Apply Fast/Deep/Architect execution routes. Existing read-only, reviewed-edit and investigation journeys remain available.

User authorization to build this product does not grant effects in future arbitrary projects opened in it. Product authority must be explicitly recorded for the selected change, paths and effects. Preserve the current per-file Allow once boundary. Creating a scoped developer change may record permission for its finite lifecycle artifacts; project trust, historical text or a review report alone cannot grant writes.

## Source and decisions

Architect report: task `task-8d131b71-89c0-402b-aac3-a8d9521e3134`, attempt 9, events 145806/145807, SHA-256 `9393af4ca912dfda2654b5a43dd0fce280f4f9d05ccfd0b8fe871fad3bf261a5`. Lead read the complete report and matched all 104 frozen/current baseline inputs, 22 assets and installed binary. `deck-next` is unindexed across the 22 graph projects; exact-path coverage is unavailable, so reviewed frozen source is the basis.

Material seams: `crates/host/src/native.rs` currently separates policy modes and records command execution only as a count; `tasks.rs` binds Investigator operations to one running Team root; `configuration.rs` records mode-wide definitions/Investigator assignment; `decisions.rs` binds file permission to current target bytes, trust and native identity; `frontend/src/tasks.tsx` assumes OpenCode investigation. Extend these finite contracts rather than copying the old application's module architecture.

Follow [product invariants](../../../docs/product-contracts.md), [S6 roadmap](../../../docs/roadmap.md#s6--carry-a-change-through-its-lifecycle), [instruction audit](../../../docs/instruction-audit.md), and the [accepted baseline](../../../docs/sprints/sprint-05b-verification.md#acceptance-and-installation).

## Execution and evidence boundary

- Lead combines lifecycle tools with existing reviewed edits. Quality uses a separate logical owner and fresh native session, with no source-write authority. Record requested/observed runner/model and exact content/tool/qualification for both roles.
- Keep depth one and one project execution slot. Quality may inspect a frozen candidate while its parent is active, but Deck must prevent concurrent edits to that candidate. Preserve cleanup-before-release and uncertain-ownership blocking.
- Qualify real read-only checks first, such as a project's existing dependency-free Python check with bytecode writing disabled. Commands requiring dependency installation, network or build-output writes remain unavailable until separately qualified. This is a general execution limitation, not fixture-specific behavior or hard-coded success.
- Capture check evidence from validated native protocol events: connection/thread/turn/item, command, working directory, terminal result, duration and producing attempt. Agent prose and counters are insufficient. Missing, malformed, cancelled or ambiguous evidence cannot pass a check.
- Execute review/checks against an immutable bounded candidate snapshot including source, tests, required configuration/resources and relevant executable identities. Reject unsupported or unknown dependencies; do not claim hermeticity or read confidentiality beyond the qualified native boundary. Compare live inputs again before completion.

Quality judges test adequacy against acceptance. The host enforces provenance, scope, independence and state consistency; a zero exit code alone does not establish semantic correctness.

## Minimal durable records

Use ordinary typed records, not a configurable workflow language:

| Record | Required identity and behavior |
| --- | --- |
| Change | Stable project/session/change identity, intent and acceptance revision, owner, permitted paths, artifacts and completion state. |
| Attempt | Stable task/owner with fresh parent authority per attempt; preserve prior root/parent provenance, assignment, source reports and settlement. |
| Candidate/check | Exact bounded input manifest, exclusions, executable/tool identities, project-derived command source, producing attempt and observed result. |
| Finding | Stable ID, originating review, severity, affected acceptance/candidate, disposition history and resolution evidence. |
| Review/completion | Exact requirement/candidate/reviewer/report identity, cited checks, Lead treatment and host eligibility result. |

Logical continuation may use a fresh native session; do not claim native-context reuse without qualification. A retry retains ownership, findings and failed evidence. A fix claim does not close a finding. Changed requirements, inputs, commands or tools invalidate affected evidence; unknown dependency coverage invalidates the broader affected scope.

Keep execution `Phase::Completed` distinct from change completion. Completion requires current requirements/artifacts/candidate, admissible passing required checks, an independent current review, supported dispositions for required findings, and no unresolved blocking decision, uncertain effect or process ownership. Lead must explicitly treat the review and request completion. If requested while Lead is running, completion remains pending until process cleanup settles.

## Effects and OpenSpec

Retain existing ordinary UTF-8 file restrictions, single-file proposals and exact decision/native identities. Recheck current bytes and trust immediately before permission release, adding permitted change paths and requirement revision. Audit every `Mode::ReviewedEdit` check when extending the composition, including revocation, cancellation and proposal handling. No broad shell grants, file creation/rename/deletion, installation or publishing through this route.

Artifacts use a separate narrow host operation: only current Lead may publish a fixed set under `openspec/changes/<validated-change-id>/`, with recorded scoped authority, expected prior digest or absence, exact bytes and stable command identity. Quality returns review data; Lead owns artifact publication. Persist intent before filesystem effects, reconcile observed bytes after interruption, preserve external edits and report ambiguous outcomes as recovery-required. SQLite and filesystem writes are not one atomic transaction. Reject path traversal, links and changed targets.

Advance incompatible persistence/API versions when adding lifecycle state/modes. Preserve historical unknowns and admitted selection; test real predecessor rejection before mutation, migration rollback and recovery. Do not repeat S5B-Q01 by allowing old binaries to silently rewrite new authority fields.

## Instruction composition and browser

Use finite managed fragments through existing digest/receipt inspection: shared authority/provenance, Lead lifecycle role, reviewed-edit policy, independent Quality, generic verification and actual project verification selection. Deliver the canonical targeted Code Economy bundle to Quality; do not broaden it to Lead/Investigate through wrappers. Lead still follows proportional routing and necessary-code edit policy. Future role applicability stays explicit.

Apply audit I01/I02/I14/I15/I20/I37 resolutions: do not copy obsolete Deck-specific 90-second/2-second test rules into generic instructions; actual project gates/budgets come from the project. Preserve necessary correctness/security/accessibility/tests, advisory code-size signals and role targeting. Internal artifacts remain English and user responses use the user's language. Expose exact selected bodies, source/digest, applicability/exclusions and observed delivery; acknowledgment does not prove model compliance.

Add change details inside the existing React/TypeScript workspace: intent/acceptance, owner/attempts, edits/decisions, checks/findings/review, artifact contents and actionable completion prerequisites. Preserve the approved original Deck visual references, GSAP transitions, keyboard interaction and reduced motion. Reload retrieves state without replay.

## Implementation sequence and acceptance

1. Qualify developer Lead, fresh Codex Quality, native command evidence and real passing/failing read-only checks.
2. Add lifecycle records, stable ownership, candidate/check/review/finding bindings and conservative completion/recovery.
3. Connect scoped reviewed edits and Lead-only artifacts to the browser.
4. Complete real native/browser success, failure and correction journeys with retained evidence.

| ID | Acceptance |
| --- | --- |
| S6-JOURNEY | An existing project receives a real bounded feature change through reviewed proposals, independent check/review and eligible completion; no fabricated fixture success. |
| S6-FAILED | Intentionally failed verification leaves the change incomplete; correction retains owner, failed checks and unresolved finding lineage until supported disposition. |
| S6-AUTHORITY | Scope, role, native identity and current revision constrain all effects; foreign/stale/self-certified evidence and unsupported commands cannot authorize completion or mutation. |
| S6-EVIDENCE | Current candidate and project-derived checks have validated execution provenance; changed inputs invalidate affected claims and review remains independent. |
| S6-RECOVERY | Duplicate/lost acknowledgment, cancellation during permission release, delayed cleanup, artifact conflict, restart and migration failure remain durable and truthful without silent replay. |
| S6-INSTRUCTIONS | Finite role/content delivery resolves the applicable audit conflicts and remains inspectable without confusing managed fragments with full standalone-skill parity. |
| S6-EXPERIENCE | Browser exposes useful lifecycle/artifact state and missing prerequisites, preserves design/motion/accessibility, and passes real success/failure/retry journeys. |

Use focused contract tests with native/process fakes, then real qualified runner/browser acceptance. Gates come from package/Cargo manifests, `scripts/build.sh` and established verification scripts. Run the final required gate once on a matched candidate and independently re-execute protected authority/persistence boundaries. Reuse unchanged evidence with exact identity checks.

## Ownership and limits

Apply Deep task `task-181d5e85-7817-4dbd-bc81-849132576baf` owns production, tests and build evidence; it is not alone in the workspace and must preserve others' changes. Lead alone writes planning/OpenSpec and installs. Quality retains independent review. Owned disposable project fixtures may contain generated lifecycle artifacts as part of exercising the product; do not alter user projects or the planning OpenSpec from delegate work.

No commits/publication, live-user host restart, native-profile/credential changes, old Deck removal or automatic-update default. The first new Quality route and trustworthy command capture are genuine prerequisites; if unsupported, return the exact evidence gap rather than mark a lifecycle label complete. S1-Q07, broader developer-role/capability parity, S5c and later sprints remain visible.
