# Release correction in progress

The v0.11.0 and v0.11.1 stable CI runs blocked publication. Their tags remain unchanged. The authorized release continues as v0.11.2 after clean-checkout, Linux verification and output-relay fixes; see `release-v0.11.0.md`.

# Handoff: cross-runner-session-core (read this first)

## Active: v0.11.0 release authorized (2026-10-15)

The user explicitly requested the new release/deployment after the verified commits. Root version and dated changelog are now0.11.0; `release-v0.11.0.md` owns the current publication plan and evidence. Source must reach main before the new stable tag; do not move old tags. The preceding 6693-test/full release gates remain fresh for runtime code, with focused checks for the metadata delta and canonical remote verification before publication. Earlier version-selection/publish deferrals below are historical and superseded by this authorization.

## Red removal actions and release preparation — verified and committed (2026-10-15)

Remove session/project now use readable red text in both themes, including hover. Eight actual desktop/mobile menu checks passed; minimum contrast6.03:1. Runtime/UI/tests are committed together at `6aabf0b`; documentation, changelog and OpenSpec evidence accompany a separate commit. All accumulated authorized work is included. Product version remains0.10.0 and upcoming changes are under Unreleased.

Full suite6693 passed/3 optional skipped/0 failed, canonical release checks and TypeScript pass. The final compiled Darwin arm64 binary was copied outside the checkout and completed session/web67 plus compiled memory checks with all checkout reads denied to it and its children; a positive control confirmed the deny rule. Native runners/plugins/configured MCP tools remain legitimate external prerequisites. Read `release-readiness.md` for exact evidence and limits.

Final canary payload `978127fa90ed5075deb18640bb6f22a46ec9b28b45d97cb78804ce5ffb0c4b90` is active after guarded idle restart PID28901→33615 at2026-10-15T18:46:42.093Z. Reload the web for the color update. No tag, push or publication occurred. Next: choose the release version and prepare main integration through the canonical process. Older activation and uncommitted-state records below are historical.

## Session release, session menu and connection dot — complete and activated (2026-10-15)

Close session now releases selected owned resources and returns the same conversation to Prepare session, preserving ID/history/native continuity/images and paused queued messages. Existing ended sessions reopen in place. Session rows expose compact three-dot Rename/Remove actions and a green/gray readiness dot left of the name; the selected header uses the same readiness semantics. Remove drains resources then hides the row without purging files/history. Failed cleanup offers explicit retry. See `session-release-brief.md`. This supersedes older final-close behavior described below.

Verified: root host/core/CLI/schema570/3386, web/assets/docs80/1079, TypeScript, canonical generation, four-target build, browser lifecycle6/queue6/workspace17 and installed compiled67. Independent Quality approved40/170 (overlapping coverage); reviewed repairs cover durable recovery prefixes, stale commands/callbacks, assignment/pruning races, failed cleanup retry/busy protection and cross-client catalog omission. Desktop/mobile dark/light and open-menu captures inspected. Native continuation evidence uses isolated fake runners, not real provider inference.

Payload `44337a894af17fa639c9aac021056a2ecbeeef4f4655c7124ff8171155bdd531` is active after guarded idle restart PID17681→23702 at2026-10-15T18:34:45.425Z, web http://127.0.0.1:7421. Reload the web for new assets. No user configuration change, commit or publication. Existing successor histories are preserved separately.

## Clipboard image attachments — complete and activated (2026-10-15)

The composer accepts pasted image files and multi-file selection, with session-local removable thumbnails, upload/error/retry feedback, image-only messages and draft-safe submission. Queued and delivered messages show compact image references opening a keyboard-accessible fitted/zoomable viewer. The host stores immutable session-owned attachments behind authenticated upload/read routes; accepted queue/history references survive cancellation and restart. Claude, Codex and OpenCode receive native structured images. Ordered private file references let the Lead work with/delegate the current images, while public events mask managed paths and image payloads. See `image-attachments-brief.md` and XR-15.

Limits: eight PNG/JPEG/static WebP images, 5 MiB/file, 20 MiB/message, 16,384 pixels/axis and 40 MP. Staging is limited to 32 files/100 MiB/session, with 24-hour lazy expiry only for unreferenced uploads. Eight concurrent upload bodies are admitted with bounded buffers and abort/deadline release. Format checks reject contradictory encoded dimensions and unsupported animated WebP. Referenced history files are retained. Browser clipboard bytes cross HTTP, so Windows client paths and OS clipboard utilities are unnecessary for WSL.

Verification: Root integrated host/core/three adapters/CLI/schema suite722/3,941 (`/tmp/deck-images-integrated.log`); UI/assets/docs75/1,062 (`/tmp/deck-images-web-checks.log`); final TypeScript, canonical schema generation and four-target compilation pass. The final private-context-only delta passes focused1/17 and independent re-review. Actual-browser image6, existing queue6 and workspace17 pass (`/tmp/deck-web-images-{browser,queue,workspace}.log`); desktop dark and mobile320/390 dark/light captures were inspected. Independent Quality approved host/native/UI and the real daemon forwarding correction; its28/165 plus final1/17 overlap owner/root suites and are not additive coverage. Installed compiled smoke51 passes (`/tmp/deck-images-installed-smoke.log`), proving actual authenticated uploads/reads, two Claude native image block digests, queued references, cancellation retention, cross-session rejection and daemon restart persistence.

