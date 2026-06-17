# Review Report FINAL: Sincronizar update/upgrade desde la TUI y CLI

## Summary

**Overall Rating**: APPROVE
**Scope**: general (arquitectura, backend, frontend, integración)
**Files Reviewed**: 4 archivos productivos modificados post-review anterior + contexto completo de 12 archivos del change
**Modo**: Registry-deferred (solo artifact, sin state.yaml/events.yaml)
**Base**: Re-review final sobre review anterior (APPROVE WITH CHANGES) + cambios posteriores (CLI contract fix + TUI type fixes)

---

## Cambios Post-Review Anterior Verificados

### 1. `runUpgrade` dual-call / compatibilidad (`apps/cli/src/upgrade-command/index.ts`)

**Contexto**: El contrato de `runUpgrade` estaba roto — tests y `main.tsx` llamaban `runUpgrade(["--version"])` (array) pero la función esperaba 3 parámetros posicionales.

**Fix aplicado**: Signature dual con union type `argsOrCurrentVersion: string[] | string`.

**Verificación de seguridad — paths no seguros**:

| Path | Guard | Estado |
|---|---|---|
| `--version` flag | Líneas 128-139: `parseArgs(args)` → `flags.version === true` → `return 0` inmediato | ✅ No workflow, no descarga, solo imprime versión |
| `downloadUrl` vacío | Líneas 173-177: `if (!latestRelease.downloadUrl)` → `return 0` con mensaje | ✅ No se intenta descarga con URL vacía |
| `binaryPath` vacío | Líneas 163-166: `if (!binaryPath)` → `return 1` con error | ✅ No se ejecuta workflow sin path |
| `latestRelease` null/undefined | Líneas 168-171: `if (!latestRelease)` → `return 0` con mensaje | ✅ No se continúa sin release |
| Workflow falla | Líneas 214-218: catch loggea `workflowErr.message` + fallback legacy | ✅ Error visible, no silencioso |
| Sync para todos los installKind | Líneas 184-213: `runSelfUpgradeWorkflow` sin guardia `installKind` | ✅ Sync cuando corresponde (incluye Homebrew vía content sync) |

**Conclusión**: No se reintroducen paths inseguros. Los guards de early-exit son correctos y están en el orden adecuado (versión → binary path → release → downloadUrl → workflow).

### 2. TUI type fixes (`apps/cli/src/tui/app.tsx`, `upgrade-progress-screen.tsx`)

**Contexto**: Type fixes sin cambio de comportamiento — alinear tipos con el union `UpgradeProgressStatus` que incluye `partial_failure`.

**Verificación**:

| Elemento | Estado | Evidence |
|---|---|---|
| Tipo `partial_failure` definido | ✅ | `upgrade-progress-screen.tsx` línea 26: `{ kind: "partial_failure"; failedRunners: string[]; succeededRunners: string[]; backupId?: string; reason: string }` |
| Mapeo `app.tsx` → `partial_failure` | ✅ | Líneas 1119-1144: `result.status === "partial_failure"` → `setUpgradeProgress({ kind: "partial_failure", ... })` |
| `PartialFailureBody` componente | ✅ | Líneas 95-123: Renderiza runners succeeded (✓) y failed (✗) con colores |
| Config/registry reales no alterados | ✅ | Líneas 1072-1100: `createDefaultAdapterRegistry()`, `readDeckConfig()`, `readGlobalDeckConfig()` — sin cambios post-review |
| `rolled_back` mapping preservado | ✅ | Líneas 1104-1117: Mapping correcto con reason detallado |

**Conclusión**: Los type fixes son cosméticos a nivel de tipos — no alteran config, registry, ni el flujo de partial_failure/rolled_back.

---

## Ratings by Dimension (Actualización Final)

| Dimensión | Rating | Notas |
|---|---|---|
| Arquitectura | ✅ Strong | Sin cambios post-review. Workflow compartido TUI/CLI bien delineado. |
| Seguridad | ✅ Strong | Guards de early-exit en `runUpgrade` correctos. No download con URL vacía. No workflow sin binary path. Checksum SHA-256 pre-replace. Backup diferido post-verify. |
| Escalabilidad | ✅ Strong | Sin riesgos. |
| Mantenibilidad | ⚠️ Adequate | Dual-call signature funcional pero con inconsistencia de tipos (ver MINOR). `partial_failure` Enter handling faltante (ver MINOR). |
| Calidad de Código | ⚠️ Adequate | Código legible. JSDoc adecuado. MINOR pendientes no bloqueantes. |
| Backend | ✅ Strong | CLI delega correctamente al workflow compartido. |
| Frontend | ✅ Strong | TUI type fixes correctos. `partial_failure` diferenciado de `rolled_back`. |
| Integración | ✅ Strong | Contratos alineados entre CLI, TUI, y orchestrator. |
| Economía / Juicio Crítico | ✅ Strong | Sin código innecesario añadido post-review. |

---

## Verify PASS WITH WARNINGS — Aceptabilidad

| Criterio | Resultado | Justificación |
|---|---|---|
| Focused tests | ✅ 111/111 pass | Cobertura completa de orchestrator, binary, sync, backup, rollback, runner-sync, CLI runUpgrade, Doctor, TUI |
| Typecheck global | ⚠️ 99 errores | **Todos** clasificados como `baseline_structural`. `introduced_by_change = 0` |
| Typecheck archivos tocados | ⚠️ 35 errores en `app.tsx` | Estructurales/preexistentes. No introducidos por este change |
| PASS WITH WARNINGS | ✅ Aceptable | El criterio de corte es correcto: ningún error TypeScript fue introducido por este change. Los 99 errores baseline son deuda estructural preexistente que no debe bloquear este cambio |

