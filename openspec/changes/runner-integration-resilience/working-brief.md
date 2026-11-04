# Working Brief: Reliable runner integration across upgrades

## Outcome and status

Propose a coherent install-to-launch compatibility lifecycle across Codex, Claude,
OpenCode and Pi. An installation must not report operational success when the
same installed state will fail session preparation. Upgrades must not leave old
writers silently managing newer state.

Status: the user accepted implementation on the current `main`, with an explicit
requirement to avoid unnecessary work-blocking generation checks. Implementation
planning is in progress. Source changes are authorized; user-installation repair,
unrelated daemon restarts and release publication are not authorized by this brief.
Lead owns OpenSpec writing. Implementation and independent review remain pending.
No guarantee is made for arbitrary future native runner versions.

## Accepted continuity constraint

Generation safeguards MUST fence incompatible mutations rather than automatically
block work. A compatible installed generation SHOULD continue read-only while
refresh is deferred. A changed build digest alone MUST NOT block an otherwise
compatible session or interrupt active work. Required trust, scope and approval
boundaries MUST remain enforced. Compatibility, update availability and permission
to mutate are separate outcomes. The daemon strategy MUST avoid replacement loops
when stable and canary clients coexist. Architect task attempt 2 refines the handoff
under this constraint; an independent specialist owns the separate web layout.

## Evidence baseline

Source candidate: `4510477a250e87dac94407619791bfc705f38292` plus pre-existing,
uncommitted `packages/adapter-codex/src/mcp-config.ts` and
`packages/adapter-codex/src/deck-shaped-mcp.test.ts`. Preserve both files.

Historical findings were reviewed from Investigate task
`task-743e3c89-a32c-4671-aa8a-7583be4fcae6`, attempt 2, result event 3599.
Current architecture recommendations were reviewed from Architect task
`task-098dc6bb-a5b1-4fff-a1b6-fac0ad562681`, attempt 1, result event 5552 and
its complete report artifact. These reports are evidence inputs, not specifications.

| Runner | Distinct recorded issue | Repository evidence and limit |
| --- | --- | --- |
| Codex | Missing hook ownership records, then legacy memory entry blocking preparation | Current `native-role.ts:53-57` validates every marked hook; `apps/cli/src/codex-supermemory-launch.ts:126` rejects legacy memory. The recent transcript did not prove final live preparation success. |
| Claude | MCP method-header incompatibility | `openspec/changes/deck-memory-v2/working-brief.md:520-532` records the real discovery failure and subsequent transport correction. Historical passing checks belong to that candidate. |
| Claude | Runner-generated editor files rejected by plugin validation | Same brief, lines 584-590, records bounded verifier correction and a real launch. This differs from the protocol failure. |
| Pi | Codex-installed skill copies collide with Pi discovery | `docs/troubleshooting.md:106-111` documents cross-runner discovery and exact tracked exclusions. |
| OpenCode | Implemented Context7 capability missing from selection metadata | `openspec/changes/opencode-context7-selection/working-brief.md:1-13` records the correction and its manual acceptance limit. |

These are different failure classes. They support a lifecycle/testing problem,
not a claim that all runners fail through the same receipt mechanism. Claude RTK
binary pinning is additional historical prevention evidence, not a separately
proven outage in the recent session.

## Current mechanisms and gaps

1. **Installation and admission disagree.** Codex installation verification checks
   planned hashes, modes and TOML (`runner-adapter.ts:1853-1879`). Customized hook
   blocks may be preserved with a warning (`developer-team-install.ts:541-558`),
   but native admission rejects missing/mismatched receipts (`native-role.ts:54-57`).
   Thus a valid install plan can describe a state that preparation rejects.
2. **Ownership history can disappear.** The Codex planner selects prior receipts
   at `developer-team-install.ts:607` and skips unproven entries at line 628.
   Preserve historical evidence separately from current execution authorization.
   The exact sequence causing the recent lost receipts remains unproven.
