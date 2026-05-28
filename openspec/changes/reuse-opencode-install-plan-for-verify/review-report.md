# Review Report: Reutilizar el plan OpenCode aplicado en verificación

## Summary

**Overall Rating**: REQUEST CHANGES
**Scope**: general
**Files Reviewed**: 2

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ❌ Weak | Estado global a nivel de módulo en lugar de closure por instancia; apply sobrescribe snapshot completo con plan parcial reconstruido. |
| Security | ✅ Strong | Sin riesgos nuevos identificados. |
| Scalability | ⚠️ Adequate | Snapshot evita reconstrucción, pero estado compartido puede causar contaminación entre instancias. |
| Maintainability | ⚠️ Adequate | Código legible, pero dead code (`invalidateSnapshot`) y comentario engañoso ("closure"). |
| Code Quality | ⚠️ Adequate | Nombres claros, pero reconstrucción de agentes en apply usa `as any` y valores dummy. |
| Backend | ⚠️ Adequate | Fix central correcto en concepto, pero introduce regresión en verify para `deck-onboard`. |
| Frontend | N/A | |
| Integration | ⚠️ Adequate | |

## Findings

### BLOCKER
- **Architecture / Integration**: `applyTeamInstall` y `applyTeamInstallFromPlan` sobrescriben el snapshot nativo completo con un plan parcial reconstruido que tiene `agent.id = "SKILL.md"`, `agent.description = ""`, `agent.skillId = ""`, y pierde `capabilityInstructions` / `personality`. Esto hace que `verifyOpenCodeDeveloperTeamInstall` aplique verificaciones incorrectas para `deck-onboard` (siempre entra al `else` que espera `user-invocable: false` y `delegate_only: true`), causando fallo de verificación y potencial rollback falso en instalaciones correctas.
  - **File**: `packages/adapter-opencode/src/runner-capabilities.ts` — líneas 337-338, 359, 520-551
  - **Evidence**: `agent: { id: f.path.split("/").pop()!.replace("/SKILL.md", ""), name: "", description: "", skillId: "" } as any` produce `id = "SKILL.md"`. Luego en `verifyOpenCodeDeveloperTeamInstall` (`developer-team-install.ts:556`), `planned.agent.skillId === "deck-onboard"` es siempre falso porque `skillId` es `""`.
  - **Recommendation**: Eliminar `captureNativePlan` de `applyTeamInstall` y `applyTeamInstallFromPlan`. El snapshot completo ya se captura en `buildTeamInstallPlan` / `buildTeamInstallPlanFromInput`. Si apply necesita capturar, reconstruir el plan con metadata completa o reutilizar el snapshot existente.

### MAJOR
- **Architecture**: El snapshot se implementa como estado global a nivel de módulo (`let lastAppliedNativePlan` fuera de la factory), no como closure por instancia como especifica el Design y las Tasks. Todas las instancias de `createOpenCodeRunnerCapabilities()` comparten el mismo snapshot, con riesgo de contaminación cruzada entre proyectos.
  - **File**: `packages/adapter-opencode/src/runner-capabilities.ts` — líneas 42-43
  - **Evidence**: Las variables están definidas a nivel de módulo, no dentro de `createOpenCodeRunnerCapabilities()`. El comentario dice "Per-instance native plan snapshot (closure)" pero no es closure.
  - **Recommendation**: Mover `lastAppliedNativePlan`, `lastAppliedProjectRoot` y las funciones helper dentro del cuerpo de `createOpenCodeRunnerCapabilities()` para que sean closure por instancia.

- **Test Adequacy**: Los tests añadidos no ejercitan el comportamiento real de reutilización de snapshot. Las 4 pruebas "de regresión" solo verifican existencia de métodos y construcción de bundles, no flujo build→apply→verify con opciones runtime, ni detección de drift, ni fallback sin snapshot.
  - **File**: `packages/adapter-opencode/src/runner-capabilities.test.ts` — describe block "verify reuse of native plan snapshot"
  - **Evidence**: Los 4 tests son: `produces verifyInstall method`, `produces buildInstallPlan method`, `produces applyInstall method`, `can construct custom capabilityInstructions`. Ninguno ejecuta apply seguido de verify ni compara contenido contra archivos instalados.
  - **Recommendation**: Añadir tests que: (a) construyan plan con `capabilityInstructions` no-default, apliquen y verifiquen pasando; (b) corrompan archivo post-apply y confirmen que verify falla; (c) creen instancia nueva sin snapshot y verifiquen fallback.

### MINOR
- **Spec Compliance**: El fallback en `verifyTeamInstall` y `verifyTeamInstallFromPlan` solo pasa `capabilityInstructions` a `buildOpenCodeDeveloperTeamInstallPlan`, omitiendo `personality`, `modelAssignments`, `thinkingAssignments`, `standaloneSkills` y `memoryProvider` requeridos por REQ-OIV-003.
  - **File**: `packages/adapter-opencode/src/runner-capabilities.ts` — líneas 376-378, 569-571
  - **Recommendation**: Extender el fallback para pasar todas las opciones runtime disponibles en el input de verify, o documentar explícitamente la limitación del contrato `DeveloperTeamVerifyInput`.

- **Maintainability**: `invalidateSnapshot` se define pero nunca se invoca. Es código muerto.
  - **File**: `packages/adapter-opencode/src/runner-capabilities.ts` — líneas 65-69
  - **Recommendation**: Eliminar `invalidateSnapshot` o usarlo en el punto apropiado (por ejemplo, al inicio de `buildTeamInstallPlan` cuando `projectRoot` cambia, aunque `captureNativePlan` ya lo maneja).

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Deviations**:
  1. **Snapshot por instancia**: El Design especifica explícitamente "snapshot nativo efímero, por instancia de `createOpenCodeRunnerCapabilities()`" y "Evitar estado global compartido". La implementación usa estado global a nivel de módulo.
  2. **Captura en apply**: El Design no menciona capturar snapshot en apply; solo en build. La implementación captura en apply, sobrescribiendo el plan completo con uno parcial.
  3. **Tests de regresión**: El Design describe tests que ejercitan apply→verify con opciones runtime. Los tests añadidos no cumplen esto.

## Open Questions

1. ¿El `runner-adapter.ts` con su `#lastNativePlan` hace que este fix sea redundante para el flujo CLI principal? Si es así, ¿cuál es el caller objetivo de `runner-capabilities.ts` que necesita este snapshot?
2. ¿Es intencional que `applyTeamInstall` reconstruya agentes con `id = "SKILL.md"`? Esto parece un bug pre-existente que ahora tiene impacto mayor al usarse como snapshot.
3. ¿Por qué `developer-team-install.ts` muestra cambios en git (+6 líneas de exact-match) si el apply-progress dice que no se modificó? ¿Son residuos de un cambio anterior no commiteado?
