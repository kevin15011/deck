# Review Report: runner-model-recognition-effort-levels

## Summary

**Overall Rating**: APPROVE WITH WARNINGS  
**Scope**: general, backend, frontend, integration  
**Files Reviewed**: 18  
**Registry Mode**: deferred; this report updates only `review-report.md`.

This rerun focused on the two prior blockers and the final repair events `pi-detector-restored` and `opencode-variant-persistence-fixed` in `apply-progress.md`. Both prior blockers are resolved from a review perspective:

- The Pi model inventory detector has been restored in `apps/cli/src/tui/app.tsx`, and all three Pi call sites now resolve to `detectPiModelInventoryForTui()` while OpenCode call sites use `detectOpenCodeModelInventoryForTui()`.
- Native OpenCode `variant` write validation now accepts either runner-owned inventory confirmation or Deck-owned variant-cache confirmation and still fails closed when neither source confirms the candidate.

Focused deterministic tests were run during review and passed:

- `bun test packages/adapter-opencode/src/developer-team-install.test.ts packages/adapter-opencode/src/model-config.test.ts packages/adapter-opencode/src/model-inventory.test.ts packages/adapter-opencode/src/model-variants.test.ts packages/adapter-opencode/src/runner-adapter.inventory.test.ts packages/core/src/__tests__/model-reasoning-capability.test.ts`
- `bun test apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx`

No `gentle-ai` / non-runner dependency was found in touched source or asset files. No dynamic `require()` remains in touched backend source files. One OpenCode plugin asset still has a CommonJS direct-run guard; because the primary production path now uses runner-owned inventory and the cache is a fallback, this is accepted as a warning rather than a blocker.

## Ratings by Dimension

| Dimension | Rating | Notes |
|---|---|---|
| Architecture | ⚠️ Adequate | Runner-owned inventory is now the primary source and Deck cache is a fallback, but variant-confirmation logic is duplicated across read, resolve, write, and TUI support paths. |
| Security | ✅ Strong | Variant values are confirmed against trusted inventory/cache sources before being persisted; unknown/stale values fail closed. No forbidden external model source dependency was found. |
| Scalability | ✅ Strong | Local cache/inventory lookups are small and bounded; no network or live runner calls are used in the focused tests. |
| Maintainability | ⚠️ Adequate | Repairs are localized and readable, but OpenCode boundary types still mix open string runtime behavior with narrower `OpenCodeThinkingLevel` / `OpenCodeModelConfig` annotations. |
| Code Quality | ⚠️ Adequate | Clear comments explain fail-closed behavior. Some stale comments and duplicated validation logic should be cleaned after archive. |
| Backend | ⚠️ Adequate | Inventory/cache write confirmation is correct. ESM/plugin-cache lifecycle remains fragile but no longer blocks the final repairs. |
| Frontend | ✅ Strong | Pi compatibility is restored and OpenCode/Pi inventory detection is separated at call sites. |
| Integration | ⚠️ Adequate | TUI, adapter inventory, config read, and write boundaries now align for the prior blocker cases; additional non-standard variant write coverage is recommended. |
| Economy / Critical Judgment | ✅ Strong | Fixes are localized and avoid new dependencies or broad rewrites. |

## Findings

### BLOCKER

None.

### MAJOR

None.

### MINOR

- **Maintainability / Type Safety**: OpenCode variant values are runtime-open strings, but some adapter boundary types still encode closed legacy effort assumptions.
  - **Files**: `packages/adapter-opencode/src/model-config.ts` — lines 34-37 and 202-210; `packages/adapter-opencode/src/developer-team-install.ts` — lines 382-391.
  - **Evidence**: `OpenCodeModelConfig.reasoningEffort` is typed as `"low" | "medium" | "high"`, `resolveModelConfig()` accepts `OpenCodeThinkingLevel`, and `buildAgentEntry()` casts `Record<string, string>` to the closed set before runtime validation. The runtime path can still carry a value such as `xhigh`, but the type contract does not honestly express it.
  - **Recommendation**: After archive, widen OpenCode adapter boundary types to validated `string` (or introduce a named `OpenCodeVariantKey = string`) while retaining `"off"` as a UI/control sentinel only.

- **Backend / ESM / Plugin Cache Fallback**: The optional Deck-owned OpenCode variant-cache plugin asset still contains a CommonJS direct-run guard.
  - **File**: `packages/adapter-opencode/assets/opencode/plugins/model-variants.ts` — lines 100-103.
  - **Evidence**: The asset contains `if (require.main === module) { activate(); }`. The package is ESM-oriented and plugin loading may evaluate the asset in an environment where `require` is unavailable.
  - **Recommendation**: Remove the direct-run guard unless direct execution is required; otherwise replace it with an ESM-safe `import.meta.url` check. Keep runner-owned inventory as the primary source and treat the Deck-owned cache as optional until the plugin lifecycle is explicitly hardened.

- **Backend / Plugin Lifecycle**: Deck-owned variant plugin registration is still coupled to Mermaid plugin missing status.
  - **File**: `packages/adapter-opencode/src/developer-team-install.ts` — lines 678-680.
  - **Evidence**: `INTERNAL_OPENCODE_PACKAGE_IDS.filter(() => plan.mermaidPluginStatus === "missing")` adds all internal package IDs only when Mermaid is missing rather than independently evaluating `deck-model-variants` lifecycle.
  - **Recommendation**: In a follow-up, track Mermaid and model-variant plugin status independently, or document that Deck-owned variant cache support is opportunistic and not required for the primary inventory path.

