# Design: Add Supermemory MCP Memory Provider

## Source

- Proposal: `add-supermemory-mcp-memory-provider` proposal artifact
- Capabilities affected: `supermemory-provider-selection`, `supermemory-install-token-configuration`, `supermemory-pi-runtime-integration`, `supermemory-adaptive-context`, `adaptive-memory-governance`, `adaptive-memory-provider`, `installer-memory-provider-configuration`, `sdd-phase-context-assembly`, `openspec-artifact-authority`, `sdd-phase-workflow`, `engram-provider`
- Spec status: available — completed artifact exists; apply feedback and MCP validation have refined design details

## Current Architecture Context

- Deck is a Bun/TypeScript workspace with runtime-neutral Developer Team content in `packages/core` and runtime materializers in adapters.
- Existing adaptive memory support is injection-oriented:
  - `packages/core/src/memory/adaptive-memory.ts` defines `AdaptiveMemoryProvider`, `MemoryInjectionBundle`, `MemoryInstructionFragment`, `MemoryToolBinding`, `resolveMemoryInjection()`, and `composeAdaptiveMemory()`.
  - `packages/adapter-engram/src/index.ts` implements an experimental Engram provider by returning prompt fragments plus Pi MCP tool bindings.
  - `packages/adapter-pi/src/developer-team-install.ts` composes memory instructions into generated `.pi/agents/*.md` and `.pi/skills/*/SKILL.md`, appending memory tool names to Pi frontmatter when matching fragments exist.
  - `packages/adapter-pi/src/pi-team-profile.ts` composes session-level memory instructions into `.deck/pi/profiles/<team>/system-prompt.md`.
  - `apps/cli/src/pi-launch-command.ts` materializes profile + Developer Team files on launch when a memory provider is passed.
- Provider selection was originally launch-flag based (`--memory=engram|none`) and Engram-only in Pi allowlists. Apply/exploration indicate new non-secret Deck config and TUI selection work exist, but the Pi launch/provider wiring and Supermemory runtime provider remain incomplete.
- `.deck/config.json` is the project-local Deck config boundary for non-secret settings only. It must reject token/API-key/credential fields recursively.
- The current TUI Supermemory handoff path was a stub: it redacted the token and persisted non-secret settings, but did not configure Pi MCP or make Supermemory usable.
- Pi materialization currently writes:
  - tool names into generated `.pi/agents/<agent>.md` frontmatter;
  - memory instructions into `.pi/agents`, `.pi/skills`, and `.deck/pi/profiles`;
  - no MCP server definition for Engram or Supermemory.
- User decision for this design update establishes the real external Pi MCP credential/config path: `~/.pi/agent/mcp.json`.
- Validated Supermemory MCP behavior from `mcp-validation-report.md`:
  - remote HTTP MCP endpoint: `https://supermemory-new.stlmcp.com`;
  - server exposes real tools `execute` and `search_docs`;
  - provisional tools `context`, `recall`, and `memory` do not exist and must not be exposed;
  - `initialize` and `tools/list` can succeed without credentials;
  - authenticated provider availability requires the API token via `x-supermemory-api-key` or equivalent behavior and a read-only `execute` probe;
  - metadata/container behavior is advertised through SDK operations called via `execute`, but authenticated metadata/container validation remains incomplete without a valid token.
- OpenSpec remains authoritative in Developer Team prompt content, especially `packages/core/src/teams/developer/orchestrator-content.ts`; adaptive memory must remain advisory.

## Proposed Architecture

Extend the existing provider-neutral memory layer and Pi materialization path, then add a Pi-specific MCP config writer for Supermemory credentials. Keep OpenSpec authority in core prompts and treat Supermemory as an advisory provider selected by configuration or explicit launch flag.

### Core decisions

1. **Provider-neutral contract evolves in `@deck/core`**
   - Keep existing injection primitives for backward compatibility.
   - Add adapter-level types around advisory operations and governance: provider identity, injection bundle, active-provider config resolution, health diagnostics, context/search/commit operation shapes, scope, container, metadata, and commit-policy validation.
   - Engram and Supermemory adapt to this contract; provider-specific MCP names stay outside core.

