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

A session child MUST load the same native MCP sources as native Deck on that runner, subject to native trust and the shared capability-availability policy. The session MAY add the `deck` session server and override a capability in `SESSION_CAPABILITY_OVERRIDES` (`codebase-memory`). A working override MUST deny only its native entry and supply its verified rebound spec.

For `codebase-memory` only, trusted launch preparation MAY instead produce an availability omission when effective capability intent remains enabled and the selected backend has a typed unavailable or unsupported outcome. An omission MUST carry current project, runner, generation, selection and backend evidence. It MUST suppress only the exact Deck-owned server for that invocation, supply no replacement, retain enabled intent, and report enabled/unavailable while permitting ordinary work. This is an explicit exception to replacement pairing, not a working override. Native and session launches MUST apply the same rule. Disabled intent, integrity/ownership failure, cancellation, unclassified errors and unverified generations MUST NOT enter this exception.

The adapter MUST NOT deny, drop or re-supply any other native or plugin server under this rule. It MUST preserve installed generation and selection bytes, native role selection and exact role restrictions. Raw server-name lists, model-supplied fields and report text MUST NOT authorize an omission. Recovery MUST use fresh evidence at the next supported launch/resume boundary. No installation, persisted disablement or project repair authority follows from availability omission.

### Scenario: Enabled Codebase temporarily unavailable
- GIVEN a verified enabled generation and trusted typed unavailable evidence for its selected Codebase route
- WHEN a native or session invocation is admitted
- THEN the exact Deck Codebase server is prevented from loading, no replacement is fabricated, and ordinary work can start
- AND the roster reports enabled/unavailable through the native context channel
- AND all unrelated native sources, role bytes and installed selection bytes are preserved
- AND fresh ready evidence on a later invocation restores the permitted route without a configuration write.

### Scenario: Omission does not bypass disabled or integrity policy
- GIVEN disabled intent, a stale selection, an unverified generation, or an integrity failure
- WHEN an omission is requested
- THEN the omission path is rejected under the existing admission policy
- AND disabled capabilities cause no optional backend check or new capability grant.

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

Readiness full bytes MUST match on equal complete scopes/evidence. On unequal scopes only the typed additional-participant coordination projection in allow-list row 12 MAY differ; native channel, local capability policy and independently derived local/base projection remain identical.

For each runner that has a session driver, a test MUST build the native and session launch plans (Lead and `quality`, in relay and in `yolo`) from the same fixture install. It MUST normalize both into a `ParityLaunchShape` and fail on:

- any field difference without a `SESSION_PARITY_ALLOWLIST` entry;
- any unused entry;
- any unrelated native MCP declaration/exposure or `webSearch` difference; Codebase route/omission differences require independently established backend evidence under the approved availability rule.

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


### Requirement: Readiness scope preserves native member enablement

Deck MUST use the same native enablement resolvers for each member's actual runner in native and cross-runner operation. OpenSpec initialization/configuration, retired Deck testing-policy cleanup and the skill registry MUST be unconditional project components. Optional shared project components MUST be evaluated once for unchanged inputs when ANY participating runner enables them. Runner components MUST be evaluated only for participating enabled runner bindings.

The union of project prerequisites MUST NOT grant any member a capability, instruction bundle, plugin, MCP tool or permission. A disabled capability MUST NOT be probed, marked degraded, repaired, installed or given an installation recommendation for that disabled runner. It MAY appear as `disabled` in the capability roster.

#### Scenario: Lead disabled and a member enabled
- GIVEN Lead on Claude has Codebase Memory disabled and Quality on Codex has it enabled
- WHEN readiness is prepared
- THEN one shared project index observation is requested with Quality/Codex as a consumer
- AND only the enabled Codex binding receives Codebase Memory runner checks
- AND Lead receives the consolidated finding without receiving Codebase Memory tools or instructions
- AND the roster reports Lead disabled and Quality enabled with independently evidenced availability.

#### Scenario: No participant enables an optional capability
- GIVEN every participant disables capability C
- WHEN preflight, formatting and repair selection run
- THEN C causes zero optional file/runtime probes, degradations, repairs or install suggestions
- AND OpenSpec and registry checks still run.

#### Scenario: Shared component and two runner gaps
- GIVEN two enabled runner bindings require one project component
- WHEN both bindings have distinct installation defects
- THEN the project component is evaluated once and identifies both consumers
- AND two runner-qualified report-only findings are retained without conflating their remedies.

### Requirement: Bounded evidence-only preflight

All topologies MUST use one shared readiness evaluator. The evaluator MUST make no writes, network calls or subprocess launches. Supplied config, exposure snapshots and previously produced runtime evidence MUST be distinguished from local bounded reads. All reads/stats, bytes and parsing work MUST be bounded; fingerprint validation is included in those bounds.

