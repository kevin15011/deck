# OpenSpec Retrospective Audit — 2026-06-12

> Auditoría read-only de sesiones OpenSpec recientes del proyecto Deck.  
> Scope: detectar oportunidades de mejora en metodología, agentes, prompts, registry, tooling, runners y verificación/TDD.

## Resumen Ejecutivo

- **Modo**: `recent`
- **Cambios auditados**: 10
- **Hallazgos**: 7 — P0:0 P1:3 P2:3 P3:1
- **Patrón principal**: Deck está aceptando demasiados cierres `PASS WITH WARNINGS` sobre una baseline global rota.
- **Recomendación principal**: crear un SDD para separar verificación “change-scoped” vs “repo health baseline” y automatizar registry/audit checks.
- **Foco prioritario posterior elegido por el usuario**: `Runner install parity preflight/E2E` + mejora real de TDD/quality gates.

## Cambios Revisados

| Cambio | Estado | Fases/artifacts clave | Señales relevantes |
|---|---|---|---|
| `pi-support-parity-opencode` | archived | completo | 25+ repairs; PASS WITH WARNINGS; typecheck global preexistente |
| `model-reasoning-effort-capability` | archived | completo | full suite red; 50 failures preexistentes; typecheck global red |
| `consolidate-cognitive-doc-design` | archived | completo | PASS WITH WARNINGS por typecheck fuera de scope |
| `fix-install-upgrade-regressions` | archived/inconsistente | completo | `currentPhase: review` pero archive registrado |
| `consolidate-documentation-and-adrs` | archived | state incompleto | state no lista apply/verify/review artifacts |
| `add-critical-git-safety-rule` | archived | completo | PASS WITH WARNINGS por suite/typecheck global |
| `specialist-team-methodology` | archived | completo | buen patrón: tests focused claros, 0 warnings |
| `fix-provider-engram-leak` | explore completed | exploration only | causa raíz clara, no proposal/spec/tasks |
| `fix-adaptive-memory-heading-duplication` | explore completed | exploration only | causa raíz clara, no proposal/spec/tasks |
| `fix-supermemory-userid-validation` | exploring + explore completed | exploration only | state contradictorio; causa raíz clara |

## Hallazgos Priorizados

### P1

#### 1. Baseline global rota normalizada como warning

- **Categoría**: Testing/Verification Gap
- **Acción recomendada**: requiere SDD
- **Evidencia**:
  - `pi-support-parity-opencode/verify-report.md:10`: typecheck global falla por errores preexistentes.
  - `model-reasoning-effort-capability/verify-report.md:8-13`: 459/460 focused, full suite 2664/2714; 50 failures tratados como preexistentes.
  - `fix-install-upgrade-regressions/verify-report.md:9`: full suite 2537/2587, 50 failed preexistentes.
  - `add-critical-git-safety-rule/archive-report.md:41-43`: 52 failures preexistentes + typecheck fallando.
- **Inferencia**: Verify separa scope razonablemente, pero el sistema no fuerza ownership ni cierre de la baseline rota.
- **Impacto**: riesgo de ocultar regresiones reales bajo “pre-existing”.
- **Recomendación**: SDD para baseline health ledger: dueño, fingerprint de fallos conocidos, diff automático entre fallos previos/nuevos y gate separado.

#### 2. Repair loops excesivos en Pi parity

- **Categoría**: Workflow Bug / Automation Opportunity
- **Acción recomendada**: requiere SDD
- **Evidencia**:
  - `pi-support-parity-opencode/archive-report.md:13`: Apply duró 2026-06-04 a 2026-06-09 con `25+ repair passes`.
  - `pi-support-parity-opencode/archive-report.md:51`: advisory para E2E automatizado de TUI.
  - `pi-support-parity-opencode/archive-report.md:64-66`: repairs recurrentes en MCP config persistence y stale package replacement.
