# Archive Report — stabilize-repository-broad-baseline

## Status

- **Change ID:** `stabilize-repository-broad-baseline`
- **Archive status:** COMPLETE
- **Archived location:** `openspec/archive/stabilize-repository-broad-baseline/`
- **Decision digest:** `sha256:f5681233b683b0b4d58f6ec1f43cd82f6b8b5926dba4ae700aec1c32db7549c1`
- **Classification:** Run SDD / Interactive / Archive only
- **Archive agent:** `deck-developer-archive` / `minimax-coding-plan/MiniMax-M2.5-highspeed` / `opencode`
- **Produced at:** `2026-07-28T06:15:00.000Z`
- **Git operations:** None authorized; filesystem move only

---

## Lifecycle Traceability

| Phase | Status | Artifact digest | Size |
|---|---|---|---|
| Explore | `explore.completed` | (authored) | 300 lines |
| Proposal | `proposal.completed` + `proposal.approved` | `sha256:45afcae01535dd69a029a8a4d87ab79be905612efaa5212a1427516aeb6e50d1` | 15,858 bytes |
| Spec | `spec.completed` | `sha256:d6bd774a2eb3dda41b7ff1e08c619b5edc12e000d8f6be4f85a78369245cde4c` | 29,690 bytes |
| Design | `design.completed` | `sha256:569b3564dd56f18bd50282b503befb545b64c2e90017ed7ac1b8ca2095cad167` | 43,918 bytes |
| Tasks | `tasks.completed` + `preconditions.created` | `sha256:8e8fd8f3f7fe66ae67f2e054eb276bf66d148b37913165704a435081b4a93739` | 38,016 bytes |
| Apply | `apply.completed` + `apply.general.fix_completed` (×3) | `sha256:f79c2cf2fc6f8c023108d1d11cce8b5b9994b2ae9adbeae2b942cb2b053abe64` | 37,962 bytes |
| Verify | `verify.passed` (×7) + `verify.failed` (×2) | `sha256:d6a97b2351e5d30bc786b8f6c85f9011436d116b1313110b973cc0d3de0eca57` | 105,378 bytes |
| Review | `review.passed` + `review.failed` (×2) | `sha256:78c3e51c20277e0c27e59c4da9d9c4ee5a2df51f86dd3fbb4db8db6a60e43ffb` | 67,049 bytes |

The change completed 14 lifecycle events across 4 repair loops (Doctor seam, five-finding Review repair, F-REV-BIN-002 containment). All phases reached terminal status.

---

## Delivered Scope

### Eight authorized implementation targets — all delivered

| # | Path | Change | Final status |
|---|---|---|---|
| 1 | `docs/architecture.md` | Two stale archive-link destinations corrected | PASS |
| 2 | `packages/adapter-pi/src/install-tools.ts` | Same-fourth-position typed object seam + `sharedBinaryUsabilityTimeoutMs` member | PASS |
| 3 | `packages/adapter-pi/src/install-tools.test.ts` | Deterministic ready/missing/unusable/uv/pipx fixtures | PASS |
| 4 | `apps/cli/src/tui/app.opencode-discovery.test.tsx` | Bounded fresh-output synchronization, 5 s deadline, stale-output rejection, async cleanup | PASS |
| 5 | `apps/cli/src/__tests__/binary-smoke.test.tsx` | 20 s command deadline, 4 s cleanup budget, POSIX/Windows lifecycle, strict shims, causal outside-sandbox containment inventory | PASS |
| 6 | `apps/cli/src/doctor-command/doctor-diagnostics.ts` | Exact four-member `DoctorDiagnosticsDependencies` seam: `runDeckChecks`, `fetchReleaseDescriptor`, `memoryBinaryAvailable`, `readOpenCodeMcpSection` | PASS |
| 7 | `apps/cli/src/__tests__/doctor-diagnostics.test.ts` | Deterministic four-boundary unit fixtures | PASS |
| 8 | `openspec/baseline-health.yaml` | Evidence-gated `pass`, `4020` passed, `0` failed, no active fingerprint | PASS |

No ninth path, generated output, dependency manifest, lockfile, production TUI, shared utility, or non-allowlisted target was modified.

