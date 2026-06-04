# Exploration: redesign-doctor-diagnostics

## Goal

Investigar el estado actual del comando `deck doctor` y de la pantalla TUI "Doctor" para identificar por qué se sienten "horribles" y "demasiado superficiales", y preparar el terreno para una propuesta de rediseño que valide de verdad los **binarios de los paquetes instalados**, los **paths** relevantes, y las **configuraciones de los runners** según lo que el usuario realmente instaló.

> Frase del usuario (ES): *"Creo que tenemos un doctor pero me parece horrible, la forma en la que se presenta en la TUI no es clara y creo que está mal planteado, creo que debería de validar binarios de los paquetes, paths, configuraciones en los runners de acuerdo a lo que el usuario instaló, etc. El actual se siente demasiado superficial."*

## Current State

### Arquitectura actual de `deck doctor`

`deck doctor` (CLI) y la opción "Doctor" del menú TUI comparten el mismo orquestador `runDoctorDiagnostics()` definido en `apps/cli/src/doctor-command/doctor-diagnostics.ts`. Hay dos renderers separados que duplican lógica de iconos/colores:

- `doctor-report.ts` → renderiza a `stdout` con `picocolors` (CLI `deck doctor`).
- `tui/screens/doctor-screen.tsx` → renderiza con componentes `ink` (TUI).

Ambos consumen la misma estructura `DoctorDiagnosticsResult` definida en `doctor-command/types.ts`.

### Qué se valida hoy (taxonomía real)

| Bloque | Fuente del check | Profundidad |
| --- | --- | --- |
| Runtime Pi (versión + paquetes) | `inspectPiEnvironment` + `reviewPiRequiredTools` (ejecuta `pi --version` y `pi list`) | Media: detecta binarios listados por `pi list`, pero **no** verifica que el binario del paquete (si es un `npx …`) realmente esté en `PATH` o sea ejecutable. |
| Runtime OpenCode (versión + paquetes) | `inspectOpenCodeEnvironment` + `reviewOpenCodeTools` (lee `~/.config/opencode/package.json` y `opencode.json`) | Media: lee manifest + config local, no ejecuta nada. |
| Runtime Claude / Codex | `detectSelectedRuntimes` | **Superficial**: solo presencia en `PATH` y mensaje de "no detectado". Sin listar paquetes esperados. |
| Memoria: Engram / Supermemory / Serena | `memoryBinaryAvailable()` (split de `process.env.PATH` + `existsSync`) | **Muy superficial**: solo `existsSync(dir/comando)`. No ejecuta `--version`, no valida configuración ni conectividad del MCP. |
| MCP Pi (supermemory) | `validateSupermemoryPiMcpConfig` | Media: valida config del supermemory MCP, con redacción. |
| MCP OpenCode (`opencode.json`) | `readOpenCodeMcpSection` (lectura síncrona) | **Superficial**: solo valida forma (presencia de `command` array o `url`+`type`). No valida semánticamente ni que el binario referenciado exista. |
| Binary (build info, executable path, config dir) | `DoctorBinaryResult` (tipo) | **Inactivo**: el tipo existe pero `runDoctorDiagnostics()` nunca setea el campo `binary`. El render `renderBinary` es dead code. Ya documentado en `openspec/changes/fix-install-upgrade-regressions/exploration.md:206`. |
| **No se valida nada** de: | — | — |
| • `state.yaml` (install kind, lock, last check, active operation) | — | — |
| • `manifest.json` (deriva de los archivos que Deck dice haber escrito) | — | — |
| • Drift filesystem ↔ manifest (paths desaparecidos o modificados) | — | — |
| • `~/.config/deck/config.json` / `config.yaml` (resolución, parseo) | — | — |
| • Que las herramientas listadas por el runner (e.g. `mcp`, `codebase-memory`) sean binarios invocables reales | — | — |
| • Config de modelos (`models.json` / inventarios del runner) | — | — |
| • Versión real (`--version`) de paquetes vs. versión esperada por Deck | — | — |

### Cómo se presenta en la TUI

