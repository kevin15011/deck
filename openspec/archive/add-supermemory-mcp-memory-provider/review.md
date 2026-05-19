# Re-review: add-supermemory-mcp-memory-provider

## Resumen

**Resultado**: PASS / APPROVE WITH CHANGES
**Modo registry**: registry-deferred; no se modificaron `state.yaml` ni `events.yaml`.
**Scope**: general, backend, frontend, integration
**Files Reviewed**: 20 (artefactos OpenSpec, diff actual, `.deck/config.json`, implementación y tests focales)
**Artifact**: `openspec/changes/add-supermemory-mcp-memory-provider/review.md`

El segundo remediation pass resuelve los dos blockers anteriores: Supermemory ya falla cerrado cuando no hay validación autenticada de runtime, y los tool bindings genéricos (`execute`, `search_docs`) se materializan server-qualified usando el `serverName` real, incluido `mcpServerName` custom. También se mantienen resueltos la construcción de provider en TUI, redacción, modos de búsqueda, documentación y dependencia del `useEffect`.

No quedan blockers. Sí quedan dos mejoras importantes antes de considerar la integración madura: actualmente no hay ruta productiva para convertir una validación autenticada en disponibilidad real, y `mcpServerName` debería validarse como identificador seguro antes de interpolarlo en frontmatter Pi.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | Fail-closed correcto, pero falta una ruta explícita de health probe/caché para pasar de degradado a disponible. |
| Security | ⚠️ Adequate | Redacción e inyección fail-closed mejoradas; falta validar `mcpServerName` como token seguro de frontmatter/herramienta. |
| Scalability | ✅ Strong | Sin riesgos relevantes de carga; cambios son materialización/config local. |
| Maintainability | ⚠️ Adequate | Boundaries razonables, aunque el estado `authenticatedRuntimeValidated` queda sin mecanismo productivo claro. |
| Code Quality | ⚠️ Adequate | Código legible y tests focales; conviene centralizar validación de server names. |
| Backend | ⚠️ Adequate | Pi adapter y Supermemory adapter corrigen gating y qualification; queda hardening de inputs. |
| Frontend | ✅ Strong | TUI construye provider inmediato, persiste config sólo tras writer exitoso y redacción visible. |
| Integration | ⚠️ Adequate | Contratos principales alineados; falta camino completo de runtime health disponible. |

## Estado de puntos solicitados

| Punto solicitado | Estado | Evidencia |
|---|---|---|
| Tool injection fail-closed sin authenticated runtime validation | ✅ Resuelto | `packages/adapter-supermemory/src/index.ts:98-100` lanza si `authenticatedRuntimeValidated` no es true; `apps/cli/src/pi-launch-command.ts:249-260` no marca validación estática como autenticada; `packages/adapter-pi/src/developer-team-install.ts:117-129` omite bundle no disponible. |
| `mcpServerName` custom con tools server-qualified | ✅ Resuelto | `packages/adapter-pi/src/developer-team-install.ts:205-208` usa `serverName.toolName`; tests cubren `customSupermemory.execute` / `customSupermemory.search_docs`. |
| TUI provider construction | ✅ Resuelto | `apps/cli/src/tui/app.tsx:148-158` construye `createSupermemoryMemoryProvider(...)` para la instalación inmediata tras writer exitoso. |
| Redaction | ✅ Resuelto | `packages/adapter-pi/src/pi-mcp-config.ts:425-436` cubre Bearer, header, JSON token/apiKey/auth y env `SUPERMEMORY_API_KEY`. |
| Search modes / docs / `useEffect` | ✅ Resuelto | `packages/core/src/config/deck-config.ts:10-11`, `docs/pi-agent-installation.md:500-518`, `apps/cli/src/tui/app.tsx:467`. |

## Findings

### BLOCKER

None.

### MAJOR