### NIT

- **Tests**: The final repair tests are deterministic and cover inventory-confirmed, cache-confirmed, unconfirmed, and no-legacy-`reasoningEffort` writes. They should be strengthened later with a confirmed non-standard variant such as `xhigh` and a DeckApp-level Pi branch regression, not only adapter/screen-level checks.
  - **Files**: `packages/adapter-opencode/src/developer-team-install.test.ts` — lines 243-381; `apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx` — lines 503-522.
  - **Recommendation**: Add one write-path test where inventory confirms `xhigh`, and one TUI flow test that reaches the restored Pi detector branch in `DeckApp`.

## Prior Findings Resolution

| Prior Finding | Status | Evidence |
|---|---|---|
| OpenCode native `variant` write path validates only against Deck-owned variant cache | Resolved | `buildAgentEntry()` now checks injected or default `loadModelInventory()` first and falls back to injected/default variant cache lookup before writing `entry.variant` (`packages/adapter-opencode/src/developer-team-install.ts`, lines 417-465). Focused tests cover inventory-confirmed, cache-confirmed, and unconfirmed writes. |
| Pi detector removed while Pi call sites still referenced it | Resolved | `detectPiModelInventoryForTui()` is restored (`apps/cli/src/tui/app.tsx`, lines 2329-2377), and call sites at lines 1484, 1663, and 2005 dispatch Pi vs OpenCode correctly. |
| No `gentle-ai` / non-runner model source dependency | Resolved | Source and asset scan found no forbidden dependency in touched implementation files; references remain only in OpenSpec artifacts documenting the constraint. |
| No dynamic `require()` in touched backend files | Resolved for backend source | No dynamic `require()` remains in touched backend source files. Test files still use Bun-compatible `require()` in a few places, and the optional plugin asset still has `require.main`; both are warnings, not current blockers. |
| Test adequacy after final blockers | Acceptable with warning | Focused backend and frontend tests pass and use deterministic injected fixtures/mocks. Coverage should be strengthened for confirmed non-standard variants and DeckApp Pi branch traversal. |

## Design Fidelity

- **Aligned**: Yes, with warnings.
- **Deviations / Concerns**:
  - The primary OpenCode path now favors runner-owned inventory and uses Deck-owned variant cache as a fallback, matching the intended trusted-source model.
  - Variant validation is implemented in several places rather than centralized. This is acceptable for the blocker fix but creates drift risk.
  - The optional Deck-owned cache plugin lifecycle remains under-hardened; direct inventory support keeps this from blocking archive.

## Positive Notes

- The final OpenCode write-path fix is fail-closed: unconfirmed variants are omitted instead of persisted.
- The write path no longer emits legacy `reasoningEffort` for new Deck-managed OpenCode entries.
- The Pi and OpenCode detector split in `app.tsx` is straightforward and preserves Pi compatibility.
- The focused tests are deterministic and avoid live provider, network, OAuth, or runner-service dependency.
- The implementation stays localized and avoids introducing new dependencies or abstractions.

## Risk Assessment

- **Current archive risk**: Low to medium. The two previous blockers are resolved and focused tests pass.
- **Residual risk**: Medium for future maintenance around duplicated variant validation and plugin-cache lifecycle. These are not blocking because runner-owned inventory is now the primary source and validation fails closed.
- **Security risk**: Low. Unknown or unsupported variants are not persisted, and no forbidden external model source was introduced.
- **Compatibility risk**: Low for Pi after the detector restoration; medium for the optional OpenCode variant-cache plugin until the ESM guard and independent lifecycle are cleaned up.

## Files Inspected

- `openspec/changes/runner-model-recognition-effort-levels/apply-progress.md`
- `openspec/changes/runner-model-recognition-effort-levels/spec.md`
- `openspec/changes/runner-model-recognition-effort-levels/tasks.md`
- `openspec/changes/runner-model-recognition-effort-levels/design.md`
- `openspec/changes/runner-model-recognition-effort-levels/review-report.md` (previous report)
- `apps/cli/src/tui/app.tsx`
- `apps/cli/src/tui/screens/developer-team-screens.tsx`
- `apps/cli/src/tui/__tests__/developer-team-screens-effort.test.tsx`
- `packages/adapter-opencode/src/developer-team-install.ts`
- `packages/adapter-opencode/src/developer-team-install.test.ts`
- `packages/adapter-opencode/src/model-config.ts`
- `packages/adapter-opencode/src/model-config.test.ts`
- `packages/adapter-opencode/src/model-inventory.ts`
- `packages/adapter-opencode/src/model-inventory.test.ts`
- `packages/adapter-opencode/src/model-variants.ts`
- `packages/adapter-opencode/src/model-variants.test.ts`
- `packages/adapter-opencode/src/runner-adapter.ts`
- `packages/adapter-opencode/assets/opencode/plugins/model-variants.ts`
- `packages/core/src/runner-adapter.ts`
- `packages/core/src/model-reasoning-capability.ts`
- `packages/core/src/__tests__/model-reasoning-capability.test.ts`

## Open Questions

None.
