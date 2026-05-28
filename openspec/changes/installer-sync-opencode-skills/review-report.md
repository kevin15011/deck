# Review Report: Sincronizar skills OpenCode desde el instalador

## Summary

**Overall Rating**: APPROVE
**Scope**: general, backend, integration
**Files Reviewed**: 2

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Boundaries respected: canonical source (`orchestrator-content.ts` → `content-registry` → `buildSkillFileContent`) is preserved; verify hardening aligns with design. |
| Security | ✅ Strong | Path traversal guard on `standaloneSkills.skillId` already present; no new secrets or injection risks. |
| Scalability | ✅ Strong | Byte-for-byte comparison of small text files; negligible performance impact. |
| Maintainability | ✅ Strong | Tests are well-isolated with temp directories, CI-compatible. Clear describe blocks map to tasks. |
| Code Quality | ⚠️ Adequate | Core logic is clean; minor dead code in one test and a typo in comment. |
| Backend | ✅ Strong | Exact-match verify correctly placed alongside existing structural checks. Apply idempotency already existed and is now validated. |
| Frontend | N/A | No frontend changes. |
| Integration | ✅ Strong | Prompt→skill path drift validated; installer correctly treats `~/.config/opencode/skills/deck-developer-*` as managed output. |

## Findings

### BLOCKER
None.

### MAJOR
None.

### MINOR
- **Maintainability / Test Coverage**: Falta el test explícito para la variante REQ-INST-001 (fuente canónica ausente).
  - **File**: `packages/adapter-opencode/src/developer-team-install.test.ts`
  - **Evidence**: `tasks.md` Task 2 punto 5 exige: "Verificar que `buildSkillFileContent()` lanza error cuando `getAgentContent()` retorna null". El comportamiento existe en código (`developer-team-install.ts` L271–274) pero no hay test que lo ejercite.
  - **Recommendation**: Añadir un test unitario que construya un plan con un agente cuyo `id` no esté en el registry y verifique que `buildSkillFileContent` arroja `Error` con el mensaje esperado.

- **Code Quality**: Código muerto en test de idempotencia byte-a-byte.
  - **File**: `packages/adapter-opencode/src/developer-team-install.test.ts` — describe "Task 2 — stale overwrite...", test "re-applying unchanged content produces changedCount === 0"
  - **Evidence**: Se crea `const initialMtimes = new Map<string, number>()` y se llena con ceros, pero nunca se lee ni se aserta sobre mtimes. El comentario dice "We'll read directly" pero no hay lectura.
  - **Recommendation**: Eliminar el mapa `initialMtimes` y el comentario, o reemplazar por una aserción real de `fs.statSync(path).mtimeMs` antes/después del re-apply.

### NIT
- **Code Quality**: Typo en comentario de test.
  - **File**: `packages/adapter-opencode/src/developer-team-install.test.ts`
  - **Evidence**: `// Task 2.1: Stale overwrite — REQ- INST-002` contiene un espacio después de `REQ-`.
  - **Recommendation**: Corregir a `REQ-INST-002`.

- **Maintainability**: REQ-INST-006 (SHOULD) no queda documentado explícitamente.
  - **File**: N/A — no se añadió documentación.
  - **Evidence**: La spec declara que los archivos bajo `~/.config/opencode/skills/deck-developer-*` SHOULD ser tratados como managed output documentado. El comportamiento de overwrite está implementado, pero no hay README, comentario de código ni man page que lo documente para el usuario.
  - **Recommendation**: Añadir una nota breve en el README del instalador o en un comentario de encabezado en `developer-team-install.ts` indicando que los skills `deck-developer-*` son managed output.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes
- **Deviations**:
  1. `prompt-generation.test.ts` no fue modificado; los drift tests prompt→skill path se ubicaron en `developer-team-install.test.ts` (Task 3.1). Design permite esta ubicación ("Preferir `developer-team-install.test.ts` si el drift se valida a nivel de plan"), por lo que no es una desviación problemática.
  2. Task 4 (smoke test de invariants en `orchestrator-content.test.ts`) no requirió cambios porque la cobertura ya existía. Design listaba este archivo como "modify optional", así que omitirlo es válido.

## Open Questions

None.
