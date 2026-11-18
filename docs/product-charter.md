# Product charter

## Direction

Recreate Deck as a product in a separate Rust project with a web-first philosophy. Preserve its useful product behaviors and AI-control guarantees without requiring a translation of the existing architecture. The product name remains Deck; the provisional project directory is `deck-next`.

The user approved the revised technology split after validating the first prototype: **Rust for the native backend and `deck2` launcher; React + TypeScript + GSAP for the browser**. This supersedes the earlier Rust-authored browser/Leptos direction. The goal remains recreation of Deck as a product, not incremental translation of the old backend architecture.

## Product continuity

Preserve the current Web UI's visual design as the reference: layout, hierarchy, typography, themes, controls, workspace panels, responsive behavior and interaction quality. Reuse and adapt its React presentation and assets to the new Rust contracts. This is not a visual redesign or authorization to copy the old backend coupling.

Inventory the product around user outcomes: cross-runner workspace, sessions and context continuity, AI authority and control, teams and agents, capabilities and tools, skill discovery/content, Code Economy, project lifecycle, runner management, bootstrap, updates, diagnostics and recovery.

The user clarified that “low code” means the existing **Code Economy** agent instructions (`code-economy`): avoid overengineering and write only the necessary code. It does not request a visual workflow editor. Preserve its decision ladder (platform/framework/existing dependency/direct solution first), advisory budgets and explicit quality/completeness overrides. This is agent guidance and a review criterion, not a runtime line-count limit.

The user also identifies actionable errors, error handling, logs, debugging, stability and version compatibility as weaknesses to address explicitly. Treat supportability and safe failure behavior as product acceptance from the first functional slice, not only a late diagnostics screen. Rust does not itself establish these guarantees.

Mandatory plug-and-play requirement (user reaffirmed 2026-11-13): Deck manages helper tools and integration content separately, and attaches integrations only to processes/sessions it launches through supported native interfaces. Normal Deck operation must not modify global native runner profiles or require globally installed Deck plugins, hooks or MCP registrations, including inherited Deck1 materialization. Preserve existing profiles and direct runner behavior; this requirement does not authorize removing legacy integrations. Per-runner feasibility must be verified, and unsupported surfaces must be reported rather than silently configured globally. Preserve startup and message-to-Lead responsiveness. Acceptance requires a clean runner profile without Deck1 contributions, working scoped helper integration, and unchanged direct runner behavior. See [reliability and runner research](reliability-runner-research.md).

Include lifecycle management of Deck-owned helper binaries such as Codebase Memory and RTK: web-visible versions, compatibility, manual updates and evaluation of an optional automatic policy. Keep this separate from native-runner modification, protect active work and preserve the responsiveness constraint. Catalog item C15 tracks this addition; implementation and automatic-policy defaults remain unselected.

## Planning principles

- Catalog product behavior before fixing module structure.
- Distinguish observed current behavior, required invariant, proposed improvement and unresolved scope.
- Give each catalog item a stable ID, user outcome, evidence, desired disposition and acceptance scenario.
- Design sprints as usable vertical slices with a demo, observable acceptance criteria, dependencies and exit gates.
- Preserve truthful runner support and distinguish host-enforced guarantees from instruction guidance.
- Maintain the old product while the new one becomes useful. No existing installation, history or credentials are migrated automatically during planning.
- Plan bootstrap and recovery even though ordinary interaction is web-first.
- Validate current design fidelity in desktop/mobile, keyboard interaction, reduced motion, loading, errors and reconnection states.
- Preserve security outcomes and authority boundaries while allowing a new implementation architecture.
- Apply Code Economy to this recreation itself: prefer direct sufficient solutions, justify new abstractions/dependencies, and never reduce code by omitting required behavior or protection.

## Initial deliverables

1. Evidence-backed Deck product catalog, including hidden behavioral contracts.
2. A Rust backend with the approved React/TypeScript/GSAP frontend and a documented interface consistent with the existing visual design.
3. Product roadmap with milestones and functional sprints traceable to catalog items.
4. Coexistence, data/content portability and transition policy.
5. A scoped first sprint ready for implementation, without treating this planning request as authorization to implement the whole roadmap.
6. Instruction-conflict resolutions and a source-qualified feasibility assessment of non-invasive runner integration, with reliability, diagnostics, compatibility and latency acceptance incorporated into the functional slices.

## Reference

Existing source workspace: `/home/kevin15011/deck`.

The earlier evaluation at `../deck/openspec/changes/rust-web-platform-evaluation/assessment.md` remains historical evidence. The latest user decision selects React presentation reuse while preserving the product-recreation direction; it does not revive an incremental port of the old backend architecture.
