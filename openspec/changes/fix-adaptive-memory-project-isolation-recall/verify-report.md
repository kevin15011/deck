# Verify Report: Adaptive Memory Project Isolation and Automatic Recall Evidence

## Verdict

**PASS**

## Evidence

- Focused launch/runtime suite: 108 passed, 0 failed, 550 assertions, 7 files.
- TypeScript: `bunx tsc --noEmit` passed.
- Full canonical suite: 4,671 passed, 0 failed, 19,587 assertions, 302 files.
- Structural runtime-test audit: 80 target call sites; 33 enabled, 34 disabled, 13 conservative unknown-safe, 2 forwarding edges; 0 unresolved, 0 unsafe.
- Provider-network interception during independent QA: 0 Supermemory provider attempts.
- Real user-state metadata was unchanged across final focused/type/full verification.
- `git diff --check` passed during candidate verification.
- Rooted OpenSpec validation passed with 1 valid change, 0 errors, and 0 warnings.

## Acceptance matrix

All `REQ-AM-ISO-*`, `REQ-AM-RECALL-*`, and `REQ-AM-OBS-*` requirements pass. Independent Quality specifically reproduced and closed ambient Git poisoning, stale old-scope MCP persistence, rejected runtime bundle composition, nested scope input, incomplete recall metrics, unsafe config mode changes, direct/transitive test dependence on real credentials/state, and structural-scanner false negatives.

## Test safety note

No automated test wrote Project A/B fixtures to live Supermemory or contacted the live provider. Early diagnostic candidate runs exposed the pre-existing default observability-sink bug and appended metadata to the local Deck runtime JSONL file. That local file was not read, deleted, truncated, restored, or otherwise cleaned. After the hermeticity repair, independent verification confirmed its size, mtime, and mode remained unchanged.

## Residual risks

- The syntax scanner intentionally fails conservatively on unfamiliar constructs and may produce safe false positives.
- The repository's broader suite attempted unrelated outbound connections; independent QA blocked them all and observed no Supermemory provider attempt.
- Direct external MCP execution is outside Deck Runtime observability. Deck no longer materializes or authorizes it for Adaptive Memory and reports it as external/unobservable.

## Post-install delta verification

- Focused repair suite: 151 passed, 0 failed, 676 assertions, 6 files.
- Broader Doctor/install suite: 326 passed, 0 failed, 1,431 assertions, 12 files.
- Hermeticity guard: 14 passed, 0 failed, 34 assertions.
- Compiled runtime verification passed for host, CLI, runtime operations, Codex hook, Doctor read-only, and all compile-only targets.
- Final full suite: 4,681 passed, 0 failed, 19,638 assertions, 302 files.
- Independent network interception observed 0 Supermemory provider attempts.
- OpenCode config, Deck config, Supermemory secret, runtime metrics, and session-store size/mtime/mode were unchanged across final QA.
- Independent Quality verdict for the post-install delta: GO.
