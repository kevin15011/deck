# Apply Progress: Enforce English Agent Artifacts

## Completed Tasks

### Task 1: Add central language policy constant and helper in content-registry
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/content-registry.ts` — modify (constant and helper already present in working tree; preserved and used)

**Verification**
- Tests: pass
- Build: not run (project build is binary build, not required for content changes)
- Typecheck: pre-existing failures across project; no new errors introduced by these changes

**Notes**
- `DEVELOPER_TEAM_LANGUAGE_POLICY` was already defined in the working tree. It states English-only internal communication, allowed literal exceptions, the user-language user-facing requirement, and the capability-bundle preservation clause.
- `appendDeveloperTeamLanguagePolicy(content)` appends the policy to non-empty content.

### Task 2: Compose central policy into agent, skill, fallback, and session surfaces
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/content-registry.ts` — modify

**Verification**
- Tests: pass (`Developer Team language policy composition` suite)
- Build: not run
- Typecheck: pre-existing failures

**Notes**
- Wired `withDeveloperTeamLanguagePolicy` into `getAgentContentResult` for both real and fallback content paths.
- Wired `appendDeveloperTeamLanguagePolicy` into `getTeamSessionInstructions`.
- Composition order remains: orchestrator invariants → base content → context-authority guidance → Developer Team language policy → optional capability instructions.
- Used Serena `replace_symbol_body` for the three symbol-level edits.

### Task 3: Reinforce orchestrator prompt and skill body with explicit language policy
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/orchestrator-content.ts` — modify (already present in working tree; preserved)

**Verification**
- Tests: pass (`Orchestrator Language Policy reinforcement` suite)
- Build: not run
- Typecheck: pre-existing failures

**Notes**
- `ORCHESTRATOR_SYSTEM_PROMPT` and `ORCHESTRATOR_SKILL_BODY` already contain a `## Language Policy` section with the four reinforcement points and allowed literal exceptions.
- `getTeamSessionInstructions("developer-team")` now composes the central policy from Task 2 as expected.

### Task 4: Replace `herramienta` placeholder in Serena instruction bundle
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/instruction-bundles/serena.ts` — modify (already present in working tree; preserved)
- `packages/core/src/teams/developer/instruction-bundles/bundle-parity.test.ts` — modify (updated baseline hash)

**Verification**
- Tests: pass
- Build: not run
- Typecheck: pre-existing failures

**Notes**
- Serena agent fragment now reads `Serena tools unavailable. Using fallback: [tool].`
- Session fragment now reads `Serena edit tools unavailable; fallback used: [tool].`
- Updated `bundle-parity.test.ts` baseline hash for the Serena agent fragment because the intentional content change altered the deterministic hash.

### Task 5: Replace `herramienta` placeholder in apply-general-content
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/apply-general-content.ts` — modify (already present in working tree; preserved)

**Verification**
- Tests: pass
- Build: not run
- Typecheck: pre-existing failures

### Task 6: Replace `herramienta` placeholder in apply-backend-content
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/apply-backend-content.ts` — modify (already present in working tree; preserved)

**Verification**
- Tests: pass
- Build: not run
- Typecheck: pre-existing failures

### Task 7: Replace `herramienta` placeholder in apply-frontend-content
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/apply-frontend-content.ts` — modify (already present in working tree; preserved)

**Verification**
- Tests: pass
- Build: not run
- Typecheck: pre-existing failures

### Task 8: Add content-registry tests for policy presence and leak absence
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/content-registry.test.ts` — modify

**Verification**
- Tests: pass
- Build: not run
- Typecheck: pre-existing failures

**Notes**
- Added `Developer Team language policy composition` describe block covering:
  - Every catalog agent body/skill body contains `DEVELOPER_TEAM_LANGUAGE_POLICY`.
  - No catalog agent body/skill body contains `herramienta`.
  - `getTeamSessionInstructions("developer-team")` contains the policy and excludes `herramienta`.
  - Composition order: policy appears after context-authority guidance and before capability instructions.
  - Serena capability bundle preserves the policy and does not reintroduce the leak.
  - Fallback path receives the policy.

### Task 9: Add orchestrator-content tests for delegation, validation, and user-language requirement
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/orchestrator-content.test.ts` — modify

**Verification**
- Tests: pass
- Build: not run
- Typecheck: pre-existing failures

