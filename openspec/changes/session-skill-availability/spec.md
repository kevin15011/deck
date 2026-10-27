# Spec delta: cross-runner session parity

## ADDED Requirements

### Requirement: Session role definition is the native materialized role

A cross-runner session child (Lead or member) on runner R MUST run the role definition that Deck installed for R and that native Deck selects for the same role. The session host and CLI composition MUST NOT render a role body, a safety block, capability instructions or project instructions at launch.

#### Scenario: Claude member uses the native agent
- GIVEN a verified Claude team generation
- WHEN the session launches member `quality` on Claude
- THEN the child is launched with that generation's `--plugin-dir` and `--agent deck-developer-team:deck-quality`
- AND the agent's `tools:` restriction and `skills:` preload are in effect
- AND the appended system prompt contains only session overlay sections

#### Scenario: OpenCode member uses the native agent
- WHEN the session sends a turn to OpenCode member `apply-fast`
- THEN the message carries `agent: "deck-apply-fast"`
- AND permissions are seeded from that agent entry
- AND `system` carries only overlay sections

#### Scenario: Codex member uses verified installed role bytes
- GIVEN Codex has no app-server role selector
- WHEN the session starts Codex member `quality`
- THEN `developerInstructions` equals the verified `.codex/agents/quality.toml` `developer_instructions`, followed by the overlay
- AND model and effort are passed explicitly: the cross-runner assignment when set, otherwise the role TOML `model`/`model_reasoning_effort`

#### Scenario: No session-rendered role body
- WHEN any session child launch input is built
- THEN no call to `getAgentContent` for a role body occurs on the session path
- AND the parity guard fails if the overlay contains role-body, safety-block or project-instructions content

### Requirement: Typed session overlay

`@deck/core` MUST own one `SessionOverlay` renderer whose sections come from a closed set: `session-notice`, `delegation` (Lead only), `task-roster` (Lead only), `continuity` (Lead only), `decision-guidance` (Lead only), `memory-status`, `change-binding`, `handoff`, `images` and `notices`. Any section outside this set MUST fail.

#### Scenario: Unknown overlay section
- WHEN a caller adds an overlay section not in the closed set
- THEN rendering throws `session-overlay-section-unknown`

### Requirement: Installed generation verification for every session driver

Before every child spawn, the driver MUST re-verify a host-prepared `NativeRoleDescriptor` against the content the current Deck build would materialize. Any mismatch MUST fail closed before spawn with `<runner>-session-generation-unverified` and remediation `deck upgrade`. That includes a generation that still declares a retired capability (context-mode, serena).

#### Scenario: Stale generation with a retired server
- GIVEN an installed Claude generation whose `.mcp.json` declares `serena`
- WHEN a Claude session child would start
- THEN no process is spawned and the task fails with `claude-session-generation-unverified`

### Requirement: Native-first MCP

A session child MUST load the same native MCP set as native Deck in the same runner: user, project (per native trust) and Deck-installed capability servers. The session MAY only:

- (a) add the `deck` session server, and
- (b) override a capability listed in `SESSION_CAPABILITY_OVERRIDES` (`codebase-memory`).

An override MUST deny the native entry for that capability only and MUST supply the rebound spec. The adapter MUST NOT deny, drop or re-supply any other native or plugin server.

#### Scenario: Claude plugin servers load natively
- GIVEN the verified Claude generation declares `context7` and `codebase-memory` in `.mcp.json`
- AND the session binds codebase-memory per task
- WHEN a Claude session child launches
- THEN `deniedMcpServers` contains `plugin:deck-developer-team:codebase-memory` and no other plugin server
- AND `context7` is provided by the plugin, not by `--mcp-config`

#### Scenario: Unlisted override is rejected
- WHEN an adapter's `readSessionCapabilityOverrides` returns an id outside `SESSION_CAPABILITY_OVERRIDES`
- THEN session child preparation fails with `session-capability-override-unlisted`

#### Scenario: Override necessity
- WHEN a `capability-override` allow-list entry has no `necessityTest`, or names a test that does not exist
- THEN the parity guard fails

### Requirement: Shared web-search route

Native launch and session launch on every runner MUST decide web search through the same core route (`resolveWebSearchLaunch`, built on `selectSearchRoute`), based on that runner's native search availability. A Deck fallback server MUST be present only when the route is `fallback`. The Claude plugin `.mcp.json` MUST NOT declare a static `web-search` server.

#### Scenario: Native search available on Claude
- GIVEN Claude reports native search as available
- WHEN native Deck and a session child launch on Claude
- THEN neither launch includes a `web-search` MCP server
- AND both parity shapes report `webSearch.route = "native"`

