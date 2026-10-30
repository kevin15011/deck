# Web font and pane preferences

Status: implemented and accepted on combined final candidate; uncommitted, canary compiled and installed on user request.

## Mobile feedback follow-up

### Expanded font choice

Final scoped result (Apply Fast attempt7): five extra fonts implemented and accepted. Prior-reviewed tree plus font delta passes production font/browser checks, all ten options reachable/selectable with close control at320/390x480, and5 focused preference/asset tests. Of19 failures from mixed full suite,18 pass isolated. Compiled Supermemory test still reproduces Codex memory hook `invalid-evidence` on mixed snapshot hash7c41aa04a9406da13555919edeced8f9d3b69eaa2a3e22a509a7d1b436ddfaaa; diagnostic `/tmp/deck-font-smoke-diagnostic.log`. Local isolated typecheck inconclusive because linked dependencies resolve to original workspace and duplicate types; earlier working-tree typecheck passed. Broader concurrent Codex work preserved, not repaired in font task. Canary update remains blocked and existing installed binary/daemon unchanged. Font feature is complete in source; deployment is not complete.

Apply Fast attempt6 implemented all five new fonts (156796 bytes WOFF2 plus license files), scrolling mobile selector and previews. Lead inspected sources attribution and390px capture; production browser checks passed all actual font loads, Spanish sample, persistence and layout. Scoped preference/types passed. Broad affected had3timeouts that passed isolated; full7651pass/11skip/19fail/2errors while unrelated Codex sources changed. No stable whole-candidate conclusion; new canary not yet built. Existing other-owner changes preserved. Further verification must isolate font slice or classify failures without altering unrelated work.

User requests at least five additional, more varied fonts. Add Nunito Sans, Space Grotesk, Source Serif 4, Lora and IBM Plex Mono alongside existing choices: two distinctive sans families, two readable serif families and a different monospace. Bundle licensed WOFF2 assets and attribution, preserve current stored selections and code monospace, verify Spanish accents. Fontsource references checked2026-10-29: /fonts/nunito-sans/about, /fonts/source-serif-4/about, /fonts/lora/about; implementation must confirm all actual asset licenses/origins. No runtime third-party requests.

Keep mobile horizontal radio layout and44px rows. With ten choices the dialog must scroll within viewport, with accessible dismissal and all options reachable at320/390 widths and short heights. A compact style label/sample is appropriate if it helps compare choices. Verify real asset loading for every added font and persistent selection, existing themes/grouping and pane behavior. Same font owner implements and updates canary after checks under the continuing local development workflow; no daemon restart.

Completed and installed 2026-10-29: Apply Fast attempt 5 reran all three Codex-install timeouts individually with original limits (28.43s, 20.84s, 18.29s), all passed, then successfully compiled/installed canary. Lead verified installed `--version`: 0.14.0, c5cbea8, linux-x64, dev. Final source unchanged from browser/affected/type evidence; only brief changed. Full run still recorded three timeouts, not a clean-suite or proven baseline claim. Both mobile corrections are now in the installed canary; daemon/session was not restarted.

User restarted the canary and reports font radio controls below labels on mobile. Correct each radio/label to a single horizontal row with useful touch target; inspect actual mobile and desktop computed layout. Preserve font persistence and pane behavior. Same Apply Fast owner handles this local correction; concurrent indicator owner edits only its own CSS section.

Apply Fast attempt 3 corrected shared dialog CSS inheritance with font-scoped row direction and native radio dimensions, 44px touch rows. Production-browser geometry regression reproduced column layout/237px radio before correction and passed at 320/390/1440 afterward (5.1s), retaining font persistence and pane behavior. Lead inspected source and 390 screenshot and accepted this slice. Combined verification and canary rebuild await sidebar correction; this update is not yet installed.

Combined attempt 4: stable candidate ca45d849bb6496f21da0580db95ab6130539c87d passed browser acceptance, affected gate (7426/3 skip/0 fail) and compiler. Full gate ran: 7667 pass, 11 skip, three Codex-install timeouts, no assertion failure reported. Canary not installed yet. Lead requested exact isolated reruns under unchanged limits; if successful, accept documented broad timing limitation for this local CSS update and proceed with authorized canary install. No repeated full gate or unrelated runner changes requested.

Canary update (2026-10-29): `bun run canary:install` passed for linux-x64; installed `/home/kevin15011/.local/bin/deck-canary`. Existing daemon was not restarted.

## Final combined verification

