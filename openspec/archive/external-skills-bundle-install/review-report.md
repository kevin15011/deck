# Review Report: External Skills Bundle Install

## Summary

**Overall Rating**: APPROVE  
**Scope**: general / backend / integration  
**Files Reviewed**: 6

The final dev fallback fix resolves the remaining contract drift from the prior review: `getStandaloneSkill` now preserves raw `SKILL.md` content in development fallback mode instead of trimming it, so generated and fallback behavior are aligned for verbatim skill bodies. The generated bundle API, backward-compatible alias, path normalization, system artifact filtering, and missing-skill error contract are all sound for this scope.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ✅ Strong | Clear separation between registry, generated bundle data, and runtime accessors. Backward-compatible alias avoids unnecessary consumer breakage. |
| Security | ✅ Strong | Static bundled content only; no command execution or untrusted dynamic path traversal beyond registered skill IDs. System artifacts are excluded. |
| Scalability | ✅ Strong | Small static skill set; eager generated bundle is appropriate. Synchronous dev fallback is acceptable and isolated to development/no-generated-content mode. |
| Maintainability | ⚠️ Adequate | Generator and runtime fallback still duplicate recursive walk/exclusion logic, but focused tests and small scope keep the risk manageable. |
| Code Quality | ✅ Strong | Naming and contracts are readable; fallback now preserves verbatim content. Error type is explicit and consistent. |
| Backend | ✅ Strong | Core API behavior is deterministic and typed; missing IDs consistently throw `SkillLookupError`. |
| Frontend | N/A | No frontend surface reviewed. |
| Integration | ✅ Strong | Runtime consumers can use `getStandaloneSkillBody` unchanged while new full-bundle access is available. |

## Findings

### BLOCKER
None.

### MAJOR
None.

### MINOR
- **Maintainability**: Recursive directory-walk and exclusion logic is duplicated between the generator and development fallback.
  - **File**: `scripts/generate-skill-bundle.ts` — `walkSkillDirectory`; `packages/core/src/skills/external/index.ts` — `walk`
  - **Evidence**: Both implementations independently define `shouldExclude`, recurse directories, normalize paths, and read file contents.
  - **Recommendation**: If this code evolves beyond the current small scope, extract a shared internal helper or keep parity covered by targeted regression tests.

### NIT
- **Code Quality**: The generated `apps/cli/src/runtime/build-info.generated.ts` drift remains in the working tree but appears unrelated to this change's implementation quality.
  - **File**: `apps/cli/src/runtime/build-info.generated.ts`
  - **Recommendation**: Ensure the orchestrator/verify/archive flow decides whether this generated drift is intentional before commit.

## Design Fidelity

Does the implementation match the Design artifact?
- **Aligned**: Yes
- **Deviations**: None material. The fallback now mirrors generated behavior for verbatim `SKILL.md` content and auxiliary-file walking, and the generated export keeps the canonical `STANDALONE_SKILL_BUNDLES` name while preserving `SKILL_BUNDLES` as a compatibility alias.

## Open Questions

None.
