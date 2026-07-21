# Final Independent Review: deterministic-apply-verify-review-flow

## Immutable PhaseResult

| Field | Value |
|---|---|
| Role | `deck-developer-review` |
| Instance provenance | fresh independent final Review using `openai/gpt-5.6-sol`; distinct from the recorded Apply and final Verify instances; no subagent used |
| Change ID | `deterministic-apply-verify-review-flow` |
| Authorized scope | the entire active change at the exact implementation HEAD below |
| Authorized write | this `review-final.md` artifact only |
| Bound implementation HEAD | `34aadacaf142270063eb445b9ed55e1157511a0d` |
| Final Verify dependency | `verify-final.md`, SHA-256 `c53af43c1e4c1ec9645be71804242bdcafbdf6b7e674edda73df1becba343c9f` |
| Invocation digest | `sha256:b218f230d8d9f37b33af0dfbbc057f080bbd3aa4c714ff1a1e701eb4edf3d047` |
| Review batch binding digest | `sha256:f7d6d8adf95dafc5db783ab1a0f92c17755259bd4ebc37cb0d5ace10088b2268` |
| Review dossier binding digest | `sha256:d6b12e8f603f48aa0e2dfdb50a65d289ded544ab123a4f88879985364bf09b52` |
| Independent probe digest | `sha256:30d39b1f1a649e512b67461a19617286c47cef714f048e8c6203d69a70a9bfd6` |
| Decision digest | `sha256:a59571d899f2028d0a43a56b44f8c81c12593ea68ebbb88930571436701d361b` |
| Verdict | **REQUEST_CHANGES** |
| Blocking findings | 1 |
| Action | `stop_and_replan_repair`; this Review authorizes no modification |
| Archive permitted | **NO** |
| Adaptive context | loaded as advisory only; OpenSpec, source, tests, Git history, generated provenance, and final Verify remained authoritative |

**Verdict: REQUEST CHANGES.** Current runner-authority repairs B1-B6 pass independent engineering review, and the protected-risk policy authority repair is now batch-authoritative. However, a fresh adversarial probe at the bound HEAD reproduced a critical retry/convergence authority bypass: a legal typed convergence transition can append a caller-selected retry-attempt digest that is never tied to a retry/effect event; the authority parser accepts the resulting dossier, attempt 2 builds, and the modifying effect validator returns `accepted: true`. Passing tests, including the fresh broad 3823/0 run, do not cover this path.

This artifact supersedes stale partial Reviews as the current final Review judgment. Earlier `REQUEST_CHANGES` artifacts remain immutable historical evidence; their individual dispositions are recorded below rather than rewritten.

## Evidence bindings and method

The binding digests above use recursively key-sorted canonical JSON over the invocation, authoritative artifact/source digests, probe outcome, and decision. The artifact SHA-256 is intentionally external to avoid a circular self-digest.

| Dependency | SHA-256 / value |
|---|---|
| Proposal | `2b3c63a2bceaa06a8449c68d7ac080eee5724793a4060a9e5c4380a8a01e1ba1` |
| Spec | `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` |
| Spec replan G1 | `14b0ed7cc890c440c8dad6fbb7909c346a46b7d6c5a5cf6a976506ce12abbfc5` |
| Design | `9850e208e6f364232c4418481e6cc99eb063a68a1afdf77db52ae703ca2e9bc1` |
| Design replan G1 | `79f36722cc185be685b61a8ccf22907f3eb924e57d539c4a1e53016f3bd8430d` |
| Runner-authority Design replan | `7d389a846ca00c71c356ada41d78af4ffd0f140aa2acba431d1871611cb8306a` |
| Tasks | `d33fdea4c9cb9113a7ad0945c8cc4cc14ece24c1cd1b08308340ed96995a6cfe` |
| Effect-authority Tasks replan | `1e2d51e7e559af5c7aef45723f5060dd64fa5a3c7903e10c12dc1873981837b0` |
| Runner-authority Tasks replan | `eeb70c33ed47f73541e06ddde033a54696a27304a99c47190ad603f950995624` |
| Provider-capture Tasks replan | `94ce0a5df1da6136530ed41bd08667391bb3df62b1ed5a60ec6d3d28287b8e08` |
| Mode-taxonomy Tasks replan | `0a7386fd22dfbceda29751d91fcbdd41eec7f16430141b943065c8a089f3c146` |
| Final Verify | `c53af43c1e4c1ec9645be71804242bdcafbdf6b7e674edda73df1becba343c9f` |

Review method:

- inspected Proposal, Spec, Design, Tasks, all G1/effect-authority/runner-authority replans, historical Reviews, registry state/events, and final Verify;
- inspected commit history and the implementation sequence through `ccf0f66`, `15804c4`, and `34aadac` rather than inferring quality from the final commit alone;
- reviewed contract tests before the authorizing implementation and traced the production call path from installed adapters through the runner bridge and deterministic effect validator;
- inspected canonical runner sources, generated assets, source-hash provenance, Pi/OpenCode parity, and B1-B6 adversarial tests; and
- ran one ephemeral in-memory adversarial probe with no repository write.

## Blocking finding

### REVIEW-FINAL-B1-RETRY-LEDGER-INJECTION — Typed convergence replay accepts an unexecuted retry record and authorizes attempt 2

- **Severity:** Critical
- **Classification:** related implementation regression; blocking
- **Historical relationship:** reopens the acceptance objective of `REVIEW-EA-G1-B2-RETRY-LEDGER-SOURCE-AUTHORITY` and leaves the canonical-append objective of `REVIEW-EA-G1-B3-CONVERGENCE-TYPED-REPLAY-AUTHORITY` incomplete; it does not alter either historical artifact.
- **Requirement anchors:** `REQ-DAVR-RG-05`, `REQ-DAVR-MD-03`, `REQ-DAVR-MD-02`, `REQ-DAVR-RG-01`, `REQ-DAVR-BV-03`, `REQ-DAVR-REG-03`, and `REQ-DAVR-IEV-01`.
- **Task anchors:** `T-EA-02` and `T-EA-03`.
- **Accepted Design constraints:** `design.md:88-121` makes the authority-parsed current convergence ledger and complete retry records the sole attempt/prior authority, requires `retryLedgerDigests` to contain only complete retry-attempt records, and requires canonical event-derived append/replay; `design-replan-g1.md:56-73` requires source-authoritative retry history and full predecessor replay.
- **Locations:** `packages/sdd-runtime/src/contracts/execution-convergence.ts:174-195,720-793,970-1065`; `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:405-536,784-902,909-1115`; production consumer `packages/sdd-runtime/src/execution/execution-control-plane.ts:1234-1369`.
- **Missing regression oracle:** the current tests reject malformed, detached, and nonexistent convergence references, but do not construct an otherwise legal authority-replayed transition whose `retryLedgerDigests` contains an unexecuted, self-consistent attempt record.
- **Root cause:** `ConvergenceAuthorityAppendInputV1.retryLedgerDigests` accepts a complete caller-selected list. `appendExecutionConvergenceRevisionWithAuthorityV1()` checks only append-only prefix equality. `parseExecutionConvergenceDossierWithAuthorityV1()` exactly reconstructs `roleResultDigests` and `invalidationRecordDigests`, but does not event-derive or resolve additions to `retryLedgerDigests`. `validateRetryAttemptAgainstLedgerV1()` then treats the accepted dossier list as source authority and validates only the self-consistent record/projection/reference set supplied alongside it.
- **Reproduction at bound HEAD:** create canonical revision 1 with an empty ledger; build a structurally and semantically valid attempt-1 projection; create an attempt-1 record marked failed without executing that attempt; append a legal typed `apply_result_accepted` revision while passing `[attempt1.digest]` as `retryLedgerDigests`; provide matching stage/result/receipt records; then build attempt 2 and call the effect validator. Observed result: `authorityParserAcceptedInjectedRetryDigest=true`, `attempt2Built=2`, and `effectAccepted=true`.
- **Production call path:** `developer-team-runner-host-bridge.execute()` → `validateDeterministicTargetedRepairAuthorityV1()` → `parseExecutionConvergenceDossierWithAuthorityV1()` → `parseBlockingRepairProjectionV1()` / `validateRetryAttemptAgainstLedgerV1()` → `validateBlockingRepairProjectionAtEffectBoundaryV1()`.
- **Acceptance impact:** a caller able to supply deterministic authority evidence can manufacture consumed retry history and obtain modifying-effect acceptance without an authoritative prior retry/effect event. Retry budgets, attempt numbering, progress evidence, and convergence source authority are therefore forgeable despite valid hashes and typed stage replay.
- **Required boundary:** make retry-ledger additions event-derived and record-authoritative. The authority parser must resolve each newly appended retry-attempt record, bind it to the exact predecessor/projection/effect outcome and permitted event, and exact-compare the successor list to the computed append. Add a regression that reproduces the sequence above and requires parser, attempt-2 build, and effect validation to fail closed. Existing V1 serialized key sets can remain unchanged through additive authority records/receipts.

## Historical finding dispositions

| Historical finding(s) | Current disposition | Current evidence |
|---|---|---|
| `REVIEW-G1-B1` through `REVIEW-G1-B5`; `REVIEW-G1-R2-B1` through `B3`; `REVIEW-REC-G1-B1` through `B3` | Historical and superseded by later scoped findings. Their exact original self-rehash/optional-authority/noncanonical-initial probes are no longer the current implementation, but retry/convergence source authority is not closed because of `REVIEW-FINAL-B1`. | Current authorizing parsers require protected-risk, ledger, and typed convergence inputs; current probe exposes the remaining canonical retry-append gap. |
| `REVIEW-EA-G1-B1-POLICY-SNAPSHOT-EFFECT-AUTHORITY` | **Resolved at current HEAD.** | `bindProtectedRiskAuthority()` requires the independently batch-bound `protected-risk-policy` digest; omitted or stripped-and-rehashed policy fails at disposition, routing, projection parse, and effect validation. Relevant tests at `finding-disposition.test.ts:519,539,638`, `routing-decision.test.ts:598,638`, and `blocking-repair-projection.test.ts:993,1032` exercise the boundary. |
| `REVIEW-EA-G1-B2-RETRY-LEDGER-SOURCE-AUTHORITY` | **Not resolved as an acceptance objective.** The previously demonstrated arbitrary missing projection/convergence references now reject, but a valid typed convergence revision can still inject an unexecuted attempt digest and authorize attempt 2. | `REVIEW-FINAL-B1` reproduction and call path above. |
| `REVIEW-EA-G1-B3-CONVERGENCE-TYPED-REPLAY-AUTHORITY` | **Partially resolved, not closed.** Canonical revision 1, typed result resolution, receipt hashes, state replay, and exact role/invalidation list order now reject the original probes. Canonical replay remains incomplete for retry-ledger additions. | `execution-convergence.ts:970-1065` reconstructs state and two digest lists but does not reconstruct `retryLedgerDigests`; the current probe is accepted. |
| `REVIEW-G2-G6-PI-B1-CALLER-SUPPLIED-AUTHORITY` | **Resolved at current HEAD.** | Both adapters delete caller `deckExecution`, use only a trusted factory/process-local resolver, and mint/verify the process-local V1 envelope from provider evidence. No caller fallback remains. |
| `REVIEW-RA-FINAL-B1`, `REVIEW-RA-FINAL-B2`, `REVIEW-RA-FINAL-B3` | **Resolved at current HEAD.** | Provider/resolver and mode are captured during initialization; late global/options mutation does not alter authority; malformed resolver results are `invalid-evidence`; non-Apply paths strip transport and perform zero resolver/bridge/effect calls. |
| `REVIEW-RA-PC-B4`, `REVIEW-RA-PC-B5` | **Resolved at current HEAD.** | Invalid mode values fail closed before resolver/bridge/effect; `AUTHZ_MISSING` is reserved for an absent resolver; missing/malformed receipt evidence is `invalid-evidence` with Pi/OpenCode semantic parity. |
| Runner authority B6 — single-read accessor/Proxy | **Resolved at current HEAD.** | OpenCode `developer-team-execution.ts:83-85` and Pi `developer-team-execution.ts:81-83` capture the selected mode property once. `D-REACH-37` and `D-REACH-38` in each adapter assert one read and zero resolver/bridge/effect for adversarial accessor/Proxy values. |

