# Dictation model integrity and final verification

## Motivation
Required combined full verification timed out twice on normal ext4 temporary storage, most recently318/523 files at240s without concurrent edit/browser work. Prior tmpfs execution completed but exposed a real model-integrity cache defect. Do not hide that defect with sleeps or a test-only workaround.

## Bounded outcome
Measure representative sync-heavy tests under normal and memory-backed temporary storage in a writable execution environment. Correct ModelStore verification accepting changed bytes when inode/size/timestamps collide. Preserve private paths, symlink refusal and hash checks. Do not broaden into runtime capability caching or unrelated dictation UI. Keep edits separate from existing Codex recovery/web scroll and original driver/startup work.

## Acceptance
Deterministic red-first same-metadata corruption regression, green after fix on normal/tempfs storage, bounded performance evidence for real model verification. Avoid hashing large models on every status refresh if a safe explicit verification boundary can separate readiness display from integrity decisions; never trust metadata alone for an explicit integrity claim. Do not weaken tests, durability, timeout240s, or quarantine. Run focused checks/typecheck then full suite once with justified environment; report exact candidate, complete counts and duration. Lead reviews protected change and final combined evidence before closure.

## Evidence
Parent read model-store.ts: verify returns true when cached identity matches [dev,ino,size,mtimeMs,ctimeMs] before hashing; acquire caches that identity. Prior probe observed identical timestamps including nanoseconds after same-size corruption on tmpfs. Graph generation2026-08-20 fast has no nodes and exact model-store/runtime/service-test paths are not tracked; source fallback required. No assertion that fsync explains the suite timeout until measured. Lead owns this brief.

## Implementation and verification
Apply task task-a6a9c527-38b6-4fb1-96d8-8ef88702842d attempt1 changes only model-store.ts and new model-store.test.ts. Explicit verify always hashes; observational refresh retains metadata shortcut. Selection/reconcile/transcription already invoke explicit verification. Three deterministic same-metadata corruption tests use real changed bytes and a bounded stat fake. Red observed before fix;21 affected tests pass on ext4 and tmpfs; typecheck passes. Lead independently reexecuted the3 protected tests on tmpfs:3 pass0fail,414ms. Independent Quality task task-44887248-4712-43c7-a7a7-f5f22b639f7f is pending.

External paired benchmarks show canonical recovery ext4158/170s vs tmpfs114/99s, upgrade ext435/55s vs tmpfs7.7/6.3s; ext4 tests hit existing individual deadlines. Separate sync microbenchmark ext4 median7.34ms vs tmpfs0.00065ms. Warm synthetic catalog-sized574MB model verification costs0.46-0.76s;100 unchanged status refreshes1.9-2.5ms. Evidence /tmp/deck-integrity-evidence/report.md; no syscall attribution within full suite claimed.

Full candidate2ff95a7:946511ae661ef26f2d0e63452874b72120439942, unchanged before/after: TMPDIR=/dev/shm bun run test completed524/524files in190.85s,4788passed1failed0skipped. Remaining failure is unchanged OpenCode legacy-upgrade test taking5842ms against5000ms deadline; isolated rerun passed2/2 with4765ms main case. Full gate remains failed; no exclusions/budget changes or release. Do not conflate isolated pass with green full suite. Other requested fixes retain scoped browser/canary verification.

## Final scoped review
Quality task task-44887248-4712-43c7-a7a7-f5f22b639f7f attempt1 found no blocking issues and independently passed3/3 protected tests in169ms. Lead matched model-store SHA256 bb650fe230b719ca2b59eebc3158db4c3050be16540a788e46a8710d574cebb2 and test SHA256 ff22413fb3d8ddd4425d733d655ccb3b33bf1bd7643c26be626d2d345f726678, plus git diff --check. Bounded integrity implementation accepted; pre-existing verify-to-use race is not claimed fixed. Full suite remains failed only on the disclosed OpenCode timeout. No release/commit performed.
