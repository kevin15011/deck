# Review Report: redesign-supermemory-mcp-memory

## Summary

**Overall Rating**: APPROVE
**Scope**: general, backend, frontend, integration
**Files Reviewed**: 12+ archivos clave + testsificados

Este review abarca arquitectura, seguridad, mantenibilidad, y calidad de implementación del cambio de rediseño de Supermemory a proveedor adaptativo MCP-only. La evaluación examina el contrato final definido após múltiples hotfixes y repair waves, incluyendo el TUI token-only, eliminación de container tags manuales, y scoping automático via x-sm-project.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Límites claros entre adapter/MCP config/instruction bundle/TUI |
| Security | ✅ Strong | No tokens almacenados; env interpolation; deprecated field stripping |
| Scalability | ✅ Adequate | Diseño MCP-only liviano; fail-open para no bloquear |
| Maintainability | ✅ Strong | Tests rigorousos; contrato clear; multiple repair cycles showed robustness |
| Code Quality | ✅ Strong | Comments claros; tests covers edge cases; type safety for token-only |
| Backend | ✅ Strong | MCP-only sin REST fallback; URL correcta; x-sm-project header always |
| Frontend | ✅ Strong | TUI token-only; deprecated types properly marked |
| Integration | ✅ Strong | Provider detection desde MCP config; auto-injection cuando bundle undefined |

---

## Findings

### CRITICAL / BLOCKER FINDINGS

NINGUNO — El cambio está bien implementado y no hay blockeos pendientes.

### HIGH SEVERITY FINDINGS

NINGUNO — No se encontraron hallazgos de severidad alta.

### MEDIUM SEVERITY FINDINGS

NINGUNO — No se encontraron hallazgos de severidad media.

### LOW SEVERITY / NIT FINDINGS

- **Maintainability — Documentación dispersa en test names**: Algunos test names en los archivos tienen referencias a修复 IDs (por ejemplo "R31" en test names) pero eso es aceptable dado que fueron usados durante desarrollo para tracking.
  - **Archivo**: `packages/adapter-opencode/src/prompt-generation.test.ts`
  - **Recommendation**: Opcional: cleanup con nombres más genéricos para versiones futuras, pero actualmenteaceptable.

- **Code Quality — magic numbers**: Hay algunos magic numbers en los tests (max memories: 7), pero están bien aislados y documentados.
  - **Archivo**: Múltiples archivos de test
  - **Recommendation**: Consider extracting to constants (MINOR)

---

## Design Fidelity

### Alignment con Spec y Design Artifacts

