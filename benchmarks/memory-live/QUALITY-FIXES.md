# Quality follow-up: finding → fix → regression

Account-precondition correction: the evaluation key shares the production account. The current harness uses `accountSharedWithProduction: true`, explicit reconciliation-authorized scoped cleanup (the current user decision supersedes all historical automatic-cleanup notes below), and the account-settings caveat; prior dedicated-account declarations below are historical and superseded. The latest correction also rejects false live declarations; earlier notes accepting either boolean are superseded by the final section.

The first-round notes below describe that executed historical candidate. The re-review section at the end supersedes its v5-404-only cleanup/preflight claims and records the current candidate separately.

All changes are confined to `benchmarks/memory-live/`. No product source, inventory output or `benchmarks/deckmemorybench.ts` was changed. No real credential was read and no provider request was made. This is implementation evidence for Quality re-review, not live-run authorization.

Quality's scripts were read from the supplied `quality-harness/` bundle and ported to assertions using self-cleaning test scratch. Their original top-level scripts create persistent run directories and print diagnostic payloads; they are not imported into default test discovery. The corpus, pins and production composition remain the tested inputs.

| Finding | Fix and implementation | Offline regression/evidence |
|---|---|---|
| (a) Evidence and rescore | `case-artifacts.ts` writes scrubbed injection text, raw units/responses and native output to 0600 per-case files with hashes. `rescore.ts` uses saved artifacts and current rubric/decoder without network or commit matching. R raw evidence includes profile facts. | `quality-regression.test.ts`: real R evidence/rescore after commit/hash changes, original report unchanged, sentinel-key/home redaction, raw profile coverage. |
| (b) Cleanup retention/authority | `cleanup.ts` journals every manifest namespace, including unconfirmed-only writes, before deletion. Exact run-unique namespaces can be deleted without returned IDs via v5 namespace DELETE without body/query. Retained/unverified entries make CLI exit 1. Identity/binding validation is independent of source/harness/corpus hashes; known-preexisting namespaces remain retained. Ownership is journaled before write egress. | Quality `cleanup-probe.ts` adapted: unconfirmed-only + mixed ownership, post-commit/hash cleanup, budget retention. Negative moveTo body/query tests; existing foreign-ownership rejection. |
| (c) Run IDs/preflight | `manifest.ts` generates UTC date + random nonce. `run.ts` preflights exact current-repeat tags before writes. Namespace 404 or documented empty document/chunk/memory arrays/counts are required. README commands use generated manifests. | Generated-ID full CLI exercise; populated/unknown preflight abort before writes; empty v5 namespace acceptance; simulated nonexistent namespaces. |
| Pilot scorer advice | q008 current rejection is creditable; q019 regex matches its frozen gold. No-gold precision is null/N/A. Proposition splitting separates a current clause from previously/obsolete clauses. | Quality `atoms.ts`, `oracle.ts`, `neg.ts` adapted: self-matching q008/q019, compound current/history, stale-as-current, negation and no-gold tests. |
| Pilot settle/canary advice | `settle.ts` hashes normalized, sorted identity+text projections. `report.ts` exposes settled-only scores/exclusions. Scorer and transport share `foreignCanary` project rules. | Changing timing metadata leaves a plateau; unsettled cases excluded; own-project canary allowed and foreign canary flagged; full raw-profile safety check retained. |
| (d) Headers/positive controls | Transport and IPC preserve content-type/retry/provenance response headers. `positive-control.ts` requires an acknowledged seed plus its fact in actual native injection. Failure means unavailable with reason and no route-score substitution. | Quality `fanout.ts`/`blocked.ts` wire-shape and positive-fact checks adapted; actual pinned controls on all routes; a no-hit transport makes all three unavailable with zero scored N cases. |
| (e) Opaque native IDs | `identities.ts` maps evaluator labels to random UUIDs; native session IDs, transcript filenames and entry IDs contain no question or temporal labels. Mapping stays evaluator-side. | Actual child probe receives UUID for a `q999-old-decision` evaluator label; generated identity values and pinned control artifacts checked. |
| (f) Native decoder | `native-output.ts` excludes pinned recall headers/instructions and retains multiline memory continuations as one unit. This also fixes OpenCode conversation-hit decoding. | Header-only/marked-header, exact pinned header, multiline OpenCode unit, actual seeded OpenCode positive control. |
| (g) Gateway | `gateway.ts` is an in-process IPC handler in offline and live modes. No native loopback socket or network-reachable constant bearer exists. Only parent egress receives the eval key. | Real pinned hooks and IPC header probe run under separate network namespaces; gateway auth/scope/endpoint rejection tests. |
| (h) Input/egress isolation | Transport rebuilds only allowlisted upstream headers and validates endpoint top-level fields. JS fence covers sockets, HTTP2, DNS and child processes except narrow read-only Git identity calls. Every native child runs under `unshare -rn`. | Quality `guard.ts`/`payload.ts` adapted: spaces/projectId/container_tags rejection, x-sm/cookie/override-header removal, exact serializer fields. Fence probes for HTTP2, DNS/promises, subprocess and foreign origin; OS namespace differs from parent. |
| (i) Blocked deviations | Sent and blocked ledgers are separate and both contribute to attempted counts. Categories cover legacy/inactive scopes, settings, secrets, budget/schema and JS-fenced effects. Reports show rejection latency, zero actual blocked-cloud debit, counterfactual known meters and unknowns. OpenCode settings remain blocked; no fabricated legacy empty successes. | Native IPC probe asserts settings/fan-out 403s, category/count accounting, unknown legacy profile/query counterfactual cost and fence telemetry. Full simulation records real pinned fan-out attempts. |
| (j) Comparability | `scoreArtifact` applies the same role caps and @1/@5/raw views to R and N. Apply-fast expects a skip; actual native injection remains in evidence, bytes and explicit policy-violation counts. | R/N identical cap-0 and @5 test; real R apply-fast zero injection test. |
| (k) Low items | Secrets checked before schema/scope rejection; queried legacy profile meter unknown; active allowlist only current repeat; tests use self-cleaning test-scratch roots that cannot be live. | Bad-scope/settings secret attempt counted; profile-query meter assertion; previous/future-repeat rejection; default discovery proof has no new runs or scratch suites. |

