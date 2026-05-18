# Current State

This document is the handoff point for continuing Deck work from another machine or a fresh agent session.

## Status

Deck is a Bun/TypeScript workspace for installing and launching AI development environments through runtime adapters. Team/agent definitions are runner-agnostic in `packages/core`. Both Pi and OpenCode adapters now materialize the full Developer Team.

## Architecture decisions

| Area | Decision |
|---|---|
| Runtime boundaries | `packages/core` owns canonical teams, agents, skills, workflow content, and Spec Registry types. Runtime adapters translate/materialize core definitions. |
| Pi launcher | `deck pi developer` starts a Pi session shaped for the Developer Team. `--continue` resumes the latest team session; `--resume` opens Pi's native picker in the team session context. |
| Team IDs | Developer Team agent IDs are team-scoped: `deck-developer-*`. |
| Artifacts | OpenSpec is the required source of truth for SDD artifacts. Memory systems are auxiliary only. |
| Spec Registry | A minimal registry/event model exists in core to track change state, artifact references, and provenance through `openspec/changes/{change-name}/state.yaml` and `events.yaml`. |
| Future schema | Custom schema path is `openspec/schemas/developer-team/`. |
| Memory/graph | Future memory and graph adapters must be event-driven and provenance-aware. They cannot overwrite official OpenSpec artifacts. |
| Chained PRs | Chained PR / delivery-strategy behavior is intentionally omitted for now. |
| Agent stance | Agents should act as technical peers, not yes-people: impartial, evidence-driven, and willing to challenge weak or risky assumptions. |
| Branding/personality | Repository artifacts must not reference external source branding or copied persona/tone. Deck will define its own agent identity later. |

## Implemented Developer Team agents

Real content exists for all 12 Developer Team agents:

- `deck-developer-orchestrator`
- `deck-developer-explorer`
- `deck-developer-proposal`
- `deck-developer-spec`
- `deck-developer-design`
- `deck-developer-task`
- `deck-developer-apply-general`
- `deck-developer-apply-backend`
- `deck-developer-apply-frontend`
- `deck-developer-verify`
- `deck-developer-review`
- `deck-developer-archive`

## Important paths

| Path | Purpose |
|---|---|
| `packages/core/src/teams/developer/` | Canonical Developer Team catalog, prompts, and content registry. |
| `packages/core/src/spec-registry/` | Runtime-neutral Spec Registry types, OpenSpec path helpers, and event factory. |
| `packages/adapter-pi/src/developer-team-install.ts` | Pi materializer for Developer Team agents/skills. |
| `packages/adapter-opencode/src/developer-team-install.ts` | OpenCode materializer for Developer Team agents/skills. |
| `packages/adapter-pi/src/pi-team-launch.ts` | Pi launch plan builder for team sessions. |
| `packages/adapter-pi/src/pi-team-profile.ts` | Pi profile materialization for team session instructions. |
| `apps/cli/src/cli-args.ts` | CLI command parsing for `deck pi developer`. |
| `docs/openspec-registry-roadmap.md` | Roadmap for OpenSpec, Spec Registry, indexing, future memory/graph adapters, and dashboard. |
| `docs/developer-team.md` | Developer Team architecture and implemented-agent documentation. |
| `docs/pi-agent-installation.md` | Pi installation/materialization/launcher documentation. |

## Verification baseline

In a fresh clone or session, run `bun install` first to install workspace dependencies.

Latest verified checks:

```bash
bun install
bun test packages/core/src/teams/developer
bun test packages/adapter-opencode
bun test packages/core/
bun test
bunx tsc --noEmit
```

## Model configuration

Pi Developer Team installation now includes a model and reasoning assignment flow:

- Detects configured Pi providers from environment variables (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`, `OLLAMA_HOST`, `MISTRAL_API_KEY`).
- Presents detected providers first, then curated default models per provider.
- Uses an agent-list-first flow: pick an agent, then provider, model, and Pi `thinking`/effort level.
- Shows current assignments inline as `model · thinking <level>`.
- Writes `model: provider/model` and `thinking: <level>` into agent frontmatter when assigned.
- Defaults thinking safely: `opencode-go/*` defaults to `off`; other models, including `openai-codex/*`, default to `low` unless explicitly changed.
- `deck pi developer` reads the installed `deck-developer-orchestrator` assignment and passes it to Pi as `--model <model> --thinking <level>` alongside the generated system prompt.
- Available both during installation (before Developer Team review) and from the main menu (`Configure models`).

## Next recommended task

All Developer Team agents now have real content, unit tests, and adapter materializers for both Pi and OpenCode. Consider:

1. Reviewing agent/skill content against source methodology definitions for accuracy.
2. Implementing Phase 5 features (project AI notes, `.deck/ai-notes/`).
3. Adding skill injection resolution logic in the orchestrator.
4. End-to-end testing of the full SDD workflow via `deck pi developer`.
5. Adding an OpenCode-specific team launch/session initialization path.

## Fresh-session bootstrap prompt

When continuing on another machine, ask the agent to read this file first, then inspect `git status`, `docs/openspec-registry-roadmap.md`, and `packages/core/src/teams/developer/content-registry.ts` before making changes.
