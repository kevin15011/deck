# Legacy removal map (read-only inventory)

I ran no edits or commits. Line numbers and counts come from the working tree, so they may drift where the Claude launch code is being edited. My only run was a temporary script at `/tmp/cmp.ts`.

## Findings

**1. The `legacy` prompt profile does nothing for the seven real roles.**
- I ran `getAgentContent(id, {promptProfile: "legacy"})` against `"compact"` for all 7 catalog roles. `agentBody` and `skillBody` are identical.
- The cause is in `content-registry.ts`. Both `REAL_CONTENT` and `COMPACT_CONTENT` start with `...ADAPTIVE_AGENT_CONTENT`.
- Profiles differ in only two places:
  - **Legacy role IDs** (`deck-developer-*`, `deck-init`, `deck-onboard`): `REAL_CONTENT` holds the long legacy bodies and `COMPACT_CONTENT` holds the compact bodies.
  - **Session instructions** (`getTeamSessionInstructions`): `legacy` builds `getOrchestratorSystemPrompt("legacy")` plus `prependOrchestratorInvariants`. `compact` builds the adaptive lead prompt plus `ADAPTIVE_TEAM_RUNTIME_CONTRACT`. My script showed these are not equal (`session false`).
- If every runner used compact:
  - **Claude:** the only legacy consumer is `packages/adapter-claude/src/runner-adapter.ts:76`, which hardcodes `"legacy"`. The output for the 7 roles is byte-identical, so switching or dropping it changes nothing. Claude does not call `getTeamSessionInstructions` with legacy.
  - **Every other runner and the CLI:** already hardcode compact. This covers OpenCode, Pi, `session-service.ts:86,130`, and the `runner-capabilities.ts` entries in OpenCode (373, 572, 636) and Pi (130, 492).
- `promptProfile` config at `deck-config.ts:169,300,334,1242`, `rollout-policy.ts:22,52-53,88,331-425` and `docs/configuration.md:115`:
  - **Config enum:** `["legacy","compact"]` with a compact default. After removal only compact remains, so I recommend rejecting or ignoring `legacy` with a diagnostic rather than failing hard.
  - **Rollout policy:** `resolvePromptProfileActivationV1` and `evaluateCompactPromptActivationV1` can resolve to `legacy`. The runtime effect is nil, because adapters pass `promptProfileActivation` through but the install code ignores it and hardcodes `compact` (opencode `developer-team-install.ts:493`, pi `:572`, pi-team-profile `:116`).
  - **Exports:** `PromptProfileActivationV1` is re-exported from `adapter-pi/src/index.ts:39` and `sdd-runtime/src/index.ts:144-145`.

**2. The legacy SDD roles are not materialized or loaded by any production path.**
- `DEVELOPER_TEAM_AGENTS` has exactly 7 roles (`catalog.ts`). All installs (OpenCode, Pi, Codex, Claude) iterate that catalog.
- The `*-content.ts` modules have no production importer except `content-registry.ts`. Their agent/skill bodies are reachable only through legacy IDs. Specifically:
  - `orchestrator-content.ts`: `ORCHESTRATOR_PROMPT_GUIDA`, `ORCHESTRATOR_PROMPT_PRAGMATICA`, and the legacy agent/skill bodies.
  - The 11 other `*-content.ts` files: each file's non-compact exports.
- **Keep from `orchestrator-content.ts`:**
  - `composeApplyAgentPrompt` is called by `adapter-opencode/prompt-generation.ts:19,154`.
  - Its compact exports are still used: `ORCHESTRATOR_PROMPT_COMPACT_*`, `ORCHESTRATOR_COMPACT_*_BODY`, and the matching exports in each phase file.
  - The `getOrchestratorSystemPrompt` compact branch.
- **Deprecated re-export shims, with no importer found:**
  - `packages/core/src/orchestrator-prompt.ts` and `explorer-prompt.ts`
  - `packages/adapter-pi/src/orchestrator-prompt.ts` and `explorer-prompt.ts`
  - The `package.json:48-49` entries for `./teams/developer/orchestrator-content` and `explorer-content` are still imported by adapter code, so keep them.
- **`orchestrator-invariants.ts`:** used by `withOrchestratorInvariants` (legacy path and the fallback branch at `content-registry.ts` ~line 535), by `renderCompactOrchestratorInvariantsV1` (compact path), and by the types in opencode and `sdd-runtime` fixtures. Split it: keep the compact renderer and `ModificationAuthorization`, and drop `prependOrchestratorInvariants` and the verifiers.
- **`deck-init-content.ts` (120 lines):** imported only by `content-registry.ts` (`:5`). It contains a `.replaceAll("deck-init","deck-setup")` compact derivation, so the compact `DECK_INIT_COMPACT_*` bodies may depend on it. The apply agent must check that before deleting.
- **`deck-onboard-content.ts` and `deck-archive-content.ts`: do not delete.** `skills/bootstrap/index.ts` ships them as standalone lifecycle skills. Pi and OpenCode install them as `sddSkillFiles`, and docs state "exactly seven agent/skill pairs plus Onboard and Archive." Only the registry entry `"deck-onboard"` in `REAL_CONTENT` and `COMPACT_CONTENT` is legacy-only.
- **No CLI command** `deck-init` or `deck-onboard` exists. Matches in `src` are prompt text and comments.
- **`LEGACY_DEVELOPER_TEAM_AGENT_ID_MAP`, `DEVELOPER_TEAM_LEGACY_AGENT_IDS` and `resolveLegacyDeveloperTeamAgentId`:**
  - **Runtime consumers:**
    - `developerRoleContinuity` in `catalog.ts:111`
    - OpenCode cleanup: `developer-team-install.ts:575,605,680,918` and `runner-adapter.ts:1324`
    - Pi cleanup: `developer-team-install.ts:680,721`
  - **Role of the map:** it is the removal list for stale installs, so it falls under 3(b), not 3(a).

