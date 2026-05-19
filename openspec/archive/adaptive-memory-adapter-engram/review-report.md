# Review Report: Adaptive Memory Adapter with Engram Injection

## Summary

**Overall Rating**: APPROVE
**Scope**: general, backend, integration
**Files Reviewed**: 27

The final fix round resolves the two remaining MAJOR review findings. Core adaptive-memory code is provider-neutral again: concrete provider IDs are injected by adapters/CLI rather than registered in core, and a non-test grep of `packages/core/src` shows no Engram references. Pi launch rematerialization now reads existing `.pi/agents` model/thinking assignments before applying memory-enabled Developer Team files, preserving launch args and frontmatter while adding memory bindings.

Overall architecture is sound for the current one-provider scope. Unsupported provider IDs fail closed with observable diagnostics, Engram-specific guidance and tool names remain isolated to the Engram adapter and caller-owned allowlists, unvalidated MCP names are clearly marked experimental, and Engram fragments include explicit secrets/PII safety guidance.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Core owns only provider-neutral types/composition/resolution; provider allowlisting is caller-injected or adapter/CLI-owned. |
| Security | ⚠️ Adequate | Unsupported providers fail closed and memory safety guidance prohibits secrets/PII; Engram tool contract remains experimental but no longer overpromised. |
| Scalability | ⚠️ Adequate | String composition is cheap; provider allowlists are intentionally outside core, though repeated constants should be centralized if more providers are added. |
| Maintainability | ⚠️ Adequate | Boundaries are clear and tests cover regressions; a small amount of adapter/CLI allowlist duplication remains acceptable for one provider. |
| Code Quality | ✅ Strong | Code is readable, diagnostics are explicit, and comments explain provider-neutral resolution and launch preservation behavior. |
| Backend | ✅ Strong | Pi/OpenCode adapters compose per surface, scope tool bindings to matching fragments, and use fail-closed diagnostics. |
| Frontend | N/A | No frontend UI scope beyond CLI wiring. |
| Integration | ✅ Strong | `--memory=engram` now materializes session, agent, and skill surfaces while preserving existing Pi model/thinking configuration. |

## Findings

### BLOCKER
- None.

### MAJOR
- None.

### MINOR
- None.

### NIT
- **Maintainability**: Provider allowlist constants are repeated across caller/adapter surfaces.
  - **File**: `apps/cli/src/cli-args.ts` — line 44; `apps/cli/src/pi-launch-command.ts` — line 13; `packages/adapter-pi/src/developer-team-install.ts` — line 84; `packages/adapter-pi/src/pi-team-profile.ts` — line 16; `packages/adapter-opencode/src/developer-team-install.ts` — line 69
  - **Evidence**: Each surface owns an `engram` allowlist constant, which is acceptable outside core for the current single-provider scope but will become duplicated registry knowledge as providers grow.
  - **Recommendation**: Keep as-is for this change; consider an adapter/CLI-level shared provider registry when a second provider is introduced.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes
- **Deviations**:
  - Core provider neutrality is restored: `resolveMemoryInjection()` accepts caller-injected `supportedProviderIds` and contains no Engram-specific registration. Non-test `packages/core/src` has no Engram matches.
  - Pi launch now preserves existing model/thinking assignments before memory rematerialization by calling `readDeveloperTeamModelConfigAssignments(projectRoot)` and passing both maps into `buildDeveloperTeamInstallPlan()`.
  - Engram MCP names remain unvalidated, but this is explicitly labeled experimental in provider comments, provider display name, fragments, and CLI warning behavior, so the runtime contract is not overpromised.
  - Engram memory guidance states memory is auxiliary and includes explicit guidance not to store secrets, credentials, tokens, private keys, raw customer/PII data, or other sensitive information.

## Open Questions

None.
