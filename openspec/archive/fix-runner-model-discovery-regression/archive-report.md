# Archive Report: Fix Runner Model Discovery Regression

## Change Summary

**Change**: `fix-runner-model-discovery-regression`
**Status**: ✅ Archived
**Archive Location**: `openspec/archive/fix-runner-model-discovery-regression/`

### Lifecycle

| Phase | Date | Summary |
|---|---|---|
| Exploration | 2026-07-12 | Root cause identified: Deck derives model inventory and reasoning levels from the configured-provider-filtered OpenCode cache (148 candidates) instead of the runner's resolved inventory (107 models). 33 of 99 comparable models show live/cache variant mismatches. |
| Proposal | 2026-07-12 | Runner-resolved inventory as sole authority; exact final variant keys; bounded discovery (15 s timeout); safe stale assignment compatibility; Pi isolation. |
| Spec + Design | 2026-07-12 | 33 requirements, 36 scenarios; isolated strict parsing of `opencode models --verbose`; 15,000 ms subprocess deadline. |
| Tasks | 2026-07-12 | 10 tasks across 5 execution groups; routed to General, Backend, and Frontend Apply. |
| Apply | 2026-07-12 | All 10 tasks completed. One repair incident (`apply-group0-auth-card`) resolved automatically. |
| Verify | 2026-07-12–13 | Initial verify failed (26/33 requirements). Repair cycles 1 and 2 failed due to three exhausted scoped fingerprints. |
| Review | 2026-07-12–13 | Initial review found 8 High, 2 Medium, 1 Low blocking findings. Two repair review cycles partially resolved findings. |
| Repair | 2026-07-12–13 | 3 repair batches completed; human override authorized; closure exception attempted; separately authorized corrective resolution completed. |
| Corrective Resolution | 2026-07-13 | User-authorized corrective work resolved all remaining blockers. |
| Archive | 2026-07-13 | Change archived with full provenance. |

## Delivered Behavior

The change makes the OpenCode runner's resolved `opencode models --verbose` output the sole authoritative source for model availability and per-model reasoning variant keys in Deck's Developer Team TUI and configuration writes.

**Core changes:**
- New `opencode-models-cli.ts`: bounded shell-free `opencode models --verbose` executor with 15,000 ms hard subprocess deadline, strict identifier+JSON parser, output/record/key bounds, and UTF-8-safe stream decoding.
- New `model-inventory-cache.ts`: SHA-256 fingerprint (schema 2, secret-safe), 5-minute in-process LRU cache with in-flight coalescing, and private normalized 24-hour last-known-good (LKG) store.
- Replaced `model-inventory.ts`: runner-only inventory orchestration with memory → live → LKG → blocked result selection and intersection-only metadata enrichment.
- Modified `runner-adapter.ts` (OpenCode): async discovery port, exact variant-key validation, changed-agent fingerprint revalidation, and adapter-lifetime cache/LKG composition.
- Modified `model-config.ts` and `developer-team-install.ts`: native `variant` read/write, legacy `reasoningEffort` compatibility, non-destructive stale assignment reads, unchanged-field preservation, and atomic config merge.
- Modified `app.tsx` and developer team screens: async discovery loading/ready/empty/stale/blocked TUI states, keyboard-reachable Retry/Back, unavailable model/variant distinction, zero-variant behavior, and local rescan without `--refresh`.
- Modified `runner-adapter.ts` (core): runner-neutral async discovery result, validation, and variant-key contracts.
- New `model-discovery-context.ts`: secret-safe schema-2 production context collector.

**Pi remains unchanged**: Pi retains its fixed six-level reasoning and independent discovery through optional runner adapter ports.

**Reconciled changes:**
- `opencode-configured-providers-filter`: retained list windowing; superseded cache/auth as availability authority.
- `fix-opencode-effort-levels-hardcoded`: reused TUI plumbing; replaced cache/hardcoded authority with runner variants.
- `tui-model-assignment-bug`: consumed new validation boundary; assignment propagation remains separate.

## Traceability Matrix