3. **Build identity is insufficient.** `session-host/src/daemon-client.ts:34-39,84`
   compares only numeric semver; distinct same-version canary builds compare equal.
   `paths.ts:40-54` chooses a common default daemon socket without a channel key.
4. **Persisted commands depend on executable locations.**
   `apps/cli/src/runner-adapters.ts:52-54` uses `process.execPath`. Relocatable,
   versioned binaries require explicit lifecycle management. Canary hash churn as
   the cause of the particular lost-receipt incident has not been reproduced.
5. **Upgrade content sync remains in the original process.**
   `upgrade-command/orchestrator.ts:699-715,1116-1121` replaces the binary and later
   passes the existing adapter registry into synchronization. Do not assume new
   executable bytes replace already-loaded adapter code. Actual downgrade effects
   need a reproduction; they are not established historical outcomes.
6. **Preparation loses useful errors.**
   `session-native-skills.ts:31` produces OpenCode and Codex preparation codes,
   while `session-manager.ts:1530` admits only the Codex preparation code. Return
   reviewed structured errors, preserving the current credential-redaction boundary.
7. **Migration evidence stops short of launchability.**
   `scripts/retirement-candidate-migrate.ts:119-121` checks installation verification
   and repeat cleanup. The historical matrix workflow is explicitly optional;
   `.github/workflows/ci.yml` runs types and the fast suite. Existing tests are
   valuable, but these checks do not establish real native runtime compatibility.

## Recommended implementation order

### 1. Close the current correctness gap

Define a read-only adapter admission result with structured checks, selected
capabilities and explicit remediation. Use the same policy in install verification,
preparation, direct launch and doctor. Installation reports success only for its
declared supported session mode, not merely because files match a plan.

For the current Codex candidate, independently review the uncommitted MCP recovery
change, reproduce legacy/missing-receipt states in temporary roots, then run full
install, admission and real preparation. Shape recognition is a bounded legacy
migration; recognized old content must be rewritten to canonical owned content
before a new receipt authorizes it. Preserve user-modified entries. Never grant
execution trust solely because a marker or familiar shape exists.

Retain old receipts as historical records when reconciliation cannot prove current
ownership; do not let retaining evidence authorize changed bytes. Report the exact
unresolved item rather than claiming reinstall will necessarily repair it.

Owners: core contract, runner adapters, CLI install/doctor, session-host errors.

### 2. Prevent mixed generations from rewriting shared state

Negotiate daemon/client protocol and build identity, including executable digest
and channel. A digest identifies a build; it does not order builds. Use an explicit
installation generation/transaction epoch and supported schema for writer fencing.
Same-semver builds and divergent channels must not infer ordering from commit hashes.

Reconcile an idle stale daemon through a verified handoff. Do not kill active work;
defer incompatible new preparation with a precise finding. Fence every writer under
the existing mutation lock and refuse stale-generation writes. Run post-upgrade sync
with the verified new executable, or defer it explicitly to that executable.

Owners: session-host lifecycle/protocol, core mutation/contribution contracts,
CLI upgrade composition. Channel isolation versus shared-root handoff remains a
design decision; separate sockets alone do not isolate shared runner files.

### 3. Make tool upgrades independent of persistent config strings

Prefer dedicated config/overlay locations where the native runner supports them.
For remaining persistent commands, introduce stable Deck-owned launch entry points
that resolve verified tool/payload generations. Reuse contribution transactions,
digest verification and generation references rather than adding a parallel store.

Capture the resolved generation for each session. A mutable global pointer must not
silently switch an active session's hooks or MCP processes. Keep old payloads until
all relevant references end. Validate ownership, links, permissions and rollback
before publishing a new pointer or config generation.

Keep a bounded history of exact Deck-written contribution hashes outside the
runner manifest. Recover only provable historical content; migrate before trusting.
Expire legacy recognizers through a documented supported migration window.

Owners: core contribution/generation services, adapter materialization, CLI installer.

