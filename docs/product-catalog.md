# Deck product catalog

Status: evidence-backed planning inventory with roadmap mapping and a bounded independent planning review. This describes the existing product as a reference for recreation, not its required implementation architecture. The bounded instruction-audit synthesis also passed independent planning review. Runtime parity and exact native instruction/tool conformance remain unverified.

There are 46 stable catalog entries. IDs should remain stable when descriptions or priorities change. An acceptance example is a target scenario for the new product, not a report that it has passed.

## Reading the catalog

- **Implemented:** a relevant implementation exists in the inspected source. This does not establish release maturity, complete parity or live verification; the current cross-runner surface is documented as experimental.
- **Partial:** capability, runner, surface or enforcement scope is limited.
- **Guided:** behavior substantially depends on agent instructions rather than complete host enforcement.
- **Unconfirmed:** a desired interpretation or feature is not established by this investigation.
- **Recreate:** preserve the outcome in a new design. **Redesign:** preserve the need while changing its delivery. **Later:** sequence after a usable core. None of these dispositions mandates copying code.

Source keys resolve in the evidence register below. The old source tree is an external reference, not a dependency of the new application.

## Workspace and sessions

| ID | User outcome | Current evidence/status | Target acceptance example | Disposition |
|---|---|---|---|---|
| W01 | Navigate projects and sessions | Implemented; S1, S2 | Select a project and reopen one of its sessions without losing navigation context. | Recreate |
| W02 | Register, rename and remove project entries | Implemented; S1 | Add a local project and find it by its chosen name; removing an entry does not silently delete project files. | Recreate |
| W03 | Work on desktop and mobile | Implemented; S2, S3 | At a narrow viewport, reach navigation, conversation and task controls without horizontal control loss. | Recreate |
| W04 | Select readable themes and fonts | Implemented; S3 | Change appearance while retaining usable contrast, layout and preferences. | Recreate |
| W05 | Create, rename, stop and remove sessions | Implemented; S1, S4 | Create a session for a project; stopping work has a distinct outcome from removing its history. | Recreate |
| W06 | Read conversation and streamed activity | Implemented; S2, S4 | Reconnect and recover recorded output and current task status without inventing missing messages. | Recreate |
| W07 | Queue and cancel pending prompts | Implemented; S1, S4 | Submit while work is active, then cancel pending input before delivery. | Recreate |
| W08 | Steer a supported active turn | Partial by runner; S5 | Report accepted, rejected and uncertain delivery separately. | Recreate with explicit support |
| W09 | Continue or release a session | Implemented; S1, S4 | Releasing resources remains distinct from requesting a continuation or deleting history. | Recreate |
| W10 | Carry context into native continuation or fresh execution | Partial by runner/policy; S4, S6 | If native continuation is unavailable, offer a bounded fresh handoff without claiming the same native conversation continued. | Recreate outcome |
| W11 | Associate work with a project change | Implemented; S1, S7 | Bind a session to a change and retain the association in history. | Recreate |

## AI control, agents and evidence

| ID | User outcome | Current evidence/status | Target acceptance example | Disposition |
|---|---|---|---|---|
| A01 | Assign runner and model per team member | Implemented; S1, S8 | Select an available combination and explain unavailable combinations. | Recreate |
| A02 | Work with an identifiable developer team | Implemented catalog/delegation; S4, S9 | Lead delegates bounded work and receives an attributable result. | Recreate roles and accountability |
| A03 | Apply process proportional to the task | Guided, with some structural host constraints; S9 | A small task can finish directly; uncertainty can trigger investigation or review. Do not claim the host proves the model chose well. | Recreate policy with honest enforcement |
| A04 | Approve or deny a specific requested effect | Implemented, relay/runner dependent; S1, S8, S10 | Deny an identified action and observe no authorized execution through that approval path. | Recreate with explicit scope |
| A05 | Revoke a session grant | Implemented; S1, S10 | Revocation prevents subsequent use of the affected grant. | Recreate |
| A06 | Answer or dismiss an agent question | Implemented; S1 | A response targets the pending question rather than silently becoming an unrelated prompt. | Recreate |
| A07 | Keep unresolved decisions visible and durable | Implemented host lifecycle; S11 | Defer then reopen an unresolved decision; answering requires applicable fresh input. Terminal decisions cannot be reopened as if unanswered. | Recreate semantics |
| A08 | Distinguish user input, historical evidence and instructions | Partial structural enforcement plus model interpretation; S6, S11 | A prior report cannot become fresh permission merely by appearing in continuation context. | Preserve invariant |
| A09 | Retain task ownership, attempt provenance and review evidence | Implemented host records; review truth remains human/model judgment; S4, S6 | A retry is distinguishable from the reviewed attempt; retrieval alone does not count as integration or verification. | Preserve invariant |
| A10 | Interrupt or cancel work | Implemented; S1, S4 | Show cancellation requested and its actual terminal/uncertain outcome distinctly. | Recreate |
| A11 | Avoid duplicate effects after uncertain delivery | Partial by delivery path; S4, S5, S8 | Do not automatically resend input whose delivery cannot be established. | Preserve invariant |
| A12 | Recover after host interruption | Implemented conservative recovery, with unresolved cases; S12 | Unknown process ownership prevents unsafe automatic continuation and yields an actionable status. | Preserve outcome |
| A13 | Keep launch/repair admission separate from observations | Implemented boundaries with runner-specific coverage; S4, S8, S13 | Readiness findings and stale launch evidence alone cannot authorize a mutation. | Preserve invariant |
| A14 | Understand runner-specific support honestly | Partial matrix; S14 | Unsupported behavior is unavailable with a reason, rather than simulated as supported. | Preserve truthfulness; improve coverage deliberately |

