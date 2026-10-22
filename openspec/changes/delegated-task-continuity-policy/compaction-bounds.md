# Native compaction bounds — verification record

Status: source formulas reviewed, 2026-10-22. Runtime enablement remains conditional on verified effective configuration and accounting evidence. Formula verification is not a declaration that every installed runner/model is safe to resume.

The user approved a configured hard ceiling of 160000 input tokens, conditional on remaining below the actual automatic-compaction trigger for the runner/model/effective configuration. A model context-window size is not itself evidence of the trigger. Unknown boundary/configuration or unsupported accounting conversion forces fresh execution, even for explicit native override.

The effective bound must be derived from version-specific native evidence and current settings, with output/reserved-token accounting handled where relevant. The effective cap is the lower of the configured ceiling and a conservative input-equivalent limit STRICTLY below the native trigger. No guessed universal percentage or fixed safety margin may establish missing evidence.

| Runner | Trigger/formula | Effective settings source | Native policy gate | Verification |
| --- | --- | --- | --- | --- |
| Codex 0.162.1 | Model/config auto limit capped at 90% of resolved window; independent usable-window limit; optional lower post-turn threshold | Exact model metadata and effective layered config; local `config/read` exposes some but not all relevant settings | Require known effective limits/scopes, final request accounting and no unknown lower threshold | Tagged primary source, architect attempt 2 plus Lead source reads |
| Claude 2.1.301 | Effective auto window minus min(max output,20000), then minus13000; percent override may lower it; source/remote flags affect proactive/precompute paths | Resolved native control response may expose effective threshold, but response and remote/precompute semantics still require fixtures | Unknown until native effective threshold and accounting are verified; modelUsage capacity alone insufficient | Installed binary snippets reviewed; runtime-control contract remains unverified |
| OpenCode 1.19.1 | Standard path uses input-limit minus reservation OR context minus capped output; native-LLM path differs | Resolved managed-server config + exact provider catalog/input/output limits + environment/path selection | Require verified path/config AND reliable provider input normalization; otherwise fresh | Lead additionally recovered exact maxOutputTokens function omitted from architect report |

## 1. Codex source and conditions

Primary source: official `openai/codex` tag `rust-v0.162.1`, locally inspected under `/tmp/codex-src-dtc/x/codex-rust-v0.162.1/codex-rs/`.

- `protocol/src/openai_models.rs:516-538`: resolved window W; auto limit `min(model/config auto_compact_token_limit, floor(0.9 * W))` when W exists; usable window `F = floor(W * effective_context_window_percent / 100)`.
- `models-manager/src/model_info.rs:19-31`: configured window replaces/clamps model window and configured auto limit replaces model auto limit.
- `core/src/session/context_window.rs:54-132`: scope may be total or body-after-prefix; fallback buffer may delay the scoped trigger, but F independently forces compaction. A positive `model_post_turn_compact_threshold_percent` can add a LOWER end-of-turn threshold.
- `core/src/context_manager/history.rs:934-951` and `session/turn.rs` (architect source trace): native counted context includes last input+output and subsequent native history estimates. It is not identical to last request input.

Illustrative verified formula arithmetic, NOT unconditional runtime eligibility:

| Effective settings | Default scoped trigger | Configured160k comparison |
| --- | ---: | --- |
| W=272000, no lower model/config limit, total scope, post-turn disabled | 244800 | Below this trigger before accounting margin |
| W=500000, same conditions | 450000 | Below this trigger before accounting margin |
| Explicit lower auto limit | min(config limit,0.9W) | Must lower effective cap when necessary |

The observed usage window258400 is F for W272000 at95%, not raw W. The architect's shortcut `min(config limit,0.9 * reportedWindow)` is a conservative candidate ONLY if lower model metadata limits and optional post-turn thresholds are also known/accounted for. Do not apply it merely because `config/read` returned null for a user override: null does not establish absence of a model-provided lower limit. `config/read` does not expose every relevant field in the generated schema, including post-turn percentage. A missing effective setting remains unknown; observing previous non-compaction is not proof that it is disabled.

## 2. Claude conditional thresholds

Installed2.1.301 snippets retained at `/tmp/claude-compact-snips.txt`; Lead inspected the window-selection, effective-window and threshold functions. Minified names are evidence locations, not stable APIs.

- `Hso`/`Ab`: window may come from environment, layered per-model/global settings, server clientdata, experiments or model default. Model context capacity alone does not select the window. Server/experiment values need not share the100k floor enforced on user settings.
- `F8`: `E = selectedAutoWindow - min(maxOutputTokens,20000)`.
- `_8`: `T = E -13000`, or lower `floor(E * configuredPercent /100)` when a valid percentage override exists.
- Proactive enablement, reactive overflow and precomputed-summary behavior vary with source and flags. The exact precompute swap/accounting path is not fully established.

With maxOutput>=20000, selected auto windows100000/200000/1000000 yield conditional T67000/167000/967000 respectively. Thus160k is clearly too high for the100k case and leaves only7000 before extra context in the200k case. These are conditional formulas, not asserted current session thresholds.

The native `get_context_usage` control path reportedly exposes `autoCompactThreshold` and enablement. Its schema, actual effective-window coverage, precompute semantics and input-equivalent accounting must be fixture-verified before it enables native reuse. Reading environment alone cannot rule out lower settings/clientdata/experiments. Until then Claude compaction-bound evidence is unknown/fresh-only, including override. A conservative contract implementation is allowed without pretending that this verification already exists.

