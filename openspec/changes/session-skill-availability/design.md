# Design: native/session parity

Legend: **=** identical · **I** inherent-justified (allow-listed) · **O** capability override (allow-listed, necessity-tested) · **T** temporary tracked allow-list entry · **D** defect · **CD** shared core defect (native has it too).

Revision 3 (final, 2026-10-26) locks the design branches using the live-check results (`task-1295d93c…`, report `report-attempt-1.txt`) and the latest user decisions in `working-brief.md`:

- **P1a supported.** `--agent` plus `--model`: the CLI model wins over agent frontmatter, and agent `tools:` is enforced.
- **P1b supported.** A plugin `SessionStart` hook fires in headless `-p`, and its context reaches the model.
- **P1c supported.** Denying one plugin MCP server leaves the plugin's other servers loaded.
- **P2 supported, with a gap.** A `mode: subagent` OpenCode agent works as the message agent, so Q3 is moot. However, built-in permission denies do not cover MCP tools.
- **P3 not supported.** The Codex app-server has no role selector.
- **Supermemory correction.** Project-scope memory is identical to native. Only global-scope memory differs; it gets a temporary entry owned by the memory redesign.

Earlier decisions remain in force: AGENTS.md through the plugin hook (Q1), skip-permissions only under `yolo` (Q2), context-mode and serena retired, the shared web-search route, and native-first MCP.

## 0. Native-first MCP model

Rule: a session child loads **exactly the native MCP set** of its runner. That set covers user servers, project servers per the native trust rules, and the Deck-installed capability servers (context7, codebase-memory, …). The session may change only two things:

1. **Add** the `deck` session server. This is inherent: the ledger, delegation and the approval relay all travel through it.
2. **Override** a capability on the closed `SESSION_CAPABILITY_OVERRIDES` list. Each override needs a concrete cross-runner reason and a necessity test showing that native behavior would not be equivalent.

| Capability | Native behavior | Cross-runner reason | Verdict |
|---|---|---|---|
| codebase-memory | Static plugin or config entry. Each process starts its own server (`runner-adapter.ts:738-741`). | Concurrent children on different runners share one managed rendezvous per project (`session-codebase-readiness.ts:1,38`). The reviewed digest is verified, cold start is bounded and reported as `capabilityAvailability`, and the server is released at task end (`session-shared-services.ts:106-123`). | **O, keep.** The only override. |
| Supermemory, project scope | Deck builds the profile at launch: the Claude official `--plugin-dir` plus sensitive env (`runner-adapter.ts:540`); `codex-supermemory-launch.ts:159-163`; `opencode-supermemory-launch.ts:115-118`. | None. The session reuses the same builders and the same raw-key env (`session-native-memory.ts:90-109`, project branch line 109). | **= (not an override).** Removed from `SESSION_CAPABILITY_OVERRIDES`. |
| Supermemory, global scope (no git identity) | Native Claude disables it (`claude-memory-session-disabled`, `runner-adapter.ts:540`). | Sessions enable it: `SUPERMEMORY_*` is scrubbed and a host loopback transport token is used instead (`session-native-memory.ts:105-108`, `session-shared-services.ts:98-105`). The user chose to enable it natively too. That belongs to the separate adaptive-memory redesign, so no mechanism is designed here. | **T.** Temporary tracked entry (§5.1 row 8). |
| web-search | Only OpenCode native applies `selectSearchRoute` (`adapter-opencode/runner-adapter.ts:1189-1199`). Claude ships a static plugin server (`capabilities.ts:56-60`); Codex has a fixed config block. | None. The route depends on native search availability, not on whether the run is a session. | **Not an override.** One shared route serves native and session (D3b). Claude and Codex native are **D** until they use it. |
| context-mode, serena | Retired. | n/a | **Not a parity item.** Their presence marks a stale generation and fails closed. The ad-hoc deletion at `session-shared-services.ts:55` and the retired entries in the Claude read-only tool list (`runner-adapter.ts:81-82`) and the OpenCode serena tool resolver (`developer-team-install.ts:308-331`) are removed. |

**Reader audit.** `readSessionMcpServers` becomes `readSessionCapabilityOverrides` on all three adapters and returns only override specs, which today means codebase-memory.

- **Codex** (`adapter-codex/runner-adapter.ts:692-711`): already native-first. Native `config.toml` loads every other server.
- **OpenCode** (`session-driver/mcp.ts:9-34`): already native-first. Native `opencode.json` loads every other server.
- **Claude** (`runner-adapter.ts:729-747`): option A denies every plugin server (`session-skills.ts:58-62`, `launch.ts:116-118`), so context7 is lost: **D**. The fix denies only overridden ids. P1c confirmed the mechanism.

