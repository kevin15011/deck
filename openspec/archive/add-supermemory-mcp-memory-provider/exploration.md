# Exploration: Supermemory Token Handoff for Pi MCP

## Goal

Determine the real credential/config handoff path for a Supermemory token in the current Pi runtime/adapter so Deck can configure/connect Supermemory MCP without storing the token in `.deck/config.json` or repo files.

## Current Pi MCP / Materialization Flow

1. **TUI provider selection** (`apps/cli/src/tui/app.tsx`)
   - The install flow now offers `none`, `engram`, and `supermemory` in `memory-provider-selection`.
   - Supermemory prompts collect `token`, required `userId`, optional `teamId`, and optional `orgId`.
   - `buildSupermemoryDeckConfig()` persists only non-secret settings to `.deck/config.json`: `activeProvider: "supermemory"`, `mcpServerName`, `userId`, optional `teamId`/`orgId`, `searchMode`, and `maxMemoriesPerSession`.
   - `handOffSupermemoryCredentialToPiMcp()` is a stub. It only validates token presence and returns a redacted status string; it does not write Pi MCP config, configure a secret store, set an env var, or validate connectivity.
   - `createMemoryProviderForSelection()` only constructs Engram; Supermemory returns `undefined`, so the install/review path can persist config but cannot yet inject Supermemory tools.

2. **Developer Team install materialization** (`packages/adapter-pi/src/developer-team-install.ts`)
   - `buildDeveloperTeamInstallPlan(projectRoot, options)` writes generated agent files under `.pi/agents/*.md` and skill files under `.pi/skills/*/SKILL.md`.
   - It resolves memory injection via `resolvePiMemoryInjection()`, whose default supported provider allowlist is currently `['engram']` only.
   - When a provider bundle is accepted, `composeAdaptiveMemory()` appends matching provider instructions to agent/skill content.
   - For agent files only, memory `toolBindings[].toolNames` are appended to the Pi frontmatter `tools:` line via `buildPiToolsLine()`. `serverName` is retained in the binding data but is not written to a separate MCP server config here.

3. **Pi launch materialization** (`apps/cli/src/pi-launch-command.ts`, `packages/adapter-pi/src/pi-team-profile.ts`, `packages/adapter-pi/src/pi-team-launch.ts`)
   - `runPiLaunch()` checks the `pi` command, then materializes `.deck/pi/profiles/<team>/system-prompt.md` through `materializeTeamProfile()`.
   - If a memory provider was passed, it also rewrites Developer Team agent/skill files with memory instructions/tool names while preserving existing model/thinking assignments.
   - `materializeTeamProfile()` composes session-surface memory instructions into `.deck/pi/profiles/<team>/system-prompt.md`; its default supported provider allowlist is also `['engram']` only.
   - `buildPiTeamLaunchPlan()` launches Pi with `--session-dir .deck/pi/sessions/<team>` and `--system-prompt .deck/pi/profiles/<team>/system-prompt.md`. It forwards the current process environment and adds `PI_SESSION_DIR`; it does not add Supermemory-specific env vars.

4. **CLI provider resolution** (`apps/cli/src/cli-args.ts`, `apps/cli/src/main.tsx`)
   - `--memory` currently supports only `engram`/`none` in CLI args.
   - `main.tsx` maps only `engram` to `createEngramMemoryProvider()`.
   - The new `resolveActiveMemoryProvider()` from `packages/core/src/config/deck-config.ts` exists but is not wired into `main.tsx`/`runPiLaunch()` yet, so `.deck/config.json` Supermemory selection is not consumed at launch.

## Where MCP Servers / Tools / Config Are Written

- **Tool names** are written only into generated Pi agent frontmatter: `.pi/agents/<agent>.md` `tools: read,write,bash,<memory_tool_names>`.
- **Memory instructions** are written into:
  - `.pi/agents/<agent>.md` agent bodies;
  - `.pi/skills/<skill>/SKILL.md` skill bodies;
  - `.deck/pi/profiles/<team>/system-prompt.md` session prompt.
- **Deck non-secret provider config** is written to `.deck/config.json` through `writeDeckConfig()`.
- **Pi model/provider settings** are read from `~/.pi/agent/settings.json` or `PI_CODING_AGENT_DIR/settings.json` for model detection, but no current Deck code writes MCP server entries there.
- **No current code materializes an MCP server definition** for Engram or Supermemory. There is no Deck-owned file writer for `mcpServers`, MCP headers, Supermemory endpoint, API-key header, OS keychain, or Pi MCP package config.

## Existing Safe Secret Mechanism

No existing safe secret-storage mechanism is implemented in Deck for memory provider credentials.

Existing related pieces:

- `.deck/config.json` explicitly rejects secret-like fields recursively (`token`, `secret`, `credential`, `apiKey`, `password`, `auth`, etc.). This is a safe non-secret config mechanism only.
- Pi launch forwards the ambient process environment, so an externally configured `SUPERMEMORY_API_KEY` could reach child processes if Pi/MCP uses inherited env, but Deck does not set or persist it.
- Existing model-provider detection checks environment variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, etc.; this is detection only, not a secret persistence mechanism.
- The MCP validation report found the real Supermemory MCP endpoint expects `x-supermemory-api-key`/equivalent behavior resulting in `SUPERMEMORY_API_KEY` for the server-side SDK client. This points to an MCP-client secret/header/env configuration path, but Deck has not implemented that path.

