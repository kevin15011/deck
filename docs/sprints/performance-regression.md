# Interactive performance regression — correction installed and user-confirmed

The user reports severe lag in the installed S7a interface, including textarea input, and increased WSL memory. They confirmed that they had stopped and restarted the host and the interface remained slow after Lead cancelled the concurrent S5c compilation. This is an unresolved product regression; compiler contention alone is not an adequate diagnosis.

## Exact subject and observations

Reported baseline binary SHA-256: `1cccd49760bc33ee14a7a64dfec6bbf7ab52d029cd2c03af5da844f0f8f81c0a`; accepted S7a source/assets are frozen in `target/review-s7a-d9d409cd/`. Current working source contains unfinished S5c changes and must not be confused with what the user is running. The final section records the subsequent isolated correction and installation; earlier observations describe the original investigation.

Before cancellation, two Rust compiler processes in this workspace were consuming several CPU cores. The initial Linux snapshot showed approximately 3 GiB used, 12 GiB reclaimable cache/available memory and 1.2 GiB swap occupied. After cancellation, no cargo/rustc remained in the sampled process list; the restarted installed host occupied approximately 14 MiB RSS, with 2.3 GiB Linux memory used and about 13 GiB available. These snapshots do not prove a leak, rule out earlier pressure or establish Windows browser memory usage.

Lead sampled the actual running host without provider turns or project/database mutations. Eight sequential samples per endpoint returned HTTP 200: workspace median 1.876 ms/max 2.285 ms (35,354 bytes, two sessions, 16 receipts, no delegated tasks), changes median 1.588 ms, configuration median 2.037 ms. [Exact sanitized samples](../../target/performance-regression/lead-api-baseline.json) retain all timings. These Linux-loopback measurements do not include Windows forwarding, main-thread work, rendering or input-to-paint latency.

Source leads, not diagnosed causes: the installed client fetches the entire workspace every 500 ms and replaces its projection, holds controlled draft state at App level and synchronously persists each edit. Transcript scrolling reads layout on workspace updates. Markdown already has memoization. Runner availability checks path existence, not a full executable hash; the empty changes endpoint does not hash an executable. Avoid unsupported explanations based only on these patterns.

## Work and verification

Lead stopped production task attempt 19 to remove compilation interference and preserve unfinished S5c work. The existing Investigate task `task-76e6fa3d-3149-4331-a9b0-c73eacd44679` now owns bounded frontend/browser profiling using the installed frozen candidate, one disposable Chromium session and sanitized ignored evidence. No user host restart, provider turn, production edit or credentials in evidence is authorized by that diagnostic handoff. Lead owns API/process sampling and this record. Production fixes return to the original Apply Deep owner after a measured cause is established.

Measure warm typing and input-to-paint, main-thread long tasks, layout/paint, motion and polling separately. Compare polling paused, reduced motion and representative retained history when useful. A Linux-headless non-reproduction must be stated as such; it cannot invalidate the user's Windows report. Compare any fix with the exact preceding candidate under the same workload and retain draft/reconnect/command-identity behavior. Do not package unfinished S5c as a performance hotfix. Heavy builds and broad tests remain stopped during interactive measurements; necessary subsequent builds must use constrained concurrency.

The all-sprint objective remains active, with interactive performance taking priority. S5c delivery and later scope are not cancelled or accepted by this interruption.

## Diagnostic execution handoff

Investigate attempt 26 (events 190010/190011, report SHA-256 `5b4ab409415ebfcc50fa35bc26283dff5433b33c4e10afda2bc67907a826f04f`) could not run a browser because its runner restricts network and filesystem access. It produced no browser evidence. Lead independently observed the same user host still listening at port 39811 and had already sampled authenticated API responses successfully. Integration **190399** therefore records the runtime limitation as blocked, not a failure of the user's host or a frontend diagnosis.