## 1. Divergence matrix

### 1.1 Claude

| Aspect | Native (`deck claude developer`) | Session child | Mark → fix |
|---|---|---|---|
| Role/system prompt | `--agent deck-developer-team:deck-lead` (`runner-adapter.ts:540,563`) | Default prompt plus `sessionRolePrompt` (`session-service.ts:83-96`, `launch.ts:128`). No `--agent`. | **D** → D1 (locked: `--plugin-dir` + `--agent`) |
| Prompt profile | legacy (`runner-adapter.ts:75`) | compact (`session-service.ts:86`) | **D** → legacy removal plus D1 |
| Role tool restriction | `tools:` allow-list for investigate/quality, covering built-in read tools and the named read-only MCP tools (`runner-adapter.ts:77-85`) | None | **D** (safety) → D1. P1a: `tools:` is enforced under `--agent`. The list moves to the core policy (D9). |
| Skills | Plugin skills plus the per-agent `skills:` preload | After A: the same plugin, no preload | = / **D** preload → D1 |
| Hooks | Plugin hooks (RTK `PreToolUse`) | After A: the same | = |
| MCP: user/project/local | `claudeNativePolicy`, `--setting-sources` | Same (`launch.ts:71,107`) | = |
| MCP: plugin servers | Plugin `.mcp.json` (context7, codebase-memory) | After A: all denied; only codebase-memory re-supplied | **D** → D3a (override-only denials; P1c) |
| Codebase readiness | Static | Task-bound readiness | **O** |
| Web search | Static plugin `web-search`; no route | `selectSearchRoute` (`session-shared-services.ts:66-85`) | **D** (native) → D3b |
| Memory, project scope | Official plugin plus raw-key env | Same builders, same env | = |
| Memory, global scope | Disabled (`claude-memory-session-disabled`) | Enabled through the host transport | **T** (row 8) |
| Model/effort | Agent frontmatter | `--model`/`--effort` from the assignment (`launch.ts:98-101`) | I. P1a: the CLI model wins. |
| Project instructions | CLAUDE.md only | AGENTS.md injected (`session-service.ts:88,95`) | **D** → D7 (P1b: hook fires in `-p`) |
| Permissions | Native prompts | Relay by default; `--dangerously-skip-permissions` only under `yolo` (`session-manager.ts:1828`, `launch.ts:123-126`) | I → D8 |
| Delegation | Task/Agent | `--disallowedTools Task,Agent` plus `deck_delegate` | I |

### 1.2 Codex

| Aspect | Native | Session child | Mark → fix |
|---|---|---|---|
| Role/system prompt | Lead: `CODEX_ROOT_LEAD_BOOTSTRAP` (`runner-adapter.ts:230-238,921`). Members: `.codex/agents/<role>.toml` `developer_instructions` (`developer-team-install.ts:114-126`). | `developerInstructions = sessionRolePrompt` (`session-driver/driver.ts:201`) | **D** → D1 (locked: verified installed bytes plus overlay; P3 found no selector) |
| Capability instructions | In the role TOML | Absent | **D** → D1 (the bytes carry them) |
| Role model/effort | TOML `model`, `model_reasoning_effort` (`developer-team-install.ts:124-125`) | Assignment only; TOML values ignored | **D** → D5 (passed explicitly) |
| Role tool restriction | None: no read-only sandbox and no MCP filter on read-only roles | None | **CD** → D9 |
| Skills | `~/.agents/skills` | Same | = |
| Hooks | `[hooks]` under `--dangerously-bypass-hook-trust` | Memory hooks only; RTK not admitted (`session-driver/launch.ts:55-65`) | **D** → D4 |
| MCP | Native `config.toml` | Native plus `deck` plus override | = / I / **O** |
| Web search | Fixed block; no route | Shared route | **D** (native) → D3b |
| Memory, project / global | Builders plus raw-key env / per runner | Same / host transport | = / **T** |
| Permissions | Bypass flags (`launch.ts:114`) | Relay `on-request`/`read-only`; `yolo` `never`/`danger-full-access` (`driver.ts:203-204`) | I |
| Delegation | `multi_agent` | `features.multi_agent{,_v2}=false` | I |
| Project instructions | Native AGENTS.md | Native | = |