Unknown, stale, unreadable or over-budget evidence MUST be `indeterminate`, never inferred ready or repairable. A component error MUST NOT erase independent proven findings. Invalid trusted scope/root MUST invalidate the complete evaluation. The evaluator MUST NOT auto-launch Setup or block ordinary work.

#### Scenario: Unknown index state
- GIVEN an enabled Codebase Memory backend has initialized and advertises graph tools
- AND no current project-bound index observation exists
- WHEN preflight runs
- THEN index state is indeterminate
- AND no MCP call, process startup, indexing or synthetic ready marker occurs.

#### Scenario: Guessed directory exists
- GIVEN `.codebase-memory` exists in the project or HOME
- WHEN no supported metadata contract proves project identity and index freshness
- THEN directory presence alone cannot produce verified index readiness
- AND absence of a guessed directory alone cannot authorize indexing.

#### Scenario: Partial uncertainty
- GIVEN registry freshness cannot be established within budget but OpenSpec has a proven retired Deck policy field
- WHEN preflight runs
- THEN registry is indeterminate and excluded from automatic repair
- AND the independently proven OpenSpec finding remains actionable.

#### Scenario: Registry evidence is scoped
- GIVEN one shared registry file and different authorized source exposures for two runners
- WHEN readiness runs
- THEN shared bytes are read once
- AND one runner's freshness status is not copied to the other
- AND neither runner enumerates the other's exclusive roots
- AND no alternating per-runner refresh loop rewrites the shared file.

### Requirement: Consolidated findings and member capability roster

Lead MUST receive one deterministic readiness block for proven degraded findings. Shared project findings MUST name their enabled consumers; runner findings MUST name the affected runner/binding. Only project findings eligible for repair MUST request Setup delegation. Runner installation, plugin and credential findings MUST be report-only with appropriate remediation.

The member roster MUST distinguish disabled capability intent from enabled/ready, enabled/unavailable and enabled/unverified availability. Current assignment and preserved task-continuation assignment MUST not be confused. Roster data MUST NOT imply authority to install or enable a capability.

#### Scenario: Runner-only problem
- GIVEN a ready project and an enabled runner with a missing plugin
- WHEN Lead receives the consolidated block
- THEN the finding names that runner and its remediation
- AND it does not request Setup to install or upgrade the plugin.

#### Scenario: Ready or wholly unknown result
- WHEN no component is proven degraded
- THEN no readiness block is emitted
- AND indeterminate details remain in diagnostics while the roster may report enabled/unverified.

### Requirement: Native session-start delivery remains the sole readiness channel

Claude MUST use its hashed plugin SessionStart hook; Codex its trusted Deck native hook; OpenCode its execution plugin lifecycle/system transform; Pi its native extension lifecycle. These mechanisms MUST be used in both native and supported cross-runner launches. Project instructions MUST be supplied only where the runner does not already load them. Readiness MUST NOT depend on optional memory enablement.

The session overlay MUST NOT carry readiness findings, repair instructions, the readiness marker or project instructions. Its existing Lead delegation/roster section MAY contain typed member capability data. A missing native delivery mechanism MUST be repaired in that adapter rather than bypassed through the overlay.

#### Scenario: Mixed roster delivery
- GIVEN a trusted mixed-runner snapshot is prepared by the coordinator
- WHEN a Claude Lead starts or resumes
- THEN the native SessionStart hook emits the consolidated block once
- AND its overlay contains neither that block nor its findings copied into notices.

#### Scenario: Memory disabled
- GIVEN adaptive memory is disabled on every participant
- WHEN a project has a proven readiness defect
- THEN the native readiness channel still delivers the finding
- AND no memory plugin is loaded to provide that channel.

#### Scenario: Same scope, same bytes
- GIVEN identical complete readiness scope and evidence for native and session launch on runner R
- WHEN their native channels compose context
- THEN the full channel bytes are equal.

#### Scenario: Different roster, bounded difference
- GIVEN native R has only native participants while session R has additional runners
- WHEN parity is evaluated
- THEN the local/base projection and delivery mechanism remain equal
- AND only typed coordination data derived from the additional participants may differ under the narrow evidence allow-list entry
- AND dropping the hook, adding disabled tools or copying readiness into the overlay still fails.

### Requirement: Session cache and repair deduplication

A trusted coordinator MUST share immutable snapshots across child processes. Component cache keys MUST include relevant policy, input and runner-binding evidence; session keys MUST also include epoch and effective roster identity. Process-local hook maps alone MUST NOT be described as a session-wide cache.

The coordinator MUST revalidate bounded dependencies at start/resume/compaction and explicit relevant lifecycle changes, reuse unchanged component results, and invalidate changed scope/evidence. Previously absent files MUST participate in invalidation. An enablement change MUST be rechecked before repair. No per-turn filesystem scanning is permitted in a system transform.