The existing production Apply Deep task has accepted actual runtime/browser measurement and, only if supported by a measured cause, a minimal performance correction. It must use frozen S7a for the baseline and an isolated S7a working copy for any deliverable hotfix, preserving unfinished S5c. Builds are deferred until measurement warrants them and constrained to low concurrency. Lead still owns documentation and installation. The user has now confirmed Windows Zen and severe lag on every click and every keystroke. Actual Zen/Firefox interaction is therefore the affected acceptance target; Chromium is only a comparison. Neither a fast Linux Chromium run nor changing browsers closes this report. No browser-specific cause is established yet.

The browser observation is current user evidence, not inferred from process counts. Profile event handling, repeated layout and paint/compositing in the affected engine. Preserve the original visual design and GSAP behavior; disable individual effects only within an owned measurement experiment, and require evidence before selecting a production correction. Do not modify the user’s Zen preferences, extensions, acceleration settings or personal profile to make the application appear to pass.

## Chrome comparison access interruption

The user's Chrome comparison showed HTTP 403, correlation `7dc6c5d6-da0d-49db-a3b2-3edff6b1e5f1`. Read-only diagnostic inspection found `expired_launch` immediately before `session_required`. Installed S7a keeps one pending launch capability; issuing another replaces it. Concurrent diagnostic browser launches can invalidate a previously supplied unconsumed user link. This access failure is separate from the original Zen input delay and prevents treating the screenshot as a Chrome performance result.

Lead generated a fresh capability in memory and dispatched it directly to the installed Windows Chrome executable in a new window. The launcher returned zero; authenticated browser state was not observed by Lead. No token was retained in this record. Further diagnostic launches should use an owned host to avoid invalidating user comparison links.

## Connected-state comparison and measured entrance loop

The user now confirms the same extreme delay in Windows Chrome: the unauthenticated/disconnected screen is fluid, while every key and click becomes slow after connecting. This broadens the affected browser evidence beyond Zen and points to connected UI work; it does not establish a native-model latency cause.

While production attempt 20 remains running, Lead inspected its retained baseline, observer counts, hidden-entrance ablation and isolated one-line production diff. The installed `useEntrances` observes added descendants, including conversation controls inside the hidden mobile navigation. Animating hidden nodes can cause GSAP to temporarily reparent them to measure transforms, which produces more observed additions. The proposed correction excludes nodes without layout rectangles before starting an entrance. This is a concrete reproduced product defect, but candidate verification and Windows outcome are still pending.

The actual Linux Chromium baseline with 18 receipts/two sessions recorded 21 long tasks and key-to-animation-frame p95 32.1 ms/max 107.4 ms during a 207-key run. A controlled in-memory hidden-node guard run on the same workload recorded zero long tasks and p95 16.2 ms/max 17.3 ms. This ablation supports the targeted correction; it is not an installed-binary result or Windows measurement. Browser Event Timing durations in the raw records require separate interpretation and are not used here as an INP or paint-latency claim. Exact evidence is retained under `target/performance-regression/browser/`; the isolated hotfix is still under verification and S7a remains installed.

## Accepted correction and independent verification

Production attempt 20 (events 193081/193082, report SHA-256 `e8d74fbc185b2599624733bb1a37186c59779007d4e1d4489ca51de174b07ca0`) delivered isolated candidate `ef86509f7f3f0b107dfbe94721518c99b19196b81a77c112391e81380751bdbc`, binary `c349c815e08509f9b2bb04b247d71d1580ae3d1ee02536d4b4aa114a6d20137c`. Lead read the full report, material source and test fixtures, then rematched the frozen 124 inputs, 22 assets, recipe and executable. Relative to accepted S7a, the only production change is the hidden-node guard in `useEntrances`; the additional input is `scripts/entrance-regression.cjs`. Rust, dependencies, API 5 and schema 8 are unchanged. Partial S5c is excluded.

