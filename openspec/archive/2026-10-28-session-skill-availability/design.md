# Design: native/session parity

Legend: **=** identical · **I** inherent-justified (allow-listed) · **O** capability override (allow-listed, necessity-tested) · **T** temporary tracked allow-list entry · **D** defect · **CD** shared core defect (native has it too).

Revision 5 (2026-10-26) reconciles the revision-4 native readiness channel with approved mixed-runner capability scope (§8). Revision 3 locked the design branches using the live-check results (`task-1295d93c…`, report `report-attempt-1.txt`) and the latest user decisions in `working-brief.md`:

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

**D3a. Paired Codebase overrides and explicit availability omissions.**

- A working managed Codebase binding retains its exact paired native denial and replacement spec.
- A separate typed launch disposition represents enabled/unavailable Codebase. It denies only `plugin:deck-developer-team:codebase-memory`, supplies no replacement, and retains enabled intent and verified native role/generation bytes. Generic suppression strings cannot establish this disposition.
- Share the pure disposition/settings policy across Claude native and session launch builders. Merge its exact deny with existing invocation settings; do not rewrite installed/plugin/user configuration or disable other sources.
- Unpaired overrides and omissions without current trusted evidence still fail closed. The availability omission is the only newly permitted unpaired denial under this decision.
- Native and managed backend observations are route-qualified. Add real native observation outside the readiness evaluator before claiming native failure coverage. Do not reuse the managed failure as native evidence or silently migrate the native backend.
- Pass the typed availability result to the existing roster and SessionStart assembly. Keep index readiness independent, the evaluator free of subprocess/network effects, and runtime gaps report-only.
- Preserve all current intent/generation/revocation fences and authenticated Setup authority. Validate exact expected-absent plugin/tool identities at the supported startup boundary.


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

**D7. AGENTS.md on Claude comes from a hashed plugin `SessionStart` hook** (P1b). Since revision 4 that hook is Claude's session-start core context channel (§8.4): it emits `composeSessionStartContextV1`, which is AGENTS.md plus the readiness block.

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
- **Codex:** the read-only role TOML gets `sandbox_mode = "read-only"`. MCP tools are restricted through Codex's native per-server tool filtering, if the installed Codex supports it. If it does not, the slice records Codex MCP restriction as a residual native gap in `apply-progress.md` and the guard pins the current shape. The session never silently differs from native. Recording a residual limitation does not satisfy the read-only policy or parity acceptance. If required MCP denies cannot be enforced, the affected read-only role launch remains unavailable and S2 is incomplete for that runner; the guard must not normalize an unsafe tool set into success.
- **Pi:** the native tool policy extension (`deck-tool-policy.generated.js`) consumes the same policy. This is verified in the slice. Pi stays without a session driver.

**D10. Memory.** No new memory mechanism is introduced.

- Project scope is identical to native and is not allow-listed.
- Global scope keeps current session behavior, recorded as the temporary entry in row 8.
- `createSessionMemoryPort` is removed as dead code (§1.4).

## 3. Session overlay contract (`@deck/core/session/overlay.ts`)

```ts
type SessionOverlaySection =
  | { kind: "session-notice" }
  | { kind: "delegation"; members: string[]; capabilities: MemberCapabilityRow[] }                // Lead only
  | { kind: "task-roster"; tasks: SessionRolePromptTask[] }  // Lead only
  | { kind: "continuity"; taskId: string; attempt: number }  // Lead only
  | { kind: "decision-guidance" }                            // Lead only
  | { kind: "memory-status" }
  | { kind: "change-binding"; changePath: string }
  | { kind: "handoff"; text: string } | { kind: "images"; refs: ImageRef[] }
  | { kind: "notices"; text: string };
renderSessionOverlay(roleId, sections): string
```

MemberCapabilityRow carries actual runner, new-task versus preserved-continuation identity, enablement and separately evidenced availability (§8.4). Readiness findings and repair instructions are forbidden in every overlay section, including generic notices and handoffs.

Core owns the text and ordering, session-host supplies the data, and drivers place the overlay in the runner's append slot. The overlay must not contain the role body, `CRITICAL_SAFETY_GIT_DISCARD_PROTECTION`, the team contract, capability-instruction markers, project instructions or the `<deck-project-readiness` block (§8.4).

## 4. Generation verification (all drivers)