`fixtures/native/` bytes are still adapter-pin verified. The harness-local `.gitignore` includes the pinned OpenCode distributions despite the repository's generic `dist/` exclusion. No dependency was installed.

## Verification commands

```bash
unshare -rn bun test benchmarks/memory-live
bunx --no-install tsc --ignoreConfig --noEmit --skipLibCheck --moduleResolution bundler --module esnext --target es2022 --types bun benchmarks/memory-live/run.ts benchmarks/memory-live/cleanup.ts benchmarks/memory-live/rescore.ts benchmarks/memory-live/guard.test.ts benchmarks/memory-live/pipeline.test.ts benchmarks/memory-live/quality-regression.test.ts benchmarks/memory-live/native-regression.test.ts
MANIFEST=$(bun run benchmarks/memory-live/run.ts prepare --mode full --repeats 1 --manifest-path-only)
unshare -rn bun run benchmarks/memory-live/build.ts --manifest "$MANIFEST"
unshare -rn bun run benchmarks/memory-live/run.ts dry-run --manifest "$MANIFEST"
unshare -rn bun run benchmarks/memory-live/run.ts rescore --manifest "$MANIFEST"
```

Final default discovery: **40 pass, 0 fail, 230 assertions**, 4 files, under `unshare -rn`. TypeScript check and two-entrypoint build pass. Default discovery left **zero new run directories and zero scratch suites**. The same suite also passes with the harness's isolated Bun configuration.

## Remaining evidence boundary

The live provider has not been contacted. A simulated positive control verifies decoding, serialization and isolation, not provider indexing or quality. Legacy profile-with-query billing is unknown; estimates are known-meter subtotals. Blocked aliases/settings and dropped identity headers remain explicit deviations. Settling is a retrieval plateau heuristic, not index-status proof. Native models, full lifecycle parity and all v2 probes remain unmeasured/unsupported. Quality and Lead approval are still required for live execution.

## Final frozen full simulation

Run `20261021_0aa7600260fdee38` completed under `unshare -rn` with `liveApproved: false`. Its frozen harness and product-source hashes still match the checkout. Receipts live under `~/.deck-eval/runs/20261021_0aa7600260fdee38/`; `checks/tests.txt` and `checks/default-discovery.json` retain the private test output and directory-cleanliness proof.

| Suite | Cases | Seeded positive control | Result |
|---|---:|---|---|
| R | 50 | Native gate not applicable | Real production paths exercised |
| N Claude | 50 | passed | faithful hook replay in simulation |
| N Codex | 50 | passed | faithful hook replay in simulation |
| N OpenCode | 50 | passed | faithful hook replay in simulation |
| Native continuity | 24 | Both route gates required | Six directed writer/reader pairs exercised |

All **224** case artifacts are regular mode-0600 files beneath the mode-0700 run root. The CLI `rescore` command reread/rescored all 224 with **zero network requests**, writing `rescore-3e6cea26cc19b5e1.json`. Sixteen namespace preflights returned nonexistent in simulation.

