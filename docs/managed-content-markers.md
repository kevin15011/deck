# Managed Content Markers — Architecture Decision

## Context

Deck inyecta contenido en prompts de agentes (OpenCode, Pi) y en archivos de skills. Este contenido incluye:
- Package Instructions (comportamiento de herramientas como `codebase-memory`, `context-mode`, `adaptive-memory`, `rtk`)
- Memory Injection (instrucciones de memoria adaptativa)
- Team Session Instructions (reglas del orchestrator)

## Problema

Actualmente Deck **sobrescribe completamente** los prompts generados. Esto significa:
1. Si el usuario modifica un prompt manualmente, Deck borra sus cambios en la próxima instalación
2. No hay forma de distinguir "esto lo puso Deck" vs "esto lo puso el usuario"
3. Los updates de Deck no pueden ser incrementales — siempre son reemplazo total

## Decisión

Implementar **managed content markers** — comentarios HTML/XML que delimitan secciones que Deck controla, permitiendo merge inteligente en lugar de overwrite.

## Especificación

### Format

```markdown
<!-- deck-managed:{section-id}:start -->
## {Section Title}

Contenido inyectado por Deck...

<!-- deck-managed:{section-id}:end -->
```

### Section IDs

| ID | Descripción | Contenido |
|---|---|---|
| `package-instructions` | Package Instructions configuradas | Todos los fragments de package instructions |
| `memory-injection` | Instrucciones de memoria adaptativa | Protocolo de memoria + routing del provider activo |
| `team-session` | Instrucciones de sesión del equipo | Reglas del orchestrator para SDD |
| `context-authority` | Reglas de autoridad de contexto | OpenSpec vs adaptive memory |

### Ejemplo

```markdown
# Deck Developer Orchestrator

Eres el orchestrator del Deck Developer Team...

## Reglas personalizadas del usuario

El usuario puede agregar sus propias reglas aquí...

<!-- deck-managed:package-instructions:start -->
## Package Instructions (configured)

Estas instrucciones están habilitadas por `.deck/config.json`.

### Codebase Memory Package
Use el codebase knowledge graph para...

### Adaptive Memory Package
Adaptive memory persiste decisiones...

<!-- deck-managed:package-instructions:end -->

<!-- deck-managed:memory-injection:start -->
## Adaptive Memory — Routing

Provider activo: supermemory
- Herramientas MCP disponibles: `supermemory.execute` y `supermemory.search_docs`
- Uso típico:
  - Buscar: `supermemory.execute` con `client.search.memories` o `client.search.documents`
  - Guardar: `supermemory.execute` con `client.add`
  - Perfil: `supermemory.execute` con `client.profile`
- Tags: user={userId}, team=developer, org={orgId}, project={project}
- **Auth**: OpenCode usa `{env:SUPERMEMORY_API_KEY}` en `opencode.json` — OpenCode resuelve la variable al iniciar. El token real nunca se almacena en disco.

<!-- deck-managed:memory-injection:end -->

## Más reglas personalizadas

El usuario puede seguir agregando aquí...
```

## Estrategia de Merge

### En la instalación/update

1. **Leer prompt existente** (si existe)
2. **Parsear markers** — identificar todas las secciones `deck-managed`
3. **Generar nuevo contenido** para cada sección managed
4. **Reemplazar** las secciones managed existentes con las nuevas
5. **Preservar** todo el contenido fuera de los markers
6. **Escribir** el resultado

### Si no hay prompt existente

1. Generar prompt completo con todos los markers
2. Escribir

### Si no hay markers en un prompt existente (legacy)

1. **Opción A**: Tratar todo el prompt como "user content", wrap con markers
2. **Opción B**: Sobreescribir con nuevo prompt (comportamiento actual)
3. **Recomendado**: Opción A con backup del prompt original

## Ventajas

1. **Updates seguros**: Deck solo toca lo que le pertenece
2. **Personalización preservada**: El usuario puede agregar reglas sin que Deck las borre
3. **Rollback posible**: Con los markers se puede identificar exactamente qué hay que quitar
4. **Debugging**: Fácil identificar qué contenido viene de qué source
5. **Multi-tool coexistencia**: Si el usuario usa otras herramientas que inyectan prompts, cada una usa sus propios markers

## Consideraciones

### Performance
- El parseo de markers es O(n) en el tamaño del prompt
- Regex simple: `/<!--\s*deck-managed:([^:]+):(start|end)\s*-->/g`

### Colisiones
- Los IDs son namespaced por `deck-managed`, evitando colisiones con otras herramientas
- Si otra herramienta usa el mismo namespace, es un bug de esa herramienta

### Backward Compatibility
- Prompts existentes sin markers deben migrarse
- Primera vez con markers: hacer backup del prompt original

## Implementación

### Archivos a modificar

1. `packages/adapter-opencode/src/prompt-generation.ts` — Wrap content con markers
2. `packages/adapter-pi/src/prompt-generation.ts` — Wrap content con markers (si existe)
3. `packages/adapter-opencode/src/prompt-merge.ts` — Nuevo: merge logic
4. `packages/adapter-pi/src/prompt-merge.ts` — Nuevo: merge logic (si existe)

### API propuesta

```typescript
// prompt-merge.ts
export interface PromptMergeResult {
  content: string;
  changes: {
    sectionId: string;
    action: 'added' | 'updated' | 'removed';
  }[];
}

export function mergePromptWithManagedSections(
  existingContent: string | undefined,
  managedSections: Map<string, string>, // sectionId → content
): PromptMergeResult;

export function extractManagedSections(content: string): Map<string, string>;

export function removeManagedSections(content: string): string;
```

## Referencias

- Issue relacionado: El hotfix de `opencode-launch-command.ts` que agrega `capabilityInstructions` al install plan
- Archivos afectados: Todos los prompts generados en `~/.config/opencode/prompts/deck-developer/`

## Estado

**Propuesta** — Pendiente de implementación en un futuro SDD change.

## Limitación de Autenticación MCP para OpenCode — RESUELTO

**Solución encontrada**: OpenCode soporta sintaxis de interpolación de variables de entorno en headers:
```json
"headers": {
  "Authorization": "Bearer {env:SUPERMEMORY_API_KEY}"
}
```

**Cómo funciona**:
1. Deck escribe el token como referencia `{env:SUPERMEMORY_API_KEY}` en opencode.json
2. OpenCode resuelve la variable al iniciar el MCP server
3. El token real nunca se almacena en disco — solo la referencia

**Cambios realizados**:
- `packages/adapter-opencode/src/opencode-mcp-config.ts` — ahora escribe `headers.Authorization` con interpolación de env var
- URL actualizada a `https://mcp.supermemory.ai/mcp` (endpoint correcto de Supermemory para OpenCode)
- Installer también escribe `export SUPERMEMORY_API_KEY="token"` en `~/.bashrc` para que la variable esté disponible en futuras sesiones

**Flujo después de reinstall**:
1. El installer escribe `export SUPERMEMORY_API_KEY="tu-token"` en `~/.bashrc`
2. Cerrar y reabrir la terminal (o hacer `source ~/.bashrc`)
3. OpenCode resuelve `{env:SUPERMEMORY_API_KEY}` desde la variable del entorno