2. **Supermemory lives in a separate adapter package**
   - Add `packages/adapter-supermemory` with `createSupermemoryMemoryProvider(config)`.
   - Use validated MCP tool names only: `execute` and `search_docs`.
   - Do not expose provisional `context`, `recall`, or `memory` tool names.
   - Encapsulate SDK snippets, health-check behavior, container tags, metadata filters, query strategy, thresholds, and commit guidance in this package.
   - Constrain the generic `execute` tool through prompt instructions: agents may use it only for scoped Supermemory SDK operations described by the provider, not arbitrary execution.
   - Do not let SDD prompt/content modules call Supermemory tools directly.

3. **Single active provider is resolved before Pi materialization**
   - Add one resolver used by CLI/TUI launch/install paths.
   - Precedence: explicit CLI flag (`--memory=...` / `--memory=none`) > project Deck config > `none`.
   - The resolver returns at most one provider instance plus diagnostics. Unsupported IDs fail closed and produce no provider injection.
   - Pi is the first runtime to consume this resolver; other runtime adapters remain unchanged for this change.

4. **Persist project selection only as non-secret Deck config**
   - `.deck/config.json` stores only non-secret memory settings.
   - Store one scalar active provider (`none`, `engram`, or `supermemory`) and non-secret provider settings such as `userId`, optional `teamId`/`orgId`, optional `projectId` once derivation is approved, MCP server name, and search defaults.
   - Never store the Supermemory token, API key, or equivalent credential in `.deck/config.json`, generated `.pi` files, `.deck/pi` files, OpenSpec artifacts, tests, logs, TUI summaries, or apply progress.

   Proposed non-secret config shape:

   ```json
   {
     "version": 1,
     "adaptiveMemory": {
       "activeProvider": "supermemory",
       "supermemory": {
         "mcpServerName": "supermemory",
         "userId": "required-user-id",
         "projectId": "optional-or-derived-project-id",
         "teamId": "optional-team-id",
         "orgId": "optional-org-id",
         "searchMode": "memories",
         "maxMemoriesPerSession": 7
       }
     }
   }
   ```

5. **Installer/TUI writes Supermemory credential to Pi global MCP config**
   - Use Pi's global MCP config path `~/.pi/agent/mcp.json` as the external Pi MCP credential/config path for Supermemory.
   - This file is outside the project repository and outside `.deck/config.json`.
   - Add a Pi adapter MCP config module, e.g. `packages/adapter-pi/src/pi-mcp-config.ts`, that can read, merge, validate, and atomically write this external JSON file.
   - Installer/TUI replaces the previous credential handoff stub with a real write/update of a `supermemory` MCP server entry using:
     - HTTP transport URL: `https://supermemory-new.stlmcp.com`;
     - header: `x-supermemory-api-key` with the token entered by the user;
     - MCP server name from Deck config, defaulting to `supermemory`.
   - The writer must preserve unrelated existing MCP server entries, update only the `supermemory` entry, and fail closed on malformed/conflicting config unless repair is unambiguous.
   - Prefer restrictive permissions when possible:
     - create parent `~/.pi/agent` with user-only access when possible;
     - write `~/.pi/agent/mcp.json` with `0600`-style owner read/write permissions where the platform allows it;
     - warn, without logging the token, if permissions cannot be restricted.
    - The token may be persisted only in this external Pi global MCP config because the user explicitly approved that handoff path. This is a runner-installation secret, not project state and not AI/OpenSpec memory; it must still be redacted from all Deck-controlled output.

   Target external Pi MCP entry shape should align with Pi's MCP schema. The design-level contract is:

   ```json
   {
     "mcpServers": {
       "supermemory": {
         "transport": "http",
         "url": "https://supermemory-new.stlmcp.com",
         "headers": {
           "x-supermemory-api-key": "<redacted in logs; actual token in external file>"
         }
       }
     }
   }
   ```

   If Pi requires a slightly different schema key for streamable HTTP transport, isolate that mapping inside the Pi MCP config module rather than leaking it into TUI/core.