- Menú home (`apps/cli/src/menu-options.ts:50`): una sola línea `{ value: "doctor", label: "Doctor" }`. No hay insignia de salud.
- `tui/screens/doctor-screen.tsx` (160 líneas) implementa su propio `DiagnosticsReport` con `Box` + `Text` en Ink. Hace `useEffect` que llama `runDoctorDiagnostics()` y vuelca el resultado en 3 secciones (Runtimes / Memory / MCP) sin:
  - resumen ejecutivo (cuántos ok / warning / error),
  - filtrado o plegado de secciones,
  - acciones ("Re-ejecutar", "Abrir config", "Copiar reporte"),
  - tiempo total ni estado de carga granular (solo "Running diagnostics..."),
  - opción de ver `binary` info (porque nunca se setea).
- `tui/app.tsx` enruta a esta pantalla en `screen === "doctor"` (líneas 1237, 1627, 2261, 2320). No hay hook para auto-ejecutar al entrar al menú, no hay cache de último resultado.
- Re-ejecutar requiere salir y volver a entrar (la pantalla se vuelve a montar). No hay `r` ni `R` para re-correr.

### Cómo se presenta en la CLI

- `deck doctor` (parseado en `cli-args.ts:85-93`) llama `runDoctorDiagnostics()` + `renderDoctorReport()`.
- `renderDoctorReport` (236 líneas) usa `picocolors` con detección `process.stdout.isTTY`. Estructura: Runtimes → Memory → MCP → (Binary si existiera). Dibuja box de "All checks passed" / "Critical issues".
- `shouldExitWithError` retorna `true` cuando `hasCriticalErrors === true` → exit 1.
- **No** soporta flags: `--json` (machine-readable), `--fix` (auto-remediación), `--category <x>`, `--no-color` ya está cubierto por TTY detection.

### Por qué se siente superficial (resumen rápido)

1. **No aprovecha el `manifest.json`** que Deck mismo escribe: podríamos detectar archivos huérfanos, drift de checksums, y `state.yaml` stale.
2. **No aprovecha la lista de runners instalados** declarada por Deck: corre siempre `ALL_ENVIRONMENT_IDS` y trata Claude/Codex como "no soportado", en lugar de validar binarios listados en el manifest bajo `owner: "runner:<id>"`.
3. **Validación de binarios es solo `existsSync`**: no distingue entre archivo vacío, no-ejecutable, o ejecutable roto. Un script de 0 bytes pasa el check.
4. **TUI es read-only sin acciones**: el usuario ve una lista de "✗ Not detected" sin path de remediation concreto (los `suggestion` son genéricos, e.g. "Install Pi package: ${name}").
5. **Duplicación CLI/TUI** de iconos y colores; cualquier cambio se hace dos veces.

## Relevant Files

