# SDD Review: Adaptive Memory Protocol

## Summary

**Status: NEEDS_FIX**

The implementation is well-structured and follows the existing Package Instruction pattern correctly. The behavioral protocol is cleanly separated from provider routing, and the code is readable with comprehensive tests. However, there is a blocking issue: the spec requires that the routing section document the scoping tags (userId, teamId, orgId, projectId) and their sources in `.deck/config.json`, but the current bundle contains no routing section at all because the design delegates routing to the existing `MemoryInjectionBundle` pipeline. Additionally, the design correctly notes that `context-mode` and `rtk` tool instructions are not being removed entirely — they continue via MCP tools — but this is not clearly documented in the spec's open questions.

---

## Architecture Review

### ✅ Package Instruction Pattern Followed Correctly

The `adaptive-memory.ts` bundle follows the exact same structural pattern as `codebase-memory.ts`:
- Zero-argument builder function returning `CapabilityInstructionBundle`
- Two fragments: `surface: "agent"` and `surface: "skill"` (no `session` surface, per REQ-BUNDLE-002)
- `packageId: "adaptive-memory"` on all fragments
- `Object.freeze(fragments)` for immutability

### ✅ Provider-Agnostic Protocol

Grep scan confirms zero occurrences of `supermemory`, `engram`, `mem_save`, `mem_search`, `mem_session_summary`, or any MCP server name in the bundle markdown. REQ-BUNDLE-009 is satisfied.

### ✅ Clean Separation of Concerns

The design correctly identifies that behavioral rules belong in Package Instructions while provider routing belongs in the existing `MemoryInjectionBundle` pipeline. This is a sound architectural decision. The two systems coexist without interference, as noted in the `index.ts` module comment.

### ✅ Single Responsibility for Git Utility

`extractProjectNameFromGitRemote` handles URL parsing only. `getProjectFallbackName` handles directory fallback only. The utility is a pure function with no side effects and no coupling to config or memory systems.

### ⚠️ Routing Section Missing (REQ-ROUTE-004)

The spec requires:

> REQ-ROUTE-004: The routing information MUST document the scoping tags (userId, teamId, orgId, projectId) passed to the provider and their source in `.deck/config.json`.

The spec's open question #1 explicitly identifies this as an unresolved design question (options A, B, C). The implementation chose option B — routing handled by the existing `MemoryInjectionBundle` pipeline — which means the *package instruction bundle* does not and cannot contain routing information because it has no access to config at build time.

**Impact**: REQ-ROUTE-004 cannot be satisfied by the package instruction bundle as implemented. This is either a spec deficiency or a spec whose requirements were not fully aligned with the chosen architecture.

---

## Security Review

### ✅ No Secrets in Changed Files

- `git.ts`: No credentials, tokens, or secrets. Pure URL parsing.
- `adaptive-memory.ts`: Instruction text only, no sensitive data.
- `index.ts`: Registry code, no secrets.
- `deck-config.ts`: Config validation with `rejectSecretFields()` function that traverses nested objects and rejects any field matching `SECRET_FIELD_PATTERN`. The pattern includes `token`, `secret`, `credential`, `api_key`, `password`, `private_key`, etc.
- `.deck/config.json`: Contains `userId: "kevin"`, `projectId: "deck"`, `teamId: "developer"`, `orgId: "GCO"` — all non-secret identifiers. `mcpServerName: "supermemory"` is a label, not a credential.

### ✅ Config Schema Rejects Unknown Fields

`normalizePackageInstructionConfig` validates every package key against `PACKAGE_INSTRUCTION_PACKAGE_FIELDS` (derived from the const array). Unknown keys throw `DECK_CONFIG_UNKNOWN_FIELD`. This prevents stale package IDs (`context-mode`, `rtk`) from silently being accepted.

### ⚠️ Existing Config Migration Gap (Design Decision)