**Notes**
- Added `Orchestrator Language Policy reinforcement` describe block covering both `ORCHESTRATOR_SYSTEM_PROMPT` and `ORCHESTRATOR_SKILL_BODY`:
  - `## Language Policy` heading present.
  - English-only delegation prompts.
  - English-only sub-agent responses and generated artifacts.
  - Repair/reject requirement for non-English outputs except allowed literals.
  - User-facing responses must use the user's language.
  - Allowed literal exceptions listed.

### Task 10: Add adapter-opencode prompt-generation regression tests
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-opencode/src/prompt-generation.test.ts` — modify

**Verification**
- Backend Tests: pass (`Developer Team language policy propagation to OpenCode prompts` suite)
- Build: not run (binary build not required for test changes)
- Typecheck: not run (pre-existing failures; tests validate TypeScript syntax)

**Notes**
- Imported `DEVELOPER_TEAM_LANGUAGE_POLICY` from `@deck/core/teams/developer/content-registry`.
- Added assertions for every planned prompt from `buildPromptGenerationPlan()`:
  - content contains `DEVELOPER_TEAM_LANGUAGE_POLICY`;
  - content does not contain `herramienta`.

### Task 11: Add adapter-opencode developer-team-install regression tests
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-opencode/src/developer-team-install.test.ts` — modify

**Verification**
- Backend Tests: pass (`Developer Team language policy propagation to OpenCode install-plan skills` suite)
- Build: not run
- Typecheck: not run (pre-existing failures)

**Notes**
- Scanned every planned skill file from `buildOpenCodeDeveloperTeamInstallPlan()` for policy presence and leak absence.

### Task 12: Add adapter-pi developer-team-install regression tests
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/developer-team-install.test.ts` — modify

**Verification**
- Backend Tests: pass (`Developer Team language policy propagation to Pi install-plan files` suite)
- Build: not run
- Typecheck: not run (pre-existing failures)

**Notes**
- Scanned every non-orchestrator agent file and every skill file from `buildDeveloperTeamInstallPlan()`.
- Excluded the Pi orchestrator stub because the runtime profile is the authority (verified in Task 13).

### Task 13: Add adapter-pi pi-team-profile regression tests
**Status**: ✅ Complete
**Files Changed**
- `packages/adapter-pi/src/pi-team-profile.test.ts` — modify

**Verification**
- Backend Tests: pass (`Developer Team language policy propagation to Pi team profile` suite)
- Build: not run
- Typecheck: not run (pre-existing failures)

**Notes**
- Verified both `buildTeamSystemPrompt("developer-team")` and the materialized `.deck/pi/profiles/developer-team/system-prompt.md` contain the policy and exclude `herramienta`.

## In-Progress Tasks

None.

## Blocked Tasks

None.

## Remaining Tasks

None.

## Budget Advisory

- Simpler existing path considered: Yes — central policy constant plus composition helper reuses existing `content-registry.ts` composition machinery.
- New dependency/abstraction added: No.
- Advisory budget exceeded: No — changes are well under the 400-line advisory threshold.
- Quality override used: No.

## Serena Edit Tool Usage

Serena symbolic editing tools were available and used as first preference where applicable:
- `replace_symbol_body` for `applyAgentContentComposition` in `content-registry.ts` (Tasks 1-2, General Apply).
- `replace_symbol_body` for `getAgentContentResult` in `content-registry.ts` (Tasks 1-2, General Apply).
- `replace_symbol_body` for `getTeamSessionInstructions` in `content-registry.ts` (Tasks 1-2, General Apply).

For Tasks 10-13, the changes were file-level test insertions (new top-level `describe` blocks and import updates), which are not symbol-body replacements. The generic `edit` tool was used as the appropriate fallback; no Serena symbol-level edit was required.

---

## Review Fix: Add deck-init and deck-onboard to Language Policy Test Iteration

**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/teams/developer/content-registry.test.ts` — modify

**Verification**
- Tests: pass (84 tests, 704 expect() calls)
- Build: not run
- Typecheck: pre-existing failures

**Notes**
- Added `LANGUAGE_POLICY_TEST_AGENT_IDS` constant that includes all 14 agents in `REAL_CONTENT`:
  - The original 12 `deck-developer-*` agents
  - `deck-init` and `deck-onboard` (user-invocable skills)
- Updated language policy composition tests to iterate over `LANGUAGE_POLICY_TEST_AGENT_IDS` instead of `DEVELOPER_AGENT_IDS`
- This closes the coverage gap identified in Review: all real content agents are now verified for policy presence and leak absence
- Did NOT expand deny-list to Spanish plural `herramientas` as that would cause false positives in pre-existing test files
- Used generic `edit` tool for the symbol-level edits (array constant additions)