| File | Role |
| --- | --- |
| `apps/cli/src/doctor-command/doctor-diagnostics.ts` | Orquestador de checks (492 LOC). Punto principal de extensión. |
| `apps/cli/src/doctor-command/doctor-report.ts` | Renderer CLI con `picocolors` (236 LOC). |
| `apps/cli/src/doctor-command/types.ts` | Contrato `DoctorDiagnosticsResult`, `DoctorRuntimeResult`, `DoctorCategoryResult`, `DoctorCheckItem`, `DoctorBinaryResult`. |
| `apps/cli/src/doctor-command/index.ts` | Barrel export. |
| `apps/cli/src/tui/screens/doctor-screen.tsx` | Pantalla TUI Ink (160 LOC). Duplica lógica visual con `doctor-report.ts`. |
| `apps/cli/src/tui/app.tsx` | Routing al screen "doctor" (líneas 1237, 1627, 2261, 2320). |
| `apps/cli/src/menu-options.ts:50` | Entrada de menú "Doctor". |
| `apps/cli/src/cli-args.ts:85-93` | Parser de `deck doctor`. |
| `apps/cli/src/main.tsx:26-36` | Punto de invocación CLI de doctor. |
| `apps/cli/src/runtime-detection.ts` | Helper `detectSelectedRuntimes` que ya invoca el doctor. |
| `apps/cli/src/runtime/paths.ts` | Resolvedor XDG (`getDeckXdgPaths`, `getGlobalDeckConfigDir`, `getAllConfigPaths`). |
| `apps/cli/src/upgrade-command/manifest-store.ts` | `manifest.json` (schema v2) — fuente ideal para validar drift. |
| `apps/cli/src/upgrade-command/state-store.ts` | `state.yaml` (install kind, lock, last check). |
| `packages/adapter-pi/src/preflight.ts` | `inspectPiEnvironment` (ya en uso). |
| `packages/adapter-pi/src/required-tools.ts` | `reviewPiRequiredTools` (ya en uso). |
| `packages/adapter-opencode/src/preflight.ts` | `inspectOpenCodeEnvironment` (ya en uso). |
| `packages/adapter-opencode/src/required-tools.ts` | `reviewOpenCodeTools` (ya en uso). |
| `apps/cli/src/__tests__/doctor-diagnostics.test.ts` | 13 tests Bun (happy path, errores aislados, redacción). |
| `apps/cli/src/__tests__/doctor-report.test.ts` | 286 LOC de tests para el renderer CLI. |
| `apps/cli/src/cli-args.test.ts:179-200` | 4 tests de parsing de `deck doctor`. |
| `apps/cli/src/menu-options.test.ts:23` | Test de presencia de "Doctor" en menú. |
| `openspec/changes/fix-install-upgrade-regressions/exploration.md:206` | Ya documentó que `DoctorBinaryResult.binary` es dead code. |
| `openspec/archive/add-serena-package/` | Cambio previo que añadió chequeo de Serena. Patrón de cómo se extendió doctor antes. |
| `openspec/archive/binary-compilation-2026-05-25/` | Specs previas REQ-doc-001..004 para `doctor` en modo binary. |
| `docs/deuda-tecnica.md`, `docs/skills-integration-roadmap.md` | Posible ubicación para nota de deuda técnica de doctor. |

## Constraints

- **Stack**: TypeScript estricto, Bun runtime/test, Ink para TUI, `picocolors` para CLI, `zod` para schemas, `node:fs` síncrono en algunos paths.
- **Redactor obligatorio**: cualquier mensaje de doctor pasa por `redact()` / `redactDiagnostic()` de `@deck/adapter-pi` (REQ-DIAG-009). Esto debe preservarse en nuevos checks.
- **Aislamiento de checks**: cada sub-check debe estar envuelto en `try/catch` para que un fallo no aborte los demás (REQ-DIAG-007).
- **No-fatal**: `runDoctorDiagnostics` no debe lanzar; siempre retorna estructura (REQ-DIAG-008).
- **TTY/Color**: el renderer CLI detecta `process.stdout.isTTY` y desactiva ANSI. La TUI usa colores Ink. No acoplar con `chalk` o `kleur`.
- **Adapter boundary**: lógica de validación específica de un runner (e.g. parsear `opencode.json`) debe seguir viviendo en `@deck/adapter-opencode` / `@deck/adapter-pi`; el doctor en `apps/cli` orquesta.
- **Manifest schema**: `manifest.json` v2 (zod en `manifest-store.ts`) es la fuente de verdad de archivos Deck-owned. No introducir otro schema paralelo.
- **Sin cambios destructivos al menú** sin pasar por Proposal/Spec (la opción "Doctor" existe y la usan los tests).
- **Test runner**: `bun test`. Cubrir ≥ 1 test por nuevo check crítico.
- **Mínimo de exit code**: preservar `shouldExitWithError` semántica (`exit 1` si `hasCriticalErrors`).
- **Idioma**: el proyecto mezcla ES/EN; el artefacto y los mensajes al usuario pueden ir en ES.

## Risks