Installed payload `81f097966a10735694cbe01ed051466ab0fa5cccb3dffe4a575b5ab41f77df18` is active after guarded idle restart PID89639→99820 at2026-10-15T17:20:33.870Z. Status confirms no running work/pending approvals; web http://127.0.0.1:7421. Reload the web for the new controls. No user configuration, commit or publication was changed.

Evidence limits: browser tests use File/ClipboardEvent payloads and real file-picker interaction on this macOS environment, not a manual Windows/WSL OS-clipboard exercise. Native protocols are verified with isolated fake runners, including the compiled supervised Claude boundary, without real provider inference. Selected models must support images; actual OpenCode server body-limit/provider vision behavior was not independently exercised. Native rejection remains a visible failed turn.

## Queued user messages — complete and activated (2026-10-15)

The web now accepts durable per-session FIFO messages while the Lead works, shows pending previews with cancellation, and preserves active progress. Actual user chat delivery occurs at native admission after preflight. Interruptions/failures pause pending messages; Resume queue continues only after owned native work drains. Closing cancels pending messages; assignment changes require an empty inbox. Recovery preserves never-dispatched items behind ownership barriers and never implicitly retries uncertain dispatched work. Bounds, permanent typed/content identity, explicit fsync fences, prefix-safe stop/resume intents and complete-subset notice accounting are verified. See `prompt-queue-brief.md` and XR-14.

Final evidence: Root integrated host/core/CLI/schema suite 545 tests/3,216 assertions (`/tmp/deck-prompt-queue-integrated.log`), web/assets/documentation 71/1,042 (`/tmp/deck-prompt-queue-web-checks.log`), TypeScript and four-target compilation pass. Final actual-browser queue6 and workspace17 pass (`/tmp/deck-web-prompt-queue-browser-final.log`, `/tmp/deck-web-prompt-queue-workspace-final.log`). Independent Quality approved with 32 tests/169 assertions; these overlap the integrated and UI suites, not additional distinct coverage. Installed isolated compiled smoke passes39 checks (`/tmp/deck-prompt-queue-installed-smoke.log`). Legacy daemon/runner/browser tests were adapted to distinguish queued acknowledgement from real dispatch and explicitly resume after interrupt; runtime pause semantics were preserved. Desktop/mobile queue captures were inspected.

Payload `13466914208e20bbc54e204bca33e72ec6f4cdedfb1d391e890e726a2030638e` is active. A guarded idle restart replaced PID68707 with PID89639 at 2026-10-15T16:55:08.226Z; status confirms no running work/pending approvals and web http://127.0.0.1:7421. The daemon was earlier busy and was not forcibly interrupted. Reload the page for new assets. Verification used temporary isolated state/fake drivers, with no real provider inference or user configuration changes. No commit or publication was performed.

## Current result — project menu actions activated (2026-10-15)

Projects now have a separate compact three-dot menu with Rename project and Remove project. Rename persists display names; removal hides projects durably without deleting files/history or stopping work. Explicit Add restores the same identity and complete chat history; implicit legacy import cannot unhide it. Typed atomic receipts, stale catalog/selection fences and active-removal replay reset are verified. The Add path also cancels pending folder responses during outside pointer gestures so suggestions cannot move the button mid-click. See `project-actions-brief.md` and XR-13.13.

Root passed integrated host/core/CLI432/1553, UI/assets/docs65/1016, TypeScript, four-target build and installed compiled31. Actual browser actions6/directory11/workspace17 passed; independent Quality approved with9 targeted tests/70 assertions. Desktop/mobile menu captures inspected. Payload `7cb640e64010d0d470925123503fa4c0c9a5090a01699a8f0bc488c234e014ac` is active after guarded idle restart PID62270→68707 at 2026-10-15T15:57:17.442Z, web http://127.0.0.1:7421. Reload for new assets. No real provider inference, user project/configuration mutation, commit or publication. Earlier activation records below are historical.

## Current result — status indicators and latest-message navigation activated (2026-10-15)

Sidebar sessions now show actual Lead state with compact SVG indicators; subagents show their own state/attempt. Work animates subtly, reduced motion disables it, and unread responses use a separate static marker. Browser-local monotonic read cursors advance only for exact visible response content in a focused visible page, respecting hidden mobile panes, dialogs and collapsed task transcripts. The host provides a durable Lead reply projection and bounded authenticated project-scoped status refresh for loaded history rows. Opening/switching chats lands at the latest messages after replay and viewport stabilization; later manual upward reading remains paused. See `status-indicators-brief.md` and spec XR-13.10–13.12.

Root passed host/CLI419/1362, UI/assets/docs65/1015, TypeScript, four-target builds and final installed compiled31. Actual-host focused browser8 and normal workspace17 passed; independent Quality approved with14 targeted tests/71 assertions. Root inspected latest-message mobile and desktop unread captures. A final CSS collision repair was verified at16×16 and rebuilt. Payload `7ed4116cfe6f80ca4f70b1d0861bfba1d45a59f034e44cfb9e2a73070d30a08a` is active after guarded idle restart PID46567→57799 at 2026-10-15T15:12:52.309Z, web http://127.0.0.1:7421. Reload for new assets. No real provider inference, user configuration change, commit or publication. Earlier activation records below are historical.

