## Spec Created

**Change**: pi-runner-capability-dashboard
**Artifact Path**: `openspec/changes/pi-runner-capability-dashboard/spec.md`
**Registry State Path**: `openspec/changes/pi-runner-capability-dashboard/state.yaml`
**Registry Events Path**: `openspec/changes/pi-runner-capability-dashboard/events.yaml`
**Registry Write**: deferred
**Registry Recorded**: deferred; phase `spec`, status `completed`, event `spec.completed` debe ser serializado por el Orchestrator
**Registry Intent**: artifact `spec.md`, phase `spec`, status `completed`, event `spec.completed`
**registry_intent**: `{ phase: "spec", status: "completed", artifact: "spec.md", event: "spec.completed", note: "Spec completada para dashboard por capacidades de Pi Runner; registry write diferido por ejecución en paralelo.", timestamp: "2026-05-20T00:49:45Z" }`
**Registry Blocker**: none

### Summary
- **Capabilities Specified**: 6 capabilities
- **Total Requirements**: 29 requirements (27 MUST, 2 SHOULD, 0 MAY)
- **Acceptance Scenarios**: 21 scenarios
- **Open Questions**: 3 questions remaining

### Key Requirements
- REQ-DASH-001: El flujo debe presentarse como dashboard por secciones, no wizard lineal yes/no. (MUST)
- REQ-GCAP-001: Las capabilities globales seleccionables deben ser RTK, context-mode, codebase-memory, pi-hud y pi-mermaid. (MUST)
- REQ-MEM-002: Adaptive Memory debe iniciar en `None`, sin provider activo por default. (MUST)
- REQ-MEM-004: Engram/`engram-memory` solo aparece como instalable/acción técnica si Adaptive Memory = `Engram`. (MUST)
- REQ-TEAM-004: La configuración de modelos por agente debe preservar provider/model/thinking y compatibilidad existentes. (MUST)
- REQ-PLAN-001: Review & Install debe generar un plan final agrupado por instalaciones automáticas, pasos manuales, configuración, team y validación. (MUST)

### Next Step
Ready for Design (`deck-developer-design`) and Task (`deck-developer-task`) consumption.
