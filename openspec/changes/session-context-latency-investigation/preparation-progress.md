# Preparation breakdown implementation and baseline

## Outcome

Following the user's instruction to proceed, implemented a bounded, provider-neutral tool-preparation diagnostic and collected more precise historical milestones for Claude and Codex. The candidate is tested in the checkout; it has not been installed into or activated in the running daemon. No inference calls or quota-consuming model benchmarks were performed.

This is a measurement slice, not a claimed latency fix. It makes the next optimization decision reviewable without modifying native context, model effort, permission enforcement, process lifetime or UI paging.

## Acceptance and implementation

- Each observed per-turn tool resolver call produces one `diagnostic` with `code: turn.preparation-detail`, `phase: preparing-tools`, attempt, outcome, total resolver duration and bounded stage durations.
- Stage names are restricted to `native-memory`, `native-mcp-config`, `capability-policy`, `memory-transport`, `codebase-readiness`, and failure `cleanup`. Unknown names are discarded; repeated names aggregate into the same entry. Callbacks after completion cannot mutate the measurement or emit more events.
- Success, failure and cancellation record terminal outcomes. `completed` means the resolver returned, not that every optional capability was ready. No exception text, configuration, paths, credentials, prompts or model outputs enter this diagnostic.
- The existing host clock measures boundaries. No new native requests, timers, forced fsync, history reads or per-token instrumentation were introduced. The diagnostic follows normal bounded event persistence; existing UI state does not require a new control or polling loop.
- The callback is optional and observational. Resolver code catches observer errors, retaining its original preparation and cleanup behavior. Existing integrations without callbacks remain supported.

Implementation: [host context and timing](../../../packages/session-host/src/session-manager.ts), [production resolver stages](../../../apps/cli/src/session-shared-services.ts). The existing production composition passes the context through `createCrossSessionService`; both Claude and Codex use this path.

Durations are exclusive intervals between stage boundaries, with repeated labels accumulated. Total duration spans the resolver call; a custom resolver can leave initial time unlabelled. The broader existing `preparing-tools` phase also includes host work after resolver return (credentials, policy and input assembly), so its total need not equal the new resolver total. Native memory disabled still reports the short decision path. This is not a billing metric.

## New measurements

### Local adapter configuration inventory

[measure-native-config.ts](measure-native-config.ts) invokes production adapters' read-only `readSessionMcpServers` three times each. It does not call `startTask`, install anything, start model inference or print specs. [Results](native-config-measurement.json):

| Runner | First observation | Second | Third |
| --- | ---: | ---: | ---: |
| Claude | 479.362 ms | 3.600 ms | 3.536 ms |
| Codex | 256.273 ms | 3.246 ms | 3.057 ms |

Both returned one selected server. These runs measure source-checkout inventory against local installed tooling, not the current daemon's entire setup path. They demonstrate that repeated inventory alone is not a sufficient explanation for the previously observed multi-second preparation medians on this machine. They do not justify removing validation or assuming other machines have identical caches.

### Historical task-attempt milestones

[measure-turn-latency.py](measure-turn-latency.py) pairs existing preparation, native-init, first activity, first assistant message, and terminal events by session/task attempt order. [Results](turn-latency-measurement.json) cover seven local repository sessions, not the community machine:

| Milestone from preparation start | Claude median (observations) | Codex median (observations) |
| --- | ---: | ---: |
| Native adapter start | 12.883 s (142) | 15.681 s (246) |
| First activity (message, tool start or reasoning delta) | 16.817 s (142) | 22.104 s (245) |
| First nonempty assistant message | 33.981 s (140) | 22.037 s (244) |

Populations differ due to missing milestones. In particular, do not infer activity occurred after output by comparing group medians. Workloads, model/effort, permissions, concurrency and historical builds differ; this is not a runner speed ranking or a matched benchmark. Native start remains adapter-specific, and first assistant text is not a measure of first model token or browser paint. Tool/approval waits can explain long delays before textual output. The collector excludes user/system/internal messages, ends correlation at turn completion, and resets it at each new preparation attempt; older ledgers still lack universal attempt identity on native events.

The Claude native-start records in this sample identify **2.1.301**. The bounded synchronous transcript checks inspected earlier require the exact **2.1.296** guarded path in current source. Therefore those checks cannot be presented as the cause of these observed 2.1.301 delays on the basis of that code. Do not generalize the initial version-specific candidate to all Claude use.

No new preparation-detail events exist in the retained sessions because the active daemon has not been replaced. The collector already understands the new stage durations and groups them by runner, stage and outcome for future measurements.

### Controlled local preparation, without model inference

