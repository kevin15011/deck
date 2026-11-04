# Support matrix

Support labels are scoped to a surface. “Supported” for one capability does not imply universal runner parity, and “detected” does not imply an operational adapter.

> **Audience:** People evaluating whether Deck covers a runner or capability.
> **Authority:** Current product boundary; source registries, adapters, tests, and runner evidence define status.
> **Maintainer:** Deck maintainers.
> **Evidence:** [runner capability registry](../../packages/core/src/runner-capability-registry.ts), [runtime detection](../../apps/cli/src/runtime-detection.ts), [adapter registry](../../apps/cli/src/runner-adapters.ts), [canonical catalogs](../../packages/core/src/teams/developer/catalog.ts), and [documentation governance](../../tests/documentation-governance.test.ts).

## Status vocabulary

| Label | Meaning |
|---|---|
| **Supported** | The product has an implemented path and source-backed checks for the named surface. |
| **Full team, instruction-level safety** | The complete Developer Team and tools are materialized and launchable, but protected execution controls (invocation authorization, controlled effects, execution dossier, registry coordination, bound verification) are carried by instructions because the runner exposes no host lifecycle hook to enforce them. |
| **Runner-specific** | The capability exists only through a particular runner's native package, configuration, or effect. |
| **Experimental** | The path is intentionally available but its contract or runtime validation is not considered stable. |
| **Manual verification required** | Automated evidence is incomplete; the user or maintainer must verify the result. |
| **Detection only** | Deck can observe presence but does not configure, launch, or verify the runtime as an operational target. |
| **Known gap** | The boundary is recognized and not represented as a complete supported path. |
| **Not shipped** | The named product surface is not part of the current Deck distribution. |

## Cross-runner session drivers

Cross sessions are an **experimental**, separate execution surface. Native install/launch support below does not imply session-driver support. See [cross-runner sessions](../cross-runner-sessions.md) for configuration, security and recovery.

| Driver | Tested native version | Default approvals | MCP and hook isolation |
|---|---|---|---|
| Claude | 2.1.296 | Runner default (unrestricted); relay opt-in | Explicit strict MCP file; native delegation excluded |
| Codex | 0.162.1 | Runner default (unrestricted); relay opt-in | Effective-config and hook inventory verified; unrelated inherited entries and native delegation disabled |
| OpenCode | 1.18.31 | Runner default (unrestricted); relay opt-in | Private configuration directory; explicit MCP set checked through the native server; native task tool denied |
| Pi (Setup only) | 1.0.0 | Session setting; relay supported | Delegated Setup uses the shared project-repair service; other roles use native Pi. Requires Node and a current verified Deck team install. |

Versions below a driver's minimum block startup; newer untested versions report degraded readiness. Pi Setup currently requires exactly 1.0.0. Native authentication remains owned by the native CLI. Exact verification and platform limitations are recorded in [apply progress](../../openspec/changes/cross-runner-session-core/apply-progress.md).

The browser workspace supports persistent projects and session history, explicit preparation, linked continuation after close, and per-session member assignments. Lead assignment changes preserve Deck history through bounded context transfer into a fresh native generation; this is not native conversation migration between runners. Global Lead and delegated execution pools are separate, and concurrent sessions in one project share its physical files.

## Operational runner matrix

Pi and OpenCode are operational Deck runners. Codex and Claude carry the full team with instruction-level safety (see the vocabulary above); Codex adds Deck-owned shared tools and hooks, and Claude carries the Developer Team in a Deck-owned global plugin. The cells use the status vocabulary above; runner-specific details are described below the table.

