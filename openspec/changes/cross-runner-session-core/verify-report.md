# Verification: Cross-Runner Session Core

## Release-preparation follow-up — passed (2026-10-15)

Full repository6693pass/3optional skip/0fail,44952assertions across489files; canonical memory benchmark, compiled memory verification, host build dry-run and TypeScript pass. Final installed artifact978127fa90ed5075deb18640bb6f22a46ec9b28b45d97cb78804ce5ffb0c4b90 passed compiled session/web67 and memory smoke while sandbox-denied all checkout reads, with a confirmed negative-read control and identical isolated/installed SHA-256. Red removal text verified in eight desktop/mobile themed menus. See `release-readiness.md` for logs, optional-test limits, legitimate external dependencies and activation. No claim of exhaustive native/provider or all-platform execution.

## Session release/actions follow-up — passed (2026-10-15)

Root affected host/core/CLI/schema570/3386 and final UI/assets/docs80/1079 passed. Final owned host201/900 includes release failure/busy and exact recovery-prefix checks; these overlap integrated coverage. TypeScript, canonical schema generation and all four target builds pass. Actual browser lifecycle6, queue6 and workspace17 pass, with inspected desktop/mobile dark/light/open-menu captures. Installed compiled67 checks prove same native identifier after release/reprepare, saved images/conversation, legacy same-ID reopening, stale command safety and durable rename/removal across restart. Logs use `/tmp/deck-session-release-*` and `/tmp/deck-web-release-*`; see `session-release-brief.md` for exact paths and activation.

Verification used temporary state and fake native protocols, without real provider inference. User canary activation used the guarded idle restart; user histories/configuration were not modified by tests. Earlier report sections below are historical.

Result: **passed**, 2026-10-13 UTC. All required S0–S5 implementation and final gates are complete. Optional task 4.10 remains deferred by the accepted scope. This report supersedes intermediate failed/incomplete checkpoints in the chronological apply log.

## Final evidence

| Gate | Result | Evidence |
|---|---|---|
| Frozen-workspace full suite, Bun 1.3.12 | 6,373 pass, 3 skip, 0 fail; 43,389 assertions, 470 files, 340.03 seconds | `/tmp/deck-cross-final-suite.log` |
| Required preflight, install contract and TUI gates | 64 pass, 0 fail | `/tmp/deck-cross-final-required-gates.log` |
| TypeScript | Clean | `/tmp/deck-cross-final-tsc.log` |
| Release verification | Passed memory benchmark, compiled Supermemory verification and host build | `/tmp/deck-cross-final-release.log` |
| Four-target standalone build | linux-x64, linux-arm64, darwin-x64, darwin-arm64 built after final production repair | `/tmp/deck-cross-final-build.log` |
| Darwin arm64 compiled CLI | 57 single-runner, 6 cross-runner and 11 web checks passed | `/tmp/deck-cross-final-host-{single,cross,web}.log` |
| Linux arm64 compiled CLI | Same 74 checks passed, container exit 0 | `/tmp/deck-cross-final-linux.log` |
| Compiled desktop browser | Pair, prompt, actual bridge approval, tab-close replay, allow-once and native fixture response passed | `/tmp/deck-cross-final-host-browser.log`; screenshot `/tmp/deck-web-compiled-desktop.png` |
| Native three-runner acceptance | Claude Lead delegated to Codex and OpenCode; both recalled/proposed memory; one deduplicated write; gap-free replay; all tasks completed | `/tmp/deck-s3-cross-live-final.log` |
| Native individual driver contracts | Claude 8/8, Codex 9/9, OpenCode 10/10; reviewed versioned safe shape manifests | Earlier evidence in `apply-progress.md` |
| Independent review | No outstanding source blockers after repairs | `review-report.md` |
| Final documentation and registry | 18 documentation tests passed; OpenSpec validation 0 errors/0 warnings, review approved; diff check clean | `/tmp/deck-cross-final-docs.log`; `/tmp/deck-cross-openspec-final-validation.json` |

The final full command was `TMPDIR=$(realpath /tmp) npx -y bun@1.3.12 test --timeout 30000`. No repository writers ran concurrently. The previous run found two fixture issues: an opaque runtime-input spread that prevented the hermeticity audit from proving isolation, and an obsolete expectation that missing credentials still exposed bridge tools. Both fixtures were corrected without changing production behavior or weakening either guard. The repeated full suite passed. No baseline exception was added.

## Requirement coverage