## Engineering-quality assessment

| Area | Judgment | Evidence |
|---|---|---|
| Correctness | **FAIL** | `REVIEW-FINAL-B1` reaches attempt 2 and effect acceptance without an authoritative prior attempt. |
| Architecture | **FAIL at one trust boundary** | Additive V1 contracts, centralized registry ownership, and trusted process-local runner providers are coherent. The generic convergence append authority nevertheless exposes retry-ledger source selection instead of deriving it from a typed event/record. |
| Security | **FAIL** | The defect is an effect-authority bypass, not merely a serialization inconsistency. Hash integrity authenticates self-consistency but not the existence of a prior modifying attempt. |
| Maintainability | **PASS with risk noted** | Contract/build/parse/effect layers are named and testable, and Pi/OpenCode parity is explicit. Authority logic remains large and cross-coupled; the missing shared invariant across convergence and retry validation demonstrates that future repairs should keep one source-authority projection rather than duplicate partial checks. No separate maintainability blocker is raised. |
| Compatibility | **PASS in reviewed scope** | Established V1 serialized keys and schema identifiers remain preserved; authorizing validation is additive. Runner static-compatible behavior and adapter-native return shapes remain intact. The required repair can also remain additive. |
| Scalability/performance | **PASS in reviewed scope** | Replay and ledger validation are linear in bounded history/record collections; no new I/O, network, N+1, or unbounded concurrency path was introduced by the reviewed repairs. |
| Generated provenance | **PASS** | OpenCode canonical SHA-256 `5358c11e…951547e` matches the generated header and final Verify's byte-identical asset digest `d60a61bb…ebf`; Pi canonical SHA-256 `51c1d553…953d6` matches its header and byte-identical asset digest `64db2db3…3f06`. |
| Runner authority B1-B6 | **PASS** | Trusted provider-only authority, stripping, captured resolver/mode, taxonomy parity, receipt handling, and single-read accessor/Proxy behavior are present in source and adversarial reachability tests. |

## Verification adequacy and broad-failure disposition

- The final Verify artifact is byte-bound by SHA-256 `c53af43c1e4c1ec9645be71804242bdcafbdf6b7e674edda73df1becba343c9f` to implementation HEAD `34aadacaf142270063eb445b9ed55e1157511a0d`.
- The earlier broad result of 3820 pass / 3 fail is correctly classified as **environment-state only**. The failures came from `scripts/prepare-release.test.ts` exercising stale ignored `apps/cli/src/runtime/build-info.generated.ts`, not from the logged upgrade-command output. The current ignored file records commit `34aadacaf142270063eb445b9ed55e1157511a0d`.
- The final broad result is fresh for the bound tracked implementation: **3823 pass / 0 fail / 14775 assertions / 3823 tests / 215 files**, followed by successful typecheck and generated parity.
- Verification remains **insufficient for approval**, because the targeted suites do not cover the authority-valid retry-ledger injection reproduced by this Review. Broad green status does not negate the reproducible effect-authority defect.

## Scope and deviation notes

- No implementation, test, generated asset, other OpenSpec artifact, `state.yaml`, or `events.yaml` was edited by this Review.
- No `runner-capability-standardization` target was touched or included.
- Commit and diff inspection covered the implementation lineage through `ccf0f66`, `15804c4`, and `34aadac`; the current finding is in the active change's effect-authority/convergence targets, not unrelated concurrent work.
- Generated runner assets are deterministic and source-hash marked. No generated drift was found.
- `state.yaml` still reports `currentPhase: apply` / `status: in_progress`, and `events.yaml` ends at historical `repair.blocked`. This is stale centralized lifecycle state owned by the coordinator. Review does not mutate it; reconciliation is not permitted while the blocking finding remains open.
- Related regression findings: 1. Unrelated baseline defects: 0. Required Spec/Design replans: 0; the existing authoritative requirements and accepted Design already specify the missing boundary. Optional new scope: 0.

## FailureManifestV1

```json
{
  "schema": "failure-manifest-v1",
  "changeId": "deterministic-apply-verify-review-flow",
  "boundHead": "34aadacaf142270063eb445b9ed55e1157511a0d",
  "producerRole": "deck-developer-review",
  "status": "open",
  "findings": [
    {
      "findingId": "REVIEW-FINAL-B1-RETRY-LEDGER-INJECTION",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "critical",
      "requirementIds": [
        "REQ-DAVR-RG-05",
        "REQ-DAVR-MD-03",
        "REQ-DAVR-MD-02",
        "REQ-DAVR-RG-01",
        "REQ-DAVR-BV-03",
        "REQ-DAVR-REG-03",
        "REQ-DAVR-IEV-01"
      ],
      "taskIds": ["T-EA-02", "T-EA-03"],
      "checkIds": ["review-final-authority-valid-retry-ledger-injection-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:174-195",
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:720-793",
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:970-1065",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:405-536",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:784-1115",
        "packages/sdd-runtime/src/execution/execution-control-plane.ts:1234-1369"
      ],
      "destination": "targeted_repair",
      "owner": "apply-backend",
      "evidenceDigest": "sha256:30d39b1f1a649e512b67461a19617286c47cef714f048e8c6203d69a70a9bfd6"
    }
  ]
}
```

The destination classifies the defect; it does not authorize Apply. Any repair requires normal coordinator validation and explicit user authorization.

## Ordered RegistryIntentV1 values

```json
[]
```

No `review.passed`, `archive.ready`, lifecycle-advancing, or source-modifying intent is emitted. The coordinator remains the sole registry writer.

## Explicit blockers and Archive decision

- **Blocker:** `REVIEW-FINAL-B1-RETRY-LEDGER-INJECTION`.
- **Archive permitted:** **NO**.
- **Exact next action:** stop lifecycle advancement. The coordinator may create a bounded implementation-repair proposal under the existing Spec/Design authority and request exact user authorization. After any authorized repair, require fresh targeted and affected-area Verify, a fresh independent Review that includes the reproduced injection oracle, and then a fresh mandatory broad Verify before Archive can be reconsidered.

---

# Post-Repair Independent Review: retry-ledger injection repair

This section is the current independent Review judgment. The preceding pre-repair `REQUEST_CHANGES` result, including its original `REVIEW-FINAL-B1` evidence and FailureManifestV1, is preserved unchanged as artifact history.

## Current Immutable PhaseResult

| Field | Value |
|---|---|
| Role | `deck-developer-review` |
| Instance provenance | fresh independent post-repair Review using `openai/gpt-5.6-sol`; distinct from the recorded Apply and Verify instances; no subagent used |
| Change ID | `deterministic-apply-verify-review-flow` |
| Authorized repair batch | `deterministic-apply-verify-review-flow-final-retry-ledger-injection-repair` |
| Authorized write | this `review-final.md` artifact only |
| Bound implementation HEAD | `34aadacaf142270063eb445b9ed55e1157511a0d` |
| Bound Verify artifact | `verify-final.md`, SHA-256 `60eaf952d917a6107eb1dd821ec6449e5afeb7c83b8103c7118faf2c193676da` |
| Prior Review artifact history SHA-256 | `a94cf134fd47e1143b583c490458725d1547678e34e8663f51cd9bc98d94b542` |
| Invocation digest | `sha256:b836a0ad80248030e85199acc29c926adc57c25501857e6f8add28bf0943eccd` |
| Review batch binding digest | `sha256:0b9633315391548d908db2856c02e245227c9fbef7b5840d1ba05902123bcc89` |
| Review dossier binding digest | `sha256:11bd08f51943774a7b34ce88a8e26f7f18fe8788d45ed6d4fd585568ef8843d8` |
| Independent probe digest | `sha256:2450193aace1e45e3fc368bc3e024994600e9ae3f032e5e3ba633f0145a9c8db` |
| Decision digest | `sha256:c9224ca96cd88b93ca28e5aca3de4d1b1ae30cee7ad2cf9e88e496b7c11fe0ef` |
| Verdict | **REQUEST_CHANGES** |
| Blocking findings | 1 |
| Action | `stop_and_replan_repair`; this Review authorizes no implementation modification |
| Broad Verify permitted | **NO** |
| Archive permitted | **NO** |
| Adaptive context | loaded as advisory only; OpenSpec artifacts, current worktree source/tests, generated bytes, and Verify evidence remained authoritative |

**Verdict: REQUEST CHANGES.** The authorized repair closes the exact pre-repair `REVIEW-FINAL-B1` caller-selected unexecuted-ledger injection: non-effect events cannot grow the retry ledger, both legal terminal effect outcomes derive one append from a resolved record, and the original attempt-2/effect bypass fails closed. A fresh adversarial variant nevertheless found that append and authority replay accept an attempt-1 record carrying a non-empty, self-consistent but detached `priorAttemptDigest`. This violates the source-authoritative prior-link and full-predecessor-replay constraints even though the later projection/effect consumer rejects the poisoned ledger.

## Current worktree and dependency bindings

