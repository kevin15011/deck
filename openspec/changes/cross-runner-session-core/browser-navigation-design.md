# Revised handoff: browser Back/Forward in Deck

Nothing was edited. This is the design only; the unread-replies owner integrates it after their in-progress `openReply`, reply effect and `UnreadReplies` changes settle.

**In scope (user-approved):** Back/Forward and exact reply links (cold and warm push).
**Not in scope:** reopening the last chat when the PWA cold-launches. It was only discussed and is not authorized; a launch with no `?session` keeps today's behaviour.

## Route state (identifiers only)
```ts
history.state.deck = { v:1, key, parent?, project, session?, tab?:'activity'|'subagents'|'openspec',
  overlay?: {k:'drawer'} | {k:'unread'} | {k:'origin', decision} | {k:'image', attachment},
  reply?, anchor?:{id, seq, offset} }
```
- **Project is now included.** `project` is always present. It is the project of the shown session, or the project whose list is shown when no session is open. `popstate` restores the project first (`setProjectId` and expand), then the session.
- **Only overlays with a stable identifier are history entries:** the session drawer, the unread list, the decision detail (by decision id) and the image preview (by attachment id).
- **Not in history:** create, rename and assignments dialogs (they hold mutable form state), question docks, composer, theme, desktop workspace tab, pagination.
- **URL:** built only by `routeURL(route)` = origin + pathname + `?session&reply`. Never copy `location.href`, so a pairing hash or token can't be carried over. Bootstrap runs after `pairingToken` has stripped it.
- **Validation:** every field is checked on read (session/reply rules, decision and attachment patterns, `seq`/`offset` must be finite numbers). Invalid or foreign state → rebuild from the URL with replace.

## Proving we own the previous entry
`key` is a random nonce per entry; `parent` is the key of the entry it was pushed from. The keys this tab created live in `sessionStorage['deck.nav']`, capped at 50, ids only. Leaving an overlay or tab with `history.back()` is allowed only when the current entry was pushed by Deck **and** its `parent` is in that set. Otherwise use replace. Depth is never used as proof.

## Push / replace rules
- **Replace:**
  - bootstrap, reload, bfcache restore, cold push, bookmark;
  - removed sessions, project switches inside `load()`, corrections of stale routes;
  - once the reply has been focused: merge into the current entry, only if `history.state.deck.key` still equals the navigation's key.
- **Push** (unless `sameRoute`, which ignores anchor, key and parent; then replace):
  - choosing another session in the sidebar or drawer (pushed on top of the drawer entry, so Back returns to the list);
  - opening the drawer, unread list, decision detail or image preview;
  - **every mobile tab change**, so Back always returns to the previous tab;
  - a warm push message, or `openReply` when the list is not open.
- **A reply chosen from the unread list replaces the list entry.** Back then lands on the chat position saved before the list opened.
- **Closing an overlay** (button, Escape, backdrop, native dialog `onClose`) goes through `closeOverlay()`. It reads `history.state` first: if the overlay is the top entry and Deck owns it, `back()`; otherwise replace. Both paths are idempotent, so a `popstate`-driven `.close()` never pops twice.
- **Before any push,** write the current anchor and tab into the current entry with replace.
- **Scroll position:** `saveAnchor` writes at most every 250 ms and on `scrollend`. The URL always comes from `routeURL`.

## `popstate`
1. Read the route, increment `navGeneration` and `replyNavigation`, clear `replyTarget`, abort pending `around` calls.
2. Restore the project, then the session (`selectSession(id, {history:false})`), then `mobileTab`.
3. **Overlays:**
   - The drawer opens only on narrow screens.
   - The unread list's `open` becomes a controlled prop.
   - Decision detail reopens only if that decision is still in `decisionData`. The image preview reopens only if the attachment is in the session's history. Otherwise replace with the overlay stripped.
   - Forward restores all of these the same way.
4. **Scroll:** if an anchor is stored, `following=false`; when the row isn't loaded, `around(seq)` once the session is hydrated, then `restoreAnchor`. Else if a reply is stored, run the exact-reply effect. Else follow latest. **Confirm whether historyId and seq are the same value.**
5. **A mutable dialog that is open:** if no request is pending, close it; if one is pending, hide it while the mutation finishes, but drop any navigation it triggers afterwards.
6. **Unknown session or reply:** replace with the project list and show the existing "no longer available" message. Never loop.
7. **Focus:** the overlay's opener if it still exists, else `#conversation` with `preventScroll`.