| Surface | Pi | OpenCode | Codex | Claude |
|---|---|---|---|---|
| Binary detection | Supported | Supported | Supported | Supported |
| Version/config preflight | Supported; **Pi >= 1.0.0 only** (`@earendil-works/pi-coding-agent`), older or unparseable versions block install and launch | Supported | Supported; Codex 0.145.0+ | Supported; Claude Code 2.1.218+ |
| Package and MCP review | Supported; built-in MCP (Deck servers in the global `mcp.json`, absolute commands, direct exposure) | Supported | Supported; instruction-level safety | Supported; instruction-level safety |
| Developer Team materialization | Supported; **global** under the Pi agent directory (`PI_CODING_AGENT_DIR`, default `~/.pi/agent`) as one Deck-owned package, never into projects | Supported | Supported; instruction-level safety; global (Codex home and `~/.agents/skills`), never into projects | Global Deck-owned plugin files |
| Subagents and per-role models | Supported; Deck-owned `subagent` extension, one child `pi` process per role with that role's model and thinking level | Supported; native agents | Supported; native custom agents | Supported; plugin agents |
| Model discovery and per-role assignment | Supported | Supported | Supported | Supported |
| Shared tool installs (RTK, explicitly enabled Codebase Memory) | Supported; Deck-owned pinned binaries, MCP commands pinned to absolute paths | Supported | Supported; Deck-owned pinned binaries, MCP and hooks pinned to verified absolute paths | Supported; pinned shared tools |
| Tool interception: RTK command rewrite | Supported in Deck sessions; the `deck-tool-policy` extension rewrites `bash` commands in `tool_call`, pinned to the owned RTK binary | Runner-specific; OpenCode hook | Runner-specific; marker-owned `PreToolUse` hook | Runner-specific; plugin `PreToolUse` hook |
| Tool interception: Grep/Glob graph guidance | Advisory; the search always runs and one concise Codebase Memory note is appended to its result, at most once per session (code-structure searches only) | Not shipped | Not shipped | Advisory; the Codebase Memory integration adds graph context and the search still runs |
| Tool interception: read-only role enforcement | Enforced for Investigate and Quality children (`tool_call` block plus a `--tools` allowlist); these roles have no shell | Not documented as enforced | Instruction-level only (no sandbox override) | Not documented as enforced |
| Developer Team execution controls | Static-compatible `developer-team-execution` extension in the lead session | Runner-specific hooks | Static-compatible | Not part of this route |
| Project-local skill discovery | Supported | Supported | Supported | Supported |

Project-local discovery is always scoped to the active runner. Pi and OpenCode can share a capability ID while using different configuration files, package systems, model discovery, and verification effects.

### Pi in detail

Native Pi Setup can execute an exact project repair delegated through `subagent` with a `preparation` request from `preparation-status`. The parent verifies the installed role, child session, containment and current invocation; repairs use the shared preparation service and a durable journal beside the parent session. Cancellation, navigation, changed configuration or generation revoke the invocation. Resume requires a fresh explicit repair delegation. The native catalog supports retired testing-policy cleanup, additive OpenSpec initialization/merge for supported shapes, and bounded skill-registry generation and stale refresh using evidence from the registry’s source runner. Malformed or unsupported OpenSpec shapes and unverifiable source inventories remain explicit limitations.

Native OpenCode Setup uses `deck_preparation_status`, then `deck_delegate_preparation` with the exact snapshot and components, followed by native `task` selection of `deck-setup`. The plugin correlates the parent task metadata, child session and current Setup tool invocation before accepting `deck_prepare_project`; cancellation, completion, changed roles or generation revoke authority. It shares Pi's durable preparation coordinator and supports the same bounded policy, OpenSpec and source-qualified registry repairs. Plugin restart requires a fresh delegation; background tasks whose parent call has completed cannot repair through this lane.

Native standalone Claude and Codex Setup do not expose authenticated project repair without trusted child/current-invocation lifecycle evidence. Use delegated Setup in a cross-runner session for authenticated repair; role names and readiness snapshots alone do not authorize mutation.