- S0: event/command schemas, redaction, qualified assignments, configuration and downgrade behavior.
- S1: durable events/receipts, process ownership and drain, recovery, scoped credentials and approvals, terminal replay, Claude isolation and ToS gate.
- S2: Codex/OpenCode native protocols, isolated child MCP configuration, approvals, interruption, native continuation and safe shape evidence.
- S3: authenticated Lead-only delegation, queued worker cap, completion wake, immutable ownership/change binding, typed reseed, shared memory deduplication and web-search composition.
- S4: embedded desktop assets, loopback HTTP/WebSocket service, pairing/revocation, Host/Origin/proxy/CSP boundaries, approval replay and CLI/Doctor controls.
- S5: cross-member TUI configuration, native-flow regression coverage, prerequisite/ToS review, atomic persistence and operational/security documentation.

The worker cap is four delegated tasks by default with a separate Lead coordinator slot, as specified in XR-6.8. Pi source remains unchanged. Existing unrelated worktree changes are preserved.

## Limits and deliberate exclusions

- Linux runtime verification used an unprivileged `oven/bun:1.3.12` container with networking disabled, copied binaries/fixtures only, and no repository or credential mounts. The repository installation-sandbox image was unavailable. Darwin/Linux x64 were build-verified only; arm64 ran on both platforms.
- Native versions exercised: Claude 2.1.296, Codex 0.162.1, OpenCode 1.18.31. The three-runner test used Claude `haiku`, Codex `gpt-6-luna` and OpenCode `opencode/big-pickle`.
- Native delegated memory acceptance used a synthetic host memory port, proving real tool routing and single-writer behavior without writing to the real provider. Separate composition tests exercised the actual Supermemory runtime with a fake transport. Live provider ranking, every configured third-party MCP package and future runner versions are outside this evidence.
- The final Codex guard tightening was regression-tested after the native acceptance; the unchanged valid form was not sent to the provider again. The final binaries include the tightening and passed compiled smoke.
- Three standard opt-in tests remain skipped: previous-version recovery requiring an external binary, real canary compile/install, and an actual pinned RTK hook. No canary/global installation, native runner credential-file access, network exposure, commit, push or publication was performed in this continuation.
- Optional `deck cross expose` (4.10) is deferred. The local feature requires no Tailscale, OS service or remote access.

Logs under `/tmp` are local execution evidence and may expire; this report preserves their results and scope. The working tree contains the completed implementation and remains uncommitted.

## Canary feedback verification — 2026-10-13

This section supersedes the historical local pairing/Claude acknowledgement coverage above for the current candidate.

| Gate | Result | Local evidence |
|---|---|---|
| Frozen full suite | 6,421 pass, 3 skip, 0 fail; 43,563 assertions; 473 files | `/tmp/deck-canary-feedback-full.log` |
| TypeScript | Clean | `/tmp/deck-canary-feedback-tsc.log` |
| Release verification | Passed memory benchmark, compiled Supermemory checks and host build | `/tmp/deck-canary-feedback-release.log` |
| Four-target build | All Linux/Darwin x64/arm64 archives built after the final source repair | `/tmp/deck-canary-feedback-build.log` |
| Darwin arm64 binary | 57 single-runner, 6 cross-runner, 11 web checks | `/tmp/deck-canary-feedback-host-{single,cross,web}.log` |
| Linux arm64 binary | Same 74 checks; unprivileged, network-disabled container exit 0 | `/tmp/deck-canary-feedback-linux.log` |
| Compiled desktop browser | Automatic local access, prompt, actual bridge approval, tab-close replay, allow-once and fixture response | `/tmp/deck-canary-feedback-host-browser.log` |
| Real managed Codebase Memory | Exact pinned artifact; 9,351 ms cold preparation, 11 ms retained health check; same runtime/canonical cache; leases released and namespace removed | `/tmp/deck-managed-cbm-acceptance.log` |
| Independent final review | Approved; both final blockers repaired | Follow-up in `review-report.md` |
| Final documentation and registry | 18 documentation tests passed; OpenSpec validation 0 errors/0 warnings, review approved; diff clean | `/tmp/deck-canary-feedback-docs.log`; `/tmp/deck-canary-feedback-validation.json` |

The full suite ran without concurrent repository writers. The three skips remain opt-in external-version/canary-install/actual-RTK tests. Pi source is unchanged. The release verification host build preceded the last Claude guard repair; the subsequent four-target build, full suite and compiled acceptance include that repair. No new paid native model inference was required for this follow-up.

