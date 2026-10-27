Claude parity implementation handoff

Outcome
- Claude adapter now prepares deck-session-skills, a private skills-only native plugin.
- Its exact standalone file subset comes from expectedFiles(), with canonical content hashes. The active installed generation and model-assignments.json must match current canonical content before preparation. The descriptor binds selectionHash, contentHash and per-file hashes. Launch revalidates selection and the complete passive file set.
- CLI preparation passes nativeSkills through ChildMcpResolver and DriverTaskInput for Lead and delegated children. Claude adds its --plugin-dir beside memory. Failure reports claude-session-skills-unverified before spawn. No team agents, RTK hooks or plugin MCP configuration are admitted.
- Canonical adaptive roles now receive the Adaptive Developer Team Contract (including Git discard protection) in both compact and legacy profiles. Existing size budgets pass.
- Codex/OpenCode production behavior is unchanged. Pi has no session driver; its materialized agent safety is covered.

Files changed by this task (other existing edits preserved)
apps/cli/src/session-native-skills.ts (new)
apps/cli/src/session-service.ts (additive preparation)
apps/cli/src/session-service.test.ts (prepared adapter fixtures, descriptor propagation and fail-closed composition)
apps/cli/src/verification-parity.test.ts (extended existing untracked test)
packages/adapter-claude/src/runner-adapter.ts (additive preparation)
packages/adapter-claude/src/session-skills.ts (new)
packages/adapter-claude/src/session-skills.test.ts (new)
packages/adapter-claude/src/session-driver/launch.ts
packages/core/src/session/driver.ts
packages/core/src/teams/developer/content-registry.ts
packages/core/src/teams/developer/content-invariants.test.ts (extended existing untracked test)
packages/session-host/src/session-manager.ts (additive descriptor transport)

No OpenSpec edits, commits, destructive Git operations or full-suite run. No generated assets are affected: the change is runtime content composition; standalone skill source bundles and execution asset sources did not change.

Verification
1. bun test packages/core/src/teams/developer/content-invariants.test.ts apps/cli/src/verification-parity.test.ts
   Initial RED: 24 pass, 9 fail, 1.35s. Demonstrated missing legacy blocks and materialized safety gap.
2. bun test packages/adapter-claude/src/session-skills.test.ts
   Focused GREEN: 3 pass, 0 fail, 6.48s (later strengthened with negative agent/MCP cases and launch rejection).
3. bun test apps/cli/src/verification-parity.test.ts
   Matrix: 14 pass, 0 fail, 1.486s. Production launch composition covers trusted/untrusted Codex/OpenCode global skill paths; Claude trusted/untrusted launch is covered in session-skills.test.ts. Materialized agents for all four runners carry Git protection.
4. Temporary mutation removed ${GIT_DISCARD_PROTECTION_RULE} from adaptive-team-content.ts, then ran:
   bun test packages/core/src/teams/developer/content-invariants.test.ts apps/cli/src/verification-parity.test.ts
   Expected failure: 16 pass, 18 fail, 2.12s wall. Exact original file restored in finally.
5. Temporary mutation omitted the skills --plugin-dir argument, then ran:
   bun test packages/adapter-claude/src/session-skills.test.ts
   Expected failure: 2 pass, 1 fail, 5.08s wall. Exact original file restored in finally.
6. Affected handoff command:
   bun test packages/adapter-claude/src/session-skills.test.ts packages/adapter-claude/src/session-driver/launch.test.ts packages/adapter-claude/src/session-driver/driver.test.ts packages/adapter-claude/src/runner-adapter.test.ts packages/core/src/teams/developer/content-registry.test.ts packages/core/src/teams/developer/content-invariants.test.ts packages/core/src/teams/developer/adaptive-team-content.test.ts apps/cli/src/verification-parity.test.ts apps/cli/src/session-service.test.ts apps/cli/src/session-shared-services.test.ts packages/session-host/src/__tests__/session-manager.test.ts packages/adapter-codex/src/session-driver/launch.test.ts packages/adapter-opencode/src/session-driver/driver.test.ts
   715 pass, 9 fail across 13 files, 141.83s. All failures were old fake Claude adapters missing the new preparation seam. Updated only the affected fixtures and added propagation/blocking assertions.
