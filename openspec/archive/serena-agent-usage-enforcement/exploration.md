# Exploration: Serena Agent Usage — Scope Analysis

## Goal
Analizar si la solución actual habilita Serena para todos los agentes o solo para apply agents, y si es necesario expandir el alcance antes de continuar Verify/Review/Archive.

## Current State

### Spec y Design actuales
- **Spec REQ-SAE-007**: "Los subagentes no-apply (proposal, spec, design, review, verify) SHOULD recibir instrucciones de coexistencia Serena/codebase-memory cuando Serena esté seleccionado, pero NO necesitan acceso directo a tools Serena de edición."
- **Design línea 34-35**: "Serena debe aportar full symbolic tool access solo a los subagentes apply en este cambio... Otros subagentes pueden recibir instrucciones generales si el bundle está configurado, pero no deben recibir write-capable Serena tools en este rollout salvo que una futura especificación lo pida."

### Policy declarada
- `packages/core/src/teams/developer/instruction-bundles/serena.ts` línea 43:
  ```typescript
  targetAgents: ["deck-developer-apply-backend", "deck-developer-apply-frontend", "deck-developer-apply-general"]
  ```
- Solo 7 herramientas habilitadas para apply: `find_symbol`, `find_referencing_symbols`, `replace_symbol_body`, `rename_symbol`, `get_diagnostics_for_file`, `insert_after_symbol`, `insert_before_symbol`.

### Implementación actual
- `developer-team-install.ts` limita tools a `targetAgents` ✅
- **PROBLEMA**: Los fragments Serena no declaran `agentIds`/`skillIds`, por lo que las instrucciones se propagan globalmente a todos los agentes (hallazgo de Review).

## Relevant Files
- `packages/core/src/teams/developer/instruction-bundles/serena.ts` — policy + fragments
- `packages/adapter-opencode/src/developer-team-install.ts` — tool resolution
- `openspec/changes/serena-agent-usage-enforcement/spec.md` — REQ-SAE-007
- `openspec/changes/serena-agent-usage-enforcement/design.md` — scope decision

## Constraints
- La spec actual dice SHOULD para no-apply, no MUST
- El diseño actual scopea explícitamente solo a apply agents
- Verify falló por typecheck (bloqueador activo)
- Review identificó hallazgo de integración: instrucciones sin filtro

## Risks
- Scope actual no habilita Serena para search/navigation/read-only en no-apply
- Si se amplía scope, hay que distinguir tools read-only vs write-capable
- typecheck failure bloquea verificación completa

## Options and Tradeoffs

| Option | Description | Pros | Cons | Effort |
|---|---|---|---|---|
| 1. Mantener scope actual apply-only | No expandir; resolver typecheck | Cumple spec/diseño original; menor cambio | No habilita Serena para no-apply | Low |
| 2. Expandir a no-apply con tools read-only | Agregar `find_symbol`, `find_referencing_symbols`, `get_symbols_overview` a no-apply | Habilita búsqueda simbólica para explorer/design | Requiere spec amendment; más permisos | Medium |
| 3. Expandir a todos no-apply full | Incluir todas las 7 tools para todos los agentes | Máxima utilidad | Seguridad: write tools para todos; spec violate | High |

## Recommendation
**Option 2**: Expandir scope a no-apply con herramientas read-only (solo búsqueda/navegación):
- Agregar al spec: nueva capability `serena-read-only-enablement` o modificar REQ-SAE-007 a MUST
- Separar tools en dos grupos: read-only (find_symbol, find_referencing_symbols, get_diagnostics_for_file, get_symbols_overview) y write-capable (replace_symbol_body, rename_symbol, insert_after_symbol, insert_before_symbol)
- Actualizar policy para declarar `targetAgents` y `readonlyAgents` separados
- Modificar fragments con `agentIds` para filtrar por tipo de agente

**Acciones inmediatas**:
1. NO continuar Verify/Review/Archive hasta resolver typecheck blocker
2. Expandir spec/design antes de Tasks para reflejar el nuevo alcance

## Open Questions
- ¿El usuario quiere que search/explorer usen `find_symbol` para búsqueda simbólica?
- ¿El usuario acepta que proposal/design/review tengan herramientas read-only pero no de edición?
- ¿O prefieren mantener el scope actual apply-only?

## Ready for Proposal
**No** — el alcance actual no produce el resultado que el usuario desea (Serena amplia para todos los agentes). Se requiere scope expansion antes de continuar.

## Registry
- **Artifact Path**: `openspec/changes/serena-agent-usage-enforcement/exploration.md`
- **State Path**: `openspec/changes/serena-agent-usage-enforcement/state.yaml`
- **Events Path**: `openspec/changes/serena-agent-usage-enforcement/events.yaml`
- **Recorded**: phase `explore`, status `completed`, event `scope-analysis-exploration`
- **Registry Blocker**: none