The installed user's two Claude turns spent 33.390/31.673 seconds reaching native initialization and reported 2.858/2.109 seconds of native model work. A direct MCP probe reproduced a 30-second unhealthy shared endpoint wait. Supported `CBM_RUNTIME_DIR` isolation with the same 0.11.0 executable and canonical cache succeeded. Version difference alone was not proven causal. The retained-health timing is not a claim of 11 ms model responses; native frontend startup still has its own cost. Cross-build coexistence and arbitrary future releases are not certified: unknown artifacts/releases fail explicitly under the reviewed policy.

Local automatic access trusts any process/OS account able to reach the loopback listener with the required Host/Origin request; forwarded access still requires explicit pairing. No existing user process was signalled, no installed canary was replaced, and no credentials, commit, push or publication were involved. Linux x64 and Darwin x64 are build-verified only. Original live three-runner evidence remains historical; current compiled smoke uses controlled native fixtures.

## Duplicate completion wake verification — 2026-10-13

The localized production repair is in `session-manager.ts`, with cross-runner regression coverage. Terminal results returned through authenticated Lead tools acknowledge their task attempt. The normal-completion and queued-cancellation paths do not queue another notice for that attempt, including when a synchronous wait callback observes terminal state before notice creation. Observer/nonterminal reads and aborted calls do not acknowledge results; later attempts and unseen tasks remain eligible for notification.

- RED reproduced three failures, including the exact single-worker unwanted second Lead start (`/tmp/deck-completion-delivery-red.log`).
- Focused owner verification: 104 pass, 0 fail, 363 assertions across three files; mixed results, partial timeouts, abort, future attempts, scheduled wake, failure/cancellation and authenticated socket delivery (`/tmp/deck-completion-delivery-green.log`).
- Broader affected verification: 425 pass, 0 fail, 1,321 assertions across 33 files; complete session-host/core-session and affected CLI suites (`/tmp/deck-completion-focused.log`). TypeScript clean (`/tmp/deck-completion-tsc.log`).
- All four standalone targets rebuilt (`/tmp/deck-completion-build.log`). Extracted Darwin arm64 cross smoke passed all six checks, including actual bridge delegation, native continuation and no repository references (`/tmp/deck-completion-compiled-cross.log`).

The preceding full repository suite (6,421 pass) and Linux/browser runtime results are historical evidence for the immediately preceding candidate, not reruns of this delta. This repair was verified with focused integration coverage and a fresh host binary; no new paid native inference, install, user daemon modification or publication occurred. Acknowledgement is at daemon tool-response return, not transport-level exactly-once delivery.

## Public daemon command verification — 2026-10-13

| Gate | Result | Evidence |
|---|---|---|
| Owner focused tests | 134 pass, 0 fail, 351 assertions / 5 files | `/tmp/deck-daemon-commands-focused.log` |
| Admission race regression | Two reproduced RED failures, then fixed with synchronous shared admission gate | `/tmp/deck-daemon-fence-red.log`; `/tmp/deck-daemon-fence-green.log` |
| Broader affected tests | 497 pass, 0 fail, 1,504 assertions / 35 files | `/tmp/deck-daemon-commands-broad.log` |
| TypeScript | Clean | `/tmp/deck-daemon-commands-root-tsc.log` |
| Independent Quality | Approved; 110 pass, 0 fail / 4 files | `/tmp/deck-daemon-quality.log` |
| Four-target build | Linux/Darwin x64/arm64 built | `/tmp/deck-daemon-commands-build.log` |
| Darwin arm64 lifecycle | 16 compiled checks passed | `/tmp/deck-daemon-commands-darwin.log` |
| Linux arm64 lifecycle | Same 16 compiled checks; container exit 0 | `/tmp/deck-daemon-commands-linux.log` |
| Host cross/web regressions | 6 cross checks and 11 web checks passed | `/tmp/deck-daemon-commands-{cross,web}.log` |

`daemon-smoke.ts` copies the extracted binary under the deck-canary executable name and uses an isolated temporary HOME/state/project plus a version-only fake runner. It creates a real idle session without inference, restarts an equal-version daemon, verifies original process settlement, and checks recorded runner, session metadata and existing event history. Status and absent stop are inert; repeated start is idempotent; stop confirms lock/discovery cleanup; restart-absent starts the current executable. Linux ran unprivileged with `--init` for proper orphan reaping, no network, no repository/credential mounts and only copied binary/harness. Darwin/Linux x64 remain build-only.