- **Inferencia**: faltaron preflights/E2E contract checks antes de Apply o en primeros batches.
- **Impacto**: alto costo de rework y riesgo de fatiga metodológica.
- **Recomendación**: SDD para `runner install parity preflight`: validar MCP persistence, stale package replacement, nested skills cleanup y TUI install path antes de cerrar Apply.

#### 3. Exploraciones con causa raíz clara quedan abiertas sin lifecycle

- **Categoría**: Methodology Gap
- **Acción recomendada**: requiere SDD
- **Evidencia**:
  - `fix-provider-engram-leak/state.yaml:1-3`: `phase: explore`, `status: completed`, solo `exploration.md`.
  - `fix-adaptive-memory-heading-duplication/state.yaml:1-4`: `state: explore`, `status: completed`, solo exploration.
  - `fix-supermemory-userid-validation/state.yaml:2-10`: `status: exploring`, pero `explore.status: completed`.
  - `fix-supermemory-userid-validation/exploration.md:7-14`: root cause exacta encontrada.
- **Inferencia**: el flujo no distingue bien “exploración cerrada como diagnóstico” vs “cambio pendiente de implementación”.
- **Impacto**: hallazgos críticos pueden quedar como conocimiento inerte.
- **Recomendación**: añadir estado oficial tipo `diagnosed`, `deferred`, `converted-to-change`, `closed-no-action`.

### P2/P3

#### 4. Schema drift en `state.yaml` dificulta auditoría automática

- **Categoría**: Registry Issue
- **Acción recomendada**: requiere SDD
- **Evidencia**:
  - `fix-install-upgrade-regressions/state.yaml:2-3`: `currentPhase: review`, `status: completed`.
  - `fix-install-upgrade-regressions/state.yaml:59-65`: archive registrado como `status: archived`.
  - `fix-adaptive-memory-heading-duplication/state.yaml:1`: usa `state: explore`, no `phase`.
  - `fix-supermemory-userid-validation/state.yaml:2-3`: `status: exploring`, `current_phase: explore`, aunque explore completado.
- **Inferencia**: no hay contrato único de registry suficientemente validado.
- **Impacto**: auditorías, dashboards y recovery tienen que soportar múltiples dialectos.
- **Recomendación**: definir schema canónico + validator read-only.

#### 5. Registry/artifact alignment incompleto en cambio archivado

- **Categoría**: Registry Issue
- **Acción recomendada**: fix directo o SDD pequeño
- **Evidencia**:
  - `consolidate-documentation-and-adrs/state.yaml:37-55` lista exploration/proposal/spec/design/tasks/archive-report.
  - No lista `apply-progress.md`, `verify-report.md`, `review-report.md`, aunque existen y fueron usados.
- **Inferencia**: el archive cerró correctamente a nivel narrativo, pero el registry no preserva todo el lineage.
- **Impacto**: trazabilidad incompleta para auditorías futuras.
- **Recomendación**: quick validator que compare artifacts existentes vs artifacts registrados.

#### 6. Precondiciones conocidas llegan hasta Apply/Verify

- **Categoría**: Methodology Gap
- **Acción recomendada**: requiere SDD
- **Evidencia**:
  - `consolidate-documentation-and-adrs/exploration.md:48-73`: Phase 1 puede no estar completa; riesgo de parsing por backticks.
  - `consolidate-documentation-and-adrs/tasks.md:250`: Task phase tuvo que actualizar registry con fases missing.
  - `consolidate-documentation-and-adrs/apply-progress.md:18-22`: se corrigió `using-agent-skills` missing y escaping.
- **Inferencia**: Explorer detecta riesgos útiles, pero no siempre se convierten en gates duros antes de Apply.
- **Impacto**: rework evitable.
- **Recomendación**: checklist formal “precondition closure” entre Exploration→Proposal/Tasks.

#### 7. Buenas prácticas existen pero no están convertidas en automatización recurrente