### 4. Make lifecycle compatibility a release condition

Extend the existing historical harness with session admission instead of creating
a duplicate harness. Require hermetic per-runner fixtures for the supported release
window, mixed-runner installations and repeated execution. Keep network calls,
real installations and user writes outside the ordinary test gate.

Maintain a tested runner-version matrix. An unknown version is unverified, never
silently labeled supported. Use native configuration/protocol probes where feasible;
permit degradation only when the runner contract and requested capabilities allow
it. Required security, approval or memory-scope boundaries must never be bypassed
to obtain a green status. Optional capabilities may be disabled explicitly.

Use pinned real-runner canaries for release evidence, plus scheduled newer-version
detection outside the fast suite. Record exact Deck build, runner/tool versions,
platform and observed behavior. Detection must feed the support matrix and block
promotion of an affected combination. Defining the exact previous-release window
is part of implementation planning, not an arbitrary number asserted here.

## Acceptance and failure oracles

| Scenario | Required result |
| --- | --- |
| Fresh install and repeat | Admission succeeds; second run performs no effective managed-content changes. |
| Historical supported install to candidate | Migration and admission agree; selected capabilities remain present. |
| Missing receipt or customized block | Proven recovery or precise conflict; no foreign execution trust and no false install success. |
| Same-semver rebuild | Preparation demonstrably uses the negotiated candidate build, or defers safely while busy. |
| Old writer after new installation | No managed bytes change; stale generation is reported. |
| Interrupted upgrade or pointer publication | Recover a coherent generation; never expose mixed config/manifest/tool state. |
| Tool bump or executable relocation | Correct verified binary runs; obsolete payload removal does not break a referenced session. |
| All four runners in one fixture HOME | Each admits correctly; reinstalling one does not break another's discovery or ownership. |
| Native protocol/generated-file change | Bounded permitted changes succeed; executable or unsafe artifact drift still fails. |
| Errors across adapters | Reviewed check and remediation survive adapter-to-host-to-UI transport; secrets do not. |
| Real supported runner canary | Prepare, launch, and exercise the affected capability; reaching a prompt alone is insufficient for hooks/MCP behavior. |

Reproduce deterministic bugs red-first. Run focused checks while editing, then
`bun run test` within its 120-second hard budget and `bunx tsc --noEmit` for the
final implementation candidate. Required live checks follow project authority and
must not restart unrelated sessions or send unapproved remote effects. Independent
review is required for ownership recovery, executable indirection and writer fencing.

## Rollback and scope

Stage config, manifests and tool references as one recoverable transaction; validate
the candidate before activation. Retain the previous verified generation while it is
referenced. If validation fails, retain/restore that generation where compatible;
never overwrite user edits or roll back through a newer unsupported schema.

This proposal does not replace the existing `fix-update-recovery` change, rewrite
historical memory work, or authorize a release. Before implementation, align active
change boundaries and formalize durable public contracts in the appropriate SDD.

## Verification performed for this analysis

Lead reviewed both original reports, independently inspected the cited installation,
admission, daemon, upgrade, error transport, workflow and historical incident records,
and checked HEAD plus the dirty file list. No tests, real installs or live session
probes were performed. Only this proposal document was added; existing source and
user configuration were preserved. At the analysis stage safeguards were proposals.

## Implementation candidate, pending independent acceptance

Apply Deep attempt 1 produced backend digest
`527cc507d07e747904378843da07fd5d460232f4245351b6b6459ba280545bfd`;
Lead matched all 48 input hashes in `/tmp/deck-resilience-candidate.json`.
Full handoff: `/tmp/deck-runner-integration-resilience-report.md`.
Quality attempt 3 independently reviews the backend; this is candidate adoption,
not verification completion.

The candidate implements artifact admission, exact contribution history, writer
fences/recovery, structured diagnostics, daemon build negotiation, verified
new-binary synchronization, native-use exclusion and release migration admission.
It reuses retained immutable payloads and native-use leases instead of introducing
environment-driven trampolines or global mutable tool pointers. External package
manager deletion and pre-fence binaries remain explicit limits.

