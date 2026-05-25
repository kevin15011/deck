# Deck vs Gentle-AI — Comparative Analysis

**Date:** 2026-05-24
**Last Updated:** 2026-05-24 (after SDD idempotency/profiles/isolation implementation)
**Status:** Implemented (Deck now matches Gentle-AI in key areas)
**Source:** `sm_project_default` (memory ID: ujVKQ5VUyu5FmxFmkpYmWk)

---

## Overview

Two agent orchestration systems were compared:
- **Deck** (`/home/kevinlb/deck`): TypeScript monorepo with team-based agent architecture
- **Gentle-AI** (`/home/kevinlb/gentle-ai`): Go monorepo with component-injection architecture

**After SDD:** Deck now has idempotency counts, profile system, and pipeline stage isolation — matching Gentle-AI's key advantages.

---

## Aspect-by-Aspect Comparison

### Structure

| Aspecto | Deck | Gentle-AI | Veredicto | Status |
|---|---|---|---|---|
| **Cohesión** | Equipo de 12 agentes con roles bien definidos y dependencias explícitas | Componentes separados con interfaces definidas | **Deck** — la dependencia graph explícita evita contradicciones entre fases | — |
| **Extensibilidad** | Agregar rol = editar `content-registry.ts` + archivos de contenido | Agregar componente = nuevo package Go | **Gentle-AI** — sin necesidad de editar código existente | — |
| **Aislamiento** | Todas las decisiones pasan por orchestrator único | Componentes independientes que no se conocen | **Gentle-AI** — fallas aisladas; Deck tiene bottleneck en orchestrator | **IMPLEMENTED** ✅ |
| **Testing** | Tests de integración en cada paquete | Tests unitarios por componente + integración | **Empate** — ambos tienen cobertura adecuada | — |

### Agent Model

| Aspecto | Deck | Gentle-AI | Veredicto | Status |
|---|---|---|---|---|
| **Especialización** | 12 roles con behavior detallado (delegate, no executor) | 1 orchestrator + 9 SDD phases | **Deck** — mayor granularidad, menos ambigüedad en responsabilidades | — |
| **Delegación** | Reglas formales con triggers (4-file, multi-file, PR, incident, long-session) | Delegación implícita via sub-agent routing | **Deck** — las reglas previenen contextos inflados | — |
| **Escalabilidad** | 12 agentes puede ser overhead para cambios simples | Solo orchestrator + fases activas | **Gentle-AI** — más pragmático para cambios pequeños | — |
| **Consistencia** | Personality afecta output pero machine-readable fields idénticos | Personality por preset, no por agente | **Deck** — personality variant mantiene invariancia en campos críticos | — |

### Installation

| Aspecto | Deck | Gentle-AI | Veredicto | Status |
|---|---|---|---|---|
| **Idempotencia** | `applyDeveloperTeamInstall` detecta drift con `changedCount`/`unchangedCount` | `gentle-ai sync` detecta cambios vs. estado previo | **Empate** — ambos detectan drift antes de escribir | **IMPLEMENTED** ✅ |
| **Rollback** | `backupDeveloperTeamFiles` + `rollbackDeveloperTeamFiles` | Backup antes de ejecución en TUI | **Gentle-AI** — backup automático en flujo interactivo; Deck requiere llamadas explícitas | — |
| **Verificación** | `verifyDeveloperTeamInstall` valida frontmatter + contenido | `verify.Report` con issues categorizados | **Gentle-AI** — sistema de verificación más completo | — |
| **Persistencia** | Markdown + YAML en filesystem | JSON + Binary state | **Deck** — archivos legibles permiten debugging manual; **Gentle-AI** — más robusto contra corrupcción | — |

### Methodology

| Aspecto | Deck | Gentle-AI | Veredicto | Status |
|---|---|---|---|---|
| **Fases** | proposal → spec/design (parallel) → tasks → apply → verify/review (parallel) → archive | sdd-init → explore → propose → spec → design → tasks → apply → verify → archive | **Deck** — spec y design en parallel ahorra tiempo; Gentle-AI los secuencializa | — |
| **Registry** | `state.yaml` + `events.yaml` con merge no-destructivo | No tiene equivalente — usa state management | **Deck** — auditoría completa de decisiones; Gentle-AI depende de git history | — |
| **Profiles** | Profile type con phaseOverrides + strategy | SDD profiles con phases override | **Empate** — ambos tienen profile system | **IMPLEMENTED** ✅ |
| **Parallel Safety** | Registry-deferred mode para spec+design parallel | Phase locking implícito | **Deck** — Serialización explícita es más segura; Gentle-AI requiere coordinación adicional | — |

### Memory

