# Apply Progress: External Skills Bundle Install

## Completed Tasks

### Task 1: Fix generated export name to STANDALONE_SKILL_BUNDLES per spec
**Status**: ✅ Complete
**Files Changed**
- `scripts/generate-skill-bundle.ts` — modify (exports STANDALONE_SKILL_BUNDLES + SKILL_BUNDLES alias)
- `packages/core/src/skills/external/content.generated.ts` — regenerate (exports both)

**Verification**
- Exports STANDALONE_SKILL_BUNDLES (canonical per spec REQ-ESCG-002)
- Exports SKILL_BUNDLES alias for backward compatibility

### Task 2: Fix recursive walker to fail loudly on unreadable files
**Status**: ✅ Complete
**Files Changed**
- `scripts/generate-skill-bundle.ts` — modify (throws on unreadable)
- `packages/core/src/skills/external/index.ts` — modify (dev mode fallback throws)

**Verification**
- Unreadable files now throw instead of silent skip per REQ-ESCG-003

### Task 3: Fix file keys to POSIX forward-slash
**Status**: ✅ Complete
**Files Changed**
- `scripts/generate-skill-bundle.ts` — normalize paths with `/`
- `packages/core/src/skills/external/index.ts` — use forward-slash per REQ-ESCG-002

**Verification**
- File keys now use POSIX forward-slash regardless of OS

### Task 4: Preserve verbatim SKILL.md content in generated bundle (no trim)
**Status**: ✅ Complete
**Files Changed**
- `scripts/generate-skill-bundle.ts` — removed `.trim()` per spec

**Verification**
- Generated SKILL.md content is verbatim (no whitespace trimming)

### Task 5: Fix dev-mode fallback to preserve verbatim content (no trim)
**Status**: ✅ Complete
**Files Changed**
- `packages/core/src/skills/external/index.ts` — removed `.trim()` from dev-mode fallback path (line 180)

**Verification**
- Dev-mode fallback now reads `SKILL.md` verbatim to match generated bundle behavior

## Remaining Tasks

None — all verify findings addressed.

## Summary

Fixed 5 verify findings:
1. Export name: STANDALONE_SKILL_BUNDLES (spec) + SKILL_BUNDLES (alias)
2. Unreadable files: fail loudly (throw) per REQ-ESCG-003
3. File keys: POSIX forward-slash per REQ-ESCG-002
4. Generated content: verbatim (no trim) — Fix 4 from review
5. Dev-mode fallback: remove `.trim()` — review finding fix