6. **Health and injection are gated by real configuration**
   - TUI install can write `.deck/config.json` and `~/.pi/agent/mcp.json` in one flow.
   - Launch/install should inject Supermemory tools only when:
     - `.deck/config.json` selects Supermemory and has required non-secret identity (`userId`);
     - the Pi MCP config contains a usable `supermemory` server entry;
     - validated Supermemory tool mapping is available (`execute`, `search_docs`);
     - optional runtime health checks do not fail.
   - Connectivity-only checks are insufficient because unauthenticated `initialize`/`tools/list` can succeed. Full availability requires an authenticated read-only `execute` probe where feasible.
   - If config/health validation fails, launch/install continues with OpenSpec-only context and no Supermemory injection, plus a redacted warning.

7. **SDD context assembly remains explicit and authority-safe**
   - Keep official OpenSpec artifact loading unchanged.
   - Add/use a core rendering helper for phase prompt sections so orchestrator/phase prompt content consistently describes:
     - `OFFICIAL CONTEXT` = OpenSpec/spec registry/code/tests;
     - `ADAPTIVE CONTEXT` = provider advisory context;
     - `RULE` = OpenSpec authoritative, adaptive memory advisory, do not modify specs based only on memory.
   - For Pi, Supermemory retrieval is performed by agents through MCP tool bindings and provider instructions; Deck materializes instructions/tools but does not make Supermemory authoritative.

8. **Governance is enforced at adapter boundary and prompt boundary**
   - Core validates metadata shape, confidence range, allowed scopes/types, container tag characters, and 100-character container-tag limit.
   - Supermemory adapter emits scoped container guidance and metadata-filter instructions using SDK operations invoked through `execute`.
   - Commit behavior saves only high-signal learnings, max 3-7 per session.
   - Team memories are written only as `candidate` unless a future approved promotion flow exists.
   - No Engram memory migration is performed in this change.

### Component / Module Boundaries

| Component | Responsibility | Change Type |
|---|---|---|
| `packages/core/src/memory/adaptive-memory.ts` | Existing injection primitives, provider resolution, composition | modified |
| `packages/core/src/memory/adaptive-memory-contract.ts` | Provider-neutral context/search/commit operation types and diagnostics | new |
| `packages/core/src/memory/adaptive-memory-governance.ts` | Scope, metadata, container-tag, and commit-policy validators | new |
| `packages/core/src/memory/adaptive-context-renderer.ts` | Official/adaptive context section renderer and authority rule text | new |
| `packages/core/src/config/deck-config.ts` | Read/write/validate `.deck/config.json` memory config while rejecting secrets | new/modified |
| `packages/core/src/teams/developer/*-content.ts` | Prompt guidance for official/adaptive context separation and memory authority | modified |
| `packages/adapter-engram/src/index.ts` | Engram provider adapted to the common contract where needed; no migration | modified |
| `packages/adapter-supermemory/src/index.ts` | Supermemory provider factory, validated MCP mapping (`execute`, `search_docs`), instructions, containers, metadata policy | new |
| `packages/adapter-pi/src/pi-mcp-config.ts` | External Pi MCP config reader/writer for `~/.pi/agent/mcp.json`, Supermemory server entry, redaction, permissions | new |
| `packages/adapter-pi/src/developer-team-install.ts` | Pi install materialization accepts Supermemory provider only after usable config/health | modified |
| `packages/adapter-pi/src/pi-team-profile.ts` | Pi session prompt supports Supermemory adaptive context | modified |
| `apps/cli/src/cli-args.ts` | Accept `--memory=supermemory`; preserve `--memory=engram` and `--memory=none` | modified |
| `apps/cli/src/main.tsx` | Resolve active provider from CLI/config and construct Supermemory provider | modified |
| `apps/cli/src/pi-launch-command.ts` | Resolve/apply single active provider for Pi; verify/redact Pi MCP diagnostics | modified |
| `apps/cli/src/tui/app.tsx` | Install-time provider selection, Supermemory token prompt, identity capture, Deck config persistence, Pi MCP config handoff | modified |
| `apps/cli/src/tui/screens/developer-team-screens.tsx` | Memory provider selection and Supermemory setup UI; no review/promote UI | modified |
| `docs/pi-agent-installation.md` | Document Pi-first Supermemory MCP setup, external global MCP config, redaction/fallback, and authority model | modified |
| Non-Pi runtime adapters | No first-target integration in this change | unchanged |

### Data Flow

