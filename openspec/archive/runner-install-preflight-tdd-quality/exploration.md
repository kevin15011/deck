# Exploration: runner-install-preflight-tdd-quality

## Resumen Ejecutivo

El SDD propuesto aborda dos dolores conectados detectados en la auditoría retrospectiva (2026-06-12):

1. **Runner install parity preflight / E2E ausente**: el cambio `pi-support-parity-opencode` requirió 25+ repair passes porque faltaron preflights automáticos que validen MCP persistence, stale package replacement, nested skills cleanup y el TUI install path antes de cerrar Apply.
2. **TDD / quality gates débiles**: `strict_tdd: true` en `openspec/config.yaml` no se traduce en tests E2E reales; la suite global tiene ~50-64 fallos preexistentes que se normalizan como `PASS WITH WARNINGS`, ocultando regresiones.

La recomendación es un **SDD núcleo** centrado en preflight checks + E2E-ish tests + contrato runner-agnostic, con **follow-ups** para baseline health ledger, registry validator, precondition closure gate y exploration lifecycle states.

## Evidencia de Auditoría

- **P1 — Baseline global rota normalizada como warning**: `pi-support-parity-opencode/verify-report.md:10` (typecheck global preexistente), `model-reasoning-effort-capability/verify-report.md:8-13` (50 failures preexistentes), `fix-install-upgrade-regressions/verify-report.md:9` (50 failed preexistentes), `add-critical-git-safety-rule/archive-report.md:41-43` (52 failures + typecheck). Inferencia: Verify separa scope razonablemente, pero no fuerza ownership ni cierre de la baseline rota.
- **P1 — Repair loops excesivos en Pi parity**: `pi-support-parity-opencode/archive-report.md:13` (25+ repair passes), `archive-report.md:51` (advisory E2E automatizado TUI), `archive-report.md:64-66` (repairs recurrentes en MCP config persistence y stale package replacement). Inferencia: faltaron preflights/E2E contract checks antes de Apply o en primeros batches.
- **P2 — Schema drift registry**: `fix-install-upgrade-regressions/state.yaml:2-3` (`currentPhase: review` + `status: completed`), `fix-adaptive-memory-heading-duplication/state.yaml:1` (`state: explore` en lugar de `phase`), `fix-supermemory-userid-validation/state.yaml:2-3` (`status: exploring` aunque `explore.status: completed`).
- **P2 — Registry/artifact alignment incompleto**: `consolidate-documentation-and-adrs/state.yaml:37-55` no lista `apply-progress.md`, `verify-report.md`, `review-report.md` aunque existen.
- **P3 — Buenas prácticas no automatizadas**: `specialist-team-methodology/verify-report.md:34` (focused tests 201 pass / 0 fail), `archive-report.md:53-58` (0 warnings, 0 blockers). Patrón sano que debería ser plantilla.

## Mapa de Componentes / Código / Artifacts Afectados

### Código producto (lectura/impacto)
- `packages/adapter-pi/src/preflight.ts` — preflight básico (versión, config dir). Punto de inserción para preflight checks adicionales.
- `packages/adapter-opencode/src/preflight.ts` — preflight básico OpenCode.
- `apps/cli/src/tui/app.tsx` — efectos de preflight (`pi-preflight-checking`, `opencode-preflight-checking`), efecto de install (`install-progress`), integración con `runRunnerReviewPlan`.
- `apps/cli/src/tui/runner-dashboard/action-runner.ts` — action runner genérico; gating de MCP config por failed installs; validación de ejecutables en PATH (`checkExecutableExists`).
- `apps/cli/src/tui/runner-dashboard/__tests__/action-runner.test.ts` — tests unitarios de install path regressions (REQ-INSTALL-*). Deberían convertirse en contract tests runner-agnostic.
- `packages/adapter-pi/src/install-tools.ts` — lógica de instalación Pi; `installSharedBinary` con reuse check; `installInternalRunnerPackages`; `installSerena`.
- `packages/adapter-pi/src/runner-adapter.ts` — `runAction` que escribe MCP config, instala paquetes, aplica team bundle. Punto de integración para preflight checks.
- `packages/adapter-pi/src/developer-team-install.ts` — `cleanupLegacySddAgentFiles`, `cleanupNestedSkillDirectories`, `applyDeveloperTeamInstall`, `verifyDeveloperTeamInstall`.
- `packages/adapter-pi/src/settings-merge.ts` — `mergeSettingsPackages` (stale `@dreki-gg/pi-context7` → `@upstash/context7-mcp`).
- `packages/adapter-pi/src/pi-mcp-config.ts` — `writeGatedLocalMcpConfig`, `writeContextModeMcpConfig`, `writeCodebaseMemoryMcpConfig`, etc. (healthcheck gating ya existe pero no se invoca en preflight).
- `packages/core/src/runner-capability-registry.ts` — registry canónico; tipos de mapping, categorías, estados.
- `packages/core/src/runner-capability-parity.ts` — resolver de parity; `resolveRunnerParity`, `getParityGaps`.
- `packages/core/src/runner-capability-parity-e2e.test.ts` — tests E2E de parity (18 escenarios), pero no cubren flujo TUI completo.

