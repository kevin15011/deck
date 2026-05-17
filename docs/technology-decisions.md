# Deck — Technology Decisions

This document records the initial technology choices for Deck so future agents can keep architectural continuity.

## Current recommendation

Deck should start as a **TypeScript monorepo with a Bun-first development experience** and a CLI-first MVP.

The reason is practical: Deck needs to model declarative environments, manipulate runtime configuration, integrate with package ecosystems, validate manifests, ship prompts/assets, and later expose a Console. TypeScript keeps the CLI, core packages, schemas, adapters, and future UI in one language without forcing premature backend complexity.

Bun is preferred for Deck's own development workflow because it reduces toolchain surface area: package manager, script runner, test runner, and runtime can start from one tool. The tradeoff is compatibility: Deck should avoid unnecessary Bun-only APIs in core packages until the Pi adapter and external package ecosystem prove that Bun works reliably for the target machines.

## Core stack

| Area | Decision | Why |
|---|---|---|
| Language | TypeScript | Strong enough type system, good CLI ecosystem, shared code with future Console. |
| Runtime | Bun-first, Node-compatible core | Bun is preferred for DX and reduced toolchain surface. Core packages should remain portable enough to run under Node.js LTS if adapter/runtime compatibility requires it. |
| Monorepo | Bun workspaces | Keeps package management and scripts inside the Bun toolchain. Reconsider pnpm only if Bun workspace/package compatibility blocks the MVP. |
| Package layout | `apps/*` + `packages/*` | Matches Deck's core/adapters/environments split. |
| Build | tsup | Simple TypeScript library/CLI bundling with low config. |
| Tests | Bun test first | Minimizes tooling and is fast for TypeScript unit tests. Move to Vitest only if test ecosystem needs outgrow Bun test. |
| CLI testing | Bun test + temp directories + child processes | Lets us test real CLI behavior without heavyweight E2E tooling. |
| CLI framework | Commander | Mature, boring, enough for `deck init`, `deck doctor`, `deck install`, and adapter commands. |
| Interactive prompts | `@clack/prompts` | Polished CLI UX without committing to a full TUI. |
| Schema validation | Zod | Single source for runtime validation and inferred TypeScript types. |
| Manifest format | YAML for users, JSON Schema export for tools | Human-editable config with machine-readable contracts. |
| Logging | pino for structured logs, pretty output in CLI | Keeps diagnostics parseable while preserving friendly UX. |
| Formatting/linting | Biome | Faster and simpler than separate ESLint + Prettier for a new TS repo; independent from Bun. |

## Product architecture decisions

| Area | Decision |
|---|---|
| MVP surface | CLI first. Console is explicitly later. |
| Configuration root | Project-local `.deck/` plus a user/global config location when needed. |
| Primary manifest | `deck.environment.yaml` or `.deck/environment.yaml` — final name still open. |
| Core model | `packages/core` owns Environment, Workflow, Agent, Adapter, MemoryProvider, PackageRequirement, PromptTemplate. |
| Runtime integration | Adapter interface first; Pi adapter first implementation. |
| Memory | Deck owns a `MemoryProvider` abstraction. Engram is an adapter/provider, not a hard dependency. |
| Installer behavior | Detect first, explain planned changes, ask consent before mutating external runtime config. |
| Prompt framework | Start as deterministic rule-based routing; do not introduce LLM-dependent routing in the MVP. |

## Initial package map

```txt
apps/
  cli/                    # deck command
  console/                # future UI, not MVP-critical

packages/
  core/                   # domain model and ports
  adapter-pi/             # first runtime adapter
  memory/                 # MemoryProvider contracts and providers
  environment-development/# first environment preset
  prompt-framework/       # intention routing and workflow recommendation
  installer/              # dependency detection and installation planning
  shared/                 # shared utilities and types
```

## Implementation reference

Deck's implementation draws from an established SDD methodology and runtime configuration patterns available as a private development reference. Future agents may inspect that reference when Deck needs implementation guidance for:

- installation flows;
- runtime configuration generation;
- agents/subagents layout;
- SDD workflow structure;
- memory integration patterns;
- profiles/model configuration;
- backups and safe config mutation;
- golden tests for generated assets.

Important: The reference is inspiration and reference material, not the target architecture. Deck should keep its own product model centered on environments, adapters, providers, workflows, and manifests.

## Deferred decisions

| Question | Current stance |
|---|---|
| Go vs TypeScript CLI | TypeScript for MVP. Reconsider Go only if single-binary distribution becomes the dominant requirement. |
| Bun vs Node.js | Bun-first for Deck development. Preserve Node compatibility in core where cheap, because target runtimes and user machines may still assume Node.js LTS. |
| Turborepo/Nx | Defer. pnpm workspaces are enough until build orchestration hurts. |
| SQLite | Defer. Use files/manifests first; add SQLite only for local indexes, history, or complex state. |
| Console framework | Defer. Likely React + Vite or Next.js, but CLI must not depend on this. |
| Cloud/backend | Out of MVP. Local-first remains the base architecture. |
| Marketplace/registry | Out of MVP. Start with local packages/presets. |

## MVP technical guardrails

- Keep the core independent from Pi-specific details.
- Treat all external runtime mutations as planned operations that can be previewed.
- Prefer deterministic config generation over clever automation.
- Keep prompts, workflows, and manifests versionable as code.
- Design adapters and providers as replaceable boundaries from day one.
- Avoid adding infrastructure before a real MVP use case demands it.
