# Unpublished fixture history cleanup

The user requested a normal main push for use on another computer, with no release or tags. GitHub push protection rejected Slack/Stripe-shaped samples in redaction tests from two unpublished commits. The user explicitly approved a local backup, history cleanup and retry; session decision `decision-08ae3c89dae7da63b014e8559886118e` records that approval.

Apply Deep task `task-f80b5b56-4184-4ee5-9555-330a1183ee76` attempt 1 (result 13451, ended 13452) transformed only three synthetic fixture literals into concatenated source strings, preserving their exact runtime values. No protection bypass, force push, reset, rebase, tag or release operation was used.

Original main `2cb66db99d37e407c9ddfeea984453ae83c704d3` became `92142f6876096d060e1d10263a022a08c0d3a27a` before this evidence-only commit. All 63 outgoing commits and both merges remain; 16 hashes changed and 47 commits are byte-identical. Commit messages, identities, timestamps and parent order are preserved. The only changed source path is `benchmarks/memory-inventory/inventory.test.ts`. Earlier mobile-fix hashes are historical references: the header/follow fix is now `92142f6`, and the reconnection fix is now `e24a66a`.

Recovery ref `refs/backup/main-before-fixture-sanitize-20261102-0zPuPH` preserves the original history locally. A verified private recovery bundle and full mapping are under `/tmp/deck-fixture-history-0zPuPH/`; temporary files are not a permanent backup guarantee. The backup ref must not be pushed.

Lead reviewed and independently reran the verification scripts before adoption: all 63 tree pairs, metadata and parent mappings matched the stated scope; 5,009 unique blobs in outgoing trees were scanned with zero blocked-literal or Slack/Stripe-format matches (8.989 seconds). All 34 sample values compare equal and remain redacted. `bun test benchmarks/memory-inventory/inventory.test.ts`: 13 passed, zero failed, 508ms. Worktree/index were clean, other refs unchanged and origin/main remained an ancestor. The fixture representation change does not invalidate prior runtime checks; no unrelated full-suite or TypeScript rerun was needed.

This checkpoint records local verification. Lead retries a normal main-only push afterward; GitHub acceptance is separate from the local scanner evidence. No new product version is created.