### 1.3 OpenCode

| Aspect | Native | Session child | Mark → fix |
|---|---|---|---|
| Role/system prompt | Agent `deck-<role>` (`developer-team-install.ts:344-383`) | `system: rolePrompt`, default `build` agent (`driver.ts:131,353`) | **D** → D1 (locked: `agent: deck-<role>`; P2) |
| Role tools / permission | `SUBAGENT_BASE_TOOLS` gives **every** member `bash/edit/write: true` (`developer-team-install.ts:257-262,358-360`). Built-in denies never cover MCP tools (P2). | Seeded from `build` | **D** (session) plus **CD** (native: read-only roles can write through built-ins and through MCP) → D9 |
| Capability instructions / personality | Prompt files | Absent | **D** → D1 |
| Skills | Native roots | Same, plus global roots re-admitted when untrusted | = / I |
| Execution plugin | `developer-team-execution.js` | Inherited, not asserted | Asserted under D1 (§4) |
| MCP | Native `opencode.json` | Native plus `deck` plus override | = / I / **O** |
| Web search | Shared route | Shared route | = |
| Memory, project / global | Builders / per runner | Same / host transport | = / **T** |
| Model/variant | Agent entry | Assignment (`driver.ts:353-354`) | I |
| Permissions | Native | Relay `ask`; `yolo` `allow`; native denies kept | I |
| Delegation | Lead `task` allow-list | `task:* deny` | I |
| Headless | TUI | `serve` loopback, `share: disabled`, `autoupdate: false`, trust grant | I |

### 1.4 Pi

There is no session driver. A Pi lead is refused at `session-manager.ts:1179-1180` (`runner-driver-unavailable`). Parity requires a driver that reuses `--system-prompt <profile>/system-prompt.md --extension <deck package>` (`pi-team-launch.ts:139-158`) and adds only the overlay, `deck`, the delegation policy and the codebase-memory override. Until such a driver exists, Pi is allow-listed as `unsupported`, and delegation to it fails closed.

Dead code: `createSessionMemoryPort` (`apps/cli/src/session-shared-services.ts:15-35`) returns a port only when `leadRunnerId === "pi"`. Its only production consumer, `session-service.ts:128`, can never reach that branch, because a Pi lead fails earlier. It is removed together with its wiring and its tests (`session-shared-services.test.ts:46,64,74,126`), unless the removal slice finds another consumer. A Pi driver that needs host memory later would reintroduce it as part of that driver.

### 1.5 Defect count

| Area | Defects |
|---|---|
| Claude (6) | role source and preload, capability instructions, read-only tools, plugin MCP denied, native web-search route, AGENTS.md asymmetry |
| Codex (5) | role bytes, capability instructions, role model/effort ignored, RTK hook not admitted, native web-search route |
| OpenCode (3) | agent selection, role tools/permission, capability and personality content |
| Shared core (1) | Read-only roles can reach write/exec tools on native OpenCode (built-ins and MCP) and on native Codex. Native Claude is already restricted. |

There is also one temporary tracked gap: global-scope memory (row 8).

## 2. Decisions (locked)

**D1. The role source is the runner's installed artifact.**

- **Claude:** `--plugin-dir <verified generation> --agent deck-developer-team:<roleId>`. The overlay is the only appended text (P1a).
- **OpenCode:** permissions are seeded from `deck-<role>`, the message carries `agent: "deck-<role>"`, and `system` holds the overlay only (P2). There is no `mode` change.
- **Codex:** `developerInstructions` = the **verified installed bytes**, followed by the overlay. For members, those bytes are the role TOML's `developer_instructions`; for the Lead, they are the `roleSelection` part of the bootstrap. This is the only branch, because P3 found no selector.
- `sessionRolePrompt` keeps no role text.

**D2. Split the Codex Lead bootstrap** into `roleSelection` (shared with native) and `delegation(native|session)`. Only the delegation part is allow-listed.

**D3a. Override-only MCP denials on Claude.**

- `claudeSessionPluginMcpDenials` becomes `claudeSessionOverrideDenials`. It denies `plugin:deck-developer-team:<id>` only for overridden ids, which today means codebase-memory when it is bound.
- `readSessionCapabilityOverrides` rejects any id outside `SESSION_CAPABILITY_OVERRIDES` with `session-capability-override-unlisted`.
- An override without a paired native denial fails with `claude-mcp-override-unpaired`.
- The managed `{codebase-memory}` filter (`session-shared-services.ts:59-61`) is replaced by the override list.

