# Review Report: pi-runner-capability-dashboard — Backend Tasks 7-9

## Summary

**Overall Rating**: REQUEST CHANGES  
**Scope**: backend  
**Files Reviewed**: 10

Revisión limitada a Backend Apply Tasks 7-9. Se leyeron Spec/Tasks/Design/Apply Progress y registry state/events en modo registry-deferred; no se modificó registry. La implementación está bien encaminada para manual external installs, alias de provider del dashboard y resolver compartido, pero hay un riesgo importante en la resolución directa de Supermemory desde dashboard/TUI: evita la normalización/validación de Deck config y puede lanzar excepciones en vez de fallar cerrado con diagnostics.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | Buen reúso del resolver compartido; falta encapsular validación del path directo dashboard/TUI. |
| Security | ❌ Weak | Supermemory direct `activeProvider` puede saltarse validación de config/secret-shaped fields y provider construction no está protegido. |
| Scalability | ✅ Strong | Cambios de baja carga; no introducen loops ni I/O costoso al importar. |
| Maintainability | ⚠️ Adequate | Metadata machine-readable útil; hay un guard temprano en `installPiTools` que oculta resultados manuales. |
| Code Quality | ⚠️ Adequate | Código legible; conviene reducir caminos de validación paralelos. |
| Backend | ⚠️ Adequate | Semántica manual externa mayormente alineada; resolver Supermemory requiere hardening. |
| Frontend | N/A | Fuera de scope. |
| Integration | ⚠️ Adequate | Contrato TUI/launch existe, pero el input directo no está tan validado como `.deck/config.json`. |

## Findings

### BLOCKER
- None.

### MAJOR
- **Security / Backend**: El resolver compartido de Adaptive Memory puede fallar abierto/crashear para Supermemory cuando se usa el path directo de dashboard/TUI.
  - **File**: `apps/cli/src/pi-launch-command.ts` — `resolveActiveProviderInput` y rama `activeProvider === "supermemory"` (líneas 247-250, 231-239)
  - **Evidence**: Si `options.activeProvider` está definido, el helper retorna `{ activeProvider: options.activeProvider, supermemory: options.supermemory }` sin pasar por `validateDeckConfig`/`resolveActiveMemoryProvider`. Luego llama `createSupermemoryMemoryProvider(...)` sin `try/catch`. Ese provider valida container tags y puede lanzar (`packages/adapter-supermemory/src/index.ts`, líneas 86-91). El comentario de `runPiLaunch` promete fail-closed con diagnostics para Supermemory, no excepción.
  - **Recommendation**: Normalizar también el path directo de dashboard/TUI con `validateDeckConfig` o un helper equivalente que rechace fields desconocidos/secret-shaped y aplique defaults/límites. Envolver `createEngramMemoryProvider`/`createSupermemoryMemoryProvider` en `try/catch` y devolver `memory_provider_unavailable` redacted diagnostic. Agregar tests para `activeProvider: "supermemory"` con userId/teamId/orgId inválidos y con campos secreto/extra, verificando que no crashea ni inyecta memoria.

### MINOR
- **Backend / Maintainability**: `installPiTools` no emite resultados manuales para herramientas externas si `command` es `undefined`.
  - **File**: `packages/adapter-pi/src/install-tools.ts` — líneas 24-35
  - **Evidence**: La función retorna `[]` en línea 30 antes de llegar a la rama `tool.installKind === "external"` que produciría `manual-external-install`.
  - **Recommendation**: Mover el guard de `command` dentro de la rama `pi-package`, permitiendo que external/manual tools siempre produzcan `status: "manual"`. Para paquetes Pi sin comando, devolver un resultado fallido/skipped explícito o conservar el comportamiento legacy solo para esos paquetes.

### NIT
- **Maintainability**: Faltan tests directos para los bordes nuevos del resolver compartido.
  - **File**: `apps/cli/src/pi-launch-command.ts`
  - **Recommendation**: Además de los tests existentes de launch Supermemory, cubrir el caso TUI/direct `activeProvider + supermemory` y los errores de provider construction para evitar regresiones.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Partially
- **Deviations**:
  - La semántica manual externa está alineada con Review Plan/action-runner para el caso normal, pero conserva una dependencia implícita en `piCommand` dentro de `installPiTools`.
  - El resolver compartido cumple la intención de unificar launch/TUI, pero el path directo dashboard/TUI no preserva completamente la política fail-closed y la validación segura de Supermemory que sí tiene el path `.deck/config.json`.

## Open Questions

None.