The preceding full repository suite and native model evidence are historical, not reruns of this increment. This public-command delta used affected suites and fresh compiled lifecycle/cross/web acceptance. No installed canary update, user daemon operation, model inference, credentials, commit or publication occurred. Automatic same-version build replacement and force shutdown are excluded. Commands can use the older daemon's existing graceful-stop handshake; admission fencing is implemented in the new daemon and cannot retroactively change an older running binary.

## Web workspace redesign verification — 2026-10-13

| Gate | Result | Evidence |
| --- | --- | --- |
| Broader host/session/CLI regressions | 412 pass, 0 fail, 1,311 assertions / 27 files | `/tmp/deck-web-redesign-host.log` |
| UI selectors, Markdown and embedded assets | 12 pass, 0 fail, 50 assertions / 3 files | `/tmp/deck-web-redesign-ui.log` |
| Documentation governance | 18 pass, 0 fail, 785 assertions | `/tmp/deck-web-redesign-docs.log` |
| TypeScript | Clean on final source | `/tmp/deck-web-redesign-tsc.log`; owner final rerun |
| Independent backend/frontend | 104 backend tests / 380 assertions; 10 frontend tests / 44 assertions | `/tmp/deck-quality-web-{backend,frontend}.log` |
| Desktop/mobile production transport browser | 22 checks passed by owner and independent reviewer | `/tmp/deck-web-browser.log`; `/tmp/deck-quality-web-browser.log` |
| Four-target distribution | Linux/Darwin x64/arm64 built, generated assets embedded | `/tmp/deck-web-redesign-build.log` |
| Extracted Darwin/Linux arm64 HTTP acceptance | 16 checks each, Linux container exit 0 | `/tmp/deck-web-redesign-{darwin,linux}.log` |
| Extracted compiled browser | Eight checks including real session project artifact render and refresh | `/tmp/deck-web-compiled-browser.log` |

Browser checks include canonical Lead-only conversation, separate tool/child content, semantic Markdown, exact code copying, relative artifact links, blocked HTML/remote images/unsafe URLs, automatic visible document/catalog updates, explicit deleted selection retention, stale session response rejection, per-session drafts, one command for rapid Enter, desktop collapse/mobile drawer focus, keyboard tabs, approvals across views, replay, preserved reading position/Jump to latest, failed partial output, revocation and optional remote pairing. Viewports include 1440px desktop, 390px mobile and 320px overflow checks. Root inspected actual desktop/OpenSpec/mobile captures; this is not a claim of exhaustive device or assistive-technology testing.

Screenshots: `/tmp/deck-web-desktop.png`, `/tmp/deck-web-openspec.png`, `/tmp/deck-web-mobile.png`, `/tmp/deck-web-mobile-activity.png`, `/tmp/deck-web-mobile-openspec.png`, plus compiled captures `/tmp/deck-web-compiled-{desktop,openspec}.png`.

Compiled HTTP checks cover unchanged CSP/authentication, embedded asset digest, real session-scoped catalog/read, disk updates, traversal denial, approval relay and cursor replay. Fixtures use isolated HOME/state/projects and fake native runners without model inference. Linux runs unprivileged with `--init`, no network and copied binary/harness only; no repository or credentials mounted. x64 targets are build-only. Symlink/component/descriptor checks reject existing escapes but are not an atomic sandbox against hostile concurrent ancestor replacement. OpenSpec is read-only, active-change Markdown only, capped at 1 MiB per file, 500 entries and eight path levels.

The 442 Root test total counts disjoint host, UI/asset and documentation runs; independent and owner counts overlap and are not added. Earlier full repository and native-provider evidence remains historical. This increment did not install canary, restart the user's daemon, run native model inference, commit or publish.

## Dark palette/header refinement — 2026-10-14

Localized presentation change verified with 12 UI/asset tests (50 assertions), clean TypeScript and all 22 existing browser checks against regenerated embedded web assets. Logs: `/tmp/deck-web-dark-{tests,tsc,browser}.log`. Lead inspected `/tmp/deck-web-dark-desktop.png` and `/tmp/deck-web-dark-mobile.png`: 56px header, dark surfaces and visible pending approvals. Measured normal text/action/semantic contrast pairs are at least 7.17:1. Idle approval status remains accessible without a visible row. Native binaries and full repository tests were not rerun for this visual refinement; prior distribution evidence describes the previous appearance. No installed-runtime changes.

## Persistent theme selection — 2026-10-14

