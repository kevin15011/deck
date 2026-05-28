# Review Report: Personality-Aware Orchestrator Architecture

## Summary

**Overall Rating**: APPROVE WITH CHANGES
**Scope**: general
**Files Reviewed**: 10

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | Install-time baking preserves runner isolation; dual-surface injection is correct. Pi adapter config path bug is an architectural boundary violation. |
| Security | ✅ Strong | No credential exposure; generated-file isolation enforced; no injection vectors introduced. |
| Scalability | ✅ Strong | Install-time string composition only; zero runtime cost; no new persistence or I/O at runtime. |
| Maintainability | ⚠️ Adequate | Three ~350-line prompt deltas in one 1100-line file with no sync mechanism creates high drift risk. Fragments and registry composition are clean. |
| Code Quality | ⚠️ Adequate | Composition ordering is explicit and tested. Pi adapter has a hardcoded projectRoot. Adapter tests lack personality assertions. |
| Backend | N/A | |
| Frontend | N/A | |
| Integration | ⚠️ Adequate | OpenCode adapter fully integrated. Pi adapter code integrated but missing test coverage and has a config-resolution bug. |

## Findings

### BLOCKER
- **Architecture**: Pi adapter `buildTeamSystemPrompt` reads `.deck/config.json` from the current working directory instead of the project root.
  - **File**: `packages/adapter-pi/src/pi-team-profile.ts` — line 90
  - **Evidence**: `const personality = options?.orchestratorPersonality ?? readDeckConfig(".").orchestratorPersonality;`
  - **Recommendation**: Change `"."` to `projectRoot` (or accept a `projectRoot` parameter). The `MaterializeTeamProfileOptions` already contains `projectRoot`; thread it through to `buildTeamSystemPrompt`.

### MAJOR
- **Integration**: Pi adapter `buildDeveloperTeamInstallPlan` does not handle `readDeckConfig` errors gracefully.
  - **File**: `packages/adapter-pi/src/developer-team-install.ts` — line 290
  - **Evidence**: `const personality = options?.orchestratorPersonality ?? readDeckConfig(projectRoot).orchestratorPersonality;` — no try/catch; malformed config throws and aborts install.
  - **Recommendation**: Wrap in try/catch and fall back to `DEFAULT_ORCHESTRATOR_PERSONALITY`, matching the OpenCode adapter pattern (lines 282–289 in `developer-team-install.ts`).

- **Maintainability**: Three full prompt variants in a single 1100-line file with no automated sync mechanism.
  - **File**: `packages/core/src/teams/developer/orchestrator-content.ts`
  - **Evidence**: `ORCHESTRATOR_PROMPT_GUIDA` (~550 lines), `ORCHESTRATOR_PROMPT_AHORRO_EXTREMO` (~300 lines), and `ORCHESTRATOR_SYSTEM_PROMPT` (~250 lines) are near-duplicates. Tests verify invariant sections, but edits to one variant must be manually mirrored.
  - **Recommendation**: Consider extracting a shared `ORCHESTRATOR_PROMPT_BASE` template and applying personality deltas programmatically, or add a lint/comment rule that warns when invariant sections diverge. At minimum, document the manual-sync requirement in the file header.

- **Integration**: Adapter test suites lack personality-specific assertions required by Task 7.
  - **File**: `packages/adapter-opencode/src/developer-team-install.test.ts`, `packages/adapter-opencode/src/prompt-generation.test.ts`, `packages/adapter-pi/src/developer-team-install.test.ts`, `packages/adapter-pi/src/pi-team-profile.test.ts`
  - **Evidence**: No tests assert that generated orchestrator prompts contain `"Guia Personality"` / `"Ahorro-Extremo"` markers, or that non-orchestrator generated files contain `"Communication Style (Ahorro-Extremo)"`. Runner isolation tests exist but personality coverage is absent.
  - **Recommendation**: Add tests that build plans with each personality variant and assert markers are present in the correct generated files.

### MINOR
- **Code Quality**: Sub-agent personality fragment is in Spanish while all other orchestrator content is in English.
  - **File**: `packages/core/src/teams/developer/sub-agent-personality-content.ts` — lines 13–20
  - **Evidence**: `"Responde de la forma más concisa posible. Usa mínimo tokens..."`
  - **Recommendation**: Translate to English for consistency, or explicitly document the bilingual intent if it is deliberate.

- **Maintainability**: Task 8 deprecation target file does not exist.
  - **File**: `packages/sdd-runtime/src/orchestrator/personality-output.ts` (expected)
  - **Evidence**: File not found; glob shows no `personality-output.ts` in `packages/sdd-runtime/src/orchestrator/`.
  - **Recommendation**: Either locate the correct file path, or mark Task 8 as non-applicable and remove it from the dependency graph.

### NIT
- **Code Quality**: `getOrchestratorSystemPrompt` runtime default case silently coerces invalid personalities to `pragmatica`.
  - **File**: `packages/core/src/teams/developer/orchestrator-content.ts` — lines 768–771
  - **Recommendation**: This is defensive, but logging a warning or narrowing the type at call sites would make misconfigurations visible earlier.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Deviations**:
  1. Pi adapter `buildTeamSystemPrompt` reads config from `"."` instead of `projectRoot` — not aligned with the design's intent that adapters read from the actual project.
  2. Design specifies "adapters pass `config.orchestratorPersonality` into every registry call" — Pi adapter does this in install-plan generation but not in `buildTeamSystemPrompt` when no explicit option is provided (uses hardcoded cwd).
  3. Task 7 isolation tests with personality assertions are not yet implemented in either adapter.
  4. Task 8 deprecation cannot be completed as specified because the target file does not exist.

## Open Questions

1. What is the intended behavior when `readDeckConfig` throws in Pi adapter `buildDeveloperTeamInstallPlan`? Should it fall back to `pragmatica` or abort installation?
2. Is the Spanish-language sub-agent fragment deliberate (e.g., targeting Spanish-speaking runners), or should it be English for consistency with the rest of the orchestrator content?
3. Should the 1100-line `orchestrator-content.ts` be refactored into a base template + delta system before drift becomes unmanageable?