## Supermemory MCP Validation Constraints

`mcp-validation-report.md` changes the adapter implications:

- Real MCP tools are `execute` and `search_docs`; provisional `context`, `recall`, and `memory` tools do not exist.
- `initialize` and `tools/list` can succeed without credentials; real provider availability requires authenticated `execute`.
- The API key/token must be supplied outside repo files, via `x-supermemory-api-key` or an equivalent MCP client secret/env mechanism.
- Authenticated metadata/container/write behavior remains blocked until a valid token is supplied outside the repo.

## Options and Tradeoffs

| Approach | Pros | Cons | Effort |
|---|---|---|---|
| A. **Use process environment only** (`SUPERMEMORY_API_KEY`) | No file persistence; aligns with MCP validation error; easy to document; avoids repo/.deck secret writes | Does not satisfy install-time token persistence across shells; TUI prompt token cannot be safely stored; users must configure env themselves or launch through a wrapper | Low |
| B. **Write Pi MCP server config with env-var/header reference only** | Deck can materialize deterministic MCP config while keeping token outside config; `.deck/config.json` remains non-secret; compatible with `x-supermemory-api-key` if Pi supports MCP headers/env interpolation | Requires confirming Pi's MCP config schema/path and whether env interpolation/secret refs are supported; current code has no MCP config writer | Medium |
| C. **Use an OS keychain/secret store and write Pi MCP config referencing it** | Best UX for install-time token handoff; token can persist outside repo/config; enables validation after install | Requires adding a secret abstraction, cross-platform behavior, dependencies, failure modes, and a Pi MCP way to consume keychain secrets; highest implementation and support risk | High |
| D. **Keep current stub and require manual Pi MCP setup** | Safest until Pi MCP schema is confirmed; no accidental secret leakage | Supermemory remains selected in Deck config but unusable/injection should remain disabled; does not complete requested feature | Low |

## Recommendation

Implement the next slice as **Option B if Pi MCP config supports env/header references; otherwise Option A plus explicit manual setup**.

Recommended implementation slice:

1. Confirm Pi's MCP server configuration schema and path (likely outside current Deck code; do not infer from `~/.pi/agent/settings.json` without validation).
2. Add a small Pi adapter MCP configuration module that can materialize a Supermemory server entry using the validated endpoint/tool behavior and a **non-secret env/header reference**, not the token value.
3. Change TUI Supermemory handoff so the entered token is either:
   - used only for immediate validation and exported/passed to the MCP config process without persisting; or
   - rejected with an actionable instruction if no approved external secret path exists.
4. Keep `.deck/config.json` as non-secret only and continue rejecting secret-like fields.
5. Do not enable Supermemory tool injection until both the Supermemory provider exists and Pi MCP credential/config health succeeds. Fallback must materialize no Supermemory tools.

## Likely Files to Modify Later

- `apps/cli/src/tui/app.tsx` — replace `handOffSupermemoryCredentialToPiMcp()` stub with real safe handoff/validation result handling.
- `apps/cli/src/tui/screens/developer-team-screens.tsx` — update copy/status if the handoff becomes env-var/manual or Pi-config backed.
- `packages/adapter-pi/src/*` new module likely needed, e.g. `pi-mcp-config.ts` — materialize/read/validate Pi MCP server config once the Pi schema is known.
- `packages/adapter-pi/src/developer-team-install.ts` — include `supermemory` in supported provider IDs only after provider/config health is usable.
- `packages/adapter-pi/src/pi-team-profile.ts` — same allowlist/health behavior for session prompt.
- `apps/cli/src/pi-launch-command.ts` — resolve config-selected provider and require credential/config health before injection.
- `apps/cli/src/main.tsx` and `apps/cli/src/cli-args.ts` — accept/resolve `supermemory`, consume `.deck/config.json`, and construct `createSupermemoryMemoryProvider(config)`.
- `packages/adapter-supermemory/src/index.ts` — provider instructions/tool bindings using real `execute` tool, not provisional PRD tools.
- Tests around TUI flow, Pi MCP config materialization, launch fallback, redaction, and no token persistence.

## Risks / Blockers

- **Primary blocker**: the repository does not contain a validated Pi MCP server config writer or schema. Current Pi adapter only writes prompts/agent files/tool names.
- **Credential path blocker**: no approved external secret mechanism exists. Environment variables are available but not a persistent installer handoff.
- **MCP validation blocker**: authenticated Supermemory metadata/container/write behavior is still unverified without a real token supplied outside repo files.
- **Runtime risk**: writing Supermemory tool name `execute` into Pi frontmatter before the MCP server is configured may make Pi reject or fail tool calls.
- **Security risk**: any attempt to persist the prompted token in `.deck/config.json`, generated `.pi` files, `.deck/pi` files, tests, logs, or repo docs would violate the spec.

## Open Questions

- What exact Pi MCP client config path and schema should Deck write for remote HTTP MCP servers?
- Does Pi support secret/header env interpolation for MCP server headers, specifically `x-supermemory-api-key: ${SUPERMEMORY_API_KEY}` or equivalent?
- Should the installer persist the token in an OS keychain, or should it only validate/use the token transiently and instruct users to set `SUPERMEMORY_API_KEY` externally?
- What authenticated read-only Supermemory health probe is acceptable once a valid token is available?