There were **1,220 simulated upstream effects** and **1,201 blocked attempts** (2,421 total attempted effects): 1,017 legacy/inactive-scope reads, 124 account-settings updates, 51 JS-fenced effects and 9 NONFUNCTIONAL-secret attempts. The blocked scopes were never sent; OpenCode settings were never applied. Reports include local rejection latency and counterfactual meter estimates/unknowns. Actual network requests and USD debit were **0 / $0**. The known-meter would-be provider estimate for this short synthetic simulation was $0.06494, plus unknown legacy profile-query billing; it is not a live spending forecast.

The scorer reports 144 settled-eligible cases and 36 excluded scored cases; the remaining cases are future unsupported/policy skips. Nine native apply-fast injections remain visible as role-policy violations. Simulation quality/safety values are not claimed as cloud performance or a product safety pass. The eight V cases per suite remain unsupported, coverage 0.

## Quality probe provenance

| Supplied probe | SHA-256 |
|---|---|
| atoms.ts | `41c580e85ddef3dcf742bbcb9becee92a06e47c17b8712d7776fb5f8f6899bf8` |
| blocked.ts | `de515146d5739994969fdfe8c1c17657d7b860d1d17dffded6f66f63160c25e4` |
| cleanup-probe.ts | `0218be3539381e774bc9eab2ef3b7015e0e1034cc2c4373249686013ce853f3c` |
| fanout.ts | `47420921bad1aadd8f5a3a9886b664b130be3bdd92c48a257ea36246f6e0959e` |
| guard.ts | `6f8d25fe92d270a12322f2449f1c6370334f82988eaf4bc52ffdf93d324a9b42` |
| inspect.ts | `68e06e6371fcb163b93b574106e53c68779171089525090fde6c0b9004ef5ff2` |
| neg.ts | `b226abccdea4ca6bb1251bae149ad8af38d5b6aa8fafcf8f8a3b88838fc31bc2` |
| oracle.ts | `3c82ee61a323a41e8a10242c4ef08df33c6c569d94be6fd2c553fcd2192fd872` |
| payload.ts | `47d234deb6884cc71afbe3763b7702fa496d42e0ad2cb26376ad2243a10664d7` |

## GO-WITH-FIXES re-review: current candidate

The following changes supersede the earlier v5-404-only claims. All implementation and regression changes were made **before** the frozen full simulation and final test/type checks. README and these evidence notes are documentation written afterwards; they do not alter executable harness hashes.

| Re-review finding | Change | Executed offline regression |
|---|---|---|
| 1. Legacy/v5 visibility | Preflight requires recognized empty legacy profile **and** search responses, even with v5 404. First write per namespace, including lost acknowledgements, requires v5 GET = 200; failure stops egress and retains visibility receipts. Written cleanup namespaces require v5 200 before DELETE and empty legacy profile/search plus v5 absence after DELETE. 404 alone never clears a written namespace. Proof-v1 journals are invalidated. | `rereview.test.ts`: hidden legacy data, denied/malformed legacy reads, written-v5-404 refusal with no DELETE, post-delete ghost data, successful dual-path erasure, first-write abort and lost-ack receipts. Existing cleanup fixtures now model both API surfaces. |
| 2. Key path | Every README live command uses `SUPERMEMORY_EVAL_API_KEY_FILE="$HOME/.deck-eval/eval.key"`. Other key files in that directory must not be used. | Commands were inspected as text; no real key file or native credential was read. |
| 3. Key bytes in requests | Transport rejects the eval-key bytes in raw/decoded request bodies and caller header names/values before validation or forwarding, including headers it would drop. Only the internal egress authorization gets the key. Blocked receipts are scrubbed. | Five sentinel-key cases, including escaped JSON, invalid scope, authorization and a raw header name; zero wire effects and no sentinel in serialized transport. Additional mount masking was not implemented; existing OS network isolation and IPC fence remain. |
| 4. Rejection calibration | Scorer distinguishes rejected/negated stale proposals and “used to … but now …” from current assertions, without losing q008's current rejection gold. Added frozen `fixtures/scorer-calibration.json`. | Explicit fixture assertions, q008 self-match, compound current/past recall, and positive stale re-assertion after “but”. Rescored the previous 224-case simulation offline. |
| 5. Dedicated account, IDs, filters | Live run and cleanup require `dedicatedEvalAccount: true`; CLI preparation requires explicit `--dedicated-eval-account` to attest it. Every write ID matches a current-run prefix or an evaluator-generated per-namespace allowlist of production/pinned ID patterns. R sessions include run identity; native payload IDs are validated without rewriting. Metadata filter values must be selector-free strings in recognized legacy trees. | Live attestation fails before credential access; unrelated/foreign IDs and selector/object/array/number filter values fail before effects; valid pinned metadata predicates and real R/native serializer paths pass. |

