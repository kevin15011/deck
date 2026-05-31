# Apply Progress: specialist-team-methodology

## Completed Tasks

### [ROLLBACK FIX] Restauración de INV-005
**Status**: ✅ Complete
**Date**: 2026-05-30

**Root Cause**: El apply previo renombró INV-005 a INV-007 al agregar INV-006. Los adaptadores installer (opencode y pi) tienen arrays hardcodeados `["INV-001", ..., "INV-005"]` en sus funciones `verifyInvariantPresence()`. El verifier buscaba INV-005 en skill surface y fallaba porque ahora era INV-007.

**Fix Applied**:
1. Restauró INV-005 con su contenido original de Registry-Deferred Parallelism
2. Preserve INV-006 (SDD Explorer-First Flow) como nuevo
3. Eliminó INV-007 duplicado
4. Actualizó el array `ORCHESTRATOR_INVARIANTS`: [INV-001, INV-002, INV-003, INV-004, INV-005, INV-006]

**Files Changed**:
- `packages/core/src/teams/developer/orchestrator-invariants.ts` — restauró INV-005, eliminó INV-007
- `packages/core/src/teams/developer/orchestrator-invariants.test.ts` — actualizó assertions (INV-005, INV-006)
- `packages/core/src/teams/developer/orchestrator-invariants.task2.test.ts` — actualizó assertions
- `packages/core/src/teams/developer/manifest.test.ts` — actualizó assertions
- `packages/core/src/teams/developer/content-registry.test.ts` — actualizó assertions

**Tests Run**:
- `bun test packages/core/src/teams/developer/` — 546 pass, 0 fail

**Result**: El installer ahora encuentra INV-005 en skill surface ✅

### Task 1: Evaluar seguridad de INV-006
**Status**: ✅ Complete

**Decision**: GO — INV-006 saferi invariant. Análisis confirmó:
- `ORCHESTRATOR_INVARIANTS` array permite 6ta entrada sin romper exports
- `renderOrchestratorInvariants()` iterating funciona automáticamente
- `verifyOrchestratorInvariantPresence()` checking funciona automáticamente
- INV-006 no solapa con INV-004 (Triage) ni INV-005 (Deferred Parallelism)

### Task 2: Reframe de contenido del Orchestrator + invariantes
**Status**: ✅ Complete

**Files Changed**
- `packages/core/src/teams/developer/orchestrator-invariants.ts` — modify (INV-004 wording a Specialist(s), agregó INV-006, renombró INV-005→INV-007)
- `packages/core/src/teams/developer/orchestrator-content.ts` — modify (4 superficies)

**Changes Applied**:
1. **Identidad de equipo de especialistas**: SYSTEM_PROMPT ahora dice "Specialist Team Coordinator" vs "pure delegator"
2. **Triage Specialist(s)**:
   - SYSTEM_PROMPT: "Specialist(s)" en todas partes
   - GUIDA: "Specialist(s)" en todas partes  
   - SKILL_BODY: "Specialist(s)" en todas partes
   - INV-004: actualizado a "Specialist(s)"
3. **Parallel Specialist Launch**: nueva sección en SYSTEM_PROMPT explicando safe/unsafe conditions
4. **Explorer-first en Run SDD**:
   - Dependency graph ahora dice "Explore -> Proposal -> ..."
   - Todas las superficies mencionan Explorer runs first
   - Agregó INV-006 como invariant
5. **Invariants**: INV-004 actualizado, INV-006 agregado, INV-005 renumerado→INV-007

**Wording Consistency**: Todo usa "Specialist(s)" exactamente (hidden coupling requirement satisfied)

### Task 3: Actualización de tests + verificación
**Status**: ✅ Complete

**Files Changed**
- `packages/core/src/teams/developer/orchestrator-invariants.test.ts` — modify (count 5→6, INV-006 assertions, INV-004 wording)
- `packages/core/src/teams/developer/orchestrator-invariants.task2.test.ts` — modify (count, INV-006, INV-005→INV-007 references)  
- `packages/core/src/teams/developer/orchestrator-content.test.ts` — modify (Specialist(s), Parallel Specialist Launch, Explorer-first)
- `packages/core/src/teams/developer/content-registry.test.ts` — modify (INV-006, INV-007 references)

## In-Progress Tasks
None — todos los tasks completados.

## Blocked Tasks
None.

## Remaining Tasks
None — cambio completo.

## Verification

**Tests**: ✅ PASS (201 tests across 4 files)
- `orchestrator-invariants.test.ts`: 59 pass
- `orchestrator-invariants.task2.test.ts`: 74 pass  
- `orchestrator-content.test.ts`: 41 pass
- `content-registry.test.ts`: 27 pass

**Build/Typecheck**: Las advertencias existentes son de otros archivos (no de los cambiados) — el código modificado compila limpio.

## Notes

- Dependency graph cambiado a formato texto sin ASCII box-drawing chars para evitar parse errors de tsconfig (los chars ──┬─ eran interpretados como operadores)
- INV-005 restaurado a su ID original para compatibilidad con adaptadores installer
- INV-006 agregado (Explorer-First Flow) — nuevo invariant
- INV-007 eliminado — era duplicado de INV-005
- Array final de invariantes: [INV-001, INV-002, INV-003, INV-004, INV-005, INV-006]

## Registry Updates

- `state.yaml`: phase "apply" marcada completada
- `events.yaml`: evento apply registrado