**3. Migration and cleanup paths.**

| Item | Location | Consumers | Cat | Recommendation |
|---|---|---|---|---|
| `legacy` in the `promptProfile` enum | `deck-config.ts:169,300,334,1242`; `rollout-policy.ts:22,52-53,331-425` | The rollout policy and tests only; adapters ignore it | a | Delete the `legacy` branch. In config, treat a stored `legacy` as compact and emit a normalization diagnostic, so old config files don't hard-fail. |
| Claude `promptProfile: "legacy"` | `adapter-claude/runner-adapter.ts:76` | Claude `expectedFiles` | a | Replace with the default (no-op for output). It is a one-token change in an in-flight file, so apply it after the other agent lands. |
| `buildDeveloperTeamManifestLegacy` | `manifest.ts:226`; `core/index.ts:102` | Tests only (`manifest.test.ts:161-173`) | a | Delete the function, the export and the tests. |
| `orchestrator-prompt.ts` and `explorer-prompt.ts` shims | core and adapter-pi (4 files, 10 lines each) | None found | a | Delete them. |
| `getOrchestratorSystemPrompt` legacy branch | `orchestrator-content.ts:528-541` | Only the legacy session path | a | Delete the branch and the `promptProfile` parameter. |
| Legacy content bodies | 12 `*-content.ts` files, about 5,400 src lines | Only `REAL_CONTENT` | a | Delete the non-compact exports and `REAL_CONTENT`'s legacy entries. Keep each `*_COMPACT_*` export. Compact deck-init/deck-onboard bodies may be derived from the deleted content. |
| `LEGACY_DEVELOPER_TEAM_AGENT_ID_MAP` and `DEVELOPER_TEAM_LEGACY_AGENT_IDS` | `catalog.ts:77-100` | OpenCode and Pi cleanup, continuity | b | Keep, but reduce to a plain ID list in a `legacy-ids` module. If deleted, upgraders keep stale `deck-developer-*` agents next to the new roles, and the Pi verify step would no longer flag "Legacy active path remains." |
| `migrateLegacyDeveloperTeamAssignments` | `model-migration.ts` (56 lines); callers: pi `developer-team-install.ts:697-698`, opencode `model-config.ts:311-312` | Install paths | b | Keep minimal. If deleted, upgraders lose their per-role model assignments and the seven new roles fall back to defaults. Add a removal date to the changelog. |
| Pi legacy cleanup and `--cleanup-legacy` | `pi-legacy.ts` (325 lines), `pi-legacy-templates.ts`, `pi-doctor.ts`, `cli-args.ts:109,125,170,178,191,623-694`, `runner-launch-command.ts:515` | The doctor, preflight, and the Codex and Pi launches | b | Keep. Preflight and the doctor both tell users to run this flag. Deleting it leaves shadowed skills ("[Skill conflicts]") with no remedy. |
| Pi `cleanupLegacySddAgentFiles`, `retirePiLegacyFiles` and `LEGACY_SDD_AGENT_FILES` | `developer-team-install.ts:213-270, 718-800, 1063, 1099` | The install step, which quarantines old files | b | Keep. These retire files from old installs, and the verify step depends on them. Flag as the first candidate for removal after a deprecation window. |
| Config path migration | `deck-config-store.ts:22-25,306-311`; `xdg-migration.ts` | Config loading | b | Keep. Dropping it strands users who still have old `.deck/config.json` files. |
| `PACKAGE_CONFIGURATION_RETIRED`, `CROSS_ASSIGNMENT_LEGACY_SHAPE` and the Engram migration | `deck-config.ts:239,945-969` | Config normalization | b | Keep. |
| `routePolicy: "legacy-triage"`, `decisionKernel: "legacy"` and rollout status `legacy-compatible` | `deck-config.ts:161,168,333,1241`; `execution-lane-router.ts:7`; docs say "Legacy effects remain authoritative" in shadow mode | The live default for `routePolicy` and the live execution router | **c** | **Do not remove** with the prompt-profile work. These are the shipped defaults and the execution-control rollout contract, not noise. Renaming them is a separate design change. |
| `push-attention-store` v1 migration, `chat-history`, and the Claude `legacyName`/`legacyRoot` plugin-dir migration (`runner-adapter.ts:393-405`) | session-host and adapter-claude | Persistence and install paths | b | Keep. Persisted v1 stores and installed plugin dirs would break. |
| The `legacy` names inside `core/skills/external/archify` and `diagram-design` | Vendored files | Skill content | Not Deck legacy | Out of scope. |
| Git safety (`git-safety.ts`), approvals, release and install integrity, and the `retirement-*` scripts | Various | | **c** | Untouched. `git-safety.ts` is injected into the compact path as `DEVELOPER_TEAM_COMPACT_RUNTIME_CONTRACT`. |

