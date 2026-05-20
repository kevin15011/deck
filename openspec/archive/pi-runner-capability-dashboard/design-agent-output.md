## Design Created

**Change**: pi-runner-capability-dashboard
**Artifact Path**: `openspec/changes/pi-runner-capability-dashboard/design.md`
**Registry State Path**: `openspec/changes/pi-runner-capability-dashboard/state.yaml`
**Registry Events Path**: `openspec/changes/pi-runner-capability-dashboard/events.yaml`
**Registry Write**: deferred
**Registry Recorded**: phase `design`, status `completed`, event `design.completed`
**Registry Intent**:

```yaml
registry_intent:
  phase: design
  status: completed
  artifact: design.md
  event: design.completed
  note: "Design completed for Pi Runner capability dashboard; registry write deferred due to parallel execution."
  timestamp: "2026-05-20T00:50:17Z"
```

**Registry Blocker**: none

### Summary
- **Approach**: Extraer inventario/plan puro por capacidades y construir un dashboard TUI por secciones encima, preservando los subflujos existentes de modelos y memoria.
- **Components Affected**: 17 components/modules
- **Files Estimated**: 19 files to create/modify/delete
- **Risk Level**: Medium
- **Open Decisions**: 3 decisions remaining
- **Migration Required**: no
- **Spec Status**: not yet available

### Key Tradeoffs
- Capability inventory/plan puro: chosen over ampliar `app.tsx` — reduce acoplamiento y mejora testabilidad.
- Capability→tool/action: chosen over selección de paquetes — cumple “preguntar por capacidad”.
- Adaptive Memory single-choice: `none`/`engram`/`supermemory` over providers múltiples o default Engram — cumple decisión confirmada.
- `pi-hud`/`pi-mermaid` como `pending-source`: chosen over inventar paquetes — evita affordances falsas.

### Next Step
Ready for Task (`deck-developer-task`) to combine with Spec and break into implementation tasks.