Lead independently executed the same focused regression against both frozen binaries. Original S7a failed with 168 hidden conversation-control reinsertions; the correction passed with zero. The corrected run also passed retained draft across reload, composing Ctrl+Enter without submission, and mobile drawer navigation with normal/reduced motion. The oracle forbids repeated reparenting while editing, rather than asserting a particular implementation or animation constant. Original/repaired runs took 6.241/7.092 seconds. [Commands and results](../../target/performance-regression/lead-review/runs.json), [red](../../target/performance-regression/lead-review/entrance-before.json), [green](../../target/performance-regression/lead-review/entrance-after.json).

The independent packaged comparison used Chromium 156.0.8078.79 on Linux, owned disposable hosts and synthetic workspace projections, without provider turns or concurrent compilation. Returned browser asset hashes match the corresponding frozen manifest. The workload types 204 characters and performs eight navigation clicks with polling and normal motion enabled:

| Scope | Original S7a | Corrected |
|---|---:|---:|
| No receipts: key-to-animation-frame p95 | 26.6 ms | 16.5 ms |
| 16 receipts: key-to-animation-frame p95 | 52.5 ms | 16.3 ms |
| 16 receipts: layout count | 6,834 | 210 |
| 16 receipts: long tasks | 14 | 0 |
| 16 receipts: main-thread task duration | 4.277 s | 1.678 s |

Profiling commands took 23.450/21.186 seconds. These are controlled comparison measurements, not Windows timings, physical paint latency, INP, provider-response benchmarks or broad performance guarantees. The owner's earlier comparison is separate evidence and has different timings/counts. [Lead comparison and identity review](../../target/performance-regression/lead-review/review.json) links to raw packaged profiles under the same performance directory. All owned fixture browsers/hosts were closed; the user's host was untouched.

Matched owner gates are reused: 115 Rust passes with four pre-existing ignored tests, 13 frontend passes, formatting, Clippy, TypeScript, package build and affected browser/motion regressions. Eight commands took 120.799 seconds in total; [gate records](../../target/performance-regression/gates/results.json) retain commands, candidate and logs. No protected boundary changed and no contradictory verification remains for the one-line correction; Lead's independent red/green and packaged replay support bounded acceptance without another general review cycle. Integration **193406** accepts this correction, not resolution of the user's Windows report.

## Installation and remaining confirmation

At **2026-11-11T15:48:26.742601+00:00**, Lead atomically installed frozen binary `c349c815…` at `/home/kevin15011/.local/bin/deck2`, verified the installed hash/version and retained prior `1cccd497…` under `target/installed-backups/`. [Installation evidence](../../target/deck2-performance-install-evidence.json) records exact paths and identities. No live state was opened, no migration occurred and no user host was restarted. PID 2039044 still used the old binary at installation time.

The user must stop the foreground host with Ctrl-C and run `/home/kevin15011/.local/bin/deck2 serve --project /home/kevin15011/deck` again, then load the authenticated new page. If WSL opening fails, `deck2 open --state-dir /home/kevin15011/.local/state/deck2 --print-url` provides the private single-use link; only the newest unconsumed link is valid. Existing browser-local drafts remain associated with the saved origin.

Actual connected typing/clicking in Windows Zen and Chrome remains to be confirmed after restart. Do not close the original report from Linux evidence alone. S5c source remains preserved and unaccepted; heavy implementation builds remain interrupted during user validation. The all-sprint objective and outstanding S5c/S7b/S8–S12 scopes remain active.

## User confirmation and implementation resumption

On 2026-11-11, after delivery of the installed correction and restart instructions, the user stated: “Si, ya no hay lentitud, continuemos”. This closes the reported interactive-lag interruption on user-observed behavior. It is not a separate quantified Zen/Chrome benchmark, memory-leak finding or proof of automatic WSL authentication; S1-Q07 remains open. The earlier pending statements above describe their observation time.

Resume the preserved S5c work on the original production task, retaining the entrance guard and its packaged regression. Limit compilation to two low-priority jobs, avoid overlapping heavy builds with interactive measurements, and keep provider/host/browser latency measurements distinct. The installed accepted build stays `c349c815…` until a new candidate is reviewed and installed.
