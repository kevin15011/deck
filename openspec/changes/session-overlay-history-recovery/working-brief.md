# Session overlay history recovery

## Intent and evidence

Restore Lead turn startup when bounded historical excerpts quote protected instruction markers. Test Automate session `20261026T212554-53888f` failed at event 193241 with `session-overlay-content-forbidden`. Its durable continuity block for lead-g3 attempt 81 contains the protected readiness marker in the previous answer. Source inspection confirms continuityContext forwards that answer into the notices overlay. Exact historical launch bytes have not been reconstructed.

## Scope and decisions

- Preserve the typed overlay parity guard and all direct instruction-injection rejection behavior required by session-skill-availability.
- Omit an entire affected historical excerpt in the derived projection rather than deleting marker text while retaining a possible instruction body. Keep original ledger/report data and retrieval references unchanged.
- Cover continuity free-text excerpts and task-roster summaries at their provenance-aware projection boundaries; do not broadly sanitize arbitrary notices, handoffs, or role instructions.
- Classify known internal overlay validation failures as Deck failures with a bounded safe code, without displaying native prose or private content.
- The stale session-identification decision was explicitly resolved as answered (revision 4); no automatic decision resolution is requested.

## Acceptance and verification

- Red-first regression: historical answer quoting a protected marker cannot prevent a following Lead turn; original durable content is unchanged and remains retrievable.
- Test protected markers in affected historical fields and roster summaries, including beyond display truncation; safe excerpts remain useful.
- Direct protected-content injection still fails closed; resource limits remain enforced.
- Startup classification distinguishes internal overlay validation from unknown runner/provider failure.
- Focused files during editing; bun run test and bunx tsc --noEmit before commit; Lead runs a short live canary for runner or installation changes. Independent targeted security review before handoff.

## Constraints and progress

Shared worktree contains unrelated edits, including session-manager and its integration tests. Preserve them and report exact owned hunks. Do not mutate the affected session or retry it automatically. No installation or deployment in this scope. Lead owns OpenSpec writing.

Investigation reviewed; implementation pending. Graph generation 2026-08-20 is stale and candidate paths are not tracked; targeted source reads provide current evidence.

## Implementation and final review

Implementation is complete. Full-source answer/report safety metadata is computed before ledger clipping. Snapshot v17 rebuilds older derived snapshots from unchanged durable events; clipped legacy data without evidence is omitted conservatively. Whole-field history projection preserves retrieval references, discovery data and direct injection guards. Typed overlay failures are attributed to Deck.

Lead accepts Quality attempt 4 (task-793e2904-ba44-4184-928b-72bac1a26724, resultSeq 20855) and resolves the pre-projection truncation finding based on independent clipping, snapshot migration and production-roster probes. Reviewed source candidate: c5cbea838930139ec1f1b09ef209a255f9ab5a82:e5dee18e294eda1c2cb8b27f68e06ffda4bfb1ab. This documentation update does not change tested runtime inputs.

Verification: 375 focused tests passed (100.37s); typecheck passed (82.83s); diff check passed. Independent protected probes passed. Broad gates remain FAILED: test:changed 7451 pass / 2 fail / 1 error; test:full 7688 pass / 10 fail / 1 error. Isolated recovery does not convert those runs into a pass. Gate attribution establishes an unchanged live GitHub request without deadline and unrelated shared Codex hook entry edits consuming stdin in compiled execution. Baseline-health has no recorded waiver. Neither unrelated path was modified here.

Evidence: /tmp/deck-overlay-verification-484787c4/handoff-evidence-resumed.json and final-handoff.md; immutable task reports apply-deep attempt 3 (resultSeq 21118) and Quality attempt 4. Status: scoped implementation reviewed; repository-wide release verification blocked. No installation, deployment or target-session retry performed.