The seven current roles are Lead, Investigate, Architect, Apply Fast, Apply Deep, Quality and Setup. Their responsibility split is product input; the number, registration mechanism and storage layout are not immutable architecture. Onboard and Archive are lifecycle skills, not additional team members. See S9.

## Capabilities, skills and operation

| ID | User outcome | Current evidence/status | Target acceptance example | Disposition |
|---|---|---|---|---|
| C01 | Inspect capability availability/readiness | Partial by runner/capability; S13, S14 | Explain unavailable, stale and unknown states before relying on a capability. | Recreate |
| C02 | Make applicable tools and MCP servers available | Partial by integration; S8, S13 | Prepare the intended tool set and report failed or unsupported preparation explicitly. | Recreate |
| C03 | Discover, expose and load skills | Partial by source/runner; S15 | Locate a skill, validate current exposure and load its actual content through the permitted mechanism. Discovery metadata alone is not execution authority. | Recreate |
| C04 | Review/install Deck-managed content | Partial; administration outside web; S16 | Reject a reviewed plan if relevant state changed; preserve user-owned content. | Redesign for web |
| C05 | Configure agents, teams and capabilities | Partial existing configuration; S1, S16 | Select assignments and capabilities, preview the effective configuration and identify incompatible choices. | Recreate/redesign for web |
| C06 | Apply Code Economy to agent-written code | Implemented instruction bundle; guidance rather than hard enforcement; S25 | Relevant agents consider reuse and a direct solution, justify extra abstractions/dependencies, and retain required behavior, tests, security and accessibility even when more code is necessary. | Recreate as cross-cutting agent policy |
| C07 | Prepare a project and repair readiness | Partial; protected repair path; S13 | Diagnose first; an authorized, bounded repair is a separate operation with a result. | Recreate |
| C08 | Use project lifecycle artifacts | Partial product and agent workflow; S7, S9 | Locate relevant requirements/work state and relate execution/review evidence to them. | Recreate useful semantics; reconsider artifact internals |
| C09 | Authenticate/configure native runners | Partial native handoffs; S14, S16 | Complete the supported login flow and display actual readiness; device pairing does not substitute for runner login. | Redesign for web |
| C10 | Detect/install/update/remove native runners | Partial: detection and manual paths; no universal management | Explain installation ownership and supported operations; do not overwrite externally managed binaries. S14, S16. | Redesign and explicitly extend coverage |
| C11 | Install/start Deck on a clean machine | Implemented outside web; S17 | Bootstrap the local host and open browser onboarding without depending on an already running host. | Redesign delivery |
| C12 | Update/restart/recover Deck | Partial combined flow; separate updater and web restart; S18 | Stage, defer for active work, switch, health-check and recover with a durable outcome. | Redesign end to end |
| C13 | Diagnose and repair failures | Partial CLI/runtime coverage; S14, S18 | Explain a failed startup and offer recovery even when the web host cannot serve. | Redesign for web plus independent recovery |
| C14 | Pair and revoke browser devices | Implemented core paths; administration authority is separate; S4 | Pair, authenticate and revoke a device; revoked credentials cannot regain access implicitly. | Recreate |
| C15 | Inspect and update helper tools, including RTK and Codebase Memory | Explicit user direction: use the native updater or actual installation manager, with the same simple maintenance policy as runners. | Show installation ownership/version; expose an explicit update or exact terminal command, respect affected active work and report the result with a basic readiness check. | Implement native-first manual maintenance; optional automation is separate, not a delivery prerequisite |

Concrete current capability examples include codebase knowledge, web search, Context7, RTK and optional runner-specific tooling. The underlying providers, binaries and installation recipes can evolve. The product contract is inspectable availability, explicit selection, scoped access and truthful evidence—not preservation of every present dependency. See S13–S16.

## Supporting experience

| ID | User outcome | Current evidence/status | Target acceptance example | Disposition |
|---|---|---|---|---|
| X01 | Attach images | Implemented; S1, S19 | Validate a supported attachment and preserve its association with the submitted prompt. | Recreate after core session slice |
| X02 | Inspect Git changes | Implemented; S20 | Review project changes without treating displayed diff content as an instruction or permission. | Recreate |
| X03 | Inspect context and quota information | Partial by runner/provider; S21 | Display available data and its scope, or a clear unavailable state. | Recreate truthfully |
| X04 | Dictate a message | Partial browser/provider capability; S22 | Capture/transcribe when available and recover cleanly from denied permission or failure. | Later |
| X05 | Receive browser push notifications | Partial permission/device/server support; S23 | Subscribe or unsubscribe with honest delivery and permission state. | Later |
| X06 | Install the browser experience as a PWA | Implemented where browser supports it; S24 | Offer browser installation, explicitly distinct from installing the local host. | Later, subject to browser support |

