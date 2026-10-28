# Claude installed-generation verification fix

Date: 2026-10-27. Scope: urgent session preparation refusal; no commits or edits to installed plugin generations.

## Diagnosis

A temporary instrumented copy of `runner-adapter.ts` read the real installed generation `developer-team-v2-c393d9523b1a2680`. Its stored content digest was `6d9532d573316af5318da72e12bbe2ee1528809100ff8e527d678655a02d590e`; default source reconstruction produced `2b84d862065732445474008d3c3f9f675e84f752b5c47af423bad50316d99e02`. The first failing condition was the generation content hash, and `inspect` also returned conflict. Only `hooks/session-start.cjs` and `hooks/hooks.json` differed. The installed hook binds the installing canary payload's absolute command, whereas another entrypoint (or the default adapter) supplies a different command (or none). This is installation-specific input, not permission drift. The temporary instrumented copy was removed.

## Implementation

Session verification reads the bounded, private installed hook's command binding as data and regenerates canonical content with that binding. The private selection's content digest must match before the exact file-set, byte, ownership, permissions, ancestry, selection, and plugin identity checks admit the generation. Publication and verification use the same parent hash root. This neither executes the recovered command during preparation nor trusts arbitrary hook contents. Modified command bindings, hook bodies, skills, selection digests, and extra files remain rejected.

`ClaudeSkillsError.check` preserves the failing verification stage without changing the user-visible error message. Session service writes it to the structured daemon log as `claude.session-skills-unverified` with a `check` field; no command contents or credentials are logged.

## Evidence

- New installer/loader entrypoint regression failed before implementation and passed afterward. It publishes an actual private content-addressed generation and checks both absent and different loader command settings, plus modified command and hook bytes.
- Original `/tmp/dbgskills/run.ts` succeeds against the real installed generation after the fix, read-only.
- Focused session skills and production session service tests: 56 passed, 0 failed (58.71 seconds). Final test assertion correction: 6 session-skills tests passed, 0 failed (7.15 seconds).
- Source Claude S1 smoke: all 20 checks passed, including daemon lifecycle, fake-Claude prompt/response, native plugin loading, permissions, credentials, and ledger checks. Repository path scan is intentionally skipped for source execution.
- Graph generation was stale (2026-08-20); relevant Claude paths were untracked by that graph. Exact source inspection supplied evidence. Adaptive memory disabled; no adaptive context used.

This fixes the preparation blocker only; it does not close broader parity work.

Final handoff: `bunx tsc --noEmit` passed; `git diff --check` passed. `bun run canary:install` succeeded at `/home/kevin15011/.local/bin/deck-canary`. The compiled canary Claude S1 smoke then passed all 20 checks, including the repository-path leak scan. The real installed-generation read-only probe passed again after installation. No full suite, commits, or stable-binary replacement was performed. Existing running daemons need a restart to load the new binary; this task did not interrupt the user's daemon.
