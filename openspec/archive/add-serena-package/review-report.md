# Review Report: Add Serena MCP Package

## Summary

**Overall Rating**: APPROVE
**Scope**: general
**Files Reviewed**: 6

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Clean separation: serena.ts → index.ts → deck-config.ts → TUI → action-runner |
| Security | ✅ Strong | Static command arrays, no user input interpolation, no injection vectors |
| Scalability | ✅ Strong | Serene is another package ID; no scaling concerns |
| Maintainability | ✅ Strong | Patterns match existing packages (codebase-memory), TypeScript-typed throughout |
| Code Quality | ✅ Strong | Well-documented, consistent naming, appropriate fragments |
| Backend | ✅ Strong | Package instruction bundle + config + MCP server config correctly architected |
| Frontend | N/A | — |
| Integration | ✅ Strong | Deck config → package instructions → MCP config write flow works |

## Findings

No BLOCKER, MAJOR, MINOR, or NIT findings.

## Design Fidelity

Does the implementation match the Design artifact?

- **Aligned**: Yes
- **Deviations**: None

### Key Implementation Points Verified

| Design Requirement | Implementation | Status |
|---|---|---|
| `buildSerenaInstructionBundle()` returns 2 fragments (agent + skill) | `serena.ts:22-120` | ✅ |
| All fragments have `packageId: "serena"` | `serena.ts:24,97` | ✅ |
| Agent fragment documents 15 enabled tools | `serena.ts:31-46` | ✅ |
| Agent fragment documents 13 disabled tools | `serena.ts:48-64` | ✅ |
| Agent fragment has coexistence rules | `serena.ts:66-80` | ✅ |
| Skill fragment is condensed | `serena.ts:99-118` | ✅ |
| Bundle returns `Object.freeze(fragments)` | `serena.ts:122` | ✅ |
| `"serena"` added to `CapabilityInstructionPackageId` type | `index.ts:27` | ✅ |
| `"serena"` in `PACKAGE_BUILDERS` | `index.ts:58` | ✅ |
| `"serena"` in `PACKAGE_ORDER` after `"adaptive-memory"` | `index.ts:62-68` | ✅ |
| `"serena"` in `PACKAGE_INSTRUCTION_PACKAGE_IDS` | `deck-config.ts:63` | ✅ |
| Default `serena: false` in config | `deck-config.ts:210-211,567-568,603` | ✅ |
| `serena` in TUI state | `action-runner.ts:394,401` | ✅ |
| `serena` MCP config write branch | `action-runner.ts:471-492` | ✅ |
| `serena` in capability-catalog | `capability-catalog.ts:4,75-85` | ✅ |
| `getMcpServerConfig("serena")` | `capability-plan.ts:415-419` | ✅ |

## Security Analysis

### MCP Config Command Injection

- **File**: `action-runner.ts:471-492`, `capability-plan.ts:408-423`
- **Evidence**: Commands are hardcoded static arrays:
  ```typescript
  command: ["serena", "start-mcp-server", "--context", "ide", "--project-from-cwd"]
  ```
- **Assessment**: ✅ No user input is interpolated into command arrays. Static commands follow the same pattern as Context7 (`action-runner.ts:449-468`). No command injection risk.

### Config Write Security

- **File**: `action-runner.ts:388-403`
- **Evidence**: Package instructions are normalized booleans from validated TUI state; no secret handling here.
- **Assessment**: ✅ Secure. No tokens, no credentials written to `.deck/config.json`.

### Memory Tools Disabled

- **File**: `serena.ts:59-64`
- **Evidence**: All Serena memory tools are explicitly disabled with rationale pointing to adaptive-memory package.
- **Assessment**: ✅ Correct. Preserves Deck adaptive-memory authority; no duplicate persistence.

## Open Questions

- None

---

## Review Report

**Change**: add-serena-package
**Scope**: general
**Rating**: APPROVE
**Artifact Path**: `openspec/changes/add-serena-package/review-report.md`
**Registry State Path**: `openspec/changes/add-serena-package/state.yaml`
**Registry Events Path**: `openspec/changes/add-serena-package/events.yaml`
**Registry Write**: performed
**Registry Recorded**: phase `review`, status `approved`, event `review-completed`
**Registry Blocker**: none

### Summary
- **Files Reviewed**: 6
- **BLOCKER**: 0
- **MAJOR**: 0
- **MINOR**: 0
- **NIT**: 0

### Top Findings
- No issues found.

### Next Step
Proceed to Archive.