## Product boundaries

The new product may change module boundaries, persistence choices, protocol encodings, package layout and framework. It must deliberately account for [AI-control contracts](product-contracts.md), [visual continuity](design-baseline.md), user-owned state and native runner limitations.

Native standalone workflows and Pi's broader native support need an explicit disposition before retiring the old product. Current Pi cross-session support is Setup-only; that limit is evidence about today's implementation, not a mandatory limit for the new one. Historical data import is a separate product capability to plan, not an assumption that both products will share writable state.

## Evidence register

Links reference the sibling source checkout. This catalog is source-backed planning, not live acceptance. Later implementation should snapshot selected contracts/fixtures and visual references with source revision and asset provenance.

| Key | Source |
|---|---|
| S1 | [Session commands and validators](../../deck/packages/core/src/session/commands.ts) |
| S2 | [Web workspace](../../deck/apps/web/src/workspace.tsx) |
| S3 | [Styles](../../deck/apps/web/src/style.css), [themes](../../deck/apps/web/src/themes.css), [fonts](../../deck/apps/web/src/font-faces.css) |
| S4 | [Session manager](../../deck/packages/session-host/src/session-manager.ts), [web routes](../../deck/packages/session-host/src/web-service.ts) |
| S5 | [Steering UI](../../deck/apps/web/src/steering.tsx) |
| S6 | [Task handoff](../../deck/packages/session-host/src/task-handoff.ts) |
| S7 | [SDD runtime](../../deck/packages/sdd-runtime/src), [developer workflows](../../deck/docs/developer-team.md) |
| S8 | [Driver contract](../../deck/packages/core/src/session/driver.ts) |
| S9 | [Role catalog](../../deck/packages/core/src/teams/developer/catalog.ts), [team guidance](../../deck/docs/developer-team.md) |
| S10 | [Approval contracts](../../deck/packages/core/src/session/approval.ts), [approval broker](../../deck/packages/session-host/src/approval-broker.ts) |
| S11 | [Decision service](../../deck/packages/session-host/src/decision-service.ts) |
| S12 | [Recovery](../../deck/packages/session-host/src/recovery.ts), [supervisor](../../deck/packages/session-host/src/supervisor.ts) |
| S13 | [Production preparation/composition](../../deck/apps/cli/src/session-service.ts), [project preparation](../../deck/packages/sdd-runtime/src/execution/project-preparation.ts) |
| S14 | [Support matrix](../../deck/docs/reference/support-matrix.md), [runner operations](../../deck/docs/runners.md) |
| S15 | [Bundled skills](../../deck/packages/core/src/skills/external/index.ts), [skill discovery guidance](../../deck/docs/skills.md) |
| S16 | [Reviewed runner operations](../../deck/apps/cli/src/tui/runner-dashboard/action-runner.ts), [configuration](../../deck/docs/configuration.md) |
| S17 | [Bootstrap installer](../../deck/scripts/install.sh), [release targets](../../deck/scripts/build-binaries.ts) |
| S18 | [Upgrade workflow](../../deck/apps/cli/src/upgrade-command/orchestrator.ts), [web restart](../../deck/packages/session-host/src/web-restart.ts) |
| S19 | [Image attachments](../../deck/apps/web/src/image-attachments.tsx) |
| S20 | [Git diff view](../../deck/apps/web/src/git-diff.tsx) |
| S21 | [Context display](../../deck/apps/web/src/context-window.tsx), [web quota routes](../../deck/packages/session-host/src/web-service.ts) |
| S22 | [Dictation composer](../../deck/apps/web/src/dictation/composer.tsx) |
| S23 | [Push notification controls](../../deck/apps/web/src/push-notifications.tsx) |
| S24 | [PWA installation](../../deck/apps/web/src/install-deck.tsx) |
| S25 | [Code Economy instruction bundle](../../deck/packages/core/src/teams/developer/instruction-bundles/code-economy.ts), [configuration](../../deck/docs/configuration.md) |

Investigate task `task-76e6fa3d-3149-4331-a9b0-c73eacd44679`, attempt 2, result/ended events 15934/15935, supplied the inventory. Lead reviewed the full report, decision/command contracts, related source coverage and desktop/mobile screenshots. Graph generation was `2026-11-11T00:37:12Z`; coverage is best-effort and flagged ranges were handled with source fallback by the investigator. The source worktree is shared and mutable. No runtime or browser acceptance was run.

User clarification `3280e138-1ba2-421f-9ff6-ea40c488c8b7` resolved C06: the intended feature is Code Economy, not visual workflow authoring. Lead read the full canonical bundle and checked current graph coverage. Current targets are Architect, Apply Fast, Apply Deep and Quality on agent and skill surfaces. Numeric budgets are advisory; correctness, requirements, security, error handling, accessibility, tests and maintainability override line-count reduction.