Final default test discovery executed as `unshare -rn bun test benchmarks/memory-live`: **50 pass, 0 fail, 302 assertions**, 5 files. It left zero new run directories and zero scratch suites. Full TypeScript check and the two-entrypoint build passed. No runtime code, regression assertion or calibration fixture was added after these final checks.

The previously reported run `20261021_0aa7600260fdee38` was rescored into `rescore-ffc985fa8efbd465.json`: 224 cases, zero network requests, original evidence preserved. Two per-case score objects changed; total stale-as-current remained 8. Calibration fixture results establish the rejection fix even though the FIFO simulated retrieval did not return those rejected stale proposals.

Current frozen full simulation: **`20261021_a6681e7309dabba5`**, executed under `unshare -rn`, completed with `liveApproved: false` and `dedicatedEvalAccount: false` (offline mode makes no account attestation). R, Claude, Codex and OpenCode each produced 50 case artifacts, plus 24 native continuity artifacts. Claude/Codex/OpenCode positive controls all passed and each route reports faithful hook replay in simulation. Sixteen preflights recorded `v5_absent_legacy_empty`; all sixteen written namespace receipts subsequently recorded `visible_v5_200` in both results and ownership.

The run recorded **1,268 simulated upstream requests + 1,200 blocked attempts**, actual network requests **0**, actual USD debit **$0**. Its known-meter would-be estimate is $0.06502 plus unknown legacy profile-query billing. All 224 case artifacts are mode 0600. Settled-only scoring covers 144 cases. The final rescore command processed all 224 cases into `rescore-8796c526b05d5c73.json` with zero network requests. The executed runtime, product-source and calibration hashes were rechecked against the current checkout and matched after the documentation updates.

Private execution receipts are under `~/.deck-eval/runs/20261021_a6681e7309dabba5/`: `results.json`, `ownership.json`, the rescore output, `checks/rereview-tests.txt`, and `checks/rereview-discovery.json`. These are simulated provider receipts, not proof that the live legacy/v5 surfaces correspond. No live pilot, full baseline or cleanup was executed. Cleanup effects were exercised only through simulated transports in tests. No real `*.key` or native credential was read. Optional mount masking was not added.

Changed implementation files for this re-review: `namespace-transport.ts`, new `request-policy.ts`, `cleanup.ts`, `manifest.ts`, `run.ts`, `capture-replay/runtime.ts`, `capture-replay/native.ts`, `score.ts`, `report.ts`; new `fixtures/scorer-calibration.json`; new `rereview.test.ts` and updated `guard.test.ts`, `pipeline.test.ts`, `quality-regression.test.ts`, `native-regression.test.ts`; `README.md` and this evidence log. Documentation/evidence additions after verification are explicitly separated above; no executable changes were added afterwards.


## Shared-production-account correction: latest executed candidate

The eval key is a dedicated key in the production Supermemory account. New manifests never write `dedicatedEvalAccount`. Live execution requires an explicit boolean `accountSharedWithProduction`; this account must use `true`, supplied by `--account-shared-with-production`. Explicit `false` remains supported for other account arrangements and never relaxes namespace or endpoint guards. Historical manifests above were not changed.

| Requirement | Implemented behavior | Executed offline regression |
|---|---|---|
| Truthful account declaration | `manifest.ts` prepares the explicit shared field, rejects the retired flag, and fails live execution before credential access if the boolean is missing. | `shared-account.test.ts`: absent/true/false declarations, no dedicated-account property, CLI parsing and deprecated-flag rejection. |
| Every effect scoped to this run | Existing singleton logical-scope mapping and current-repeat allowlist remain mandatory. Missing, multiple, legacy, production and unowned namespaces are rejected before wire effects. Unknown bulk/forget/document-delete routes remain blocked. | Missing/multiple/foreign selectors across legacy document/profile/search routes; unowned bulk/forget/delete; override header removal; future-repeat namespace rejection. |
| Account endpoints denied | `request-policy.ts` explicitly denies settings, organization/context, auth/scoped-key, billing, connectors, spaces/projects and namespace enumeration. PATCH/PUT outside recognized run-owned configuration paths cannot pass. | All five HTTP methods over the prohibited endpoint families produce zero wire effects. Default endpoint allowlist remains deny-by-default. |
| Scoped namespace configuration | Only exact active run-owned `deck_eval_` paths permit supportingContext PATCH and profile-bucket PUT/DELETE with documented body fields. Unknown fields, moveTo and frozen-corpus writes fail. | Valid configuration serializers, preserved bucket DELETE body, foreign/default/other-run paths, invalid body, future repeat and frozen-corpus rejection. |
| Mandatory automatic cleanup | Shared runs finalize through the same verified-absence cleanup on success and evaluation failure, reusing the existing private transport/key closure and an independent manifest reserve. Results contain deleted, verified-empty and retained namespace lists with reasons. Any retention yields exit 1. | Successful four-namespace cleanup without separate cleanup approval; delete-ack ghosts retained; evaluation abort still finalizes; cleanup budget exhaustion lists every retained/unattempted namespace. |
| Production-setting caveat | Every result includes `accountSettingsCaveat`, stating that existing production LLM filters can affect ingestion; settings are neither read nor changed. Cleanup requests are separately budgeted and metered in `report.ts`. | Saved pilot result assertions, request accounting and automatic-cleanup journal assertions. |

