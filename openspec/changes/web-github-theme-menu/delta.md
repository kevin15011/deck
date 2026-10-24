# Delta: GitHub theme and theme switcher in the Deck menu

- **Outcome:** Web UI gains a `github` theme (GitHub Dark Default / Primer palette). The header theme `<select>` is removed; theme choices live in the Deck navigation menu (popup on desktop, inline list in the mobile drawer) with a swatch, name and active check. The circular reveal now originates from the chosen menu item.
- **Targets:** `apps/web/src/theme.ts` (registry + swatches), `apps/web/src/theme-select.tsx` (`useThemeReveal`, `ThemeOptions`, `ThemeSwatch`), `apps/web/src/install-deck.tsx` (`DeckMenu` theme props), `apps/web/src/main.tsx`, `apps/web/src/style.css`, `apps/web/src/theme.test.tsx`.
- **Decisions:** Popup stays open after a theme pick so users can compare themes. Primary button hover is `#1a7f37` (not GitHub's `#2ea043`) to keep 4.5:1 white text. Storage key `deck.theme` unchanged.
- **Evidence:** `bun test src/theme.test.tsx src/theme-reveal.test.ts src/install-deck.test.tsx` (19 pass); root `tsc --noEmit` clean.
- **Follow-up:** Playwright acceptance scripts that drive `combobox "Theme"` (streaming, decisions-compact, subagents-tab) need to switch to the Deck menu.
- **Status:** implemented, not visually verified in a browser.

## Follow-up: compact session controls (2026-10-23)

- Desktop: `.session-controls` is one fixed 44px row (status, one-line ellipsized notes with full-text tooltip, inline error, MCP/permissions, actions); no reserved multi-line space.
- Mobile (<=1000px): no band. `SessionControls compact` renders a header toggle (status dot + short label: Ready/Prepare/Preparing/Failed/Closing) opening a fixed dropdown panel with all controls; outside pointerdown/Escape dismiss via `listenForDismissal`, MCP top-layer popover counts as inside. Header 56px -> 48px.
- Evidence: session-controls/theme/install-deck tests 14 pass; web suite 250 pass, 13 pre-existing failures (other session); root tsc clean. Not visually verified. Implemented by Lead after apply-deep (Codex) failed to start twice.

## Follow-up: popular developer themes (2026-10-23)

- Added 12 palettes in `apps/web/src/themes.css` (imported from `main.tsx`) and registered in `theme.ts`: GitHub Light, One Dark Pro, Dracula, Catppuccin Mocha/Latte, Tokyo Night, Nord, Gruvbox Dark, Monokai Pro, Rosé Pine, Night Owl, Solarized Light. Existing `github` relabelled "GitHub Dark" (id unchanged, stored preference preserved).
- Text roles were nudged minimally for WCAG AA (ink 7:1, other text 4.5:1 on surface/card/canvas/console; button label 4.5:1 on fill and hover). Notable adjustments: Solarized Light accent/action/warning darkened, Catppuccin Latte warning darkened, Nord error lightened.
- Evidence: theme/install tests 12 pass (new test asserts every registered theme has a palette block). Not visually verified.

## Approved follow-up: notifications move to the Deck menu (2026-10-23, implemented)

- Remove the always-visible bell from the app header. Deck menu (desktop popup and mobile drawer) gets a "Notifications · On/Off" item that opens the existing push settings (enable/disable, status, last-alert diagnostics) in a dialog consistent with the theme dialog.
- States needing user action (authorization expired, "Reconnect notifications for this browser", blocked) surface as a small attention dot on the Menu toggle / mobile drawer button so they are not lost when hidden.
- Implemented: one shared push-settings hook drives desktop and mobile menu state. The header bell and obsolete popup styles are removed. The native Notifications dialog retains enable/disable, browser setup guidance, status and last-alert diagnostics; opening refreshes status without requesting permission. Escape/backdrop/Done close it and return focus to the desktop Menu or mobile drawer trigger. Authorization/subscription mismatch, blocked permission and connection failure surface attention dots.
- Chromium at 390/320/1440 verifies menu On/Off state, expired-authorization/blocked-permission attention (including the collapsed desktop sidebar), dialog boundaries, explicit-only permission requests, enable/disable, diagnostics, Escape/backdrop dismissal and focus return. Real push delivery and real mobile browser setup remain outside the fixture.

## Approved follow-up: approval requests stop shifting the layout (2026-10-23, implemented)

- The tool permission request (`Approvals` band rendered above the chat in `main.tsx`) currently pushes the whole interface down when it appears/disappears.
- Target: render it as a floating card anchored just above the composer, overlaying the chat (no reflow of header/chat/composer), with "1 of N" stacking when several are pending; on mobile a bottom sheet above the composer. It must remain impossible to miss (focus/announce politely, attention style), keep all existing actions (allow once/session, deny, scopes, risk) and not cover the composer input or the floating context/unread/jump buttons.
- Implemented: the approval card lives in the zero-height conversation overlay, above the unread/Jump row; progress/context and the composer stay below it. A bounded scroller retains full request details and all scope/risk actions. One card is shown with previous/next navigation and an announced "1 of N" count. On mobile it becomes a sheet with 44px actions, also available above other workspace tabs so requests cannot disappear when chat is hidden. Focus can move from an idle chat/body to the card without taking the composer's caret or interrupting another dialog.
- Chromium at 390/320/1440 checks incoming and resolved live requests, identical header/chat/composer geometry, no overlap with unread/Jump/context/input, stack navigation, 44px targets and visibility from the Activity tab. Existing scope-menu overlay/dismissal checks and approval unit tests cover retained actions and confirmation gates. Screenshots inspected at 320/390/1440. Real Safari/Android verification remains open.

## Implemented fix: chat jumps to older messages on send (2026-10-23)

- Root cause (investigation task d7dc3fde, static analysis, pre-existing): `navigateHistory` in `apps/web/src/main.tsx` (~356-359) clears `following` on any upward wheel/touch/key gesture even when already at the bottom; the stale anchor is then replayed by `restoreAnchor` when sending adds a row.
- Implemented in `apps/web/src/main.tsx`: wheel/touch/key intent only leaves following and captures a reading anchor when ≥80px from the bottom. Pointerdown alone no longer marks a history gesture. Anchor capture and replay both skip the bottom tolerance; explicit reply-link and route-anchor restoration retain their existing paths.
- Every selected-session `prompt.send` clears the reading/route anchor, resumes following and scrolls after the sending state/new row renders. This shared path includes composer submits and resubmitting an edited or retried prompt. If newer history is buffered, it loads the latest window. “Send again” also resumes following when it restores the draft, without sending automatically.
- Regression evidence: the new check in `apps/web/layout-stability-acceptance.ts` failed against the original behavior, then passed at **390/1440**. It races an incoming frame with 1px upward wheel/touch/ArrowUp gestures, sends and verifies the “Sending…” row stays at the bottom; incoming messages and resizing an earlier row preserve a far-up reader's exact anchor; their own send returns to latest. It also exercises restoring/resending an older unconfirmed bubble.
- Verification: **76 focused tests passed** (history/navigation/state/composer/queue); root `bunx tsc --noEmit -p .` passed; full web suite **279 passed / 13 known failures**, all in `session-codebase-availability.test.tsx`; complete isolated Chromium layout acceptance **18 checks passed**, no page errors. Touch gestures use Chromium simulation; real iOS/Android verification remains open. No daemon restart, commit or discard operation was performed.

## Current follow-up verification (2026-10-23)

- Focused composer/queue/approval/menu/push tests: **50 passed**.
- Root `bunx tsc --noEmit -p .`: passed.
- Full `apps/web` suite: **279 passed, 13 known failures**, all in `session-codebase-availability.test.tsx`.
- Isolated Chromium layout acceptance: **17 checks passed**, including 390/320/1440 geometry and the new floating approvals/notifications flows. Composer acceptance also passed Stop/Edit at all three widths and the existing recall/IME/touch/dismissal scenarios. Final notifications-only rerun covers status refresh and collapsed-sidebar/blocked attention.
- Existing working-tree changes are preserved; no session-host behavior changed, daemon restart, commit or discard operation was performed. Real Safari/Android, live runner recovery and real push-service delivery remain open.

## Requested next (2026-10-23, not started)

- Show the message time on subagent transcript messages (Subagents tab), consistent with Lead chat timestamps. Start only after the user has rebuilt/restarted and tested the canary.

## Approved next: grouped web push notifications (2026-10-23, user-approved, implemented)

- One notification per session for replies (stable per-session tag; new reply replaces previous) with a running count + latest reply ("3 new replies · <session>"), computed in the service worker from the existing notification's data.
- Replacement re-alerts (renotify: true) when something new arrives.
- Decisions and approval requests keep their own separate notifications (not folded into the reply count).
- Opening/viewing a session in Deck closes that session's notifications on the same device (registration.getNotifications by session tag prefix, then close).
- App icon badge (navigator.setAppBadge/clearAppBadge) for installed PWA where supported: total pending sessions/count, cleared accordingly.
- Explicitly out of scope (user decision): clearing notifications on other devices (would require visible pushes).
- Server: stop emitting one push per reply event if needed (push-attention in packages/session-host); keep payload fields the SW needs (sessionId, session name, kind, preview, seq). iOS (installed PWA) close/badge support is partial; verify where possible.
- Implement after the unread-replies removal (same web owner) and before the next canary build.
- Implemented: reply/result pushes replace `deck:<sessionId>:replies` with a running unique-reply count, bounded/redacted session name (session ID fallback), latest preview and exact latest-reply deep link. Duplicate occurrences do not increment or re-alert; out-of-order pushes preserve the newest preview/link. Counts survive worker restarts through existing notification data and reset after dismissal/viewing. Notification operations are serialized to prevent lost increments during concurrent pushes. Decisions, approvals, questions and failures retain separate tags.
- A focused, visible connected conversation signals the worker on entry, focus/visibility return, stream progress and presence refresh. The worker validates the same-origin focused window and closes only that session's tag prefix on this device. Clicking a notification also clears its session. Existing exact reply display receipts and server suppression are unchanged; local clearing does not manufacture a receipt or resolve a decision/approval.
- Badges represent pending reply counts plus one per separate attention notification, across sessions. Display/replacement, session clearing, clicks and manual dismissal reconcile the badge, including clearing at zero. Badging is feature-detected, rejection-safe and time-bounded so an unresponsive OS API cannot stall notifications or routing. The server adds only optional session-name metadata through the default daemon composition; existing per-reply deduplication and provider topics remain intact.
- Verification: service-worker/push/reply web tests **22 passed**; push-host unit tests **36 passed** with `--timeout 120000` (three existing storage-heavy tests exceed the default five-second timeout); production daemon push tests **25 passed**, including session-name delivery, exact receipt suppression, separate decisions and durable deduplication. Root TypeScript check passed. Full web suite: **282 passed, the same 13 known failures** in `session-codebase-availability.test.tsx`. Chromium push acceptance passes **14 checks**, including real worker registration/notification APIs, grouping/count/latest/renotify, separate attention, local session clearing, routing/draft preservation and 320/390/1440 settings. Push-provider delivery and OS badge effects are simulated; Linux headless uses Chromium's notification center to avoid desktop-portal dismissal races.
- Platform limits: counts/clearing depend on the browser retaining and enumerating displayed notifications; if enumeration is unavailable, valid pushes still display but counts cannot accumulate reliably. Badges and replacement re-alert behavior depend on browser/OS support and user settings. On iOS/iPadOS, Web Push and Badging require an installed Home Screen web app and notification permission; users can disable badges independently ([WebKit platform guidance](https://webkit.org/blog/14112/badging-for-home-screen-web-apps/)). Real iOS/Android close/re-alert/badge behavior and live provider delivery remain unverified. No other-device clearing, running workspace daemon restart, commit or discard operation was performed.


## Removed: unread replies (user decision 2026-10-23)

- Removed the floating unread-reply counter/list, its styling, pagination/global inbox polling, unread overlay route and feature-only tests/acceptance. The floating action row now mounts only for Jump to latest, leaving no empty row or gap.
- Kept exact reply-display receipts (`useDisplayedReplies`/`DisplayedReply`): push delivery checks per-device display state to suppress alerts for replies already seen. Kept sidebar/subagent read markers and push attention tracking because those have separate consumers. Kept service-worker notification navigation and `?reply=` resolution, exact history loading/highlighting, focus and Back/Forward restoration.
- No session-host changes. Candidates for later endpoint cleanup: `GET /api/replies` and session reply listings without `messageSeq`; the session `messageSeq` lookup and exact reply GET/display-receipt POST still serve notifications. Server read-marker endpoints remain in place.
- Verification: 60 focused tests passed; root TypeScript check passed; full web suite 276 passed / the same 13 known failures in `session-codebase-availability.test.tsx` (three removed feature tests). All 18 Chromium layout checks passed at 320/390/1440, including approvals, reconnect, context and Jump controls with no overlaps or reserved badge gap. All 18 navigation checks passed against current source, including real service-worker warm navigation, cold `?reply=` entry/reload, exact display receipts and history restoration. Real iOS/Android verification remains open.

## Implemented: context estimate becomes a true floating control (2026-10-23)

- User feedback: the context estimate ("≈27% · 273k / 1m") occupies a full row above the composer instead of floating.
- Target: render it as a floating pill in the zero-height chat overlay (bottom-right, above the composer), consistent with Jump to latest; no reserved row and no layout shift when it appears/updates. If the same row also carries Lead progress status, that status floats too (bottom-left) or stays compact without reserving a full row. Must not overlap approvals card, Jump to latest or composer reconnect notice; 44px target on mobile.
- Implemented: chat `LeadProgress` now lives inside the existing zero-height `.conversation-feedback` overlay. The context pill sits bottom-right and active Lead status bottom-left, wrapping status above context when space is narrow. Approvals, Jump to latest and reconnect notices stack above these controls with the existing gaps; their appearance and live estimate/status updates reserve no document-flow row and leave conversation/composer geometry unchanged. The pill uses the shared surface, border, 8px radius and shadow, with a 44px mobile target and tabular counts. Existing context details, accessible name/live status, Escape dismissal and focus return are preserved.
- On mobile tabs other than Chat, retain the existing compact status/context row above the workspace: those tabs have no conversation overlay or composer, and the status remains available while Chat is hidden. The existing mobile approval overlay remains available there too.
- Chromium regression failed against the original reserved row, then passed at 320/390/1440. It verifies zero-height placement, identical conversation/composer geometry even when the entire control is removed, live long status/estimate changes, context details and focus return, mobile tab behavior and non-overlapping controls. All 19 layout acceptance checks passed; an additional combined approval/reconnect/Jump/status/context check passed at all three widths. That combined check exposed an existing approval scope-menu resize listener passing `window` to `Node.contains`; a surgical node guard fixes it, and a separate open-menu resize/Escape acceptance check passes with no browser errors. Screenshots inspected at 320/390/1440, including the combined stack at 320.
- Verification: 47 focused web tests passed; approval tests passed again after the resize guard (13 tests). Root `bunx tsc --noEmit -p .` passed. Final full web suite: 282 passed, the same 13 known failures in `session-codebase-availability.test.tsx`. Real iOS/Android rendering remains unverified. No running workspace daemon restart, commit or discard operation was performed.

## Implemented: subagent message timestamps (2026-10-23)

- `apps/web/src/workspace.tsx` `TranscriptMessages`: plain subagent/delegation messages now render `<div class="message-meta"><strong>label</strong><time dateTime=ts>HH:MM</time></div>`, reusing the local `time()` helper and existing `.message-meta time` styling (same format as Lead chat). Covers paged and non-paged transcripts. Auto-approval rows unchanged.
- Evidence: subagents-tab tests 6 pass; root tsc clean. No dedicated timestamp assertion yet; not visually verified. Implemented directly by Lead.
