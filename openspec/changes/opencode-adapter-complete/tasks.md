# Tasks: OpenCode Adapter Complete

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1800–2200 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (Phase 1) → PR 2 (Phase 2) → PR 3 (Phase 3+4) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Foundation modules (config-merge, model-config, internal-opencode-packages) + tests | PR 1 | Base: main; independent, testable |
| 2 | Artifact generators (prompt-generation, command-generation) + skill fix + tests | PR 2 | Base: main; independent of PR 1 |
| 3 | Agent config rewrite + CLI integration + wiring | PR 3 | Base: main; depends on PR 1 + PR 2 |

## Phase 1: Foundation

- [x] 1.1 Create `packages/adapter-opencode/src/config-merge.ts` — types (`OpenCodeConfig`, `AgentEntry`, `MergeOptions`, `MergeResult`), `readConfig()`, `backupConfig()`, `mergeConfig()`, `writeConfigAtomic()`, `validateConfig()`, `mergeAndWrite()`. Supports DI for fs ops (readFile/writeFile/renameFile/exists).
- [x] 1.2 Create `packages/adapter-opencode/src/config-merge.test.ts` — test scenarios: file-not-found → `{}`, malformed JSON → abort, backup created, atomic write + validation, post-write failure → rollback, idempotent merge, namespace-scoped injection preserves non-deck keys (REQ-OC-CM-001 through REQ-OC-CM-005).
- [x] 1.3 Create `packages/adapter-opencode/src/model-config.ts` — `OpenCodeModelConfig` type, `DEFAULT_OPENCODE_MODELS` map (12 agents), `resolveModelConfig(agentId, cliOverride?, configOverrides?)` with CLI > config > defaults priority (REQ-OC-MC-001 through REQ-OC-MC-003).
- [x] 1.4 Create `packages/adapter-opencode/src/model-config.test.ts` — test default assignments, CLI override precedence, config file override, composable separation (model swap without touching other fields).
- [x] 1.5 Create `packages/adapter-opencode/src/internal-opencode-packages.ts` — `InternalOpenCodePackageId`, `INTERNAL_OPENCODE_PACKAGES` catalog, `detectMermaidPluginStatus(config)`, silent-add helper. Mirror Pi's `internal-runner-packages.ts` pattern (REQ-OC-PM-001 through REQ-OC-PM-003).
- [x] 1.6 Create `packages/adapter-opencode/src/internal-opencode-packages.test.ts` — test plugin "ready" when present, "missing" when absent, silent add to plugin array, non-blocking on failure.

## Phase 2: Artifact Generation

- [x] 2.1 Create `packages/adapter-opencode/src/prompt-generation.ts` — `generatePromptFiles(configDir, agents)` producing thin wrappers referencing skill paths via absolute `{file:...}` references. Orchestrator prompt differs from subagent (REQ-OC-PG-001, REQ-OC-PG-002).
- [x] 2.2 Create `packages/adapter-opencode/src/prompt-generation.test.ts` — test 12 prompt files generated, correct template per role, absolute paths resolve.
- [x] 2.3 Create `packages/adapter-opencode/src/command-generation.ts` — `generateCommandFiles(configDir)` producing 14 command files (`sdd-apply` through `sdd-ff`) with YAML frontmatter (`description`, `agent: deck-developer-orchestrator`, `subtask: true`) and gate-enforcing bodies (REQ-OC-CG-001 through REQ-OC-CG-003).
- [x] 2.4 Create `packages/adapter-opencode/src/command-generation.test.ts` — test all 14 commands generated, valid frontmatter, correct gate logic per command type.
- [x] 2.5 Update skill generation in `packages/adapter-opencode/src/developer-team-install.ts` — fix `buildSkillFileContent()` to emit correct OpenCode frontmatter (`disable-model-invocation: true`, `user-invocable: false`, `metadata.delegate_only: true`) (REQ-OC-SG-001 through REQ-OC-SG-003).

## Phase 3: Agent Config + Config Merge Integration

- [x] 3.1 Rewrite `packages/adapter-opencode/src/developer-team-install.ts` `buildOpenCodeDeveloperTeamInstallPlan()` — generate `Record<string, AgentEntry>` for 12 agents. Orchestrator: `mode: "primary"`, `permission.task` deny-by-default + allowlist. Subagents: `mode: "subagent"`, `hidden: true`, tool whitelist `{ bash, edit, read, write }` (REQ-OC-AC-001 through REQ-OC-AC-004).
- [x] 3.2 Integrate config merge into install flow — `applyOpenCodeDeveloperTeamInstall()` calls `mergeAndWrite()` with agent entries + mermaid plugin injection + prompt/command file writes. Full idempotent install cycle.
- [x] 3.3 Update `packages/adapter-opencode/src/developer-team-install.test.ts` — test 12 agent entries generated, orchestrator has `permission.task` with correct allowlist, subagents have `hidden: true`, prompt references resolve, core content matches catalog, full install flow with mock fs.

## Phase 4: CLI Integration

- [x] 4.1 Update `apps/cli/src/cli-args.ts` — add `opencode-launch` variant to `ParsedArgs` union. Parse `deck opencode developer` → `{ command: "opencode-launch", teamId: "developer-team", memoryProvider? }`. Reject unknown teams (REQ-OC-LC-001, REQ-OC-LC-002).
- [x] 4.2 Create `apps/cli/src/opencode-launch-command.ts` — `runOpenCodeLaunch()`: check `opencode` in PATH, resolve memory provider (CLI > config > none), build install plan, run config merge + prompt/command/skill generation, spawn `opencode` process with correct cwd (REQ-OC-LC-003, REQ-OC-LC-004).
- [x] 4.3 Update `apps/cli/src/main.tsx` — add `opencode-launch` routing branch before TUI fallthrough, mirroring `pi-launch` pattern.
- [x] 4.4 Write/update tests for CLI changes — `cli-args.test.ts` for opencode parsing, `opencode-launch-command.test.ts` for launch flow with mock fs/spawn.

## Phase 5: Wiring + Verification

- [x] 5.1 Update `packages/adapter-opencode/src/index.ts` — add barrel exports for `config-merge`, `model-config`, `internal-opencode-packages`, `prompt-generation`, `command-generation`.
- [x] 5.2 Run `bun test` across `packages/adapter-opencode/` and `apps/cli/` — verify all new and existing tests pass.
- [x] 5.3 Manual integration check — `deck opencode developer --memory=engram` parses, generates 12 agent entries in `opencode.json`, prompt/command/skill files exist, mermaid plugin injected.
