# Verification: Cross-Runner Session Core

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
