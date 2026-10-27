# Tasks: native/session parity (final slices)

Prerequisites (in order):

1. Option A (Claude full team plugin, `task-b475cdb9…` attempt 2): integrated.
2. Live checks P1a–P3 (`task-1295d93c…`): integrated; branches locked in `design.md` §7.
3. **Legacy profile and role removal** (inventory `task-83ac36fe…`) has landed. Every slice below starts after it.

Slice order: S1 → S2 → (S3, S4, S5 in parallel) → S6 → S7 → S8.

Each slice ships its own guard test. Focused `bun test <file>` runs during the slice; `bun run test:changed` and `bunx tsc --noEmit` run at each slice handoff.

## S1. Core contracts and guard harness
- [ ] Add `@deck/core/session/overlay.ts`:
  - The closed section set from design §3, with no project-instructions section.
  - Lead-only kinds and the forbidden-marker check.
  - Move the delegation, roster, continuity and decision text out of `session-service.ts` and `session-manager.ts`.
- [ ] Generalize `NativeSkillsDescriptor` into `NativeRoleDescriptor`, and add `DriverTaskInput.nativeRole`.
- [ ] Add `ParityLaunchShape` (with `roleTools`, `memory` and `webSearch`) and `ParityAllowEntry` (with `temporary-tracked` plus `temporary: {owner, expiresWhen, reviewBy}`).
- [ ] Add `SESSION_PARITY_ALLOWLIST` with the 11 rows of design §5.1, and `SESSION_CAPABILITY_OVERRIDES = ["codebase-memory"]`.
- [ ] Add `diffParity()` implementing the §5 failure rules.
- [ ] Add `resolveWebSearchLaunch()` over `selectSearchRoute`.
- [ ] Split `CODEX_ROOT_LEAD_BOOTSTRAP` into `roleSelection` and `delegation(native|session)`.
- Acceptance: `diffParity` unit tests fail on each of these:
  - an unlisted field;
  - an unused entry;
  - an `mcpNative`, `webSearch`, `roleTools` or project-scope `memory` difference;
  - an override without an existing `necessityTest`;
  - a `temporary-tracked` entry without `temporary`, or past its `reviewBy`;
  - a global-memory difference with the row-8 entry removed;
  - a `quality` shape with write/exec built-ins or `mcpDefault: "allow"`.

  Overlay tests: an unknown kind, a Lead-only kind on a member, or a forbidden marker each throw.

## S2. Shared core role tool policy, native first (D9; fixes the shared core defect)
- [ ] Add `ROLE_TOOL_POLICY` to `@deck/core`:
  - Read-only roles get read built-ins plus explicit read-only MCP tool ids for context7, codebase-memory and web-search.
  - MCP is deny-by-default for read-only roles, including user and project servers.
- [ ] Claude: generate agent `tools:` from the policy, replacing `runner-adapter.ts:77-85` and dropping the context-mode and serena entries.
- [ ] OpenCode native: read-only agent entries get `bash/edit/write: false`, deny-by-default MCP and allowed read tool ids, in both `tools` and `permission`. Remove `resolveSerenaToolsForAgent` (`developer-team-install.ts:308-331`).
- [ ] Codex native: read-only role TOML gets `sandbox_mode = "read-only"`, plus native per-server MCP tool filtering if the installed Codex supports it. If it does not, record a residual native gap in `apply-progress.md`, with the Lead writing it.
- [ ] Pi native: verify that `deck-tool-policy.generated.js` consumes the same policy. Regenerate only through the generator, never by hand-editing generated files.
- Acceptance:
  - Unit tests per adapter: the `quality` and `investigate` native materializations contain no write/exec built-in, and deny unlisted MCP tools.
  - Live smoke on native OpenCode: `deck-quality` cannot call an MCP shell or write tool; this is the P2 gap, now closed.
  - Native Claude `tools:` contains no retired ids.

## S3. Claude vertical
- [ ] `prepareSessionRole(roleId)` reuses generation verification with `roleRef = deck-developer-team:<roleId>`. A retired server in the generation fails `claude-session-generation-unverified`.
- [ ] `buildClaudeTurnLaunch` adds `--agent <roleRef>` and keeps `--model`/`--effort` (P1a). The overlay is the only appended text.
- [ ] Override-only denials (`claudeSessionOverrideDenials`; codebase-memory when bound).
  - Rename `readSessionMcpServers` to `readSessionCapabilityOverrides`.
  - Remove the context-mode/serena deletion and the `{codebase-memory}` filter in `session-shared-services.ts:55-61`.
  - An unpaired override fails `claude-mcp-override-unpaired`.
- [ ] Web search: remove `web-search` from the plugin `.mcp.json` (`capabilities.ts:56-60`). Native launch (`runner-adapter.ts:556-563`) and the session both add the fallback through `--mcp-config` from `resolveWebSearchLaunch`.
- [ ] Add a hashed plugin `SessionStart` hook that emits AGENTS.md, reusing `session-project-instructions.ts`. Remove the session injection at `session-service.ts:88,95`.
- [ ] Emit `--dangerously-skip-permissions` only for `runner-default` derived from `yolo`.
- [ ] Add `claude.parity.test.ts`.
- Acceptance:
  - The parity test passes using only rows 1–8.
  - Each of these mutations fails it: denying context7, dropping `--agent`/`tools:`/`SessionStart`, or adding skip-permissions in relay.
  - A stale generation throws before spawn.
  - Live smoke:
    - the `quality` child cannot Edit or Bash, or call a non-listed MCP tool;
    - a Deck skill loads by bare name;
    - context7 comes from the plugin;
    - AGENTS.md is present in both native and session.