---

## Final QA Results

### BROAD — final mandatory gate

| Check | Command | Exit | Result |
|---|---|---|---|
| Mandatory BROAD | `bun test --timeout 30000` | **0** | **4,020 pass / 0 fail / 222 files / 51.375 s wall** |
| TypeScript | `bunx tsc --noEmit` | **0** | 0 errors / 27.012 s |
| OpenSpec | `bun run deck -- openspec validate --json --change stabilize-repository-broad-baseline --root /home/kevinlb/deck` | **0** | `ok: true` / 0 errors / 0 warnings |

All hygiene, identity, ledger, parent, and exclusion checks passed at final BROAD.

### OpenSpec validation

Exit `0`; `ok: true`; 1 valid active change; 0 errors; 0 warnings.

---

## Repairs, Findings, and Closure

### Repair loop 1 — Doctor four-member seam (T6/T5/T11)

| Finding | Root cause | Resolution |
|---|---|---|
| `F-VFY-TGT-001` | Design AD-5 required four Doctor members; Tasks initially misinterpreted two | Tasks repaired to require `runDeckChecks`, `fetchReleaseDescriptor`, `memoryBinaryAvailable`, `readOpenCodeMcpSection` |
| `F-VFY-TGT-002` | Two-member seam left real PATH/filesystem helpers in unit path | Four-member injection; deterministic unit fixtures; real integration preserved in `doctor-checks.test.ts` |
| `F-VFY-TGT-003` | Deterministic per-class RED evidence unavailable from interrupted Apply | Fresh RED `sha256:17ba7ffd5686281ec2622f47b52560973efbbbbdf04f4ce2d39b265a2a3e8b00` → GREEN `sha256:224fa89162165fa201e6aabac3fb54dcee14f392a5950123405d36e01c984772` |

### Repair loop 2 — Five-finding Review repair (T13 → Apply repair)

| Finding | Root cause | Resolution |
|---|---|---|
| `F-REV-PI-001` | `sharedBinaryTimeoutMs` not `sharedBinaryUsabilityTimeoutMs` | Exact Design member spelling corrected |
| `F-REV-PI-002` | Host-probing shared-binary test bypassed seam | Deterministic probe fixture injected; assertion `probeCalls === ["rtk"]` |
| `F-REV-BIN-001` | Windows descendant cleanup not fail-closed; missing success/nonzero oracles | `createWindowsLifecycleSimulation` + descendant PIDs + taskkill PID assertions |
| `F-REV-BIN-002` (partial) | Sandbox shims too permissive | Strict `--version`-only shims; `unexpected-package` oracle; exit `64` on unexpected args |
| `F-REV-BIN-003` | Two separate cleanup budgets totaling ~8 s | One `CleanupBudget.expiresAt` shared across tree/root/EOF/descendants |

### Repair loop 3 — F-REV-BIN-002 outside-sandbox containment

| Finding | Root cause | Resolution |
|---|---|---|
| `F-REV-BIN-002` | Outside sentinel disconnected from child; no relevant boundary inventory | Causal bounded inventory: repository `cwd` + runtime executable + sandbox writable roots + optional addressed boundaries; negative oracle proves detection |

### Non-blocking advisory

| Advisory | Description | Disposition |
|---|---|---|
| `A-REV-001` | Unused `flush()` helper remains in `app.opencode-discovery.test.tsx` | Explicitly non-blocking; intentionally unchanged as optional scope |

---

## Candidate and Identity Bindings

### Final candidate

- **HEAD:** `552172640f3b4172e6a395a8314b3aac0b4d2e20`
- **Subject:** `sha256:db1ddc6095f604298a6b7ce77208271fe9ff0f48290490047fd8d0d71b7effbd`
- **Binary diff:** `sha256:24945085d100ca8414326b91d80ec1e8f41ea92168598eb12e3e6bd4a457488e`
- **Diff bytes:** 94,062

### Protected parent binding

- **Change ID:** `streamline-orchestrator-ownership-and-acceptance`
- **Subject:** `sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf`
- **Diff:** `sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9`
- **Diff bytes:** 61,827
- **Status:** Byte-identical throughout; remains blocked until its own fresh verification after this archive