[measure-managed-preparation.ts](measure-managed-preparation.ts) exercises the production resolver and managed Codebase readiness against installed local tooling. It uses a separate owned readiness service per runner, disables memory/web search for the comparison, runs three sequential preparations, releases each binding, and closes its own supervised processes and temporary runtimes. It never calls a model driver or replaces the running daemon. [Results](managed-preparation-measurement.json):

| Runner | First total preparation | Codebase portion of first preparation | Warm total, two observations |
| --- | ---: | ---: | ---: |
| Claude | 6,325.919 ms | 6,068.553 ms | 10.793 / 11.359 ms |
| Codex | 6,102.836 ms | 5,835.561 ms | 11.151 / 11.588 ms |

All six returned Codebase `ready`. Warm Codebase checks took approximately 6.7–7.7 ms. This isolates a real shared cold-start cost while demonstrating that reuse works in this bounded fixture. It does not prove repeated cold starts on the reporting machine or a six-second saving on every user turn. Native Claude/Codex initialization, inference, optional integrations, concurrency, long conversation state and the browser were outside this controlled preparation workload; unrelated machine load and filesystem cache were not controlled.

The next targeted diagnosis is cache/connection lifetime and invalidation in actual multi-turn sessions, plus native initialization. The cache key intentionally includes executable/spec/project/effective environment, and a failed warm check can create a new managed generation. Investigate why a real attempt becomes cold before removing validation or weakening those boundaries.

## Source constraints on optimization

- Shared Codebase readiness already deduplicates concurrent checks, caches executable verification by identity, reuses a live connection with a bounded warm tools-list check, and negative-caches failures. Treating all preparation as uncached was not supported.
- Native config inventory is a separate stage from that managed readiness check; the new boundaries let us identify which one is expensive on actual turns.
- Codex's additional inventory process is conditional on ready native memory hook attestation. It is not an unconditional two-process startup. Claude launches one native process per turn and resumes its native conversation when applicable.
- A common context-based explanation is still unproven. These observations support separating startup, actual activity, response text and UI delivery before choosing an optimization.

## Validation

- Initial RED: the two new Claude/Codex resolver-stage tests failed because no stages were observed. The initial host test load was blocked by missing `mdast-util-from-markdown`; it was not counted as a behavioral RED.
- Ran `bun install --frozen-lockfile --ignore-scripts` to reconcile the existing workspace installation. It reported no package changes; the host tests then loaded. No manifest or lockfile changed.
- Focused new tests: **6 passed**, covering both runner compositions and successful/failed/cancelled timing, invalid stage names, late callbacks, observer failure and no extra inventory/readiness calls.
- Complete touched-area suites: `bun test apps/cli/src/session-shared-services.test.ts packages/session-host/src/__tests__/session-manager.test.ts --timeout 30000`: **271 passed, 0 failed, 1,674 assertions**. Existing permission, task lifecycle, cancellation and recovery tests remained green.
- `./node_modules/.bin/tsc --noEmit --pretty false`: **passed**.
- Python collector correlation fixture: **1 passed**, covering interleaved tasks, user/internal output exclusion, first-delta selection, completion boundaries and a second attempt without output.
- Local config inventory and read-only historical collectors completed successfully. Git whitespace check passed. Runtime is available Bun 1.4.0, not the release-pinned 1.3.12; this is not release qualification.
- Isolated managed preparation completed six runs, all Codebase-ready, with cleanup in `finally`. Initial harness import/entry-path mistakes were corrected before the successful run; they are not production startup failures.
- OpenSpec validation and local artifact link/JSON/whitespace checks completed; the Apply preconditions artifact records scope and rollback without claiming a separate earlier gate.

Reviewed the candidate for bounded cardinality, data minimization, callback lifetime, cancellation, error propagation and dependency direction. No adapter imports were added to session-host. This is a Lead source review plus tests, not an independent specialist certification.

## Next measurement and decision

The isolated fresh/warm preparation comparison is complete. Run the candidate daemon in an explicit development/canary session to populate substage timings during ordinary work; the existing daemon cannot emit newly added fields. Establish matched fresh/continued/long-session native model workloads only when necessary, with explicit version/build, tools, effort, permission, warm-state and concurrency metadata. Use the existing browser acceptance fixture for connected/disconnected UI comparisons rather than recreating tests.

Choose a runtime optimization after the new traces distinguish managed readiness, configuration, host input assembly and native initialization costs. Removing checks, changing native process lifetime or rewriting context is not authorized by an unmeasured hypothesis. The original community correlation and end-to-end matched live benchmarks remain outstanding; neither is claimed completed by this slice.
