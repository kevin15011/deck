# Apply Backend Tests Output: pi-runner-capability-dashboard

## Alcance implementado

- Task 16 completo.
- Task 19: solo parte backend completa.
- No se tocó frontend render/reducer.

## Archivos modificados/creados

- `packages/adapter-pi/src/capability-catalog.test.ts` — creado; cubre catálogo, exclusiones, Mermaid required/pi-mermaid y pi-hud Pi-only.
- `packages/adapter-pi/src/capability-inventory.test.ts` — creado; cubre statuses ready/manual/pending-source/blocked, Mermaid Pi vs OpenCode, pi-hud Pi-only y no-ready para detectores/sources no confirmados.
- `packages/adapter-pi/src/capability-plan.test.ts` — creado; cubre Adaptive Memory none/engram/supermemory, Engram condicional, readiness manual/pending, prerequisites, excluded packages, Mermaid/pi-mermaid, Developer Team pending por Mermaid, y regresión `dashboardMemoryProvider` comparable con `memoryProvider`.
- `openspec/changes/pi-runner-capability-dashboard/apply-progress.md` — actualizado.
- `openspec/changes/pi-runner-capability-dashboard/state.yaml` — actualizado.
- `openspec/changes/pi-runner-capability-dashboard/events.yaml` — actualizado.
- `openspec/changes/pi-runner-capability-dashboard/apply-backend-tests-output.md` — creado.

## Verificación

- Targeted backend tests: pass
  - `bun test packages/adapter-pi/src/capability-catalog.test.ts packages/adapter-pi/src/capability-inventory.test.ts packages/adapter-pi/src/capability-plan.test.ts packages/adapter-pi/src/developer-team-install.test.ts`
  - Resultado: 58 pass / 0 fail.
- Typecheck: pass
  - `bunx tsc --noEmit --pretty false`
- Build: fail/warn
  - `bun run build`
  - Bloqueo no causado por este cambio: no existe script `build` en `package.json`.

## Blockers

- Ninguno para Task 16 ni para la parte backend de Task 19.
- Build sigue bloqueado por ausencia de script `build` del workspace.