**D3b. One web-search route, native and session.**

- `@deck/core` `resolveWebSearchLaunch(runner, evidence, provider, credential)` returns `{route, fallbackServer?, suppressOwnedIds, envOverlay?}`, built on `selectSearchRoute`.
- Native Claude (`runner-adapter.ts:556-563`), native Codex, native OpenCode (already) and `resolveSessionChildMcp` all call it.
- On Claude, `web-search` leaves the plugin `.mcp.json`. When the route is `fallback`, the server is added through `--mcp-config` in both native and session launches.

**D4. Codex hooks without a global trust bypass.**

- The session admits exactly the Deck manifest hooks (RTK, memory, execution if present) by `trusted_hash`, with `features.hooks=true`.
- The startup `hooks/list` check fails closed if one is missing.
- Being stricter than native is allow-listed.

**D5. Model and effort.**

- The cross-runner assignment wins (allow-listed).
- Claude: `--model`/`--effort` (P1a).
- Codex: without a role selector, the session passes model and effort **explicitly** on `thread/start` and each turn. The values are the assignment when it is set; otherwise they come from the verified role TOML `model`/`model_reasoning_effort`. The TOML's values are never silently dropped.
- OpenCode: the assignment, or else the agent entry.

**D6. Legacy removal is a prerequisite.** After it, one profile remains. The guard asserts that the session path makes no `getAgentContent` role-body call.

**D7. AGENTS.md on Claude comes from a hashed plugin `SessionStart` hook** (P1b).

- The script reuses the reader in `session-project-instructions.ts`.
- The session injection (`session-service.ts:88,95`) is removed, and there is no `project-instructions` overlay section.

**D8. `yolo` is the only skip-permissions path.** Relay is the default, and the guard asserts that relay launches never contain skip flags.

**D9. Shared core role tool policy, including MCP (CD fix; applies to native and session).**

`@deck/core` owns `ROLE_TOOL_POLICY`:

- Read-only roles (`deck-investigate`, `deck-quality`) get read built-ins (read, grep, glob, skill) and an explicit list of read-only MCP tool ids for each Deck capability (context7 `resolve-library-id`/`query-docs`; the codebase-memory query tools; the web-search `tavily_search`/`tavily_extract`).
- Every other MCP tool is **denied by default**, including user and project servers.
- Writing roles keep the current tools.

Each adapter materializes the policy natively, and the session inherits it through D1:

- **Claude:** agent `tools:` is generated from the policy. This replaces the adapter-local list at `runner-adapter.ts:77-85` and drops the retired context-mode and serena entries. The behavior is otherwise unchanged; P1a showed it is already enforced.
- **OpenCode:** read-only agent entries get built-in `bash/edit/write` set to `false`, a deny-by-default MCP rule, and allows for the listed read tool ids, in both `tools` and `permission`. The session seeds permissions from this same entry, so the relay and `yolo` overlays cannot relax it: native denies are never relaxed (`driver.ts:133-139`). Slice acceptance must prove live that an MCP shell or write tool is unavailable to `deck-quality`; P2 showed that the built-in denies alone fail this.
- **Codex:** the read-only role TOML gets `sandbox_mode = "read-only"`. MCP tools are restricted through Codex's native per-server tool filtering, if the installed Codex supports it. If it does not, the slice records Codex MCP restriction as a residual native gap in `apply-progress.md` and the guard pins the current shape. The session never silently differs from native.
- **Pi:** the native tool policy extension (`deck-tool-policy.generated.js`) consumes the same policy. This is verified in the slice. Pi stays without a session driver.

**D10. Memory.** No new memory mechanism is introduced.

- Project scope is identical to native and is not allow-listed.
- Global scope keeps current session behavior, recorded as the temporary entry in row 8.
- `createSessionMemoryPort` is removed as dead code (§1.4).

## 3. Session overlay contract (`@deck/core/session/overlay.ts`)

```ts
type SessionOverlaySection =
  | { kind: "session-notice" }
  | { kind: "delegation"; members: string[] }                // Lead only
  | { kind: "task-roster"; tasks: SessionRolePromptTask[] }  // Lead only
  | { kind: "continuity"; taskId: string; attempt: number }  // Lead only
  | { kind: "decision-guidance" }                            // Lead only
  | { kind: "memory-status" }
  | { kind: "change-binding"; changePath: string }
  | { kind: "handoff"; text: string } | { kind: "images"; refs: ImageRef[] }
  | { kind: "notices"; text: string };
renderSessionOverlay(roleId, sections): string
```