- **Global install.** `Review & Install` and `deck pi developer` write one manifest-owned package under `<agent dir>/deck/package` (agents, skills, prompts, and the `deck-*` extensions), a lead profile under `<agent dir>/deck/profiles`, one `packages` entry in `settings.json`, and the Deck servers in `mcp.json`. Nothing is written into `<project>/.pi`, and the install writes no Deck files into `<project>/.deck` (only Pi's session store for `--continue`/`--resume` lives under `<project>/.deck/pi/sessions`).
- **Deck-session activation guard.** Deck extensions are inert unless `DECK_PI_SESSION`, `DECK_PI_ROLE` or `DECK_PI_CHILD` is set by a Deck launch; a plain `pi` lists the Deck skills and extension names but runs none of the extension code.
- **MCP.** Pi's built-in MCP is used. Deck removes the `pi-mcp-adapter` entry it added in earlier versions (it disables built-in MCP); a user-added entry is reported as a blocking diagnostic.

## Instruction-level safety runtimes

| Runtime | Status | Deck scope |
|---|---|---|
| Claude | Full team, instruction-level safety | Global plugin files with the seven roles, pinned shared tools; static-compatible sessions started through the Deck CLI. Co-loaded user plugins and hooks are not isolated. |
| Codex | Full team, instruction-level safety | Deck can configure and launch the Developer Team, and install the shared tools; protected execution controls remain static-compatible. |

## Runner-independent surfaces

| Surface | Status | Boundary |
|---|---|---|
| Deck self-update | Supported | Operates on compatible Deck binary installations independently of which runner is detected. |

## Capability matrix

| Capability | Product status | Boundary |
|---|---|---|
| Codebase Memory | Explicit opt-in | Shared binary/MCP integration where the active runner exposes the required surface. |
| RTK | Supported | Optional shared binary; OpenCode uses its hook integration, Pi uses a Deck-owned pinned binary through a `tool_call` rewrite, and Codex uses a Deck-owned pinned binary with a `PreToolUse` rewrite hook. |
| Context7 | Supported | MCP server configuration is validated by the active adapter. |
| Developer Team | Supported | Seven canonical roles plus separate Onboard and Archive lifecycle skills. |
| Bundled external skills | Supported | 59 standalone content bundles; separate from project-local discovery. |
| Local skill registry | Supported | Read-only validation/discovery is bounded; refresh requires explicit authority and complete evidence. |

## Explicit limits

- Claude and Codex routes are static-compatible: protected execution controls are not enforced by a host lifecycle. Codex hook trust review is bypassed per process for Deck-owned hooks only when launched through Deck.
- Pi and OpenCode can share a capability ID while using different config files, package systems, model discovery, and verification effects.
- Pi: Deck supports Pi >= 1.0.0 only. Subagent children are started with `--append-system-prompt`, which replaces the user's `APPEND_SYSTEM.md` for those children. MCP servers started by Pi inherit Pi's environment, including credentials such as the Web Search key. Read-only roles have no shell, so Quality cannot run test suites. Delegation to `deck-setup` through the Deck `subagent` tool is fail-closed until `developer-team-execution-convergence` wires its authorization provider.
- Project-local skill metadata is discovery input, not runtime authority or bundled Deck content.
- Generated bundles and build metadata remain generator-owned.

Use [Runners](../runners.md) for operational details, [Skills](../skills.md) for the bundled inventory, and [Troubleshooting](../troubleshooting.md) when evidence is manual, incomplete, or indeterminate.

### Integration state and migration evidence

Runner integration state schema 1 is the current adapter contract. Schema numbers
order state formats; build commits, channels and executable digests identify builds
and never order compatibility. Compatible installed content remains usable while a
refresh is deferred. A pending writer transaction requires journal-based recovery;
its presence does not authorize overwriting preserved user content. Builds predating
writer fences do not observe this contract and cannot be fenced retroactively.

The published migration inventory is pinned in
`scripts/fixtures/retirement-releases.json`. Stable release qualification requires
that inventory's base and selected-capability evidence, including candidate session
admission, through the historical migration workflow. Unsupported rows remain
explicit. This is an exact tested inventory, not a rolling promise for arbitrary
previous or future native runner versions. Live authenticated compatibility requires
separate canary evidence for the exact Deck build, platform and native version.

Legacy Codex command recognizers remain migration-only for pre-history layouts.
They rewrite or remove recognized entries before issuing current ownership receipts;
they never authorize prior bytes for session admission. Their removal requires an
updated, passing published migration inventory covering those layouts.