## S4. Codex vertical
- [ ] `prepareSessionRole` verifies the role TOML (`developer_instructions`, `model`, `model_reasoning_effort`, `sandbox_mode`), skills and hooks. The Lead uses the `roleSelection` bootstrap bytes.
- [ ] The driver sends `developerInstructions` = verified bytes + overlay.
  - Model and effort are passed explicitly on `thread/start` and each turn: the assignment, or else the TOML values.
  - The read-only sandbox is never widened in relay.
- [ ] Admit hooks by exact `trusted_hash` for the Deck manifest hooks. The `hooks/list` startup check fails closed.
- [ ] Rename `readSessionMcpServers` to `readSessionCapabilityOverrides`. `codexThreadMcpConfig` keeps additions and suppressions only.
- [ ] The native Codex launch applies `resolveWebSearchLaunch`.
- [ ] Add `codex.parity.test.ts`.
- Acceptance:
  - The parity test passes.
  - An absent or untrusted RTK hook fails `codex-hook-isolation-violation`.
  - A stale TOML fails `codex-session-generation-unverified`.
  - A role TOML model is applied when there is no assignment.
  - Native and session web-search shapes are equal.

## S5. OpenCode vertical
- [ ] `prepareSessionRole` verifies the agent entry (S2 tools and permission), the prompt files and the execution plugin hash.
- [ ] The driver seeds permissions from `deck-<role>`, sends `agent: deck-<role>`, and puts only the overlay in `system`.
  - A startup assertion checks that the agent exists and that `developer-team-execution` is loaded.
- [ ] Rename the MCP reader to `readSessionCapabilityOverrides`.
- [ ] Add `opencode.parity.test.ts`.
- Acceptance:
  - The parity test passes.
  - A member message carries `agent: deck-<role>`.
  - A missing agent or execution plugin fails closed.
  - Native and D9 denies survive relay and `yolo`.
  - Live smoke: a session `quality` member cannot reach an MCP write/exec tool.

## S6. Override necessity and temporary memory entry
- [ ] codebase-memory necessity tests:
  - two concurrent children on different runners share one readiness entry;
  - a digest mismatch reports `codebase-memory-unsupported` without spawning;
  - the server is released at task end.
- [ ] Record row 8 as `temporary-tracked` with owner `adaptive-memory-redesign`.
  - Add guard fixtures with no git identity.
  - Project-scope fixtures must match native exactly: same builders, same raw-key env names.
- Acceptance:
  - Row 7 names the necessity tests, and deleting one fails `diffParity`.
  - Removing row 8 while the global difference persists fails the guard.
  - A project-scope memory difference fails regardless of row 8.

## S7. Pi unsupported and dead code
- [ ] Add the `pi` `*` `unsupported` entry. Delegating to a Pi-assigned member fails closed with `session-runner-unsupported`.
- [ ] Remove `createSessionMemoryPort` (`session-shared-services.ts:15-35`), its wiring (`session-service.ts:17,128`) and its tests (`session-shared-services.test.ts:46,64,74,126`).
  - First confirm with `rg` that there is no other consumer.
  - Remove the session-host `memory` option only if nothing else supplies it.
- Acceptance:
  - A guard test asserts Pi has no driver and that delegation fails closed.
  - `rg createSessionMemoryPort` returns nothing.
  - Memory broker behavior for Claude, Codex and OpenCode leads is unchanged.

## S8. Session path cleanup and final verification
- [ ] `sessionRolePrompt` becomes overlay-only, and `assignedRoleId` uses catalog membership.
- [ ] Add a guard asserting that the session path makes no `getAgentContent` role-body call.
- Acceptance: `bun run test:changed`, `bunx tsc --noEmit`, then `bun run test:full` once for the final candidate.

## Parity guard assertions per runner

| Runner | Must be identical (native vs session) | Allowed differences (rows) | Always fails |
|---|---|---|---|
| Claude | Role source (`--agent` ref plus generation hash), `roleTools`, skills and preload, plugins, hooks (RTK, `SessionStart`), `mcpNative` (context7 and others), `webSearch`, `settingSources`, `projectInstructions = native-hook`, project-scope `memory` | 1–8 | Any plugin denial other than an overridden id; skip-permissions in relay; AGENTS.md in the overlay; a retired id |
| Codex | Verified role bytes hash, TOML model/effort when there is no assignment, `sandbox_mode`, `roleTools`, skills, `mcpNative`, `webSearch`, project-scope `memory`, native AGENTS.md | 1–9 | A missing Deck hook, or admission through a global bypass; a TOML value dropped |
| OpenCode | Agent `deck-<role>`, agent tools and permission (S2), prompt files, execution plugin, `mcpNative`, `webSearch`, project-scope `memory` | 1–8, 10 | A default `build` agent; a native or D9 deny relaxed; MCP write/exec reachable by `quality` |
| Pi | n/a (no driver) | 11 | Any Pi member delegation not failing `session-runner-unsupported` |

Cross-runner (all shapes): `quality` has no write/exec built-in and uses `mcpDefault: "deny"`, in native and in session.

## Rollout
- The Claude generation hash changes (`SessionStart` hook, route-free `.mcp.json`, policy `tools:`). The OpenCode and Codex role materializations change too (S2). Existing installs fail closed in sessions until `deck upgrade` runs, and native installs get the read-only fix on that same upgrade.

## Open (user)
- None.
