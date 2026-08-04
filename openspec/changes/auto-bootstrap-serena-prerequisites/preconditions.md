# Apply Preconditions

## Authority and status

- **Approved scope inputs:** Proposal `sha256:d4cc905b11ca6604f2760b3ab11abafa466a8815258f53f0979f4bb8481e8184`; Spec `sha256:d60592b9b705df3a0dbeaf2203fd08cf4c4fecd2d3fb3d960141b1f5d38729ae`; Design `sha256:849e3e245c36cfd6ed8bc61ae6d4592c2d6c6175ebff69b29e236ac351e7b257`.
- The user-approved scope accepts the residual risk of controlled execution of remote content from the fixed official `uv` installer endpoint. Neither these preconditions nor future implementation evidence may claim independent integrity, checksum, release, attestation, or provenance verification of that content or its downstream artifacts.
- The former custom pinned-archive/trust-manifest/attestation condition is explicitly superseded. It is not an Apply gate.

## P-SEC-001 — Superseded; not active and must not block Apply

- **Classification:** Superseded security condition; no active security hard stop.
- **Condition:** **None.** The former requirement for a separately prepared pinned-archive/trust manifest, archive/executable digests, attestation/provenance evidence, target matrix, and custom archive decoder was replaced by the approved controlled official installer approach.
- **Apply effect:** P-SEC-001 is not required, cannot block any Apply task, and must not be recreated through a placeholder manifest, runtime lookup, independent remote verification, or an implementation task. The fixed endpoint and controlled process/storage/readiness safeguards are implementation requirements in `tasks.md`, not a trust-manifest precondition.
- **Residual-risk treatment:** the user accepted that `https://astral.sh/uv/install.sh` is remote executable content. Deck must use the exact fixed endpoint and controlled child boundary, but must not represent the endpoint or downloaded content as independently verified.
- **Satisfaction evidence:** None; no manifest, attestation, archive digest, provenance receipt, or independent installer-verification receipt is requested or required.

## P-CLI-001 — Resolved collision; retain T17 safety checks

- **Classification:** Resolved coordination record; not an active external precondition.
- **Resolution:** `opencode-configured-providers-filter` was closed as abandoned under explicit user authorization at `2026-08-03T22:27:19Z`. Its `state.yaml` is `phase: closed`, `status: abandoned`; its `archive-report.md` records no source WIP and the unresolved backend scope. The former `apps/cli/src/tui/app.tsx` ownership collision therefore no longer exists, and no ownership order or handoff is required.
- **Condition:** **None.** T17 may proceed after its normal task dependencies. Before editing, T17 must fresh-read `apps/cli/src/tui/app.tsx`, restrict the change to Serena selection/cancellation/composition behavior, and rerun the relevant provider-filter/menu regression tests. These are implementation safety checks, not external handoff conditions.
- **Required evidence:** T17 pre-edit fresh read, exact scope audit, and relevant provider-filter/menu regression output. No coordinator ownership/order decision or clean-base handoff receipt is required.
- **Parallelism:** There is no external `app.tsx` collision to serialize. T17 remains sequential after its task dependencies, must not modify provider-filter or menu-windowing behavior, and must not use a destructive Git operation.

## P-ENV-001 — Verification environment and no-I/O policy

- **Classification:** execution/verification constraint, not a security-trust gate.
- The shell PATH does not include `bun`, but the verified executable `/home/dev/.bun/bin/bun` is present and reports version `1.3.14`. All automated tests must invoke this known absolute Bun executable, or an equivalently verified Bun executable in a future runner; normal test commands remain semantically unchanged. P-ENV-001 is not an Apply/QA availability blocker.
- All automated tests must use deterministic mocks for fixed-endpoint fetch, bounded child-process execution, filesystem staging, path resolution, executable probing, readiness/revalidation, cancellation, diagnostics, and MCP writes. They must make no network call, real installer/process invocation, or user-home write.
- No agent may run the installer, network access, a real child process, a user-home write, or `bun run deck:run` during planning, Apply, Verify, or Review. The user, and only the user, may later run `bun run deck:run` as deferred live functional confirmation.

## Non-blocking runtime conditions

- The fixed official endpoint `https://astral.sh/uv/install.sh` must be used exactly when a selected flow needs missing-`uv` bootstrap. Redirects, unavailable/invalid responses, unsupported fixed-child environments, cancellation, or failed readiness are runtime fail-closed outcomes; they do not authorize an alternate endpoint, archive, trust lookup, fallback installer, or system write.
- The resolved Deck-owned `uv` and Serena paths, fixed environments, exact direct command, fresh readiness evidence, immediate pre-MCP revalidation, and known termination outcome are implementation gates described in `tasks.md`, not external approval receipts.

## Readiness decision

- **P-SEC-001:** superseded; not a blocker.
- **P-CLI-001:** resolved; the closed abandoned change has no source WIP or active ownership claim. It is not an Apply blocker or dependency. T17 retains only the pre-edit fresh read, Serena-only scope restriction, and relevant provider-filter/menu regression checks as implementation safety checks.
- **P-ENV-001:** resolved as an availability concern because the verified absolute Bun executable is present; the absolute-executable invocation remains an execution/verification constraint for T18/T19/T21 evidence, not authorization to run live effects or reduce the approved scope. It is not an Apply/QA availability blocker.
- **Apply readiness:** source Apply is ready for all tasks, including T17 after its normal dependencies; no P-CLI-001 handoff blocks it. Full change closure and joint enablement remain blocked until independent evidence is green for T18, T19, and T21, T20 Review accepts that evidence, and user-only live confirmation remains deferred.
- **Registry YAML:** not modified or required by this artifact phase; no RegistryIntentV1 value is generated here.
- **Rollback:** no precondition authorizes deletion of user tools/configuration or any destructive Git operation.