Changed files for this correction: `manifest.ts`, `request-policy.ts`, `namespace-transport.ts`, `cleanup.ts`, `run.ts`, `report.ts`; new `shared-account.test.ts`; updated `rereview.test.ts`, `quality-regression.test.ts`; `README.md` and this evidence log. No product, inventory or plumbing-benchmark changes were made.

Executed verification:

```bash
unshare -rn bun test benchmarks/memory-live
bunx --no-install tsc --ignoreConfig --noEmit --skipLibCheck --moduleResolution bundler --module esnext --target es2022 --types bun benchmarks/memory-live/run.ts benchmarks/memory-live/cleanup.ts benchmarks/memory-live/shared-account.test.ts benchmarks/memory-live/rereview.test.ts benchmarks/memory-live/quality-regression.test.ts benchmarks/memory-live/native-regression.test.ts benchmarks/memory-live/pipeline.test.ts benchmarks/memory-live/guard.test.ts
unshare -rn bun run benchmarks/memory-live/build.ts --manifest "$MANIFEST"
unshare -rn bun run benchmarks/memory-live/run.ts dry-run --manifest "$MANIFEST"
```

The isolated default-discovery suite passed **61 tests, 0 failures, 574 assertions across six files**. TypeScript and the two-entrypoint build passed. Discovery left **zero new run directories and zero scratch suites**. The self-gold oracle remains part of this executed suite. Tests use synthetic sentinels and isolated native homes, never real keys or native credentials.

The R-only shared-account pilot simulation is **`20261021_0e36a2b020fe443b`** (`liveApproved: false`, `accountSharedWithProduction: true`, no dedicated-account field). It completed with **50 private case artifacts**: 39 scored cases, three policy skips and eight unsupported future cases. There were **332 evaluation + 20 cleanup = 352 simulated upstream requests**, zero blocked requests, within separate limits of 850 and 28. All four manifest namespaces were verified deleted using pre-delete v5 200, accepted DELETE, post-delete v5 404 and empty legacy profile/search. The final retained list is empty. Failure-path tests additionally confirm that retention is reported and nonzero.

Actual network requests and USD debit were **0 / $0**. The simulated known-meter subtotal is **$0.010665**, plus unknown queried-profile/deletion metering; this is pipeline evidence, not a live cost or retrieval-quality forecast. The account-settings caveat is present in `results.json`; no settings were read or changed. Full R+N baseline was not executed in this correction; native replay is covered by the isolated suite.

Receipts are private under `~/.deck-eval/runs/20261021_0e36a2b020fe443b/`: `plan.json`, `results.json`, `cleanup.json`, `ownership.json`, 0600 `cases/` artifacts, `checks/shared-account-tests.txt` and `checks/shared-account-discovery.json`. The run root is 0700. Runtime and product-source hashes were checked against the saved manifest after verification and still match.

All executable changes and test assertions preceded the final isolated suite and simulation. Only README and these evidence notes were added afterwards. No live pilot, baseline or provider cleanup was executed; automatic cleanup effects were simulated. The exact shared-account prepare/run commands are in README; the live command remains approval-gated and was not run.


## Shared-account NO-GO follow-up: exact-true authority and positive cleanup ownership

This section supersedes the earlier candidate's acceptance of explicit false for live use. This harness evaluates the confirmed production-shared account: both live run and live cleanup now require an own `accountSharedWithProduction` property equal to `true` exactly, before invoking the credential reader. `parseAccountDeclaration` accepts only the bare `--account-shared-with-production` flag; equals forms, following boolean values and duplicate flags are rejected. Historical absent/false manifests remain usable offline for tests/rescoring, and cannot authorize live operations.