### Requirement: Project instructions on Claude come from the plugin

The Deck Claude team plugin MUST include a hashed `SessionStart` hook that provides the project's AGENTS.md, and native and session MUST load it the same way. The session MUST NOT inject project instructions into the appended prompt.

#### Scenario: AGENTS.md parity
- WHEN native Deck and a session child launch on Claude in a project with AGENTS.md
- THEN both shapes report `projectInstructions = "native-hook"`
- AND the session overlay contains no AGENTS.md content

### Requirement: Skip-permissions only under explicit yolo

Relay MUST be the default approval mode for every session child. Runner skip-permissions flags, which are Claude `--dangerously-skip-permissions`, Codex `never`/`danger-full-access` and OpenCode `*: allow`, MUST be emitted only when the session's explicit `yolo` mode is active. OpenCode MUST still keep native deny rules.

#### Scenario: Relay never skips permissions
- GIVEN a session in relay mode
- WHEN any Claude child launches
- THEN its arguments include `--permission-prompt-tool mcp__deck__deck_approve` and do not include `--dangerously-skip-permissions`

### Requirement: Capability parity (skills, hooks, execution policies)

A session child MUST receive the same skills, hooks and execution plugins or policies as native Deck in the same runner. The only exception is allow-listed hook admission rules that are stricter than native.

#### Scenario: Codex Deck hooks run in session
- GIVEN Deck materialized the RTK `PreToolUse` hook in Codex config
- WHEN a Codex session child starts
- THEN that hook is enabled with its exact trusted hash, and the startup hook inventory check fails closed if it is absent or untrusted

### Requirement: Structural parity guard with documented allow-list

For each runner that has a session driver, a test MUST build the native and session launch plans (Lead and `quality`, in relay and in `yolo`) from the same fixture install. It MUST normalize both into a `ParityLaunchShape` and fail on:

- any field difference without a `SESSION_PARITY_ALLOWLIST` entry;
- any unused entry;
- any difference in `mcpNative` or `webSearch`.

Entries MUST use one of these categories: ledger, delegation, approval-relay, session-mode, evidence, headless-transport, capability-override, temporary-tracked or unsupported. A `temporary-tracked` entry MUST name an owner, an expiry condition and a `reviewBy` date, and the guard MUST fail once that date has passed.

#### Scenario: Unlisted divergence
- WHEN a change makes the session Claude launch deny `plugin:deck-developer-team:context7`
- THEN the Claude parity guard fails and names field `mcpNative`

### Requirement: Read-only roles cannot reach write or exec tools, MCP included

`@deck/core` MUST own one role tool policy. Every adapter MUST materialize it for native launches, and session children MUST inherit it through the native role.

For read-only roles (`deck-investigate`, `deck-quality`):

- Only read built-ins and explicitly listed read-only MCP tools are allowed.
- Every other MCP tool MUST be denied by default, including user and project servers.
- Neither relay nor `yolo` may relax these denies.

#### Scenario: OpenCode read-only role and an MCP shell tool
- GIVEN an MCP server that exposes a shell or write tool is configured in OpenCode
- WHEN native OpenCode `deck-quality`, or a session `quality` member on OpenCode, runs
- THEN neither can call that tool
- AND neither has `bash`, `edit` or `write`

#### Scenario: Read-only policy is guarded on native shapes
- WHEN any runner's native or session `quality` shape has a write or exec built-in, or MCP default `allow`
- THEN the parity guard fails

### Requirement: Memory parity and temporary global-scope entry

Project-scope memory in a session MUST use the same launch builders and environment as native, with no allow-list entry. Global-scope memory (no git identity) MAY differ from native only while `SESSION_PARITY_ALLOWLIST` contains the `temporary-tracked` entry "global-scope memory: session-only until memory redesign" with owner, expiry condition and `reviewBy`. This change MUST NOT add new memory mechanisms.

#### Scenario: Temporary entry removed
- GIVEN the global-scope memory entry is removed from the allow-list
- WHEN the session still enables global-scope memory that native disables
- THEN the parity guard fails

#### Scenario: Project-scope memory divergence
- WHEN the session project-scope memory env names or plugin differ from native
- THEN the parity guard fails regardless of any temporary entry

### Requirement: Pi session support is explicit

Until a Pi session driver exists, the session MUST NOT offer Pi as a member runner. Delegating to a Pi-assigned member MUST fail closed with `session-runner-unsupported`. Session memory composition that exists only for a Pi lead (`createSessionMemoryPort`) MUST be removed while no Pi driver exists.