1. **Install/configure for Pi**
   - User enters TUI installation flow.
   - After team/model selection, Deck shows adaptive memory choices: `None`, `Engram`, `Supermemory MCP`.
   - If Supermemory is selected, Deck prompts for the Supermemory token, requires `userId`, accepts optional `teamId`/`orgId`, and collects other non-secret settings.
   - Deck writes `.deck/config.json` with `adaptiveMemory.activeProvider = "supermemory"` plus non-secret provider settings only.
   - Deck invokes the Pi MCP config module with the token and non-secret server name.
   - The module reads `~/.pi/agent/mcp.json` if present, preserves unrelated config, writes/updates `mcpServers.supermemory`, and sets the HTTP URL/header contract.
   - The module writes atomically where possible and applies restrictive permissions where possible.
   - UI/apply-progress/log output reports only redacted status such as `Supermemory MCP server configured at ~/.pi/agent/mcp.json`; it never prints the token or raw header value.
   - Deck may run a real Supermemory MCP validation/health check. Until authenticated validation succeeds, Deck can persist config but must not claim fully verified runtime availability.

2. **Launch**
   - CLI parses `--memory` if present.
   - Active provider resolver uses CLI override > `.deck/config.json` > `none`.
   - Resolver constructs exactly one provider instance (`createEngramMemoryProvider()` or `createSupermemoryMemoryProvider(config)`).
   - For Supermemory, resolver requires non-secret config (`userId` at minimum) and Pi MCP config presence for the configured server name.
   - Deck does not read the token from `.deck/config.json`. If it inspects `~/.pi/agent/mcp.json`, any token/header value is redacted before diagnostics.
   - Pi profile and Developer Team files are materialized with provider fragments and validated tool bindings (`execute`, `search_docs`) only when provider/config checks pass.
   - If checks fail, Deck logs redacted diagnostics and launches without adaptive-memory tool injection; OpenSpec workflow continues.

3. **SDD phase context**
   - Orchestrator/phase agents load official OpenSpec artifacts and code/tests as before.
   - Provider-injected instructions direct agents to use Supermemory through validated MCP tools:
     - `execute` for SDK-backed profile/search/add/update/forget operations;
     - `search_docs` for SDK documentation lookup when needed.
   - Phase prompts keep official inputs and adaptive memory under separate sections.
   - Adaptive memory may influence style, reminders, and heuristics, but cannot change requirements/design/tasks without explicit OpenSpec edits.

4. **Session memory commit**
   - At session/phase close, agents may extract high-signal candidate learnings.
   - Core governance validates metadata and container tags before provider write instructions are used.
   - Supermemory adapter maps validated candidates to SDK calls executed via the `execute` MCP tool with required metadata/container guidance.
   - Active specs/tasks/raw chats/secrets are rejected by policy and not written.
   - Team-scope writes are marked `candidate`; no full review/promote UI is built in this change.

### API / Contract Implications

| Endpoint / Interface | Change | Backward Compatible |
|---|---|---|
| `AdaptiveMemoryProvider` in `packages/core/src/memory/adaptive-memory.ts` | Retained for injection; may be extended or wrapped by new adapter contract | partial |
| `AdaptiveMemoryAdapter` / operation types | New provider-neutral context/search/commit/health/configure contract | yes |
| `MemoryCapability` | Add/recognize `memory.context`; map `memory.search` and `memory.write` to provider-specific capabilities | yes |
| `MemoryToolBinding` | Reused for Supermemory server/tool mapping with validated tools `execute` and `search_docs` | yes |
| `resolveMemoryInjection()` | Continue fail-closed behavior; supported IDs include `supermemory` where caller opts in | yes |
| `buildDeveloperTeamInstallPlan()` | Accept Supermemory provider via existing `memoryProvider` option and updated allowlist | yes |
| `materializeTeamProfile()` | Accept Supermemory provider via existing option and updated allowlist | yes |
| `runPiLaunch()` | Resolve/use one active provider for Pi; verify Pi MCP config; CLI override remains supported | yes |
| `parseArgs()` | `--memory=supermemory` accepted; unknown values still error | yes |
| `.deck/config.json` | Project-local non-secret config for active provider and identity/settings; must reject tokens/secrets | yes |
| `~/.pi/agent/mcp.json` | External global Pi MCP config; write/update `supermemory` HTTP server entry with `x-supermemory-api-key` header | partial — new external side effect |
| `handOffSupermemoryCredentialToPiMcp()` or equivalent TUI helper | Replace stub with real Pi MCP config writer call and redacted result | yes |
| Supermemory MCP tool exposure | Bind `execute` and `search_docs`; remove/avoid `context`, `recall`, `memory` | no for provisional assumptions; yes for implemented product users because Supermemory was not previously functional |