### OpenSpec / Config
- `openspec/config.yaml` — `testing.strict_tdd: true`, `integration.available: false`, `e2e.available: false`. Debe actualizarse para reflejar capas reales de testing.
- `openspec/changes/pi-support-parity-opencode/` — archive, apply-progress, verify-report (evidencia de repairs).
- `openspec/changes/fix-install-upgrade-regressions/` — verify-report (evidencia de pre-existing failures).
- `openspec/changes/specialist-team-methodology/` — verify-report (patrón sano).

### Posibles nuevos archivos
- `packages/adapter-pi/src/preflight-checks.ts` (o extensión de `preflight.ts`) — validación estructurada de MCP config, stale packages, nested skills, antes de Apply.
- `apps/cli/src/tui/__tests__/e2e-install.test.tsx` (o similar) — tests E2E-ish con `renderToString` + mock file system que simulen flujo TUI completo.
- `packages/core/src/runner-install-contract.test.ts` — contract tests runner-agnostic para `runRunnerReviewPlan`.
- `openspec/baseline-health.yaml` (o artifact similar) — ledger de fallos preexistentes con fingerprint.
- `scripts/validate-registry.ts` — validator read-only de schema canónico + alignment de artifacts.

## Análisis de TDD Actual vs Deseado

### Actual
- `strict_tdd: true` en config, pero sin mecanismo de gating real.
- Tests unitarios abundantes (~70 archivos), focused tests usados en verify.
- `integration` y `e2e` marcados como `available: false` en config.
- Full suite con ~50-64 fallos preexistentes; se aceptan como `PASS WITH WARNINGS`.
- No hay ledger de fallos conocidos; diff manual entre previo/nuevo es inexistente.
- No hay tests E2E que simulen el flujo TUI completo (Ink + file system + adapter actions).

### Deseado
- **Preflight tests**: antes de Apply, ejecutar checks automatizados que validen MCP config, stale packages, nested skills, etc. Deben fallar primero, luego pasar tras el fix.
- **E2E-ish tests**: usar `renderToString` de Ink + mock file system (patrón ya usado en `render.test.tsx`) para simular flujo de instalación completo.
- **Contract tests runner-agnostic**: `runRunnerReviewPlan` con dependencias mock debe probarse para ambos runners (Pi y OpenCode) sin duplicar lógica.
- **Baseline health ledger**: artifact que registre fingerprint de fallos preexistentes por cambio; Verify debe comparar diff en lugar de warnings genéricas.
- **Registry validator**: script read-only que valide schema de `state.yaml` y alineación de artifacts.
- **Precondition closure gate**: checklist formal entre Explorer y Proposal/Tasks.

## Opciones de Alcance

### Opción A: Núcleo + Follow-ups (Recomendada)
- **Núcleo (este SDD)**:
  - Runner install parity preflight / E2E-ish tests.
  - Contract tests runner-agnostic para action-runner.
  - Actualización de `openspec/config.yaml` (capas integration/e2e, strict_tdd real).
  - Baseline health ledger mínimo (artifact YAML con fingerprint de fallos preexistentes).
- **Follow-ups (SDDs separados o tareas)**:
  - Registry schema canonical + validator (`scripts/validate-registry.ts`).
  - Precondition closure gate (checklist formal entre fases).
  - Exploration lifecycle states (estados `diagnosed`, `deferred`, `closed-no-action`).

**Pros**: entrega valor rápido en el foco prioritario (preflight/E2E + TDD); reduce riesgo de scope creep; follow-ups pueden paralelizarse.  
**Cons**: requiere coordinación para no perder follow-ups.

### Opción B: Cambio Integrado
- Incluir los 5 candidatos en un solo SDD grande.

**Pros**: visión completa, sin riesgo de perder follow-ups.  
**Cons**: alto riesgo de scope creep, duración larga, fatiga metodológica; el usuario ya experimentó 25+ repairs en Pi parity.

### Opción C: Secuencia de SDDs Separados
- SDD 1: Baseline health ledger.
- SDD 2: Registry validator.
- SDD 3: Runner install parity preflight/E2E.
- SDD 4: Precondition closure gate.
- SDD 5: Exploration lifecycle states.

**Pros**: cada SDD es manejable.  
**Cons**: el usuario quiere atacar el foco prioritario ahora; secuencia lineal retrasa el valor principal.

## Recomendación Explícita

**Elegir Opción A: núcleo + follow-ups.**

Justificación:
- El usuario expresó especial interés en `Runner install parity preflight/E2E` y mejora real de TDD/quality gates.
- La evidencia de auditoría muestra que los 25+ repairs de Pi parity se deben a la falta de preflights/E2E, no a un problema de diseño profundo.
- Un SDD integrado (Opción B) tiene alto riesgo de replicar la fatiga de repairs.
- La Opción C retrasa el valor prioritario.