## Tests that exist only for legacy behavior

| Group | Files | LOC |
|---|---|---|
| The 12 legacy per-role content tests (orchestrator through archive) | 12 | 4,433 |
| `pi-legacy.test.ts` | 1 | 216 |
| `model-migration.test.ts` | 1 | 55 |
| `orchestrator-invariants.test.ts` and `.task2.test.ts` | 2 | 867 |
| `user-phase-communication.test.ts` | 1 | 418 |
| **Total** | 17 | **about 6,000** |

- Keep or trim: `pi-legacy.test.ts` and `model-migration.test.ts` stay while their sources stay. The last two groups need a trim, not a delete.
- The first two groups are not all pure legacy, because each file also asserts the compact exports. Move those assertions into `prompt-profile.test.ts` or a role-level compact test first. `prompt-profile.test.ts` itself exercises both profiles, so remove the `legacy` branch rather than the file.
- Also trim the legacy-ID assertions in:
  - `content-registry.test.ts` (1,209 lines, 25 mentions)
  - `catalog.test.ts` (68 lines)
  - `content-invariants.test.ts` (92 lines)
  - `manifest.test.ts` (464 lines, the `buildDeveloperTeamManifestLegacy` block)
  - the opencode and pi install tests
  - `sdd-runtime/src/execution/rollout-policy` tests, plus any other test that exercises the `legacy` profile branch
- Expected removal: about 5,400 src lines plus about 6,000 test lines, so roughly 11,000 lines in total. That is an estimate. The compact exports and the invariants split will take some of it back.

## Specs and registry

- `openspec/specs/` has three capabilities: `adaptive-quality-control`, `artifact-state-contracts` and `runner-orchestration-resilience`. My grep found no `promptProfile`, `deck-developer-*` or legacy-role requirements in them. `registry-schema.md` and `config.yaml` have none either.
- Prompt-profile and legacy-role requirements live in historical and active change artifacts, not promoted specs. I did not edit those and they stay as history. The adaptive-team claims are in these maintainer docs:
  - `docs/maintainers/developer-team-execution.md` (lines 12, 17, 86, 106) says to start with `promptProfile=compact` and describes `compact` resolving "without a receipt."
  - `docs/configuration.md:115` lists `promptProfile` as `legacy` or `compact`.
  - `docs/developer-team.md:24` says legacy role IDs "remain migration/h…" (cut off at 180 characters).
- So the spec delta is small. If the user wants the removal as a tracked change, add one delta to the change's own spec stating that `promptProfile` accepts only `compact` and that legacy IDs are retained for cleanup only.
- `tests/documentation-governance.test.ts` mentions "legacy" and may pin that doc wording. Update it with the docs.
- The change `test-strategy-and-suite-pruning` exists, so link the test pruning above to it.

## Sequencing

1. Land the Claude launch work first.
2. Stage 1 (no behavior change):
   - Drop `promptProfile: "legacy"` from the Claude adapter.
   - Delete `buildDeveloperTeamManifestLegacy`, the four prompt shims, and the `legacy` branch in `getOrchestratorSystemPrompt` and `getTeamSessionInstructions`.
   - Remove `legacy` from the type, the config enum (normalize stored `legacy` to compact with a diagnostic) and `rollout-policy`.
3. Stage 2: delete the legacy content bodies and the `REAL_CONTENT` legacy entries, move the compact assertions into the new tests, split `orchestrator-invariants.ts`, and trim or delete the test files.
4. Stage 3: update docs, then run `bunx tsc --noEmit`, `bun run test:changed` and `bun run test:full`.
5. Leave the migration and cleanup paths (3b) for a later release after a deprecation notice.

## Risks

- **Hidden dependency in the content files:** a compact body that is built from a legacy constant or `deckInitSkillContent` would break on deletion. `tsc` will catch it.
- **Generated outputs:** `packages/adapter-pi/assets/pi/extensions/*.generated.js` and `adapter-opencode/.../developer-team-execution.generated.js` are modified in the working tree. Do not hand-edit them. Regenerate them if the source they depend on changes.
- **`rollout-policy` public exports:** `resolvePromptProfileActivationV1` is re-exported from `sdd-runtime/index.ts`. Check the test suite before removing it.
- **Upgraders:** deleting the 3(b) paths would leave stale agents, lost model assignments and shadowed skills. I recommend keep-minimal.
- **Doc and spec drift:** `docs/maintainers/developer-team-execution.md`, `docs/configuration.md:115` and `tests/documentation-governance.test.ts` must change together.
- **Shared worktree:** the working tree already has uncommitted changes (renamed tests, new CI workflow, CLI edits), so keep this removal in its own commit.