Cleanup now requires positive deletion authority in addition to exact manifest scope: a recorded owned/attempted/unresolved write, or a complete run-start `v5_absent_legacy_empty` receipt with v5 404 and recognized empty 200 legacy profile/search reads. An existing-but-empty namespace alone is insufficient. Missing ownership, incomplete proof and manifest membership alone produce `retained_ownership_unproven`, without DELETE; preflight failures remain retained. The existing pre-delete v5 200 and post-delete v5/legacy verification requirements remain. Journal replay cannot bypass the new authority check. Tests distinguish an abort after proven ownership (cleanup uses its separate budget) from an abort before preflight proof (all namespaces retained, zero cleanup egress).

New regressions were executed RED against the prior implementation (**three failures**) and GREEN after the fix. They include a mocked credential reader that throws if invoked; false and absent live run/cleanup declarations reject with **zero reader calls**. The cleanup matrix covers absent receipts, unrecorded tags, existing-empty preflight, incomplete preflight, failed preflight, confirmed writes, attempted writes, unresolved writes and complete absent-at-start proof. Existing partial-ownership fixtures now expect their unproven namespaces to remain retained.

The disputed scorer/retry fixes were already present in the current checkout and were executed before changing implementation:

```bash
unshare -rn bun test benchmarks/memory-live/quality-regression.test.ts benchmarks/memory-live/rereview.test.ts --test-name-pattern 'self-gold oracle|third review.*visibility'
```

Result: **3 pass, 0 fail, 105 assertions**. A separate direct oracle execution under `unshare -rn` reported **42 non-future questions, 75 gold atoms, zero failures**, including both q010 atoms. The non-temporal sentence `The setting existed but was undefined.` remained one proposition. Retry tests assert 404→200 waits `[2000, 4000]`, 404→503→200 waits `[2000, 4000, 8000]`, a maximum of three failed GETs before stopping fail-closed, and only one GET when the remaining budget is one. Every visibility GET contributes to the request budget; waits are simulated.

Neither `score.ts` nor `namespace-transport.ts` was modified in this follow-up. Their current SHA-256 values also match the saved shared pilot `20261021_0e36a2b020fe443b`:

| File | SHA-256 |
|---|---|
| score.ts | `c581805e4ca7f4b9d0f6c5b1c7bd898c95e203fab209a2bfd478db4187037258` |
| namespace-transport.ts | `9a2deb4a5cf549d50c05d7d8fe01b27e5176bd9ee1eb3fe04086ed9375c66d13` |

Final verification executed against the complete current implementation and assertions:

```bash
unshare -rn bun test benchmarks/memory-live
bunx --no-install tsc --ignoreConfig --noEmit --skipLibCheck --moduleResolution bundler --module esnext --target es2022 --types bun benchmarks/memory-live/run.ts benchmarks/memory-live/cleanup.ts benchmarks/memory-live/shared-account.test.ts benchmarks/memory-live/rereview.test.ts benchmarks/memory-live/quality-regression.test.ts benchmarks/memory-live/native-regression.test.ts benchmarks/memory-live/pipeline.test.ts benchmarks/memory-live/guard.test.ts
```

Result: **64 pass, 0 fail, 627 assertions across six files** under `unshare -rn`; TypeScript passed. This includes the full oracle, both retry tests, pinned native replay and simulated pilot automatic cleanup, with retained-state/nonzero and abort-path checks. No standalone new baseline or pilot CLI run was performed in this follow-up. No live provider request, provider cleanup or real/native credential read occurred. No scorer change was necessary, so existing scores were not changed or rescored in this follow-up.

Changed files: `manifest.ts`, `cleanup.ts`, `shared-account.test.ts`, `quality-regression.test.ts`, `rereview.test.ts`, `pipeline.test.ts`, `README.md`, `QUALITY-FIXES.md`. All executable changes and assertions preceded the final tests. Only this documentation/evidence entry was added afterwards. The existing bare-flag pilot prepare command and live run command are unchanged; the live command was not executed. Product source, inventory and the plumbing benchmark were not modified.


## Token-derived R pilot forecast and pre-egress estimated spending guard

Current owner/model: Codex `openai-codex/gpt-6-astra`, new task attempt 1. Memory prepared disabled, no injected recall, no delegation. Detailed private evidence: `/home/kevin15011/deck-memv2-phase0/cost-guard/REPORT.md` and `final-evidence.json`. No live provider call, real credential/account metadata access, native-login test, inventory rerun, product edit or OpenSpec edit occurred.

The former 73 × 1,000-token planning assumption is replaced by an offline execution of the production R capture serializer, pool/lifecycle controls and skip probes: **68 writes, 8,239 content UTF-8 bytes, 26,879 JSON-body bytes, 2,084 heuristic UTF-8/4 tokens**. One proxy token per content byte is an explicitly unverified conservative planning proxy. Two complete ingestion passes reserve 16,478 proxy tokens. The frozen plan includes exact per-write bytes/hashes, assumptions, unknown meters and budgets.

