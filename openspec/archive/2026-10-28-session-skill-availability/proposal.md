# Proposal: Session parity with native Deck (one core, one role definition, native-first capabilities)

## Why

Governing invariant (user, 2026-10-26, `working-brief.md`): a cross-runner session child must run the same Deck core as Deck launched natively in that runner. The only permitted differences are those inherent to cross-runner operation: task ledger, `deck_delegate` in place of native subagents, approval relay, and cross-runner evidence. Each one must be explicit, minimal and justified. Any other difference is a defect.

The session does not meet this today.

- **Roles.** The session renders its own role prompt (`sessionRolePrompt`, `apps/cli/src/session-service.ts:83-96`) instead of selecting the runner's installed role. As a result, children lose per-role tool restrictions, capability instructions, preloaded skills and hooks.
- **MCP.** Asked "why does the cross-runner manage its own MCPs if each native runner already has them?", the answer is that it should not. On Claude, option A denies every plugin MCP server while the session re-supplies only codebase-memory (`packages/adapter-claude/src/runner-adapter.ts:729-747`), so context7 is silently lost.
- **Web search.** The shared search route is applied in the session and in native OpenCode, but not in native Claude or native Codex.

`design.md` §0–§1 has the full matrix.

## What changes

1. **Role source.** Every session child runs the runner's installed, hash-verified role definition: the same artifact native Deck selects. Claude uses `--plugin-dir` + `--agent` (P1a); OpenCode uses `agent: deck-<role>` (P2); Codex, which has no role selector (P3), sends the verified installed role bytes plus the overlay and passes role model and effort explicitly.
2. **Native-first MCP.** A child loads its runner's native MCP set unchanged. The session only adds the `deck` server and applies the closed `SESSION_CAPABILITY_OVERRIDES` list, which has one necessity-tested entry: codebase-memory per-task binding. On Claude, only overridden plugin servers are denied (live check P1c); context7 and the plugin's other servers load natively.
3. **Shared web-search route.** One core launch-time decision is used by native and session in every runner. web-search is no longer a session override.
4. **Project instructions on Claude.** A Deck plugin `SessionStart` hook (verified in headless `-p`, P1b) loads AGENTS.md for native and session alike, and the session-only injection is removed. This was Q1, now resolved.
5. **Approval modes.** Relay is the default. Skip-permissions flags appear only under the explicit `yolo` session mode, which is allow-listed as an inherent session mode. This was Q2, now resolved.
6. **Retired capabilities.** context-mode and serena are not parity items. If either appears in an installed generation, the generation is stale and fails closed.
7. **Shared role tool policy, MCP included.** Read-only roles (investigate, quality) must not reach any write or exec tool, MCP tools included, natively or in a session. Native OpenCode currently gives every member `bash/edit/write`, and its built-in denies do not cover MCP tools (P2). Native Codex has no read-only role restriction. This is a shared core defect: one core `ROLE_TOOL_POLICY` is materialized by every adapter, and sessions inherit it through the native role.
8. **Memory.** Project-scope memory already matches native (same launch builders and raw-key env). Global-scope memory (no git identity) is enabled only in sessions. It stays as a temporary, tracked allow-list entry owned by the separate adaptive-memory redesign, and no new memory mechanism is added here. `createSessionMemoryPort` (Pi lead only; unreachable) is removed as dead code.
9. **Session overlay and generation verification.** These are unchanged from revision 1: a typed core overlay, plus a per-runner `NativeRoleDescriptor` re-verified before spawn.
10. **Parity guard.** For each runner, a structural diff of the native and session launch plans. The native MCP set must be identical. Any other difference must match the final allow-list in `design.md` §5.1, and every capability override needs a named necessity test.

11. **Project-readiness preflight and shared coordination.** One bounded read-only evaluator serves native and cross-runner launches. Every member retains its native runner enablement. OpenSpec/configuration and the skill registry are unconditional; optional shared project components are checked once for unchanged inputs when any participating runner needs them; runner components are checked only for enabled bindings. Lead receives consolidated project and runner-qualified findings through the runner's native session-start channel and receives typed per-member capability data in its roster. Setup repairs only project items through authenticated preparation authority; runner installation/configuration gaps are reported with remediation. The change includes retired Deck testing-policy cleanup, Setup naming and removal of the obsolete readiness producer. It neither grants capabilities to disabled members nor introduces a readiness overlay. A shared preparation service is required; a universal new deck-prepare server is not.


## Sequencing

Option A and P1–P3 are integrated; legacy removal is committed as `2204c47`. U2+B0 remains with its existing apply-fast owner pending acceptance. This change absorbs U2.9 and follows that acceptance. S2 role policy precedes repair exposure; implement a functioning scoped-readiness/authority/native-delivery vertical before repeating adapter integration. Remove old producer/provider code only after replacement responsibilities are demonstrated. Lead records official OpenSpec updates centrally.


## Non-goals

- A Pi session driver. Pi stays explicitly unsupported and fails closed.
- Unrelated native role-content changes, native approval UX changes, or changes to the cross-runner model roster. Approved role changes are the shared read-only tool restriction, Setup-only preparation visibility and authority guidance, readiness coordination guidance, and Setup naming cleanup.
- Designing memory mechanisms. Global-scope memory alignment belongs to the adaptive-memory redesign.

## Risk

The earlier P1–P3 parity checks are complete and their branches are locked (`design.md` §7). Two risks remain:

- **Rollout.** The Claude generation hash changes (`SessionStart` hook, route-free `.mcp.json`, policy-generated `tools:`), and the OpenCode and Codex role materializations change too. Existing installs fail closed in sessions until `deck upgrade` runs.
- **Codex MCP restriction.** Restricting MCP tools on Codex depends on Codex native per-server tool filtering. If that is unavailable, the gap is recorded as a residual native limitation and pinned by the guard, never as a silent session divergence. Recording a residual limitation does not satisfy the read-only policy or parity acceptance. If required MCP denies cannot be enforced, the affected read-only role launch remains unavailable and S2 is incomplete for that runner; the guard must not normalize an unsafe tool set into success.

The original parity branches are locked, but readiness delivery and repair identity are not all proven. Codex app-server SessionStart context, Pi lifecycle/AGENTS.md behavior and authenticated Setup-call identity need targeted adapter evidence. Existing server startup checks do not prove project indexing, and a no-network/no-subprocess preflight must return indeterminate when it lacks current bounded index evidence. Registry freshness is runner-exposure-specific even though the file is shared. No paid probes or new universal MCP installation is implied by this design handoff.