1. **Romper tests existentes**: el contrato `DoctorDiagnosticsResult` es estable (`hasCriticalErrors`, `runtimes`, `memory`, `mcp`). Cambios incompatibles rompen `doctor-diagnostics.test.ts` y `doctor-report.test.ts`. Mitigación: añadir campos, no renombrar/eliminar.
2. **Latencia del TUI al cargar**: si añadimos muchos checks síncronos (e.g. leer `manifest.json`, validar cada entry con sha256), el `useEffect` puede tardar varios segundos. Mitigación: paralelizar con `Promise.all` y/o mostrar progreso granular.
3. **Falsos positivos en binarios**: validar ejecutabilidad con `accessSync(..., X_OK)` puede fallar en Windows o cuando un binario requiere shell. Mitigación: usar `X_OK` solo en POSIX, fallback a `existsSync` en Windows (como ya hace `runtime-detection.ts`).
4. **Drift detection ruidoso**: si `manifest.json` lista 200+ archivos, validar todos puede generar salida abrumadora. Mitigación: resumen agregado + top-N items, modo `--verbose` para detalle.
5. **Acoplamiento CLI↔TUI**: si seguimos duplicando renderers, mantendremos la deuda. Mitigación: la propuesta debería consolidar en un único `formatDoctorResult(result, options)` que ambos renderers consumen.
6. **Scope creep**: la tentación es convertir doctor en un "system info" genérico. Mantener foco en los tres ejes del usuario: **(a) binarios de paquetes**, **(b) paths**, **(c) configuraciones de runners**.
7. **Snapshots / determinismo**: si los checks leen `process.env`, `PATH`, `homedir()`, son dependientes de entorno. Inyectar helpers (igual que `runCommand` en `preflight.ts`) y cubrir con tests aislados.
8. **Compatibilidad con `add-serena-package`**: el check de Serena ya existe; cualquier rediseño debe preservarlo.
9. **Compatibilidad con binary mode (`binary-compilation-2026-05-25/`)**: REQ-doc-001..004 definen contratos para el binary build. El rediseño no debe romper esos.

## Options and Tradeoffs

### Option A: Extender el orquestador + consolidar renderers (Recommended baseline)

- Añadir nuevos bloques de checks: **Manifest** (drift de `manifest.json`), **State** (`state.yaml` y `installKind`), **Deck Config** (existencia y parseo de `config.json`/`config.yaml`), **Runner Config** (validación más profunda de `opencode.json` y de config de Pi usando los resolvers ya existentes), **Binary** (revivir `DoctorBinaryResult.binary`).
- Reemplazar `existsSync` por `accessSync(..., X_OK)` en binarios de paquetes.
- Crear un único formatter `formatDoctorResult(result, { mode: "plain" | "tui" | "json" })` que devuelva nodos; `doctor-report.ts` y `doctor-screen.tsx` pasan a ser adapters.
- Pros: atacan los 3 ejes del usuario (binarios / paths / configs de runners), preservan contrato, eliminan duplicación.
- Contras: mediano refactor; tests existentes requieren ajustes.
- Effort: Medium.

### Option B: Solo reescritura visual TUI (cosmético)

- Reescribir `doctor-screen.tsx` con resumen, secciones plegables, colores por severidad, acción de "Re-run".
- Dejar el orquestador como está.
- Pros: bajo riesgo, mejora UX inmediata.
- Contras: no ataca la queja de fondo ("demasiado superficial"); REQ queda incompleto.
- Effort: Low–Medium.

### Option C: Nuevo sub-comando `deck doctor --deep`

- Dejar `deck doctor` superficial; añadir `deck doctor --deep` que sí lee manifest, state, valida binarios con `--version`, etc.
- Pros: no rompe el flujo actual; usuarios avanzados optan al detalle.
- Contras: dos experiencias divergentes; no resuelve que el actual "se siente horrible".
- Effort: Low.

### Option D: Reemplazar doctor con un sistema de "health check" basado en checks registrables

- Definir una interfaz `DoctorCheck` registrable; cada adapter registra los suyos. El orquestador solo itera.
- Pros: extensible a nuevos runners/checkers sin tocar `doctor-diagnostics.ts`.
- Contras: refactor arquitectónico grande; overkill si solo se quieren añadir 3-4 checks; risk de romper todos los tests de doctor.
- Effort: High.

## Recommendation

Recomiendo **Option A como base**, complementada con el side-effect de **Option B** para la TUI.

Justificación:

