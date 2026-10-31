# Native runner package inventory

Status: reviewed pre-change inventory, 2026-10-22. Acceptance is approved with subsequent adjustments; design is pending review. No implementation or installation cleanup has occurred.

Update: acceptance has now been approved with adjustments documented in acceptance.md. This inventory records the pre-change evidence. Its preliminary manifest-only and unknown-search recommendations are superseded: dedicated Deck directories establish ownership, ambiguous shared entries get individual confirmation, and unknown native search uses the configured fallback with a possible-duplicate warning.

## Evidence and limits

Source and the local installation were inspected for Codex 0.162.1, Claude 2.1.301, OpenCode 1.19.1 and Pi 1.0.0. Local observations describe this machine, not every installation. The graph was stale or lacked coverage for relevant paths; material claims use direct source fallback. Manifests were read as raw JSON: `readManifest` is not a read-only probe because it can migrate and write them. Native databases and conversation histories were not accessed.

Investigation: task `task-1cf2011b-0318-4587-84f5-47cef713f609`, attempt 16, result/ended events 85084/85085. Supporting inventory: `/tmp/native-runner-package-retirement/inventory.md`. The corrections below take precedence over that preliminary report.

## Runner installation surfaces

| Runner | Current Deck materialization and locations | References and preparation | Ownership evidence and limits |
| --- | --- | --- | --- |
| Codex | MCP entries for context-mode, Serena and Codebase Memory under `CODEX_HOME` (normally `~/.codex/config.toml`); agent TOML and skills, including shared `~/.agents/skills`. Serena uses the shared Deck launcher and `deck internal serena-mcp` proxy. | Capability bundles, agent/skill content, launcher and readiness checks. Deck hook blocks include RTK and memory bridge; no separate retired-package hook was identified. | `# deck-codex-mcp:<id>` and hook block markers identify managed sections, but contain no content hashes. Markers alone do not meet the requested manifest-only deletion rule. A separate third-party `codebase-memory-mcp` entry exists locally and must be preserved. |
| Claude | Hashed inline plugin directories under `~/.local/share/deck/claude/developer-team-v2-<hash>` with agents, skills and capability MCP configuration. Eleven generations were observed. | Capability/tool lists, translated instructions, Serena readiness checks. The inspected plugin's `hooks.json` contains RTK. Cross-runner launch is a separate composition path, not proof that the same plugin is loaded. | Expected-file inspection, selection metadata and directory protections exist. A persistent per-resource ownership manifest sufficient for this cleanup was not identified in the inspected path. Matching a historical generated form alone is insufficient ownership proof. |
| OpenCode | `~/.config/opencode/opencode.json`, agents, prompts, skills and generated execution plugin. Local MCP entries include context-mode and Serena; no Codebase Memory MCP entry was present in that file. | Capability catalog, per-agent Serena tool policy, instruction bundles and generated runtime references. | No usable per-resource manifest was identified in the inspected installation. Legacy exact-form merge heuristics are not sufficient deletion authority. Local `plugins/cbm-augment.ts` has unknown provenance; preserve it. |
| Pi | `~/.pi/agent/mcp.json`, generated tool-policy, subagents and execution extensions; `deck/manifest.json`. | MCP catalog tool names, role/skill bundles and generated runtime references. | `deck-pi-manifest-v1` records file hashes and per-MCP-entry hashes. The local manifest records 28 files and entries for all three packages. This supports bounded cleanup when current content matches. Legacy command-suffix/transport heuristics do not prove ownership. |

Primary source anchors:

- `packages/adapter-codex/src/mcp-config.ts`: server IDs, managed markers, block builders and readiness gaps; `tools.ts`: context-mode package pin; `codex-config.ts`: hook blocks.
- `packages/adapter-claude/src/capabilities.ts` and `runner-adapter.ts`: MCP composition, tool lists, plugin contents, expected-file inspection and Serena probing.
- `packages/adapter-opencode/src/capability-catalog.ts`, `opencode-mcp-config.ts`, `developer-team-install.ts`, `config-merge.ts` and `installation-plan.ts`.
- `packages/adapter-pi/src/pi-mcp-config.ts`, `pi-global-install.ts` and `pi-mcp-catalog.ts`.
- `packages/core/src/serena-bootstrap.ts` and `apps/cli/src/internal-serena-mcp.ts`: shared Serena launcher/proxy.

## Shared composition and defaults

`packages/core/src/config/deck-config.ts:60` lists context-mode, Serena and Codebase Memory as configurable instruction packages; all three currently default to true at lines 73–78. At lines 97–107, an absent selection uses defaults, while a missing key in an existing selection becomes false. Dashboard defaults also need coverage (`apps/cli/src/tui/runner-dashboard/state.ts:338`).

