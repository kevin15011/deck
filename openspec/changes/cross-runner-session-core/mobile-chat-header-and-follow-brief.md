# Mobile chat follow state and compact header

Status: implemented and browser-verified; user-authorized canary installation and commit checkpoint; full suite retains benchmark failure, 2026-11-02 UTC.

## Intent
Fix the jump-to-latest button appearing after incidental actions such as opening and closing a menu. Move the connection and activity status into the Session menu on mobile, leaving the header in a single row. The user reports apparent reconnection improvement and explicitly leaves background notification diagnosis for later testing; no notification work is included here.

## Acceptance
- At latest, opening/closing the sessions drawer or Session menu does not create false unread/follow state or show the jump button.
- Intentional scrolling away, unseen arrivals and incomplete newer history continue to offer a working jump-to-latest action.
- Preserve reading position, drafts, pagination and session ownership across overlays, resizing and keyboard changes.
- Mobile header stays on one row at 360/390px, including long titles. Connection and activity states remain accessible in Session, including reconnecting/working states; desktop keeps its current status display.
- Verify actual browser interaction, rapid reversals, keyboard/Escape and reduced motion. Add a behavioral regression for the reproduced false-jump cause; avoid tests pinning markup or copy.

## Visual agreement
Retain the current Deck theme, typography, palette, density and component language. Only move the mobile status and correct follow-state behavior. Existing GSAP motion primitives own movement and appearance; preserve reduced-motion and focus behavior. Selected guidance: frontend-ui-engineering, project Apple-inspired motion and GSAP conventions. No new design system or dependencies. Baseline-ui was considered but rejected because its Tailwind/motion-react requirements conflict with this stack.

## Evidence and ownership
Graph Verify lookup: project deck, fast generation 2026-08-20T17:25:00Z; structural search found no current web symbols. Coverage for main.tsx and session-controls.tsx has untracked freshness, requiring current source fallback. Initial worktree clean, previous mobile reconnection work committed as eda8006.

Implementation owner: apply-fast, task `task-71035d54-f324-43fb-9203-d64b5c3f720d`, a new task for this distinct UI area. Lead owns OpenSpec and final verification. Primary targets: apps/web/src/main.tsx (follow/unseen state, header), session-controls.tsx (compact menu) and relevant styles/browser harnesses. Root cause must be reproduced before choosing a behavioral fix. No commit, installation or restart in the implementation task.

## Candidate review
Attempt 1 (result 9847, ended 9848) changes the mobile header/menu plus route-anchor capture and hidden-scroll handling. Lead inspected the three-file diff; follow-state changes remain speculative until browser reproduction. Eighteen existing navigation tests pass, but no menu/jump browser regression, screenshot or final-after-last-edit typecheck exists. Same owner continues with a current-source real-App fixture, baseline regression and responsive visual/interaction checks. No completion or installation claim.

Attempt 2 (result 11297, ended 11298) reproduced the false jump on the committed baseline: drawer navigation saves an anchor while following, then restores historical reading on close. Applying only the following guard to the baseline passes the same scenario. Speculative scroll-handler changes were removed. Current-source browser acceptance covers 360/390/1440px, repeated drawer/Session toggles, long title, arrival while following, scrolling away, jump, reduced motion and Escape. Owner reports 18 navigation tests plus final types/diff passing. Working and Reconnecting status states were not separately driven in the fixture.

Lead inspected the minimal diff, scenario and screenshots `/tmp/deck-mobile-after-390.png` and `/tmp/deck-mobile-menu-390.png`: header is one row, and Connected/Idle appears inside Session. Exact input hashes match the report: main `a5efcdfc86db584a097de4ede5028519c7a34a9b2696aec1eede03af63091734`, controls `b8db18c69ba460ae799fb82d6c19d0c9120ce36673e27375e1fa813a2b668ebb`, CSS `4eb1e11f74c537ba3b37fe78c48265ead789d72f6c213fc0a69223c4130f6ae0`, fixture `b940d88f12c0978cbd42d88b507b1fd2c1070950cd111e0d6905518f44b6485c`. Lead reruns bounded browser acceptance and final full gate; outcome pending.

## Final verification
- Lead independently ran `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/snap/bin/chromium DECK_LAYOUT_FILTER='mobile header and follow behavior' bun apps/web/layout-stability-acceptance.ts`: exit 0, named scenario passed, zero browser errors. This exercises real App rendering with synthetic local HTTP/WebSocket input. The baseline fails after drawer closure and the guard-only baseline passes, as reported by the owner.
- Reused matching owner evidence for final TypeScript and 18 navigation tests; all four source/fixture hashes remained unchanged before and after Lead checks. `git diff --check` passes.
- `bun run test`: exit 1, 512/512 files, 4811 tests passed, one failed, zero skipped, 78.01s. Failure: `benchmarks/memory-live/supervision.test.ts` / `supervisor deadline caps the transport and leaves terminal retained receipts`, expected 1 but received 0 at line 114. Log `/tmp/deck-mobile-ui-final-tests.log`.
- Isolated exact-case diagnostic rerun: one passed, four filtered, zero failed in 2.64s; `/tmp/deck-mobile-ui-supervision-recheck.log`. This does not make the full suite green or create a baseline exemption. No benchmark/timeouts/quarantine modifications.

Candidate during checks: `eda8006b1aae23f9f06dba0f4ff93bd251bfb66c:089a9e320b978d1cd536e30b7f33ee63d1b3fd36`. This final evidence-only documentation update changes its tree without invalidating source-bound checks. Commands follow AGENTS.md/CONTRIBUTING.md; browser harnesses are opt-in acceptance. No daemon interaction, canary rebuild, commit or notification investigation in this increment. Physical-device behavior remains for user testing.

## Canary and commit checkpoint
User explicitly requested canary compilation and commit. All four runtime/fixture hashes still match reviewed evidence; focused/browser/typecheck results are reused, with the prior full-suite benchmark failure retained rather than relabeled green. `bun run canary:install` exited 0, compiled linux-x64 with current web assets and installed `/home/kevin15011/.local/bin/deck-canary`. Lead `--version` and `--help` smoke checks exited 0. Record the five scoped files in one fix commit and refresh the build afterward to embed that commit identity. No daemon restart or push; notification diagnosis stays deferred.