## Current result — explicit directory completion activated (2026-10-15)

Controlled directory suggestions now open/refetch with Ctrl+Space or the compact SVG folder button. Actual click/touch or arrows+Enter selects a folder, appends a separator and loads its children. Escape, request cancellation, retry/empty states and stable registration click geometry are verified. Home confinement and the accepted minimal sidebar remain intact. See `directory-completion-brief.md`. The prior trailing-slash fix proved query continuation, not native popup selection; this follow-up verifies real selections.

Focused actual-host browser11 and workspace17, UI/assets41/206, TypeScript and installed compiled31 pass; independent Quality approved the UI delta. Root inspected desktop/mobile captures. Canary payload `3acf4eab1b3d7cad18e39573ecb134351c1014225c18236fee290bfff1046c8a` is active after guarded idle restart PID68618→46567 at 2026-10-15T14:28:24.394Z, web http://127.0.0.1:7421. Reload for new assets. Interactive evidence uses isolated temporary browser fixtures; the reported user path was inspected read-only. No real provider inference, user configuration change, commit or publication. Earlier activation records below are historical.

## Current result — subtle SVG sidebar activated (2026-10-15)

User requested a lighter visual treatment while retaining project accordions. Sidebar controls now use consistent thin SVG icons; desktop sessions are single-line 32px rows with 13px regular titles, accessible/native-tooltip metadata and long-title ellipsis. Selected rows use a restrained neutral tint without the thick accent strip. Project rows, branding and spacing are reduced; vertical guides and redundant subtitle/footer are removed. Mobile keeps 40px touch targets. Existing creation/disclosure/cache behavior is unchanged. See the top active agreement in `sidebar-navigation-brief.md`; earlier heavier visual details are superseded.

Root inspected populated desktop/mobile/collapsed captures. UI/assets41/206, TypeScript, focused actual-host14 browser groups and installed compiled31 pass. Canary payload `0c2e30d1ee03d7f8296c6eabc607df6cde6b49f90c399d7f874679884d4aff74` is active after guarded idle restart PID61268→68618 at 2026-10-15T03:03:47.770Z. Web http://127.0.0.1:7421; reload for new assets. No real provider inference, user configuration change, commit or publication. Existing work remains uncommitted.

## Current result — project accordions activated (2026-10-15)

The user rejected the switcher/chooser and oversized creation button from the activation below. Its replacement is implemented: compact independently expandable project accordions, nested sessions, separate per-project `+`, compact Add project. Disclosure preserves the active conversation. Creation binds the clicked project's identity, with per-project request fences and pagination; mutations supersede stale histories. Same-name paths are distinguished compactly. Stable ARIA panels and visible mobile Cancel focus are verified. No backend contract changed. See the top active agreement and evidence in `sidebar-navigation-brief.md`; older switcher notes are historical and rejected.

Root passed 41 UI/asset tests (204 assertions), TypeScript and diff check; actual-host browser accordion11/workspace17/directory4 and legacy51 pass. Root and independent Quality inspected populated desktop/mobile/collapsed screenshots; Quality approved and independently passed 4 navigation tests (25 assertions). Installed binary passed31 isolated checks. Payload `d3b934026261d4e5569a7f5c0bfec1cac4e7eccb5e2a23e57ad7105918dacaac` is active after guarded idle restart PID57801→61268 at 2026-10-15T02:26:51.629Z; web http://127.0.0.1:7421. Reload the page. No real provider inference, user config change, commit or publication. Source remains uncommitted. Direct current-user-browser automation was unavailable; visual/interaction evidence uses actual-host isolated browser fixtures, not a claimed live user-browser test.

## Current result — sidebar and nested completion activated (2026-10-15)

The follow-up now provides stable active-project context and New session, independently scrolling history, an inline searchable project chooser with readable duplicate-name paths, creation dates instead of ID prefixes, a usable collapsed rail, and mobile project-to-session navigation with keyboard/Escape/backdrop focus behavior. Native directory suggestions append a separator so the next lookup descends. Read `sidebar-navigation-brief.md` for primary-source research, design inference and focused evidence. Native datalist popup mouse/key selection was not reliably automatable; actual option-value continuation, nested folders, spaces, leaf registration and stale responses were verified against the real host.

Root passed 40 UI/assets tests (193 assertions), TypeScript and scoped diff check. Browser results: directory4, sidebar11, workspace lifecycle17, legacy51. Installed canary passed31 isolated compiled checks. Root inspected desktop/mobile screenshots. Canary payload `7ac29118686a9e28211070389516a10cc14cf44006d5831efd2cb5e8beff55b1` was installed, then idle daemon PID52426 was gracefully replaced by PID57050 at 2026-10-15T02:02:45.699Z. Status confirms web http://127.0.0.1:7421, no running work or pending approvals. Reload the page for new assets. No real provider inference, user configuration change, commit or publication. Prior work remains uncommitted. This supersedes the activation metadata immediately below; historical verification remains scoped to its original candidate.