The observed Deck config stores `codebase-memory: true` for all four runners without intent provenance. That value alone cannot distinguish deliberate activation from a persisted old default.

Install selection, prompt selection and readiness are separate surfaces. Relevant paths include `getEnabledCapabilityInstructionIds` in CLI orchestration/launch/upgrade, `sessionRolePrompt` in `apps/cli/src/session-service.ts`, and `session-codebase-readiness.ts`. The compact cross-runner role call omits capability bundles, but that does not remove references inherited through role/skill content or other launch paths.

Canonical content includes `packages/core/src/teams/developer/instruction-bundles/{context-mode,serena,codebase-memory,index,common-fragments}.ts`, adaptive and older specialist content, bootstrap content and the deck-init skill. Generated execution assets contain additional names. Update their sources and regenerate through `scripts/generate-runner-execution-assets.ts`, `scripts/generate-pi-extension-assets.ts` and the applicable skill-bundle generator; do not hand-edit generated files. Even incidental retired-package references must be excluded from newly delivered prompts/skills under the user's criterion.

`packages/sdd-runtime/src/execution/session-preparation.ts` defines preparation state for Serena onboarding, capability initialization and owned-ignore handling. The examined consumers are the OpenCode/Pi runtime integrations; the examined CLI session service/session-host path does not invoke it. A state contract is not evidence that every operation actually ran. Retire Serena-specific preparation while preserving general preparation needed by unrelated capabilities; Codebase Memory preparation becomes opt-in.

## Migration constraints

The observed global `~/.local/state/deck/manifest.json` contains only the Deck binary. Moreover, `apps/cli/src/upgrade-command/runner-sync.ts:258–270` records placeholder all-zero checksums for planned files. These are not valid content hashes. The manifest schema supports ownership/checksum records, but schema support does not establish provenance for actual resources.

Consequently, automatic removal cannot promise to erase every legacy installation while also honoring manifest-only ownership. Missing records, placeholder hashes, edited shared sections and unknown provenance must be preserved and reported. Do not convert a matching filename, command or historical template into ownership authority.

RTK shares files/arrays with other configuration: Codex hook arrays, Claude hooks, OpenCode plugins and Pi tool policy. Cleanup must preserve unrelated sections. Package data directories, unrecorded shared tool roots, stale generations and backups are not automatically disposable. Apply the same provenance rule; preserve ambiguous resources. Historical OpenSpec/changelogs remain historical evidence.

## Web search: native capability versus Deck MCP

The inspected Deck paths materialize the configured provider (currently Tavily) and check its selection/credentials. `apps/cli/src/session-shared-services.ts:63–74` does not first resolve intrinsic native search availability. Existing native-MCP readiness is not equivalent to the runner's own web-search tool.

| Runner | Evidence that the effective detector must consider |
| --- | --- |
| Codex | Effective `web_search` configuration, command-line overrides, provider support and policy. `disabled` must not be treated as available; cached search and live search are distinct modes. Do not infer availability from the runner name. |
| OpenCode | Current docs condition `websearch` on OpenCode/OpenCode Go provider or truthy `OPENCODE_ENABLE_EXA` **or `OPENCODE_ENABLE_PARALLEL`**, together with effective tool permissions/configuration. The user's EXA-only example needs the additional PARALLEL case. |
| Claude | Provider route, supported model and effective WebSearch permissions. Current docs distinguish Claude API/Platform on AWS/Foundry, Google Cloud model support and Bedrock. |
| Pi | No built-in search was identified in the inspected installation/source. Extensions can expose one, so effective tool inventory matters; do not hard-code Pi as incapable. |

Primary documentation checked on 2026-10-22: [Codex configuration](https://developers.openai.com/codex/config-reference/), [OpenCode tools](https://opencode.ai/docs/tools/), [Claude tools](https://code.claude.com/docs/en/tools-reference). Documentation conditions are inputs to verification, not a substitute for the actual launch configuration.

No complete live tool inventory for all four runners was obtained in this inventory pass. A model call is not necessarily required: configuration, metadata or supported tool-discovery APIs may establish availability. Do not declare every future version unknown merely because its version changed if supported discovery still supplies evidence. Tool exposure also does not guarantee success of every network request.

User-installed independent search tools create a genuine boundary: Deck can avoid adding a second search route, but cannot promise globally exactly one tool while also preserving arbitrary user installations. Proposed wording and unknown-state handling are in acceptance.md.
