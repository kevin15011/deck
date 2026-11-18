# Deck recreation roadmap

Status: the user now authorizes continued implementation of all planned sprints without routine confirmations. The existing acceptance gates still determine completion; this authorization is not evidence that the product is finished. The operating model, increments and bounded instruction-audit synthesis passed independent planning review. This is a product recreation with a Rust backend/launcher and the approved React/TypeScript/GSAP frontend. The user clarified that “low code” means **Code Economy**; visual workflow authoring is not included.

Sprints below are ordered delivery scopes, not calendar promises. S5 and S10 are split into functional increments below; estimate them before scheduling against actual capacity. Each increment must leave demonstrable behavior, including relevant failure handling. First ship a useful native-runner conversation, then reviewed edits, then a cross-runner team.

User-facing parity is now tracked explicitly in [the daily-use parity inventory](migration-parity.md). Previously accepted slices remain evidence for their bounded scenarios; they do not establish availability in the ordinary developer workflow. P01–P19 includes the user-reported gaps and named controls that were previously hidden inside broad sprint descriptions.

## Milestones and traceability

| Milestone | Sprint | Demonstrable outcome | Catalog coverage |
|---|---|---|---|
| M1: Useful personal workspace | S1 | Ask one native runner about a project from the React web workspace and Rust host | W01, W02, W03, W05, W06, A01, A10, A11, A13, A14, C11 |
| M1 | S2 | Review/authorize a bounded change and inspect its result | A04, A05, A06, A07, A08, A13, C06, X02 |
| M1 | S3 | Reopen, queue, continue, reconnect and recover honestly | W05, W06, W07, W08, W09, W10, A10, A11, A12 |
| M2: Coordinated developer team | S4 | Delegate between two real native runners | A01, A02, A03, A08, A09, A10, A13, A14, C02, C06 |
| M2 | S5 | Inspect/configure skills, tools and preparation | C01, C02, C03, C04, C05, C06, C07, C15, A13, A14 |
| M2 | S6 | Carry a bounded change through the developer lifecycle | W11, A02, A03, A07, A09, C06, C08 |
| M3: Installable and operable product | S7 | Manage supported runner installation/auth/configuration | C04, C05, C09, C10, A01, A05, A13, A14 |
| M3 | S8 | Complete the daily workspace and expressive input | W01, W02, W03, W04, W06, X01, X02, X03, X04 |
| M3 | S9 | Install, diagnose and recover on supported machines | C11, C13, A12, A14 |
| M3 | S10 | Update Deck and managed helper binaries safely from the browser | C12, C13, C15, A12, A13 |
| M4: Broader access and transition | S11 | Use approved additional devices and browser notifications | W03, C14, A05, X05, X06 |
| M4 | S12 | Preserve existing Deck1 data/identity and assess replacement readiness | W06, W09, W10, C03, C05, C08, C13; all catalog dispositions |

All 46 entries in [the catalog](product-catalog.md), including C15 helper-binary updates, have an initial placement. This is traceability, not proof of parity. [INV01–INV15](product-contracts.md) apply wherever their trigger exists, starting with the first external effect. [Design continuity](design-baseline.md) and Code Economy apply throughout.

The [instruction audit](instruction-audit.md) will supply evidence-backed policy corrections before relevant instruction sets are introduced: first agent behavior in S1–S2, cross-runner roles in S4, inspectable configuration in S5 and verification/lifecycle policy in S6. These are refinements to functional slices, not a separate speculative policy-platform sprint.

The [reliability and non-invasive runner research](reliability-runner-research.md) adds actionable errors, correlated diagnostics, compatibility and responsiveness acceptance from S1 onward. Evaluate shared Deck-owned tools/content supplied at launch without modifying existing runner profiles before selecting S4/S5/S7 preparation mechanisms. Runner installation/configuration in this proposed roadmap is not a settled requirement to retain today's invasive approach. Feasibility and latency remain unmeasured.