- Ataca directamente los tres ejes del usuario (binarios / paths / configs de runners) sin esperar a otro ciclo.
- Reusa trabajo existente: `inspectPiEnvironment`, `reviewPiRequiredTools`, `reviewOpenCodeTools`, `getDeckXdgPaths`, `readManifest`, `readState`. No se introducen dependencias nuevas.
- El formatter unificado es deuda técnica que ya se debería haber pagado; este cambio es una buena excusa.
- El "dead code" de `DoctorBinaryResult.binary` se elimina como efecto colateral (en vez de dejarlo para otro change).

Si el usuario prefiere minimizar riesgo, podemos arrancar por **Option B + subset de Option A** (añadir 2-3 checks de manifest/state y mejorar TUI), dejando la consolidación de renderers para un cambio posterior.

## Open Questions

- ¿`deck doctor --fix` debe ejecutar remediaciones reales (e.g. `npm i -g <pkg>`) o solo imprimir comandos sugeridos? El parser actual rechaza args extra — habría que actualizarlo.
- ¿Qué nivel de "binary version match" se quiere? ¿Comparar con una `expectedVersion` por paquete o solo reportar la versión actual?
- ¿La TUI debe cachear el último resultado y mostrar "Doctor: 3 warnings" en el home como insignia? (No hacerlo es consistente con el resto del menú, pero ayudaría a la discoverability.)
- ¿La validación de `manifest.json` debe listar **todos** los archivos con drift o solo los `binary/config/prompt`? (Filtrar reduce ruido.)
- ¿Drift detection debe incluir `kind: "mcp"` para advertir cuando un MCP server fue desinstalado pero su config sigue ahí? (Probablemente sí, pero el costo es complejidad de remediation guidance.)
- ¿Qué hacer con el `DoctorBinaryResult` ya tipado pero nunca usado? (Convertirlo en una sección activa o eliminarlo del contrato.)
- ¿Se quiere un modo `--json` para que CI/scripts consuman el resultado estructurado sin parsear ANSI? (Bajo costo, alto valor.)
- ¿Hay tests E2E o snapshot de la salida de doctor que se romperían con un nuevo formato? (No encontré, pero conviene confirmar en `openspec/archive/binary-compilation-2026-05-25/verify-report.md`.)

## Ready for Proposal

**Yes** — siempre que la Propuesta elija explícitamente entre:

1. **Option A completo** (refactor medio, atacando los 3 ejes + consolidar renderers), o
2. **Option A parcial + B** (subset de checks nuevos + TUI renovada, sin consolidar renderers en este ciclo).

Ambos caben en un solo ciclo de SDD; el primero es más completo pero con mayor superficie de tests a actualizar.

El Orchestrator debería comunicar al usuario (en ES) que el rediseño **no es puramente cosmético**: incluye validar binarios ejecutables (no solo presencia), leer `manifest.json` para detectar drift, leer `state.yaml` para detectar install state roto, y profundizar en configs de runners (`opencode.json`, `~/.pi/agent/`). Si el usuario quiere priorizar solo la TUI, lo confirmamos antes de Proposal.

## Provenance

- agent: `deck-developer-explorer`
- source artifacts read: `apps/cli/src/doctor-command/{types,doctor-diagnostics,doctor-report,index}.ts`, `apps/cli/src/tui/screens/doctor-screen.tsx`, `apps/cli/src/tui/app.tsx` (extracts), `apps/cli/src/menu-options.ts`, `apps/cli/src/cli-args.ts`, `apps/cli/src/main.tsx`, `apps/cli/src/runtime/paths.ts`, `apps/cli/src/runtime-detection.ts`, `apps/cli/src/upgrade-command/manifest-store.ts`, `apps/cli/src/upgrade-command/state-store.ts`, `packages/adapter-{pi,opencode}/src/{preflight,required-tools}.ts`, `apps/cli/src/runner-capability-registry.ts`, `apps/cli/src/__tests__/doctor-{diagnostics,report}.test.ts`, `openspec/archive/add-serena-package/`, `openspec/archive/binary-compilation-2026-05-25/`, `openspec/changes/fix-install-upgrade-regressions/exploration.md`.
- graph tools: no usado (MCP codebase-memory no tenía index de `deck` aún; se hizo búsqueda por `grep`/`Read` directo).
- registry state: creado en este run; previous_artifacts = none.