Owner reports TypeScript passing in17.22s. Full canonical-temp suite remains RED:
4810pass/23fail/1skip, versus isolated HEAD4790pass/24fail/1skip with no new failing
names according to `/tmp/deck-resilience-comparison.json`. This is baseline
comparison evidence, not a passing gate or approved quarantine. Available Bun1.3.11
differs from CI pin1.4.0; exact pinned runtime, independent protected review and Lead
live canary remain pending. No user installation repair, commit or restart occurred.

## Independent review: candidate not accepted

Quality attempt 3 returned five P1 blockers (result20453); Lead reviewed the report
and checked the planner retry and post-rename digest sites. Apply Deep attempt 2
owns all corrections, tracked as structured unresolved findings:

| Finding | Required correction |
| --- | --- |
| RIR-01 | Preserve MCP receipt exclusions and customized bytes through collision retries. |
| RIR-02 | Capture verified digest before rename; validate installed bytes afterward. |
| RIR-03 | Native lease contention before effects must not create unrecoverable pending state. |
| RIR-04 | Implement missing historical selected-variant mappings before requiring the existing inventory gate. |
| RIR-05 | Share required selected Supermemory local artifact checks with launch. |

Quality could run read-only probes but protected fixture reexecution was denied
temporary-directory writes. Lead writable protected rerun remains necessary.
The previous baseline directory contains two candidate-only files; rebuild/freeze
a pristine baseline before accepting comparison. No passing canonical gate or
completed implementation is claimed. Keep test trust/completeness unchanged.

Apply Deep attempt 2 proposes RIR-01/02/03/05 fixes with actual planner, rename,
native-lease and selected-artifact red/green regressions. Quality attempt 4 reviews
those stable paths. The pristine baseline was rebuilt and frozen;21/23 normalized
shared error signatures match exactly and2 differ in disclosed dynamic hashes/paths.
The final owner gate is still RED4815pass/23fail/1skip; types pass14.57s.
These facts do not close findings or make the canonical gate green.

RIR-04 source/probe evidence establishes original0.0.1/0.0.2 installers only offered
manual external tools for four OpenCode/Pi rows. Lead accepts truthful, independently
pinned manual-provisioning fixtures as the implementation route, with distinct
provenance and unchanged inventory/completeness. See the design decision; Apply Deep
attempt3 implements it. No user policy question or support exclusion is required.

Lead independently reexecuted eight protected test files on the repaired candidate:
21pass/0fail,125assertions,10.163s, with all stable backend input hashes unchanged
before/after. This includes planner preservation, rename upgrade, lease contention,
pending recovery, selected Supermemory checks and four-runner coexistence. Command,
inputs and logs: `/tmp/rir-lead-protected-a2.json` and `.log`. The historical harness
is concurrently under repair and excluded from this scoped evidence. No full-gate
success is inferred from the protected run.

## Latest independent finding state

Quality attempt4 recommends RIR-01/02/05 closure; Lead adopts those resolutions
with its21-test protected rerun and source review. RIR-03 remains a blocker:
reentrant nested mutations are not drained before the parent releases its native
lease. A rejecting sibling in Promise.all can release exclusivity while an admitted
child remains unfinished. Track and drain admitted children before lease release
and fence completion, including rejection paths; late inherited work must acquire
a new lease. Quality's controlled-promise reproduction used the actual function
with an external in-memory reservation edge. No final acceptance is claimed.

Apply Deep attempt3 is currently implementing RIR-04; the host rejects continuation
while that task is running, so RIR-03 must be returned to the SAME owner at its next
compatible continuation. Preserve this pending work; do not start a second owner
or close the finding on the original contention-only test.

