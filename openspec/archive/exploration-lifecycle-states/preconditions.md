| ID | Precondition | Source | Status | Evidence | Blocks Apply |
|---|---|---|---|---|---|
| PCG-001 | Lifecycle field naming must not drift between Spec and repaired Design. | Spec REQ-REGISTRY-001; Design minimal registry shape | allowed-with-placeholder | Use `lifecycle_status` canonical; alias `exploration_lifecycle` only if needed | No |

## Closure Decision
- Ready for Apply: Yes with conditions
- Notes:
  - Preserve anti-bureaucracy constraints: no lifecycle for non-actionable consultations or immediate Proposal/SDD.
  - Keep validator support warning-level and present-field/event-focused unless a low-noise heuristic is proven.