`NativeRoleDescriptor { runnerId, generationRoot, selectionPath, selectionHash, contentHash, roleRef, files }` generalizes `NativeSkillsDescriptor` (`core/session/driver.ts:52-60`). The host prepares it, and the driver re-verifies it before spawn.

| Runner | Generation source | roleRef |
|---|---|---|
| Claude | Selection metadata plus generation dir (`runner-adapter.ts:479-489`). The hash includes the `SessionStart` hook, the route-free `.mcp.json` and the policy-generated `tools:`. | `deck-developer-team:<roleId>` |
| Codex | `CODEX_MANIFEST_PATH` plus owned `config.toml` blocks plus role TOML (`developer_instructions`, `model`, `model_reasoning_effort`, `sandbox_mode`) | `.codex/agents/<role>.toml` (Lead: bootstrap `roleSelection`) |
| OpenCode | Install contributions plus agent entry (tools and permission per D9), prompt files, execution plugin | `deck-<role>` |

Any mismatch or missing file, including a retired capability, throws `<runner>-session-generation-unverified` before spawn, with remediation `deck upgrade`. After startup, each adapter validates the native session/process identity and the plugin/hook evidence its protocol exposes. Role identity is bound to the host-verified native selection used for that launch (Claude agent reference, OpenCode selected agent, or Codex verified instruction bytes), with native reported-role evidence checked where actually available. Repair authority activates only after that validated binding; generic turn-start events, MCP inventory and model-provided role fields cannot activate it. Drivers never fall back to rendered content or a default agent.

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
  sessionStartContext: { channel: string; localBaseDigest: string; coordinationScopeDigest: string; coordinationOutputDigest: string }; // independently derived projections; §8.8
};
type ParityAllowEntry = { runner: RunnerId | "*"; field: keyof ParityLaunchShape | "sessionStartContext.coordination" | "*"; rule: string;
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
- Unrelated `mcpNative`, `webSearch`, `roleTools` or project-scope `memory` differ. Only the exact Codebase availability/route difference supported by independent backend evidence is permitted under D3a.
- Native readiness delivery or the independently derived local/base projection differs; complete readiness bytes differ on equal scope/evidence; or unequal scopes differ beyond row 12 typed coordination data.
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
| 12 | * | sessionStartContext.coordination | Only canonical readiness evidence for additional participating runner bindings may differ; equal scope/evidence requires equal full bytes and the local projection/native channel remain identical. | evidence | Approved consolidated findings; no readiness overlay and no disabled capability grants. |

Removed relative to revision 2:

- The former row 8 ("Supermemory credential transport"). Project scope is identical to native.
- `supermemory-credential-transport` from `SESSION_CAPABILITY_OVERRIDES`.

The `reviewBy` date in row 8 is a proposed 4-week review checkpoint. The Lead may adjust it when recording the entry.

## 6. Adapter responsibilities

| Layer | Owns |
|---|---|
| `@deck/sdd-runtime` | `runProjectReadinessPreflightV1`, `formatReadinessBlockV1`, `composeSessionStartContextV1`, project-instructions reader, `migrateRetiredTddKeysV1`, scope aggregation, component cache policy and shared `PreparationService` (§8) |
| `@deck/core` | Role content (single profile), overlay renderer, `NativeRoleDescriptor`, `ParityLaunchShape`, allow-list, `SESSION_CAPABILITY_OVERRIDES`, `ROLE_TOOL_POLICY`, `resolveWebSearchLaunch`, Codex bootstrap split |
| Adapters | Native materialization (Claude `SessionStart` hook, route-free `.mcp.json`, policy `tools:`; OpenCode agent tools and permission; Codex TOML sandbox and MCP filter), `prepareSessionRole`, `readSessionCapabilityOverrides`, override-only denials, native web-search route, parity normalizers, authorized runner evidence and authenticated role/invocation binding |
| `apps/cli` | Composition only. No role text, no AGENTS.md, no readiness text, no `createSessionMemoryPort`. |
| `session-host` | Effective roster/actual task assignments, immutable snapshot coordination, ledger deduplication, overlay data, `nativeRole` passthrough, `yolo` → `runner-default`, fail-closed unsupported runners |

## 7. Live-check results (completed)

| Probe | Result | Locked branch |
|---|---|---|
| P1a Claude `--agent` + `--model` | Supported; the CLI model wins; `tools:` enforced | D1, D5 Claude |
| P1b `SessionStart` in `-p` | Fires; its context reaches the model | D7 |
| P1c single plugin MCP denial | The other servers stay loaded | D3a |
| P2 OpenCode subagent as message agent | Supported; built-in denies apply but do not cover MCP tools | D1 OpenCode, D9 |
| P3 Codex role selector | None | D1 Codex verified bytes, D5 explicit model/effort |

The P1 run also showed that the installed Claude generation still declares context-mode and serena. That generation is stale and will fail closed until `deck upgrade` runs.

## 8. Project readiness with native enablement and shared coordination

### 8.1 Approved behavior and boundaries

Each member retains exactly the capabilities enabled by Deck's native resolver for its assigned runner. A session-wide union is used ONLY to decide which shared project components require inspection or preparation. It never enables a capability, adds its instructions, exposes its MCP tools, or widens a member's permissions.

OpenSpec initialization/configuration, removal of retired Deck testing keys, and the skill registry are always-on project components. An optional project component is included when at least one participating runner enables it. Runner components are included only for participating runners that enable the capability. Disabled entries belong in the capability roster as `disabled`; they produce no probe, degradation, repair, install recommendation, or optional-capability guidance.

Lead receives one consolidated readiness block with shared project findings and runner-qualified findings, plus a compact per-member capability roster. Setup repairs project components through trusted preparation authority. Runner installation, plugin, executable and credential gaps are report-only and carry runner-specific remediation, normally `deck upgrade` or the applicable runner sync/configuration flow. Setup never installs, downloads, upgrades, changes enablement, or writes user-global configuration.

Native session-start delivery from revision 4 remains mandatory. Readiness and project instructions remain forbidden in the session overlay. Strict TDD, strict-policy opt-in, retired TDD skills, legacy profiles and compatibility restoration are not introduced.

### 8.2 R1. Trusted scope, component identity and evidence

The core preparation service accepts a trusted, immutable scope assembled by the runner host. In native mode it contains the current runner and native member assignments. In a cross-runner session it contains the effective member roster, including Lead and Setup, and the actual runner of every queued, running or explicitly resumed task. Do not inspect every installed runner on the account. Historical completed tasks do not keep a runner participating merely because they appear in the ledger; selecting a continuation adds its preserved runner before admission.

Use the actual task assignment for continuations: current `session-manager.ts:684` retains the previous runner/model. The configured member assignment describes new tasks and must not be shown as if it changed an existing task. A roster row may therefore distinguish `new tasks: codex` and `continuation task-X: claude`.

The host obtains effective enablement from the same core/native resolvers used at launch, including per-runner overrides. For Codebase Memory this is `isCodebaseMemoryEnabled(config, runnerId)`. Package guidance selection is not evidence of plugin readiness; adaptive-memory guidance and runtime enablement are separate. Code-economy currently normalizes to always-on guidance and has no project initializer: do not invent a binary probe or a new toggle. Future capabilities declare scope and bounded evidence readers in the canonical catalog, not in the model prompt.

Conceptual internal contracts (names may follow repository conventions):

```ts
type ReadinessKey =
  | { scope: "project"; component: string; projectRootDigest: string }
  | { scope: "runner"; component: string; runnerId: string; bindingDigest: string };
type ReadinessObservation = {
  key: ReadinessKey;
  status: "ready" | "degraded" | "indeterminate";
  reasonCode: string;
  requiredBy: readonly { memberId: string; runnerId: string; taskId?: string }[];
  evidenceDigest: string;
  repair: "project" | "report-only" | "none";
};
type MemberCapability =
  | { capabilityId: string; enablement: "disabled" }
  | { capabilityId: string; enablement: "enabled";
      availability: "ready" | "unavailable" | "unverified" };
type ReadinessScope = {
  sessionId: string; sessionEpoch: string; projectRootDigest: string;
  rosterRevision: number; rosterDigest: string; policyDigest: string;
  members: readonly MemberBinding[];
};
```

The scope and member bindings are trusted service inputs, never tool arguments accepted as authority. Member bindings carry the runner's normalized enablement, verified generation identity, relevant source-exposure identity and launch identity. A model/provider change invalidates web-search evidence if native search depends on it; it need not repeat unrelated OpenSpec checks. Do not assume two instances of one runner have equivalent runtime evidence when their generation, launch environment or search route differs.

| Component | Scope / inclusion | What bounded evidence proves |
|---|---|---|
| OpenSpec/config and retired keys | Project, unconditional | Parse the same bounded YAML bytes once; distinguish missing, invalid syntax, uninitialized and unreadable. Inspect only retired Deck policy fields, preserving user commands. |
| Skill registry | Shared project file, unconditional | Read/parse the file once. Validate runner exposure/freshness separately from supplied bounded source snapshots for participating runners. |
| Codebase Memory index | Project, when any participant enables it | A project-bound index observation with explicit freshness/generation; directory existence and an MCP handshake are insufficient. |
| Codebase Memory install/protocol evidence | Runner binding, enabled only | Verified install evidence and already-produced availability; no startup probe from the preflight. |
| RTK | Runner binding, enabled only | Bounded executable-path metadata and verified hook/materialization evidence. A leftover hook does not override disabled configuration. |
| Adaptive memory | Runner binding, enabled only | Existing native preparation evidence for plugin/config/credential availability. No recall, capture, authentication request, or new memory mechanism. |
| Web search | Runner binding, enabled only | The existing shared native route and supplied evidence; no search or provider request. |
| Other capabilities | Catalog-declared project or runner scope, enabled only | Only the bounded prerequisite relevant to the declared initializer; an instruction-only capability has no invented preparation work. |

Registry nuance: the existing fingerprint incorporates `activeRunnerId` and source declarations (`registry.ts:561–574`). A single Lead-runner status cannot prove readiness for every member. Read the shared bytes once, associate runner-qualified validation findings with their actual exposure, and have one project-file repair owner. A runner must not enumerate another runner's exclusive skill roots. Adapters may supply snapshots only from sources they are authorized to expose. Do not repeatedly refresh the same file for alternating runners or claim that a different runner's valid projection is corruption. If current representation cannot validate another runner, classify that view as indeterminate and retain bounded direct discovery. A new multi-runner registry format is outside this reconciliation; it is not silently required by aggregation.

`runProjectReadinessPreflightV1` is a bounded read-only evaluator. It consumes already-resolved config and supplied runtime observations and uses a budgeted local reader for project evidence. It does not call launch builders that spawn processes, initialize servers, fetch credentials remotely, traverse arbitrary roots, or write state. No network, subprocess, project write, user-config write, or Deck-state write occurs inside it.

Budget the entire evaluation, including fingerprints and missing-path checks: deadline, read/stat count, maximum bytes, YAML depth/node count and bounded participant count. The revision-4 `250 ms / 16 reads` is an initial budget, not a promise that every mixed roster fits. Over-budget or unavailable evidence is indeterminate, never ready or degraded by inference. Use abortable reads where possible; synchronous filesystem calls do not provide a hard wall-clock deadline. Do not promise a hard 250 ms return on a stalled filesystem.

Component failures remain local: preserve independently proven degraded findings; unknown components cannot enter the repair set. A failure to establish trusted root/scope makes the whole result indeterminate. The result always retains observations and completeness for diagnostics, avoiding revision 4's conflicting whole-run and component-level error rules.

### 8.3 Index readiness: no hidden live probe

Keep server availability separate from project index state. `SessionCodebaseReadiness` creates a runtime directory, starts a supervised backend, initializes MCP, and calls `tools/list`; it never establishes this project's indexing state. Its existing allow-listed lifecycle remains outside the project preflight. Do not call it from the preflight or relabel its `ready` as `index-ready`.

The Pi inventory helper checks `.codebase-memory` directories (including HOME) and labels existence `indexed-verified`; do not reuse that label as proof. Absence at those guessed locations also cannot prove that an externally stored index is missing.

For the bounded implementation, accept a trusted, already-available project-index observation only if it names the canonical project, backend identity, index generation and freshness/invalidation evidence. A supported local metadata reader may supply this if its storage contract and bounds are verified. Otherwise report `indeterminate/index-state-unverified` to diagnostics and do not auto-index. Do not add an MCP call, subprocess, network request, or synthetic ready marker to make this case pass. Observation collection through an existing allowed native capability is a separate operation; cached output without a trustworthy freshness binding is not current evidence.

Project repair may invoke only a verified, project-scoped initializer. The existing authorization target `.codebase-memory` is a declared contract, not proof of the backend's actual storage layout. Before wiring indexing, demonstrate that the operation is limited to the selected project's index and cannot modify unrelated projects or user configuration. If no bounded evidence reader or safely scoped initializer is available, preserve `indeterminate` or report the repair limitation. Expanding discovery to live probes or widening storage authority would be a new product decision; this proposal does neither.

### 8.4 R2. Formatter, capability roster and native delivery

`formatReadinessBlockV1` emits one deterministic `<deck-project-readiness v1>` block for proven degraded findings. It groups project findings once with `requiredBy` runner/member labels and groups runner findings by runner and relevant binding. Fixed identifiers/reason codes and stable ordering prevent arbitrary evidence text from becoming instructions. `ready` and wholly indeterminate results emit no readiness block. Indeterminate details stay in diagnostics; the capability roster may still say `enabled/unverified`.

The block distinguishes:

- Project repair candidates: Lead delegates once to Setup with exact component identities and snapshot reference.
- Runner remediation: report the affected runner and remedy, without requesting Setup installation.
- Mixed outcomes: unknown components are excluded from automatic repair, while separately proven project defects remain actionable.

The formatter can remain role-neutral: members receive the same coordination facts but only Lead requests the Setup delegation. Role-neutral delivery is not authorization to repair.

The compact roster is data, for example `quality@codex: codebase-memory=disabled; web-search=enabled/unverified`. It distinguishes enablement from availability and current assignments from preserved continuations. The existing Lead-only delegation/member-roster overlay section may carry this typed capability data. It must not carry readiness findings, repair commands, capability instruction bundles or the readiness marker. No new readiness overlay kind or untyped `notices` bypass is allowed.

`composeSessionStartContextV1` still delivers project instructions only where not natively loaded (Claude), followed by the one readiness block. Delivery remains:

| Runner | Native channel, also used in session children |
|---|---|
| Claude | Hashed plugin `SessionStart` hook, `additionalContext`; startup/resume/clear/compact |
| Codex | Trusted Deck `SessionStart` hook, `additionalContext`; verify app-server delivery and native subagent lifecycle separately |
| OpenCode | Execution plugin computes/obtains the snapshot on session creation or explicit lifecycle invalidation; system transform reads cached text only |
| Pi | Native extension session-start lifecycle computes/obtains snapshot; before-agent-start appends cached text; no Pi cross-runner driver |

One core coordinator owns a logical session's snapshot and concurrent evaluation. The cross-runner host supplies the effective roster; the native host supplies native scope. Child hooks read the immutable prepared snapshot through trusted runner plumbing rather than each independently evaluating the project. A short-lived hook's process-local map cannot implement a cross-process session cache. Scope/snapshot transport is separate from the evaluator's no-I/O-effects guarantee. Reuse the runner's existing authenticated host bridge or host-owned snapshot delivery; do not make readiness depend on adaptive memory being enabled. A snapshot reference can select evidence, never grant modifying authority.

The coordinator runs before the relevant native lifecycle delivery. If that lifecycle cannot deliver refreshed evidence, the adapter must arrange its supported native resume/restart boundary before the next affected execution. Do not inject readiness into an ordinary turn overlay as a fallback. Missing or invalid snapshot delivery is diagnosed, never silently replaced with local-only evidence advertised as consolidated. Paid model delivery checks remain unperformed by this design task.

### 8.5 Cache, roster changes, resume and deduplication

Once per session means once for unchanged relevant inputs, not once forever and not once per child process. Use two layers:

1. Component evidence keyed by canonical project, component, relevant runner binding where applicable, resolver/policy version, input fingerprints and evidence generation.
2. A session snapshot keyed by session epoch, effective roster digest/revision and those component-evidence digests.

The effective roster digest is required even when `assignmentRevision` does not change: `effectiveMembers` also merges current configured members. Preserve component evidence when only unrelated roster data changes. On resume/compact, revalidate bounded dependency fingerprints, including previously absent paths, and re-emit identical bytes if nothing relevant changed. Reading a fingerprint to decide cache validity counts against the budget; do not claim zero reads while hashing inputs again.

Invalidate only affected entries on runner add/remove/reassignment, capability toggles, relevant model/provider changes, generation/hook changes, credential-profile revision, project/registry/index evidence changes, Setup completion, or host restart. Raw secrets and hashes derived solely from secrets do not enter model context or persistent evidence. Disabled transitions immediately remove optional observations and pending repair eligibility; revalidate intent immediately before any effect. A started task keeps its native assignment/launch semantics; readiness updates never turn an already-disabled member into an enabled one.

Serialize concurrent checks by component key and publish one immutable snapshot. Serialize repairs by canonical project and target, not by requesting child. Deduplicate Setup delegation by session, finding/evidence identity and target; including only the whole roster digest would incorrectly repeat the same repair after an unrelated roster edit. Persist the delegation/attempt reference in the existing session ledger (host responsibility), so resume does not duplicate work. Native coordination retains the analogous execution record; restart must recover/reconcile a prior attempt or report uncertain completion rather than replaying a token. A genuinely new finding/input version can create a new exact delegation.

Readiness delivery may repeat at a legitimate resume/compact context boundary, but each delivery contains one copy and does not cause a second repair. If a transform is called twice for the same prompt assembly, replace/deduplicate the readiness segment. Failed or indeterminate repair is never cached ready; retry requires fresh evidence or an explicit continuation, not an automatic loop.

### 8.6 R3. Setup authority and minimal repair transport

Use one shared `PreparationService` owned by `@deck/sdd-runtime`, composed by CLI and called through trusted host/adapter ports, with status and repair operations. Prefer a thin adapter over an existing authenticated execution/session host where that host can prove the selected role and invocation. A small `deck-prepare` stdio bridge is a fallback recommendation for runners without such a host surface; it is NOT an approved requirement to install another MCP server in every runner. The transport must call the same service, so transport differences do not fork preparation policy. Do not delete usable OpenCode/Pi trusted-provider seams before making this decision.

An MCP server name or a role tool allow-list is not caller authentication. Before repair, the service obtains from trusted runtime state:

- the actual selected `deck-setup` role, session/epoch, task or native invocation, and requesting runner;
- the exact Lead delegation and its component/target subset;
- the current canonical project root and immutable preparation snapshot;
- current enabled consumers for each optional shared component and the selected enabled executor binding.

The service rejects model-supplied role, runner, roster, paths or enablement as authority. A globally visible server that accepts `{agentId: "deck-setup"}` and issues its own authorization is invalid. For native subagents the adapter must correlate trusted spawn/selection and call identity; a parent-process role token shared with all children is insufficient. If a runner cannot attest Setup identity, report unavailable authority and preserve bytes. Do not substitute Bash or a permissive tool policy.

For a repair request, acquire the project/target lock, revalidate scope/intent and current evidence, reject any requested component outside the proven degraded project set, validate the exact delegation, then issue and consume process-local single-use authority immediately before the effect. A batch uses a separate reservation per concrete operation, or an explicit atomic batch contract; do not reuse one consumed nonce for several writes. The current authorization service accepts one component/action/target expectation per reservation.

Bind claims to both requester and executor where they differ, plus epoch, roster/policy digest, component evidence digest, exact operation/target set and delegation identity. This is a deliberate contract change in `session-preparation.ts`; its current `needs` parser accepts only OpenSpec and registry, its operation parser has no retired-key migration, and its runner binding cannot express an enabled executor distinct from Setup. Update current schemas/parsers and callers together; do not add legacy acceptance or a compatibility mode. Retain restart, expiry, replay, root and target protections.

**Lead disabled, another member enabled:** the shared project component is included and its enabled consumers are named. Lead receives no optional capability tool or instruction. It delegates through ordinary Deck preparation authority.

**Setup disabled, another member enabled:** Setup retains its native disabled capability set. It may request a bounded shared project repair through the always-on preparation service. The trusted service selects an existing enabled participant's verified initializer binding as executor and performs only that project operation. It does not expose the optional capability's tools to Setup, impersonate the participant's model, enable anything, reassign Setup, or start another paid member. The authority names requester and executor separately. If there is no eligible enabled executor, or its verified initializer cannot enforce the target scope, return a project-repair limitation and runner remediation. Never use Setup's disabled optional native tools as a fallback.

This implements the approved union for shared project preparation without converting it into union-of-member capabilities. Both the ordinary native case (one runner) and mixed case use the same authorization rules; in the single-runner case a disabled optional capability cannot acquire an enabled executor.

The repair request contains only a snapshot reference and approved component identities. It accepts no shell command, arbitrary MCP method, provider URL, credential, backend path or caller-selected executor. The trusted catalog and validated delegation determine each initializer, action and target. The preparation service is not a proxy for using another member's capability.

The service returns component handoffs with scope, affected runners, evidence references and remediation. Runner gaps remain report-only. It rechecks changed project items and publishes invalidation after repair. Failed authority or a concurrent file change preserves the prior bytes and returns a precise reason.

### 8.7 Retired testing keys, Setup naming and integration ownership

Retain revision 4's deterministic YAML Document migration: remove retired Deck TDD policy fields, retain user-authored command text, move command-valued gate entries without loss/collision, set `testing.policy: proportional` where absent or `strict`, preserve unrelated structure/comments/style, report a diff, run idempotently and fail closed on a source-digest mismatch. Do not interpret arbitrary user command names or opaque payload keys as Deck policy merely because they spell `tdd` or `coverage_threshold`; fixtures must cover Deck-owned nested policy locations and similarly named user data. Unsupported gate shapes must be reported without a lossy write. This cleanup removes retired policy; it is not a backward-compatibility mode or a strict-policy opt-in.

Remove the unused `needs-init` readiness source only after the new producer owns its live responsibilities. Preserve the OpenSpec reader's parsing intent, but do not use its conflated `parseError` to classify I/O denial as malformed YAML. Keep one bounded parse/evidence source.

Rename Setup content to Setup naming and remove dead `deck-init` remnants after U2+B0 is accepted. Derive the default member list from the catalog with Setup included. Amend the shared preparation authority text to describe session scope and requester/executor binding, preserving all protected limits. Lead remains the centralized OpenSpec writer; apply-fast `task-09d3d118` retains U2+B0 ownership. This design task changes none of those files.

### 8.8 Parity rule and evidence allow-list

Revision 4's unconditional equality of full `sessionStartContext` bytes is incompatible with the approved mixed-roster report: a native single-runner Lead and a session Lead with additional enabled members have different input scopes. Preserve exact equality of delivery implementation, project-instruction bytes and the local-runner projection for identical evidence/configuration. Require whole-channel byte identity whenever the complete readiness scopes and evidence are equal.

Normalize `sessionStartContext` into channel identity, local/base digest, coordination scope digest and coordination output digest. The guard must independently derive the canonical local projection; it must not trust a caller-supplied digest to hide extra content. Add one narrow `evidence` allow-list entry for coordination data derived from additional participating runners. Permit only component identities, required-by labels, runner-qualified statuses and snapshot references derivable from the typed scope. It cannot excuse a missing native hook, a different role/policy, capabilities on a disabled member, arbitrary readiness prose, or readiness in the overlay.

Native and session fixtures with the same scope/evidence must produce equal full bytes; heterogeneous fixtures compare equal base projections and validate exactly the additional typed coordination data. Keep the one codebase-memory runtime override and existing memory temporary entry unchanged. The roster's enablement data fits the existing delegation/roster overlay contract and does not need a readiness overlay exception.

## 9. Remaining implementation evidence and product decisions

No further user decision is needed for the approved mixed-runner behavior, conservative indeterminate results, or keeping disabled capabilities disabled.

R2 still needs proof of Codex app-server SessionStart context delivery, native subagent lifecycle handling and Pi native prompt append/AGENTS.md behavior. R3 needs trusted Setup-call identity per runner. The prior P1b Claude result supports headless SessionStart but does not prove a repair tool knows which role called it. Use hermetic adapter tests first; this read-only task performs no paid probes.

The selected minimal transport remains a Lead implementation decision after inspecting existing host lifetimes and role identity. `deck-prepare` remains an option, not a universal acceptance requirement. A new always-on daemon/server install across all runners, automatic member reassignment/enablement, live index probing inside the preflight, or widened user-global mutation would materially expand the approved behavior and must be raised separately if actually needed. None is assumed here.

Lead records U2.9 ownership in the test-strategy change and reconciles obsolete strict-TDD/legacy/approval wording with the already recorded user decisions. U2+B0 has not been accepted merely because an earlier task list says it has landed.


### Approved PQ3 availability projection

The Codebase managed override rationale remains unchanged; D3a adds only its shared availability-omission policy. Section 8.8 projections must independently retain installed declaration, effective route, omission and backend evidence. Additional-participant row 12 cannot hide backend differences.