12 UI/asset tests passed (50 assertions), TypeScript clean, expanded browser acceptance passed 27 checks. New browser coverage verifies dark default/invalid fallback, exact original light palette (normalizing equivalent minified hex notation), keyboard toggle, local-storage persistence across reload/new tabs, startup/switching with storage blocked, and both themes at 320px. Lead inspected actual light desktop and dark mobile captures. Logs `/tmp/deck-web-theme-{tests,tsc,browser}.log`; screenshot `/tmp/deck-web-theme-light.png`. Canonical web assets regenerated. Native distribution/full repository tests were not repeated; no canary or user daemon mutation.

## Compact message input — 2026-10-14

12 UI/asset tests (50 assertions), TypeScript and 30 browser checks passed on final regenerated assets. Browser checks measure actual line-height/padding: one initial line, two after Shift+Enter without submission, four-line cap with additional explicit/wrapped content scrolling, shrink on deletion, width-dependent reflow, and reset after sending. Existing rapid-send, draft, theme, mobile and Jump to latest checks remain passing. Final compact mobile screenshot inspected. Logs `/tmp/deck-web-input-{tests,tsc,browser}.log`. No native rebuild/full-suite rerun or installed-runtime mutation for this localized input change.


## Detailed Lead Activity — 2026-10-14

Root passed 176 adapter/core session tests (572 assertions, 18 files), 22 web/asset tests (100 assertions, four files), and 18 documentation tests (785 assertions): 216 disjoint tests total. TypeScript passed. Regenerated assets passed all 36 desktop/mobile browser checks, including Lead-only grouped details, explicit skill evidence, hidden child/lifecycle noise, keyboard disclosure, replay, historical redaction and truthful status. Root inspected desktop and mobile Activity screenshots. Logs: /tmp/deck-activity-{runtime-tests,web-tests,docs,tsc,browser}.log.

Independent checks overlap: 26 mapper tests/136 assertions and 20 web tests/94 assertions. Scoped OpenSpec validation passed with zero errors/warnings (/tmp/deck-activity-validation.json). An initial unscoped validation also examined unrelated legacy records and failed with 909 errors/753 warnings (/tmp/deck-activity-validation-all.json); this is not a claim that the entire registry is clean.

Pinned fixture/schema coverage supports tool mapping and OpenCode reasoning snapshots; Codex summary and Claude nonempty thinking behavior is covered with protocol-shaped deterministic tests, not new live inference. Native reasoning availability remains model-dependent. No live model calls, native binary rebuild, installed canary verification or daemon changes occurred. Existing compiled distribution results remain historical.


## Immediate Lead feedback and preparation timing — 2026-10-14

Final affected verification: 503 runtime tests/1,601 assertions/35 files; 29 UI and embedded-asset tests/139 assertions/five files; 18 documentation tests/785 assertions. Total: 550 disjoint tests. TypeScript clean. Generated assets passed 42 browser checks, adding immediate delayed-send feedback, receipt-scoped first events, explicit preparation phases, mobile/replay progress, failed-send draft preservation and terminal-before-HTTP-response handling. Root inspected desktop layout and the active mobile status screenshot. Logs: /tmp/deck-lead-feedback-{runtime,web,docs,tsc,browser}.log; capture: /tmp/deck-web-live-progress.png.

An initial broad run caught the expected additional diagnostic events in an old exact-sequence assertion; owner updated it and the final broad run passed. Final typechecking caught the browser fixture using a noncanonical failed ExecuteOutcome; the fixture now supplies code/message and TypeScript plus browser were rerun successfully. The preparation tests demonstrate RED/GREEN for actual boundary timing, synchronous/duplicate starts, blocked probes, resolver/start failures and cancellation.

Actual latest greeting ledger seq1901–1919 measured acceptance20:02:11.783Z, Claude init20:02:27.166Z, first text20:02:28.000Z and turn end20:02:31.543Z. Installed canary and daemon payload identity match. This is historical timing evidence from before the new diagnostics; no inference call or runtime mutation was made. Existing wall-clock timings are nonnegative operational estimates, not benchmarks. No latency improvement, compiled-runtime verification or installed-canary update is claimed.
# Native memory parity and hook Activity verification — 2026-10-14

