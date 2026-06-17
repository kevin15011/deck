# Exploración: Update/upgrade desde la TUI con sync de configuraciones por runner

## Meta
Verificar y corregir el flujo completo de actualización de Deck desde la TUI y CLI: detección de nuevas versiones, instalación del binario más reciente, sincronización de prompts/skills/configs solo en los runners instalados y con las capacidades seleccionadas, y backup previo de la configuración de cada runner.

## Estado actual

### Detección de versiones (release check)
- `apps/cli/src/tui/release-check.ts` implementa una verificación no bloqueante con timeout de 5s, mapea el resultado de `fetchReleaseDescriptor` a `ReleaseCheckState` y distingue `newer-version` vs `same-version-different-commit`. La lógica base es correcta.
- `apps/cli/src/tui/screens/home-screen.tsx` consume `ReleaseCheckState` y renderiza el banner de upgrade disponible. El menú en `menu-options.ts` muestra `Update Deck → vX.Y.Z` cuando hay release disponible.

### CLI `deck upgrade` (path legacy)
- `apps/cli/src/upgrade-command/index.ts` (`runUpgrade`) solo reemplaza el binario vía `performUpgrade`. **No invoca `runRunnerSync` ni el orchestrator**, por lo que no sincroniza prompts/skills/configs después del reemplazo.
- Es el handler usado por `deck upgrade` / `deck update` en `main.tsx`.

### TUI upgrade (orchestrator)
- `apps/cli/src/tui/app.tsx` tiene un `useEffect` que llama `runUpgradeOrchestrator` cuando el usuario confirma el upgrade.
- **Problema crítico**: el `deps.adapterRegistry` que le pasa la TUI es un registro vacío (`list: () => []`, `has: () => false`) y `readDeckConfig` devuelve `getDefaultDeckConfig()`. Esto hace que **el sync de contenido nunca se ejecute en producción**, aunque el orchestrator soporte sync.
- El orchestrator (`apps/cli/src/upgrade-command/orchestrator.ts`):
  - Tiene la secuencia correcta: backup → binary → content sync → verify.
  - Pero `buildDefaultOrchestratorDeps()` devuelve también un `adapterRegistry` vacío.
  - `runBinaryItem()` verifica el asset staged y checksum, pero **no realiza el reemplazo atómico del binario**; comenta que lo delega al caller, pero no hay hook `replaceBinary` en `OrchestratorDeps`. El binario nunca se reemplaza realmente.
  - `collectBackupTargets()` solo respalda el binario actual y el asset tarball de contenido; **no respalda los archivos de configuración de cada runner** (prompts, skills, AGENTS.md, opencode.json, packageInstructions.json, etc.) antes de aplicar el sync.

### Sync por runner y selección de capacidades
- `apps/cli/src/upgrade-command/runner-sync.ts` tiene la lógica correcta:
  - Detecta runners instalados vía `RunnerAdapter.detectDeckInstall`.
  - Lee las selecciones del usuario desde `config.packageInstructions[runnerId]` con `getEnabledPackageInstructionIds`.
  - Construye el bundle solo con los paquetes habilitados.
  - Plan → backup del adapter → apply → verify.
- Respecto a Serena: `getDefaultDeckConfig()` tiene `serena: false` para pi y opencode. Si el usuario no la habilita, no se sincroniza. La selección se respeta a nivel de `packageInstructions`. Esto cumple el requisito "si Serena no está seleccionada, no se sincroniza".
- Los adapters detectan instalación Deck por archivos gestionados, no por la presencia del binario del runner. OpenCode: `~/.config/opencode/` o `<projectRoot>/.config/opencode/`, busca `opencode.json`, `AGENTS.md`, `packageInstructions.json`, `skills/`. Pi: equivalente en su raíz de config.

