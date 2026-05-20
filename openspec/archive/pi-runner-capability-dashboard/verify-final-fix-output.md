# Verify Report: pi-runner-capability-dashboard — final review fix

## Summary

**Overall Result**: FAIL  
**Scope**: re-check del final review fix para el boundary Supermemory Review & Install.  
**Registry Mode**: deferred — se leyó `state.yaml`/`events.yaml` y no se modificó registry.  
**Tasks Complete**: 1 / 1 final-fix item marked complete in `apply-progress.md`  
**Tests**: 901 / 901 passed across targeted + workspace runs  
**Build**: WARN — root `build` script does not exist  
**Typecheck**: PASS

Resultado principal: aunque los tests existentes pasan y varias correcciones solicitadas están implementadas, el flujo real de dashboard Supermemory todavía no satisface el requisito de Run: el setup real guarda un diagnóstico informativo en `dashboardState.adaptiveMemory.supermemory.diagnostics`, y `runPiRunnerReviewPlan()` trata cualquier diagnóstico de setup como bloqueo preflight. Con la salida real de `buildDashboardSupermemorySetupUpdate()`, Run retorna `review-plan.preflight` y no ejecuta `write-pi-mcp-config`, por lo que no escribe Pi MCP config dentro del plan ni resuelve el provider antes de aplicar el team.

## Task Completion

| Task / Fix Item | Status | Notes |
|---|---|---|
| Final Review BLOCKER: Supermemory credential persistence and provider resolution order | ✅ Complete in apply-progress | Implementado según artifact, pero verificación encontró fallo funcional en el flujo real. |

## Test Results

| Test Suite | Pass | Fail | Skip | Command |
|---|---:|---:|---:|---|
| Targeted dashboard/action-runner/render/input/reducer + related Supermemory/model tests | 127 | 0 | 0 | `bun test apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts apps/cli/src/tui/pi-runner-dashboard/render.test.tsx apps/cli/src/tui/pi-runner-dashboard/input-handler.test.ts apps/cli/src/tui/pi-runner-dashboard/reducer.test.ts apps/cli/src/tui/screens/developer-team-screens.test.tsx apps/cli/src/tui/developer-team-flow.test.tsx apps/cli/src/pi-launch-command.direct-supermemory.test.ts apps/cli/src/pi-launch-command.test.ts apps/cli/src/pi-launch-command.supermemory.test.ts packages/adapter-supermemory/src/index.test.ts packages/adapter-pi/src/developer-team-install.test.ts` |
| Workspace | 774 | 0 | 0 | `bun test` |
| Manual repro command | 0 | 1 | 0 | `bun -e` constructed state from `buildDashboardSupermemorySetupUpdate()` and called `runPiRunnerReviewPlan()` |

## Build / Typecheck

| Check | Result | Details |
|---|---|---|
| Build | ⚠️ WARN | `bun run build` → `error: Script not found "build"`. Root `package.json` only defines `deck` and `test`; this appears pre-existing for this workspace. |
| Typecheck | ✅ PASS | `bunx tsc --noEmit --pretty false` completed with no output/errors. |

## Compliance Matrix

| Requirement / Final Fix Check | Method | Result | Notes |
|---|---|---|---|
| Supermemory setup no persiste Pi MCP credentials antes de Run | Code inspection + targeted test | ✅ PASS | `persistDashboardSupermemorySelection()` uses `buildDashboardSupermemorySetupUpdate()` and no longer calls `handOffSupermemoryCredentialToPiMcp()`/writer in the dashboard path. Existing legacy non-dashboard `persistMemoryProviderSelection()` still writes Pi MCP config, but that is outside this final dashboard fix scope. |
| Run writes Pi MCP config inside plan before provider resolution/team apply | Code inspection + existing tests + manual repro | ❌ FAIL | The intended order exists when `supermemory.diagnostics` is empty. However the real dashboard setup adds an informational diagnostic, and `getPiRunnerReviewPlanRunBlockDiagnostics()` returns setup diagnostics as blockers, causing `runPiRunnerReviewPlan()` to stop at `review-plan.preflight` before config writes. |
| Token ephemeral cleaned after use/cancel | Code inspection | ✅ PASS | `app.tsx` clears `supermemorySetup.token` on dashboard install completion and cleanup/cancel paths. |
| Token not in Deck config/render/diagnostics | Code inspection + targeted tests | ✅ PASS | `writeDeckConfigAction()` writes only non-secret Supermemory fields; render and action-runner redaction tests pass. Manual repro also showed sentinel token redacted in blocker diagnostic. |
| Complete shows redacted messages/diagnostics | Code inspection + render test | ✅ PASS | `DashboardCompleteScreen` renders result messages and diagnostics through `redactSecretText()`; targeted render test passes. |
| Dead `dispatch` prop removed | Code inspection | ✅ PASS | `PiRunnerDashboardScreensProps` no longer includes `dispatch`; callsite no longer passes it. |
| Targeted/workspace tests/typecheck | Test execution | ✅ PASS | Targeted tests 127/127, workspace tests 774/774, typecheck PASS. |
| Build check | Command execution | ⚠️ WARN | No root build script exists. |

## Findings

### CRITICAL

- **Run real de Supermemory queda bloqueado por un diagnóstico informativo y no escribe Pi MCP config dentro del plan.**
  - **Files**: `apps/cli/src/tui/app.tsx`, `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts`
  - **Evidence**:
    - `buildDashboardSupermemorySetupUpdate()` stores `diagnostics: ["Supermemory token captured ephemerally for Review & Install; no Pi MCP config was written yet."]`.
    - `getPiRunnerReviewPlanRunBlockDiagnostics()` appends `setup?.diagnostics` to the blocking diagnostics list unconditionally.
    - Manual repro with the real setup output returned only:
      `[{"actionId":"review-plan.preflight","status":"failed","message":"Review & Install is blocked until Supermemory setup is complete.","diagnostics":["Supermemory token [REDACTED] ephemerally for Review & Install; no Pi MCP config was written yet."]}]`
    - The writer stub was not called, so `write-pi-mcp-config` did not execute.
  - **Reproduce**:
    1. Build dashboard Supermemory setup via `buildDashboardSupermemorySetupUpdate({ token, userId, teamId: "", orgId: "" })`.
    2. Create dashboard state with `adaptiveMemory.provider = "supermemory"` and `supermemory = setup.values`.
    3. Call `runPiRunnerReviewPlan()` with a plan containing `adaptive-memory.supermemory.pi-mcp-config` and `supermemoryToken`.
    4. Observe preflight failure before config writes/provider resolution.

### WARNING

- **No root build script**: `bun run build` fails with `Script not found "build"`. This remains a workspace limitation/pre-existing warning rather than a final-fix functional regression.

### SUGGESTION

- Add a regression test that uses the exact output from `buildDashboardSupermemorySetupUpdate()` as the dashboard state for `runPiRunnerReviewPlan()`, not a hand-written state with `diagnostics: []`.

## Open Questions

None.

## Registry Intent

- **Registry Write**: deferred
- **Intended phase**: `verify`
- **Intended status**: `failed`
- **Intended event**: `verify.final_fix.failed`
- **Artifact**: `verify-final-fix-output.md`
- **Registry Blocker**: none (deferred by instruction)