- Frozen runtime/schema/composition: **607 pass, 0 fail, 2,032 assertions, 46 files**. Log `/tmp/deck-native-memory-runtime-frozen.log`.
- Web/assets/documentation: **51 pass, 0 fail, 950 assertions, 6 files**. Log `/tmp/deck-native-memory-web-docs-final.log`. These disjoint suites total **658 passing tests**.
- TypeScript: `tsc --noEmit` passed, log `/tmp/deck-native-memory-tsc-final.log`.
- Browser: **45 acceptance groups passed**, including hook init correlation, safe/provider details, mobile/replay and all previous workspace/progress behavior. Log `/tmp/deck-native-hooks-browser.log`. Root inspected `/tmp/deck-web-desktop.png` and `/tmp/deck-web-mobile-activity.png`.
- Generated session schema includes hook validation parity; web assets were generated through the canonical script. Initial aggregate exposed schema drift; it was corrected by updating the source schema and generator output. An interim run overlapped a driver repair and observed its earlier module snapshot; the frozen aggregate above is green.
- Native configuration evidence: actual read-only preparation returned the same canonical scope for all three installed integrations. Isolated installed Codex and OpenCode probes establish effective hook isolation and explicit plugin-tool registration without model/provider calls. See `native-memory-evidence.md` for exact limits.
- Four-target build: Linux x64/arm64 and Darwin x64/arm64 passed; log `/tmp/deck-native-memory-build.log`. Isolated compiled Darwin arm64 acceptance passed **6 cross-session checks** and **16 web/asset/security/artifact checks** using native fixtures, with no repository references. Logs `/tmp/deck-native-memory-compiled-cross.log`, `/tmp/deck-native-memory-compiled-web.log`. Other targets were build-verified only in this increment.

Automatic provider capture is not certified. Claude asynchronous Stop completion remains unverified; OpenCode disposal does not await its background plugin capture. Codex hook completion is not by itself a provider receipt. No real model call, provider write, user configuration mutation, canary installation or user-daemon restart was part of this increment.

Final scoped OpenSpec validation passed with zero errors and zero warnings; `/tmp/deck-native-memory-registry-final.json`. The repository-wide historical registry was not revalidated for this increment.

## Native no-confirmation and Claude project instructions — 2026-10-14

- Affected aggregate: 310 tests, 1,782 assertions, 17 files passed (`/tmp/deck-yolo-final-tests.log`). After the final memory-context clarification, 105 affected tests and 348 assertions passed again (`/tmp/deck-project-instructions-green.log`).
- TypeScript passed after correcting test fixture literal inference (`/tmp/deck-yolo-fixture-tsc.log`).
- Host Darwin arm64 build and six compiled cross checks passed (`/tmp/deck-yolo-build.log`, `/tmp/deck-yolo-compiled-cross.log`). Other-platform runtime verification is historical, not repeated for this increment.
- Independent Quality: 104 permission-path tests and 34 project-instruction tests passed; no blockers.
- Current project AGENTS.md was read safely (2,197 bytes), without disclosing content. The local session evidence disproves the reported Deck MCP disconnection; no model/provider request was made for this investigation.

Activation completed at 2026-10-14T23:51:04Z: installed canary payload `1020c2bff10fc52d7709c4cd1c9499e128672f3422607f08e7071b0ae413e145`; six isolated checks on that installed executable passed (`/tmp/deck-yolo-installed-cross.log`). Scoped DeckConfigStore patch set all three approvals to runner-default and verified all other normalized fields unchanged. Graceful restart replaced idle PID 29742 with 33717; daemon/web readiness and existing session `20261013T070713-c59247` were verified. No model/provider call was sent. The earlier immutable canary payload remains available for rollback; returning to it also requires restoring previous Claude/OpenCode relay policies.

## Activity follow and document bounds — 2026-10-15

The pre-fix browser reproduced document height 1,253 px for a 1,000 px viewport (`/tmp/deck-web-scroll-red.log`). Final browser acceptance passed 51 groups (`/tmp/deck-web-scroll-browser.log`), including live following, paused reader positions, detail expansion, replay/tab/session restoration, growing reasoning, vertical resizing and actual CDP touch interaction. The reflow race and immediate persistence of user pause were repaired before approval.

UI/embedded asset tests: 33 tests, 166 assertions passed (`/tmp/deck-web-scroll-tests.log`); documentation governance: 18 tests, 784 assertions passed (`/tmp/deck-workspace-evolution-docs.log`). Lead visually inspected desktop and mobile screenshots, including `/tmp/deck-web-activity-scroll-mobile.png`. These checks validate scroll corrections, not proposed project/session management APIs.