### State / Persistence Implications

- `.deck/config.json` stores active memory provider and non-secret provider settings only.
- Supermemory token/credential is never stored in `.deck/config.json`.
- Supermemory token is written only to the approved external Pi global MCP config path `~/.pi/agent/mcp.json` under the configured `supermemory` server entry header `x-supermemory-api-key`.
- This local Pi config is the runner installation's secret boundary. The token does not pass through AI memory, OpenSpec, generated agent prompts, or project-owned config.
- `~/.pi/agent/mcp.json` is outside the project repo and should be treated as a user secret-bearing runtime config file.
- Prefer restrictive file permissions for `~/.pi/agent/mcp.json`; warn if permission hardening fails.
- `userId` is required for Supermemory provider activation.
- `teamId` and `orgId` are optional and only enable team/org scopes when provided.
- Project identity remains needed for project-scoped containers; implementation should not silently invent project IDs.
- No OpenSpec artifacts are indexed wholesale into Supermemory.
- No migration from Engram memories to Supermemory.
- Supermemory memory entries use required metadata and scoped container tags when the required IDs are available:
  - `u:{userId}`
  - `u:{userId}:p:{projectId}`
  - `p:{projectId}`
  - `team:{teamId}:p:{projectId}`
  - `org:{orgId}`
- Existing `.deck/pi/profiles/<team>/system-prompt.md` and `.pi/agents` materialization paths remain generated artifacts and must not contain the token.

### Migration / Backward Compatibility

- Existing `--memory=engram` behavior remains supported.
- Existing default remains no adaptive memory when no CLI flag/config is present.
- If `.deck/config.json` is absent, resolver returns provider `none` with no error.
- If `--memory=...` is present, it overrides config for that launch only and still loads only one provider.
- Existing Pi MCP config at `~/.pi/agent/mcp.json` is preserved; only the `supermemory` entry is added/updated.
- If `~/.pi/agent/mcp.json` is missing, create it with the Supermemory server entry when the user selects Supermemory and provides a token.
- If `~/.pi/agent/mcp.json` is malformed or cannot be safely merged, do not write partial config; report a redacted actionable error and do not inject Supermemory tools.
- No migration from Engram memories to Supermemory in this change.
- Existing Engram prompt/tool-binding tests should be updated, not removed, to prove old behavior still works under the common contract.
- Non-Pi runtime integrations are not changed in the first implementation target.

## File Impact Estimate