## Current result — global workspace activated (2026-10-15)

All authorized phases are implemented: `deck web`, persistent projects/history, explicit preparation and close/continue, session member overrides/Lead generations and separate fair global execution pools. Contracts are in workspace-contract.md (D-32–D-36) and spec.md XR-13. Root's aggregate passes 867 tests/3,630 assertions; final changed slices 63/244, new browser17 and legacy browser51 pass, TypeScript and four-target builds pass, macOS/Linux arm64 workspace31 each and macOS cross6 pass. Independent Quality approved. Installed canary also passed workspace31, then idle daemon PID42627 was gracefully replaced by PID49803 at 2026-10-15T01:15:57Z. Payload: `3926bdcb2e958abfd603e1f339d00a525115dd5e6b14ff3366ca80d8476ad35b`. Existing session IDs, roots, creation dates, event cursors, Lead assignments and task counts were verified unchanged. Web remains http://127.0.0.1:7421; reload the page for new assets. Source remains uncommitted; no provider inference, user configuration change or publication occurred. The proposal-only statements farther below are historical.

## Latest refinement — native memory parity and all observed hooks (2026-10-14)

The user approved native Supermemory integrations in cross, reusing the canonical project identity from normal developer launches, and broadened Activity to all reported hooks. D-28 supersedes daemon-only D-18. CLI preparation verifies existing profiles/plugins and supplies a nonsecret descriptor plus private spawn environment. Native-owned executions no longer advertise or authorize daemon memory tools; Pi is unchanged. Claude selectively admits its verified plugin and strict explicit MCP, Codex verifies and isolates native hook state without changing global files, and OpenCode admits only its verified private loader and checks the registered native tool.

Activity renders native hook lifecycle with optional trusted provider attribution, reported outcomes/duration and safe details. Correlation survives pre-init starts, late native session IDs, completion-first events, attempt reuse and replay. Both hook protocol namespaces are metadata-only, including malformed, foreign and future events; no hook output or commands are retained. Schema and web assets are generator-owned and regenerated.

Frozen source verification: 607 runtime/schema/composition tests plus 51 web/asset/documentation tests (658 total), TypeScript and 45 browser groups passed. Independent Quality approved after privacy repairs. Four targets built successfully; compiled host cross/web acceptance passed 22 checks. Final registry evidence is recorded in the latest verification report.

Read `native-memory-evidence.md` for native-mode limits. Actual installed preparation returned the same canonical scope for all three runners; isolated native probes made no model/provider calls. Automatic capture completion remains explicitly unverified: Claude uses asynchronous Stop and OpenCode's disposal does not await plugin capture. These are visible capability limits, not a claimed successful memory write or silent daemon fallback.

No canary installation, user-daemon restart, native configuration mutation, provider write, commit or publication was performed. Previous uncommitted Activity/progress work remains included. To exercise this candidate, install the canary and use the explicit daemon restart command; reinstalling native memory plugins is not implied by this source change.

## Latest refinement — immediate Lead feedback and preparation timing (2026-10-14)

Added immediate receipt-scoped Sending/Waiting feedback beside the composer and across mobile tabs, followed by explicit preparation, reasoning, tool, response, approval and reconnection states. Failed sends preserve drafts, late responses stay scoped to their session, and terminal events override pending HTTP completion. Native preparation diagnostics now record checking-runner, preparing-tools, starting-runner and observed turn-started with attempt and timing estimates, without changing execution sequencing.

Read-only analysis of the user's latest greeting measured 15.383 seconds between acceptance and Claude initialization, then 0.834 seconds to first text (19.760 seconds until turn completion). Installed canary and daemon executable matched. Existing records cannot split that preparation delay; the new diagnostics enable the next updated runtime to do so. No latency reduction has been measured or claimed.

Final evidence: 503 runtime tests, 29 web/asset tests, 18 documentation tests, TypeScript and 42 generated-asset browser checks passed. Root inspected desktop layout and the active mobile status capture `/tmp/deck-web-live-progress.png`. Logs `/tmp/deck-lead-feedback-{runtime,web,docs,tsc,browser}.log`. No installed canary update, user daemon restart, native inference, binary rebuild or commit. Previous Activity changes remain included and uncommitted.

## Latest refinement — detailed Lead Activity (2026-10-14)

Activity now shows Lead-only tool executions with actual names, inputs, available outputs/errors, reported duration and truthful status, plus explicitly exposed reasoning. Generic lifecycle/connection notices and child/internal events are omitted. Explicit Skill calls receive skill labels; file reads do not imply execution. Native reasoning identities distinguish deltas from snapshots, preventing duplicate cumulative text. OpenCode classifies text versus reasoning per task; new normalized activity and historical rendered details are bounded/redacted.

Independent Quality approved after repairs for interleaved snapshots, historical redaction, unknown tool outcomes on failed turns, and host terminal events without native session IDs. Root passed 176 runtime/core tests, 22 web/asset tests, 18 documentation tests, TypeScript and 36 generated-asset browser checks; desktop/mobile screenshots inspected. Logs `/tmp/deck-activity-{runtime-tests,web-tests,docs,tsc,browser}.log`. Scoped OpenSpec validation passes; unrelated legacy registry failures exist in unscoped validation. No native inference, binary rebuild, installed canary update, user daemon operation or new commit. Baseline accumulated work was committed as `77d2ff8`; this Activity refinement remains uncommitted.