**Decisión**: PASS WITH WARNINGS es aceptable. No se abren findings por baseline estructural no introducido por este change.

---

## Findings Previos — Estado Confirmado

### BLOCKER (todos anteriores) → ✅ Confirmados Resueltos

1. CLI Homebrew omite content sync → ✅ Workflow para todos los installKind
2. Typecheck `buildBinaryUpgradeCheck` → ✅ Tipo `DoctorBinaryResult` correcto
3. Typecheck `buildDefaultOrchestratorDeps` → ✅ DI correcta
4. `skipped_external` faltante → ✅ Añadido al union type

### MAJOR (todos anteriores) → ✅ Confirmados Resueltos

1. `collectRunnerBackupTargets` falla silenciosamente → ✅ `console.error` + continuar
2. `replaceBinary` elimina backup inline → ✅ Hook `cleanupBinaryBackup` diferido post-verify
3. TUI colapsa `partial_failure` en `rolled_back` → ✅ Tipo separado + `PartialFailureBody`
4. CLI catch block silencia error → ✅ `console.warn` con message

---

## Findings Nuevos (Post-Review)

### MINOR

- **Frontend — `partial_failure` no incluido en terminal state handler de Enter**
  - **File**: `apps/cli/src/tui/app.tsx` — líneas 1824-1828
  - **Evidence**: El handler de Enter para `upgrade-progress` solo verifica `kind === "completed" | "rolled_back" | "failed"`. El estado `partial_failure` (añadido en Fix 2.1) no está en la condición. `PartialFailureBody` muestra "Press Enter to return to Home" pero Enter no navega.
  - **Recommendation**: Añadir `upgradeProgress.kind === "partial_failure"` a la condición de terminal state en línea 1824-1827. Fix de una línea.

- **Mantenibilidad — Inconsistencia de tipos en dual-call `runUpgrade`**
  - **File**: `apps/cli/src/upgrade-command/index.ts` — líneas 97, 119
  - **Evidence**: El parámetro `latestReleaseOrCurrentVersion` está tipado como `string` (línea 97) pero la línea 119 verifica `typeof === "object"`. La rama programática nunca produce un `ReleaseInfo` porque el tipo declarado es `string`. En práctica, ningún caller usa la signature programática (main.tsx y tests usan array), así que es código muerto type-inconsistente.
  - **Recommendation**: Si la signature programática se mantiene, corregir tipo a `string | ReleaseInfo`. Si no se usa, considerar simplificar a signature única. No bloqueante — funcionalmente inofensivo.

### NIT (anteriores, sin cambio)

- Número mágico `800` en TUI ticker (línea ~1065) — extraer a constante.
- Placeholders Doctor `globalConfigExists`/`bundledSkillCount` — documentar si son definitivos.

---

## Findings Advisory (No Requeridos, Heredados)

- Doctor `buildBinaryUpgradeCheck` no inyecta fetcher (testabilidad).
- `renameSync` sin fallback EXDEV (hardening cross-filesystem).
- Path legacy `performUpgrade` evaluable para eliminación futura.
- `classifyFileKind` por substrings (priorizar directorio sobre nombre).
- Ternaria redundante en `tryRollback` (`rolled ? "rolled_back" : "rolled_back"`).

---

## Design Fidelity

**Aligned**: Sí

**Desviaciones**: Ninguna nueva. Todas las desviaciones anteriores resueltas.

---

## Open Questions

- (Heredada) ¿Los archivos auto-generados (`build-info.generated.ts`, `.codebase-memory/*`) deben incluirse en el commit?
- (Heredada) ¿Eliminar el path legacy `performUpgrade` del CLI en un cambio posterior?

---

## Required Fixes

**Ninguno bloqueante.**

El MINOR de `partial_failure` Enter handling es de una línea y puede resolverse en follow-up o antes de merge si se prefiere. No bloquea APPROVE.

---

## Advisory Notes

1. Añadir `partial_failure` al terminal state handler de Enter (una línea, follow-up).
2. Limpiar inconsistencia de tipos en dual-call `runUpgrade` si se mantiene la signature programática.
3. Limpiar MINOR pendientes (JSDoc duplicado, ternaria redundante) en follow-up.
4. Considerar inyectar fetcher en `buildBinaryUpgradeCheck` para alinear con patrón DI.
5. Agregar fallback EXDEV para `renameSync` cross-filesystem como hardening.

---

## Contaminación de Archivos

**Estado**: ✅ Sin cambios post-review. Solo archivos relacionados con este change modificados.

---

## Verificación de Seguridad (Re-confirmada)

| Control | Estado |
|---|---|
| No workflow para `--version` | ✅ Early exit línea 138 |
| No descarga con URL vacía | ✅ Guard línea 174 |
| No workflow sin binary path | ✅ Guard línea 163 |
| Checksum SHA-256 pre-replace | ✅ |
| No replace para Homebrew | ✅ |
| Backup global antes de mutar | ✅ |
| Backup inline preservado post-verify | ✅ |
| No sync sin backup | ✅ |
| Serena gating | ✅ |
| Logging de errores | ✅ |

---

**Nota sobre memoria**: No se guardaron descubrimientos en memoria adaptativa durante esta review final. Los hallazgos están documentados en este artifact oficial.