| File / Path | Action | Rationale |
|---|---|---|
| `packages/core/src/memory/adaptive-memory.ts` | modify | Extend capabilities/section composition while preserving existing API |
| `packages/core/src/memory/adaptive-memory.test.ts` | modify | Cover Supermemory-compatible provider resolution and official/adaptive section rendering |
| `packages/core/src/memory/adaptive-memory-contract.ts` | create | Define neutral context/search/commit/config/health operation contracts |
| `packages/core/src/memory/adaptive-memory-contract.test.ts` | create | Validate contract helpers and diagnostics |
| `packages/core/src/memory/adaptive-memory-governance.ts` | create | Validate metadata, scopes, confidence, commit limits, container tags |
| `packages/core/src/memory/adaptive-memory-governance.test.ts` | create | Unit tests for governance policy |
| `packages/core/src/memory/adaptive-context-renderer.ts` | create | Render `OFFICIAL CONTEXT` / `ADAPTIVE CONTEXT` and authority rules |
| `packages/core/src/memory/adaptive-context-renderer.test.ts` | create | Rendering helper tests |
| `packages/core/src/config/deck-config.ts` | create/modify | Read/write `.deck/config.json` active-provider config and reject secret fields |
| `packages/core/src/config/deck-config.test.ts` | create/modify | Config defaulting, parse, validation, required `userId`, and no-token behavior |
| `packages/core/package.json` | modify | Export new core config/memory modules |
| `packages/core/src/index.ts` | modify | Re-export new memory/config modules if needed by adapters/CLI |
| `packages/core/src/teams/developer/orchestrator-content.ts` | modify | Add official/adaptive context authority instructions |
| `packages/core/src/teams/developer/*-content.ts` | modify | Phase-level guidance for adaptive context and safe commit policy |
| `packages/adapter-engram/src/index.ts` | modify | Conform Engram provider to evolved common contract without memory migration |
| `packages/adapter-engram/src/index.test.ts` | modify | Preserve Engram behavior under new contract |
| `packages/adapter-supermemory/package.json` | create | Workspace package for Supermemory provider |
| `packages/adapter-supermemory/src/index.ts` | create | Supermemory MCP mapping using `execute`/`search_docs`, instructions, containers, metadata policy |
| `packages/adapter-supermemory/src/index.test.ts` | create | Provider ID, validated tool bindings, metadata/container rules, authority text |
| `packages/adapter-pi/src/pi-mcp-config.ts` | create | Read/merge/write external `~/.pi/agent/mcp.json`, configure Supermemory HTTP server/header, redact diagnostics, apply permissions |
| `packages/adapter-pi/src/pi-mcp-config.test.ts` | create | Merge behavior, malformed config, redaction, permissions best-effort, no repo writes |
| `packages/adapter-pi/src/developer-team-install.ts` | modify | Add Supermemory to Pi-supported provider IDs after config/health validation |
| `packages/adapter-pi/src/developer-team-install.test.ts` | modify | Install plan includes Supermemory tool bindings only after valid config/health |
| `packages/adapter-pi/src/pi-team-profile.ts` | modify | Pi session prompt supports Supermemory adaptive context |
| `packages/adapter-pi/src/pi-team-profile.test.ts` | modify | Prompt section and diagnostics tests |
| `apps/cli/src/cli-args.ts` | modify | Accept `--memory=supermemory` |
| `apps/cli/src/cli-args.test.ts` | modify | CLI parsing/backward compatibility tests |
| `apps/cli/src/main.tsx` | modify | Create Supermemory provider and read active config |
| `apps/cli/src/pi-launch-command.ts` | modify | Resolve single active provider from override/config for Pi and verify MCP config |
| `apps/cli/src/pi-launch-command.test.ts` | modify | Launch behavior, precedence, diagnostics, no double-provider cases, no token logging |
| `apps/cli/src/tui/app.tsx` | modify | Memory provider selection state, Supermemory token prompt, Pi MCP config handoff, config persistence |
| `apps/cli/src/tui/screens/developer-team-screens.tsx` | modify | Add provider selection and Supermemory setup prompts; no review/promote UI |
| `apps/cli/src/tui/developer-team-flow.test.tsx` | modify | TUI flow includes provider choice, token handoff/redaction, required `userId`, non-secret config persistence |
| `docs/pi-agent-installation.md` | modify | Document Pi-first setup, `~/.pi/agent/mcp.json`, secret boundary, fallback, and authority model |
| `bun.lock` | modify | Workspace lock may update after adding package |

## Testing Strategy

- **Pi MCP config unit tests**: read/merge/write `~/.pi/agent/mcp.json` via temp-home fixtures; preserve unrelated servers; update only `supermemory`; reject malformed JSON; redact header values; verify best-effort permission calls where testable.
- **MCP mapping validation tests**: Supermemory adapter exposes only validated tools `execute` and `search_docs`; provisional `context`, `recall`, and `memory` are absent.
- **Core unit tests**: provider resolution, single-active-provider config, required `userId`, secret-field rejection in `.deck/config.json`, metadata validation, container tag constraints, phase context rendering, fallback diagnostics.
- **Supermemory adapter tests**: provider ID/display name, validated MCP bindings, authority text, SDK snippet guidance, metadata/schema guidance, container tag construction, team candidate metadata.
- **Engram regression tests**: existing provider remains accepted and advisory; no Engram migration path is invoked.
- **Pi adapter tests**: materialized profile/agent/skill files include Supermemory fragments and `execute`/`search_docs` tool bindings only when provider is active and valid; no injection on missing/unavailable provider or missing MCP config.
- **CLI tests**: `--memory=supermemory`, `--memory=none`, unsupported values, CLI override over config, redacted diagnostics, missing/malformed `~/.pi/agent/mcp.json` fallback.
- **TUI tests**: install flow offers exactly one provider, prompts for token when Supermemory is selected, requires `userId`, accepts optional `teamId`/`orgId`, persists only non-secret Deck config, writes external Pi MCP config through abstraction, redacts token in summaries/snapshots.
- **Authenticated integration validation**: when a valid token is available outside repo/test snapshots, run read-only `execute` health probe against `https://supermemory-new.stlmcp.com`; do not require this for unit tests.
- **Verification commands**: `bun test packages/core/src/memory`, `bun test packages/core/src/config`, `bun test packages/adapter-supermemory`, `bun test packages/adapter-pi`, `bun test apps/cli`, `bun test`, `bunx tsc --noEmit`.