7. bun test apps/cli/src/session-service.test.ts
   Final delta verification: 37 pass, 0 fail, 8.35s. All previously failing tests pass. Combined current evidence covers 725 tests (unchanged passes reused).
8. bunx tsc --noEmit
   Exit 0, one invocation, no diagnostics. Exact duration was not instrumented; finished within approximately 51s. Subsequent edits were confined to service test fixtures/assertions.
9. git diff --check
   Exit 0.

Native name-resolution evidence
Installed Claude 2.1.309. Local executable inspection initially suggested namespace suffixes were suggestions; the permitted single live Haiku smoke disproved that interpretation for a loaded plugin skill with a bare frontmatter name.
Command:
claude -p --model haiku --max-turns 4 --output-format json --tools Skill --permission-mode bypassPermissions --setting-sources '' --strict-mcp-config --mcp-config '{"mcpServers":{}}' --plugin-dir <temporary-skills-only-plugin> 'Test skill resolution. First call Skill with skill="deck-parity-probe". If that fails, call Skill with skill="deck-session-skills:deck-parity-probe". Report which exact name succeeded.'
Observed native transcript:
  tool_use Skill {"skill":"deck-parity-probe"}
  tool_result "Launching skill: deck-parity-probe"
Final output: PROBE_LOADED; bare deck-parity-probe succeeded, fallback not attempted.
Cost: $0.00163966. Duration: 3250ms. Three turns. No other model smoke.
Therefore no namespace instruction was added to role prompts. Skills remain native and on demand.
Smoke result: /tmp/deck-skill-name-smoke.json
Native session id: 20d3d15f-2319-4492-b762-e54061ebbb1d

Remaining operational considerations
- Existing installed native Claude agents need a content reinstall/sync to receive the legacy-profile fix. An old generation intentionally blocks cross-session skill preparation instead of launching stale content.
- Existing adapter detectDeckInstall() reports replacementRequired for a stale owned plugin. apps/cli/src/upgrade-command/runner-sync.ts admits replacementRequired installations and runs plan/apply/verify. The upgrade orchestrator's content step invokes runRunnerSync; it publishes the new content-addressed generation and updates model-assignments.json while preserving old generations. Merely replacing a binary without content sync is insufficient. No user installation was modified by this task.
- Bare-name resolution was empirically checked on Claude 2.1.309 only; older/future native versions and personal name collisions were not separately exercised.
- Codex/OpenCode evidence is production launch composition and native global path/frontmatter verification, not paid live model turns.
- Skills-only directories are cached by selection hash; older cache directories are retained, as are existing team generations.

Logs
/tmp/claude-parity-red.log
/tmp/claude-parity-mutation.log
/tmp/claude-skills-mutation.log
/tmp/claude-parity-handoff.log
/tmp/claude-parity-service-final.log
/tmp/claude-parity-tsc.log
# Claude session full-plugin parity — attempt 2

## Outcome

Claude cross-runner Lead and member children now receive the full installed `deck-developer-team` generation beside the native memory plugin. Preparation reconstructs canonical expected files, checks the selected content hash and exact installed tree, and returns that installed root directly. Each child rechecks the selection hash, content hash, private ownership/permissions, exact file hashes and plugin identity before launch. Failure remains `claude-session-skills-unverified`.

The skills-only derivative materializer/cache code is removed. No existing on-disk caches were deleted. The `nativeSkills` transport name remains to avoid unrelated shared-contract churn; it now describes the verified full plugin.

## Changed targets in this continuation

- `packages/adapter-claude/src/runner-adapter.ts`: prepare the selected full generation directly; remove skills-only publication.
- `packages/adapter-claude/src/session-skills.ts`: verify the full canonical file manifest; derive namespaced MCP denials from its verified `.mcp.json`.
- `packages/adapter-claude/src/session-driver/launch.ts`: load the verified team plugin and deny its declared MCP servers while retaining memory, session MCP, suppression and delegation policy.
- `packages/adapter-claude/src/session-skills.test.ts`: full installed-root identity/content, Lead/member and trusted/untrusted launch, memory coexistence, stale selection/artifact/extra-file rejection, managed/suppressed/unselected MCP and all declared server IDs.
- `apps/cli/src/session-service.test.ts`: fixture now represents the full team plugin.
- `apps/cli/src/verification-parity.test.ts`: update namespace and document the full-plugin production parity exercise.
- `packages/core/src/session/driver.ts`: clarify descriptor documentation.