- **Integration/Maintainability**: No hay ruta productiva clara para pasar Supermemory de `degraded` a `available` después del setup.
  - **File**: `apps/cli/src/pi-launch-command.ts:249-260`; `apps/cli/src/tui/app.tsx:148-158`; `packages/adapter-supermemory/src/index.ts:98-100`
  - **Evidence**: launch y TUI crean providers sin `authenticatedRuntimeValidated`; el adapter rechaza `buildInjection()` salvo que ese flag sea true. Esto es seguro, pero deja la inyección disponible sólo para providers preconstruidos/tests o futuros callers internos.
  - **Recommendation**: Añadir una abstracción injectable para health probe autenticado (`initialize` + `tools/list` + `execute` read-only) o una caché explícita con TTL/fingerprint del server entry. Mantener fail-closed cuando el probe/caché no exista o falle.

- **Security/Integration**: `mcpServerName` configurable se interpola en tool names sin validarlo como identificador seguro de Pi/frontmatter.
  - **File**: `packages/core/src/config/deck-config.ts:268-273`; `packages/adapter-pi/src/pi-mcp-config.ts:439-441`; `packages/adapter-pi/src/developer-team-install.ts:205-208`
  - **Evidence**: `normalizeOptionalString()` y `normalizeServerName()` sólo hacen trim/non-empty; luego `toPiMemoryToolName()` genera `${serverName}.${toolName}` para frontmatter `tools:`.
  - **Recommendation**: Validar `mcpServerName` con una allowlist conservadora (por ejemplo `^[A-Za-z0-9_-]{1,64}$`, o el formato exacto que Pi soporte) en Deck config y Pi MCP writer/validator; añadir tests de rechazo para coma, espacios, newline, `.` ambiguo y caracteres YAML-sensitive.

### MINOR

- **Maintainability**: Redactor sigue local al módulo Pi MCP.
  - **File**: `packages/adapter-pi/src/pi-mcp-config.ts:425-436`
  - **Evidence**: La cobertura actual es suficiente para este flujo, pero otros módulos pueden reimplementar redacción de diagnósticos secret-bearing de forma divergente.
  - **Recommendation**: En un follow-up, extraer un redactor central para diagnósticos/logs Deck-controlled.

### NIT

- **Code Quality**: Whitespace menor en string de instrucciones.
  - **File**: `packages/adapter-supermemory/src/index.ts:43`
  - **Recommendation**: Limpiar el espacio final en el próximo pass.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Deviations**:
  - ✅ Boundary no secreto `.deck/config.json` y boundary externo `~/.pi/agent/mcp.json` siguen alineados.
  - ✅ Tool mapping usa sólo `execute` y `search_docs` y evita tools provisionales.
  - ✅ Inyección falla cerrada cuando falta validación autenticada.
  - ✅ `mcpServerName` custom ahora se conserva en tool names server-qualified.
  - ⚠️ Falta mecanismo productivo para obtener/registrar validación autenticada antes de inyección.
  - ⚠️ Falta validación de formato de `mcpServerName` antes de interpolarlo en frontmatter.

## Open Questions

- ¿La ruta de disponibilidad debe ejecutar probe online en cada launch, o usar caché con TTL/fingerprint del `~/.pi/agent/mcp.json`?
- ¿Cuál es el patrón exacto de identificadores de servidor MCP que Pi acepta en frontmatter server-qualified?

## REGISTRY_INTENT

```yaml
status: approved_with_changes
phase: review
artifact: review.md
event: review.completed
timestamp: "2026-05-19T00:00:00Z"
provenance:
  actor: deck-developer-review
  registry_write: deferred
  source: openspec/changes/add-supermemory-mcp-memory-provider/{spec.md,design.md,tasks.md,apply-progress.md,mcp-validation-report.md,verify.md,review.md} + current diff
  scope:
    - general
    - backend
    - frontend
    - integration
  result: PASS
  summary: "Second remediation resolved prior blockers: Supermemory injection now fails closed without authenticated runtime validation and custom mcpServerName tools are server-qualified. Remaining non-blocking improvements are authenticated availability plumbing and mcpServerName format validation."
  blockers: []
  major_findings:
    - "No production path yet converts authenticated Supermemory health validation into provider availability; add an injectable probe or TTL/fingerprint cache."
    - "mcpServerName is interpolated into Pi tool frontmatter without a conservative identifier allowlist."
```