The current proposal fits: $0.168700 evaluation forecast plus $0.05 protected cleanup reserve = $0.218700; stop evaluation before a next effect projects >= $0.20, and enforce a $0.25 total **estimated** ceiling. Unknown work gets $0.0001 per attempted effect, plus known meters; retries/errors/lost acknowledgements never refund reservations. These are modeling allowances, **not an invoice cap**. Guarded R-one-repeat plans require exactly **822 evaluation + 28 cleanup = 850 total**. Full R+N future planning defaults to at least three repeats to measure extraction variation; native payload forecasting remains required before live full-baseline execution.

The guard runs synchronously before egress, persists `cost-progress.json`, emits one secret-free stop event immediately, and preserves independent automatic cleanup. Missing/invalid live guards reject before the credential reader. Frozen execution inputs/code require new plans. Historical rescoring survives code changes. Historical scoped cleanup also remains possible with an explicit cumulative cleanup-only estimated ceiling; recovery carries reservations from both automatic and manual progress/journal receipts, including a crash before acknowledgement. Namespace/account protections and scorer bytes are unchanged.

Executed RED: missing run guard, missing standalone cleanup guard, and an excessive 850-evaluation request allowance. Executed full suite: **73 pass / 0 fail / 687 assertions**, before the last two small deltas. Executed affected suites after crash-receipt carryover: **21 pass / 0 fail / 278 assertions**. Executed final affected suites after exact request-allowance enforcement: **22 pass / 0 fail / 279 assertions**. Final TypeScript, two-entrypoint build, new-manifest R simulation and 50-case offline rescore passed after all runtime/test changes.

Final synthetic-HOME simulation `20261021_f522ec78f4784ac3` exactly matched forecast write/content/body counts, used **332 evaluation + 20 cleanup = 352 simulated requests**, and verified all four namespaces absent. Simulated estimated usage was $0.074620 evaluation + $0.002020 cleanup = $0.076640; actual network/debit **0 / $0**. A separate fresh plan `20261021_a24aac12c8e7dbce` has no execution receipts and retains `liveApproved: false`. Both plans live only under this owner's private evidence HOME; Lead must prepare a fresh normal-HOME plan from the README command before the real pilot. No full baseline was run.

Added after executed checks: this evidence section and the private report only. No executable code, assertions or dataset changed afterwards. The private report distinguishes full-suite timing, affected-delta reruns, intermediate timeout handling, seeded-stop simulation and remaining unknown billing/provider behavior.


## R6 cost recovery correction: process authority and durable cumulative reservations

This section supersedes the preceding candidate's JSON-receipt recovery claims. Detailed evidence and new hashes are in `/home/kevin15011/deck-memv2-phase0/cost-guard/r6-fix/REPORT.md`. Configured owner: Codex `openai-codex/gpt-6-astra`, task `task-46b283d9-f23b-4d89-a1a7-cbd814f207e7`, attempt 2. Memory prepared disabled; no injected recall or delegation.

`run-authority.ts` holds one process-exclusive SQLite lock across evaluation plus automatic cleanup, or the entire standalone cleanup invocation. A separate SQLite ledger commits each dollar/token/request reservation before egress. Private marker/file identities prevent silent recreation of missing authority. Evaluation is durably consumed before key access, and cleanup cannot run while evaluation remains active. Reservations are cumulative across automatic/manual retries, killed owners and lost reporting journals; no uncertain send is refunded. Missing/corrupt durable state and invalid/conflicting reports fail closed before credentials. Older pre-authority plans require reconciliation instead of a zero-budget migration; offline rescore and scoped cleanup of intact durable histories remain supported across code changes.

Quality's actual r6 probes were adapted into self-cleaning executable regressions without importing its autorun scripts. RED reproduced six failures: 32 cleanup requests against 28, overlapping cleanup, ignored spent results, deletion during active evaluation, restart after ownership loss, and separate-process overlap. GREEN includes separate-process SIGKILL recovery, lost reporting files after actual simulated spend, missing/schema-corrupt authority before a mocked credential reader, automatic-to-manual request 28, and rejection after all ordinary execution receipts disappear. Missing ownership cannot reuse an old clean journal as success.

Final executed checks after all code/assertion changes: **85 pass, 0 fail, 757 assertions across eight files**, network-isolated with synthetic HOME; no-emit TypeScript; two-entrypoint build; fresh R-only simulation and 50-case offline rescore. An earlier whole-suite run had two outdated fixtures that changed budgets after preparation; these now prepare their intended budgets before authority initialization. Final suite passed after that adjustment. No assertion or runtime change was added after final verification; this entry, README and private reporting were added afterwards.

