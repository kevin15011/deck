# Exploration: Historical OpenSpec cleanup and docs/release hygiene

## Goal

Determine whether the user request — “limpieza histórica y docs/release hygiene” — should be handled as a single SDD or as two separate SDDs, and identify the minimal actionable scope, risks, and next steps for each.

## Current State

### 1. Historical OpenSpec changes are floating without lifecycle closure

Three exploration-only changes remain open in `openspec/changes/` with clear root causes but no follow-up Proposal/Spec/Design/Tasks:

| Change | Current registry state | Root cause status | Implementation status |
|---|---|---|---|
| `fix-provider-engram-leak` | `phase: explore`, `status: completed`, only `exploration.md` | Found: `memoryBundle === undefined` caused provider filter to skip, plus legacy `p:` prefix | **Implemented** by `redesign-supermemory-mcp-memory` (REQ-R25/R26): `prompt-generation.ts` now uses `explicitProvider` fallback and `sm_project_` prefix. The `p:` prefix is gone. |
| `fix-adaptive-memory-heading-duplication` | `state: explore`, `status: completed`, only `exploration.md` | Found: 3 independent injection paths plus `**memory**` bold refs | **Implemented** by `redesign-supermemory-mcp-memory` (REQ-R32): `adaptive-memory.ts` no longer starts fragments with `## Adaptive Memory` and uses `` `memory` ``/`` `recall` `` backticks. |
| `fix-supermemory-userid-validation` | `status: exploring` + `phases.explore.status: completed`, contradictory | Found: `deck-config.ts` validation required `userId` despite token-only contract | **Mostly implemented** by `redesign-supermemory-mcp-memory` (REQ-SPM-004): `DEPRECATED_SUPERMEMORY_FIELDS` strips `userId`/`teamId`/`orgId`/`projectId`, and tests now assert Supermemory works without `userId`. However, dead code remains: `SUPERMEMORY_USER_ID_REQUIRED` error code in the union and a special-case in `normalizeOptionalString`. |