The indicator revision preserved font/pane source and passed production browser acceptance (`/tmp/indicator-revision-font.log`, 5.76s), types, asset build and full suite (7670 passed, 11 skipped, zero failures). Affected suite: 7426 passed, 3 skipped, zero failures. Quality task `task-151b836f-e239-4e05-9b97-6ba2ddf4f9bd` attempt 2 reviewed font/divider screenshots and source without additional blockers and verified unchanged production inputs; its own filesystem browser rerun was blocked by read-only EROFS, not represented as a pass. Lead accepts the combined implementation. Font choices are System, Inter, Geist, JetBrains Mono and Fira Code, with bundled SIL OFL assets. Font and preferred pane ratio persist per browser/origin. No commit or canary update performed.

## Implementation review (attempt 2)

Lead reviewed the same owner's second report and corrected CSS: grid and separator now share clamp(280px, preferred split, available width minus 280px). Adopt implementation, including reported focus restoration fix, but final verification remains pending on the combined candidate with session indicators. Five preference/asset tests passed; earlier browser pass covered boundary widths and font persistence, but later browser runs timed out waiting for Deck menu after concurrent edits. The full mixed-candidate run ended with 7650 passes, 11 skips, 15 failures and 4 errors (/tmp/deck-cont-full.log); no baseline-wide pass is claimed. Targeted clean-baseline runs passed some failed suites, so failures cannot simply be dismissed as pre-existing. All Apply Fast gates have ended. Complete combined verification after indicator implementation settles, then independent Quality review; reroute any font-specific fixes to the same Apply Fast owner. No commit or canary restart.

## Implementation review (attempt 1)

Apply Fast task `task-f8243ce9-8c2e-4be9-bd42-6c2e0f7c9dfb` implemented bundled fonts, preference UI/storage, pointer/keyboard divider and browser acceptance. Reported focused preference test, production-builder browser acceptance and typecheck passed. Lead reviewed source and report; final acceptance remains blocked: affected/full gates were still running with unclassified failures and predated a final correction. Lead also identified potential narrow-desktop grid overflow/divider misalignment from differing column/divider minimum-width clamps. Same owner continues to reproduce/fix boundary geometry and complete/classify gates. No canary restart or commit occurred.

## Intent and acceptance

Add a Web UI font selector and an adjustable left/right ratio in desktop Both view. Both preferences persist across page refresh and application restart in the same browser/origin. Use existing best-effort localStorage conventions; invalid data and unavailable storage must not break the UI.

- Offer System (existing default), Inter, Geist, JetBrains Mono, and Fira Code. Bundle licensed font assets with the application; no runtime third-party font requests or dependency on locally installed fonts. Keep code legible and monospaced when a proportional UI font is selected.
- Place font selection alongside visual preferences in the Deck menu, available on desktop and mobile, with an immediate preview/application and visible current selection.
- Drag the center separator in Both view to resize Chat and Workspace. Keep navigation and panel columns aligned, enforce useful minimum widths, support keyboard adjustment and accessible separator semantics, and clean up drag state on cancellation/unmount. Retain the chosen ratio through mode changes, responsive transitions, reload and restart.
- Preserve single-panel views, mobile tabs, theme behavior, chat scrolling and composer behavior. Default to the current equal split.

## Visual agreement

Preserve current density, palette, composition and motion. Typography selection is user controlled; existing default stays unchanged. Use a subtle center divider with clear hover/focus and usable hit area. Selected guidance: deck-frontend-design (scope/visual agreement), frontend-ui-engineering (implementation), fixing-accessibility (font control and keyboard separator). No redesign.

## Evidence and scope

Parent graph Verify attempt: project deck, generation 2026-08-20T17:25:00Z; searches limited to 40 then 25 web symbols returned no results. Coverage for main.tsx/style.css/theme.ts/install-deck.tsx reports not_tracked, scope apps/web/src no recorded gaps (not completeness proof). Source fallback is required. Direct reads confirm deck.theme guarded localStorage helpers, DeckMenu theme dialog, content-mode persistence and equal .panes/.view-nav grids.

Targets: apps/web/src preferences, menu, main layout, styles, font assets/build integration as required, and focused/browser tests. Existing dirty openspec/changes/web-terminal-feasibility/working-brief.md is unrelated and must be preserved. OpenSpec writing belongs to Lead.

Font source references checked 2026-10-28: https://fontsource.org/fonts/inter/about, https://fontsource.org/fonts/geist/about, https://www.jetbrains.com/lp/mono/. These establish font availability, not a measured popularity ranking. Confirm bundled asset licenses.

## Verification

Follow openspec/config.yaml and root package scripts: focused tests during edits; browser checks for real font loading, drag/keyboard resizing, persistence and responsive modes; bun run test and bunx tsc --noEmit before commit; Lead runs a short live canary for runner or installation changes. Distinguish existing failures using baseline evidence. No install/restart of the running canary or daemon is requested.