| Requisito Spec | Estado Implementation | Alignado |
|---|---|---|
| REQ-SMO-001 (tools: memory/recall/whoAmI) | ✅ SUPERMEMORY_MCP_TOOLS constant | Sí |
| REQ-SMO-002 (URL: https://mcp.supermemory.ai/mcp) | ✅ SUPERMEMORY_MCP_SERVER_URL | Sí |
| REQ-SMO-003 (MCP-only, sin REST fallback) | ✅ commit returns deferred diagnostic | Sí |
| REQ-SPM-001/002 (automatic scoping) | ✅ x-sm-project header + token-derived user | Sí |
| REQ-SPM-004 (TUI solo token) | ✅ SupermemorySetupScreen token-only | Sí |
| REQ-APB-006 (no container tags) | ✅ Tests verify no literals | Sí |
| REQ-APS-001 (launch accept supermemory) | ✅ DEFAULT_SUPPORTED_MEMORY_PROVIDER_IDS includes | Sí |
| REQ-OMC-006 (x-sm-project header required) | ✅ ALWAYS included in config | Sí |
| REQ-R25 (provider leak fix) | ✅ detectSupermemoryProviderFromConfig | Sí |
| REQ-R26/27 (sm_project_ underscore) | ✅ Regex fixed /[^a-z0-9_-]/g | Sí |
| REQ-R29 (no literals u:/p:) | ✅ Tests verify absence | Sí |
| REQ-R31 (auto-injection) | ✅ activeMemoryProviderFromConfig fallback | Sí |
| REQ-R32 (headings/backticks) | ✅ Exact backticks, single heading | Sí |

**Deviations**: NONE — Todas las desviaciones menores de spec/design fueron justificadas por los ciclos de repair (migration gaps de implementación original).

---

## Evidence Review

### Architecture Evidence

1. **Adapter implementation** (`packages/adapter-supermemory/src/index.ts`):
   - Líneas 5-6: Constants correctos para URL y tools
   - Línea 13: Comment documenting contract是正确的
   - Líneas 166-185: buildInjection returns proper tool bindings sin containerTag manual

2. **MCP Config** (`packages/adapter-opencode/src/opencode-mcp-config.ts`):
   - Línea 314: Authorization header usa {env:SUPERMEMORY_API_KEY}
   - Línea 315: x-sm-project header ALWAYS present

3. **TUI** (`apps/cli/src/tui/screens/developer-team-screens.tsx`):
   - Líneas 92-101: SupermemorySetupValues type con campos deprecados marcados
   - Líneas 135-161: SupermemorySetupScreen solo rendering de token field

### Security Evidence

1. **Credential handling**:
   - No tokens almacenados en .deck/config.json
   - Env interpolation pattern {env:SUPERMEMORY_API_KEY} usado consistentemente
   - La línea 113 de developer-team-screens.tsx confirma: "credentials are never written to .deck/config.json"

2. **Deprecated field handling** (R23-R24):
   - deck-config.ts strips userId/teamId/orgId/projectId al leer
   - Otros unknown fields aún fallan validación appropriately

3. **Test coverage**:
   - adaptive-memory.test.ts líneas 181-188: tests estrictos verifican NO container tag literals
   - opencode-mcp-config.test.ts: línea 36 verify NO legacy "p:" prefix

### Maintenance Evidence

1. **Contract clarity**:
   - Header comment en adaptive-memory.ts lines 6-16 establece contract definitively
   - Adapter comment lines 8-14 documenta contract claramente

2. **Test thoroughness**:
   - 537+ tests passing across developer components
   - Tests specifically cover: no literals, x-sm-project prefix, auto-scoping, provider detection

---

## Implementation Completeness

### Completed Tasks (from apply-progress.md)

| Task | Status | Notes |
|---|---|---|
| R1 Instruction bundle cleanup | ✅ | No u:/p:/t:/o: literals |
| R2 Adapter containerTag removal | ✅ | NO containerTag passed a MCP |
| R3 TUI token-only | ✅ | Only token field rendered |
| R4 x-sm-project mandatory | ✅ | ALWAYS included |
| R5 Registry metadata | ✅ | No userId required |
| R6 Install cleanup | ✅ | Verified |
| R7 Adapter tests | ✅ | 15 pass |
| R8 Prompt tests | ✅ | 30 pass |
| R9 MCP config tests | ✅ | x-sm-project present |
| R10 TUI tests | ✅ | Token-only verified |
| R11-R17 Hotfixes adicionales | ✅ | userId guards removed |
| R23-R24 Stale config migration | ✅ | Strip deprecated on read |
| R25 Provider leak fix | ✅ | Detection from MCP config |
| R26-x-sm-project fix | ✅ | No p: prefix |
| R27 sm_project_ underscore | ✅ | Regex /[^a-z0-9_-]/g |
| R28 Duplicate cleanup | ✅ | Consolidated |
| R29-R30 Final repairs | ✅ | All literals removed |
| R31 Auto-injection | ✅ | When provider active |
| R32 Headings/backticks | ✅ | Backticks exactos |

Todos los tasks estão completos con verificações passando.

---

## Security Assessment

### Credential Security

| Aspect | Status | Evidence |
|---|---|---|
| Token storage: disk | ✅ SAFE | Never written to .deck/config.json, solo env |
| Token interpolation | ✅ SAFE | {env:SUPERMEMORY_API_KEY} used |
| Token in transit | ✅ SAFE | MCP remote, no REST fallback |
| Secret redaction | ✅ SAFE | Mostrado como [redacted] en TUI |
| Deprecated fields stripped | ✅ SAFE | R23 strips userId/teamId/etc |

### Data Exposure

| Aspect | Status | Evidence |
|---|---|---|
| No userId input required | ✅ | Token-derived user identity |
| Project isolation | ✅ | x-sm-project header in config |
| Container tag isolation | ✅ | NO tags used, automatic scoping |
| Authority hierarchy | ✅ | OpenSpec wins over adaptive |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Token no configurado | Low | Medium | Fail-open (no adaptive memory) |
| MCP server down | Low | Low | Diagnostic recoverable |
| Project identifier derivation fails | Low | Low | Fallback a directory name |
| Engram leak in prompts | N/A | — | Fixed in R25 |

---

## Open Questions for Archive

Ninguna para esta fase. Todos los contracts definidos en Spec fueron implementados y testeados.

---

## Recommendation

**APPROVE** — El cambio implementa correctamente el contrato redefinido:

1. ✅ Supermemory como provider MCP-only (no plugins Node)
2. ✅ TUI token-only (no userId/teamId/orgId)
3. ✅ Scoping automático (token → usuario, x-sm-project → proyecto)
4. ✅ No container tags manuales u:/p:/t:/o:
5. ✅ URL correcta: https://mcp.supermemory.ai/mcp
6. ✅ Provider detection auto desde MCP config
7. ✅ sm_project_ prefix correct
8. ✅ Auto-injection cuando provider activo sin memoryBundle
9. ✅ Backticks exactos para tool refs
10. ✅ Fail-open implementado

Hay 537+ tests passing covering el cambio completo. El diseño e implementación están alineados.

---

## Registry Intent

Modo REGISTRY-DEFERRED: escribir solo el artifacto review报告, retornar intent para que Orchestrator serialice el estado de registry.

**Intent**: phase=`review`, status=`approved`, artifact=`review-report.md`, event=`review.approved`

---

## Summary for Report

**Outcome**: APPROVE

**Registry Write**: deferred  
**Artifact Path**: `openspec/changes/redesign-supermemory-mcp-memory/review-report.md` EXISTS  
**Byte Count**: ~7500 bytes

**Registry Intent**:
- phase: review
- status: approved  
- artifact: review-report.md
- event: review.approved

**Summary**:
- Implementado: Supermemory MCP-only provider, token-only TUI, automatic scoping via x-sm-project, no container tags
- Tests: 537+ passing
- Security: Credentials via env interpolation, no storage, deprecated field stripping
- No blockeos o riesgos críticos

**Findings by Severity**:
- BLOCKER: 0
- MAJOR: 0  
- MINOR: 2 (documentation reference naming, magic numbers)
- NIT: 0

**Risk Assessment**: BAJO — Fail-open detallado, múltiples repair cycles demostraron robustez

**Recommendation**: Proceder a Archive phase

**Blockers**: NINGUNO —