# Archive Report: Dashboard por capacidades para Pi Runner

## Change Summary

**Change**: `pi-runner-capability-dashboard`  
**Status**: ✅ Archived  
**Archive Location**: `openspec/archive/pi-runner-capability-dashboard/`  
**Archive Artifact**: `archive.md`

### Lifecycle

- **Exploration**: 2026-05-19 — Se exploró la UX global del Pi Runner como dashboard de capacidades y los gaps de Supermemory/Engram/Mermaid/pi-hud.
- **Proposal**: 2026-05-20 — Se aprobó reemplazar el wizard lineal de paquetes por dashboard capability-first.
- **Spec + Design**: 2026-05-20 — Se definieron 31 requisitos y la arquitectura de catálogo, inventario, plan, reducer, screens y action-runner.
- **Tasks**: 2026-05-19 — 19 tareas creadas en Shared/Contracts, Backend, Frontend y Tests.
- **Apply**: 2026-05-20 — 19/19 tareas completas con rondas de fixes de foundation, backend, frontend, tests y final Supermemory boundary.
- **Verify**: 2026-05-20 — PASS WITH WARNINGS; final fix 2: targeted 131/131, workspace 778/778, typecheck pass, warning por ausencia de root build script.
- **Review**: 2026-05-20 — APPROVE en Final Fix 2; sin blockers/major/minor restantes.
- **Archive**: 2026-05-20 — Registry actualizado a archive/archived y artefactos preparados para archivo.

## Traceability Matrix

| REQ-ID | Task(s) | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-DASH-001 | 13, 14, 18 | ✅ Dashboard Pi por secciones reemplaza wizard lineal | ✅ PASS | ✅ Approved |
| REQ-DASH-002 | 2, 11, 13, 18 | ✅ Secciones Runner Capabilities, Adaptive Memory, UI helpers, Teams, Review & Install | ✅ PASS | ✅ Approved |
| REQ-DASH-003 | 10, 11, 17 | ✅ Reducer/back-stack conserva estado y selectors muestran resúmenes | ✅ PASS | ✅ Approved |
| REQ-DASH-004 | 1, 4, 13, 16, 18 | ✅ Decisiones primarias por capability; paquetes quedan acciones derivadas | ✅ PASS | ✅ Approved |
| REQ-GCAP-001 | 1, 3, 4, 13, 16, 18 | ✅ RTK/context-mode/codebase-memory configurables; Mermaid required; Pi=`pi-mermaid`; pi-hud Pi-only | ✅ PASS | ✅ Approved |
| REQ-GCAP-002 | 3, 11, 13, 16 | ✅ Estados ready/missing/manual/pending-source/blocked observables | ✅ PASS | ✅ Approved |
| REQ-GCAP-003 | 1, 4, 16, 19 | ✅ Excluye `@juicesharp/rpiv-todo` y `@juicesharp/rpiv-ask-user-question` | ✅ PASS | ✅ Approved |
| REQ-GCAP-004 | 3, 4, 7, 12, 16 | ✅ External/pending se representan como manual/pending, no auto-install listo | ✅ PASS | ✅ Approved |
| REQ-GCAP-005 | 1, 3, 4, 13, 16 | ✅ Mermaid requerido en plan; Pi usa implementationId `pi-mermaid` | ✅ PASS | ✅ Approved |
| REQ-MEM-001 | 2, 10, 13, 17, 18 | ✅ Adaptive Memory single-choice None/Engram/Supermemory | ✅ PASS | ✅ Approved |
| REQ-MEM-002 | 2, 10, 13, 17 | ✅ Default `none`; ningún provider activo por default | ✅ PASS | ✅ Approved |
| REQ-MEM-003 | 4, 10, 16, 19 | ✅ Provider None no genera acciones Engram/Supermemory | ✅ PASS | ✅ Approved |
| REQ-MEM-004 | 4, 16 | ✅ `engram-memory` solo aparece con provider Engram | ✅ PASS | ✅ Approved |
| REQ-MEM-005 | 4, 10, 17 | ✅ Cambio de provider limpia/regenera acciones del provider previo | ✅ PASS | ✅ Approved |
| REQ-MEM-006 | 4, 9, 12, 13, 16 | ✅ Supermemory separa config no secreta y token; fail-closed/redacted | ✅ PASS | ✅ Approved |
| REQ-MEM-007 | 13, 18 | ✅ UI mantiene Adaptive Memory como auxiliar; OpenSpec/Registry autoridad oficial | ✅ PASS | ✅ Approved |
| REQ-UI-001 | 1, 3, 13, 18 | ✅ Visual helpers muestran pi-hud opcional y Mermaid required con `pi-mermaid` para Pi | ✅ PASS | ✅ Approved |
| REQ-UI-002 | 1, 3, 4, 13, 16, 18 | ✅ pi-hud/Mermaid sin source quedan pending/manual y no auto-install | ✅ PASS | ✅ Approved |
| REQ-UI-003 | 1, 4, 13, 16 | ✅ pi-hud no es global required ni OpenCode; scope Pi-only | ✅ PASS | ✅ Approved |
| REQ-TEAM-001 | 13, 18 | ✅ Teams es sección separada | ✅ PASS | ✅ Approved |
| REQ-TEAM-002 | 10, 13, 17, 18 | ✅ Developer Team seleccionable desde Teams | ✅ PASS | ✅ Approved |
| REQ-TEAM-003 | 13, 14, 15, 18, 19 | ✅ Developer Team detail abre configuración de modelos existente | ✅ PASS | ✅ Approved |
| REQ-TEAM-004 | 8, 15, 19 | ✅ provider/model/thinking y compatibilidad preservados | ✅ PASS | ✅ Approved |
| REQ-TEAM-005 | 4, 11, 13, 18 | ✅ Compatibilidad/consumo de capabilities visible por team | ✅ PASS | ✅ Approved |
| REQ-TEAM-006 | 4, 11, 13, 16 | ✅ Team action refleja unresolved/manual/blocked capabilities | ✅ PASS | ✅ Approved |
| REQ-TEAM-007 | 15, 19 | ✅ Home Configure models y dashboard conservan resultado observable | ✅ PASS | ✅ Approved |
| REQ-PLAN-001 | 4, 12, 13, 16, 18 | ✅ Review Plan agrupado por automatic/manual/config/team/validation | ✅ PASS | ✅ Approved |
| REQ-PLAN-002 | 4, 16, 19 | ✅ Plan refleja selecciones y obligatorias; excluye no seleccionados/context7 | ✅ PASS | ✅ Approved |
| REQ-PLAN-003 | 3, 4, 11, 12, 13, 16, 18 | ✅ Manual/pending/blocked separados; plan no se declara listo con unresolveds | ✅ PASS | ✅ Approved |
| REQ-PLAN-004 | 10, 17 | ✅ Volver a secciones, cambiar decisiones y regenerar plan | ✅ PASS | ✅ Approved |
| REQ-PLAN-005 | 4, 12, 13, 18 | ✅ Validaciones incluidas en Review Plan | ✅ PASS | ✅ Approved |