| Subject | SHA-256 |
|---|---|
| `packages/sdd-runtime/src/contracts/execution-convergence.ts` | `c7c418e11b7cf53ac871aacb8cb19f0bb52c78e0b22230e45f2d37cbc0d7639c` |
| `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | `30d5a0dc8a597c1f388eccd43da9e338b9a0a084a74298628693768030e31b6d` |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` | `e80d961a9bed93950ffb62094f1fa31c27d65dc71b420a6b24aa98cbaca9b511` |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` | `acf1dc2139a0da991bb5a2ae7eac6d71cdaa55f75dedbe1af1ec99814295cf47` |
| OpenCode generated standalone asset | `301a23f4ac35f04065ff1dbd26afe8aa4cd4e220a12dbdc20fac5f86cea2ae9c` |
| Pi generated standalone asset | `8b80e42e00017198972c02fabcaa9c6e2fb6b405c2cc7f505dbe582a95853414` |
| `verify-final.md` | `60eaf952d917a6107eb1dd821ec6449e5afeb7c83b8103c7118faf2c193676da` |

The worktree contains only the authorized uncommitted Apply repair, synchronized generated runner assets, the Verify artifact, and this Review artifact. No implementation, test, generated asset, Verify artifact, registry state, or event file was modified by this Review.

## Independent adversarial reproduction

The fresh probe constructed typed convergence chains independently of the checked-in regression fixtures and exercised append plus `parseExecutionConvergenceDossierWithAuthorityV1()`:

| Variant | Result |
|---|---|
| Original caller-selected unexecuted digest on `apply_result_accepted` | rejected |
| Caller-supplied attempt record on a non-effect event | rejected |
| Wrong terminal event/outcome in both directions | rejected |
| Wrong predecessor convergence revision | rejected |
| Wrong predecessor convergence digest | rejected |
| Wrong repair-projection digest | rejected |
| More than one ledger append for one effect event | rejected |
| Reordered successor ledger | rejected |
| Legal `repair_effect_succeeded` event-derived append and authority replay | accepted |
| Legal `repair_effect_failed` event-derived append and authority replay | accepted |
| Attempt-1 record with a non-empty detached `priorAttemptDigest`, with its digest recomputed | **accepted by append and authority replay** |
| Extra self-consistent authority record not referenced by the ledger | accepted as an unused record-set member; it does not alter the ledger, attempt count, or effect decision and is not a separate blocker |

The checked-in exact `REVIEW-FINAL-B1` tests also passed, and a fresh runner-authority regression run passed `67/67` tests with `214` assertions. Independent temporary regeneration produced byte-identical standalone assets: OpenCode `301a23f4…62ae9c` from canonical source `5358c11e…951547e`, and Pi `8b80e42e…853414` from canonical source `51c1d553…953d6`.

## Blocking finding

### REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT — Event-derived append accepts a retry record detached from predecessor ledger authority

- **Severity:** High.
- **Classification:** related implementation regression; blocking.
- **Requirement anchors:** `REQ-DAVR-MD-03`, `REQ-DAVR-RG-01`, `REQ-DAVR-RG-05`, `REQ-DAVR-REG-03`, and `REQ-DAVR-IEV-01`.
- **Task anchors:** `T-EA-02` and `T-EA-03`.
- **Accepted Design anchors:** `design.md:88-121` makes the current convergence ledger and complete records the sole attempt/prior authority and requires canonical event-derived append; `design-replan-g1.md:56-73` requires source-authoritative retry history and full predecessor replay.
- **Locations:** `packages/sdd-runtime/src/contracts/execution-convergence.ts:939-999` and `packages/sdd-runtime/src/contracts/execution-convergence.ts:1188-1245`; downstream rejection is in `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:405-536`.
- **Root cause:** `validateRetryAttemptRecordForLedgerAppend()` verifies record hash, effect outcome, predecessor convergence reference, and projection digest, but never compares `attemptNumber` or `priorAttemptDigest` with the predecessor retry ledger. `deriveRetryLedgerDigestsForTransition()` therefore appends a correctly hashed but lineage-detached record, and authority replay repeats the same incomplete validation.
- **Reproduction:** at a legal `repair_pending` predecessor with an empty ledger, construct an attempt-1 record whose `priorAttemptDigest` is an unrelated valid digest, recompute its record digest, and submit it with a matching `repair_effect_succeeded` event and projection digest. Append succeeds; the successor authority parser also succeeds.
- **Consumer trace and acceptance impact:** `developer-team-runner-host-bridge.execute()` → `validateDeterministicTargetedRepairAuthorityV1()` → `parseExecutionConvergenceDossierWithAuthorityV1()` accepts the malformed convergence history; subsequent `parseBlockingRepairProjectionV1()` / `validateRetryAttemptAgainstLedgerV1()` and `validateBlockingRepairProjectionAtEffectBoundaryV1()` reject it because attempt 1 must have no prior digest. Thus the original unauthorized attempt-2 effect bypass is closed, but the authoritative convergence ledger can still credit malformed retry history and poison deterministic continuation. Passing tests do not cover this exact prior-link variant.
- **Required boundary:** derive and validate attempt number/prior linkage from predecessor ledger authority during append and full replay. At minimum, an empty predecessor ledger must require attempt 1 with no prior digest, and a non-empty ledger must require a contiguous record whose prior digest is the authoritative predecessor attempt digest. Add append, authority-parser, attempt-2, and effect-consumer regression oracles for wrong and detached prior links.

## Finding dispositions and closure matrix

| Finding group | Current disposition | Evidence |
|---|---|---|
| `REVIEW-FINAL-B1-RETRY-LEDGER-INJECTION` | **Resolved for its exact acceptance path.** The historical `REQUEST_CHANGES` record remains above. | Caller-selected digest growth and caller-supplied records on non-effect transitions reject; authority replay rejects handcrafted original injection; attempt 2/effect acceptance is no longer reached. |
| `REVIEW-EA-G1-B1-POLICY-SNAPSHOT-EFFECT-AUTHORITY` | **Resolved.** | Batch-bound policy snapshot authority remains mandatory at parse and effect boundaries. |
| `REVIEW-EA-G1-B2-RETRY-LEDGER-SOURCE-AUTHORITY` | **Not fully closed.** | Original arbitrary ledger growth is fixed, but `REVIEW-FINAL-B2` shows predecessor prior-link authority is not enforced at append/replay. |
| `REVIEW-EA-G1-B3-CONVERGENCE-TYPED-REPLAY-AUTHORITY` | **Not fully closed.** | Event/outcome/projection/convergence/cardinality/order checks pass, but full predecessor retry lineage replay remains incomplete. |
| Runner authority B1-B3 | **Resolved.** | Caller transport stripping, trusted provider/resolver authority, initialization capture, malformed evidence failure, and non-Apply zero-effect behavior remain intact. |
| Runner authority B4-B5 | **Resolved.** | Invalid mode taxonomy and receipt/provider absence classification remain fail-closed and semantically aligned across Pi/OpenCode. |
| Runner authority B6 | **Resolved.** | Single-read accessor/Proxy capture remains covered; fresh combined reachability run passed `67/67`. |

## Engineering-quality assessment

| Area | Current judgment |
|---|---|
| Correctness | **FAIL** — one required retry-lineage invariant is absent at append and authority replay. |
| Architecture | **FAIL at the convergence trust boundary** — event-derived append is the correct architecture, but it duplicates only part of the ledger invariant enforced later by the consumer. |
| Security | **PASS for closure of the original modifying-effect bypass; FAIL for authoritative evidence integrity** — malformed lineage does not pass the downstream effect boundary, but a trusted convergence revision accepts it. |
| Maintainability | **PASS with risk** — localized helpers are readable; split invariant enforcement across convergence and projection modules caused the uncovered gap. |
| Compatibility/key sets | **PASS** — serialized `ExecutionConvergenceDossierV1` keys and V1 identifiers remain unchanged; new authority inputs/records are additive, and existing consumers retain prior key sets. |
| Scalability/performance | **PASS** — replay and append remain linear in bounded history and record lists. |
| Generated standalone bytes | **PASS** — both generated runner assets independently regenerate byte-identically from their canonical sources. |

## Current FailureManifestV1

```json
{
  "schema": "FailureManifestV1",
  "status": "open",
  "phase": "review-final-post-repair",
  "changeId": "deterministic-apply-verify-review-flow",
  "authorizedRepairBatch": "deterministic-apply-verify-review-flow-final-retry-ledger-injection-repair",
  "boundHead": "34aadacaf142270063eb445b9ed55e1157511a0d",
  "verifyArtifactSha256": "60eaf952d917a6107eb1dd821ec6449e5afeb7c83b8103c7118faf2c193676da",
  "failures": [
    {
      "findingId": "REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "high",
      "requirementIds": [
        "REQ-DAVR-MD-03",
        "REQ-DAVR-RG-01",
        "REQ-DAVR-RG-05",
        "REQ-DAVR-REG-03",
        "REQ-DAVR-IEV-01"
      ],
      "taskIds": ["T-EA-02", "T-EA-03"],
      "checkIds": ["review-final-wrong-prior-link-adversarial-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:939-999",
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:1188-1245",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:405-536"
      ],
      "destination": "targeted_repair",
      "owner": "apply-backend",
      "evidenceDigest": "sha256:2450193aace1e45e3fc368bc3e024994600e9ae3f032e5e3ba633f0145a9c8db"
    }
  ],
  "resolvedHistoricalFailures": [
    {
      "findingId": "REVIEW-FINAL-B1-RETRY-LEDGER-INJECTION",
      "currentDisposition": "resolved_exact_acceptance_path"
    }
  ]
}
```

## Current ordered RegistryIntentV1 values

```json
[]
```

No `review.passed`, `archive-precondition`, `broad.passed`, `archive.ready`, lifecycle-advancing, or source-modifying intent is emitted. The coordinator remains the sole registry writer.

## Explicit blockers and next action

- **Blocker:** `REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT`.
- **Broad Verify permitted:** **NO**; Review is not stable while this anchored blocker is open.
- **Archive permitted:** **NO**.
- **Exact next action:** stop lifecycle advancement. The coordinator may classify and propose a separately authorized bounded repair under the existing Spec/Design authority. After any repair, rerun fresh targeted and affected-area Verify, fresh independent Review including all variants above, and only then the mandatory broad Verify. This Review itself authorizes no implementation edit.

# Final Independent Re-review Confirmation

This append-only section records the fresh final Review requested after two malformed empty reviewer returns. It does not rely on those returns and preserves every preceding Review result as immutable history.

## Immutable PhaseResult

| Field | Value |
|---|---|
| Role | `deck-developer-review` |
| Instance provenance | fresh independent Review using `openai/gpt-5.6-sol`; distinct from Apply and Verify; no subagent judgment adopted |
| Change ID | `deterministic-apply-verify-review-flow` |
| Authorized repair batch | `deterministic-apply-verify-review-flow-final-retry-ledger-injection-repair` |
| Authorized write | `openspec/changes/deterministic-apply-verify-review-flow/review-final.md` only |
| Bound implementation HEAD | `34aadacaf142270063eb445b9ed55e1157511a0d` |
| Bound Verify dependency | targeted + affected-area **PASS**, `verify-final.md` SHA-256 `60eaf952d917a6107eb1dd821ec6449e5afeb7c83b8103c7118faf2c193676da` |
| Preserved prior Review artifact SHA-256 | `901466630bf1b32e2366a7f68e3450690bf128bd185fedc125cc671a95b12834` |
| Invocation digest | `sha256:7a1a52dd4a7b215ff60a6e357cb9b1ad19d8788f25ae10452c503ab12ba1fb7f` |
| Independent evidence digest | `sha256:cb85830adb42443c02f66bc3dbe356c29116374c8dad94deafa09b60544a9a17` |
| Decision digest | `sha256:4df7b0271f2ceeb1f981699dc683a4687cc446c5d87e8921f866654e62ad9bf2` |
| Verdict | **REQUEST_CHANGES** |
| Findings | 1 blocking related implementation regression; 0 unrelated baseline defects; 0 required Spec/Design replans; 0 optional new-scope findings |
| Action | `stop_and_repair_replan`; this Review authorizes no implementation or registry modification |
| Broad Verify permitted | **NO** |
| Archive permitted | **NO** |
| Adaptive context | loaded as advisory; OpenSpec, source, tests, generated artifacts, and Verify evidence remained authoritative |

## Independent judgment

The exact original `REVIEW-FINAL-B1-RETRY-LEDGER-INJECTION` path is repaired: caller-selected `retryLedgerDigests` is assertion-only, non-effect transitions cannot grow the ledger, `repair_effect_succeeded` and `repair_effect_failed` are the only growth events, each terminal event permits exactly one resolved record with matching record hash/outcome/predecessor convergence/projection, and authority parsing reconstructs and exact-compares the successor ledger. The supplied targeted and affected-area Verify evidence and current generated OpenCode/Pi bytes remain compatible with that exact repair.

The repair does **not** satisfy the delegated prior-bound obligation. `validateRetryAttemptRecordForLedgerAppend()` validates the supplied `priorAttemptDigest` only as digest-shaped data; it never derives `attemptNumber` and `priorAttemptDigest` from `predecessor.retryLedgerDigests`. The same incomplete helper is used by append and full authority replay.

The fresh adversarial probe built a legal typed chain to `repair_pending` with an empty predecessor ledger, then supplied a self-consistent attempt-1 `repair_effect_succeeded` record with an unrelated non-empty `priorAttemptDigest`. Both `appendExecutionConvergenceRevisionWithAuthorityV1()` and `parseExecutionConvergenceDossierWithAuthorityV1()` accepted it:

```json
{
  "predecessorLedgerLength": 0,
  "attemptNumber": 1,
  "detachedPriorAttemptDigest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
  "appendAccepted": true,
  "authorityParseAccepted": true
}
```

## Blocking finding

### REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT

- **Severity:** High.
- **Classification:** related implementation regression; blocking.
- **Requirements:** `REQ-DAVR-MD-03`, `REQ-DAVR-RG-01`, `REQ-DAVR-RG-05`, `REQ-DAVR-REG-03`, `REQ-DAVR-IEV-01`.
- **Accepted Design constraints:** `design.md:88-121` requires the current convergence ledger and complete records to be the sole attempt/prior authority and requires canonical event-derived append; `design-replan-g1.md:56-73` requires source-authoritative retry history and full predecessor replay.
- **Tasks:** `T-EA-02`, `T-EA-03`.
- **Locations:** `packages/sdd-runtime/src/contracts/execution-convergence.ts:939-999`, `packages/sdd-runtime/src/contracts/execution-convergence.ts:1188-1245`; downstream fail-closed validation remains in `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:405-536`.
- **Affected behavior:** a canonical convergence revision can credit malformed retry lineage. The downstream projection/effect boundary currently rejects this specific poisoned attempt-1 ledger, so the original unauthorized attempt-2 modifying effect is closed, but authoritative convergence evidence integrity and deterministic continuation remain invalid.
- **Required acceptance:** derive the next attempt number and prior link from predecessor ledger authority during both append and replay. An empty predecessor ledger must require attempt 1 with no prior digest; a non-empty ledger must require the next contiguous attempt and the exact authoritative last-attempt digest. Add direct append and authority-parser regression oracles for detached, missing, wrong, and reordered prior links.

## Historical compatibility judgment

| Finding group | Current judgment |
|---|---|
| `REVIEW-EA-G1-B1-POLICY-SNAPSHOT-EFFECT-AUTHORITY` | Resolved; this repair does not weaken batch-bound protected-risk authority. |
| `REVIEW-EA-G1-B2-RETRY-LEDGER-SOURCE-AUTHORITY` | Not fully closed because predecessor prior-link authority is not enforced. |
| `REVIEW-EA-G1-B3-CONVERGENCE-TYPED-REPLAY-AUTHORITY` | Not fully closed because full predecessor retry-lineage replay is incomplete. |
| Runner authority B1-B3 | No related regression found; transport stripping, trusted authority capture, malformed-evidence failure, and non-Apply zero-effect behavior remain covered. |
| Runner authority B4-B5 | No related regression found; mode taxonomy and missing receipt/provider handling remain fail-closed across both runners. |
| Runner authority B6 | No related regression found; single-read accessor/Proxy capture remains covered. |
| V1 compatibility and generated distributions | No key-set or identifier regression found. Bound generated digests remain OpenCode `301a23f4ac35f04065ff1dbd26afe8aa4cd4e220a12dbdc20fac5f86cea2ae9c` and Pi `8b80e42e00017198972c02fabcaa9c6e2fb6b405c2cc7f505dbe582a95853414`. |

## FailureManifestV1

```json
{
  "schema": "FailureManifestV1",
  "status": "open",
  "phase": "review-final-independent-rereview",
  "changeId": "deterministic-apply-verify-review-flow",
  "authorizedRepairBatch": "deterministic-apply-verify-review-flow-final-retry-ledger-injection-repair",
  "boundHead": "34aadacaf142270063eb445b9ed55e1157511a0d",
  "verifyArtifactSha256": "60eaf952d917a6107eb1dd821ec6449e5afeb7c83b8103c7118faf2c193676da",
  "failures": [
    {
      "findingId": "REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "high",
      "requirementIds": ["REQ-DAVR-MD-03", "REQ-DAVR-RG-01", "REQ-DAVR-RG-05", "REQ-DAVR-REG-03", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-EA-02", "T-EA-03"],
      "checkIds": ["review-final-independent-prior-link-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:939-999",
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:1188-1245",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:405-536"
      ],
      "destination": "targeted_repair",
      "owner": "apply-backend",
      "evidenceDigest": "sha256:cb85830adb42443c02f66bc3dbe356c29116374c8dad94deafa09b60544a9a17"
    }
  ],
  "resolvedHistoricalFailures": [
    {
      "findingId": "REVIEW-FINAL-B1-RETRY-LEDGER-INJECTION",
      "currentDisposition": "resolved_exact_acceptance_path"
    }
  ]
}
```

## Ordered RegistryIntentV1 values

```json
[]
```

The coordinator remains the sole registry writer. No lifecycle-advancing, broad-passed, review-passed, archive-ready, or source-modifying intent is emitted.

## Explicit blockers and next action

- **Blockers:** 1 — `REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT`.
- **Broad Verify:** not permitted while this Review blocker is open.
- **Archive:** not permitted.
- **Next action:** stop. A coordinator-authorized bounded repair may enforce predecessor-derived attempt/prior linkage and add the missing direct regression oracles. After modification, require fresh targeted and affected-area Verify, fresh independent Review, then broad Verify only if Review reports zero blockers.

---

# Final Independent Review After B2 Prior-Link Repair

This latest Review section supersedes only the prior decision and disposition state. All preceding Review findings, evidence, manifests, and immutable results remain preserved above as historical records.

## Immutable PhaseResult

| Field | Value |
|---|---|
| Role | `deck-developer-review` |
| Instance provenance | fresh independent final Review using `openai/gpt-5.6-sol`; distinct from the recorded Apply and Verify instances; no subagent judgment adopted |
| Change ID | `deterministic-apply-verify-review-flow` |
| Authorized repair scope | B2 predecessor prior-link repair after `REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT`, including current source, tests, and regenerated runner bundles |
| Authorized write | `openspec/changes/deterministic-apply-verify-review-flow/review-final.md` only |
| Bound implementation HEAD | `34aadacaf142270063eb445b9ed55e1157511a0d` with the uncommitted worktree digests below |
| Bound Verify dependency | targeted + affected-area **PASS**, `verify-final.md` SHA-256 `b7ac6ebc8110a7e8998106ee0749193884f8897e86ab559ae6c7b0f90dd872af` |
| Preserved prior Review artifact SHA-256 | `7b3e8e5276b159d3ea6e84f361e14e9e3684a73ab117e8623b5639abf0399a51` |
| Invocation digest | `sha256:b48d05d629830382a25ac76daf9fc9422e93163ca76b192029c4882eafc8be08` |
| Review batch binding digest | `sha256:f120aa3080b2af54b04b6ab52fc8519e69b2054b02004e833877250e8df4d869` |
| Review dossier binding digest | `sha256:619714ff583320f547e38ff93db75d1410bf8e8d690002e70af18701f2a90eaf` |
| Source/generated manifest digest | `sha256:cfa9b4f49ad9e1b366a6c0e527e0fac8dad71efc958eb8f922b9c1abe6b039ce` |
| Independent list/binding probe digest | `sha256:32fab060f2206d1b9409dd9b01e1528cb88f7e1e943029c43668c5f3e4531c10` |
| Independent cross-identity probe digest | `sha256:40d56a9b0e4ea97dede9c8e038e02a053356086ccdae0dc34e824e8eaa3cd04e` |
| Decision digest | `sha256:d9bb4749a41e78eeb34dac32b45334eccb3f309a2998a8d52e5ab7b752552141` |
| Verdict | **REQUEST_CHANGES** |
| Findings | **1 blocking related implementation regression**; 0 unrelated baseline defects; 0 required Spec/Design replans; 0 optional new-scope findings |
| Action | `stop_and_repair`; this Review authorizes no implementation or registry modification |
| Broad Verify permitted | **NO** |
| Archive permitted | **NO** |
| Adaptive context | loaded as advisory only; OpenSpec, current source/tests, generated provenance, Verify evidence, and independent probes remained authoritative |

**Verdict: REQUEST CHANGES.** The exact detached-prior defect is repaired for same-identity attempt 1 and later attempts, and the retry ledger remains fail-closed against injection, reordering, excess growth, multiple records per terminal transition, stale predecessor references, projection mismatch, convergence mismatch, and outcome mismatch. However, the repair derives the counter and prior link from the total ledger rather than the records for the current retry identity. This contradicts the accepted per-identity authority model and blocks every legal attempt 1 for a newly authorized retry identity after any prior identity has one ledger record.

## Current source and generated bindings

| File | SHA-256 | Classification |
|---|---|---|
| `packages/sdd-runtime/src/contracts/execution-convergence.ts` | `829b5fc145251150395e04c0e9b26bef9358584dc72622a2da677e8b5b10d6ce` | canonical source; differs from HEAD |
| `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | `c73c21fa8f926a5e71baa3900d651f3a1b26a50fa34c6191b6a989b65eaf63e3` | canonical test; differs from HEAD |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` | `acf1dc2139a0da991bb5a2ae7eac6d71cdaa55f75dedbe1af1ec99814295cf47` | canonical source; matches HEAD |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` | `e80d961a9bed93950ffb62094f1fa31c27d65dc71b420a6b24aa98cbaca9b511` | canonical test; differs from HEAD |
| `packages/sdd-runtime/src/execution/execution-control-plane.ts` | `f802d0c4fb827c477f0ad293d48ea3dd1ea489291a49ecb4e1439d189a655af2` | canonical source; matches HEAD |
| `packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.ts` | `5358c11ecfd783d3a36773d0835cd6fe4a687157f56dcac9b7377520a951547e` | canonical runner source; matches HEAD and generated header |
| `packages/adapter-opencode/assets/opencode/plugins/developer-team-execution.generated.js` | `d0dd80c9684e605b0c98a30587a6291f89b13dd4f0c974e365b37dbf18ecd0bb` | checked-in deterministic generated asset |
| `packages/adapter-pi/assets/pi/extensions/developer-team-execution.ts` | `51c1d5539897655c28a9ac78c78788a13964108e319bb54b9ae19997bd0953d6` | canonical runner source; matches HEAD and generated header |
| `packages/adapter-pi/assets/pi/extensions/developer-team-execution.generated.js` | `2f3675633a41903a1bf4e72ab63c91fea7dc45d772e424615c46ebff1eb834aa` | checked-in deterministic generated asset |

The five-file implementation delta is large (`1318` insertions, `177` deletions), but most volume is comprehensive contract tests and deterministic generated bundles. It adds no dependency or speculative abstraction. The volume is justified by the security-sensitive authority boundary, although the per-identity counter defect below remains blocking.

## Independent retry-ledger reproduction matrix

| Variant | Independent result | Authority path and consequence |
|---|---|---|
| Unexecuted digest injection on a non-effect event | **Rejected** | Append rejects caller-selected ledger growth; authority replay rejects a hand-crafted successor; attempt 2 construction and effect validation remain unreachable/denied. |
| Attempt 1 with detached non-empty `priorAttemptDigest` | **Rejected** | Both append and authority replay derive attempt 1 from an empty predecessor ledger and reject the detached prior. The historical B2 acceptance path is closed. |
| Later attempt with wrong prior | **Rejected** | Same-identity attempt 2 must bind to the predecessor ledger tail. |
| Later attempt with wrong/skipped number | **Rejected** | Same-identity attempt 2 accepts; attempt 3 against a one-record predecessor rejects. |
| Legal `repair_effect_succeeded` append | **Accepted and replayed** | Event-derived attempt record grows the list exactly once and transitions back to `targeted_pending`. |
| Legal `repair_effect_failed` append | **Accepted and replayed** | Event-derived attempt 1 without prior grows the list exactly once and transitions to `stopped`. |
| Caller list extra growth | **Rejected** | Exact derived-list equality rejects an additional unexecuted digest. |
| Existing-list reorder | **Rejected** | Exact order/prefix comparison rejects `[attempt2, attempt1]`; legal `[attempt1, attempt2]` is accepted and authority-parsed. |
| Multiple records in one terminal effect transition | **Rejected** | One terminal effect result permits at most one appended attempt record. |
| Projection binding mismatch | **Rejected** | Attempt record projection digest must equal the transition's effective repair projection digest. |
| Convergence/predecessor binding mismatch | **Rejected** | Attempt record revision/digest must equal the actual predecessor dossier head. |
| Effect outcome mismatch | **Rejected** | `terminalEffectResult` must equal the `repair_effect_succeeded` or `repair_effect_failed` event outcome. |
| New retry identity after an earlier identity's attempt | **Incorrectly rejected — blocking finding** | The new identity has zero records and therefore requires attempt 1/no prior, but append requires global attempt 2/prior to the other identity's tail. |

Fresh command evidence:

- Targeted B1/B2 tests: `6 pass / 0 fail / 31 expect() calls` across the convergence and projection contract files.
- Full convergence + projection tests: `47 pass / 0 fail / 182 expect() calls`.
- OpenCode/Pi runner authority reachability: `67 pass / 0 fail / 214 expect() calls`.
- Independent list/cardinality/order/binding probe: multiple records, projection mismatch, convergence mismatch, outcome mismatch, reorder, and excess growth all rejected; legal two-record same-identity growth and authority replay accepted.
- Independent cross-identity probe: predecessor ledger count `1`; a new identity's design-valid attempt `1` with no prior was rejected with `invalid-evidence: retry ledger`.

## Parser → attempt 2 → effect trace

1. `appendExecutionConvergenceRevisionWithAuthorityV1()` validates the structural predecessor, computes the transition, and delegates ledger derivation to `deriveRetryLedgerDigestsForTransition()`.
2. `deriveRetryLedgerDigestsForTransition()` permits no growth without a terminal repair-effect event, permits exactly one record for that event, and calls `validateRetryAttemptRecordForLedgerAppend()` before appending.
3. `parseExecutionConvergenceDossierWithAuthorityV1()` recomputes authority-record hashes, replays every transition receipt, enforces exact list prefix/order/cardinality, resolves only added retry digests, reruns the same ledger derivation, and exact-compares the successor list.
4. `validateRetryAttemptAgainstLedgerV1()` and `validateBlockingRepairProjectionAtEffectBoundaryV1()` independently recompute records/projections and validate attempt numbering and prior links **per retry identity** before a modifying effect is authorized.
5. For the historical unexecuted injection, step 3 rejects before attempt 2 can be built or accepted at step 4. For a legal same-identity attempt 2, all four layers converge. For a changed identity, step 2 requires global attempt 2 while step 4 requires per-identity attempt 1, so no record can satisfy both authorities.

## Blocking finding

### REVIEW-FINAL-B3-CROSS-IDENTITY-COUNTER-AUTHORITY — Convergence append uses global ledger length while projection/effect authority is per identity

- **Severity:** High.
- **Classification:** related implementation regression; blocking.
- **Root cause:** `validateRetryAttemptRecordForLedgerAppend()` computes `expectedAttemptNumber` as `predecessor.retryLedgerDigests.length + 1` and selects the global digest tail. It does not receive or resolve the predecessor's complete attempt records, so it cannot count records or select the prior record for `record.retryIdentity`. In contrast, `validateRetryAttemptAgainstLedgerV1()` explicitly filters `ledger.attemptRecords` by retry identity before deriving attempt number and prior.
- **Requirement anchors:** `REQ-DAVR-RG-01` requires one stable retry identity per blocking set and requires a changed blocking set/owner/target/obligation/oracle to create a new identity without counting progress on the old identity; `REQ-DAVR-MD-03` requires attempt and prior bindings to be recomputed against current authority.
- **Accepted Design anchors:** `design.md:102-106` requires a contiguous **per-identity** sequence; `design.md:401-405` states that attempt 1 is the first attempt for a newly authorized identity and requires zero records **for that identity**, while attempt N derives from the per-identity count and prior record. `design-replan-g1.md:56-65` makes complete attempt records, not a digest-only global count, the source of authority.
- **Task anchors:** `T-EA-02`; the current convergence replay implementation also consumes this contract under `T-EA-03`.
- **Locations:** `packages/sdd-runtime/src/contracts/execution-convergence.ts:939-983`; conflicting downstream authority is `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:498-534`.
- **Reproduction:** complete one legal `repair_effect_succeeded` attempt for identity A; return through `targeted_has_blockers` and `route_repair`; then submit attempt 1/no prior for newly authorized identity B. The predecessor ledger has one A record. Append rejects B with `invalid-evidence: retry ledger`, even though the accepted Design and downstream effect validator require attempt 1/no prior because B has zero records.
- **Affected behavior and acceptance impact:** after any identity-changing replan or changed blocking authority, deterministic repair cannot record the new identity's first terminal effect. Supplying attempt 2/prior A would satisfy convergence append but fail projection/effect authority; supplying attempt 1/no prior satisfies projection/effect authority but fails convergence append. The workflow deadlocks fail-closed and cannot converge legally.
- **Security impact:** no unauthorized modification was reproduced; the defect is fail-closed. It is still blocking because it violates explicit MUST-level identity/accounting semantics and breaks a required compatibility path.
- **Required acceptance:** derive counter/prior from authoritative predecessor attempt records for the current retry identity in both append and replay, while retaining exact digest-list prefix/order/cardinality and all projection/convergence/outcome bindings. Add a direct two-identity regression: A attempt 1 followed by B attempt 1/no prior must append and replay; B attempt 2, prior A, skipped B number, or wrong B prior must reject.

No Spec or Design replan is required: the accepted per-identity behavior is explicit. The repair remains bounded to implementation and direct regression coverage.

## Finding dispositions and architecture/security judgment

| Finding group | Latest disposition |
|---|---|
| `REVIEW-FINAL-B1-RETRY-LEDGER-INJECTION` | **Resolved.** Unexecuted caller-selected growth rejects at append, replay, projection construction, and effect. |
| `REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT` | **Resolved for the exact same-identity detached-prior path.** Attempt 1 cannot carry a prior; later same-identity attempts bind to the predecessor tail. |
| `REVIEW-FINAL-B3-CROSS-IDENTITY-COUNTER-AUTHORITY` | **Open, blocking.** Global convergence count conflicts with the authoritative per-identity projection/effect count. |
| `REVIEW-EA-G1-B1-POLICY-SNAPSHOT-EFFECT-AUTHORITY` | **Resolved; no regression.** Batch-bound protected-risk policy authority remains mandatory at parse and effect boundaries. |
| `REVIEW-EA-G1-B2-RETRY-LEDGER-SOURCE-AUTHORITY` | **Not fully closed.** Injection and same-identity lineage are closed, but complete predecessor attempt records are still not consumed to derive per-identity counter authority. |
| `REVIEW-EA-G1-B3-CONVERGENCE-TYPED-REPLAY-AUTHORITY` | **Resolved for security/replay integrity; no acceptance bypass reproduced.** Typed predecessor replay, list order/cardinality, outcome, projection, and convergence bindings remain fail-closed. Overall change advancement is still blocked by B3 cross-identity incompatibility. |
| Runner authority B1-B3 | **Resolved; no regression.** Caller transport stripping, trusted provider/resolver authority, initialization capture, malformed evidence failure, and non-Apply zero-effect behavior remain covered. |
| Runner authority B4-B5 | **Resolved; no regression.** Invalid mode taxonomy and missing receipt/provider classifications remain fail-closed and aligned across OpenCode and Pi. |
| Runner authority B6 | **Resolved; no regression.** Accessor/Proxy mode is captured once and invalid-first values cannot reach resolver, bridge, or effect. |
| Architecture | Event-derived append, authority replay, and downstream effect validation remain layered and fail-closed. The blocking defect is an inconsistent authority unit: global list versus per-identity record sequence. |
| Security | No new authorization bypass, record forgery, list injection, or outcome substitution was reproduced. Availability/convergence for changed identities is broken. |
| Scalability/performance | No new hot-path or unbounded-operation blocker. Ledger scans are bounded by retry governance; consuming complete records for per-identity derivation is architecturally appropriate. |
| Maintainability/compatibility | V1 serialized keys and runner source interfaces remain unchanged. Same-identity behavior is compatible; changed-identity repair is not. |

## FailureManifestV1

```json
{
  "schema": "FailureManifestV1",
  "status": "open",
  "phase": "review-final-post-b2-prior-link-repair",
  "changeId": "deterministic-apply-verify-review-flow",
  "authorizedRepairScope": "REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT",
  "boundHead": "34aadacaf142270063eb445b9ed55e1157511a0d",
  "verifyArtifactSha256": "b7ac6ebc8110a7e8998106ee0749193884f8897e86ab559ae6c7b0f90dd872af",
  "failures": [
    {
      "findingId": "REVIEW-FINAL-B3-CROSS-IDENTITY-COUNTER-AUTHORITY",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "high",
      "requirementIds": ["REQ-DAVR-RG-01", "REQ-DAVR-MD-03"],
      "taskIds": ["T-EA-02", "T-EA-03"],
      "checkIds": ["review-final-cross-identity-counter-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:939-983",
        "packages/sdd-runtime/src/contracts/blocking-repair-projection.ts:498-534",
        "openspec/changes/deterministic-apply-verify-review-flow/design.md:102-106",
        "openspec/changes/deterministic-apply-verify-review-flow/design.md:401-405"
      ],
      "destination": "targeted_repair",
      "owner": "apply-backend",
      "evidenceDigest": "sha256:40d56a9b0e4ea97dede9c8e038e02a053356086ccdae0dc34e824e8eaa3cd04e"
    }
  ],
  "resolvedHistoricalFailures": [
    {
      "findingId": "REVIEW-FINAL-B1-RETRY-LEDGER-INJECTION",
      "currentDisposition": "resolved"
    },
    {
      "findingId": "REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT",
      "currentDisposition": "resolved_exact_same_identity_path"
    }
  ]
}
```

## Ordered RegistryIntentV1 values

```json
[]
```

The coordinator remains the sole registry writer. This failing Review emits no `review.passed`, `broad.passed`, `archive.ready`, or source-modifying intent.

## Explicit blockers and next action

- **Blockers:** 1 — `REVIEW-FINAL-B3-CROSS-IDENTITY-COUNTER-AUTHORITY`.
- **Broad Verify permission:** **NO**. Broad remains stale/not run and must not begin while this Review blocker is open.
- **Archive permission:** **NO**.
- **Next action:** stop. A coordinator-authorized bounded implementation repair may align convergence append/replay with the accepted per-identity attempt authority and add the direct two-identity oracle. Then require fresh targeted and affected-area Verify, a fresh independent Review, and only after Review passes permit broad Verify.

---

# Fresh Final Independent Review After Complete B3 Repair

This append-only section is the latest Review judgment. It preserves every preceding Review result, finding, manifest, and evidence binding as immutable history and supersedes only their advancement decision.

## Immutable PhaseResult

| Field | Value |
|---|---|
| Role | `deck-developer-review` |
| Instance provenance | fresh independent Review using `openai/gpt-5.6-sol`; distinct from the recorded Apply and Verify instances; no subagent judgment adopted |
| Change ID | `deterministic-apply-verify-review-flow` |
| Authorized review scope | complete retry-ledger repair through B3, full EA B1-B3 reassessment, runner-authority B1-B6 regression reassessment, architecture, security, scalability, maintainability, and compatibility |
| Authorized write | `openspec/changes/deterministic-apply-verify-review-flow/review-final.md` only |
| Bound implementation HEAD | `34aadacaf142270063eb445b9ed55e1157511a0d` with the uncommitted worktree digests below |
| Bound Verify dependency | targeted + affected-area **PASS**, `verify-final.md` SHA-256 `c6e5d6857131b88ede8d8fd033eb64c6550095019fc7ec746c0002535e60e60c` |
| Preserved prior Review artifact SHA-256 | `8e42d98f86cb8610f22656b63a6271ca07d250e003f779621cd2467764cf1757` |
| Invocation digest | `sha256:5732935b60aac9e0d793ac1fdbaebb91ee15356f5e90775501da9320649957c5` |
| Review batch binding digest | `sha256:41d3bb792eb609526aa2957b26369adab3cf650067323a6e23d3621b74ee8c47` |
| Review dossier binding digest | `sha256:c53473a1bfba96bc88af815dbf14a743f6689e38d0cde402d329634f2a875cf8` |
| Independent evidence digest | `sha256:fbf23643c2f6d96b596092f8e2b863ea64f02b92a4e0b044d8f3389a7d7f3cba` |
| Decision digest | `sha256:2760c529aac9885a30788a755435a5f94a12d58a67923ea5c20f1cc09ff51d76` |
| Verdict | **REQUEST_CHANGES** |
| Findings | **1 blocking related implementation regression**; 0 unrelated baseline defects; 0 required Spec/Design replans; 0 optional new-scope findings |
| Action | `stop_and_repair`; this Review authorizes no implementation or registry modification |
| Broad Verify permitted | **NO** |
| Archive permitted | **NO** |
| Adaptive context | loaded as advisory only; OpenSpec artifacts, current source/tests, generated provenance, bound Verify evidence, and independent probes remained authoritative |

**Verdict: REQUEST CHANGES.** The B3 per-identity repair is correct for supplied records: A1 followed by B1/no-prior now appends and replays, cross-identity prior borrowing rejects, and complete predecessor carriers are required for growth. The implementation nevertheless accepts both terminal repair-effect events with **zero** attempt records, preserves the predecessor retry ledger, and authority-replays the resulting revision. This omission permits a completed modifying attempt to disappear from per-identity accounting and leaves later projection/effect validation deriving the same attempt number from an incomplete authoritative ledger.

## Current source, test, generated, and Verify bindings

| Subject | SHA-256 | Review disposition |
|---|---|---|
| `packages/sdd-runtime/src/contracts/execution-convergence.ts` | `a7c644516ac46d28eb85e558c502f30e3cc9b281bf434f0069fd687f80ef3392` | reviewed current source |
| `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | `4a9ddfa7ff6ec97f06a395d6f5300b2b220cb8d43947dca7e9703d9ffaccc041` | reviewed current test |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` | `e80d961a9bed93950ffb62094f1fa31c27d65dc71b420a6b24aa98cbaca9b511` | reviewed affected test |
| OpenCode generated standalone asset | `99a0b91261ddeb0ca958211b47e08de99c0de3bd56fcc84f0afb79b70974afa8` | bound; header source digest `5358c11ecfd783d3a36773d0835cd6fe4a687157f56dcac9b7377520a951547e` |
| Pi generated standalone asset | `932473894bd4d89dadb644314e11fcb3d5f536d48b75073f4cc544cecf24bca0` | bound; header source digest `51c1d5539897655c28a9ac78c78788a13964108e319bb54b9ae19997bd0953d6` |
| `verify-final.md` | `c6e5d6857131b88ede8d8fd033eb64c6550095019fc7ec746c0002535e60e60c` | dependency accepted for targeted/affected evidence; broad intentionally absent |

Fresh focused evidence passed `48/48` convergence/projection tests with `192` assertions and `67/67` OpenCode/Pi runner-authority tests with `214` assertions. These green suites do not contain the zero-record terminal-event oracle below. No broad suite was run by Review because broad remains gated on a passing Review.

## Blocking finding

### REVIEW-FINAL-B4-MISSING-TERMINAL-ATTEMPT-RECORD — Terminal repair-effect events replay without recording the completed attempt

- **Severity:** High.
- **Classification:** related implementation regression; blocking.
- **Requirement anchors:** `REQ-DAVR-RG-01`, `REQ-DAVR-RG-02`, `REQ-DAVR-RG-03`, `REQ-DAVR-MD-03`, `REQ-DAVR-REG-03`, and `REQ-DAVR-IEV-01`.
- **Task anchors:** `T-EA-02` and `T-EA-03`.
- **Accepted Design anchors:** `design.md:102-109` makes complete retry-attempt records the sole per-identity counter/prior authority and states that an attempt record is appended after an authorized modifying invocation obtains a terminal result; `design.md:113-123` requires canonical event-derived records and full replay; `design-replan-g1.md:56-73` requires source-authoritative retry history and full predecessor replay.
- **Locations:** `packages/sdd-runtime/src/contracts/execution-convergence.ts:1034-1056` and `packages/sdd-runtime/src/contracts/execution-convergence.ts:1283-1324`.
- **Root cause:** `deriveRetryLedgerDigestsForTransition()` returns the predecessor list immediately whenever `attemptRecords.length === 0`, before determining whether the event is `repair_effect_succeeded` or `repair_effect_failed`. It therefore enforces “at most one” record but not the required **exactly one** record for a terminal effect. The authority parser calls the same helper and exact-compares the unchanged list, reproducing rather than rejecting the omission.
- **Independent reproduction:** build a legal typed chain to `repair_pending` with an empty ledger, then append each terminal event with valid stage/result/receipt authority, a repair projection digest, `retryAttemptRecords: []`, and `retryLedgerDigests: []`. Observed results:

```json
[
  {
    "event": "repair_effect_succeeded",
    "appendAccepted": true,
    "authorityParseAccepted": true,
    "successorLifecycle": "targeted_pending",
    "successorRetryLedgerLength": 0
  },
  {
    "event": "repair_effect_failed",
    "appendAccepted": true,
    "authorityParseAccepted": true,
    "successorLifecycle": "stopped",
    "successorRetryLedgerLength": 0
  }
]
```

- **Parser → attempt/effect impact:** `parseExecutionConvergenceDossierWithAuthorityV1()` accepts the succeeded revision as authoritative while its ledger still contains zero records. `buildBlockingRepairProjectionV1()`, `parseBlockingRepairProjectionV1()`, and `validateBlockingRepairProjectionAtEffectBoundaryV1()` all derive the next attempt from that accepted list through `validateRetryAttemptAgainstLedgerV1()`. The omitted terminal attempt is therefore invisible to attempt numbering, prior linkage, progress, and hard per-identity retry limits; a later modifying projection can again present attempt 1 instead of being counted after the completed attempt.
- **Security and acceptance impact:** this is a fail-open accounting boundary. An authorized modifying result can be persisted without consuming retry budget or becoming prior-attempt authority, allowing silent continuation where `REQ-DAVR-RG-03` requires exhaustion to stop/escalate and undermining deterministic audit lineage. The failed-event path also loses terminal audit evidence even though it cannot continue directly from `stopped`.
- **Required acceptance:** terminal `repair_effect_succeeded` and `repair_effect_failed` transitions must require exactly one complete event-matching attempt record; zero, duplicate, or multiple records must fail at append and full authority replay. Preserve current B1 injection rejection, B2 same-identity lineage, B3 cross-identity semantics, exact predecessor-record resolution, order/cardinality, projection/convergence/outcome binding, and succeeded/failed legal paths. Add a direct zero-record append/replay regression and prove that a succeeded terminal event advances the next same-identity attempt to N+1 with the exact prior digest.

No Spec or Design replan is required. Existing MUST requirements and accepted Design already define the missing cardinality boundary.

## Full reassessment and historical finding dispositions

| Finding group / area | Latest disposition |
|---|---|
| `REVIEW-FINAL-B1-RETRY-LEDGER-INJECTION` | **Resolved.** Caller-selected digest growth, non-effect record injection, reordered/excess growth, and unresolved additions reject. |
| `REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT` | **Resolved.** Attempt 1 omits prior; later attempts bind to the preceding same-identity record. |
| `REVIEW-FINAL-B3-CROSS-IDENTITY-COUNTER-AUTHORITY` | **Resolved.** Complete predecessor records are resolved and counters/prior links are derived per identity; legal A1 → B1/no-prior appends and replays, while B2/prior-A, skipped B number, and wrong B prior reject. |
| `REVIEW-EA-G1-B1-POLICY-SNAPSHOT-EFFECT-AUTHORITY` | **Resolved; no regression.** Batch-bound protected-risk authority remains mandatory at parse and effect boundaries. |
| `REVIEW-EA-G1-B2-RETRY-LEDGER-SOURCE-AUTHORITY` | **Reopened only for the B4 omission path.** Injected, missing predecessor, duplicate predecessor, extra predecessor, unresolved predecessor, digest-mismatched, wrong-order, and cross-identity records fail as reviewed; a terminal event can still omit its new required record entirely. |
| `REVIEW-EA-G1-B3-CONVERGENCE-TYPED-REPLAY-AUTHORITY` | **Not fully closed because of B4.** State, event/outcome, predecessor convergence, projection, exact list order/cardinality for supplied additions, and succeeded/failed replay are coherent, but replay accepts terminal effect cardinality zero. |
| Runner authority B1-B3 | **Resolved; no regression.** Caller transport is stripped, resolver/provider authority is initialization-captured, malformed evidence fails closed, and non-Apply paths perform zero resolver/bridge/effect calls. |
| Runner authority B4-B5 | **Resolved; no regression.** Invalid mode values fail closed, `AUTHZ_MISSING` remains reserved for absent resolver authority, and missing/malformed receipt evidence remains `invalid-evidence` with OpenCode/Pi semantic parity. |
| Runner authority B6 | **Resolved; no regression.** Accessor/Proxy-selected mode is read once; invalid-first values cannot reach resolver, bridge, or effect. |
| Architecture | **FAIL at one cardinality invariant.** Event-derived append plus shared append/replay derivation is the correct architecture, but the shared helper encodes optional rather than mandatory terminal accounting. |
| Security | **FAIL.** B1 injection and B2/B3 lineage defects are closed, but omission of a completed attempt permits retry-budget and lineage evasion. |
| Maintainability | **PASS with localized risk.** The repair is cohesive and dependency-free; one early return contradicts the helper's terminal-event responsibility and should be guarded by a direct invariant oracle. |
| Compatibility | **PASS in reviewed scope.** V1 serialized dossier/projection keys and IDs remain unchanged; authority records are additive. Requiring one record for terminal events tightens invalid evidence without changing established serialized shapes. |
| Scalability/performance | **PASS.** Record indexing, predecessor resolution, and per-identity filtering are linear in bounded retry history; no new I/O or unbounded concurrency is introduced. |
| Generated provenance | **PASS.** Final generated digests match the bound Verify evidence and carry the expected canonical source hashes. |

## FailureManifestV1

```json
{
  "schema": "FailureManifestV1",
  "status": "open",
  "phase": "review-final-complete-retry-ledger-repair",
  "changeId": "deterministic-apply-verify-review-flow",
  "authorizedRepairScope": "REVIEW-FINAL-B3-PER-IDENTITY-COUNTER-AUTHORITY",
  "boundHead": "34aadacaf142270063eb445b9ed55e1157511a0d",
  "verifyArtifactSha256": "c6e5d6857131b88ede8d8fd033eb64c6550095019fc7ec746c0002535e60e60c",
  "failures": [
    {
      "findingId": "REVIEW-FINAL-B4-MISSING-TERMINAL-ATTEMPT-RECORD",
      "status": "open",
      "relationship": "batch_related",
      "rootCause": "implementation",
      "disposition": "blocking",
      "severity": "high",
      "requirementIds": ["REQ-DAVR-RG-01", "REQ-DAVR-RG-02", "REQ-DAVR-RG-03", "REQ-DAVR-MD-03", "REQ-DAVR-REG-03", "REQ-DAVR-IEV-01"],
      "taskIds": ["T-EA-02", "T-EA-03"],
      "checkIds": ["review-final-zero-record-terminal-effect-probe"],
      "locationKeys": [
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:1034-1056",
        "packages/sdd-runtime/src/contracts/execution-convergence.ts:1283-1324"
      ],
      "destination": "targeted_repair",
      "owner": "apply-backend",
      "evidenceDigest": "sha256:fbf23643c2f6d96b596092f8e2b863ea64f02b92a4e0b044d8f3389a7d7f3cba"
    }
  ],
  "resolvedHistoricalFailures": [
    { "findingId": "REVIEW-FINAL-B1-RETRY-LEDGER-INJECTION", "currentDisposition": "resolved" },
    { "findingId": "REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT", "currentDisposition": "resolved" },
    { "findingId": "REVIEW-FINAL-B3-CROSS-IDENTITY-COUNTER-AUTHORITY", "currentDisposition": "resolved" }
  ]
}
```

## Ordered RegistryIntentV1 values

```json
[]
```

No `review.passed`, `broad.passed`, `archive.ready`, lifecycle-advancing, or source-modifying intent is emitted. The coordinator remains the sole registry writer.

## Explicit blockers and next action

- **Blockers:** 1 — `REVIEW-FINAL-B4-MISSING-TERMINAL-ATTEMPT-RECORD`.
- **Broad Verify permission:** **NO**. Broad remains intentionally pending and may run only after a fresh independent Review reports no blockers.
- **Archive permission:** **NO**.
- **Exact next action:** stop lifecycle advancement. A coordinator-authorized bounded implementation repair may require exactly one attempt record for each terminal repair-effect event and add append/replay/next-attempt oracles. After modification, require fresh targeted and affected-area Verify, then a fresh independent Review of the complete retry-ledger boundary; permit mandatory broad Verify only if that Review passes.

---

# Fresh Final Independent Review After B4 Terminal-Cardinality Repair

This append-only section is the latest Review judgment. Every preceding Review result, finding, FailureManifestV1, and evidence binding remains unchanged as immutable history. This section supersedes only the prior advancement decision.

## Immutable PhaseResult

| Field | Value |
|---|---|
| Role | `deck-developer-review` |
| Instance provenance | fresh independent final Review using `openai/gpt-5.6-sol`; distinct from the recorded Apply and final Verify instances; no subagent judgment adopted |
| Change ID | `deterministic-apply-verify-review-flow` |
| Authorized review scope | B4 terminal-cardinality repair; exhaustive retry-ledger transition matrix; complete EA B1-B3, runner-authority B1-B6, security, architecture, scalability, maintainability, and compatibility reassessment |
| Authorized write | `openspec/changes/deterministic-apply-verify-review-flow/review-final.md` only |
| Bound implementation HEAD | `34aadacaf142270063eb445b9ed55e1157511a0d` with the uncommitted worktree digests below |
| Bound final Verify dependency | targeted + affected-area **PASS**, `verify-final.md` SHA-256 `5023a7e485ae7cb58b74290eccf015c6c1ef9cf980fda12420c607ad2fe84121` |
| Preserved prior Review artifact SHA-256 | `dedcd03ec705be34d4b480412f41a3bbdbd6b8f923b9139bf20aedf5cab5f0e4` |
| Invocation digest | `sha256:35a9b92ab9c37baebb2c1bb17c4fcf321467204b9a5d47b95b5c1927ab6ed1e2` |
| Review batch binding digest | `sha256:f762394fe1feb2e9906b5e8e85ab4e47246f37e37a47c545f9648d36866e8584` |
| Review dossier binding digest | `sha256:3fb9a992a28d0273dacb8f583a33a55a122d9269d4b9e00ef0d21615f32de2c5` |
| Independent evidence digest | `sha256:8a6fdede6343fb566aa6e3bedebc3f399549bf31b5e9981b5c8c9d8497d445f0` |
| Decision digest | `sha256:59317a27650a16c8fb89ede2c7f8df312756beaf61dbe705d7f6383e8a1f95fd` |
| Verdict | **PASS** |
| Findings | **0 blocking findings**; 0 related regressions; 0 unrelated baseline defects; 0 required Spec/Design replans; 0 optional new-scope findings |
| Action | `permit_broad_verify`; this Review authorizes no source, test, generated, registry, state, event, or commit modification |
| Broad Verify permitted | **YES** |
| Archive permitted | **NO — broad Verify remains mandatory and fresh broad evidence is not yet bound** |
| Adaptive context | loaded as advisory only; OpenSpec, source, tests, generated provenance, final Verify, and independent evidence remained authoritative |

**Verdict: PASS with zero blockers.** B4 closes the terminal zero-record omission: each `repair_effect_succeeded` or `repair_effect_failed` transition now requires exactly one complete event-matching retry-attempt record, while every other typed event permits zero retry-ledger growth only. Append and full authority replay use the same derivation. B1 injection, B2 same-identity lineage, B3 per-identity/cross-identity authority, downstream attempt/effect consumption, EA B1-B3, and runner B1-B6 remain closed. Fresh broad Verify is now permitted, but Archive remains blocked until that broad stage passes.

## Authoritative dependency and worktree bindings

| Subject | SHA-256 | Review disposition |
|---|---|---|
| Proposal | `2b3c63a2bceaa06a8449c68d7ac080eee5724793a4060a9e5c4380a8a01e1ba1` | authoritative intent |
| Spec | `374a8fb1a155830624083829aa8ccbbe609032e6a1b4c8064169372b4bfb8d7f` | authoritative requirements |
| Design | `9850e208e6f364232c4418481e6cc99eb063a68a1afdf77db52ae703ca2e9bc1` | accepted architecture |
| Tasks | `d33fdea4c9cb9113a7ad0945c8cc4cc14ece24c1cd1b08308340ed96995a6cfe` | authoritative task obligations |
| Effect-authority Tasks replan | `1e2d51e7e559af5c7aef45723f5060dd64fa5a3c7903e10c12dc1873981837b0` | EA B1-B3 obligations |
| `packages/sdd-runtime/src/contracts/execution-convergence.ts` | `c624399d0c9357862ed150df558ab6ab4b684d84fa82b4f5e7e63749e888d577` | reviewed current source |
| `packages/sdd-runtime/src/contracts/execution-convergence.test.ts` | `970c3116a712b250cda093a63c522715de03c53cd46e5801ddfbea8626ac7a90` | reviewed current test |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.ts` | `acf1dc2139a0da991bb5a2ae7eac6d71cdaa55f75dedbe1af1ec99814295cf47` | reviewed attempt/effect consumer |
| `packages/sdd-runtime/src/contracts/blocking-repair-projection.test.ts` | `e80d961a9bed93950ffb62094f1fa31c27d65dc71b420a6b24aa98cbaca9b511` | reviewed consumer regressions |
| OpenCode generated standalone asset | `b8f7601bded7271568f70a498858a813161b1b8ae8b645afef12c6682dd2b47a` | final Verify proves byte-identical regeneration |
| Pi generated standalone asset | `5af2085a3196ff58572035ee2e8d2113ab2c034189d83f9d227cc73b1eb8123a` | final Verify proves byte-identical regeneration |
| Final Verify artifact | `5023a7e485ae7cb58b74290eccf015c6c1ef9cf980fda12420c607ad2fe84121` | accepted targeted/affected dependency; broad intentionally absent |

The worktree delta remains the authorized runtime source/test repair plus synchronized generated assets and change-local Verify/Review artifacts. This Review modified no implementation, test, generated asset, shared YAML, or registry state.

## Exhaustive typed-event × retry-ledger growth judgment

The `ConvergenceTransitionEventV1` union and runtime `EVENTS` list contain the same 27 unique values. `retryLedgerOutcomeForEvent()` classifies exactly two as terminal retry effects. The shared append/replay derivation therefore covers the complete type space without a default growth path.

| Typed event | Growth 0 | Growth 1 | Growth >1 |
|---|---:|---:|---:|
| `apply_result_accepted` | accept only when the state/evidence transition is otherwise legal; preserve ledger | reject | reject |
| `apply_result_invalid` | accept only when otherwise legal; preserve ledger | reject | reject |
| `targeted_accepted_no_blockers` | accept only when otherwise legal; preserve ledger | reject | reject |
| `targeted_has_blockers` | accept only when otherwise legal; preserve ledger | reject | reject |
| `targeted_failed` | accept only when otherwise legal; preserve ledger | reject | reject |
| `affected_accepted_no_blockers` | accept only when otherwise legal; preserve ledger | reject | reject |
| `affected_has_blockers` | accept only when otherwise legal; preserve ledger | reject | reject |
| `affected_stale` | accept only when otherwise legal; preserve ledger | reject | reject |
| `review_stable` | accept only when otherwise legal; preserve ledger | reject | reject |
| `review_has_blockers` | accept only when otherwise legal; preserve ledger | reject | reject |
| `review_inconsistent` | accept only when otherwise legal; preserve ledger | reject | reject |
| `broad_accepted` | accept only when otherwise legal; preserve ledger | reject | reject |
| `broad_has_blockers` | accept only when otherwise legal; preserve ledger | reject | reject |
| `broad_stale` | accept only when otherwise legal; preserve ledger | reject | reject |
| `registry_committed` | accept only when otherwise legal; preserve ledger | reject | reject |
| `registry_conflict` | accept only when otherwise legal; preserve ledger | reject | reject |
| `registry_recovery_required` | accept only when otherwise legal; preserve ledger | reject | reject |
| `route_repair` | accept only when otherwise legal; preserve ledger | reject | reject |
| `route_diagnosis` | accept only when otherwise legal; preserve ledger | reject | reject |
| `route_replan` | accept only when otherwise legal; preserve ledger | reject | reject |
| `route_escalate` | accept only when otherwise legal; preserve ledger | reject | reject |
| `route_stop` | accept only when otherwise legal; preserve ledger | reject | reject |
| `repair_effect_succeeded` | **reject** | **accept only one complete record with `terminalEffectResult: succeeded` and all bindings valid** | **reject** |
| `repair_effect_failed` | **reject** | **accept only one complete record with `terminalEffectResult: failed` and all bindings valid** | **reject** |
| `diagnosis_resolved` | accept only when otherwise legal; preserve ledger | reject | reject |
| `diagnosis_exhausted` | accept only when otherwise legal; preserve ledger | reject | reject |
| `dependencies_invalidated` | accept only when otherwise legal; preserve ledger | reject | reject |

For all 25 non-terminal classes, `attemptRecords.length !== 0` rejects before predecessor-record resolution, and the derived successor list is the exact predecessor list. A supplied caller assertion list is then exact-compared, so assertion-only growth of one or more digests also rejects. For both terminal classes, `attemptRecords.length !== 1` rejects zero and multiple records before append; a valid single record grows the ledger exactly once. Authority replay slices actual successor growth, resolves every new digest, invokes the same derivation, and exact-compares the complete successor list. Hand-crafted growth cannot bypass append rules.

## Retry-attempt authority matrix

| Boundary / variant | Judgment | Evidence and consequence |
|---|---:|---|
| Empty predecessor ledger; attempt 1; no prior | **Accept** | legal succeeded and failed paths append and authority-replay exactly one record |
| Empty predecessor ledger; detached/non-empty prior | **Reject** | B2 append and replay oracles remain green |
| Non-empty same-identity ledger; contiguous N and exact prior | **Accept** | legal attempt 2 appends/replays and advances later consumption to N+1 |
| Non-empty same-identity ledger; missing/wrong prior, duplicate/skipped number | **Reject** | per-identity filter derives the only valid number and prior record |
| Cross identity A1 → B1/no prior | **Accept** | B has zero matching predecessor records; global A history is not counted as B progress |
| Cross identity B2/prior-A, skipped B number, or B1/prior-A | **Reject** | cross-identity borrowing cannot satisfy per-identity authority |
| Complete predecessor carriers | **Accept** | every ledger digest resolves to one recomputed record |
| Missing, duplicate, extra, or digest-mismatched predecessor carrier | **Reject** | independent probe rejected all four classes |
| Carrier-array permutation with the same unique complete digest set | **Accept and canonicalize** | the carrier is a resolver set; the authoritative `retryLedgerDigests` sequence determines output order. Independent `[A2,A1]` input resolved to canonical `[A1,A2]` without changing ledger semantics |
| Persisted predecessor/successor ledger reorder, truncation, replacement, duplicate, or excess growth | **Reject** | prefix/order/cardinality and exact-list comparisons are positional |
| Record digest mismatch | **Reject** | record payload is rehashed at append and authority indexing |
| Outcome mismatch (`failed` record on succeeded event or inverse) | **Reject** | event-derived expected outcome is exact-compared |
| `rejected` terminal result | **Reject** | neither permitted terminal event derives that outcome |
| Stale/detached projection digest | **Reject** | appended record must equal the transition's effective repair-projection digest; downstream ledger consumption also resolves and rehashes the complete projection |
| Stale/detached convergence revision or digest | **Reject** | appended record must bind the immediate predecessor revision/digest; downstream consumption resolves the referenced dossier and current head |
| Caller assertion omitted | **Accept derived result** | caller list is optional and is not a growth source |
| Caller assertion exact | **Accept** | exact derived-list equality only |
| Caller assertion missing, reordered, replaced, or extra | **Reject** | `assertExactDigestList()` is positional and cardinality-sensitive |

The carrier-set/order distinction is deliberate in this judgment: complete records are content-addressed lookup material, while `retryLedgerDigests` is the canonical ordered authority. Reordering the canonical digest list is invalid and rejects; changing only lookup-carrier presentation order is semantically equivalent and cannot change counters, priors, parser output, or effect authority.

## Parser replay and attempt/effect consumption

1. `appendExecutionConvergenceRevisionWithAuthorityV1()` structurally validates the exact predecessor/history, computes the legal state transition, derives retry growth from the typed event and complete records, exact-checks any caller assertion list, and serializes only the computed successor.
2. `parseExecutionConvergenceDossierWithAuthorityV1()` indexes rehashed typed records, requires one receipt per transition, replays every revision from canonical revision 1, validates role/invalidation append order, resolves all predecessor and newly added retry records by canonical digest order, reruns the same ledger derivation, and exact-compares each persisted successor list.
3. `validateRetryAttemptAgainstLedgerV1()` first requires authority replay of the current dossier, exact current ledger equality, one recomputed record per digest, unique records, content-addressed projection resolution, valid historical convergence references, and contiguous per-identity prior links.
4. `parseBlockingRepairProjectionV1()` and `validateBlockingRepairProjectionAtEffectBoundaryV1()` recompute identity and attempt/prior authority against that parsed current ledger. Stale convergence, forged identity, injected/unexecuted history, missing projection records, detached prior links, and exhausted/incorrect counters fail closed before effect acceptance.

The historical B1 injection sequence now stops at authority replay; attempt 2 cannot be built and effect validation returns non-acceptance. The historical B4 omission sequence now stops at append and replay for both terminal outcomes. Legal succeeded and failed paths remain accepted and consumed.

## Fresh independent evidence

| Check | Result |
|---|---|
| Static exhaustive event/type inventory | **PASS** — 27 typed events, 27 runtime events, exact order/parity, no duplicates; 2 terminal and 25 non-terminal classes |
| Focused B1-B4 retry-ledger run | **PASS** — 7 pass / 0 fail / 46 assertions |
| Full convergence + projection contracts | **PASS** — 49 pass / 0 fail / 201 assertions |
| Parser/attempt/effect security probes | **PASS** — 9 pass / 0 fail / 22 assertions |
| OpenCode/Pi runner-authority regressions | **PASS** — 67 pass / 0 fail / 214 assertions |
| TypeScript `--noEmit` | **PASS** — exit 0, empty diagnostics |
| Predecessor carrier probe | exact and resolver-set-permuted complete carriers accepted; missing, duplicate, extra, and digest-mismatched carriers rejected |
| Final Verify affected suites | **PASS** — contracts 267/0, execution/orchestrator 290/0, runner 67/0, typecheck, and byte-identical generated parity |

No broad suite was run by Review. The previous broad evidence is correctly stale after B4, and the purpose of this passing Review is to permit the coordinator to start a fresh mandatory broad Verify.

## Whole-change engineering-quality reassessment

| Area | Final judgment |
|---|---|
| Correctness | **PASS.** Valid terminal and non-terminal paths are accepted; invalid growth, outcome, lineage, binding, replay, and consumer paths reject. |
| EA B1 — protected-risk policy authority | **PASS.** Batch-bound policy authority remains mandatory and independently rederived at parse/routing/projection/effect boundaries. |
| EA B2 — retry identity/ledger authority | **PASS.** Identity, complete ledger, record hashes, per-identity counters, priors, projection references, and convergence references remain authoritative. |
| EA B3 — typed convergence replay | **PASS.** Every revision is receipt/typed-record resolved and replayed; canonical persisted list order/cardinality and state equality remain fail-closed. |
| Architecture | **PASS.** One event-derived retry-ledger helper is shared by append and replay; downstream projection/effect validation independently consumes the fully replayed ledger. No new dependency or speculative abstraction was added. |
| Security | **PASS.** No caller-selected growth, retry-budget omission, cross-identity borrowing, forged history, stale authority, outcome substitution, or modifying-effect bypass remains reproducible. |
| Runner authority B1-B3 | **PASS.** Untrusted transport stripping, trusted provider-only authority, initialization capture, malformed evidence denial, and non-Apply zero-effect behavior remain intact. |
| Runner authority B4-B5 | **PASS.** Invalid modes fail closed; `AUTHZ_MISSING` remains limited to absent resolver authority; malformed receipt evidence remains `invalid-evidence` with Pi/OpenCode parity. |
| Runner authority B6 | **PASS.** Accessor/Proxy mode selection remains single-read and invalid-first values reach neither resolver, bridge, nor effect. |
| Compatibility | **PASS.** Existing V1 dossier/projection serialized keys, IDs, and structural readers remain unchanged; authority records and inputs are additive. Generated OpenCode/Pi assets are bound to exact byte-parity evidence. |
| Maintainability | **PASS.** The security-sensitive delta is large primarily because of direct regression coverage and generated bundles; the shared derivation removes the prior append/replay invariant split. |
| Scalability/performance | **PASS in reviewed scope.** Record indexing/resolution and per-identity scans operate over governance-bounded retry history; no I/O, network, unbounded concurrency, or new dependency path was introduced. Full replay may revisit bounded history but presents no measured or acceptance-level performance risk. |

## Historical finding disposition

| Finding | Latest disposition |
|---|---|
| `REVIEW-FINAL-B1-RETRY-LEDGER-INJECTION` | **Resolved.** Non-terminal caller growth and hand-crafted replay injection reject before attempt/effect consumption. |
| `REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT` | **Resolved.** Attempt 1 has no prior; attempt N binds the preceding same-identity record. |
| `REVIEW-FINAL-B3-CROSS-IDENTITY-COUNTER-AUTHORITY` | **Resolved.** Counters/priors derive per identity from complete predecessor records. |
| `REVIEW-FINAL-B4-MISSING-TERMINAL-ATTEMPT-RECORD` | **Resolved.** Both terminal outcomes require exactly one complete attempt record at append and replay. |
| `REVIEW-EA-G1-B1-POLICY-SNAPSHOT-EFFECT-AUTHORITY` | **Resolved; no regression.** |
| `REVIEW-EA-G1-B2-RETRY-LEDGER-SOURCE-AUTHORITY` | **Resolved.** Event-derived append, complete records, canonical ledger order, and consumer replay now form one closed authority chain. |
| `REVIEW-EA-G1-B3-CONVERGENCE-TYPED-REPLAY-AUTHORITY` | **Resolved.** Retry additions now participate in the same full predecessor replay as stage/invalidation authority. |
| Runner-authority B1-B6 findings | **Resolved; no regression.** |

## FailureManifestV1

```json
{
  "schema": "FailureManifestV1",
  "status": "resolved",
  "phase": "review-final-post-b4-terminal-cardinality-repair",
  "changeId": "deterministic-apply-verify-review-flow",
  "authorizedRepairScope": "REVIEW-FINAL-B4-TERMINAL-ATTEMPT-CARDINALITY",
  "boundHead": "34aadacaf142270063eb445b9ed55e1157511a0d",
  "verifyArtifactSha256": "5023a7e485ae7cb58b74290eccf015c6c1ef9cf980fda12420c607ad2fe84121",
  "failures": [],
  "resolvedHistoricalFailures": [
    { "findingId": "REVIEW-FINAL-B1-RETRY-LEDGER-INJECTION", "currentDisposition": "resolved" },
    { "findingId": "REVIEW-FINAL-B2-RETRY-PRIOR-LINK-DETACHMENT", "currentDisposition": "resolved" },
    { "findingId": "REVIEW-FINAL-B3-CROSS-IDENTITY-COUNTER-AUTHORITY", "currentDisposition": "resolved" },
    { "findingId": "REVIEW-FINAL-B4-MISSING-TERMINAL-ATTEMPT-RECORD", "currentDisposition": "resolved" }
  ]
}
```

## Ordered RegistryIntentV1 values

```json
[
  {
    "schema": "RegistryIntentV1",
    "event": "review.passed",
    "changeId": "deterministic-apply-verify-review-flow",
    "repairScope": "REVIEW-FINAL-B4-TERMINAL-ATTEMPT-CARDINALITY",
    "boundHead": "34aadacaf142270063eb445b9ed55e1157511a0d",
    "artifact": "openspec/changes/deterministic-apply-verify-review-flow/review-final.md",
    "verifyArtifactSha256": "5023a7e485ae7cb58b74290eccf015c6c1ef9cf980fda12420c607ad2fe84121",
    "decisionDigest": "sha256:59317a27650a16c8fb89ede2c7f8df312756beaf61dbe705d7f6383e8a1f95fd",
    "nextStage": "broad"
  }
]
```

The coordinator remains the sole registry writer and must validate this intent atomically. Review did not write `state.yaml`, `events.yaml`, or any shared registry state.

## Explicit blockers and next action

- **Blocking findings:** **0**.
- **Broad Verify permission:** **YES** — run a fresh mandatory broad Verify bound to the exact source, test, generated, Verify, and Review artifact state.
- **Archive permission:** **NO** until broad Verify passes and the coordinator validates the resulting ordered intents.
- **Exact next action:** coordinator may consume `review.passed` and dispatch fresh broad Verify. On any digest drift, test failure, parity mismatch, registry conflict, or recovery-required result, invalidate this advancement permission and stop fail-closed.