## Latest refinement — compact auto-growing message input (2026-10-14)

The composer now presents one compact row with labeled send/interrupt icon buttons alongside the text. `MessageInput` retains native multiline input semantics but starts at one line, grows with wrapped text/newlines to four lines, then scrolls internally. Deletion/sending shrinks it; a width observer recalculates wrapping for viewport/sidebar changes. Manual resizing is disabled. Labels/keyboard guidance remain accessible. Jump to latest is positioned above the actual composer rather than a fixed height.

Direct Lead change verified with 12 UI/asset tests, clean TypeScript and 30 browser checks, including one-line initial height, Shift+Enter without submission, four-line cap for explicit/wrapped text, internal overflow, shrinking, responsive reflow and post-send reset. Final mobile screenshot inspected. Logs `/tmp/deck-web-input-{tests,tsc,browser}.log`; canonical assets regenerated. No native binary rebuild, canary installation or user daemon mutation.

## Latest refinement — persistent light/dark switch (2026-10-14)

Added a labeled keyboard-accessible sun/moon button in the compact header. Dark remains the default; light restores the original porcelain/pine palette, including warning/error/button/backdrop colors. Theme is applied before React mounts and persisted with `deck.theme` in local storage for the browser profile/origin. Reload and new tabs restore it; missing/invalid values fall back to dark. Unavailable storage does not break startup or switching. No OS-theme automatic selection or cross-device configuration change.

Direct Lead implementation: 12 UI/asset tests passed, TypeScript clean, expanded browser harness passed 27 checks including exact original light colors, keyboard switching, reload/new-tab restoration, blocked storage and 320px switching without overflow. Actual light desktop/dark mobile captures inspected. Logs `/tmp/deck-web-theme-{tests,tsc,browser}.log`; light screenshot `/tmp/deck-web-theme-light.png`. Canonical embedded assets regenerated; native binaries/canary/user daemon unchanged for this refinement.

## Latest visual refinement — dark palette and compact header (2026-10-14)

User accepted the redesigned structure/components and requested dark colors plus a minimal header. Replaced light tokens with charcoal surfaces and soft green accents, including semantic warning/error colors and dark button foregrounds. Header is 56px; redundant eyebrow removed; empty approval row visually removed while retaining its live status. Pending approval actions remain visible. Existing desktop/mobile harnesses now wait for resolved approval text attachment instead of visual presentation of the intentionally hidden idle status.

Direct Lead refinement, no new architecture or independent review cycle: 12 UI/asset tests passed, TypeScript clean, existing 22 browser checks passed; actual desktop/mobile screenshots inspected. Text/action/semantic contrast pairs range from 7.17:1 to 13.49:1. Canonical embedded assets regenerated. Screenshots `/tmp/deck-web-dark-{desktop,mobile}.png`; logs `/tmp/deck-web-dark-{tests,tsc,browser}.log`. No native binary rebuild, canary installation or user daemon change for this localized visual delta; preceding compiled evidence describes the prior visual version.

## Current checkpoint — web workspace redesign complete

Implemented full light porcelain/graphite/pine visual replacement, collapsible sidebar, side-by-side Chat/workspace, Activity/Subagents/OpenSpec tabs, safe Markdown and responsive single-pane mobile navigation. Lead-only conversation is separated from child/tool events. Approvals remain visible; drafts, scroll position and explicit artifact selection are preserved. OpenSpec polls while visible and reads only bounded authenticated Markdown beneath the session project/bound change. See XR-8.9/8.10, D-27, current visual agreement and `web-ux-research.md`.

Independent Quality approved. Root affected suites: 412 host tests, 12 UI/asset tests and 18 documentation tests passed; TypeScript clean; all four targets built. Desktop/mobile browser acceptance passed 22 checks, compiled browser passed eight, and Darwin/Linux arm64 compiled HTTP/asset/artifact acceptance passed 16 each. Screenshots are `/tmp/deck-web-{desktop,openspec,mobile,mobile-activity,mobile-openspec}.png`. Final report sections hold evidence and limits. No required source task remains. No canary installation, user daemon restart, commit or publication performed for this increment; preserve existing work.

## Latest checkpoint — public daemon commands complete

Implemented `deck daemon start|status|stop|restart [--json]` and `daemon --help` (same routes through deck-canary). Start is idempotent; status/stop never start an absent daemon; restart starts the invoking executable even for equal versions. Stop/restart refuse active work or approvals, fence new control/web/bridge admission, wait for old ownership to settle, and preserve session/history/runner assignment. Fresh startup verifies the PID actually spawned by the invoking binary; competing ownership fails explicitly. No force mode or automatic build fingerprint replacement.

Independent Quality approved. Broader affected verification: 497 pass, 0 fail across 35 files; TypeScript clean; all four targets built. Standalone daemon acceptance passed 16 checks each on Darwin/Linux arm64; extracted host cross and web smoke passed 6 and 11 checks. New harness: `scripts/daemon-smoke.ts --deck /absolute/deck`. User guide includes lifecycle commands. Latest sections of verify/review reports hold evidence and limits. No source task remains.