## Main Implementation Files

- `packages/adapter-pi/src/capability-catalog.ts`
- `packages/adapter-pi/src/capability-inventory.ts`
- `packages/adapter-pi/src/capability-plan.ts`
- `packages/adapter-pi/src/installation-plan.ts`
- `packages/adapter-pi/src/required-tools.ts`
- `packages/adapter-pi/src/install-tools.ts`
- `packages/adapter-pi/src/developer-team-install.ts`
- `apps/cli/src/pi-launch-command.ts`
- `apps/cli/src/tui/pi-runner-dashboard/state.ts`
- `apps/cli/src/tui/pi-runner-dashboard/reducer.ts`
- `apps/cli/src/tui/pi-runner-dashboard/selectors.ts`
- `apps/cli/src/tui/pi-runner-dashboard/action-runner.ts`
- `apps/cli/src/tui/pi-runner-dashboard/input-handler.ts`
- `apps/cli/src/tui/screens/pi-runner-dashboard-screens.tsx`
- `apps/cli/src/tui/screens/developer-team-screens.tsx`
- `apps/cli/src/tui/app.tsx`

## Tests

- **Final Fix 2 targeted**: 131/131 pass.
- **Workspace**: 778/778 pass.
- **Typecheck**: `bunx tsc --noEmit --pretty false` pass.
- **Build**: ⚠️ `bun run build` no se puede validar porque el root workspace no define script `build`.
- Cobertura agregada: adapter catalog/inventory/plan, reducer, render, input-handler, action-runner, Developer Team preservation, Supermemory direct/fail-closed/redaction.