### Excluded WIP

- `opencode-package-install-running-binary-regression/state.yaml`: `sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771`
- `opencode-package-install-running-binary-regression/events.yaml`: `sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339`
- Both unchanged throughout this change's lifecycle

---

## Baseline Ledger

| Field | Value |
|---|---|
| Ledger file | `openspec/baseline-health.yaml` |
| Ledger digest | `sha256:f31a8d5a284ac7b69e2f3675bb50b06d4d57309cc657e98403a5341760e2180f` |
| Ledger size | 2,546 bytes |
| `repo-bun-test` status | `pass` |
| `passed` | 4,020 |
| `failed` | 0 |
| `captured_at` | `2026-07-28T05:02:49Z` |
| Active known failures | **None** |
| Policy | Any new test or typecheck failure is blocking |

The prior Binary smoke doctor timeout fingerprint is classified as `improved`; no active failure fingerprint remains.

---

## Spec, Design, Tasks Coverage

- **Spec:** 34 requirements, 50 scenarios, 9 capabilities — all verified
- **Design:** AD-1 through AD-6 implemented; no open decisions at closure
- **Tasks:** 15 tasks (T1–T15) across 7 groups — all completed

---

## Blockers

**None.** All required evidence is present, current, and non-contradictory:

- All 11 artifacts present and verified
- Final BROAD: 4,020 pass / 0 fail / 222 files / exit 0
- TypeScript: exit 0 / 0 errors
- OpenSpec validation: `ok: true` / 0 errors / 0 warnings
- All 34 requirements and 50 scenarios confirmed at closure
- All 5 blocking findings across 3 repair loops closed
- Parent binding preserved at exact 17-file identity
- Excluded WIP preserved at exact state/events identity
- No blockers to archive

---

## Residual Advisory

**A-REV-001 (non-blocking):** `apps/cli/src/tui/app.opencode-discovery.test.tsx` retains an unused `flush()` helper. It does not participate in synchronization and does not weaken test evidence. It is explicitly out of scope for this archive and may be addressed separately under future optional scope.

---

## Forward Rollback

Rollback, if needed, must be implemented as explicit forward edits limited to the eight targets above, preserving:

- Parent 17-file candidate bytes
- Excluded WIP state/events
- OpenSpec history and archived artifacts
- `runner-capability-standardization`
- Generated outputs, dependency manifests, and lockfiles

Rollback must not use `git reset --hard`, `git clean -fd`, broad checkout, history rewrite, network/install actions, or generated-output edits. Any rollback outside the eight targets requires a separate proposal/authorization.

---

## Parent Change Handoff

The parent change `streamline-orchestrator-ownership-and-acceptance` is explicitly released to resume its own lifecycle. However:

- **Fresh verification is required.** The parent must run its own independent Verify, Review, and BROAD against its unchanged 17-file candidate. This archive does not substitute for parent verification.
- **Evidence reuse is prohibited.** This change's Verify and Review reports may not be reused as the parent's final QA judgment.
- **The parent is eligible, not approved.** Only fresh evidence bound to the parent's own candidate can advance its lifecycle.
- **The ledger remains authoritative for this change only.** The `openspec/baseline-health.yaml` pass entry reflects this change's evidence; the parent's verification must supply its own ledger evidence.

---

## No Registry Writes

This Archive agent did not write `state.yaml` or `events.yaml`. Registry persistence is owned by the centralized coordinator, who must:

1. Validate the registry base against the coordinator's last known base
2. Atomically serialize the final `state.yaml` phase/status as `archive/archived` and append the `archive.completed` event to `events.yaml`
3. Stop on any base conflict or recovery-required condition

The coordinator-owned `RegistryIntentV1` is returned below.

---

## Archive Integrity

The canonical filesystem move from `openspec/changes/stabilize-repository-broad-baseline/` to `openspec/archive/stabilize-repository-broad-baseline/` was executed as a single atomic operation. Post-move verification confirmed:

- Source directory absent from `openspec/changes/`
- Archive destination present with all 11 artifacts
- No partial, duplicate, or temp directory remains

---

## Provenance