These new commands are compiled in the worktree but have not been installed into the user's canary by this continuation. No user daemon operation was performed during this implementation. The earlier manually requested restart below remains historical. No commits, push or publication.

## Operational checkpoint — installed canary daemon restarted (2026-10-13)

The user installed the new canary at 03:19 local time, but Ctrl+C only closed its terminal client; daemon PID 36685 still ran the old payload from 02:07. At the user's restart request, Lead used the existing daemon.restart control request (which refuses running work/approvals), waited for shutdown, and launched the current installed payload. Verified new PID 58992 at 08:25:19Z, current payload a35139c745479ce1d6b58e9a11b053ae1ced120bcb64d71e68bb8fe0dbb30cd0, web port 7421, no running work/approvals and preserved session/history files. No installation or session deletion was performed by Lead. Older statements below that no user daemon was restarted describe their earlier checkpoints.

The old session still records Claude Opus 5.5; current configuration selects Codex gpt-6-astra. Restart does not migrate native session ownership. At this operational checkpoint the public CLI lacked explicit lifecycle commands; those are now implemented above. Automatic same-version build detection remains outside the explicit-command increment.

## Latest checkpoint — duplicate completion wake fixed

The canary incident was a daemon-authored completion notice after `deck_task_wait` had already returned the worker result. Fixed by task-attempt acknowledgement at authenticated Lead result delivery, including synchronous wait-before-notice races. Unseen completions, later attempts and aborted/observer reads retain their notifications. Independent Quality approved; 425 affected tests passed, TypeScript clean, all four targets rebuilt and extracted Darwin arm64 cross smoke passed six checks. See the latest verify/review sections. No required source task remains; installed canary/user daemon remain unchanged. Prior full-suite/Linux/browser evidence below predates this localized fix.

## Current checkpoint — canary feedback complete

The follow-up is implemented and independently approved. Local browser access needs no code; Claude setup/start has no subscription notice or acknowledgement gate; partial Claude output and failed turns are visible. Managed Codebase Memory uses exact reviewed artifact compatibility, a private runtime with the canonical graph cache, retained protocol health checks, bounded recovery/backoff, independent cancellation and native consumer leases. Unproven native drain persists `ownership-unsettled` and blocks continuation/pruning. Claude rejects disconnected expected MCP servers.

Final verification: **6,421 pass, 3 skip, 0 fail**; TypeScript and release verification passed; all four targets built; Darwin/Linux arm64 passed 74 compiled checks each; compiled desktop browser passed automatic local access and approval replay. Actual native MCP acceptance measured 9,351 ms cold preparation and 11 ms retained health check, with cleanup confirmed. These are MCP timings, not end-to-end model response times. See the follow-up sections in [verify-report.md](verify-report.md) and [review-report.md](review-report.md).

No required implementation task remains. Changes are uncommitted. The installed canary has not been replaced, no existing user daemon was signalled, and no push or publication was performed. Preserve unrelated dirty work and Pi source. The old shared unhealthy endpoint was bypassed through supported runtime isolation, not repaired in place.

## Previous checkpoint — S0–S5 complete

The user-requested S0–S5 work is complete and independently reviewed. Read [verify-report.md](verify-report.md) and [review-report.md](review-report.md) for the final outcome; older S1/S2 checkpoints below are historical. Final suite: **6,373 pass, 3 skip, 0 fail**. TypeScript, release verification, four-target compilation, Darwin/Linux arm64 runtime smoke and desktop browser acceptance passed. Real three-runner delegation and delegated shared-memory acceptance passed. Optional task 4.10 is deferred. All continuation changes remain uncommitted; preserve unrelated dirty work. No canary install, push or publication was performed. There is no remaining required implementation task.

## Start prompt for any agent (copy/paste; tool-agnostic)
> You are continuing the OpenSpec change `cross-runner-session-core` in `/Users/kevinlondono/Proyects/deck` on branch `fix/claude-model-config-blocked-plan`. Read `AGENTS.md`, then `openspec/changes/cross-runner-session-core/HANDOFF.md` fully, then `apply-progress.md`, `tasks.md`, `design.md`, `spec.md`. First verify the real state (`git status --short`, `git log --oneline 6970400..HEAD`, `bunx tsc --noEmit`, `TMPDIR=$(realpath /tmp) bun test packages/session-host packages/core/src/session`). Another agent may have left uncommitted work in the worktree: inspect it (`git diff`, untracked files) and finish or fix it before starting new tasks; do not discard it (follow `packages/core/src/teams/developer/git-safety.ts` before any discard). Continue with the next unfinished task in `tasks.md` stage order, using TDD, small conventional commits, and updating `apply-progress.md` with evidence. Ask the user only for unresolved design decisions or actions blocked by permissions. Do not push, do not run `canary:install`, do not run bare `bun install`.

## Resumption checkpoint (2026-10-12)

The user resumed this change from this handoff. Read the **S1b resumption** section of `apply-progress.md` for current evidence; older snapshots below are historical.