## Verification

**Result**: PASS WITH WARNINGS  
**Critical Findings**: 0  
**Warnings**: 1 — ausencia de root build script.

El Verify final fix 2 confirmó que el setup real de Supermemory ya no bloquea Run por diagnóstico informativo, `write-pi-mcp-config` se ejecuta antes de resolver provider/aplicar Developer Team, el token efímero real es obligatorio, cleanup/cancel invalida readiness, el writer falla sin token, tokens standalone `sk-sm-*` se redactan, tests targeted/workspace pasan y typecheck pasa.

## Review

**Rating**: APPROVE  
**Blockers**: 0  
**Major Findings**: 0  
**Minor Findings**: 0

NIT residual no bloqueante: mantener menor deuda de mantenibilidad en acoplamiento por strings/duplicación de predicados de bloqueo Supermemory entre app/controller y action-runner.

## Key Decisions Preserved

- Mermaid es capability obligatoria del runner; Pi la implementa con `pi-mermaid` y no debe confundirse con el concepto global Mermaid.
- `pi-hud` es opcional y Pi-only.
- Adaptive Memory es single-choice: `None`, `Engram`, `Supermemory`; default `None`.
- Engram/`engram-memory` solo aparece como acción técnica cuando Adaptive Memory = `Engram`.
- Supermemory no persiste credenciales antes de Review & Install; usa token efímero y escribe Pi MCP config durante Run.
- OpenSpec y Spec Registry siguen siendo autoridad oficial; Adaptive Memory es auxiliar.

## Residual Risks / Warnings

- **Warning residual**: no existe script root `build`; build formal queda en WARN aunque tests y typecheck pasan.
- **Mantenibilidad no bloqueante**: `app.tsx` sigue concentrando bastante control y existe duplicación parcial de predicados Supermemory; recomendado refactor futuro.
- **Producto/engineering futuro**: fuentes/detectores canónicos para `pi-mermaid`, OpenCode Mermaid mapping y `pi-hud` siguen como `TBD`/`pending-source` por diseño, no como blocker.

## Rollback Notes

- Rollback funcional: enrutar Home `Start installation` de Pi al wizard lineal legacy anterior y conservar `Configure models`.
- Sin migración de datos requerida: las configuraciones existentes de Deck/Pi MCP y archivos de Developer Team siguen siendo legibles.
- Si una capability pending-source causa fricción, mantenerla visible como manual/pending o deshabilitar su acción automática hasta confirmar source/detector.
- Supermemory rollback seguro: no guardar token en `.deck/config.json`; limpiar estado efímero al cancelar/salir.

## Follow-ups

- **Low**: Agregar script root `build` o documentar explícitamente que el workspace no tiene build root — Owner: Platform/Build.
- **Low**: Refactorizar predicados/diagnósticos Supermemory a códigos/severidad compartidos para evitar drift — Owner: Frontend/Integration.
- **Medium**: Confirmar fuentes y detectores canónicos para `pi-mermaid`, mapping Mermaid de OpenCode y `pi-hud` antes de permitir auto-install — Owner: Product/Engineering.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes están diferidas; no se creó ni actualizó `.deck/ai-notes/`.

### Extracted Learnings

- Ninguna nota persistida: Phase 5 no está activa.

## Artifacts

| Artifact | Path |
|---|---|
| Archive | `openspec/archive/pi-runner-capability-dashboard/archive.md` |
| State | `openspec/archive/pi-runner-capability-dashboard/state.yaml` |
| Events | `openspec/archive/pi-runner-capability-dashboard/events.yaml` |
| Proposal | `openspec/archive/pi-runner-capability-dashboard/proposal.md` |
| Spec | `openspec/archive/pi-runner-capability-dashboard/spec.md` |
| Design | `openspec/archive/pi-runner-capability-dashboard/design.md` |
| Tasks | `openspec/archive/pi-runner-capability-dashboard/tasks.md` |
| Apply Progress | `openspec/archive/pi-runner-capability-dashboard/apply-progress.md` |
| Final Verify | `openspec/archive/pi-runner-capability-dashboard/verify-final-fix-2-output.md` |
| Final Review | `openspec/archive/pi-runner-capability-dashboard/review-final-fix-2-output.md` |
