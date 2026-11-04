# Working Brief: Retire Deck conversational memory completely

## User decision and order

The user explicitly decided to abandon Supermemory and Deck's conversational memory
system, including plugins, instructions, extensions, tests and all product residue.
First commit the preceding reviewed resilience and UI work, then implement the
removal as a separate change on main. No feature-off toggle or hidden dormant
provider is an acceptable result.

The role-assignment UI was committed as8148de1 and tab stability as4f1079e.
The existing resilience task is still running isolated pinned Linux verification;
its commit and final verification report precede removal implementation.

## Scope and boundaries

Remove conversational/adaptive memory contracts, providers, native official plugins,
legacy Deck bridges, hooks, scope/capture/recall/injection logic, selections and UI,
installer/doctor/update integrations, dependencies, generated materials, dedicated
tests/benchmarks/docs and stale owned installation contributions.

Inspect names and behavior, not only brand strings. Unrelated structural code
intelligence, Context Mode, authorization/approvals, runtime memory usage and shared
process/session machinery are not conversational-memory implementations. Preserve
their working behavior while removing the retired capability.

Audit Deck-owned installed artifacts through provenance and exact existing cleanup
boundaries. Do not destroy personal native registrations, credentials, remote account
data or unrelated files by matching names. No Git-history rewrite is implied.
The accepted removal decision supersedes prior advisory preferences to retain memory.

## Acceptance

- Deck exposes no conversational memory selection, provider, capture, recall,
  injection, bridge, plugin or extension runtime.
- No dormant product branches, generated instructions/assets, dependencies or tests
  remain solely to implement the removed capability.
- Existing owned installation state can be decommissioned without trapping upgrade
  or session entry points; user edits remain protected by ownership evidence.
- Residue audit covers source, generated origins, package/lock metadata, all four
  runner integrations, CLI/web, instructions, fixtures, tests, docs and registries.
- Dedicated retired-behavior tests may be removed under the user's explicit request;
  shared security, authorization, lifecycle and ownership guards remain protected.
- Any necessary transition-only legacy recognition is identified explicitly and
  justified against the zero-product-residue outcome, never silently retained.
- Focused behavior, full-suite/types, generator freshness, native canary and an
  independent residual audit establish the final scope and remaining limits.

## Ownership and current progress

Investigation task `task-0e792d3c-d815-4645-8c46-40a14e6d5e37` maps repository and
Deck-owned installed residues read-only. Architect task
`task-ef63aa51-d297-438b-8fcf-383ce926e9a8` designs the complete removal, shared
boundaries, old-config behavior, cleanup and verification. No removal implementation
is delegated until preceding commits and implementation ownership are concrete.
Lead alone writes OpenSpec and coordinates commits. No external memory service is
queried or mutated for this removal work.

## Initial inventory review

Investigator1 found six clusters: core/provider contracts, session runtime and MCP,
four native adapters, CLI/web/TUI, build/tests/docs, and current/historical OpenSpec.
Lead confirmed real SessionMemoryPort/provider composition, native preparation,
deck_memory MCP tools and adaptive configuration consumers. Installed Deck-owned
artifact candidates exist across Claude/Codex/OpenCode, but exact receipt/registration
ownership was not fully traced. Initial search output was truncated; it is not an
exhaustive residual proof. Same investigator attempt2 produces a complete categorized
manifest and bounded owned cleanup operands outside the repository.

Initial report source: task-0e792d3c-d815-4645-8c46-40a14e6d5e37,attempt1,
result33137. Architect removal design is still pending; no deletion has begun.

## Baseline commits and complete lexical capture

Preceding reviewed source is now committed:8148de1(role assignments),
4f1079e(tab stability),bee195e(runner installation/admission resilience).
The resilience commit explicitly records the available-runtime23baseline failures
and pending pinned Linux qualification; no full-green/release claim is made.
The running isolated verification snapshot predates commits but its source hashes
were unchanged; commit metadata does not replace that qualification.

Investigator2 remains bounded by read-only execution and untraced installed receipts.
Lead captured all rg JSON matches plus dedicated filename candidates without tool
output truncation into `/tmp/deck-memory-removal-inventory.json`:1034lexical
candidates, with line numbers, term sets, content hashes and categories. This
includes generated/agent material, historical records and false positives. It is
an exhaustive capture for its declared patterns, not a semantic deletion list or
proof that every residue is known. Installed cleanup operands remain unverified.

## Implementation launched

Architect1 full design reviewed (result37586). Lead persisted proposal/spec/design/
tasks and selected safe removal over a disabled feature. Narrow old-state read
tolerance and receipt-based decommissioning are explicitly bounded transition
infrastructure; no active provider remains. Independent personal integrations
become generic personal MCP rather than being deleted. Installed user cleanup
waits for exact ownership proof, source verification and idle admission.

Backend task `task-e137e832-48e0-4b78-961e-5139ffd3a495` owns core/session-host,
all runner adapters, extension/generator sources, benchmarks and safe cleanup.
CLI/UI task `task-ed9443f4-02b6-4882-8727-beadfae90458` owns apps/cli,apps/web,
root package declarations, product docs and their tests. Backend owner integrates
lockfile/generated outputs/full gates after CLI completion. Lead owns OpenSpec and
commits. The older Docker task verifies its immutable pre-removal snapshot only.