### Backup de configuración por runner
- `apps/cli/src/upgrade-command/backup-store.ts` soporta backup con metadatos (`owner`, `kind`, checksum).
- Los adapters tienen `backupDeveloperTeamFiles(plan)` que respalda el contenido previo de los archivos del plan (ej. skills en OpenCode).
- Pero **el orchestrator no incluye en `CreateBackupInput.files` los archivos de runner que serán mutados**, por lo que el backup global no cubre config/prompts/skills antes del sync.

### Doctor / wiring de `upgradeAvailable`
- `apps/cli/src/doctor-command/types.ts` define `DoctorBinaryResult.upgradeAvailable: boolean`.
- `apps/cli/src/doctor-command/doctor-diagnostics.ts` **nunca construye ni retorna el campo `binary`**; solo retorna `binaryCheck` (categoría genérica de binaries).
- `apps/cli/src/doctor-command/doctor-report.ts` sí usa `binary.upgradeAvailable`, pero como `result.binary` es `undefined`, esa sección nunca se renderiza. Esto explica el bug "doctor/TUI podía mostrar No upgrade available aunque existiera upgrade".
- `checkUpgradeAvailable` en `github-release.ts` solo compara semver, no commit; para el doctor se necesitaría una decisión commit-aware.

## Archivos relevantes
- `apps/cli/src/tui/release-check.ts` — verificación no bloqueante de releases.
- `apps/cli/src/tui/screens/home-screen.tsx` — banner de upgrade en home.
- `apps/cli/src/tui/app.tsx` — efecto que dispara `runUpgradeOrchestrator` con registry vacío.
- `apps/cli/src/upgrade-command/index.ts` — `runUpgrade` CLI legacy (solo reemplaza binario).
- `apps/cli/src/upgrade-command/orchestrator.ts` — orchestrator con gaps de binary replacement y backup de configs.
- `apps/cli/src/upgrade-command/runner-sync.ts` — lógica de sync por runner (correcta, pero no se invoca en producción).
- `apps/cli/src/upgrade-command/backup-store.ts` — backup global (no incluye archivos de runner).
- `apps/cli/src/runner-adapters.ts` — registro real de adapters (no se usa en TUI upgrade).
- `packages/core/src/teams/developer/instruction-bundles/index.ts` — `getEnabledPackageInstructionIds` y selección de paquetes.
- `packages/adapter-opencode/src/runner-adapter.ts` / `packages/adapter-pi/src/runner-adapter.ts` — métodos `detectDeckInstall`, `backupDeveloperTeamFiles`, etc.
- `apps/cli/src/doctor-command/doctor-diagnostics.ts` — no pobla `DoctorBinaryResult`.
- `apps/cli/src/doctor-command/doctor-report.ts` — consume `binary.upgradeAvailable`.
- `apps/cli/src/doctor-command/types.ts` — define `DoctorBinaryResult`.

## Restricciones
- No realizar instalaciones ni llamadas de red reales en tests; usar mocks deterministas.
- El upgrade debe funcionar tanto en modo binario instalado como Homebrew (este último salta el reemplazo de binario pero permite sync de contenido).
- El sync debe respetar las selecciones de `packageInstructions` por runner.
- El backup debe ser atómico y reversible.

## Riesgos
1. **Regresión en TUI upgrade**: al cablear el registro real y el config real, cualquier error en la detección de runner podría hacer que se intente sync en runners no instalados.
2. **Reemplazo de binario real**: si se implementa el hook `replaceBinary`, un bug podría dejar el sistema sin binario ejecutable. Requiere rollback automático probado.
3. **Cobertura de backup incompleta**: respaldar solo el binario y no los archivos de runner deja a los usuarios sin rollback de configuración.
4. **Doctor muestra información incorrecta**: si `upgradeAvailable` se cablea mal, puede mostrar "No upgrade available" cuando sí lo hay.
5. **Doble path de upgrade**: CLI legacy (`index.ts`) y orchestrator TUI divergen; conviene unificar o al menos asegurar que ambos hagan binary + sync.
6. **Homebrew**: el sync de contenido no debe intentar reemplazar binario; la lógica existe pero debe mantenerse.