Core owns the text and ordering, session-host supplies the data, and drivers place the overlay in the runner's append slot. The overlay must not contain the role body, `CRITICAL_SAFETY_GIT_DISCARD_PROTECTION`, the team contract, capability-instruction markers or project instructions.

## 4. Generation verification (all drivers)

`NativeRoleDescriptor { runnerId, generationRoot, selectionPath, selectionHash, contentHash, roleRef, files }` generalizes `NativeSkillsDescriptor` (`core/session/driver.ts:52-60`). The host prepares it, and the driver re-verifies it before spawn.

| Runner | Generation source | roleRef |
|---|---|---|
| Claude | Selection metadata plus generation dir (`runner-adapter.ts:479-489`). The hash includes the `SessionStart` hook, the route-free `.mcp.json` and the policy-generated `tools:`. | `deck-developer-team:<roleId>` |
| Codex | `CODEX_MANIFEST_PATH` plus owned `config.toml` blocks plus role TOML (`developer_instructions`, `model`, `model_reasoning_effort`, `sandbox_mode`) | `.codex/agents/<role>.toml` (Lead: bootstrap `roleSelection`) |
| OpenCode | Install contributions plus agent entry (tools and permission per D9), prompt files, execution plugin | `deck-<role>` |

Any mismatch or missing file, including a retired capability, throws `<runner>-session-generation-unverified` before spawn, with remediation `deck upgrade`. A post-start assertion checks the reported agent or role, plugins and hooks. Drivers never fall back to rendered content or a default agent.

## 5. Parity guard (`packages/core/src/session/parity.ts` plus per-adapter `*.parity.test.ts`)

```ts
type ParityLaunchShape = {
  roleSource: { kind: "native-agent" | "verified-bytes"; ref: string; hash: string };
  roleTools: { builtins: string[]; mcpAllowed: string[]; mcpDefault: "allow" | "deny" };
  skillsRoots: string[]; skillPreload: string[]; plugins: string[]; hooks: string[]; executionPolicy: string[];
  mcpNative: Record<string, string>; mcpAdded: string[]; mcpOverridden: string[];
  webSearch: { route: "disabled" | "native" | "fallback"; serverId?: string };
  memory: { scope: "project" | "global" | "off"; envSecrets: string[] /* names only */ };
  settingSources: string; projectInstructions: "native" | "native-hook" | "none";
  model?: string; effort?: string; permissionMode: "native" | "relay" | "yolo";
  delegation: "native" | "deck"; overlaySections: string[];
};
type ParityAllowEntry = { runner: RunnerId | "*"; field: keyof ParityLaunchShape | "*"; rule: string;
  category: "ledger" | "delegation" | "approval-relay" | "session-mode" | "evidence" | "headless-transport"
          | "capability-override" | "unsupported" | "temporary-tracked";
  justification: string;
  necessityTest?: string;                                        // required for capability-override
  temporary?: { owner: string; expiresWhen: string; reviewBy: string }; // required for temporary-tracked
};
const SESSION_CAPABILITY_OVERRIDES = ["codebase-memory"] as const;
```

The guard builds both plans from one hermetic fixture install, for the Lead and for `quality`, in relay and in `yolo`, and with a git-identified project and a project without a git identity. It diffs the two plans and fails if any of the following holds:

- There is an unlisted difference, or an allow-list entry is unused.
- `mcpNative`, `webSearch`, `roleTools` or `memory` (project scope) differ.
- `mcpOverridden` contains an id outside `SESSION_CAPABILITY_OVERRIDES`.
- A `capability-override` entry has no existing `necessityTest`.
- A `temporary-tracked` entry lacks `temporary`, or its `reviewBy` date has passed (the same expiry discipline as `tests/quarantine.yaml`).
- A `global` memory difference exists while no `temporary-tracked` memory entry exists.
- The `quality` shape on any runner has a write or exec built-in, or `mcpDefault: "allow"`. This check applies to native shapes too (D9).

### 5.1 Final allow-list