CLI/UI attempt 1 was reviewed and blocked as incomplete (result39301,
ended39302; integration39751). The actual patch removed root package scripts
and the development dependency only. Same-owner continuation now explicitly
includes release workflow call sites and carries RETIRE-CLI-01. No completion
or full verification claim is made for this partial patch.

CLI/UI attempts 2–4 remain incomplete (results40981,42276,43321).
Workflow references and selected web attribution, session service composition,
public flags and migration/smoke commands were removed in successive patches.
RETIRE-CLI-01 remains open: runner launch, doctor, TUI, fixtures and docs still
require retirement. Concurrent backend adapter import failures prevent combined
verification but do not block independent owned removals. Same-owner continuation
was issued; the whole candidate is not ready for commit or approval.

The preceding resilience Linux task completed (result43792,ended43793).
Frozen pre-removal Bun1.4.0 Linux candidate: types pass; focused12tests pass;
full4853pass/2fail, both network-namespace failures also on clean baseline.
Eight historical phase cells were exercised; full publication remains incomplete.
These results do not qualify the concurrent removal candidate. A one-line managed
Python bootstrap correction in the historical fixture awaits narrow same-reviewer
review before its own commit; no source rollback was performed.

The isolated Python bootstrap follow-up received narrow independent source approval
(result45035,ended45036). Lead matched current script SHA256
1e51397ca453c1d4840f1e910977c88cac8f9fb3a72f9c302a123814ad90536c.
Reviewer exercised84 read-only fake-effect assertions and checked retained real
Linux acquisitions. This approves only that source correction; broad historical
publication and the current memory-removal candidate remain unqualified.

CLI attempts7–9 removed runner/Pi launch composition and dedicated subsystem
helpers/fixtures, retaining a relocated shared context oracle. The Codex lease
fixture failure was traced to macOS /var symlink traversal; its state root was
isolated without weakening production guards. TUI removal remains incomplete.
Attempt10 made no edits and cited coupled flows wholly within assigned ownership;
Lead rejected that as an external blocker and requested consistent removal across
onboarding/dashboard/install actions, or an explicit technical escalation.
RETIRE-CLI-01 remains open. No combined-candidate acceptance or commit is claimed.

Escalated CLI/TUI implementation task5bdffbdc attempt1 completed the coupled
removal (53 path hashes matched by Lead). Independent review54335 confirmed the
narrow TUI removal but found a Codex search credential-binding regression and
orphan migration documentation. Attempt2 repaired both with red-first actual-
adapter/fake-spawn coverage;32affected checks passed. Independent re-review57415
passed10boundary cases and matched all three revision paths. Lead resolved
RETIRE-TUI-01, RETIRE-SEARCH-01 and RETIRE-DOC-01; broad RETIRE-CLI-01 stays open.

Backend attempt1 completed its346path ownership slice and canonical generation;
report55739 records frozen install/audit/generator freshness success,49protected
checks passed, full4278pass/1source-audit timeout, and2CLI doctor type errors.
CLI attempt3 owns the concrete doctor options and retired cleanup-ID composition
corrections. Independent backend review task8d6f4655 is in progress. Installed
state remains untouched and final combined verification is pending.

Independent CLI cleanup review59736 found P1 RETIRE-CLEANUP-OWNERSHIP-01:
retired-ID enumeration reaches tools/package.json dependency entries and core's
dedicated-directory fallback permits removal without receipts (12 reproduced
removals:3IDs x4runners). Prior file fixtures missed this config-entry path.
Installed cleanup remains unexecuted and acceptance blocked. CLI owner extends
public composition regression; core policy repair stays with running backend
owner e137e832 and must be supplied on its next terminal continuation. No competing
core owner or installed-state mutation was introduced.

Backend independent review60540 reproduced two more blockers: repeated full
Codex install discards mismatch evidence then deletes a customized old hook;
Pi rejects the exact previous receipted Codebase guard environment when keeping
that entry. It also found CLI continuity metrics using current-append validation
for persisted historical events. Exact repair handoff is retained at
/tmp/deck-retirement-required-repairs.md. Lead requested cancellation of the running
backend verification attempt2 so the SAME owner can repair these invalidating
findings before rerunning gates; cancellation was requested, not yet observed
terminal. CLI attempt4 continues only its regression fixture. No alternate core
owner, installation cleanup or acceptance claim was introduced.

Backend safety attempt3 returned10matched repair paths, pinned168affected tests,
69final cleanup tests,13generated checks,types and residue audit passing. Source
review remains separate from final suite/native qualification. CLI historical
reader repair62680 passed43focused checks; Lead independently ran4metrics tests.
Independent cleanup re-review64605 exercised50cases/281assertions including the
original12unauthorized removals and invalidreceipts. Lead resolved the ownership
finding on both CLI/backend task records. Codex/Pi re-review remains in progress;
broad CLI acceptance and operational cleanup remain pending.

Independent backend review65455 resolved original Codex hook/Pi defects and
confirmed historical metrics, but found equivalent repeated-install ownership
loss for retired MCP entries. Attempt4 repaired full/content-only MCP handling,
retaining original receipts and removing shape recovery. Pinned212affected tests,
types and audit passed. Independent re-review67244 executed32MCP/96plans and
16hook-file/48plans, reconstructing the exact3685-file candidate. Lead resolved
RETIRE-CODEX-MCP-01. All specific source findings are now closed; broad CLI and
whole-retirement acceptance remain pending final full gate/native canary/residue
and installed-state checks. Same backend owner continues final isolated gates.