The [operating model](operating-model.md) consolidates source-qualified instruction/tool receipts, launch-scoped exposure, typed failures and coordinated update activation. The bounded [instruction audit](instruction-audit.md#proposed-resolution-handoff-by-functional-increment) maps reviewed findings to acceptance before first affected use; Quality attempt 5 passed this bounded synthesis. Exact native/tool support remains unverified; the model does not certify runtime behavior.

## S1 — Ask a native runner about a project

**Implementation status:** React/TypeScript/GSAP workspace and Rust host are installed as `deck2`; S2 now builds on the validated S1 scope. WSL recovery improvements are installed, but actual automatic Windows browser authentication remains unobserved and S1-Q07 stays open. S1-Q08 remains resolved. See [Sprint 1 evidence](sprints/sprint-01-verification.md) and the [implementation brief](../openspec/changes/sprint-01-deck2/working-brief.md).

**Demo:** launch the isolated binary, authorize a disposable project, ask an installed/authenticated runner to explain a file, watch the answer stream, reload and inspect the same recorded session.

**Scope:** one supported host platform, one runner, one active task, text input, recognizable project/session navigation, transcript/composer/status, embedded web assets, local authentication, isolated state and minimal independent recovery. No project writes, delegation, runner installer, remote access or history import.

**Dependencies:** agreed reference states and initial platform/runner/browser scope; verify a real read-only execution boundary before enabling launch. Proposed starting point is Linux x64, a compatible installed Codex and Chromium, subject to the exact-version feasibility check in [Sprint 1](sprints/sprint-01.md).

**Acceptance:** stream a real response; closing the tab does not kill the host; reload never resends; missing auth/runner and unsupported read-only enforcement block with reasons; unauthorized clients are rejected; interruption and uncertain dispatch are reported without unsafe replay.

Record the required instruction/tool identities and observed delivery without claiming full provider-prompt visibility. Preserve safe failed phase, dispatch state and correlation in errors; retain the original command identity through reconnect. Incompatible browser/API versions cannot silently dispatch. Optional helpers, their updates and native old-history reuse do not gate this slice unless its accepted scope requires them.

**Exit:** runnable Rust artifact, deterministic admission/reconnect failure evidence, real-runner acceptance and representative visual/keyboard checks. No write-capable operation enabled.

## S2 — Review and authorize project changes

**Implementation status:** bounded single-existing-file reviewed edits accepted and installed as candidate `183edadf…` after Quality's two findings were repaired and independently verified by Lead. See [Sprint 2 evidence](sprints/sprint-02-verification.md). Broad native grants and arbitrary shell escalation remain unavailable.

**Demo:** request a bounded change, inspect the proposed effect, allow or deny it, answer a question/decision and inspect the resulting diff.

**Scope:** first runner's write-capable mode, project trust, native effect/approval relay, action-bound decisions, grant revocation, cancellation and diff visibility. Inject/review Code Economy for agents writing or reviewing code. No cross-runner work or publishing.

**Dependencies:** S1 and demonstrated interception for the exact operation/runner mode. If the native runner cannot enforce the claimed approval boundary, mark that mode unavailable; do not relabel unrestricted execution as reviewed execution.

**Acceptance:** deny prevents the scoped effect; stale/wrong-action decisions fail; duplicate commands do not duplicate work; cancellation racing approval cannot revive an invalid attempt; Code Economy preserves required protections and has no hard LOC gate.

**Exit:** usable reviewed-edit flow with positive/negative authority tests and a real native acceptance check.

## S3 — Return to work and recover honestly

**Implementation status:** bounded candidate `1992f2e9…` accepted and installed after independent review and native/browser/fault checks. See [S3 evidence](sprints/sprint-03-verification.md) and the [brief](../openspec/changes/sprint-03-sessions-recovery/working-brief.md). Live steering remains unavailable; queued input is supported.

**Demo:** reopen a session, queue or cancel pending input, continue supported native context and understand recovery after interruption.

**Scope:** session history, drafts, queue management, supported continuation/steering, release, durable receipts and recovery UI. No invisible replay of uncertain input or live transfer between hosts.

**Dependencies:** S1–S2. Steering is enabled only for a verified runner path; other paths remain explicitly unavailable.

**Acceptance:** reconnect causes no duplicate invocation; missing native context offers a clearly new execution path; stale decisions remain invalid after restart; unresolved ownership blocks conflicts; corrupt/incompatible state yields actionable recovery. Release, stop and removal remain distinct.

**Exit:** user-visible continuation/recovery journeys pass deterministic crash/acknowledgment boundaries plus supported native checks.

## S4 — Delegate across two native runners

**Implementation status:** corrected candidate `830524cb…` is accepted at 125556 and installed, binary `6bed34b2…`. S4-Q01 is resolved after targeted boundary tests and real two-runner browser verification. See [evidence and limits](sprints/sprint-04-verification.md), including fresh team execution, qualified runner/model, retained task history and S1-Q07. The broader roadmap remains outstanding.

**Demo:** Lead assigns bounded work to a specialist on a second runner; the user sees owner, progress, report provenance and the Lead's explicit treatment of the result.

**Scope:** second adapter, minimal role definitions, model assignments, lineage, bounded concurrency, same-owner follow-up and exact-attempt integration. Include required role/tool materialization and Code Economy content. No general workflow language or arbitrary recursive scheduling.

**Dependencies:** S2–S3; minimal preparation belongs in this sprint rather than being postponed to S5. Before materializing native content, verify isolated runner resources or review shared ownership/collisions and protect both installations' active work, as required by [coexistence policy](technical-direction.md#coexistence-and-portability).

**Acceptance:** unsupported assignments fail before launch; cancellation targets the right task; child text cannot confer authority; retries retain distinct evidence; retrieving or integrating a report does not advertise independent verification. Adaptive routing remains guidance where the host cannot validate its quality.

Both chosen runner/role combinations must demonstrate required tool exposure and enforcement. Qualify the exact wrapper/tool restrictions and required instruction delivery; Code Economy must reach its intended roles without runner-specific omission or unintended expansion (I37). A reviewer unable to execute a required independent check leaves it pending or has that responsibility explicitly assigned to an authorized independent evaluator. Content/tool selection changes do not silently alter already-admitted work.

**Exit:** a useful task completed with two real runners and exercised delegation failure cases.

## S5 — Understand and configure capabilities

**Implementation status:** S5a/S5b and their corrections are accepted and retained. Bounded S5c Rust/Web UI integration, recovery and available-Codex consumer delivery are now [accepted and installed in97d59684](sprints/native-maintenance-verification.md#acceptance-and-installation), integration230009. S5C-Q01/Q02/Q03 and NATIVE6-Q01 are resolved. Historical native/provider evidence retains its original attribution; MiniMax429 remains a failed optional route, not a delivery dependency. Full capability/skill parity remains outstanding.

**Demo:** inspect a member's model, tools, skills and policy; understand an unavailable capability; review/apply a supported configuration or preparation change.

**Scope:** capability inventory, source-qualified skill discovery/exposure/loading, configuration forms, preparation findings and reviewed repair/install actions. Make Code Economy's effective configuration/content inspectable. No workflow graph/editor.

For C15, apply native-first manual maintenance to RTK and Codebase Memory: show installation ownership/version and update status; use the tool's supported updater or actual package manager, or offer the exact terminal command. Preserve affected active work and check the result. Historical custom lifecycle research is supporting evidence, not a requirement to build a release manager. Optional automation remains separate in S10.

**Dependencies:** S4 and current ownership/authority contracts, including the native-resource coexistence gate for every configuration effect.

**Acceptance:** missing skills and unknown readiness stay visible; metadata cannot authorize execution; denied repair changes nothing; stale plans are rejected; user content is preserved; configuration changes do not silently alter already-admitted work. Guidance is not presented as a hard code-size limit.

**Functional increments:**

| Increment | Demo and exit evidence |
|---|---|
| S5a — Inspect/configure | Explain observed instructions/tools, source revisions, ownership and readiness; supported configuration changes preserve authority and reject stale plans. |
| S5b — Manual helper update | Complete one qualified browser update; corrupt artifacts never activate, offline checks preserve usability, external ownership is preserved and admitted artifact versions remain valid. |
| S5c — Stateful helper maintenance | Update a selected shared service with coordinated admission and exclusive state ownership; unknown consumers defer activation, and failure reports compatible restoration or recovery-required. |

An inspectable/usable tool can still have an unsupported update path. S5b/c require actual acceptance of the selected helper; optional stateful maintenance does not gate unrelated product work.

## S6 — Carry a change through its lifecycle

**Implementation status:** Corrected candidate `cdfd5229…` is [accepted and installed](sprints/sprint-06-verification.md#acceptance-and-installation) as binary `9c1917cd…`: reviewed Lead edits, a fresh independent Codex Quality attempt, actual check evidence, retained findings and eligible completion. Quality 19 and Lead’s independent protected, queue/history and actual native/browser replays support closure of S6-Q01/Q02. This qualifies the bounded journey; S1-Q07 and broader role/skill parity remain open. [S5c service research](sprints/sprint-05c-research.md) continues independently.

**Demo:** take a bounded feature from intent through implementation, evidence, review and completion, with the relevant project artifacts visible in the browser.

**Scope:** accepted Developer Team roles/routing, continued task ownership, findings, evidence and useful OpenSpec integration. Preserve requirements/implementation/verification distinctions. Do not copy the old module layout or force every request through all roles.

**Dependencies:** S4, S5a and actually required preparation; optional helper-update paths do not gate the developer lifecycle.

**Acceptance:** failed verification leaves work incomplete; changed evidence invalidates affected claims; a report cannot certify itself; resumed work retains unresolved findings; simple work remains simple under Code Economy and proportional routing.

**Exit:** complete change journey and an intentionally failed-verification journey with traceable artifacts.

## S7 — Manage supported runners from the web

Current user direction applies native update/package-manager flows to **Codex, Claude, Pi and OpenCode**. MiniMax quota is not a product delivery dependency; preserve its specific failed test and verify needed behavior with an available authorized runner.

**Implementation status:** Native maintenance for all six requested targets and the bounded Codex graph consumer are accepted and installed as `97d59684…`, retaining S7a and the performance correction. See [current acceptance](sprints/native-maintenance-verification.md#acceptance-and-installation). The user's latest correction supersedes custom S7b.1 update infrastructure: use the runner's native updater or actual package manager through a small action/command handoff, with correct targeting, affected-work exclusion and a basic result/readiness check. The simplified six-target terminal handoff/version-inspection slice is complete; actual updates remain explicit native terminal actions. [Partial custom acquisition evidence](sprints/sprint-07b-verification.md) is retained without acceptance; its multi-version coordinator/rollback route is no longer a prerequisite for routine maintenance. New interactive sign-in, S1-Q07 and other runner administration remain explicit gaps. The S5c HTTP429 was specific to OpenCode/MiniMax-M2.7, not a general Codex/Claude quota limitation; that route remains a separate pending test.

**Demo:** inspect runner readiness, complete a supported native login handoff, configure models and review an installation/update operation.

**Scope:** agreed runner/version matrix, native versus cross-runner support, authentication, ownership and supported install/update/remove operations. Sequence additional runners as separate accepted slices inside this milestone if capacity requires it. No assumed universal parity or credential copying.

**Dependencies:** S4, S5a and the qualified reviewed mutation operations needed for each claimed runner path.

**Acceptance:** missing binary, unsupported version, cancelled login and failed install are distinct; failed administration never advertises readiness; sensitive data is excluded from ordinary events; external/package-manager ownership is respected; affected active work defers mutation.

**Exit:** browser management plus real acceptance for every claimed runner/version/mode. Unimplemented native/Pi workflows remain explicit release gaps.

## S8 — Complete the daily workspace

**Implementation status:** S8a appearance/themes/fonts and persisted accessible desktop split are [accepted and installed as605f4e83](sprints/sprint-08a-verification.md#acceptance-and-installation), retaining input-performance and draft/stream continuity. S8b image attachments and failure-path repairs are [accepted and installed as8a966675](sprints/sprint-08b-verification.md#acceptance-and-installation), integration240159. S8c's bounded read-only working-tree Git changes panel is [accepted and installed as9658968d](sprints/sprint-08c-verification.md#acceptance-and-installation), integration255057. The [bounded ordinary-session integration](sprints/ordinary-session-verification.md#acceptance-and-installation) is accepted and installed as93492307, with qualified Codex/image/investigate/tool/approved-existing-file editing. The user rejected that installed ordinary flow as divergent from Deck1; its acceptance records qualify bounded mechanisms, not product fidelity. [Direct restoration of original session contracts and presentation](../openspec/changes/deck-recreation/fidelity-correction.md) is now in implementation, with original theme/layout work retained for reconciliation. Remaining file/branch views, other panels, usage and voice remain outstanding; this is not full S8 or visual parity.

**Demo:** navigate accepted panels and themes, attach an image, inspect a Git diff and available usage, and dictate text where the chosen browser/transcription path supports it.

**Scope:** W01–W04 fidelity completion, remaining W06 transcript conveniences, cataloged panels, attachments, read-only diffs, honest context/quota data and voice. Preserve the existing code-copy toolbar and applicable GFM formatting beyond Sprint 1's common headings/emphasis/lists/code; evaluate external-link navigation against the original behavior. These are deferred fidelity work, not removed product requirements. No general IDE or new Git-write actions inferred from diff viewing.

**Dependencies:** relevant session/team/preparation behavior from S2–S7. Split expressive-input integrations into smaller functional slices if needed before scheduling.

**Acceptance:** rejected attachments are safe and clear; denied microphone access retains text input; unavailable usage is not fabricated; rapid switching preserves draft/focus; desktop/mobile, keyboard and reduced-motion behavior match agreed references.

**Exit:** accepted daily-workspace scenario corpus and visual evidence, with browser support limitations recorded.

## S9 — Install and recover on supported machines

**Demo:** install a packaged build in isolation, open browser onboarding, diagnose a startup failure and recover without relying on the broken web host.

**Scope:** production packaging, explicit OS/architecture matrix, launcher/service ownership, clean installation, diagnostics and removal. S1 already supplies a development artifact. No automatic stable-Deck replacement or unrequested background-service activation.

**Dependencies:** S7–S8 and an accepted release scope.

**Acceptance:** install works without the development toolchain; conflicts/unwritable paths are actionable; failure leaves recoverable state; browser closure preserves work; removal preserves user data unless explicitly selected.

**Exit:** reproducible candidate and clean-machine installation/recovery evidence for each claimed platform.

## S10 — Update Deck and managed tools safely from the browser

**Demo:** review an update, wait for admissible idle state, apply it and reconnect to the persisted result.

**Scope:** artifact verification, installation ownership, preparation, independent handoff helper, target health and compatible rollback. No seamless active-task transfer or rollback across incompatible data without a tested conversion path.

Extend the S5 manual helper-binary flow with evaluated notification-only/manual and opt-in automatic policies for Deck-owned tools such as Codebase Memory and RTK. Reuse update operation and diagnostic concepts where suitable, while respecting tool-specific service/client and stored-state compatibility. No default automatic policy is selected yet.

**Dependencies:** S10a depends on S3/S9. S10b depends on qualified S5b/S5c operations as applicable, policy enforcement and adequate independent recovery; it does not inherently depend on Deck self-update.

**Acceptance:** affected work defers update; changed preconditions invalidate preparation; corrupt download fails; interruption during replacement/startup is recoverable; retries return the same operation outcome; failed health checks never report success; later user edits are not clobbered by rollback.

For helper binaries, an active task retains a valid admitted tool/service combination or activation waits for affected work to settle. An incompatible candidate or externally owned installation is not silently replaced. Background update checks/preparation do not become a synchronous prerequisite for sending a message to Lead. Automatic actions remain within the current configured policy and recheck compatibility and ownership before activation.

**Exit:** packaged-artifact update/rollback matrix passes every defined durable handoff boundary.

**Functional increments:**

| Increment | Demo and exit evidence |
|---|---|
| S10a — Deck self-update | Independent handoff, reconnect and recovery across each durable boundary; failed target health never reports success. |
| S10b — Optional automatic helper policy | Automate qualified manual operations within a scoped policy; revocation, new active work or changed compatibility prevents activation. Manual recovery remains available. |

Stateful helpers may remain manual when automated recovery cannot be demonstrated. Recommend manual activation initially; default notification/network checks and automatic policy remain unselected product choices.

## S11 — Access from approved devices

**Demo:** pair an additional device, use the responsive workspace, enable supported notifications/PWA installation and revoke access.

**Scope:** explicit secure access model, device identities, revocation, remote administration policy and supported push/PWA behavior. Responsive layout started in S1. No implied offline native execution.

**Dependencies:** S8–S10; decide administrative privileges before exposing remote mutations.

**Acceptance:** unpaired access fails; revocation affects ongoing access; reconnect preserves authoritative outcomes; denied notification permission leaves a useful UI; background limitations are disclosed; PWA installation is distinct from native-host installation.

**Exit:** actual browser/device support matrix with negative-access, permission and reconnect evidence.

## S12 — Preserve existing Deck1 data and replacement identity

**Priority correction:** existing-user compatibility is now required by prompt859b73f0-a31b-42c8-a7b6-8741b7ad2f55 and starts immediately alongside current delivery, rather than waiting for a final optional import. Earlier sprint isolation describes their historical test scope, not the final product contract.

**Demo:** open existing projects and session history, retain theme/font/model settings, continue supported sessions, and later replace Deck1 at its original URL without requiring users to recreate their installed app and access configuration.

**Scope:** compatible/shared projects, sessions/history/attachments and settings; Deck1-authoritative data with disposable experimental Deck2 state; model reuse; origin-local preference continuity; PWA, Tailscale and notification/device identity. Keep separate URLs/ports during current coexistence. Shared paths/writes are explicitly permitted; prefer direct reuse of compatible Deck1 storage with source-backed format adaptation and necessary writer ownership. Do not require merging or synchronizing experimental Deck2 state. No duplicate active work or historical authorization replay; no deletion of the old installation.

**Dependencies:** inspect actual original and Rust formats/ownership and browser identity contracts. Source compatibility constrains the transition implementation. A read-only history bridge can be incremental progress but does not complete shared read/write behavior.

**Acceptance:** existing data and concurrent user changes survive; stable identities and supported continuation remain usable; malformed/colliding records are reported without loss; interrupted transitions recover; current hosts coexist without destructive interference; eventual same-origin takeover preserves qualified app/access/notification behavior. Explicitly record unsupported cases instead of silently resetting users.

**Exit:** accepted catalog disposition, verified compatibility/coexistence and replacement journey. Retiring the old installation remains separate. See [the compatibility working brief](../openspec/changes/deck-recreation/fidelity-correction.md).

**Final maintenance phase:** after the currently planned migration work, qualify storage cleanup/compression. User-approved retention applies to sessions already deleted by the user: permanent removal after30days from deletion, not age or inactivity. Preserve deletion timestamps through migration and protect restored/nondeleted sessions and shared references. No live purge or retention implementation now; this work must not delay the current migration sequence.

## Definition of done for each functional slice

- Demonstrate its user journey through the React/TypeScript web application and Rust backend, including at least one relevant unhappy path.
- Satisfy applicable product contracts before enabling the corresponding effect.
- Preserve relevant visual, keyboard, responsive and reduced-motion behavior.
- Apply Code Economy: prefer existing platform/project capabilities and direct solutions; justify complexity; do not omit requirements to shrink code.
- Record evidence against the actual candidate, separating deterministic tests, native-runner checks and browser observations.
- Define limitation, retry/recovery and coexistence behavior. A mock-only success is not native runner acceptance.

Establish actual Rust native and React browser build, format/static, test and packaging commands from the new manifests/CI. Do not copy unrelated old-project verification gates. This roadmap supplies ordered scope, not calendar commitments; current implementation status is recorded per sprint.

## Decision state and provenance

Confirmed: product name Deck, separate product recreation, Rust backend/launcher, React/TypeScript/GSAP browser, preservation of current visual design, Code Economy meaning and provisional command `deck2`. The user-approved React direction supersedes the earlier Leptos choice. `deck-next` remains the technical workspace name. The initial Linux/Codex 0.166.0/Chromium slice and SQLite have bounded implementation evidence; actual WSL opening is under correction. Wider support and remote administration require qualified evidence. Existing-user data and eventual web-identity preservation are required by the later compatibility correction above. The latest user instruction authorizes continuing all sprints, with actual running Deck screenshots as the design reference; it does not request reverting the approved React frontend to Rust.

Source proposals: Investigate attempt 2 (15934/15935), Architect attempt 2 (21831/21832). Lead reconciled their catalog references and applied the genuine user clarification `3280e138-1ba2-421f-9ff6-ea40c488c8b7`. The clarification decision is answered/informational, not implementation permission. Proposed Git-write additions and visual workflow-editor branches were not adopted.