| # | Runner | Field | Rule | Category | Justification |
|---|---|---|---|---|---|
| 1 | * | delegation | Native subagents disabled (Claude `--disallowedTools Task,Agent`; Codex `multi_agent{,_v2}=false`; OpenCode `task:* deny`); `deck_delegate` instead. Codex bootstrap `delegation(session)` part only. | delegation | Cross-runner members are ledger tasks. |
| 2 | * | overlaySections | Closed overlay set (§3) in the runner's append slot | ledger | Roster, continuity, handoff and change binding exist only in a session. |
| 3 | * | mcpAdded | `deck` session server only | ledger | Transport for ledger, delegation and the relay. |
| 4 | * | permissionMode | `relay` (default): Claude `--permission-prompt-tool mcp__deck__deck_approve`; Codex `on-request`/`read-only`; OpenCode `ask`. Native denies are never relaxed. | approval-relay | Headless children have no native prompt UI. |
| 5 | * | permissionMode | `yolo` only: Claude `--dangerously-skip-permissions`; Codex `never`/`danger-full-access`; OpenCode `*: allow` with native denies and D9 role denies kept | session-mode | Explicit acknowledged user choice; never in relay. |
| 6 | * | model, effort | Cross-runner assignment wins. Claude CLI flags (P1a); Codex explicit `thread/start` and turn values, defaulting to the verified TOML. | ledger | The roster is the cross-runner feature. |
| 7 | * | mcpOverridden | codebase-memory: native entry denied, rebound to `SessionCodebaseReadiness` | capability-override | Shared rendezvous, digest verification, bounded readiness, release. necessityTest: `session-codebase-readiness` shared-entry and digest-mismatch tests. |
| 8 | claude, codex, opencode (only where native differs) | memory | **Global-scope memory: session-only until memory redesign.** With no git identity, a session enables Supermemory through the host loopback transport (raw `SUPERMEMORY_*` scrubbed); native Claude disables it. | temporary-tracked | The user chose native enablement too, but the adaptive-memory redesign (separate session) owns it. `temporary: { owner: "adaptive-memory-redesign", expiresWhen: "memory redesign makes native and session global scope identical", reviewBy: "2026-11-23" }`. The guard's unused-entry check limits it to runners where the difference is real. |
| 9 | codex | hooks | Deck hooks admitted by exact `trusted_hash`; no `--dangerously-bypass-hook-trust` | approval-relay | Stricter than native; no unreviewed hooks under relay. |
| 10 | opencode | * (transport) | `serve` loopback, `share: disabled`, `autoupdate: false`; host project-trust grant | headless-transport | No TUI; the session must not publish or self-update. |
| 11 | pi | * | No driver; delegation fails closed `session-runner-unsupported` | unsupported | §1.4. |

Removed relative to revision 2:

- The former row 8 ("Supermemory credential transport"). Project scope is identical to native.
- `supermemory-credential-transport` from `SESSION_CAPABILITY_OVERRIDES`.

The `reviewBy` date in row 8 is a proposed 4-week review checkpoint. The Lead may adjust it when recording the entry.

## 6. Adapter responsibilities

| Layer | Owns |
|---|---|
| `@deck/core` | Role content (single profile), overlay renderer, `NativeRoleDescriptor`, `ParityLaunchShape`, allow-list, `SESSION_CAPABILITY_OVERRIDES`, `ROLE_TOOL_POLICY`, `resolveWebSearchLaunch`, Codex bootstrap split |
| Adapters | Native materialization (Claude `SessionStart` hook, route-free `.mcp.json`, policy `tools:`; OpenCode agent tools and permission; Codex TOML sandbox and MCP filter), `prepareSessionRole`, `readSessionCapabilityOverrides`, override-only denials, native web-search route, parity normalizers |
| `apps/cli` | Composition only. No role text, no AGENTS.md, no `createSessionMemoryPort`. |
| `session-host` | Overlay data, `nativeRole` passthrough, `yolo` → `runner-default`, fail-closed unsupported runners |

## 7. Live-check results (completed)

| Probe | Result | Locked branch |
|---|---|---|
| P1a Claude `--agent` + `--model` | Supported; the CLI model wins; `tools:` enforced | D1, D5 Claude |
| P1b `SessionStart` in `-p` | Fires; its context reaches the model | D7 |
| P1c single plugin MCP denial | The other servers stay loaded | D3a |
| P2 OpenCode subagent as message agent | Supported; built-in denies apply but do not cover MCP tools | D1 OpenCode, D9 |
| P3 Codex role selector | None | D1 Codex verified bytes, D5 explicit model/effort |

The P1 run also showed that the installed Claude generation still declares context-mode and serena. That generation is stale and will fail closed until `deck upgrade` runs.

## 8. Open questions

None. Q1 and Q2 are resolved, and Q3 is moot (P2). Global-scope memory alignment belongs to the adaptive-memory redesign (row 8).
