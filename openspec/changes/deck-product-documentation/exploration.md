# Working Brief: Deck Human-Facing Product Documentation

## Intent

Create comprehensive, honest, human-facing product documentation that makes Deck understandable and desirable without overstating current behavior. `README.md` will be the primary product landing page; detailed Markdown pages will provide exhaustive coverage through progressive disclosure.

## Acceptance

- The README presents a strong product thesis, a supported installation path, the operational runner boundary, and curated next steps before repository internals.
- The documentation covers installation, OpenCode and Pi, configuration, Developer Team, lifecycle and bundled skills, adaptive memory, OpenSpec, local skill discovery, diagnostics, updates, rollback, troubleshooting, CLI commands, and explicit support boundaries.
- The seven Developer Team roles, two lifecycle skills, and 29 bundled external skills match their source catalogs.
- Claude and Codex are described as detection-only; uninstall and `pi-hud` are not presented as shipped.
- Project-local skills are not presented as bundled content, and discovery metadata is not presented as authority.
- Product pages remain useful without future visual assets and use stable paths for later logo and real TUI screenshot integration.
- Documentation governance validates maintained pages, links, command claims, product inventories, and known support boundaries.

## Decisions

- Markdown in the repository is the canonical source.
- Repository product documentation is written in English; localization can be added later without changing the information architecture.
- `README.md` is a product landing page, not the complete documentation index.
- `docs/README.md` owns complete task-oriented navigation.
- Detailed pages each own one user-facing subject; contributor and maintainer internals remain in their existing documents.
- Public status terms are scoped: Supported, Runner-specific, Experimental, Manual verification required, Detection only, Known gap, and Not shipped.
- Current source and tests own runtime facts. Active/promoted OpenSpec owns approved requirements. Archived OpenSpec provides rationale only.
- The visual direction is a precise “technical command deck.” A future logo and real TUI screenshot may strengthen the hero, but fabricated UI or unverified metrics are prohibited.

## Relevant trace

- Product entry point and current navigation: `README.md`.
- CLI composition and command parsing: `apps/cli/src/main.tsx`, `apps/cli/src/cli-args.ts`, and command tests.
- Runner-neutral capabilities: `packages/core/src/runner-capability-registry.ts`.
- Runner implementations: `packages/adapter-opencode`, `packages/adapter-pi`, and their tests.
- Developer Team catalog: `packages/core/src/teams/developer/catalog.ts`.
- Lifecycle skills: `packages/core/src/skills/bootstrap/index.ts`.
- Bundled skill catalog: `packages/core/src/skills/external/index.ts`.
- Stable architecture boundary: `docs/architecture.md`.
- Maintainer execution boundary: `docs/developer-team-execution.md`.
- Documentation checks: `tests/documentation-governance.test.ts`.

## Risks

- Product claims can drift from parser, adapter, or catalog source.
- README can become a dense feature index instead of a clear narrative.
- Similar runner capabilities can be mistaken for universal parity.
- Internal rollout mechanics can be confused with user-visible product behavior.
- Large Markdown tables can become unusable on narrow screens.

Mitigations are source-backed tests, one owner page per topic, centralized support matrices, explicit limitations, and a rendered editorial review.

## Non-goals

- Building or selecting a documentation website framework.
- Changing runtime behavior or runner support.
- Creating the logo or fabricating a product screenshot.
- Repairing existing CLI help/version inconsistencies inside this documentation change.
- Advertising roadmap entries, unresolved skill references, or internal implementation components as shipped products.
- Rewriting historical OpenSpec or generated outputs.

## Progress

- Product and skill inventories completed from current source and tests.
- Information architecture and README narrative completed.
- Product copy, detailed pages, references, and governance checks are in Apply.

## Result target

A new evaluator should understand Deck within the README hero, reach a first supported environment through the Getting Started guide, and find exhaustive source-backed details for every shipped product system without encountering unsupported promises.
