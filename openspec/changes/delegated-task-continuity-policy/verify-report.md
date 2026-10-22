# First-delivery verification

Status: passed with accepted runtime limitations, 2026-10-22. Scope follows the user's first-delivery amendment: fresh native sessions for Codex, Claude and OpenCode; no internal Codex DB/history parsing. Native enablement is deferred, not a failed delivery prerequisite.

## Implemented behavior

Logical task, member, assignment, attempts, permissions and accounting survive fresh continuations. Selection is recorded at launch; reviews start fresh. Structured criteria/findings and attributed edit references feed a deterministic bounded handoff. Interrupted handoffs say INTERRUPTED / NO FINAL REPORT, include bounded public agent text or explicit unavailability, retain file references and the new instruction, and instruct the agent to inspect current file state before continuing. This instruction is not proof that the agent has already inspected the files.

The offline metrics command reads Deck event segments without model calls:

```sh
bun run apps/cli/src/session-continuity-metrics.ts <session-events-directory> <new-output.json>
```

It reports interrupted-continuation frequency with an explicit admission denominator, pending and excluded cohorts, per-attempt first-edit steps/tokens and partial/censored samples. Review cost remains completion-based. Missing data is not zero; late correlated usage can reconcile a prefix without adding unrelated later requests.

## Evidence

- Initial implemented candidate: 386 host and477 contract/adapter/CLI tests passed. Subsequent corrections reran the affected checks, not all unchanged suites.
- Independent review exposed and verified closure of F-001–F-006 and A-001–A-002: terminal-boundary admission, Lead recovery, substantive predecessor preservation, Codex attribution, request coverage, delayed first-edit usage and attribution/uncertainty precision.
- Final delivery owner checks: 81 projection/replay tests,14 host regression cases,51 evidence/metrics cases, and11 final handoff cases passed. These overlap; counts are not summed as unique tests.
- Final independent delivery review: 31 focused tests,0 failures,232 assertions (4 actual host interruption cases with fake drivers,23 projection/handoff/cohort cases,4 additional provenance/denominator probes).
- Final typecheck: `bunx --no-install tsc --noEmit`, exit0 per owner; inspected log has no diagnostics. `git diff --check` passed.
- Snapshot version15 is covered by v14 rebuild and v15 round-trip tests. Binary downgrade safety is not established.
- Reviewed candidate fingerprints and source fallback established scope; the graph generation was stale/untracked for changed paths. No graph-completeness claim.

Detailed retained local evidence: `/tmp/delegated-continuity-implementation.md`, `/tmp/delegated-continuity-quality.md`, `/tmp/delegated-continuity-logs/86-delivery-projections-final.log`, `87-delivery-host-regressions.log`, `93-interrupted-review-source-green.log`, `94-delivery-typecheck-final.log`, and `/tmp/delegated-continuity-quality-attempt5-{host,projections,edges}.log`. These are local diagnostic references, not portable repository artifacts; the meaningful regression tests are committed with the change.

## Baseline and practical limits

The historical latency baseline is in evidence.md. Before this change, continuation normally reused the native session. The candidate's fake-driver comparison demonstrates fresh identity/no resume and preserved interruption evidence; it does not measure live speed or quota savings. A comparable production cost comparison awaits candidate activation and real continued tasks. Historical missing provenance/usage cannot be reconstructed as reliable cohort samples.

No internal Codex database/history reader, provider inference benchmark, automatic retry/model switch, or member steering implementation was added. Native reuse remains unavailable for all three runners because verified effective bounds are missing. P-015 records Codex native support; high measured interruption acquisition cost should prioritize P-014 member steering. Canary installation and actual daemon activation are tracked separately in delivery.md.