| REQ-ID | Task | Implementation | Verify Result | Review Rating |
|---|---|---|---|---|
| REQ-INV-001 Sole availability authority | 1.3 | ✅ | ✅ PASS | ✅ |
| REQ-INV-002 Exact inventory membership | 1.3, 3.1 | ✅ | ✅ PASS | ✅ |
| REQ-INV-003 Provider-kind neutrality | 1.1 | ✅ | ✅ PASS | ✅ |
| REQ-INV-004 Valid empty inventory | 1.3 | ✅ | ✅ PASS | ✅ |
| REQ-VAR-001 Exact final variant keys | 1.1 | ✅ | ✅ PASS | ✅ |
| REQ-VAR-002 No synthetic/normalized levels | 1.3 | ✅ | ✅ PASS | ✅ |
| REQ-VAR-003 Zero-variant behavior | 2.1, 3.1 | ✅ | ✅ PASS | ✅ |
| REQ-VAR-004 Model-specific recomputation | 3.1 | ✅ | ✅ PASS | ✅ |
| REQ-META-001 Enrichment cannot expand authority | 1.3 | ✅ | ✅ PASS | ✅ |
| REQ-META-002 Enrichment isolation | 1.3 | ✅ | ✅ PASS | ✅ |
| REQ-DISC-001 Discovery timeout (15 s) | 1.1, R1 | ✅ | ✅ PASS | ✅ |
| REQ-DISC-002 5-minute freshness window | 1.2, R1 | ✅ | ✅ PASS | ✅ |
| REQ-DISC-003 Fingerprint coverage/secrecy | 1.2, R1 | ✅ | ✅ PASS | ✅ |
| REQ-DISC-004 Immediate invalidation | 1.2, R1 | ✅ | ✅ PASS | ✅ |
| REQ-DISC-005 Optional LKG eligibility | 1.2, R1 | ✅ | ✅ PASS | ✅ |
| REQ-DISC-006 Ineligible snapshot rejection | 1.2, R1 | ✅ | ✅ PASS | ✅ |
| REQ-DISC-007 Safe blocked failure | 1.3 | ✅ | ✅ PASS | ✅ |
| REQ-DISC-008 Stale write safety | 2.2 | ✅ | ✅ PASS | ✅ |
| REQ-DISC-009 Network refresh separation | 3.1 | ✅ | ✅ PASS | ✅ |
| REQ-ASG-001 Non-destructive reads | 2.2 | ✅ | ✅ PASS | ✅ |
| REQ-ASG-002 Precise unavailable state | 3.1 | ✅ | ✅ PASS | ✅ |
| REQ-ASG-003 Validate only affected writes | 2.2 | ✅ | ✅ PASS | ✅ |
| REQ-ASG-004 Changed model validation | 2.1 | ✅ | ✅ PASS | ✅ |
| REQ-ASG-005 Changed variant validation | 2.1 | ✅ | ✅ PASS | ✅ |
| REQ-ASG-006 Model-change variant transition | 2.1, 3.1 | ✅ | ✅ PASS | ✅ |
| REQ-ADP-001 Per-runner authority contract | 0.1 | ✅ | ✅ PASS | ✅ |
| REQ-ADP-002 Pi anti-regression | 2.3 | ✅ | ✅ PASS | ✅ |
| REQ-ADP-003 Failure isolation | 2.3 | ✅ | ✅ PASS | ✅ |
| REQ-REC-001 Provider-filter reconciliation | 4.1 | ✅ | ✅ PASS | ✅ |
| REQ-REC-002 Effort-level reconciliation | 4.1 | ✅ | ✅ PASS | ✅ |
| REQ-REC-003 Assignment-flow reconciliation | 4.1 | ✅ | ✅ PASS | ✅ |
| REQ-TEST-001 Hermetic test boundaries | 0.2 | ✅ | ✅ PASS | ✅ |
| REQ-TEST-002 Required regression matrix | 4.1, R1 | ✅ | ✅ PASS | ✅ |

## Verification

**Final Result**: PASS

| Gate | Result | Details |
|---|---|---|
| Focused corrective matrix | ✅ 151/151 passed | Tasks 0.1–4.1, R1, corrective repair evidence |
| Typecheck | ✅ PASS | `bunx tsc --noEmit` — exit 0 |
| Broader adapter/TUI | ✅ 607/607 passed | `bun test packages/adapter-opencode/src apps/cli/src/tui` |
| Package tests | ✅ 3,285/3,285 passed | `bun run test` |
| Repo-wide | ✅ 3,284 passed; 1 known baseline failure | `bun test`; only `Binary smoke tests > doctor runs and reports diagnostics` (recorded baseline fingerprint, unrelated to this change) |
| New failures introduced | None | No new regression fingerprints observed |

## Review

**Final Rating**: APPROVE (zero Critical/High/Medium/Low findings)

The separately authorized corrective resolution resolved all remaining blocking findings from the repair/review cycles:

1. **Backend fingerprint projection**: replaced heuristic string redaction with a typed field-aware semantic projection that preserves allowlisted non-secret provider/model/plugin/path/control values and `OPENCODE_CONFIG_CONTENT` references.
2. **Mounted DeckApp transitions**: added `DeckApp`-level deferred discovery transition tests covering latest-request-first reverse completion, Back action, and project-identity changes.
3. **Release-check isolation**: injected local mock to prevent process-wide module interference.
4. **Terminology cleanup**: replaced all remaining obsolete cache-authority prose with runner-resolved terminology.