**Leaving Deck:** an entry with no owned `parent` is the entry point. Back from it leaves Deck normally (an installed PWA closes). No filler entries, no re-push on `popstate`, no `beforeunload`, no `unload`, no new settings.

## Guards against late async responses
Each async step captures `navGeneration` and the session id before it starts and drops its result if either changed:
- the linked `/summary` step in `load()`, and its `selectSession`/`setReplyTarget`;
- the reply fetch and `around`;
- anchor restore;
- the merge-replace after reply focus;
- the session navigation a dialog triggers after its mutation (`onSession`/`onProject`).

Polling, hydration, reconnects and history paging never call `navigate`. The service-worker message handler acknowledges first, then pushes.

## Unchanged guarantees
- **Read receipts and decisions:** a route, `popstate` or click never calls `displayed` or any decision command. `DisplayedReply` visibility stays the only receipt.
- **Drafts:** they stay in the memory stores (they survive Back/Forward, warm push and bfcache) and never go into history state or the URL.

## Where it lands
- **New:** `navigation.ts` (pure helpers plus `useDeckHistory`) and its tests.
- **Wiring in `main.tsx`:** `selectSession`, the linked branch of `load()`, `openReply`, the reply effect, the service-worker message handler, the drawer, `changeTab`, `decisionOrigin`, `ImagePreview`, the scroll handler, and the dialog `onClose`/`onSession`.
- **`lead-replies.tsx`:** the unread list's open state becomes a controlled prop.
- **No changes needed:** the service worker, `push-notifications.tsx` and `state.ts`.

## Tests (390/320 first, then desktop)
1. Drawer → S1 → Back reopens the list → Back closes it → Back leaves Deck; Forward replays each step.
2. Chat → Activity → Subagents: Back, Back returns through the tabs; Forward restores them.
3. S1 at an anchor → unread list → reply R in S2 (another project) → Back restores the project, S1 and the offset; Forward restores R. Nothing is marked read while the list or drawer covers the reply.
4. Decision detail and image preview: Back closes them; Forward reopens them, or strips them if no longer valid. Create/rename dialogs add no entry.
5. Cold push or bookmark with a reply → exact reply after paging; Back leaves Deck. Reload keeps it; `sessionStorage` cleared → no `back()`.
6. Warm push from S2 → Back returns to S2 at its anchor. Same click twice adds no extra entry. Older service worker (no reply id) opens the session only.
7. Back during a slow `/summary`, `around` or dialog mutation → the late result does not change the session, highlight, URL or history.
8. Pairing URL → after bootstrap and scrolling, `history.state` and the URL contain no hash or token.
9. A drafted and a question draft survive Back/Forward and warm push.
10. 60 s of polling and reconnects → history length unchanged; removed or stale routes do not loop.
11. Resize narrow → wide with the drawer open → closes once. Escape behaves the same as Back. Focus is correct; reduced motion and themes are unchanged.

**Risk:** whether historyId and seq are the same value is still unconfirmed. Safari rate-limits history writes, which is why the anchor writes are throttled.

## Lead constraints overriding recommendations

- This is an implementation handoff, not validated runtime behavior. Same unread-replies owner integrates on its next continuation.
- Browser Back at the entry point follows browser/platform behavior; do not promise that an installed PWA closes.
- A missing reply should retain its valid session and show an unavailable-target message, rather than unnecessarily redirecting to project list.
- Confirm history row identity and sequence mapping before anchor restoration. Persist identifiers only; never secrets or drafts in route state.
- Observe pairing-token removal and navigation generation ownership. Acknowledgement of a push navigation request is not proof that its destination was displayed.
- Handle empty project catalogs and storage/history API failures without trapping or breaking navigation. Predecessor ownership must be validated, not inferred solely from a nonce appearing in storage.
- No scope expansion to cold-launch last-chat restoration, launcher menus or badge APIs; these remain discussion only.

