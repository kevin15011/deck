# Apply progress

## Initial state
Investigation completed. Implementation is authorized by the user's request. One implementation owner will deliver the sandbox, tests, CI wiring and documentation. Lead owns OpenSpec persistence. No real installations or network are permitted in deterministic test gates; developer provisioning is an explicit command effect and must remain isolated.

## Implemented
- Added `scripts/verify-binary-compatibility.ts`, harness tests and parsed-YAML workflow tests; exposed `bun run sandbox:compat`.
- Native-host source copying, isolated dependency and official Node provisioning, SHA-256 checks, identity-bound archive smoke, actual generated-hook Node checks, safe stage reporting and failure propagation.
- Eight native target/Node CI cells gate stable and draft publishing. PR/manual runs cannot publish. Archive and generated-hook sidecar travel together; reports are excluded from release inputs.
- Contributor and release instructions explain provisioning effects and coverage limits.

## Repairs proven during verification
1. Independent review found that per-child cancellation could continue into Node 24 or leak the disposable root during downloads. Red tests reproduced this; run-wide cancellation now aborts fetch/subprocesses, stops further cells and cleans the owned root. Re-review approved the repair.
2. Real macOS ARM64 acceptance failed at standalone startup with SIGKILL in both cells. A minimal direct-execution control reproduced malformed Bun 1.3.12 Mach-O signatures independently of the process wrapper. Removing the inherited signature, applying ad-hoc signing, and strictly verifying before archiving fixed execution. Both sandbox and CI Darwin build paths now fail closed at these steps. Downloaded verification archives are never repaired. Full host acceptance subsequently passed both Node versions.

## Final status
Implementation and independent code review complete. See `verify-report.md` for reproducible evidence and explicit pending remote CI coverage. No commit, push, tag, publication, global toolchain modification, or personal Deck replacement was performed.

## Follow-up: merge latest main
The user subsequently requested updating `feature/sandbox-testing` with latest main. Merged `origin/main` at `8666619` (v0.6.0) into the feature based at `42e4b59`, using a separate worktree to preserve the original main checkout and its unrelated local `.serena/project.yml` edit.

Resolved the release workflow conflict by retaining main's canonical target builder, signature verification, `dist/cli` archives and tag/package guard, together with the feature's eight native Node compatibility cells and fail-closed publication dependencies. The generated hook now uses a separate `runner-hook-*` artifact so adding the sidecar cannot change release archive download paths. Workflow commit/channel are explicitly passed into the canonical builder and asserted by regression tests.

Verification of the merged tree: repository `bunx --no-install tsc --noEmit` passed; 100 focused tests across harness, both release workflow suites, canonical build contract, descriptor preparation and documentation passed (1,107 assertions). Focused strict script typecheck and independent release-boundary review passed. Native CI remains unexecuted. The requested local merge commit is authorized by this follow-up; no push, tag or publication is requested or performed.