- S1b CLI, terminal, ToS acknowledgement, self-test and smoke work was present and has been resumed in the worktree. Independent review found and repaired cross-session credential/approval cleanup and approval ownership bugs, plus terminal replay/retry/lifecycle issues.
- Claude 2.1.296 live contract script now passes all eight checks, including isolated MCP, hook suppression, native resume and interruption. Safe-mode compatibility is documented by the existing recorded fixture; it was not re-probed.
- Ordinary configured Claude MCP packages now flow through an adapter-owned read-only resolver with isolated per-turn snapshots; focused composition tests and independent review passed. Memory/web integration stays in S3.
- Docker is available after starting the installed app. No repository installation-sandbox image was cached; Bun 1.3.12 is available for a disposable Linux container smoke without repository/credential mounts.
- Unrelated dirty Codex MCP repair, dashboard and runner documentation files must remain preserved. No push or canary install was performed.
- Four-target build succeeded; compiled Darwin arm64 and Linux arm64 smoke each passed 19/19 checks. Linux ran without repository/credential mounts or network. Other architectures are build-verified only.
- Final focused suite passed 204 tests; TypeScript is clean. Broad run: 6230 pass, 3 skip, 3 fail (two known OpenCode/Pi failures plus the corrected obsolete S1a assertion). Read `apply-progress.md` for its focused recheck and limitations.
- Corrected S1a test recheck: 4 pass, 0 fail. All resumption edits remain uncommitted; preserve them alongside the unrelated dirty work.
- Registry records Apply in progress. Next implementation stage is **S2 — Codex and OpenCode session drivers**. This checkpoint does not implement multi-runner delegation, shared memory or the web client.

## Historical snapshot before resumption
- Committed through S1b partial: `8457578` Claude session driver (adapter-claude), `5c2b50c` single-member Lead SessionManager with durable command receipts.
- A delegated implementation agent was still working on S1b CLI tasks (1.15-1.19) when this was written. Uncommitted files were present: `apps/cli/src/session-cli.ts`, `session-commands*.ts`, `session-self-test*.ts`, `session-service*.ts`, edits to `cli-args*`, `main.tsx`, `packages/core/package.json`. If that agent is no longer running, treat those files as unfinished work: run `tsc` and the tests, complete tasks 1.15-1.19 (ToS acknowledgement gate, CLI commands, self-test manifest, S1 BIN gate), then commit.
- Pending S1b items per `tasks.md`: 1.13 live isolation check result recorded, 1.15 ToS gate, 1.16 verify, 1.17 CLI commands, 1.18 self-test manifest, 1.19 BIN gate.

Last updated: 2026-10-12. Repo `/Users/kevinlondono/Proyects/deck`, branch `fix/claude-model-config-blocked-plan` (created from an up-to-date `main`). Nothing has been pushed. The user wants everything to ship from this branch when they launch.

## What this is
A cross-provider Deck feature: each developer-team member (lead included) can run on a different runner (Claude Code, Codex, OpenCode), each in its own native CLI, while Deck supervises ONE session (one OpenSpec change, shared Supermemory memory, owner-contract re-delegation to the same agent with prior context). Architecture: a Deck-owned local session daemon (`@deck/session-host`) plus thin clients; first client is a desktop web UI on `127.0.0.1`. Pi is NOT the host.

Authoritative artifacts (read in this order): `working-brief.md` (decisions + spike evidence), `proposal.md`, `spec.md` (XR-* requirements), `design.md` (D-* decisions), `tasks.md` (stages S0-S5, task IDs), `apply-progress.md` (per-task status and evidence), `state.yaml`/`events.yaml` (registry). Spike scripts: `spike/`.

## User decisions (final)
- Daemon + web client; Pi is not the host. Local service only: bind `127.0.0.1`; Tailscale is NOT required (optional late helper `deck cross expose`, task 4.10); no mobile/PWA/offline/push; no launchd/systemd service.
- Personal single-user use of the user's own subscriptions; spawn the unmodified native CLIs as the signed-in user; never extract/reuse OAuth tokens; never use Claude `--bare`.
- Claude ToS residual risk ACCEPTED behind a one-time acknowledgement (Claude is the S1 driver).
- Codex in cross sessions KEEPS the already-approved always-on bypass; approval relay with sandbox on is opt-in.
- Deck ships as per-user compiled binaries WITHOUT the repo: daemon, web assets and schemas must be embedded; no repo paths at runtime; four targets (linux/darwin x64/arm64).
- Lead-level decisions applied: `boot-changed` settles ownership in recovery; `approval.respond` accepts `allow` and `allow-once` (events emit `allow-once|deny`); command idempotency receipts persist via the event log (survive daemon restart).

## Progress
- Done and verified by the Lead (independent `tsc`, tests, git status): S0 (contracts, config `crossRunner`, Codex 0.162.1 audit, BIN gate) and S1a (session-host core: paths, EventLog, ledger, child anchor, recovery, daemon, control server, MCP bridge, ApprovalBroker, hidden `deck internal` routes).
- S1b (tasks 1.11-1.19) was IN PROGRESS when this was written: Claude driver and single-member Lead SessionManager were committed; CLI commands (`deck cross developer`, `deck session ...`), self-test manifest, ToS acknowledgement gate and the S1 BIN gate were being written (uncommitted files may exist in the worktree: `apps/cli/src/session-commands*.ts`, `session-self-test*.ts`, `session-service*.ts`, `cli-args*`). Check `git status`, `git log --oneline 6970400..HEAD` and `apply-progress.md` for the true state; a delegated agent may still be running or may have finished after this note.
- Not started: S2 (Codex + OpenCode drivers), S3 (proxied Lead, delegation tools, memory broker, ledger continuation), S4 (desktop web client), S5 (TUI cross runner, docs, final BIN gate).