The design correctly identifies that users with `context-mode: true` or `rtk: true` in their config will get a validation error after upgrading. The design recommends auto-stripping unknown keys in the installer. **This is not implemented.** There is no migration logic that strips stale keys from existing configs. Users with those keys will experience a blocking error on next config read.

---

## Maintainability Review

### ✅ Readable and Well-Structured

- `adaptive-memory.ts` at 119 lines is clean and well-organized with clear section headers
- `index.ts` at 170 lines is straightforward with good JSDoc comments
- `git.ts` at 64 lines is a simple pure function
- `deck-config.ts` at 519 lines follows consistent patterns with clear separation between normalization functions

### ✅ Comprehensive Tests

- `git.test.ts`: 10 test cases covering all URL formats (SSH, HTTPS, local, file://), edge cases (empty, whitespace, trailing slash, query params, multiple .git), and fallback behavior
- `index.test.ts`: Tests for bundle building, deduplication, composition, surface filtering, and canonical ordering — all updated to use `adaptive-memory` instead of stale IDs

### ⚠️ Adding New Provider Requires Bundle Changes

This is by design — the bundle is provider-agnostic and defines behavioral rules. The routing is handled by the existing `MemoryInjectionBundle` pipeline (separate from package instructions). The spec correctly acknowledges this separation of concerns.

### ✅ Error Handling in Git Extraction

`extractProjectNameFromGitRemote` handles:
- Empty/whitespace input → returns `undefined`
- Query params and fragments → stripped before parsing
- `.git` suffix → removed
- SSH format with `@` and `:` → correctly parsed
- `file://` prefix → removed
- Trailing slashes → removed via regex
- Non-existent/invalid segments → returns `undefined`

The function never throws — it gracefully returns `undefined` for malformed input, allowing callers to apply fallback logic.

---

## Scalability Review

### ✅ Git URL Parsing Handles Common Formats

The implementation covers: SSH (`git@host:user/repo`), HTTPS (`https://host/user/repo`), SSH protocol (`ssh://host/path/repo`), local paths (`/local/path/repo`), and `file://` URLs. The regex-based extraction approach scales to any number of URL formats.

### ✅ Type System Strictness

- `PACKAGE_INSTRUCTION_PACKAGE_IDS = ["codebase-memory", "adaptive-memory"] as const` — const assertion prevents accidental mutation
- `PackageInstructionPackageId` is derived from the const via `typeof`
- `CapabilityInstructionPackageId` in `index.ts` is `"codebase-memory" | "adaptive-memory"` — exact match, no wider strings
- Union types ensure invalid package IDs fail at compile time, not runtime

### ⚠️ REQ-ROUTE-004 Not Satisfied

The routing information (which tools to call for save/search/summarize and what scope tags to use) is not in the package instruction bundle. This is because the bundle builder takes no config parameters and cannot generate routing at bundle-build time. The spec explicitly identifies this as an open question that was resolved during design, but the resulting architecture does not satisfy the stated requirement.

---

## Risks and Concerns

### 1. Config Migration for Stale Package IDs (Medium Impact, Medium Likelihood)

**Risk**: Users upgrading from a version that had `context-mode` or `rtk` enabled in their config will get a `DECK_CONFIG_UNKNOWN_FIELD` error on next run.

**Spec requirement**: REQ-CLEANUP-003 states stale IDs must be removed from validation. The error contract says config validation rejects unknown package fields with a blocking error.

**Mitigation in design**: The design recommends auto-stripping unknown keys in the installer. This is not implemented in the change itself, so users with existing configs are at risk.

**Verdict**: Design documents this correctly; implementation does not address it. Risk is documented but not mitigated.

### 2. Context-Mode and RTK Tool Instructions (Design Gap)

**Risk**: The spec's open question #5 asks "Are these tool instructions being relocated to a different delivery mechanism, or are they being removed entirely?" The design answers this by saying the tool routing was already redundant because the package instruction system handles routing through the `MemoryInjectionBundle` pipeline.

However, `context-mode.ts` and `rtk.ts` were themselves package instruction bundles, not just tool routing files. The design claims their content was "redundant with the package instruction system" but the actual instruction bundles for `context-mode` and `rtk` contained behavioral instructions for how to use those tools, not just routing tables. Deleting these bundles means those behavioral instructions are removed entirely.

**Clarification needed**: The spec should explicitly state whether the behavioral instructions from `context-mode` and `rtk` are (a) no longer needed, (b) moved elsewhere, or (c) intentionally removed. The design says they were redundant but doesn't cite evidence.

### 3. Provider Routing Not in Bundle (Spec-Implementation Gap)

REQ-ROUTE-004 requires routing information documenting scope tags. The implementation does not provide this because the chosen architecture delegates routing to the `MemoryInjectionBundle` pipeline which operates independently.

**Verdict**: The spec requirement is not satisfied by the implementation as written. This may be a spec deficiency (requirement written before architecture was finalized) rather than an implementation failure.

### 4. Session Limit of 7 Not Enforced

The bundle says "Soft maximum of 7 memories per session." This is guidance only — there is no enforcement mechanism in the code. This is appropriate for a protocol (agents should follow guidance) but users might expect technical enforcement.

**Verdict**: Not a concern. "Soft maximum" and "preferring quality over quantity" are behavioral instructions, not system constraints.

---

## Recommendations

### 1. Address REQ-ROUTE-004 Routing Gap (Should Fix)

The spec requires routing information documenting scope tags. Since the bundle cannot access config at build time, consider:
- Option A: Add a post-processing step in the composition layer that injects scope tag documentation into the bundle output when `activeProvider !== "none"`
- Option B: Update the spec to clarify that routing documentation is handled by the `MemoryInjectionBundle` pipeline, not the package instruction bundle (align with the implemented architecture)
- Option C: Add a config parameter to the builder function (breaking with existing pattern but solving the requirement)

**Recommended**: Option B — the spec should align with the architecture. The behavioral protocol is in package instructions; the routing is in `MemoryInjectionBundle`. REQ-ROUTE-004 should be reclassified as satisfied by the existing pipeline.

### 2. Document Config Migration Path (Should Fix)

Users with `context-mode` or `rtk` in their existing `.deck/config.json` will get validation errors. The design recommends auto-stripping in the installer but doesn't specify the implementation. Consider adding a migration function in `deck-config.ts` that strips unknown package keys during `readDeckConfig`, or document clearly that this is an installer responsibility outside the scope of this change.

### 3. Clarify Context-Mode/RTK Behavioral Instruction Disposition (Should Fix)

The spec should explicitly state what happened to the behavioral instructions that were in `context-mode.ts` and `rtk.ts`. Were they migrated to the `MemoryInjectionBundle` pipeline? Are they no longer needed because agents have the MCP tools available directly? The design's rationale ("redundant because package instructions flow through the bundle/composition pipeline") is not clearly supported by the file contents.

---

## Final Assessment

| Dimension | Status | Notes |
|---|---|---|
| Architecture | PASS (with notes) | Bundle pattern correct; provider routing correctly delegated to existing pipeline |
| Security | PASS | No secrets; config validation is robust; `rejectSecretFields` covers nested objects |
| Maintainability | PASS | Clean code; comprehensive tests; clear separation of concerns |
| Scalability | PASS | URL parsing covers all common formats; type system is strict |
| Risks | CONCERNS | Config migration gap; REQ-ROUTE-004 not fully satisfied; context-mode/RTK disposition unclear |

**Overall: NEEDS_FIX**

The implementation is correct and well-executed. The concerns are spec-level (requirements that predate the architecture decision) rather than implementation-level failures. If the spec is updated to clarify that REQ-ROUTE-004 is satisfied by the `MemoryInjectionBundle` pipeline and that config migration is an installer responsibility, this would be a PASS.