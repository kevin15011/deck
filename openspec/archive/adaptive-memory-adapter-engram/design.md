# Design: Adaptive Memory Adapter with Engram Injection

## Source

- Proposal: adaptive-memory-adapter-engram proposal artifact
- Capabilities affected: adaptive-memory-injection, engram-memory-adapter, developer-team-content, developer-team-runtime-materialization, openspec-artifacts, spec-registry-events
- Spec status: not yet available

## Current Architecture Context

- Core Developer Team content lives in `packages/core/src/teams/developer/*-content.ts`; `content-registry.ts` exposes `getAgentContent(agentId)` and `getTeamSessionInstructions(teamId)` as runner-neutral strings.
- Pi materializes core content in `packages/adapter-pi/src/developer-team-install.ts` into `.pi/agents/*` and `.pi/skills/*` with fixed frontmatter `tools: read,write,bash`. Pi session instructions are written by `packages/adapter-pi/src/pi-team-profile.ts` to `.deck/pi/profiles/<team>/system-prompt.md` and launched by `pi-team-launch.ts`.
- OpenCode consumes the same registry in `packages/adapter-opencode/src/developer-team-install.ts` and wraps content with OpenCode frontmatter.
- Engram currently appears only as optional external tooling in Pi install/detection (`installation-plan.ts`, `required-tools.ts`) and as a core prompt example in `orchestrator-content.ts`; there is no memory provider contract.

## Proposed Architecture

Introduce a provider-neutral adaptive memory injection contract in core and keep provider implementations outside canonical Developer Team prompts.

- Add core types/composition helpers under `packages/core/src/memory/adaptive-memory.ts`:
  - `AdaptiveMemoryProvider { id, displayName, buildInjection(context): MemoryInjectionBundle }`
  - `MemoryInjectionBundle { instructions: MemoryInstructionFragment[], toolBindings: MemoryToolBinding[] }`
  - fragments carry `surface: "session" | "agent" | "skill"`, optional `teamId`, optional `agentIds`, and opaque `markdown`.
  - tool bindings carry provider-owned `serverName/toolNames` plus neutral capabilities (`memory.search`, `memory.read`, `memory.write`); core stores but does not interpret provider names.
- Add a core compositor, e.g. `composeAdaptiveMemory(base, bundle, context)`, that appends a clearly delimited `## Adaptive Memory (provider-injected)` section only when fragments match the materialization surface.
- Add Engram in a separate package, preferably `packages/adapter-engram/src/index.ts`, exporting `createEngramMemoryProvider()`. This package is the only place with Engram instructions/tool names.
- Extend Pi/OpenCode install/profile builders with optional `memoryProvider` or prebuilt `memoryInjection` options. Default remains undefined and produces byte-equivalent provider-neutral output after Engram examples are removed.
- CLI/TUI should pass the Engram provider only when Engram memory is explicitly selected/configured; if selection remains unresolved, expose adapter APIs first and leave UI selection as an open decision.

### Component / Module Boundaries

| Component | Responsibility | Change Type |
|---|---|---|
| `packages/core/src/memory/adaptive-memory.ts` | Provider-neutral injection types and composition | new |
| `packages/core/src/teams/developer/content-registry.ts` | Static canonical content source; no provider names | modified |
| `packages/core/src/teams/developer/*-content.ts` | Remove Engram examples/placeholders; retain auxiliary memory policy | modified |
| `packages/adapter-engram/src/index.ts` | Engram provider instructions and tool binding metadata | new |
| `packages/adapter-pi/src/developer-team-install.ts` | Compose agent/skill fragments and translate Pi tool bindings | modified |
| `packages/adapter-pi/src/pi-team-profile.ts` | Compose session fragments into system prompt | modified |
| `packages/adapter-opencode/src/developer-team-install.ts` | Compose install-time fragments for OpenCode assets | modified |
| `apps/cli/src/tui/app.tsx` | Wire selected/configured provider into Pi Developer Team install/profile | modified |

### Data Flow

1. User/config selects no memory provider or Engram.
2. Runtime adapter constructs provider injection (`createEngramMemoryProvider().buildInjection({ teamId: "developer-team" })`).
3. Adapter reads base content from core registry.
4. Adapter calls core compositor per target (`session`, `agent`, `skill`) and materializes runtime files/profile.
5. Runtime sees injected markdown and provider tool-binding hints; OpenSpec artifacts and Spec Registry remain written through existing flows.