## Opciones y trade-offs

### Opción A: Corregir el wiring TUI/orchestrator y dejar CLI legacy como wrapper
- Descripción: La TUI pasa el registro real (`createDefaultAdapterRegistry` / `listAdapters`) y la config real (`resolveDeckConfig`). Se agrega un hook `replaceBinary` al orchestrator para hacer el reemplazo atómico. CLI `deck upgrade` puede delegar al orchestrator o seguir con `performUpgrade` + `runRunnerSync`.
- Pros: Unifica la lógica en el orchestrator; aprovecha backup, lock, rollback y manifest.
- Cons: Mayor cambio en `app.tsx` y `orchestrator.ts`; requiere más tests de integración.
- Esfuerzo: Medio-Alto.

### Opción B: Mantener CLI legacy y solo arreglar TUI
- Descripción: Arreglar solo `app.tsx` para usar registro/config real y agregar binary replacement en orchestrator. Dejar `runUpgrade` (CLI) como está o deprecarlo.
- Pros: Menor superficie de cambio.
- Cons: `deck upgrade` seguiría sin sincronizar contenido; experiencia inconsistente.
- Esfuerzo: Medio.

### Opción C: Unificar ambos paths en el orchestrator
- Descripción: `main.tsx` llama a un nuevo `runCliUpgrade` que usa `runUpgradeOrchestrator` con el descriptor obtenido desde GitHub. La TUI reutiliza el mismo helper.
- Pros: Comportamiento idéntico en CLI y TUI; menos código duplicado.
- Cons: Requiere refactor del handler CLI actual y asegurar compatibilidad con `--yes`.
- Esfuerzo: Alto.

## Recomendación
Adoptar **Opción A** como paso inmediato, con miras a **Opción C** en un cambio posterior:
1. Cablear en `app.tsx` el registro real de adapters y la config real del usuario.
2. Agregar `replaceBinary` a `OrchestratorDeps` e implementar el reemplazo atómico real en `runBinaryItem`.
3. Extender `collectBackupTargets` para incluir los archivos de runner que el plan va a mutar (usando `detectDeckInstall` + `buildDeveloperTeamInstallPlan` para saber qué respaldar).
4. Poblar `DoctorBinaryResult` en `runDoctorDiagnostics` usando `decideReleaseAvailability` o `checkUpgradeAvailable` commit-aware.
5. Asegurar que CLI `deck upgrade` también ejecute sync (ya sea delegando al orchestrator o llamando `runRunnerSync` tras `performUpgrade`).

## Diagnóstico accionable
Sí. Se identificaron wiring gaps concretos: registry/config vacíos en TUI, binary replacement no implementado en orchestrator, backup sin archivos de runner, y `DoctorBinaryResult` no poblado.

## Resultado de lifecycle sugerido
`propose` — el problema está suficientemente delimitado para pasar a Proposal/Spec.

## Preguntas abiertas
1. ¿El CLI `deck upgrade` debe refactorizarse para usar el orchestrator, o se mantiene como path separado?
2. ¿El backup de archivos de runner debe hacerse a nivel global (`backup-store.ts`) o es suficiente con el backup por adapter (`backupDeveloperTeamFiles`)?
3. ¿Se requiere notificación en TUI cuando un runner está instalado pero no tiene selecciones habilitadas (ej. Serena deshabilitada)?
4. ¿Cuál es la política de retención de backups cuando el sync es parcial?

## Listo para Proposal
Sí, con la condición de que Proposal/Spec debe decidir el alcance exacto (TUI-only vs CLI+TUI) y el mecanismo de binary replacement.

## Registro
- **Artifact Path**: `openspec/changes/tui-update-upgrade-sync/exploration.md`
- **State Path**: `openspec/changes/tui-update-upgrade-sync/state.yaml`
- **Events Path**: `openspec/changes/tui-update-upgrade-sync/events.yaml`
- **Fase registrada**: `explore`
- **Estado**: `completed`