Other uncommitted changes were preserved. No OpenSpec edits, commits, installations, destructive Git commands or full-suite runs were performed.

## MCP policy

No MCP server from the team plugin is enabled. Every declared plugin server is denied, including future IDs. The existing session MCP set remains the only source of authority for these capabilities; omission is not consent for a plugin fallback.

| Plugin server | Plugin state | Permitted session route / reason |
| --- | --- | --- |
| context-mode | Denied if declared | Current canonical generation retires it; no plugin resurrection. |
| codebase-memory | Denied if declared; existing managed/suppressed denial retained | Only the session-selected, project-bound instance may run. |
| context7 | Denied if declared | Only an admitted session instance may run, without duplication. |
| serena | Denied if declared | Current canonical generation retires it; no plugin resurrection. |
| web-search | Denied if declared | Session native/fallback routing and suppression remain authoritative. |
| Any future plugin server | Denied if declared | Must be admitted through session composition first. |

The denials use `plugin:deck-developer-team:<server>`; ordinary session server names remain distinct. The memory plugin is independently supplied and unaffected. Tests exercise a real installed context7 manifest under managed, suppressed and absent session selection, plus all five historical manifest names and an unknown future ID.

## Agents and role skills

The full plugin registers its subagents. Session manager still sets `disableNativeDelegation: true` for every task; Claude launch still disallows both `Task` and `Agent` and does not select `--agent`. No alternate native delegation path was added. Deck's existing credential/tool grants still govern `deck_delegate`.

Role skills duplicate some role prompt content. This is acceptable under the requested native parity: skills load on demand, the installed canonical roles carry the safety blocks, and native delegation remains disabled. No new dependency on the legacy prompt profile was introduced; removing it remains separate work.

## RTK and approval integrity

The hook remains enabled whenever selected in the installed generation. Official Claude documentation states that permission rules evaluate `PreToolUse.updatedInput` and that the modified input is used for approval, before execution:
https://code.claude.com/docs/en/hooks#pretooluse-decision-control

Deck's hook wrapper pins the rewritten executable and forwards the structured input. A safe, non-model probe of the installed RTK v0.50.0 `hook claude` protocol returned rewrites for `git status`, `ls /tmp`, and `git push`, each with `updatedInput.command` and no `permissionDecision: allow`. These command strings were supplied only as JSON to the rewrite hook; none of those commands was executed. No model cost was incurred.

`packages/session-host/src/bridge-service.ts` presents the received Bash command to the approval broker and returns the same `input` as `updatedInput` on allow-once. Thus the documentation plus local hook/relay evidence supports: rewrite → approval of rewritten input → execution of approved input. No differing-command path was found. This is not a new end-to-end live Claude relay smoke; arbitrary additional user hooks remain outside this bounded proof, and Claude retains its existing static-compatible classification.

## Verification

- RED: updated full-generation test failed because the old root was `session-skills-<hash>` rather than the installed generation (2 pass, 1 fail).
- Focused final: `bun test packages/adapter-claude/src/session-skills.test.ts`: 4 pass, 0 fail, 63 assertions, 5.23 s.
- Affected once: `bun test packages/adapter-claude/src apps/cli/src/session-service.test.ts apps/cli/src/verification-parity.test.ts packages/core/src/teams/developer/content-invariants.test.ts packages/session-host/src/__tests__/bridge.test.ts`: 318 pass, 1 pre-existing opt-in skip, 0 fail, 4577 assertions, 72.71 s. The skipped test is the actual pinned RTK integration exercise; the separate safe hook protocol probe above used the installed binary.
- `bunx tsc --noEmit`: exit 0, no diagnostics.
- `git diff --check`: exit 0.
- Logs: `/tmp/claude-option-a-red.log`, `/tmp/claude-option-a-focused.log`, `/tmp/claude-option-a-affected.log`, `/tmp/claude-option-a-tsc.log`.

## Remaining limits

Existing stale Claude installations must be synchronized before launch; they fail closed. No new paid model smoke was repeated; prior bare-skill resolution evidence remains historical. Plugin MCP policy is structurally verified rather than a fresh live multi-server Claude run. Adaptive memory and graph tools were unavailable and were not used. Skill discovery context was absent, so bounded direct discovery used exposed skills; no registry was generated or modified.