## Observability / Error Handling

- Report active provider and source (`cli`, `config`, `none`) without logging memory content or credentials.
- Redact the Supermemory token and `x-supermemory-api-key` header value from all TUI summaries, diagnostics, logs, test snapshots, generated files under Deck control, OpenSpec apply progress, and error messages.
- Pi MCP config writer returns structured redacted diagnostics: path, action (`created`/`updated`/`unchanged`/`failed`), server name, permission-hardening status, and error code if any.
- Health/config failures are non-blocking: launch/install continues without adaptive-memory injection and with a clear warning.
- Malformed existing `~/.pi/agent/mcp.json` is a configuration error; do not overwrite it unless repair is unambiguous.
- When memory retrieval/write guidance is used by agents, instructions should require counts/scopes and discard reasons, not raw memory contents, in logs/summaries.
- Do not expose secrets, credentials, raw chats, or sensitive memory payloads in diagnostics.

## Security / Performance / Accessibility Considerations

- **Security/privacy**:
  - `.deck/config.json` remains non-secret and rejects token-like fields.
  - `~/.pi/agent/mcp.json` is the only approved persistence location for the Supermemory token in this change.
  - Prefer `0600`-style file permissions for the external Pi MCP config and user-only parent directory permissions where possible.
  - Redact token/header values everywhere in Deck-controlled output.
  - Prohibit secrets/raw chats/specs/tasks from memory writes; validate metadata and container tags; separate personal/project/team/org scopes.
  - The generic `execute` MCP tool increases misuse risk; provider instructions must constrain it to scoped Supermemory SDK operations.
- **Performance**: default Supermemory search mode should be `memories`; hybrid/rerank should be opt-in or phase-specific because of latency.
- **Accessibility**: TUI provider selection and token/identity prompts must be keyboard navigable using existing `MenuList`/form patterns and must clearly explain that only one provider can be active and that the token is stored in Pi's global MCP config, not in the project.

## Tradeoffs