Apply Deep attempt3 implemented explicit manual external-tool fixtures for all four
retained early-release rows, with source/provisioning/config/migration provenance
and negative completeness checks. Quality attempt5 reviews this eight-file scope.
Heavy Linux acquisition/migration and pinned-runtime/live canary evidence remain
unexecuted; structural fixture implementation alone is not release qualification.
Apply Deep attempt4 now owns the pending RIR-03 nested-effect lifetime correction.

Quality attempt5 rejects RIR-04 code completion (result25983): OpenCode manual
configuration changes invalidate the original snapshot selected for replacement;
publication accepts an artifact path at the wrong argv position or without required
Serena arguments; Pi's recorded manual outcome and the fixed UV digest are not
validated against exact verified contracts. Lead inspected the publication and
migration selection paths. All three corrections belong to RIR-04 and must go to
the SAME Apply Deep owner after active attempt4 ends. Preserve original attribution
snapshots, add separately proven operator-config migration preimages, and require
exact native argv plus fixed provenance identities. Do not waive the rows or gates.

Lead's earlier nine-test historical run passed on unchanged8file inputs in0.59s
(`/tmp/rir-lead-historical-a3.json`), but the reviewer found missing production
partitions; that pass is not sufficient acceptance and must not close RIR-04.

Apply Deep attempt4 adds per-invocation descendant draining and wraps adapter
effects inside the guarded scope before fence completion. Quality attempt6 reviews
RIR-03; Lead matched4repair hashes and independently ran installation-use,
runner-mutation-admission and writer-fence tests:16pass/0fail,102assertions,2.065s,
unchanged scoped inputs (`/tmp/rir-lead-lifetime-a4.json`/`.log`). RIR-03 remains
open until the independent recommendation is reviewed. Apply Deep attempt5 repairs
the three RIR-04 issues from Quality5; historical files are its exclusive scope.

Quality6 recommends RIR-03 closure with11independent lifecycle/fence cases passing,
zero unhandled rejections, matching four-file digest and reuse of Lead's real
filesystem16test run. Lead rechecked all4hashes and structurally resolved RIR-03
using review events27922/27923. RIR-04 is the remaining open source finding;
full suite23failures and exact pinned/native/Linux qualification remain pending.

Apply Deep5 repairs the three historical producer/consumer defects with separate
operator migration preimages, exact native argv and fixed provenance identities.
Quality7 reviews its six-file scope. Lead matched input hashes and independently
reexecuted the actual historical tests:12pass/0fail,134assertions,2.275s,unchanged
inputs (`/tmp/rir-lead-historical-a5.json`/`.log`). RIR-04 is not yet closed.

Lead is building a checkout canary into a dedicated `/private/tmp` bin directory;
the user's default alias, runner config and active daemon are untouched. Read-only
native version probes report Claude2.1.316,Codex0.165.0,OpenCode1.18.31,Pi1.0.2
(`/tmp/rir-native-versions.json`). These version probes are not session acceptance.

Isolated canary build passed in4.344s. Payload SHA256:
`0b48e2c6caf7a7d71b5f325682b464bb7b843c48a951b38b2e516f9716e15770`.
Compiled `version` exited0 and reports0.14.0/base4510477/darwin-arm64/dev.
Piped startup via `--help` exited0 but displayed the TUI, so it is only startup
smoke, not proof of a help contract or native session. Record:
`/tmp/rir-lead-canary-smoke.json`. No user alias, daemon or runner config changed.
Real session/hook admission, same-version daemon handoff, pinned Bun and Linux
historical matrix remain unverified release qualifications.

Quality7 recommends closing the final RIR-04 source defect:80independent checks and
Lead's matching12test/134assertion real-filesystem fixture run pass. Lead matched
all6file hashes and structurally resolved RIR-04 with events29702/29703. All five
source findings are resolved; final operational acceptance remains incomplete.
See verification-report.md for complete source, UI, full-gate and environment status.
Read-only Docker availability check failed at the configured absent daemon socket;
no service was started or installed. Source implementation must not be labeled
release-ready until pending exact-runtime/native/Linux qualification is completed.
