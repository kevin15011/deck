# Working Brief — Web usage section in sidebar (2026-10-27)

**Intent:** Usage (subscription quota) is used frequently; move it from the Deck menu dialog into its own sidebar section.

**Acceptance:**
- Desktop: section at the bottom of the sidebar, directly above the Deck menu; hidden when the sidebar is collapsed to the rail.
- Mobile: same position inside the hamburger drawer, above the inline Deck menu.
- Collapsible; folded/expanded state persists in `localStorage` key `deck.usage-collapsed` (shared desktop/mobile). Folded header shows a compact max-window summary (e.g. `Claude 72%`).
- Reads `/api/quota` on mount/expand only; runner refresh stays explicit (no automatic runner calls).

**Changes:** `apps/web/src/quota.tsx` (QuotaDialog replaced by QuotaSection/QuotaSectionView/quotaSummary), `main.tsx` (mounts section; removed dialog state), `install-deck.tsx` (removed "Quota usage" menu item), `style.css`, `quota.test.tsx`, `layout-stability-acceptance.ts` (usage check rewritten).

**Evidence:** `bun test` quota/install-deck/workspace 10/0; `bunx tsc --noEmit` exit 0; browser acceptance `DECK_LAYOUT_FILTER="usage section"` PASS at 390 and 1440 (position above menu, 3 bars, contrast across themes, no automatic refresh, fold persists across reload). Screenshots `/tmp/deck-quota/{390,1440}.png`. Ran with `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` pointing at the installed headless shell 1237 (pinned 1208 not installed).

**Status:** Done, uncommitted.

## Delta 2026-10-27 — auto-update and discreet scrollbars

- Usage section rereads host `/api/quota` every 15 s while the page is visible and on return to visibility; snapshots come from runner turns' rate-limit events. Runner refresh remains explicit (Claude refresh costs a Haiku request). Acceptance adds a host-snapshot change that appears without user action and asserts no runner refresh.
- Global discreet scrollbars in `style.css` (thin, transparent track, muted thumb that strengthens on hover; WebKit fallbacks).
- Evidence: tsc 0; quota/session-controls/claude adapter tests 37/0; usage acceptance PASS at 390/1440. Full layout acceptance stops at the pre-existing `context and Lead status float…` mobile check (fails identically with the scrollbar CSS removed); later checks not reached.
- Related canary fix: Claude review plan now appends a bounded `Cause:` to the generic selection-failure block; preparation surfaces `claude-session-skills-unverified` / selection-stale codes with web guidance. Canary rebuilt.