| Decision | Chosen | Rejected Alternative | Rationale |
|---|---|---|---|
| Supermemory integration boundary | Separate `packages/adapter-supermemory` behind core contract | Call Supermemory MCP tools directly from SDD prompts | Keeps provider-specific MCP behavior out of core workflow and matches Engram/future provider pattern |
| Pi credential handoff | Write/update external `~/.pi/agent/mcp.json` `supermemory` entry with HTTP URL and `x-supermemory-api-key` header | Keep TUI handoff stub/manual setup only | User explicitly approved a real Pi MCP credential/config handoff; makes installer token actually configure Supermemory for Pi |
| Secret boundary | Store token only in Pi global MCP config, never in `.deck/config.json` or repo/generated project files | Store token/API key in `.deck/config.json` | Preserves Deck project config as non-secret while enabling Pi runtime authentication |
| Tool exposure | Bind validated tools `execute` and `search_docs` | Bind provisional `context`, `recall`, `memory` | MCP validation proved provisional tools do not exist |
| Existing Pi MCP config handling | Merge and preserve unrelated entries | Overwrite the whole file | Avoids breaking user MCP server configuration and reduces adoption risk |
| File permissions | Best-effort restrictive permissions with redacted warning on failure | Refuse all installs if chmod is unsupported | Improves security without making cross-platform permission differences a hard blocker |
| First runtime target | Pi runtime/integration only | Wire every runtime immediately | Matches clarified scope and reduces adapter-specific risk while keeping core contract runtime-neutral |
| Provider selection | One scalar active provider resolved before launch/install | Multiple active providers | Avoids conflict, ranking ambiguity, privacy leakage, and unclear authority |
| Context retrieval | Provider-injected instructions/tools for Pi agents | Deck CLI directly calls Supermemory during launch for all context | Current architecture launches Pi and materializes prompts; direct universal calls would add transport/auth coupling to CLI |
| OpenSpec ingestion | Only derived high-signal summaries/retrospectives | Index all active OpenSpec artifacts | Preserves OpenSpec authority and avoids duplicate/conflicting source of truth |
| Team memory promotion | Store as `candidate` metadata without full UI | Build full review/promote UI now | Keeps scope focused; candidate metadata prevents inferred conventions becoming authority |
| Engram continuity | Keep Engram available under the common contract, no migration | Migrate Engram memories to Supermemory | Migration is explicitly out of scope and would add data mapping/privacy risk |

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Pi MCP config schema differs from the target `mcpServers` shape | Medium | High | Isolate schema mapping in `pi-mcp-config.ts`; test with fixture and validate against Pi before broad release; fail closed with actionable error |
| Supermemory token leaks through logs/snapshots/apply progress | Medium | High | Central redaction helper; tests with sentinel token; never print raw `x-supermemory-api-key`; review generated files for absence |
| `~/.pi/agent/mcp.json` permissions cannot be restricted on some platforms | Medium | Medium | Best-effort chmod; warn redacted; document manual permission hardening |
| Generic `execute` tool can be misused beyond intended Supermemory operations | Medium | High | Adapter prompt constrains usage; OpenSpec authority rules; no direct arbitrary code examples beyond scoped SDK snippets |
| Authenticated metadata/container/write behavior remains incompletely validated | Medium | Medium | Keep authenticated integration validation as follow-up gate before claiming full availability; implement conservative SDK calls and fallback |
| Missing required `userId` prevents correct Supermemory scoping | Medium | High | Require explicit `userId` before enabling Supermemory provider |
| Project identity derivation remains unclear | Medium | Medium | Do not silently invent IDs; disable project/team containers or require explicit value until product decision |
| Pi rejects unknown/unconfigured MCP tools in frontmatter | Medium | Medium | Verify Pi MCP config before tool injection; fallback to no memory injection with warning |
| Memory drift contradicts OpenSpec | Medium | High | Prompt hierarchy, explicit `OFFICIAL`/`ADAPTIVE` sections, metadata, and no OpenSpec mutation from memory alone |
| Noisy automatic commits reduce usefulness | High | Medium | Max 3-7 learnings/session, metadata validation, confidence threshold, prohibited-content filters |
| Scope leakage across personal/project/team/org containers | Medium | High | Central container tag builder, character/length validation, metadata filters by scope |
| No review/promote UI for team candidates | High | Medium | Store team memories as `candidate`; promotion/review remains outside this change |

## Open Decisions

- Confirm exact Pi MCP JSON schema details for streamable HTTP servers if Pi's implementation differs from the design-level `mcpServers.supermemory.{transport,url,headers}` shape. Owner: implementer validating against Pi runtime.
- Complete authenticated Supermemory validation with a real token supplied outside repo/test snapshots: read-only `execute` probe, metadata filters, container isolation, and safe write behavior. Owner: implementation/QA with user-provided credential.
- Decide how `projectId` is derived or requested. `userId` is required; `teamId` and `orgId` are optional; project-scoped containers need a validated project identity strategy. Owner: product/domain decision.
- Decide audit depth for automatic memory commits beyond local diagnostics. Owner: product/security decision.

## Dependencies

- Supermemory MCP server/API availability at `https://supermemory-new.stlmcp.com`.
- User-provided Supermemory token during TUI setup.
- Pi runtime support for global MCP config at `~/.pi/agent/mcp.json` and HTTP MCP server headers.
- Pi MCP bridge/runtime remains available when using Pi runtime.
- Existing Developer Team materialization path for Pi agents/skills/profile.
- Spec Agent/apply feedback may refine acceptance behavior; any conflict should preserve OpenSpec authority and the non-secret `.deck/config.json` boundary.

## Next Steps

Ready for Task (`deck-developer-task`) to break this design into implementation tasks, combined with Spec.
