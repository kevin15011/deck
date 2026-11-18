# Sprint 7b.1 — partial acquisition and native qualification

**Direction superseded by user correction:** bespoke update expansion was stopped at Lead integration218263. Preserve the evidence below as historical, unaccepted work. The current implementation follows the native-maintenance-first section of the S7 brief; routine updates no longer require completing this custom multi-version platform.

Status: candidate `1c0d1a27…` / binary `cacaad31…` is **partial, not accepted or installed**. It supports reviewed acquisition of the exact target package without selecting or executing it. Target activation remains unavailable. The same production owner continues durable recovery, retained bindings and native compatibility qualification under the [S7 brief](../../openspec/changes/sprint-07-runner-management/working-brief.md).

## Candidate and reviewed evidence

Production24, events **217176/217177**, is integrated at **217478** as bounded progress. Lead read the full [handoff](../../target/review-s7b-1c0d1a27/handoff.json), SHA-256 `55a6e2c50f6705f0fdc7ec8f0980c54acfda7e4078060ff6995c5bbe3d382ea5`, and material catalog/publication/operation/worker/UI source. All 147 current/frozen inputs, 22 assets and binary matched the [manifest](../../target/review-s7b-1c0d1a27/candidate.json): candidate `1c0d1a27ee9194d7a52302d19c757ac6bd913ebb7e04cec4a636d2c97a6083de`, binary `cacaad31d1689ea18d966b8de59d28d1af86a6c2a281014375a741a910a99011`. API6/host schema9/service schema3 remain unchanged from the previous candidate. The original 0.166.0 catalog bytes and path are preserved.

The candidate verifies packages by immutable release reference, offers an acquisition-only browser operation, and reserves live native ownership before management probing of the existing qualified release. Target executable admission is still rejected. Durable cross-host maintenance recovery, full dual-release admission/Quality and target execution are not implemented by this checkpoint.

Owner evidence reports 140 Rust and 16 frontend passes, ten package gates totaling 200.848s, actual full-package/tamper verification (259.58s), and a packaged acquisition receipt journey covering lost response, reload/restart and retained selection. The browser reused a previously published exact package; it did not repeat HTTPS acquisition. These remain owner execution records, not independent completion of S7b.

Lead independently passed two protected tests against the matched test executable: queued work prevents the first probe (0.216s), and another host's reservation prevents the first probe (0.266s). Their oracle requires zero recorded native calls and retained selection. [Commands and results](../../target/lead-s7b-1c0d1a27/focused.json) preserve the test-binary identity. These tests establish live ordering, not crash recovery.

## Credential-lock observation and limits

The owner's synthetic API-key write test holds `auth.json.lock` exclusively. Codex0.166.0 writes despite that lock; 0.167.1 refuses after its commit-lock timeout. Lead reproduced the observation in a new disposable native home: 0.003s versus 5.006s. [Independent replay inputs and scope](../../target/lead-s7b-1c0d1a27/native-lock/replay-evidence.json) and [results](../../target/lead-s7b-1c0d1a27/native-lock/credential-lock-result.json) contain no valid credential or personal-state test. The original fixture remains preserved.

This is **not proof of refresh incompatibility or token corruption**. Lead checked the exact tagged `login/src/auth/storage.rs` and `manager.rs`: both releases' `lock_for_write` use the separate `auth.lock`, and both `persist_tokens` functions take that lock before reading and committing. The target additionally compares stored state and takes `auth.json.lock`. The next qualification must trace the supported refresh/login/storage paths and their actual invariants; the synthetic direct-write result cannot substitute for that trace. Neither sequential unauthenticated thread reopening nor the recorded HTTP401 establishes authenticated execution.

The continuation preserves the target activation gate and completes independent useful implementation now. It must establish the smallest sufficient coordination contract, prove any remaining adverse interleaving, and qualify disposable compatibility before target access to existing authenticated state. It may not copy valid credentials, change the personal account/model, or silently switch the release pair.

## Remaining acceptance

All seven S7B criteria remain required. Full native maintenance interruption/restart, retained target execution, mode-specific proof, old-context continuation and reviewed backward reselection are outstanding. Acquisition alone does not close them. The owner's predecessor check rejected the unqualified binding and preserved main SQLite/launcher bytes, but created empty WAL/SHM files; its failed whole-directory equality assertion is retained and must not become a claim of zero filesystem writes.

The installed performance-corrected binary remains `c349c815…`. S5c's accepted recovery repairs and quota-limited final provider requirement remain separate. No user host restart, installed executable replacement, personal sign-in, commit or publication occurred. Quality review of a complete S7b candidate remains future work.