## Known Baseline

The only failing repo-wide test is `Binary smoke tests > doctor runs and reports diagnostics`, which times out after 5,000 ms. This failure:
- Matches the exact fingerprint recorded in `openspec/baseline-health.yaml`
- Is unrelated to OpenCode model discovery behavior
- Was present before this change
- Does not block archive

## Repair History

| Phase | Outcome | Key Events |
|---|---|---|
| Apply | Completed (10/10 tasks) | One auth-card repair incident auto-resolved |
| Verify (initial) | Failed — 26/33 req | 3 Critical findings: disconnected cache/fingerprint/LKG, non-hard deadline, incomplete matrix |
| Review (initial) | Changes requested — 8 High, 2 Medium, 1 Low | Production composition, process bounds, variant leak, assignment mutation, async ordering, empty routing, LKG privacy, matrix gaps |
| Repair batch 1 | Completed | Fixed adapter-lifetime cache, secret-safe fingerprint, bounded termination, UTF-8, LKG privacy, immutable plans |
| Repair batch 2 | Completed | Fixed variant resolution, latest-request guard, empty routing |
| Repair batch 3 | Completed | Completed deterministic regression matrix; reconciled obsolete terminology |
| Verify cycle 1 | Failed — 32/33 req | 1 exhausted fingerprint: `opencode-timeout-not-hard-bounded` |
| Review cycle 1 | Changes requested | 5/8 High resolved; deadline and matrix fingerprints exhausted |
| Human override | Authorized | One focused R1 backend batch authorized for 3 scoped fingerprints |
| Verify cycle 2 | Failed — 32/33 req | `required-regression-matrix-incomplete` recurred (mounted DeckApp evidence absent) |
| Review cycle 2 | Blocked | 1/3 scoped fingerprints resolved; hard stop reached |
| Closure exception | Partial; failed | Limited corrective work completed but broader gates timed out |
| Corrective resolution | PASS | User-authorized corrective backend and frontend work; 33/33 req, 36/36 scenarios, 11/11 tasks, 0 findings |
| Final review | APPROVE | 0 Critical/High/Medium/Low; archive ready |

## Rollback

To rollback this change:
1. Revert the OpenCode adapter discovery changes, new `opencode-models-cli.ts`, `model-inventory-cache.ts`, `model-discovery-context.ts`, TUI async state wiring, and new/modified tests introduced in this change.
2. Delete `~/.cache/deck/opencode/model-inventory-v1/` LKG files if desired (they are schema-versioned and safe to discard).
3. No data migration required: persisted assignments remain valid OpenCode config; unchanged `reasoningEffort` values survive; newly changed assignments use native `variant` which OpenCode understands.
4. Pi behavior is unchanged and requires no rollback.

## Final Status

- **Change ID**: `fix-runner-model-discovery-regression`
- **Phase**: archive
- **Status**: archived
- **Requirements**: 33/33 verified
- **Scenarios**: 36/36 verified
- **Tasks**: 11/11 completed
- **Final verification**: PASS (corrective resolution)
- **Final review**: APPROVE (0 findings)
- **Known baseline**: 1 unrelated failure (recorded fingerprint)
- **Repair history**: Preserved in full in `events.yaml` and `repair-incident.md`
- **Follow-ups**: None — change is fully closed.

## Follow-ups

None — change is fully closed.

## Project AI Notes (Phase 5 — Deferred)

> Project AI notes are a planned Phase 5 feature under `.deck/ai-notes/`. Not yet active.

### Extracted Learnings

- **What**: The OpenCode runner's resolved verbose model inventory diverges materially from the auth-filtered `models.json` cache (148 vs 107 models; 33 variant mismatches), proving the runner is the only reliable availability authority.
- **Why**: Cache/catalog metadata was used as an availability source because it was fast and available; the runner is authoritative even when slower (7.55 s cold, 4.11 s warm).
- **Where**: `packages/adapter-opencode/src/model-inventory.ts`, `packages/adapter-opencode/src/opencode-models-cli.ts`, `packages/adapter-opencode/src/model-inventory-cache.ts`, `packages/adapter-opencode/src/model-discovery-context.ts`.
- **Learned**: A 15-second hard subprocess deadline is sufficient for OpenCode 1.17.18 discovery; a 3-second deadline is too short and blocks the critical path. Secret-safe fingerprinting requires field-aware typed projections, not blanket string redaction, to preserve non-secret semantic config signals. Production composition wiring (cache/LKG) must be tested at the default adapter boundary, not only in isolated unit tests. Mounted DeckApp component tests cannot be replaced by coordinator unit tests for production boundary verification.