These three cases were explicitly identified in `docs/openspec-retrospective-audit-2026-06-12.md` (P1 finding #3) and in the archived SDD `exploration-lifecycle-states`, whose follow-ups list “cleanup manual de los tres casos históricos detectados por auditoría” as a recommended follow-up.

`deck openspec validate --json --root /home/kevinlb/deck` currently reports **764 errors and 546 warnings across 68 changes** (30 active, 38 archived). The three target changes only produce legacy-schema *warnings* (`state.schema.missing`, `state.currentPhase.legacy_field`), but the global registry is far from clean.

### 2. Docs/release metadata is out of sync

| Source | Value | Drift |
|---|---|---|
| `package.json` root | `0.1.6` | Canonical version. |
| `apps/cli/package.json` | `0.0.0` | Workspace package version is not kept in sync. |
| `apps/cli/src/runtime/build-info.generated.ts` | `0.1.6` | Generated from root `package.json`; currently correct. |
| `README.md` | **v0.0.4** | Stale; contradicts root version. |
| `CHANGELOG.md` | `[Unreleased]` only | No historical release sections; `[Unreleased]` link points to `gentleman-programming/deck` instead of `kevin15011/deck`. |
| `docs/deuda-tecnica.md` | references `0.1.4` | Already stale relative to current `0.1.6`. |

The release workflow (`.github/workflows/release.yml`) uses root `package.json` version for main-branch pre-releases and tag-based versions for stable releases, so the operational source of truth is root `package.json`. `scripts/generate-build-info.ts` also reads root `package.json` by default.

### 3. `deck openspec validate` and `deck doctor` gaps

- `deck openspec validate --json` run from the workspace directory resolves `rootDir` to `process.cwd()` (`/home/kevinlb/deck/apps/cli`) and finds **0 changes** because `openspec/` lives two levels up. Users must pass `--root /home/kevinlb/deck`.
- `deck doctor` does not yet invoke `deck openspec validate`; this is a documented follow-up from `openspec-registry-schema-validator/archive-report.md`.
- No CI gate currently enforces registry validation.

## Relevant Files

- `openspec/changes/fix-provider-engram-leak/state.yaml` / `events.yaml` / `exploration.md` — floating exploration, implemented elsewhere.
- `openspec/changes/fix-adaptive-memory-heading-duplication/state.yaml` / `events.yaml` / `exploration.md` — floating exploration, implemented elsewhere.
- `openspec/changes/fix-supermemory-userid-validation/state.yaml` / `events.yaml` / `exploration.md` — floating exploration, mostly implemented, dead code remains.
- `openspec/archive/redesign-supermemory-mcp-memory/archive-report.md` — SDD that implemented the fixes above.
- `openspec/archive/exploration-lifecycle-states/spec.md` — formalized `diagnosed`/`deferred`/`closed-no-action`/`converted-to-change` lifecycle for exploration closures.
- `openspec/archive/openspec-registry-schema-validator/archive-report.md` — validator SDD; follow-ups include doctor integration and CI gate.
- `docs/openspec-retrospective-audit-2026-06-12.md` — audit that flagged the floating explorations.
- `docs/deuda-tecnica.md` — prior tech-debt audit recommending release metadata cleanup.
- `README.md` — stale version.
- `CHANGELOG.md` — missing versions, wrong repo link.
- `package.json` — canonical version.
- `apps/cli/package.json` — workspace version `0.0.0`.
- `apps/cli/src/runtime/build-info.ts` / `build-info.generated.ts` — build metadata.
- `apps/cli/src/openspec-validate-command.ts` — CLI adapter that defaults to `process.cwd()`.
- `apps/cli/src/doctor-command/doctor-diagnostics.ts` / `doctor-checks.ts` — doctor checks, no OpenSpec validation yet.
- `.github/workflows/release.yml` — release pipeline.
- `scripts/generate-build-info.ts` / `scripts/prepare-release.ts` — release helpers.

## Constraints

- OpenSpec artifacts are official context; any registry update must preserve existing artifacts/events and use canonical `spec-registry-v1` / `spec-registry-events-v1`.
- Do not modify product code during exploration; cleanup of dead `SUPERMEMORY_USER_ID_REQUIRED` code belongs to an Apply phase, not this Explorer phase.
- `apps/cli/src/runtime/build-info.generated.ts` must not be edited manually; it is regenerated by `scripts/generate-build-info.ts`.
- Do not touch `.codebase-memory/*`.
- Historical registry cleanup should be surgical; a global migration of all 68 changes is out of scope for a quick cleanup.

## Risks

- **Lifecycle misclassification**: Closing the three changes as `closed-no-action` when they were actually implemented by `redesign-supermemory-mcp-memory` would lose traceability. They should be `converted-to-sdd` or `closed-no-action` with a clear rationale.
- **False confidence from validator**: The validator currently emits many legacy warnings; fixing only the three target changes will not make `deck openspec validate` pass globally.
- **Version bump politics**: Updating `README.md`/`CHANGELOG.md` requires deciding whether the current unreleased state is `0.1.6` or whether a new release should be cut.
- **Doctor integration scope creep**: Integrating `deck openspec validate` into `deck doctor` could pull in the entire registry state as a user-visible failure surface.
- **Root detection coupling**: Changing `openspec-validate-command.ts` to auto-discover project root may affect other commands that rely on `process.cwd()`.

## Options and Tradeoffs

### Option A: Single SDD covering both historical cleanup and docs/release hygiene

- **Description**: One change updates the three historical OpenSpec entries, synchronizes README/CHANGELOG/package.json versions, fixes `deck openspec validate` root detection, and integrates validation into `deck doctor`.
- **Pros**: Single proposal/review cycle; easy to sequence; both topics are “hygiene”.
- **Cons**: Mixed domains (registry archaeology vs. release docs/CLI behavior); larger scope; harder to review; risks one half blocking the other.
- **Effort**: Medium-High.

### Option B: Two separate SDDs (recommended)

1. **`openspec-historical-cleanup`** — Close/reclassify the three floating explorations (and any other obvious exploration-only drift) using the lifecycle vocabulary from `exploration-lifecycle-states`. Optionally remove dead `SUPERMEMORY_USER_ID_REQUIRED` code if it is bundled as a small cleanup task.
2. **`docs-release-hygiene`** — Sync README/CHANGELOG with root version, fix `[Unreleased]` link, consider whether `apps/cli/package.json` version should mirror root, improve `deck openspec validate` root detection, and integrate registry validation into `deck doctor` / CI.

- **Pros**: Clear scope per SDD; independent review/apply; lower risk; can run in parallel; aligns with existing archived SDDs (`exploration-lifecycle-states`, `openspec-registry-schema-validator`) whose follow-ups already point this way.
- **Cons**: Two proposal cycles; minor coordination needed to avoid conflicting registry edits.
- **Effort**: Low-Medium each.

## Recommendation

**Proceed with Option B: two separate SDDs.**

- `openspec-historical-cleanup` is registry/lifecycle archaeology and should be owned by the methodology/registry track.
- `docs-release-hygiene` is release-engineering/CLI surface and should be owned by the CLI/release track.

Both are small, low-risk, and actionable. They can be proposed and applied independently. The current exploration artifact (`historical-cleanup-docs-release-hygiene`) can be closed as the discovery that justifies the split, or converted into one of the two new changes.

## Actionable Diagnosis

**Yes.**

- Three OpenSpec changes are floating with known root causes and should be formally closed/reclassified.
- README/CHANGELOG release metadata is stale and inconsistent with `package.json`.
- `deck openspec validate` has a UX gap (workspace root detection) and is not integrated into `deck doctor`/CI.

## Suggested Lifecycle Outcome

**Split into two new SDDs**:

- `openspec-historical-cleanup` — close `fix-provider-engram-leak`, `fix-adaptive-memory-heading-duplication`, and `fix-supermemory-userid-validation` using lifecycle states `converted-to-sdd` (referencing `redesign-supermemory-mcp-memory`) or `closed-no-action` where appropriate; include dead-code removal for `SUPERMEMORY_USER_ID_REQUIRED` if desired.
- `docs-release-hygiene` — sync README/CHANGELOG, fix `deck openspec validate` root auto-detection, integrate validation into `deck doctor`, and add CI gate.

The current exploration change `historical-cleanup-docs-release-hygiene` should then be archived as `closed-no-action` or `converted-to-sdd` referencing the two new changes.

## Open Questions

1. Should `apps/cli/package.json` version be kept in sync with root, or is `0.0.0` intentional for a private workspace package?
2. Should `CHANGELOG.md` receive a `[0.1.6]` section now, or remain `[Unreleased]` until a formal release is tagged?
3. For the three historical changes, do we prefer `converted-to-sdd` (pointing to `redesign-supermemory-mcp-memory`) or `closed-no-action` with a rationale that the fixes were absorbed elsewhere?
4. Should the cleanup also address other obvious exploration-only entries in `openspec/changes/` (e.g., `adaptive-memory-protocol-exploration`, `hexagonal-architecture-memory-refactor`), or limit scope to the three named cases?
5. Should `deck doctor` surface all 764 validator errors, or only a summary/exit-code hint to avoid overwhelming users?

## Ready for Proposal

**Yes**, with the recommendation to split into two proposals.

The orchestrator should ask the user to confirm:
- Whether to create **two SDDs** (`openspec-historical-cleanup` and `docs-release-hygiene`) or keep a single combined SDD.
- Which lifecycle classification to use for the three historical changes (`converted-to-sdd` vs `closed-no-action`).
- Whether to include the dead `SUPERMEMORY_USER_ID_REQUIRED` cleanup in the historical SDD.

## Registry

- **Artifact Path**: `openspec/changes/historical-cleanup-docs-release-hygiene/exploration.md`
- **State Path**: `openspec/changes/historical-cleanup-docs-release-hygiene/state.yaml`
- **Events Path**: `openspec/changes/historical-cleanup-docs-release-hygiene/events.yaml`
- **Recorded**: phase `explore`, status `completed`, event `explore.completed`
- **Registry Blocker**: none
