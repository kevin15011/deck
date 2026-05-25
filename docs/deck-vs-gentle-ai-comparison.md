# Deck vs Gentle-AI — Comparative Analysis

**Date:** 2026-05-24
**Status:** Completed
**Source:** `sm_project_default` (memory ID: ujVKQ5VUyu5FmxFmkpYmWk)

---

## Overview

Two agent orchestration systems were compared:
- **Deck** (`/home/kevinlb/deck`): TypeScript monorepo with team-based agent architecture
- **Gentle-AI** (`/home/kevinlb/gentle-ai`): Go monorepo with component-injection architecture

---

## Aspect-by-Aspect Comparison

### Structure

| Aspecto | Deck | Gentle-AI | Veredicto |
|---|---|---|---|
| **Cohesión** | Equipo de 12 agentes con roles bien definidos y dependencias explícitas | Componentes separados con interfaces definidas | **Deck** — la dependencia graph explícita evita contradicciones entre fases |
| **Extensibilidad** | Agregar rol = editar `content-registry.ts` + archivos de contenido | Agregar componente = nuevo package Go | **Gentle-AI** — sin necesidad de editar código existente |
| **Aislamiento** | Todas las decisiones pasan por orchestrator único | Componentes independientes que no se conocen | **Gentle-AI** — fallas aisladas; Deck tiene bottleneck en orchestrator |
| **Testing** | Tests de integración en cada paquete | Tests unitarios por componente + integración | **Empate** — ambos tienen cobertura adecuada |

### Agent Model

| Aspecto | Deck | Gentle-AI | Veredicto |
|---|---|---|---|
| **Especialización** | 12 roles con behavior detallado (delegate, no executor) | 1 orchestrator + 9 SDD phases | **Deck** — mayor granularidad, menos ambigüedad en responsabilidades |
| **Delegación** | Reglas formales con triggers (4-file, multi-file, PR, incident, long-session) | Delegación implícita via sub-agent routing | **Deck** — las reglas previenen contextos inflados |
| **Escalabilidad** | 12 agentes puede ser overhead para cambios simples | Solo orchestrator + fases activas | **Gentle-AI** — más pragmático para cambios pequeños |
| **Consistencia** | Personality afecta output pero machine-readable fields idénticos | Personality por preset, no por agente | **Deck** — personality variant mantiene invariancia en campos críticos |

### Installation

| Aspecto | Deck | Gentle-AI | Veredicto |
|---|---|---|---|
| **Idempotencia** | `applyDeveloperTeamInstall` re-aplica sin duplicar | `gentle-ai sync` detecta cambios vs. estado previo | **Gentle-AI** — estrategia de sync es más madura (detecta drift) |
| **Rollback** | `backupDeveloperTeamFiles` + `rollbackDeveloperTeamFiles` | Backup antes de ejecución en TUI | **Gentle-AI** — backup automático en flujo interactivo; Deck requiere llamadas explícitas |
| **Verificación** | `verifyDeveloperTeamInstall` valida frontmatter + contenido | `verify.Report` con issues categorizados | **Gentle-AI** — sistema de verificación más completo |
| **Persistencia** | Markdown + YAML en filesystem | JSON + Binary state | **Deck** — archivos legibles permiten debugging manual; **Gentle-AI** — más robusto contra corrupcción |

### Methodology

| Aspecto | Deck | Gentle-AI | Veredicto |
|---|---|---|---|
| **Fases** | proposal → spec/design (parallel) → tasks → apply → verify/review (parallel) → archive | sdd-init → explore → propose → spec → design → tasks → apply → verify → archive | **Deck** — spec y design en parallel ahorra tiempo; Gentle-AI los secuencializa |
| **Registry** | `state.yaml` + `events.yaml` con merge no-destructivo | No tiene equivalente — usa state management | **Deck** — auditoría completa de decisiones; Gentle-AI depende de git history |
| **Profiles** | No tiene — usa personality + enforcement modes | SDD profiles con phases override | **Gentle-AI** — profiles permiten personalización sin tocar código |
| **Parallel Safety** | Registry-deferred mode para spec+design parallel | Phase locking implícito | **Deck** — Serialización explícita es más segura; Gentle-AI requiere coordinación adicional |

### Memory

| Aspecto | Deck | Gentle-AI | Veredicto |
|---|---|---|---|
| **Providers** | Engram + Supermemory + hook para extensiones | Engram como componente nativo | **Gentle-AI** — implementación más integrada |
| **Surface types** | session, agent, skill surfaces | agent, skill surfaces | **Deck** — session surface permite contexto global; Gentle-AI no tiene equivalente |
| **Tool binding** | Declarative via `toolBindings` array | Via adapter pattern | **Deck** — más flexible para nuevos providers; **Gentle-AI** — más simple |
| **Fallback** | Fail-closed con diagnostic cuando provider falla | Binary download como fallback | **Gentle-AI** — mejor handling para plataformas sin brew |

---

## Key Findings to Apply (Priority Order)

### 1. Idempotency (HIGHEST PRIORITY)

Gentle-AI's sync mechanism:
- Compares current state vs. desired state before writing
- Only writes delta (changed files)
- Reports `FilesChanged: 0` when nothing needed
- Uses `verify.Report` with categorized issues

**Action:** Enhance `applyDeveloperTeamInstall` and `applyOpenCodeDeveloperTeamInstall` to:
- Compare existing file content before writing
- Skip write if content identical
- Return detailed change report

### 2. Profiles (HIGH PRIORITY)

Gentle-AI's profile system:
- Named profiles with phase overrides
- `--profile` and `--profile-phase` flags
- Strategy selection: `generated-multi` vs `external-single-active`

**Action:** Add SDD profiles to Deck:
- `Profile` type with phase customization
- Profile-aware routing in orchestrator
- Profile persistence in config

### 3. Aislamiento / Isolation (MEDIUM-HIGH PRIORITY)

Gentle-AI's component isolation:
- Components don't know about each other
- Each component has isolated inject/verify/run
- Failures in one component don't cascade

**Action:** Introduce component boundaries in orchestrator pipeline:
- Separate concerns: audit → risk → quality → loop
- Each stage has isolated config and error handling
- Pipeline continues even if one stage has issues (report-only mode)

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

## Reference Links

- Deck repo: `/home/kevinlb/deck`
- Gentle-AI repo: `/home/kevinlb/gentle-ai`
- SDD phases (Deck): `packages/sdd-runtime/src/orchestrator/orchestrator-pipeline.ts`
- Sync logic (Gentle-AI): `gentle-ai/internal/cli/sync.go`
- Profile system (Gentle-AI): `gentle-ai/internal/model/types.go` (Profile type)