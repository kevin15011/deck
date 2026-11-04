# Verification status: source reviewed, operational acceptance incomplete

## Result

All five independently reported source findings RIR-01 through RIR-05 are resolved.
Implementation remains uncommitted on main. No release was published, user's Deck
alias replaced, runner configuration repaired or active daemon restarted.

Operational acceptance is incomplete. The full suite is RED; neither successful
focused tests nor baseline comparison are substituted for a passing full gate.

## Accepted evidence

| Scope | Evidence | Limits |
| --- | --- | --- |
| Source defects | Quality3-7 reviews, exact scope hashes, structured Lead resolutions | Review is bounded to the candidate and does not prove unknown runner releases. |
| Planner, admission, upgrade and coexistence | Lead21tests/125assertions,10.163s | Subsequent lifetime and historical deltas have their own records. |
| Nested reservation and fence lifetime | Lead16tests/102assertions,2.065s; Quality11independent cases | Real-filesystem test run plus isolated function probes, not native sessions. |
| Historical fixture/replacement/publication | Lead12tests/134assertions,2.275s; Quality80independent cases | Fixture tools are fake; no real Linux acquisition/functionality claim. |
| Assignment UI | Lead writable browser4.872s; scoped independent review | Broader reconnect scenario remains outside this acceptance. |
| Tab motion | Lead view4.267s/layout28.87s,1440/390px,normal/reduced motion | Narrow long-content reading not separately exercised; disclosure baseline failure not fixed. |
| TypeScript | Final source owner `bunx tsc --noEmit`,exit0,14.277s | Existing Bun1.3.11 environment, not pinned-runtime qualification. |
| Isolated compiled canary | Build4.344s,compiled version/startup exit0 | No native model/session/hook or daemon handoff exercise. |

Latest source report: `/tmp/deck-runner-integration-resilience-attempt-5.md`.
Historical manifest: `/tmp/rir-a5-final.json`, scope digest
`0681e8d10b4912a950018573a359d274a6b1237703bb39dadb6b513eee5b4e12`.
Lifetime manifest: `/tmp/rir-a4-final.json`, scope digest
`5239fdfaa7a0ec4c2081e061c5aa046285b67cd755b1b46268e9566a0fd2794f`.
Base commit: `4510477a250e87dac94407619791bfc705f38292`.

## Full gate and environment

Latest `TMPDIR=/private/tmp bun run test`: exit1,4831pass/23fail/1skip,
525files,12failedfiles,26.724s. Isolated clean HEAD:4790pass/24fail/1skip.
No new failing test identities;21normalized shared diagnostics match exactly,
two retain disclosed dynamic SQLite/path-derived hashes. The original pristine
baseline was independently verified. No quarantine, test retirement or trust-check
weakening was used. No passing canonical gate is claimed.

Available Bun is1.3.11; repository/CI pin is1.4.0. Native version probes found
Claude2.1.316,Codex0.165.0,OpenCode1.18.31,Pi1.0.2; these are inventory only.
Docker client exists, but read-only `docker info` failed: the configured local
daemon socket is absent. Lead did not start or install a container service.

## Remaining required qualification

1. Run final source tests/types under exact Bun1.4.0 in an available Linux fixture
   environment; reconcile remaining exact failures without weakening protected tests.
2. Execute real native canary preparation/selected hooks and same-build daemon
   handoff, preserving unrelated sessions and applicable effect authority.
3. Execute the retained Linux historical inventory, real prerequisite acquisition,
   migration/admission and completeness, including manual fixture provenance.
4. Record final candidate identity and gate outputs before operational acceptance,
   commit/release preparation or any publication claim.

No installation/setup authority is inferred from a missing runtime or daemon.
The Setup role cannot install/download tools; its preparation authority is separate.

## Pinned Linux verification resumed

The user replied that Docker is ready. Lead read-only probe now reports
Docker29.1.3/linux/aarch64. All60reviewed backend inputs still match the composite
final manifests. Same Apply Deep owner attempt6 performs isolated container
verification with Bun1.4.0 and Linux-specific dependencies. Host source/index,
installed Deck/runner roots and existing services remain outside mutation scope.
No result is claimed until the original handoff and actual outputs are reviewed.