### API / Contract Implications

| Endpoint / Interface | Change | Backward Compatible |
|---|---|---|
| `getAgentContent(agentId)` / `getTeamSessionInstructions(teamId)` | Remain static provider-neutral sources | yes |
| `composeAdaptiveMemory(base, bundle, context)` | New optional core helper | yes |
| `buildDeveloperTeamInstallPlan(...)` | Add optional memory injection/provider option | yes |
| `buildTeamSystemPrompt(...)` / `materializeTeamProfile(...)` | Add optional memory injection/provider option | yes |
| `buildOpenCodeDeveloperTeamInstallPlan(...)` | Add optional memory injection/provider option | yes |

### State / Persistence Implications

None for OpenSpec or Spec Registry schemas. Optional future provider selection persistence should be separate from this injection contract.

### Migration / Backward Compatibility

- Existing installs without provider selection continue to produce neutral prompts.
- Rollback is disabling provider option/removing Engram package registration; generated files can be re-materialized without injection.
- No data migration required.

## File Impact Estimate

| File / Path | Action | Rationale |
|---|---|---|
| `packages/core/src/memory/adaptive-memory.ts` | create | Injection contract/compositor |
| `packages/core/src/index.ts`, `packages/core/package.json` | modify | Export contract |
| `packages/core/src/teams/developer/content-registry.ts` | modify | Keep registry static and compatible with compositor usage/tests |
| `packages/core/src/teams/developer/orchestrator-content.ts` | modify | Remove `Engram` example from core prompt |
| `packages/core/src/teams/developer/*-content.ts` | modify | Remove provider-specific placeholders if found |
| `packages/adapter-engram/package.json`, `packages/adapter-engram/src/index.ts` | create | Engram provider package |
| `packages/adapter-pi/src/developer-team-install.ts`, `pi-team-profile.ts` | modify | Compose injection during materialization |
| `packages/adapter-opencode/src/developer-team-install.ts` | modify | Compose injection during OpenCode materialization |
| `apps/cli/src/tui/app.tsx` | modify | Pass selected/configured provider into install/profile flow |

## Testing Strategy

- Core unit tests for fragment filtering/composition and zero provider-name leakage in core prompts.
- Engram adapter tests assert Engram markdown/tool metadata is returned only by the Engram package.
- Pi/OpenCode materialization tests for default unchanged output and provider-selected injected output.
- CLI flow tests for selected Engram provider wiring, if UI selection is implemented.

## Observability / Error Handling

Adapters should fail closed: missing/invalid provider injection disables memory with a clear install/profile warning, not partial prompt corruption. Runtime tool-binding translation should surface unsupported bindings in plan/test output.

## Security / Performance / Accessibility Considerations

Memory instructions must prohibit secrets and reiterate OpenSpec authority. Composition is string append/filtering only; performance impact is negligible.

## Tradeoffs

| Decision | Chosen | Rejected Alternative | Rationale |
|---|---|---|---|
| Provider location | Separate Engram adapter package | Engram in core prompts | Preserves provider-agnostic core and testable leakage boundary |
| Composition point | Adapter materialization/profile using core helper | Mutating content constants | Keeps canonical content static and reusable across runtimes |
| Tool binding contract | Neutral metadata plus provider-owned names | Pi-only frontmatter strings | Reusable for OpenCode/future adapters despite adapter-specific translation |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Unknown Engram MCP contract | Medium | High | Isolate names in Engram adapter and validate before enabling UI defaults |
| Provider selection UX unresolved | Medium | Medium | Keep explicit API option; gate CLI wiring behind clear selection/config |
| Injected memory treated as source of truth | Medium | High | Mandatory injected policy: memory auxiliary; OpenSpec authoritative |
| Runtime tool-binding mismatch | Medium | Medium | Adapter tests for unsupported bindings and fail-closed behavior |

## Open Decisions

- Exact Engram MCP server/tool names and initialization commands — implementation owner must validate against Engram docs/runtime.
- Provider selection point — product/CLI owner should decide between optional tool selection, Developer Team install review, launch flag, or Configure memory.
- Injection scope — default design supports session/agent/skill; product should decide whether Engram initially targets session only or all agents.

## Dependencies

- Confirmed Engram MCP/tool contract.
- Decision on provider selection UX before end-to-end CLI acceptance.

## Next Steps

Ready for Task (`deck-developer-task`) to break this design into implementation tasks, combined with Spec.
