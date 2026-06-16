# Preconditions: ponytail-style-code-budget

| ID | Precondition | Source | Status | Evidence | Blocks Apply |
|---|---|---|---|---|---|
| PCG-001 | User requirement change documented: code-economy must be always active | User message | satisfied | "No, no quiero que code-economy sea opcional, siempre debe de quedar activo en toda instalación" | No |
| PCG-002 | Existing implementation uses packageInstructions normalization for bundle enablement | design.md | satisfied | `deck-config.ts` with `normalizePackageInstructionConfig()` | No |
| PCG-003 | Location of OpenCode/Pi install validation tests/scripts known | Task 14 | allowed-with-placeholder | To be discovered during Apply; if absent, Task 14 reduces to snapshot/prompt validation | No |

## Closure Decision
- Ready for Apply: Yes
- Notes: Implementation path chosen is normalization/default `true` in `deck-config.ts`; no user-facing toggle. Minor discovery placeholder for install validation tests.