El núcleo debe incluir:
1. **Preflight checks** estructurados (`inspectPiEnvironment` extendido o nuevo módulo) que validen:
   - MCP config persistence (existencia y contenido de `~/.pi/agent/mcp.json`).
   - Stale package replacement (ausencia de `@dreki-gg/pi-context7` en `settings.json`).
   - Nested skills cleanup (ausencia de `~/.pi/agent/skills/SKILL.md/SKILL.md`).
   - Legacy SDD files cleanup (ausencia de `sdd-*.md` en `~/.pi/agent/agents/`).
   - Binary usability de shared binaries (`rtk`, `context-mode`, `codebase-memory-mcp`, `serena`).
2. **E2E-ish tests** en `apps/cli/src/tui/__tests__/e2e-install.test.tsx` (o similar) que usen `renderToString` + mock file system para simular:
   - Flujo TUI de Pi: preflight → packages → review & install → verificación de artifacts.
   - Flujo TUI de OpenCode: preflight → install → verificación.
3. **Contract tests runner-agnostic** en `packages/core/src/runner-install-contract.test.ts` que prueben `runRunnerReviewPlan` con mock dependencies para ambos runners.
4. **Baseline health ledger** en `openspec/baseline-health.yaml` (o similar) que registre:
   - Número de tests, pass/fail por suite.
   - Typecheck errors (count + files afectados).
   - Diff entre cambios (previo vs nuevo) para detectar regresiones.
5. **Actualización de `openspec/config.yaml`**:
   - `integration.available: true` (tool: `bun test` + `ink` render mocks).
   - `e2e.available: true` (tool: `bun test` + `ink` + mock file system).
   - `strict_tdd` con gating real (ej: bloqueo de Apply si preflight tests fallan).

## Riesgos y Mitigaciones

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Ink/Bun E2E tests flaky o lentos | Medio | Usar `renderToString` para tests estáticos; evitar interacciones reales de teclado. Inyectar mock file system para evitar I/O real. |
| Preflight checks rompen flujo TUI existente | Alto | Implementar preflight checks como funciones puras con dependencias inyectables (mismo patrón usado en `install-tools.ts` y `developer-team-install.ts`). Integrar gradualmente en `app.tsx` sin modificar lógica de render. |
| Baseline health ledger genera ruido | Medio | Comenzar con ledger manual (artifact YAML) antes de automatizar diff. Limitar a suites focused del cambio. |
| Scope creep hacia registry validator / lifecycle states | Medio | Enforce boundary: núcleo solo preflight/E2E/TDD; follow-ups con sus propios SDDs. |
| Tests de contract runner-agnostic duplican lógica de `action-runner.test.ts` | Bajo | Refactor `action-runner.test.ts` para que use mock dependencies genéricas en lugar de mocks específicos de Pi/OpenCode. |

## Open Questions / Blockers

- **¿Dónde exactamente viven los preflight checks?** ¿Extender `packages/adapter-pi/src/preflight.ts` o crear `packages/adapter-pi/src/preflight-checks.ts`? El primero es más simple; el segundo permite separar concerns.
- **¿Tenemos mock file system reutilizable?** Los tests existentes usan inyección de `readdirSync`, `unlinkSync`, `existsSync`, etc. Es suficiente, pero conviene estandarizar un helper `createMockFileSystem()`.
- **¿Cuál es la lista exacta de fallos preexistentes actuales?** Necesitamos ejecutar `bun test` y `bunx tsc --noEmit` para capturar el fingerprint baseline de este momento. La auditoría reporta ~50-64, pero no documenta los nombres exactos.
- **¿Dónde viven los E2E tests?** `apps/cli/src/tui/__tests__/e2e-install.test.tsx` parece correcto para flujo TUI, mientras que `packages/adapter-pi/src/e2e-install.test.ts` sería para lógica de adapter sin UI. Recomendación: ambos, pero con scope claro.
- **¿Es `bun test` + Ink estable en CI?** `render.test.tsx` ya usa `renderToString` y pasa localmente. Falta confirmar en CI (si existe). No hay evidencia de inestabilidad.
- **¿Debe `PASS WITH WARNINGS` poder archivar cambios?** Pregunta abierta de la auditoría. Si el baseline health ledger se implementa, `PASS WITH WARNINGS` debería requerir justificación documentada en el ledger.

## Propuesta de Siguiente Fase: Proposal

**Listo para Proposal: Sí.**

El Explorer ha identificado:
- Scope claro (núcleo + follow-ups).
- Archivos afectados y puntos de inserción.
- Riesgos y mitigaciones.
- Open questions resolvibles en Proposal (especialmente fingerprint baseline exacto).

La Proposal debería:
1. Definir el scope del núcleo (preflight checks + E2E-ish tests + contract tests + baseline ledger + config update).
2. Identificar follow-ups con owners y orden.
3. Incluir rollback plan: si preflight checks rompen el flujo TUI, revertir a `inspectPiEnvironment` original.
4. Especificar el fingerprint baseline exacto (requiere ejecutar `bun test` y `bunx tsc --noEmit` en el momento de Proposal).
5. Definir acceptance criteria: "Apply debe pasar preflight tests antes de cerrar"; "Verify debe mostrar diff de baseline ledger".