Fresh simulated run: `20261021_5d3a19f7068a8092`; fresh unexecuted synthetic-HOME plan: `20261021_9ec4c7ee273f2f2a`, unapproved. Forecast unchanged: 68 writes, 8,239 content bytes, 26,879 serialized JSON-body bytes, 2,084 heuristic tokens, 16,478 two-pass proxy-token budget. Simulation: 332 evaluation + 20 cleanup, durable and reported estimate $0.076640, all four namespaces verified absent. Limits remain **822 + 28 = 850**, **$0.25 estimated ceiling / $0.20 stop / $0.05 protected cleanup**. These are not invoice caps. Full R+N still requires at least three repeats and was not run as a baseline.

No provider requests/debit, real/native credential or account metadata access, native login, product/inventory/OpenSpec changes, or normal-HOME manifest changes occurred. Normal-HOME manifest `20261021_02c2aef9b0dd8967` remains obsolete and untouched; Lead must prepare a fresh plan after independent re-review. Quality's report was read only. SQLite durability relies on local filesystem locking/fsync; SIGKILL was tested, physical power loss and malicious coordinated ledger rollback were not.

## Post-pilot processing, timing and explicit retention policy (2026-10-21)

This section supersedes every earlier automatic-cleanup and plateau-readiness claim. The prior R pilot's 94.44%/37.5% scores are INVALID as a baseline because processing readiness was not recorded. Processing delay is a hypothesis, not an established cause. Console search units reconcile as 49 v4/search + 122 queried profiles = 171. Unchanged rounded balance/token displays do not establish exact zero cost.

The current candidate polls only documented run-owned namespace/acknowledged-document GETs, requires both indexing and dreaming done, and witnesses the latest revision by exact serialized content hash. All corpus/pool/control writes and uncertain acknowledgements are accounted for. Invalid/missing/failed/deadline-exhausted status evidence invalidates all quality metrics. It records per-document timestamps and censored indexing/memory latency denominators. Capture-relative next-turn availability is a separate measurement over a frozen capture prefix, with tentative synthetic 30-second timing, actual delays and drift. Later facts cannot be captured before the due availability query group finishes.

All namespaces now remain awaiting explicit user console COST and per-namespace reconciliation plus durable cleanup authorization. There is no automatic namespace delete or TTL. Shared-account and historical cleanupApproved flags cannot bypass authorization before credentials/DELETE; an active evaluation cannot authorize or perform cleanup. Existing run-lock, single-use, cumulative reservation, crash/journal recovery and scope protections remain. Historical rescoring preserves originals and cannot invent readiness. Full R+N planning requires at least three repeats, and full execution fails explicitly pending N-specific status/timing/cost contracts.

The payload remains 68 writes, 8,239 content bytes, 26,879 serialized body bytes and 2,084 heuristic tokens. Two passes reserve 16,478 byte-based proxy tokens. Including both query modes and conservative polling/setup/retry allowances, the default two-minute polling plan forecasts 1,220 evaluation requests / $0.260490 including the protected $0.05 reserve, so live validation rejects it. Explicit five-minute polling forecasts 812 / $0.217650 including reserve, with coarser observations and possible conservative timeout. No allowance is raised: 822+28 requests, $0.20 stop/$0.25 estimated total/$0.05 reserve. These are assumptions, never an invoice cap; stopping requests cannot cancel deferred unmetered processing.

Evidence is under `/home/kevin15011/deck-memv2-phase0/processing-gate/REPORT.md`. RED logs reproduce absent readiness/retention, failure-stop delay, synchronous abort, dispatch deadline and expired-timeout races, and undercounted preflight. The complete affected suite passed **162 tests / 1,324 assertions**. A final nonpositive remaining-timeout regression was added after that suite; its one-line guard and affected transport/readiness tests then passed **36 tests / 127 assertions**. Final typecheck passed. Intermediate obsolete-expectation/type errors and one integration-test timeout are retained in the evidence; they are not represented as passing. The timeout test uses 60 seconds now, without increasing production deadlines. Final build/simulation/rescore and fresh unapproved plans are recorded by the private report after execution. No implementation or test was added after the final focused run; only documentation/evidence followed.

Configured owner: Codex / openai-codex/gpt-6-astra, attempt 4. Prepared memory disabled; no injected recall. No real provider/key/account/native-credential access, native login, live approval, actual deletion, commit or delegation occurred. Product, corpus, native pins, production composition and scorer semantics remain unchanged. Source and graph limitations, exact commands, fresh plan paths and SHA256 manifests are in the private report.
