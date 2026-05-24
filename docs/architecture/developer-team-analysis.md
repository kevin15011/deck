# Arquitectura Developer Team — Análisis y Mejoras

> Documento de trabajo para sesión de arquitectura.
> Generado: 2026-05-23

---

## Resumen Ejecutivo

La arquitectura actual del Developer Team (agentes + instruction bundles + memory providers) es **escalable en su diseño central** pero tiene áreas de mejora importantes en:
- DRY (Don't Repeat Yourself) en instruction bundles
- Validación de contratos
- Centralización excesiva (god objects)
- Versionamiento y rollback
- Casos edge como runners no-filesystem

---

## Estructura Actual del Sistema

### Capas de la Arquitectura

```
packages/core (definiciones neutrales)
├── teams/developer/
│   ├── catalog.ts              ← 12 agentes definidos (id, name, skillId)
│   ├── content-registry.ts     ← map agentId → {agentBody, skillBody}
│   ├── manifest.ts             ← construye DeveloperTeamManifest
│   ├── *-content.ts          ← prompts reales de cada agente
│   └── instruction-bundles/   ← paquetes de instrucciones
│       ├── index.ts           ← registry de builders
│       ├── adaptive-memory.ts
│       ├── codebase-memory.ts
│       ├── context-mode.ts
│       └── rtk.ts
└── runner-capability.ts        ← puerto RunnerCapabilities

packages/adapter-opencode/     ← serializa a formato OpenCode
packages/adapter-pi/           ← serializa a formato PI
```

### Cómo Funciona el Pipeline

1. **TUI** llama a `runner.developerTeam.buildInstallPlan()`
2. **Core** `buildDeveloperTeamManifest()` itera sobre agentes + obtiene contenido
3. **Adapter** `buildDeveloperTeamInstallPlan(manifest)` serializa a su formato
4. **Adapter** `applyDeveloperTeamInstall(plan)` escribe archivos al filesystem
5. **Runner** levanta los agentes desde su ubicación nativa

### Escalabilidad para Múltiples Runners

- **Core es runner-neutral**: no sabe nada de OpenCode/PI
- **Content es centralizado**: prompts viven en core, adapters solo serializan
- **RunnerCapabilities** es el puerto/interface que todo runner implementa
- **Agregar runner nuevo** = crear adapter que implemente el puerto

---

## Oportunidades de Mejora

### 1. DUPLICACIÓN EN INSTRUCTION BUNDLES ⚠️ ALTA PRIORIDAD

**Problema:** Cada package builder tiene el mismo markdown copiado en `surface: "agent"`, `surface: "skill"`, y `surface: "session"`.

```typescript
// adaptive-memory.ts — 182 líneas (3 surfaces)
// codebase-memory.ts — 110 líneas (2 surfaces)
// Los fragments de session son versiones reducidas del mismo contenido
```

**Impacto:**
- Si cambias convención de container tags → cambiar en 4+ archivos
- Alto riesgo de inconsistencias
- Mantenimiento costoso

**Archivos afectados:**
- `packages/core/src/teams/developer/instruction-bundles/adaptive-memory.ts`
- `packages/core/src/teams/developer/instruction-bundles/codebase-memory.ts`
- `packages/core/src/teams/developer/instruction-bundles/context-mode.ts`
- `packages/core/src/teams/developer/instruction-bundles/rtk.ts`

**Mejora sugerida:**
- Crear módulo `common-fragments.ts` con contenido base compartido
- Sistema de variantes por surface (ej: base + "_agent" + "_skill" + "_session")
- O tener un solo archivo `fragments.ts` por paquete con estructura reutilizable

---

### 2. NO HAY VALIDACIÓN EN RunnerCapabilities ⚠️ ALTA PRIORIDAD

**Problema:** `runner-capability.ts` define interfaces enormes pero no hay mecanismo para validar que un adapter implementa el contrato completo.

```typescript
export type RunnerCapabilities = {
  id: RunnerId;
  environments: readonly RunnerEnvironment[];
  inspectEnvironment(...): Promise<RunnerEnvironmentInspection>;
  tools: RunnerToolCapabilities;
  teams: RunnerTeamCapabilities;
  models: RunnerModelCapabilities;
  memory: RunnerMemoryCapabilities;
  // ... 10+ facets
  // ¿Qué pasa si un adapter solo implementa 3?
};
```

**Impacto:**
- Errores en runtime cuando falta una implementación
- Agregar nuevo runner = "confía en que implementes todo bien"
- No hay forma de detectar que falta algo antes de ejecutar

**Archivos afectados:**
- `packages/core/src/runner-capability.ts`

**Mejora sugerida:**
- Crear función `validateRunnerCapabilities(capabilities: RunnerCapabilities): ValidationResult`
- Definir `REQUIRED_CAPABILITIES = ['id', 'environments', 'inspectEnvironment', 'teams'] as const`
- O tener un `PartialRunnerCapabilities` que el sistema sepa que某些facets son opcionales

---

### 3. CONTENT-REGISTRY ES GOD OBJECT ⚠️ MEDIA PRIORIDAD

**Problema:** 287 líneas con un map `REAL_CONTENT` estático. Cada nuevo agente requiere editar este archivo central.

```typescript
const REAL_CONTENT: Record<string, { agentBody: string; skillBody: string }> = {
  "deck-developer-orchestrator": { ... },
  "deck-developer-explorer": { ... },
  // 12 entradas... y crece
};
```

**Impacto:**
- Para agregar un nuevo agente → editar archivo central
- No hay lazy loading (todo se carga aunque no se use)
- Testing requiere mockear todo el registry

**Archivo afectado:**
- `packages/core/src/teams/developer/content-registry.ts`

**Mejora sugerida:**
- Split por dominio/runner (ej: `registry-explorer.ts`, `registry-proposal.ts`)
- Sistema de plugin donde cada contenido se auto-registre
- Factory pattern: `createRegistry(agentPlugins[])`

---

### 4. LOS `*-CONTENT.TS` SON STRINGS SIN ESTRUCTURA ⚠️ MEDIA PRIORIDAD

**Problema:** Los archivos como `orchestrator-content.ts` contienen strings literales enormes (500+ líneas). No hay:
- Validación de estructura
- Autocomplete para placeholders
- Linting

```typescript
export const ORCHESTRATOR_AGENT_BODY = `
# Orchestrator Agent
> 500+ líneas de string sin estructura
`;
```

**Impacto:**
- No hay forma de validar que el prompt sigue una estructura
- Difícil de mantener
- Placeholders como `{{model}}` o `{{runner}}` no tienen validación

**Archivos afectados:**
- `packages/core/src/teams/developer/*-content.ts` (todos)

**Mejora sugerida:**
- Crear schema para prompts (ej: secciones requeridas: Purpose, Instructions, Constraints)
- Usar template literals con tipos más fuertes
- O usar lenguaje de dominio (DSL) para definir prompts

---

### 5. NO HAY VERSIONAMIENTO DE CONTENIDOS ⚠️ MEDIA PRIORIDAD

**Problema:** Los `*-content.ts` no tienen versiones. Si cambias el prompt del Orchestrator:
- No hay forma de saber qué versión estaba activa
- No hay rollback si el nuevo prompt rompe algo
- No hay diff entre versiones

```typescript
// Solo hay un ORCHESTRATOR_AGENT_BODY
// No hay ORCHESTRATOR_AGENT_BODY_V2
```

**Impacto:**
- Cambios en prompts pueden romper en producción sin forma de revertir
- No hay AB testing de prompts
- No hay historial de cambios

**Mejora sugerida:**
- Versionar exports: `export const ORCHESTRATOR_AGENT_BODY = { current: "...", v1: "...", v2: "..." }`
- O usar archivo separado `orchestrator-content.v1.ts`
- O integrar con git hooks para trackear cambios

---

### 6. ACOPLAMIENTO IMPLÍCITO EN INSTRUCTION BUNDLES ⚡ BAJA PRIORIDAD

**Problema 1:** Orden de `PACKAGE_ORDER` no configurable desde fuera.

```typescript
const PACKAGE_ORDER: CapabilityInstructionPackageId[] = [
  "codebase-memory",
  "context-mode",
  "rtk",
  "adaptive-memory",
];
```

**Problema 2:** Lógica confusa para "aplica a todos los agentes":
```typescript
if (fragment.agentIds !== undefined && fragment.agentIds.length > 0) {
  // Si array vacío NO aplica, pero undefined SÍ aplica a todos
}
```

**Impacto:**
- Difícil de debuggear qué fragments aplican a qué agente
- No hay logging de qué se aplicó
- Orden de prioridad no visible

**Archivo afectado:**
- `packages/core/src/teams/developer/instruction-bundles/index.ts`

**Mejora sugerida:**
- Hacer orden configurable por runner via config
- Agregar `trace: true` flag para logging de composición
- Clarificar semántica de `agentIds: undefined` vs `[]`

---

### 7. MANIFEST NO VALIDA CONTENIDO ⚡ MEDIA PRIORIDAD

**Problema:** `buildDeveloperTeamManifest` no valida:
- Que cada agente tenga contenido real (no solo placeholder)
- Que los modelos asignados existan en el catalog
- Que no haya conflictos entre memoryBundle y capabilityInstructions

```typescript
agents.push({
  agentId: agentDef.id,
  instruction: content?.agentBody ?? buildPlaceholderAgentBody(agentDef),
  // Si content es undefined, silently usa placeholder
});
```

**Impacto:**
- Un adapter podría instalar agentes con placeholder bodies sin saberlo
- No hay forma de detectar "agente no implementado" hasta runtime

**Archivo afectado:**
- `packages/core/src/teams/developer/manifest.ts`

**Mejora sugerida:**
- `buildDeveloperTeamManifest` retorna warnings/ errors
- Opción `strict: true` que falle si hay placeholders
- Validación post-build: `validateManifest(manifest): ValidationResult`

---

### 8. NO CONTOEMPLA RUNNERS NO-FILESYSTEM ⚠️ ALTA PRIORIDAD

**Problema:** Todo assume filesystem y "project root". Pero qué pasa con:
- Servicios web
- Plugins de IDE sin acceso directo a filesystem
- Runners basados en API

```typescript
export type DeveloperTeamManifest = {
  agents: readonly DeveloperTeamManifestAgent[];
  skills: readonly DeveloperTeamManifestSkill[];
  // ... todo asume filesystem
};
```

**Impacto:**
- Arquitectura no es verdaderamente runner-agnóstica
- Limitado a runners con concepto de filesystem

**Archivos afectados:**
- `packages/core/src/runner-capability.ts`
- `packages/core/src/teams/developer/manifest.ts`
- Todos los adapters

**Mejora sugerida:**
- Separar "filesystem operations" de "content operations"
- Definir `ContentProvider` interface:
  ```typescript
  interface ContentProvider {
    getAgentContent(agentId: string): Promise<string>;
    getSkillContent(skillId: string): Promise<string>;
  }
  ```
- Implementaciones: `FilesystemContentProvider`, `HttpContentProvider`, `MemoryContentProvider`

---

### 9. NO HAY ESTRATEGIA DE FALLBACK PARA CONTENT-REGISTRY ⚡ BAJA PRIORIDAD

**Problema:** Si `getAgentContent` no encuentra el agentId, retorna `undefined`. No hay:
- Fallback a agente genérico
- Suggestion de qué agente usar ("did you mean X?")
- Error con contexto

```typescript
const real = REAL_CONTENT[agentId];
if (real) return withAuthorityGuidance(real);
// Silently returns undefined
```

**Impacto:**
- Errores difíciles de debuggear ("¿por qué este agente no tiene contenido?")
- Sin ayuda para typos en agentId

**Mejora sugerida:**
- `getAgentContent` retorna `Result<AgentContent, AgentContentError>`
- Error incluye suggestions de agents similares
- Fallback a "unknown-agent" con contenido genérico

---

## Priorización Sugerida

| # | Problema | Severidad | Facilidad | Prioridad |
|---|----------|-----------|-----------|-----------|
| 1 | Duplicación instruction bundles | Alta | Fácil | 🔴 Inmediato |
| 2 | No validation RunnerCapabilities | Alta | Medio | 🔴 Inmediato |
| 3 | God Object content-registry | Media | Medio | 🟡 Esta sesión |
| 4 | Strings sin estructura | Media | Bajo | 🟡 Esta sesión |
| 5 | No versionamiento | Media | Fácil | 🟡 Esta sesión |
| 6 | Acoplamiento bundles | Baja | Medio | 🟢 Posteror |
| 7 | No valida manifest | Media | Fácil | 🟡 Esta sesión |
| 8 | No runners no-filesystem | Alta | Difícil | 🔴 Arq. futura |
| 9 | No fallback registry | Baja | Fácil | 🟢 Posteror |

---

## Próximos Pasos Sugeridos

### Para esta sesión (quick wins):
1. Crear `common-fragments.ts` para contenido compartido en instruction bundles
2. Agregar `validateRunnerCapabilities()` en core
3. Agregar validación de placeholders en `manifest.ts`

### Para sesión dedicada (arquitectura):
1. Refactorizar `content-registry.ts` a plugin system
2. Diseñar `ContentProvider` interface para runners no-filesystem
3. Implementar versionamiento de contenidos

---

## Notas de Conversación (2026-05-23)

- Kevin quiere arquitectura escalable para múltiples runners
- PI tiene limitación: no soporta main agents → Orchestrator como system prompt con flag
- OpenCode sí soporta main agents → más directo
- La arquitectura maneja esto bien (adapters diferentes, mismo core)
- Kevin quiere impartial y crítico → el análisis arriba refleja eso

---

## Archivos Clave Referenciados

### Core
- `packages/core/src/teams/developer/catalog.ts` — 12 agentes
- `packages/core/src/teams/developer/content-registry.ts` — content map
- `packages/core/src/teams/developer/manifest.ts` — manifest builder
- `packages/core/src/teams/developer/*-content.ts` — prompts
- `packages/core/src/teams/developer/instruction-bundles/*.ts` — bundles
- `packages/core/src/runner-capability.ts` — RunnerCapabilities port

### Adapters
- `packages/adapter-opencode/src/developer-team-install.ts`
- `packages/adapter-pi/src/developer-team-install.ts`
- `packages/adapter-opencode/src/runner-capabilities.ts`
- `packages/adapter-pi/src/runner-capabilities.ts`