## How to continue
1. Verify before trusting: `git status --short`, `bunx tsc --noEmit`, `TMPDIR=$(realpath /tmp) bun test packages/session-host packages/core/src/session`, `deck openspec validate --change cross-runner-session-core`.
2. Finish S1b if incomplete (see `apply-progress.md`), run its BIN gate, commit.
3. Then run stages in order S2, S3, S4, S5, one implementation agent per stage (split large stages), TDD, logical conventional commits, update `apply-progress.md` per task, and verify each stage yourself before moving on. Use `deck-apply-deep` for protocol/process work and `deck-apply-fast` for clear routine work.
4. Stop and ask the user only for unresolved design decisions or actions blocked by permissions; the SDD resolves everything else.

## Environment gotchas (learned the hard way)
- Run tests with `TMPDIR=$(realpath /tmp)`: the macOS `/var` symlink otherwise fails ~15 config tests.
- Host Bun is 1.3.11 but the release pins 1.3.12: build with `npx -y bun@1.3.12 run scripts/build-binaries.ts --dry-run` (npm cache only). Never run `canary:install` or modify installed binaries/global tools without the user's say-so.
- Never run a bare `bun install` (apps/cli pins ink/react to `latest` and breaks `tsc`); use `--frozen-lockfile`.
- Known pre-existing failures: skill-bundle idempotency (needs Bun 1.3.12), preference audit flagging Pi `supervisor.ts`, OpenCode SSH-alias launch test; `codex-supermemory-launch.test.ts` is a full-run timeout flake (passes alone).
- Codex 0.130.0 on macOS had a REVOKED OpenAI signing certificate (binary killed/deleted); fixed with `npm install -g @openai/codex@0.162.1`. Binary path moved to `vendor/aarch64-apple-darwin/bin/codex`. Always check `codesign --verify` before bypassing a macOS malware alert; never disable protections.
- No `timeout` on macOS: use `perl -e 'alarm N; exec @ARGV'`. `codex exec` needs `< /dev/null`. Claude `-p` without `--strict-mcp-config` loads all user MCP servers and hooks.
- `.gitignore` ignores `*.generated.ts`: `schema.generated.ts` is force-added; never hand-edit generated files. `.serena` is gitignored but `project.yml` is tracked.
- Live provider calls cost the user's subscription: keep them to trivial prompts (`--model haiku --tools ""` for Claude, free models for OpenCode) and record them.

## Branch contents (oldest to newest, summarized)
`ab2f624` Claude model-config blocked-plan fix (the original reason for the branch; works on all OSes/binaries, platform-independent logic) -> spike and SDD docs -> `fdd4ab2`/`bfd056c`/`878bafd`/`144f6ea` preserved user's WIP (Pi supervisor, Supermemory account validation, a second OpenSpec brief, Serena config; marked `wip`, never verified as a whole) -> `6970400` regenerated runner bundles + S0 close -> S1a commits -> S1b commits. The branch mixes the Claude fix, Pi/Supermemory WIP and cross-runner work; if a cleaner PR is wanted, the Claude fix is isolated in `ab2f624`.

## Open items for the user's later attention
- Regenerate/verify Pi and OpenCode generated bundles and the `wip` Pi/Supermemory commits before release.
- Remaining unverified items listed as named tasks: memory inside delegated children, Codex decline path, Codex auth with user config ignored, OpenCode isolation via a Deck-owned config dir, Claude `--safe-mode` with explicit MCP config, Tailscale Funnel header name.
- 4-target build, Docker Linux smoke and live 3-runner acceptance are still to be run in their stages (S2 3.11, S5 5.6).

## Latest increment — activated 2026-10-14T23:51:04Z

User requested no permission prompts. All cross defaults and this user configuration now use runner-default; explicit relay remains supported. Claude receives root AGENTS.md every turn, and context explains why native memory intentionally omits Deck memory tools. Independent Quality approved; 310 affected tests, TypeScript and installed executable smoke passed. Canary installed and daemon restarted successfully, preserving session `20261013T070713-c59247`. Changes remain uncommitted. Prior instructions that canary was not installed describe earlier increments only.

## Latest increment — Activity scrolling activated 2026-10-15T00:17:59Z

Activity follows live/growing content, respects reader intent and preserves per-session positions through tabs/replay. Workspace document overflow is fixed. Final browser51, UI/assets33, docs18, TypeScript and compiled web16 passed; Quality approved. Canary installed and idle daemon restarted (PID39401). Broader user questions are answered by verified source findings and proposed phases in workspace-evolution-brief.md; project registration, new-session web controls, preparation/closing buttons and model/runner transitions are not implemented. Source remains uncommitted.