#### Scenario: Concurrent starts and duplicate delivery
- GIVEN two children request the same unchanged project component concurrently
- THEN only one component evaluation runs
- AND each prompt assembly receives at most one readiness segment
- AND repeated lifecycle delivery does not create another Setup task for the same unresolved finding.

#### Scenario: Roster or config changes
- GIVEN a new enabled runner joins or a runner's relevant capability/configuration changes
- WHEN the next affected execution is admitted
- THEN the coordinator refreshes affected observations and the roster through the native delivery lifecycle
- AND unaffected OpenSpec evidence is reused
- AND removal of the last enabled consumer removes optional repair eligibility.

#### Scenario: Continuation retains its runner
- GIVEN a member's new-task assignment changes from Claude to Codex
- WHEN an older Claude task is continued
- THEN its actual Claude assignment participates in readiness and appears in the roster
- AND Codex configuration is not substituted for that task's enablement.

#### Scenario: Resume after repair or restart
- GIVEN a Setup attempt already exists for a finding
- WHEN the session resumes with unchanged evidence
- THEN the prior attempt is reused/reconciled rather than duplicated
- AND changed project bytes invalidate affected evidence
- AND a restarted authority never accepts the old process token or blindly retries an uncertain effect.

### Requirement: Trusted Setup authority for project repair

Only a trusted runtime-selected Setup invocation with an exact Lead delegation MAY request modifying project preparation. The service MUST authenticate the selected role and invocation independently of caller-provided tool fields and native tool allow-lists. It MUST revalidate the current scope, enablement, evidence and exact targets under a target lock, reject non-degraded or report-only requests, then issue and consume single-use process-local authority before each concrete effect.

Claims MUST bind session/epoch, requester runner, executor binding when different, canonical project, delegation, component evidence and exact action/target set. Role, scope or executor arguments from a model MUST NOT mint or widen authority. Missing identity, expired/replayed/restarted authority or changed source bytes MUST fail closed without a write fallback. The implementation MUST preserve existing project-only mutation limits and MUST NOT write user configuration, install tools, change Git state or write centralized SDD state/events.

#### Scenario: Setup disabled, enabled executor available
- GIVEN Setup's runner disables optional capability C but another participant enables C
- AND shared project component C is proven degraded
- WHEN the trusted Setup invocation requests its exact delegated project repair
- THEN the core service may execute only the bounded project operation using that enabled participant's verified initializer binding
- AND authority records requester and executor separately
- AND Setup receives no C tools, instructions, plugin or enablement change
- AND no extra paid member is started.

#### Scenario: No eligible executor or disabled before repair
- GIVEN the last enabled consumer disappears, becomes disabled, or has no safe verified initializer
- WHEN Setup requests the old repair
- THEN no optional capability effect runs
- AND the handoff reports the current limitation without enabling or reassigning a member.

#### Scenario: Forged role or scope
- WHEN Lead, Apply, a user-defined MCP client or an unbound process calls repair with `agentId: deck-setup`, forged roster or another runner identity
- THEN the service rejects the request before any effect, even if a tool-visibility rule failed.

#### Scenario: One nonce and multiple operations
- GIVEN a delegated batch contains two concrete operations
- WHEN the service executes it
- THEN each effect has a valid separate reservation or a deliberately defined atomic batch authorization
- AND a consumed single-operation token cannot authorize the second effect.

### Requirement: Deterministic retired Deck testing-policy cleanup

Setup MUST remove retired Deck TDD policy fields from their supported top-level and nested policy locations, move command-valued gate entries losslessly into testing commands with collision handling, and set proportional policy where absent or strict. It MUST preserve unrelated content, user command text, comments, key order and style; report a diff; be idempotent; and preserve prior bytes on digest mismatch or unsupported/lossy transformation. Similarly named keys in user command maps or opaque user data MUST not be treated as Deck policy. Strict TDD and legacy compatibility MUST NOT survive as an opt-in or fallback.

#### Scenario: Policy removed, commands preserved
- GIVEN supported retired policy fields, gate commands, unrelated data and an existing colliding command name
- WHEN Setup repairs the config
- THEN retired policy is gone, each command is preserved, collisions are resolved without loss and unrelated data remains
- AND a second run is unchanged
- AND a concurrent edit prevents the stale write.

### Requirement: One producer and Setup naming

After the new producer is wired, Deck MUST remove the unused needs-init readiness path and dead deck-init role/content remnants, use Setup naming, and include Setup in the default delegable member catalog. Existing trusted native-provider seams MAY be reused for the selected transport; their removal MUST not precede equivalent authority and lifecycle support. A new universal deck-prepare server is not required by this specification.


### Approved availability parity evidence

Each lane independently derives installed declarations, selected backend route, actual omitted servers and effective exposure. Equal intent and backend evidence require equal omission. Native-healthy and managed-unavailable evidence may differ only for Codebase under its override necessity rationale. Missing sources must never be normalized back into availability. Read-only safety applies independently of lane equality.
