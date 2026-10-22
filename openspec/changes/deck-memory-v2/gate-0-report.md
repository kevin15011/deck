# Phase 0 gate report

Status: **OPEN — live baseline pending**. Date: 2026-10-21. Product baseline: `fc667aadbb052e2e4515889e425848762769c838`, branch `feat/memory-v2`.

This report consolidates completed Phase 0 evidence. It does not approve Phase 1 or claim that simulations measure cloud retrieval quality. Evidence below was executed in the earlier investigations unless explicitly labeled as the resumed Lead's work. Historical reports mentioning `/tmp/deck-memv2-phase0` were preserved by the user at `/home/kevin15011/deck-memv2-phase0`; use the latter.

## Current gate correction

The first R pilot is **INVALID for quality baseline purposes** by user decision after console reconciliation. Its displayed memory tokens and operations did not increase; +171 searches reconcile to 49 direct plus 122 profile queries, and displayed balance stayed $19.97. Exact/sub-cent/eventual debit remains unknown. Read the processing, dual-mode, delayed-cleanup and session-local v2 requirements in working-brief.md. A valid replacement pilot and full R+N with at least three repeats remain required. Earlier operational/cleanup evidence below is historical and preserved, not baseline approval.

## Current checkpoint

The gate remains OPEN. Four replacement adaptive attempts were made: two stopped on ID correspondence validation (fixed and reviewed), one stopped on a status transport failure (background scheduling and bounded recovery subsequently reviewed), and the fourth lost its process without terminal receipts. None establishes a valid baseline. Aggregate modeled/reserved cost is USD0.020955; actual billing is unconfirmed. All four attempts retain their namespaces; cleanup requires explicit user reconciliation and authorization.

The last offline investigation made no source changes. It validated keeping launch, attached supervision and terminal collection inside one owner task across tool yields. Exact historical interruption cause remains unproven; see working-brief.md for evidence, lifetime constraints and remaining budget. The user requested a commit checkpoint and will resume in this session. No further run is started now. Fresh manifests will be required after commits; full R+N with at least three independent repeats remains pending/disabled.

## Historical first-pilot evidence (quality invalidated above)

**R pilot completed; full baseline and gate remain pending.** User confirmed the initial balance was recorded; the reviewed run `20261021_c341f16ac31a8612` executed once and exited 0. [Executed report](/home/kevin15011/deck-memv2-phase0/live-r-pilot/20261021_c341f16ac31a8612/REPORT.md). 352 cloud requests: 68 document writes, 215 profiles, 49 searches, 16 scoped namespace reads and four scoped deletes. All 50 case artifact hashes verified. Four run namespaces deleted and verified absent through both API surfaces; zero retained.

Modeled cost $0.076640 ($0.074620 evaluation +$0.002020 cleanup), below $0.20/$0.25 stop/total controls. Actual debit awaits the user's final console reading; completion notice sent. Token estimate 2,084; 8,239 conservative proxies consumed of 16,478 budget. No additional provider/account/billing calls were issued for reporting.

Provisional scores across 39 scored cases: recall 94.44%, precision at role cap 25.88%, supersession 37.5%. Three expected policy skips and eight unsupported v2 cases remain separate. All 61 profile settling checks ended empty, excluding all scored cases from settledOnly; final search did return content. Review this measurement limitation offline before interpreting extraction stability. Single-repeat pilot results do not measure variance. Full R+N requires at least three repeats, native-payload cost planning and independent result/scorer calibration; gate remains OPEN.

## Hypothesis coverage

Every H1–H10 has a verdict. A partial verdict is a completed investigation with qualified conclusions, not an unexamined hypothesis.

| ID | Verdict | Finding and evidence boundary |
|---|---|---|
| H1 | Confirmed, qualified | Capture rules reject useful-looking prose depending on formatting/language; executed function probes reproduce the cases. Acceptance does not establish usefulness. |
| H2 | Partially confirmed | Pi uses Deck runtime; Claude/Codex/OpenCode use pinned official plugins. Same canonical project scope does not establish equivalent capture or durable writes. Plugin internals are covered by the separate pinned-source audit. |
| H3 | Partially confirmed | Fragments lack textual role prefixes, but requests already carry role metadata and a shared scoped session ID. Remote ordered-transcript/append semantics remain unproven offline. |
| H4 | Mostly confirmed | Legacy endpoints, uncached runtime profile calls, disabled rerank/rewrite and discarded similarity are verified. “Sequential every turn” does not hold across all lanes: initial direct recall is parallel and plugins own their policies. |
| H5 | Confirmed | The existing plumbing benchmark uses synthetic ranking and exclusions. Its 13/13 pass and perfect scores are not live retrieval evidence. |
| H6 | Confirmed within audited source | The instruction-referenced managed-recall tool has no current registration under that exact name in the bounded executable source; historical implementations existed. |
| H7 | Confirmed, qualified | Normalization can collide across owner/repo boundaries. Governance accepts scopes which the project adapter does not partition remotely. This does not prove team/org storage. |
| H8 | Confirmed | OpenCode documentation describes a retired loopback path; current composition uses the official plugin. |
| H9 | Partially confirmed | Project paths lack a governed cross-project learning channel. Managed-global selector stripping refutes plugin fallback selecting the final namespace in that intact lane. Direct OpenCode identity fallback remains distinct. |
| H10 | Partially confirmed | Managed-global Codex gets the wrong credential variable; intact proxy authentication prevents the investigated bypass. Legacy bridge hooks can activate with synthetic inherited bridge variables despite disabled configuration. |

