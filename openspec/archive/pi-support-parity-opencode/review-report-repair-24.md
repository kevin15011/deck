# Review Report: Repair #24 — pi-support-parity-opencode (focused)

## Summary

**Overall Rating**: APPROVE WITH CHANGES
**Scope**: general (focused on Repair #24: profile materialization, orchestrator stub ref, skills layout)
**Files Reviewed**: 6
- `packages/adapter-pi/src/developer-team-install.ts`
- `packages/adapter-pi/src/pi-team-profile.ts`
- `packages/adapter-pi/src/pi-team-launch.ts`
- `packages/adapter-pi/src/developer-team-install.test.ts`
- `packages/adapter-pi/src/pi-team-launch.test.ts`
- `packages/core/src/teams/developer/orchestrator-content.ts`

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Project-relative `.deck/pi/profiles/<team>/` y `.pi/skills/` son canónicos y consistentes con Design §"Prompts Pi" + Repair #24 §"Decisión de layout". |
| Security | ✅ Strong | No hay secretos, no hay new attack surface. Redacción de secretos se mantiene fuera de scope. |
| Scalability | ✅ Strong | Rutas relativas a proyecto, sin crecimiento de estado global. |
| Maintainability | ✅ Strong | `buildTeamProfileDir` + `materializeTeamProfile` son idempotentes y aislados; la deduplicación de código stub se reduce a una sola función. |
| Code Quality | ✅ Strong | Naming claro, comentarios explican el contrato REQ-PROMPT-002. |
| Backend | ✅ Strong | Aplica. |
| Frontend | N/A | No aplica al repair. |
| Integration | ✅ Strong | Stub referencia el path por placeholder `<team>` solo como string legible humano; el launch plan resuelve el teamId real. Tests confirman. |

## Findings

### BLOCKER
- Ninguno.

### MAJOR
- **N/A**.

### MINOR

- **M1 — Code Quality / Test coverage**: el placeholder literal `<team>` en el stub del orchestrator (líneas 1036, 1071, 1090 de `developer-team-install.ts`) nunca se sustituye por el teamId real. Es solo texto legible para humanos en el archivo del agente.
  - **File**: `packages/adapter-pi/src/developer-team-install.ts:1036,1071,1090`
  - **Evidence**: el plan de launch (`pi-team-launch.test.ts:32`) usa `plan.profileDir + "/system-prompt.md"` calculado con teamId real, no del stub.
  - **Recommendation**: ningún cambio necesario. El test en `developer-team-install.test.ts:499` solo verifica presencia del literal como cadena documental. La substitución real ocurre en launch-time, fuera del stub. **Advisory only** — no es un bug.

- **M2 — Architecture / Layout consistency**: la lectura de assignments de modelo/thinking sigue yendo a `~/.pi/agent/agents/` (línea 420, 434 de `runner-adapter.ts`) mientras la escritura se hace a project-relative `.pi/agents/`.
  - **File**: `packages/adapter-pi/src/runner-adapter.ts:416-434`
  - **Evidence**: la función lee de `${homeDir}/.pi/agent/agents` para paridad con escritura previa; el install escribe a `projectRoot/.pi/agents/`.
  - **Recommendation**: esto fue resuelto en Repair #21 (param `agentsDir` explícito) y no es regresión. **Advisory only** — no requiere acción.

### NIT

- **N1 — Documentation**: el comentario JSDoc en `buildOrchestratorStub` (línea 996) podría explicitar que el placeholder `<team>` no se substituye.
  - **File**: `packages/adapter-pi/src/developer-team-install.ts:992-998`
  - **Recommendation**: añadir nota "(literal placeholder for human reference; real path resolved at launch)" al comentario. Opcional.

## Design Fidelity

- **Aligned**: Yes
- **Deviations**: ninguna con impacto.
- **Consistencia con Design**:
  - §"Prompts Pi" (línea 311): `.deck/pi/profiles/developer-team/system-prompt.md` canónico ✅
  - §"Persistencia de prompt del orchestrator en Pi": agente con frontmatter + stub mínimo, no body completo ✅
  - §"Migración": no borrar archivos existentes, regenerar body del orchestrator con stub/referencia ✅
- **Consistencia con Spec REQ-PROMPT-001/002/003**:
  - REQ-PROMPT-001: system prompt = fuente de verdad ✅
  - REQ-PROMPT-002: agente NO duplica body completo ✅
  - REQ-PROMPT-003: limpieza preserva `--system-prompt` launch ✅

## Respuestas a preocupaciones del Orchestrator

1. **"Project-relative es arquitectónicamente aceptable para Pi runtime"**:
   - **Sí**. Es la decisión deliberada de Repair #24, alineada con Design, y consistente con cómo Pi runtime resuelve `--system-prompt <file>` (ruta absoluta o relativa al cwd del launch). El cwd del launch es `projectRoot` (`pi-team-launch.ts:158`), por lo que `--system-prompt .deck/pi/profiles/developer-team/system-prompt.md` se resuelve correctamente.

2. **"Verifier flagged missing `~/.pi/agent/profiles`"**:
   - **Falsa alarma resuelta**. `~/.pi/agent/profiles` no es la ubicación canónica — la canónica es **project-relative** `.deck/pi/profiles/<team>/`. La preocupación quedó atendida: la ruta se materializa en install (test "materializes profile" pasa) y la resolución es vía `buildTeamProfileDir(projectRoot, teamId)`.

3. **"Orchestrator stub reference resuelve confiablemente"**:
   - **Sí**. La cadena literal `.deck/pi/profiles/<team>/system-prompt.md` en el stub es solo documentación legible; el path real usado en launch es `plan.profileDir + "/system-prompt.md"` donde `plan.profileDir = join(projectRoot, ".deck", "pi", "profiles", teamId)` con teamId real. Test `pi-team-launch.test.ts:28,32` confirma.

4. **"No full prompt duplication"**:
   - **Confirmado**. Test `developer-team-install.test.ts:488-510` valida que el orchestrator stub:
     - Contiene la cadena de referencia del path ✅
     - NO contiene `## Orchestrator Invariants` ✅
     - NO contiene `INV-001` ✅
     - Contiene el marcador "System prompt is sourced from profile" ✅
   - 4/4 tests de "profile materialization" pasan (12 expect() calls).

## Cobertura de tests ejecutados (focused)

| Suite | Pass | Fail | Notas |
|---|---:|---:|---|
| `developer-team-install.test.ts -t "profile materialization"` | 4 | 0 | 12 expects |
| `pi-team-launch.test.ts` + `pi-team-profile.test.ts` | 33 | 0 | 110 expects |

## Verdict

**APPROVE WITH CHANGES** (advisories solamente, ningún required fix antes de Archive).

## Required fixes before Archive

- **Ninguno**.

## Advisories (no bloquean)

- A1: considerar documentar en JSDoc que `<team>` es placeholder literal (N1).
- A2: validar con TUI real que `--system-prompt` resuelve correctamente desde cwd del launch (Repair #24 ya marcado como `requiere re-test TUI`).
- A3: el full typecheck sigue con warnings preexistentes fuera del scope del repair; no es regresión de Repair #24.

## Open Questions

- Ninguna que bloquee Archive.