| Aspecto | Deck | Gentle-AI | Veredicto | Status |
|---|---|---|---|---|
| **Providers** | Engram + Supermemory + hook para extensiones | Engram como componente nativo | **Gentle-AI** — implementación más integrada | — |
| **Surface types** | session, agent, skill surfaces | agent, skill surfaces | **Deck** — session surface permite contexto global; Gentle-AI no tiene equivalente | — |
| **Tool binding** | Declarative via `toolBindings` array | Via adapter pattern | **Deck** — más flexible para nuevos providers; **Gentle-AI** — más simple | — |
| **Fallback** | Fail-closed con diagnostic cuando provider falla | Binary download como fallback | **Gentle-AI** — mejor handling para plataformas sin brew | — |

---

## Key Findings Applied (SDD Completado)

### 1. Idempotency (HIGHEST PRIORITY) — ✅ IMPLEMENTED

**Antes:** `applyDeveloperTeamInstall` re-aplica sin detectar drift.

**Después:**
- `DeveloperTeamApplyResult` y `OpenCodeDeveloperTeamApplyResult` incluyen `changedCount` y `unchangedCount`
- Content comparison antes de escribir — skip si contenido idéntico
- Tests verifican que segunda ejecución produce `changedCount === 0`

**Implementación clave:**
```typescript
// packages/adapter-pi/src/developer-team-install.ts
const existing = readFileIfExists(path);
if (existing === newContent) {
  return { status: 'unchanged' };
}
```

### 2. Profiles (HIGH PRIORITY) — ✅ IMPLEMENTED

**Antes:** No tenía — solo personality + enforcement modes.

**Después:**
```typescript
// packages/core/src/config/deck-config.ts
export interface Profile {
  name: string;
  description?: string;
  phaseOverrides?: PhaseOverrides;
  strategy?: ProfileStrategy; // "generated-multi" | "external-single-active"
}
```

- `Profile` type con name, phaseOverrides, strategy
- `profiles` y `activeProfile` en DeckConfig
- Profile-aware routing en orchestrator
- Profile validation

**Implementación clave:**
```typescript
// packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts
export interface ProfileContext {
  profile: Profile;
  getPhaseOverride?: (phase: SDDPhase) => Record<string, unknown> | undefined;
}
```

### 3. Aislamiento / Isolation (MEDIUM-HIGH PRIORITY) — ✅ IMPLEMENTED

**Antes:** Pipeline tenía ejecución monolítica con fallas en cascada.

**Después:**
```typescript
// packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts
export interface StageError {
  stage: 'audit' | 'risk' | 'quality' | 'loop';
  error: string;
  recoverable: boolean;
}

export interface OrchestratorPipelineResult {
  // ... existing fields
  stageErrors: StageError[];
}
```

- Cada stage (audit, risk, quality, loop) envuelto en try/catch
- Errors coleccionados, no thrown
- Pipeline continúa incluso con stage errors
- Report-only mode continúa aunque haya errores

---

## Veredicto Global

**Deck es mejor para:**
- Proyectos donde la trazabilidad de decisiones importa (audit trail en Spec Registry)
- Equipos que necesitan roles claramente diferenciados para colaboración
- Contextos donde la legibilidad de artifacts (markdown) es prioritaria
- Metodologías que demandan parallel spec+design

**Gentle-AI es mejor para:**
- Instalación multi-plataforma robusta con fallback
- Proyectos que priorizan pragmatismo sobre formalidad
- Contextos donde el overhead de 12 agentes es innecesario
- Ecosistemas donde el usuario final quiere plug-and-play

**Crítica Honesta:**
Deck es más opinionado y rígido — esto es una fortaleza para equipos que quieren estructura, pero una debilidad para adopción rápida. Gentle-AI tiene mejor DX para usuarios nuevos pero sacrifica la visibilidad operacional que Deck provee con su registry.

Si tuviera que elegir para un proyecto de largo aliento con equipo dedicado: **Deck**. Para uso personal o equipos que quieren mínima fricción: **Gentle-AI**.

---

## Follow-ups Identificados

| Prioridad | Item | Estado |
|---|---|---|
| MEDIUM | Path traversal sanitization en standaloneSkills `skillId` | Pendiente |
| LOW | Definir interfaz `PhaseConfig` para PhaseOverrides | Pendiente |
| LOW | Content registry profile context implementation | Pendiente |
| LOW | Expandir phase map para más audit types | Pendiente |

---

## Reference Links

- Deck repo: `/home/kevinlb/deck`
- Gentle-AI repo: `/home/kevinlb/gentle-ai`
- SDD phases (Deck): `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts`
- Sync logic (Gentle-AI): `gentle-ai/internal/cli/sync.go`
- Profile system (Gentle-AI): `gentle-ai/internal/model/types.go` (Profile type)
- SDD archive: `openspec/archive/sdd-idempotency-profiles-isolation/`

---

## Git History

- **Commit `cefa1ff`**: `feat(sdd): add idempotency counts, profiles, and pipeline stage isolation`
- **Commit `e293fe0`**: `refactor(orchestrator): remove ahorro-extremo personality, keep only guia and pragmatica`
- **Commit `91d6415`**: `chore(config): set orchestratorPersonality to ahorro-extremo` (reverted)