Final TypeScript passed (`/tmp/deck-web-scroll-tsc.log`). Installed Darwin arm64 canary passed 16 compiled web checks (`/tmp/deck-web-scroll-compiled.log`). At 2026-10-15T00:17:59Z the idle daemon was gracefully restarted from PID 34141 to 39401 with web readiness verified; payload `36db13de4b4a68e2d7060d2b313d543e58757d0043d5646533b773c85f08dc14`. No user configuration, session history or runner assignment was changed. Old immutable canary payload remains available.

## Global workspace — verified and activated (2026-10-15)

The integrated affected suite passes **867 tests, 3,630 assertions across 64 files** (`/tmp/deck-workspace-final-tests.log`), covering session host, canonical contracts/configuration, three native drivers, CLI composition, web projections and documentation. The first pass exposed outdated checks for permission defaults, new command documentation and Lead queue accounting; the final aggregate includes their corrections. TypeScript passed (`/tmp/deck-workspace-integrated-tsc.log`). The subsequent Unix project-registration admission correction passed 26 owner tests and 49 independent control/bridge tests.

Regression evidence includes provider-free preparation, timeout/cancel/late-release fencing, cleanup before ready, preserved unknown-owner reservations, cross-session fairness, queued cancellation, native drain before slot release, optimistic/idempotent assignment, current-generation tool authorization and wakes, canonical root replacement refusal, and linked successor recovery across partial writes and configuration drift. Terminal interruption also follows the active Lead generation (18 tests/58 assertions, `/tmp/deck-workspace-terminal-green.log`).

The expanded executable smoke has a confirmed RED result against the prior canary at the absent `deck web` command (`/tmp/deck-workspace-compiled-red.log`). The final four-target build passed (`/tmp/deck-workspace-build.log`), with generator-owned schemas/assets and final TypeScript clean (`/tmp/deck-workspace-final-tsc.log`). The last changed UI/control/assets slices pass 63 tests/244 assertions (`/tmp/deck-workspace-final-deltas.log`); these overlap the aggregate and are not added to its count.

Compiled Darwin arm64 passed 31 workspace/security/lifecycle checks and six three-runner checks (`/tmp/deck-workspace-compiled-{web,cross}.log`). Compiled Linux arm64 passed the same 31 workspace checks, container exit zero (`/tmp/deck-workspace-linux.log`), using an unprivileged, network-disabled container with copied binaries/fixtures and no repository or credential mounts. x64 targets are build-verified only. The smoke verifies real native catalog framing through the controlled Claude fixture, fresh assignment generations, readiness without a native user prompt, independent sessions, authenticated directory boundaries, pagination, idempotent linked continuation and persistence across daemon restart. Its SDK model fixture produces metadata without inference.

The real SessionManager/WebService browser harness passes 17 groups (`/tmp/deck-workspace-browser.log`), covering project creation, two independent sessions, draft/reconnect/preparation gates, close isolation, linked continuation, assignment provenance, current-generation tool/progress/interrupt behavior, history pagination and external assignment beyond the first page, unavailable project history, restart and mobile bounds. Lead and Quality inspected desktop, mobile and assignment-dialog screenshots under `/tmp/deck-workspace-*.png`. Independent Quality approved the frozen functional candidate. All 51 legacy browser checks passed (`/tmp/deck-workspace-regression-browser.log`), preserving scrolling, themes, Markdown, hooks, progress, responsive layout, approvals and replay. No runtime source changed after the four-target build boundary.

Canary activation completed at 2026-10-15T01:15:57Z. Payload `3926bdcb2e958abfd603e1f339d00a525115dd5e6b14ff3366ca80d8476ad35b` passed all 31 isolated installed-executable workspace checks (`/tmp/deck-workspace-installed-web.log`). Graceful restart replaced idle daemon PID42627 with PID49803; web readiness and the cwd-independent public command were verified at http://127.0.0.1:7421. The existing session's ID, canonical project root, creation date, last event sequence, Lead assignment and task count match the pre-restart snapshot. No history deletion, forced process termination, user configuration mutation or provider inference occurred. Previous immutable canary payloads remain available; older binaries may reject new workspace events/configuration, so downgrade must preserve state and respect schema compatibility.

## Queued user messages — complete and activated (2026-10-15)

