# Continuity policy evidence and baseline

## Source verification

Verified on 2026-10-22 against the working tree after commit `d2eafd2`. Graph project `deck` reported generation `2026-08-20T17:25:00Z`; symbol discovery returned no matching session-manager nodes, and exact-path coverage reported `not_tracked`. The following claims therefore use direct source reads, not a claim of complete graph coverage.

| Evidence | Verified current behavior |
| --- | --- |
| `packages/session-host/src/session-manager.ts:609`, `delegate()` | Requires the original member on continuation. Prior assignment retains runner/model/thinking. |
| Same file, lines 622 and 645–660 | Rejects running/queued task continuation with `task-running`; reuses the prior nativeSessionId, sets resume when confirmed and records native continuity. |
| Same file, lines 841–850, `taskSummary()` | Scans task messages from the session log, retains at most eight message fragments, bounds each at 2,048 characters and the combined summary at 8,192 characters. It is not yet the structured task/criteria/report/diff/findings handoff requested here. |
| Same file, lines 1752–1767 | Existing missing-native-session recovery creates a new native identity, records a reseeded attempt and relaunches without resume using a bounded task summary. This is the mechanism to extend, not duplicate. |
| Same file, lines 1385–1390 and 1595 | Steering targets the Lead and requires `steeringAllowed`; eligibility is assigned only to the Lead. This belongs to the separate steering proposal. |

These references establish the policy starting point. They are not a completed architecture trace or a design. The existing fallback scan must not simply be copied into a new frequent hot path.

## Historical run boundaries

Session: `20261022T003008-6f199c`. Source: its local `events/*.jsonl` ledger; no conversation content or credentials are reproduced here.

- Overall: seq 36141 at 16:34:19.256Z through seq 43678 at 17:46:22.178Z; 4,322.922 seconds, excluding daemon activation wait.
- Formula investigation ended at seq 38132, 16:44:13.175Z, while implementation attempt 3 ended at seq 39273, 17:00:13.901Z: 960.726 seconds later.
- Mid-turn feedback continuation failed with `task-running` at seq 37443. This identifies a separate steering limitation, not an input to the continuity implementation scope.
- Implementation/review attempt intervals: apply 3 = 1,434.973 s; apply 4 = 934.793 s; quality 8 = 350.898 s; apply 5 = 922.986 s; quality 9 = 186.514 s. These include preparation and differ from native-turn durations below.

## Missing step counts, now verified

Tool counts below are unique `tool.started.data.toolCallId` within the exact task/native-turn range; raw start count and unique count agree. One invocation can run multiple commands. Usage observation counts are not automatically equivalent to provider HTTP requests.

| Task/attempt | Native turn seq range | Turn duration (s) | Tool calls | Usage observations | Mean native input per observation | Turn seconds / tool call |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| apply-deep / 3 | 36830–39271 | 1419.2 | 45 | 28 | 300,194 | 31.5 |
| apply-deep / 4 | 39534–40657 | 921.4 | 50 | 37 | 111,780 | 18.4 |
| quality / 8 | 40947–41836 | 342.4 | 27 | 16 | 177,207 | 12.7 |
| apply-deep / 5 | 42080–42737 | 912.8 | 22 | 18 | 185,360 | 41.5 |
| quality / 9 | 42990–43404 | 177.4 | 8 | 6 | 147,601 | 22.2 |
| Total | | 3773.2 | 152 | 105 | — | — |

The last column is an amortized wall-time ratio, NOT measured model-request latency: it includes tools, compaction, concurrency and different amounts of generated output. These five mixed workloads do not establish a monotonic context/latency relationship (apply 5 has less mean input than apply 3 yet a larger ratio). Future telemetry must correlate per-step intervals, output volume, context and runner/model/thinking rather than infer causality from this ratio.

## Output, context and measured waits

- Last-usage output sums: 108,737 tokens, including 56,414 reasoning tokens. Within each turn, all adjacent cumulative output/input/cache/reasoning deltas matched the corresponding last counters, supporting the sums without repeated-counter inflation.
- Observed tool interval union: approximately 354.6 seconds across the five turns. Tool category attribution is heuristic and is not an exact command count.
- Compaction: seq 39609–39612 = 183.334 s; seq 43218–43221 = 84.306 s; total 267.640 s.
- After those intervals and first-tool latency, the residual is approximately 3,098 seconds. 108,737 / 3,098 is approximately 35.1 output tokens/s, consistent with generation dominating that residual. This is inferred throughput, not independent instrumentation of generation time or proof of the context-prefill cost.
- Apply 4 first reported total context: 337,810 tokens; quality 9: 202,889. The native runner performs compaction; the baseline does not establish host transcript replay.
- Cached input ratios range from 95.8% to 99.4%. Cached input remains context, but these figures do not establish equivalent uncached processing time, monetary cost or quota accounting.
- Two defect findings drove one correction round (apply 5) and one re-review (quality 9). Apply 4 was a scope/UX refinement, not automatically a defect-rework round.

## Evidence limits

This is one historical Codex implementation/review chain. It must not be generalized into measured Claude/OpenCode performance or a guaranteed improvement. Before/after comparisons must include comparable task purpose and runner/model/thinking settings. First usage observations are often post-response, not measurements at the exact instant of launch. No live runner calls or new benchmark inference were made for this proposal.

The user accepted this limitation and set the change rationale to compaction cost, defect rework and review independence. The new eligibility threshold uses LAST-request INPUT including cache, not the historical total-context figures quoted above. A runner-specific extraction contract belongs in the design; the occupancy figures in this baseline must not be reused as policy inputs.
