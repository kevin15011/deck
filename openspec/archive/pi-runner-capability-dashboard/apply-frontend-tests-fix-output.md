# Apply Frontend Tests Fix Output: pi-runner-capability-dashboard

## Resumen

Estado: ✅ completado.

Scope limitado a findings de `review-tests-output.md`. Se agregaron/fortalecieron tests frontend y cambios mínimos de testability/seguridad en UI/action-runner.

## Cambios implementados

- Supermemory/redaction dashboard-specific:
  - `action-runner` ahora expone diagnóstico fail-closed y bloquea `runPiRunnerReviewPlan` si Supermemory no tiene `configured`, `userId` o token Pi MCP.
  - Tests verifican que token sentinela no aparece en plan/resultados/raw/diagnostics, y que Deck config contiene solo identidad no secreta.
  - Render del dashboard redacta texto sensible en estado/diagnósticos/resultados visibles.
- Preservación de model config:
  - Test de regresión compara frontmatter generado por `buildDeveloperTeamInstallPlan` para ruta Home vs dashboard con los mismos assignments.
  - Cubre thinking explícito (`openai-codex/gpt-5.5` → `thinking: high`) y modelo sin thinking soportado (`opencode-go/kimi-k2.6` → `thinking: off`).
- Input/handler mapping:
  - Nuevo helper testeable `input-handler.ts` para mapear cursor/screen a efectos críticos.
  - Tests cubren dashboard → sección, `pi-hud` toggle, Supermemory abre setup y bloquea run, Developer Team detail/back, Review & Install blocked/unblocked.

## Archivos cambiados

- `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts`
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts`
- `apps/cli/src/tui/pi-runner-dashboard/input-handler.ts`
- `apps/cli/src/tui/pi-runner-dashboard/input-handler.test.ts`
- `apps/cli/src/tui/pi-runner-dashboard/render.test.tsx`
- `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx`
- `apps/cli/src/tui/screens/developer-team-screens.test.tsx`
- `openspec/changes/pi-runner-capability-dashboard/apply-progress.md`
- `openspec/changes/pi-runner-capability-dashboard/state.yaml`
- `openspec/changes/pi-runner-capability-dashboard/events.yaml`

## Verificación

- Frontend tests targeted: ✅ pass
  - `bun test apps/cli/src/tui/pi-runner-dashboard/action-runner.test.ts apps/cli/src/tui/pi-runner-dashboard/input-handler.test.ts apps/cli/src/tui/pi-runner-dashboard/reducer.test.ts apps/cli/src/tui/pi-runner-dashboard/render.test.tsx apps/cli/src/tui/screens/developer-team-screens.test.tsx`
  - Resultado: 27 pass / 0 fail.
- Typecheck: ✅ pass
  - `bunx tsc --noEmit --pretty false`
- Build: ⚠️ warn/fail esperado
  - `bun run build` falla porque no existe script `build` en el workspace.

## Blockers

Ninguno. El único warning es el build script ausente ya reportado previamente.