The web now accepts durable per-session FIFO messages while the Lead works, shows pending previews with cancellation, and preserves active progress. Actual user chat delivery occurs at native admission after preflight. Interruptions/failures pause pending messages; Resume queue continues only after owned native work drains. Closing cancels pending messages; assignment changes require an empty inbox. Recovery preserves never-dispatched items behind ownership barriers and never implicitly retries uncertain dispatched work. Bounds, permanent typed/content identity, explicit fsync fences, prefix-safe stop/resume intents and complete-subset notice accounting are verified. See `prompt-queue-brief.md` and XR-14.

Final evidence: Root integrated host/core/CLI/schema suite 545 tests/3,216 assertions (`/tmp/deck-prompt-queue-integrated.log`), web/assets/documentation 71/1,042 (`/tmp/deck-prompt-queue-web-checks.log`), TypeScript and four-target compilation pass. Final actual-browser queue6 and workspace17 pass (`/tmp/deck-web-prompt-queue-browser-final.log`, `/tmp/deck-web-prompt-queue-workspace-final.log`). Independent Quality approved with 32 tests/169 assertions; these overlap the integrated and UI suites, not additional distinct coverage. Installed isolated compiled smoke passes39 checks (`/tmp/deck-prompt-queue-installed-smoke.log`). Legacy daemon/runner/browser tests were adapted to distinguish queued acknowledgement from real dispatch and explicitly resume after interrupt; runtime pause semantics were preserved. Desktop/mobile queue captures were inspected.

Payload `13466914208e20bbc54e204bca33e72ec6f4cdedfb1d391e890e726a2030638e` is active. A guarded idle restart replaced PID68707 with PID89639 at 2026-10-15T16:55:08.226Z; status confirms no running work/pending approvals and web http://127.0.0.1:7421. The daemon was earlier busy and was not forcibly interrupted. Reload the page for new assets. Verification used temporary isolated state/fake drivers, with no real provider inference or user configuration changes. No commit or publication was performed.

## Clipboard image attachments — complete and activated (2026-10-15)

The composer accepts pasted image files and multi-file selection, with session-local removable thumbnails, upload/error/retry feedback, image-only messages and draft-safe submission. Queued and delivered messages show compact image references opening a keyboard-accessible fitted/zoomable viewer. The host stores immutable session-owned attachments behind authenticated upload/read routes; accepted queue/history references survive cancellation and restart. Claude, Codex and OpenCode receive native structured images. Ordered private file references let the Lead work with/delegate the current images, while public events mask managed paths and image payloads. See `image-attachments-brief.md` and XR-15.

Limits: eight PNG/JPEG/static WebP images, 5 MiB/file, 20 MiB/message, 16,384 pixels/axis and 40 MP. Staging is limited to 32 files/100 MiB/session, with 24-hour lazy expiry only for unreferenced uploads. Eight concurrent upload bodies are admitted with bounded buffers and abort/deadline release. Format checks reject contradictory encoded dimensions and unsupported animated WebP. Referenced history files are retained. Browser clipboard bytes cross HTTP, so Windows client paths and OS clipboard utilities are unnecessary for WSL.

Verification: Root integrated host/core/three adapters/CLI/schema suite722/3,941 (`/tmp/deck-images-integrated.log`); UI/assets/docs75/1,062 (`/tmp/deck-images-web-checks.log`); final TypeScript, canonical schema generation and four-target compilation pass. The final private-context-only delta passes focused1/17 and independent re-review. Actual-browser image6, existing queue6 and workspace17 pass (`/tmp/deck-web-images-{browser,queue,workspace}.log`); desktop dark and mobile320/390 dark/light captures were inspected. Independent Quality approved host/native/UI and the real daemon forwarding correction; its28/165 plus final1/17 overlap owner/root suites and are not additive coverage. Installed compiled smoke51 passes (`/tmp/deck-images-installed-smoke.log`), proving actual authenticated uploads/reads, two Claude native image block digests, queued references, cancellation retention, cross-session rejection and daemon restart persistence.

Installed payload `81f097966a10735694cbe01ed051466ab0fa5cccb3dffe4a575b5ab41f77df18` is active after guarded idle restart PID89639→99820 at2026-10-15T17:20:33.870Z. Status confirms no running work/pending approvals; web http://127.0.0.1:7421. Reload the web for the new controls. No user configuration, commit or publication was changed.

Evidence limits: browser tests use File/ClipboardEvent payloads and real file-picker interaction on this macOS environment, not a manual Windows/WSL OS-clipboard exercise. Native protocols are verified with isolated fake runners, including the compiled supervised Claude boundary, without real provider inference. Selected models must support images; actual OpenCode server body-limit/provider vision behavior was not independently exercised. Native rejection remains a visible failed turn.