Detailed source locations, executed probes and qualifications: [code REPORT](/home/kevin15011/deck-memv2-phase0/code/REPORT.md), [pinned plugin REPORT](/home/kevin15011/deck-memv2-phase0/plugins/REPORT.md), [H10 REPORT](/home/kevin15011/deck-memv2-phase0/h10/REPORT.md), [security review](/home/kevin15011/deck-memv2-phase0/quality-h10/REPORT.md).

## Capture baseline and inventory

Earlier offline replay: 4,672 unique historical messages; 467 accepted (10.00%). The code report includes runner/role/rejection-reason tables and a separately qualified final-assistant subset. This replays current eligibility against historical text; it measures neither plugin ingestion nor useful-memory recall. Focused verification: 402 pass, 0 fail, 2 skip across 38 files, 1,994 assertions.

The production inventory was executed once and will not be rerun. It made 91 read operations, all HTTP 200: 77 document reads, 10 memory lists, one document list, one namespace list, one bucket read and one profile read. Latency p50 227 ms / p95 562 ms. The project namespace contained 77 documents and 944 memories; the account listing returned 19 namespaces. Four names were masked by the old redactor and remain unresolved. Two investigator-created Codex documents were identified for user-managed deletion. The inventory key is revoked/deleted.

Private inventory evidence: `/home/kevin15011/.deck-eval/inventory/20261021T155528Z/`; reviews: `/home/kevin15011/deck-memv2-phase0/quality-inventory/`, including `r2/` and `r3/`. No private export is included in this change.

## API and evaluation readiness

The [API report](/home/kevin15011/deck-memv2-phase0/api/REPORT.md) and its dated OpenAPI snapshot establish published v5 contracts, not authenticated runtime semantics. The local binary was discarded by user decision. Optional MemoryBench integration remains undecided.

The dataset has 50 questions, 61 seeds and a synthetic project B: `/home/kevin15011/deck-memv2-phase0/eval/`. Its HARNESS.md OpenCode-loopback description is superseded by the actual harness's pinned official-plugin replay.

The harness's [fix/evidence log](../../../benchmarks/memory-live/QUALITY-FIXES.md) separates executed code from documentation added later. Apply Deep attempt 6 reports 64 offline tests passing, 627 assertions, TypeScript passing, self-gold oracle 42 questions/75 atoms/zero failures, and verified scorer/retry hashes. These are implementation results awaiting independent re-review. Quality attempt 5 is in progress; its target report is `/home/kevin15011/deck-memv2-phase0/quality-harness/r5/REPORT.md`.

Resumed Lead execution: prepared manifest `/home/kevin15011/.deck-eval/runs/20261021_25ea1229af75b950/plan.json`; compiled two entrypoints under network isolation successfully; inspected manifest and file permissions. R only, one repeat, four run-owned namespaces, shared-account true, **822 evaluation + 28 cleanup = 850 total maximum**, `liveApproved: false`. Eval-key metadata only was checked: nonempty regular file, 0600, parent 0700; content was not read. No live run or cleanup has occurred.

## Operations, credits and current limitations

| Activity | Actual provider operations | Actual debit | Estimate / qualification |
|---|---:|---|---|
| Earlier production inventory | 91 reads | Unknown; not observable with that key | Approximately $0 expected from the dated published meters, unverified |
| Harness development and resumed preparation/build | 0 | $0 | All executed provider behavior was simulated or absent |
| First eval-key pilot (invalid quality baseline) | 352 | Displayed balance $19.97 to $19.97; exact debit unknown | Console +171 searches, unchanged rounded tokens; 4 namespaces deleted |

No account/billing endpoint is authorized for the pilot. Actual credits may therefore remain unobservable; operation receipts and known-meter estimates must be labeled separately. Production account settings can affect ingestion and are neither read nor changed.

## Hotfix and gate prerequisites

Latest hotfix status: **independent GO**, after runtime-file lifecycle and metadata repairs. [Final bounded review and executed outputs](/home/kevin15011/deck-memv2-phase0/quality-h10/verify4-runtime/REPORT.md). Quality executed 77 affected tests plus the actual-kernel uncertain-ownership probe; earlier unaffected parity and lifecycle evidence is preserved as earlier execution. Lead subsequently checked all 14 hashes in the executed manifest successfully, without rerunning tests. No native credential/login check, commit or merge occurred. The next paragraph records the historical review that motivated these now-completed fixes.


`fix-credential-boundaries` remains uncommitted in `/home/kevin15011/deck-fix-credential-boundaries`. Latest [Quality report](/home/kevin15011/deck-memv2-phase0/quality-h10/verify2/REPORT.md): GO-WITH-FIXES. It verifies F3/F4/F5, direct/managed environment parity and doctor behavior with synthetic homes, fake runners and a real detached daemon. It also finds Tavily persisted in 0600 session configs and direct-launch filtering loosened relative to main. The user has since approved parity and conditional Tavily persistence outside repositories, with session-close cleanup, daemon startup stale-file cleanup and doctor orphan reporting. Implementation and independent execution review are pending. Real native login preservation has not been verified by this synthetic execution.

F1 and F6–F10 remain explicit v2 acceptance criteria. Memory stays disabled on main until v2; no native credential access without prior user authorization. Once the hotfix lands on main, merge main into this branch before Phase 2.

Before a gate decision:
1. Receive independent Quality GO for the latest harness.
2. Execute the already-authorized R pilot; report per-endpoint operations, latency, measured quality/coverage, estimated versus actual credits, first-write visibility and final cleanup receipts.
3. Require both live API surfaces to verify cleanup; list every retained namespace and reason. Do not treat v5 404 alone as deletion proof.
4. Execute the user-required full R+N baseline with at least three independent repeats after successful pilot evidence; failed native positive controls must be unavailable with no substituted scores.
5. Complete live baseline evidence and present this gate for explicit user approval. The pilot alone does not close the full baseline.