## 3. OpenCode correction and exact standard-path formula

Lead inspected installed binary `~/.opencode/bin/opencode`1.19.1, offsets96735034 (`Ls`),96735307 (`Il`),97054354 (`_Y`, exported `maxOutputTokens`),97030787 (default32000).

For validated positive settings:

```
Q = effective outputTokenMax (default32000, environment may override)
O = min(model.limit.output,Q) || Q
R = config.compaction.reserved ?? min(20000,O)
Tstandard = model.limit.input ? max(0,model.limit.input-R)
                             : max(0,model.limit.context-O)
```

Standard overflow uses `tokens.total || input+output+cache.read+cache.write`, compares `>= Tstandard` after a step, and is disabled by `compaction.auto === false`; zero context has separate disabled behavior. Unknown or invalid limits/config do not prove a safe threshold.

**Correction to architect attempt2:** a200k-context/128k-output model with default Q32000 and no input limit has standard T168000, NOT72000. T72000 applies if effective Q is128000 for that example, or to a different verified path/config; the report's max-of-output subtraction was a conservative lower bound, not the actual standard trigger. Tests must use the exact function rather than hardcode the incorrect default example.

The experimental native-LLM `compactIfNeeded` path uses a different pre-request estimator/limit expression. Enablement/path/config and accounting must be established independently; if unknown, force fresh. Catalog data already fetched by Deck must include input/output limits as well as context, but a catalog alone does not establish resolved compaction settings or reliable provider token normalization.

## 4. Effective cap and evidence contract

Record runner version, exact model/provider, trigger source/basis, effective settings, observation sequence/time, relevant native identity, and the derivation of the input-equivalent ceiling. Resolve at launch; do not reuse evidence across changed versions/models/configuration without revalidation.

Use `effectiveCap = min(configuredHardCap, verifiedInputEquivalentTrigger - positiveSeparation)`, with overflow-safe integer math. Additional conservative reservations may LOWER this cap but cannot turn unknown evidence into known. Native request input must be strictly below it, and automatic reuse also stays below80000.

The architect proposed reserving last output + UTF-8 bytes of the new instruction +8192. Treat this as a heuristic proposal, NOT a proven cross-runner bound: hidden framing, role/tool changes, post-request tool output/history, non-text inputs and native estimators may add more. A fixed8192 cushion does not prove those components fit. Require a validated conversion/reservation for an enabled path, or keep native unavailable. Record counted output separately; do not add it to the definition of LAST-request INPUT.

If compaction is explicitly disabled and that state is verified, use a validated usable model/input limit rather than infinity; unknown effective hard limit still forces fresh. No guarantee is made that subsequent model generation never compacts.

## 5. Enablement and review status

Implementation may proceed on lifecycle, contracts, projections and conservative unknown-bound behavior. Each enabled native-reuse path needs version/config fixtures and the evidence above. Native local metadata/control calls may be bounded and non-inference; do not add provider inference, poll transcripts or export raw settings/secrets to the ledger. Unavailable local metadata is a fresh fallback, not an excuse to guess.

Architect task `task-0830556f-c081-4a66-87f0-5a86986980fa`, attempt2, result/end51091/51092 is accepted as bounded research with the Lead corrections above. It does not establish a universal160k safe cap or completed runtime enablement. Remaining checks: Claude control response/accounting/precompute; complete Codex effective model/config/post-turn evidence; OpenCode selected execution path/config and provider input semantics. Source formulas and runtime observation support must not be conflated.

## 6. Single-lane runtime investigation: no enablement established

Architect attempt3 (result/end58786/58787) investigated Codex0.162.1, completed predecessors,272k catalog window and Total scope. Full bounded report: `/tmp/delegated-continuity-native-lane-proof.md`. Lead directly verified tagged `core/src/session/turn.rs` pre-sampling order and post-sampling trace fields, plus `core/src/context_manager/history.rs` counted-context calculation. Local diagnostic observations reported244800/258400 limits; these are observations, not universal current model settings.

The counted resume context includes last request total plus estimated subsequent items and, depending on native state, earlier reasoning. The last request INPUT remains the approved policy measure; it cannot alone establish the extra accounting required for a safe effective cap. No adequate supported contract was identified for this lane. This is a bounded investigation conclusion, not an exhaustive claim about every native API.

The proposed alternative reads Codex internal SQLite logs, catalog cache and native rollout history with version-specific parsing. It is **not a verified resolver**: replay/item-bound equivalence, configuration/catalog freshness across resume and parser limits would still require proof. Raw serialized byte arithmetic is a proposal, not accepted evidence of safety. Such native-history coupling adds behavior and maintenance beyond the current ledger/event-based candidate and is not authorized by this research outcome. No production parser or resolver was added.

Production remains fresh-only under the approved unknown-evidence rule, including explicit native requests and otherwise eligible interruptions. The existing fresh-default implementation has completed review; native enablement remains an explicitly unavailable behavior. Research used no model requests and did not activate the candidate.

### Accepted first-delivery disposition

The user subsequently accepted the limitation and explicitly excluded internal Codex databases/history reads from this change. Codex native support is deferred as P-015. OpenCode remains fresh. Claude also remains fresh because effective control/precompute semantics and the input-equivalent bound in section2 are still unverified; reliable per-message input alone does not establish native eligibility. This is the user's conditional fresh-all option, not an assertion that Claude has the same missing data as Codex. No further native-source investigation or resolver is required for first delivery. High interrupted-continuation acquisition cost should prioritize P-014 member steering instead.