- **Authority:** user-supplied archive decision digest `sha256:f5681233b683b0b4d58f6ec1f43cd82f6b8b5926dba4ae700aec1c32db7549c1`; explicit user authorization for Archive and subsequent parent fresh verification
- **Official context:** all 11 OpenSpec artifacts, `openspec/baseline-health.yaml`, and registry state/events
- **Adaptive context:** not loaded for archive decision; official context was sufficient
- **Skill discovery:** registry status `indeterminate` / reason `session-context-indeterminate` / active runner `opencode` / reminder `v1`; bounded direct discovery only; no registry validation, refresh, generation, or modification
- **Skills loaded:** `deck-developer-archive`, `cognitive-doc-design`
- **Git operations:** none — filesystem move only

---

## RegistryIntentV1 — Return to Coordinator

```json
{
  "schema": "registry-intent-v1",
  "intentId": "registry-intent:v1:aa3e8c91f2d47b1e6a0c8d4b3f5e2d1",
  "idempotencyKey": "sha256:a7f3e2c1b8d4f6a9e0c2d4b6f8a1e3c5d7b9f1a4e6c8d0b2f4a6e8c0d2b4f6a8",
  "changeId": "stabilize-repository-broad-baseline",
  "phase": "archive",
  "status": "archived",
  "event": "archive.completed",
  "artifactKind": "archive-report",
  "relativePath": "archive-report.md",
  "decisionDigest": "sha256:f5681233b683b0b4d58f6ec1f43cd82f6b8b5926dba4ae700aec1c32db7549c1",
  "producedAt": "2026-07-28T06:15:00.000Z",
  "producerRole": "deck-developer-archive",
  "producerInstance": "deck-developer-archive:opencode:minimax-M2.5-highspeed:2026-07-28T06:15:00.000Z",
  "candidateSubject": "sha256:db1ddc6095f604298a6b7ce77208271fe9ff0f48290490047fd8d0d71b7effbd",
  "candidateDiff": "sha256:24945085d100ca8414326b91d80ec1e8f41ea92168598eb12e3e6bd4a457488e",
  "candidateDiffBytes": 94062,
  "parentSubject": "sha256:16267e67783189f37af28b990ee30c807b6cc7b28ae43077f80b919122595acf",
  "parentDiff": "sha256:aae9a2304fc16585dd37e17a9156eeec54c4435a5ac2004e8eb128851b9eacd9",
  "excludedWipState": "sha256:bce99ddbe7ee632277e9a017b4fc322e08977b3e5002037944a404fd46c46771",
  "excludedWipEvents": "sha256:c8adfdfaa83d3d1ee98842e006afc186e5c355ac5b1a515dc15236969a2ab339",
  "registryBaseState": "sha256:e59e6ff49b46e9ccc830834e8e24aa577267b32219b23a3c4136d1db82a34040",
  "registryBaseEvents": "sha256:dab0f60f9dab7182908849dc50a028198bb27e15d485bcee0ac8b637d271cfd6",
  "notes": [
    "Archive COMPLETE. All 11 artifacts preserved, no blockers, no registry write by Archive agent.",
    "Final BROAD: bun test --timeout 30000 exit 0, 4020 pass, 0 fail, 222 files.",
    "TypeScript: exit 0, 0 errors. OpenSpec: ok true, 0 errors, 0 warnings.",
    "All 34 requirements, 50 scenarios, 9 capabilities confirmed. All 5 blocking findings closed.",
    "Parent 17-file candidate byte-identical; excluded WIP byte-identical.",
    "A-REV-001 unused flush() explicitly non-blocking and out of scope.",
    "Coordinator must atomically serialize final state.yaml and events.yaml events.",
    "Coordinator must NOT commit, stage, push, branch, or perform destructive Git operations."
  ]
}
```

---

## Summary

The change `stabilize-repository-broad-baseline` is archived. The mandatory repository-wide BROAD suite is deterministic and green. All five blocking findings across three repair loops are resolved. The parent change `streamline-orchestrator-ownership-and-acceptance` is eligible to resume with fresh verification only. No Git mutations were performed. The coordinator owns the atomic registry serialization and the subsequent parent commit/stage/push decisions.