- **Categoría**: Automation Opportunity
- **Acción recomendada**: fix directo
- **Evidencia**:
  - `specialist-team-methodology/verify-report.md:34`: focused orchestrator tests 201 pass / 0 fail.
  - `specialist-team-methodology/archive-report.md:53-58`: 0 warnings, 0 blockers.
- **Inferencia**: este cambio muestra un patrón sano: scope claro, invariants tests, focused verification.
- **Impacto**: oportunidad de usarlo como plantilla para cambios de prompts/metodología.
- **Recomendación**: crear “golden audit checklist” basado en este cambio.

## Patrones Recurrentes

| Patrón | Frecuencia | Cambios afectados | Implicación |
|---|---:|---|---|
| `PASS WITH WARNINGS` por typecheck/suite global rota | 5/10 | pi parity, model reasoning, cognitive doc, git safety, install regressions | falta baseline health separada |
| Registry schema heterogéneo | 4/10 visibles | fix-install, adaptive heading, supermemory userid, docs/adrs | automation frágil |
| Exploration-only con diagnóstico claro | 3/10 | provider leak, heading duplication, userid validation | falta lifecycle para diagnósticos |
| Rework/repairs por preconditions o contracts | 3/10 | pi parity, docs/adrs, model reasoning | gates tempranos insuficientes |
| Buen patrón focused tests + invariants | 1 destacado | specialist-team-methodology | conviene convertir en plantilla |

## Quick Wins

- **Registry auditor read-only** — script que reporte artifacts ausentes, artifacts no registrados y dialectos phase/status; acción: fix directo.
- **Known-failures ledger** — artifact/config que fingerprintée fallos globales aceptados como preexistentes; acción: requiere SDD si se integra como gate.
- **Exploration closure field** — convención mínima: `next_action: proposal|deferred|closed|needs-user`; acción: requiere SDD pequeño.
- **Golden prompt-methodology checklist** — extraer de `specialist-team-methodology`; acción: documentación/fix directo.

## Cambios Candidatos a SDD

| Propuesta | Por qué requiere SDD | Prioridad |
|---|---|---|
| Baseline Health Ledger para Verify | afecta metodología, verify gates, reporting y possibly CI | alta |
| Registry schema canonical + validator | afecta OpenSpec registry/recovery/dashboard | alta |
| Exploration lifecycle states | afecta workflow SDD y triage | media |
| Runner install parity preflight/E2E | afecta adapters, TUI, install tooling y runners | alta |
| Precondition closure gate | afecta Explorer→Proposal→Tasks handoff | media |

## Foco Recomendado para el SDD Siguiente

El usuario indicó especial interés en **Runner install parity preflight/E2E** y en mejorar la implementación real de **TDD/quality gates**.

Recomendación de alcance inicial:

- Incluir como núcleo:
  - runner install parity preflight/E2E
  - contract tests runner-agnostic
  - TDD enforcement real para Apply/Verify
  - separación focused tests vs baseline failures
- Evaluar como parte del mismo SDD o follow-up:
  - baseline health ledger
  - registry validator read-only
  - precondition closure gate
  - exploration lifecycle states

## Preguntas Abiertas

- ¿Debe `PASS WITH WARNINGS` poder archivar cambios cuando la suite global está roja?
- ¿Dónde debe vivir el ledger de fallos preexistentes: OpenSpec, CI artifact, repo config o dashboard?
- ¿Las exploraciones `fix-provider-*` y `fix-supermemory-*` ya fueron implementadas en otros cambios o siguen pendientes?
- ¿Debe normalizarse retroactivamente `state.yaml` histórico o sólo validar nuevos cambios?
- ¿El audit recurrente debe producir artifact OpenSpec propio o permanecer como reporte conversacional?

## Nota de Auditoría

La auditoría original se ejecutó en modo solo lectura. No se modificaron OpenSpec, código, prompts, skills, configuración ni adapters durante el análisis.
