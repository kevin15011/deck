# Review Report: Adaptador MCP para context-mode en OpenCode

## Summary

**Overall Rating**: APPROVE
**Scope**: general
**Files Reviewed**: 9

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Patrón MCP correctamente implementado; similar a serena/context7 |
| Security | ⚠️ Adequate | npm install -g sin respaldo directo (mitigado por config-merge); no hay inyección |
| Scalability | ✅ Strong | Aislamiento por proceso MCP externo; detección independiente de plugin |
| Maintainability | ⚠️ Adequate | Duplicación menor; contexto distribuido en múltiples archivos |
| Code Quality | ✅ Strong | Tipos claros; separación de responsabilidades; documentación adecuada |
| Backend | ✅ Strong | Lógica MCP/config; migración de plugin; inversión de reglas en merge |
| Integration | ✅ Strong | Coherencia action-runner ↔ capability-plan ↔ runner-adapter |

## Findings

### MINOR

- **Code Quality**: Duplicación de casos hardcoded para capability resolution
  - **File**: `packages/adapter-opencode/src/capability-plan.ts` líneas 464-467, `packages/adapter-opencode/src/runner-adapter.ts` líneas 455-463, `apps/cli/src/tui/runner-dashboard/action-runner.ts` líneas 495-516
  - **Evidence**: Tres locations definen `case "context-mode"` con el mismo command `["context-mode"]`. Diseño centraliza en `getMcpServerConfig()` pero action-runner usa su propia tabla.
  - **Recommendation**: Consolidar en una única función compartida o aceptar redundancia por desacoplamiento de capas.

### NIT

- **Security**: Sin backup automático en `writeOpenCodeMcpConfig` cuando se invoca directamente
  - **File**: `packages/adapter-opencode/src/opencode-mcp-config.ts`
  - **Recommendation**: Considerar usar `mergeAndWrite()` con backup para invocaciones directas, o documentar que backup es responsabilidad del caller.

- **Maintainability**: `action-runner.ts` incluye lógica de capacidades en componente de UI
  - **File**: `apps/cli/src/tui/runner-dashboard/action-runner.ts` líneas 495-516
  - **Recommendation**: Mover lógica de selección de command a runner-adapter para mantener separación modelo/vista.

## Design Fidelity

Does the implementation match the Design artifact?

- **Aligned**: Yes
- **Deviations**:
  1. Command MCP usa `["context-mode"]` directo en lugar de path absoluto — aceptar por simplicidad y compatibilidad con binario global.
  2. `capability-plan.ts` no genera acción `install-opencode-plugin` para `npm-package-plus-mcp` — correcto, usa `npm-install`.

## Open Questions

- None. Todas las OQ del Spec están resueltas en Tasks.

## Verification Coverage

| REQ-ID | Covered By | Files Reviewed |
|---|---|---|
| REQ-INST-001 | capability-catalog.ts, installation-plan.ts: installKind | ✅ |
| REQ-INST-002 | capability-plan.ts, runner-adapter.ts: write-mcp-config | ✅ |
| REQ-INST-003 | capability-plan.ts getMcpServerConfig: tipo local + command | ✅ |
| REQ-INST-004 | capability-catalog.ts: detector sin pluginNames | ✅ |
| REQ-INST-005 | capability-plan.ts: getMcpServerConfig("context-mode") | ✅ |
| REQ-DET-001 | capability-inventory.ts: isCapabilityInstalled | ✅ |
| REQ-DET-002 | capability-inventory.ts detector.mcpServerNames | ✅ |
| REQ-DET-003 | capability-catalog.ts: detector sin pluginNames | ✅ |
| REQ-DET-004 | required-tools.ts + capability-inventory.ts | ✅ |
| REQ-MIG-001 | opencode-mcp-config.ts pluginsToRemove, config-merge.ts invert | ✅ |
| REQ-MIG-002 | opencode-mcp-config.ts: preservación de otros plugins | ✅ |